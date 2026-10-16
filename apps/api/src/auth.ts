import {
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import {
  ApiError,
  ensure,
  digest,
  id,
  one,
  transaction,
  audit,
  camel,
} from "./db.js";
import {
  hasPermission,
  permissionKey,
  permissionCatalog,
} from "./permissions.js";
import type { SmsSender } from "./sms.js";
export { hasPermission } from "./permissions.js";
const scrypt = promisify(scryptCallback);
export const roles = [
  "admin",
  "manager",
  "operator",
  "quality",
  "warehouse",
  "viewer",
] as const;
export type Role = (typeof roles)[number];
export type Actor = {
  id: string;
  username: string;
  name: string;
  role: Role;
  active: boolean;
  allowedPermissions?: string[];
  deniedPermissions?: string[];
};
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const got = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export function actor(req: FastifyRequest, ...allowed: Role[]): Actor {
  const user = req.actor;
  ensure(user, "请先登录", 401, "UNAUTHENTICATED");
  ensure(
    hasPermission(user, permissionKey(req), allowed),
    "没有此操作权限",
    403,
    "FORBIDDEN",
  );
  return user;
}
export function own(user: Actor, workerId: string) {
  ensure(
    user.id === workerId || ["admin", "manager"].includes(user.role),
    "只能操作自己的报工",
    403,
    "FORBIDDEN",
  );
}
export const passwordSchema = z.string().min(12, "密码至少12位").max(128);

const peopleFields = {
  allowedPermissions: z.array(z.string().max(160)).max(1000).optional(),
  deniedPermissions: z.array(z.string().max(160)).max(1000).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  jobTitle: z.string().trim().max(100).optional(),
  mobile: z.string().trim().max(40).optional(),
  profile: z
    .object({
      birth: z.string().date().or(z.literal("")).optional(),
      gender: z.enum(["", "female", "male", "other"]).optional(),
      identityNumber: z.string().max(80).optional(),
      address: z.string().max(500).optional(),
      emergencyName: z.string().max(100).optional(),
      emergencyPhone: z.string().max(40).optional(),
      attachmentIds: z.array(z.string().uuid()).max(10).optional(),
    })
    .strict()
    .optional(),
};
function validatePermissionLists(input: any, keys: string[]) {
  ensure(
    [
      ...(input.allowedPermissions ?? []),
      ...(input.deniedPermissions ?? []),
    ].every((k) => keys.includes(k)),
    "权限项不存在",
    400,
    "VALIDATION",
  );
}
async function savePeople(db: pg.PoolClient, target: string, input: any) {
  if (input.departmentId)
    await one(
      db,
      "SELECT id FROM records WHERE id=$1 AND resource='departments'",
      [input.departmentId],
      "部门不存在",
    );
  const files = input.profile?.attachmentIds ?? [];
  if (files.length)
    ensure(
      (
        await db.query(
          "SELECT id FROM uploaded_files WHERE id=ANY($1::uuid[]) AND visibility='personnel'",
          [files],
        )
      ).rowCount === new Set(files).size,
      "人员附件不存在或不是受限档案附件",
      400,
      "VALIDATION",
    );
  const fields: Record<string, string> = {
    allowedPermissions: "allowed_permissions",
    deniedPermissions: "denied_permissions",
    departmentId: "department_id",
    jobTitle: "job_title",
    mobile: "mobile",
    profile: "profile",
  };
  for (const [key, column] of Object.entries(fields))
    if (input[key] !== undefined)
      await db.query(`UPDATE users SET ${column}=$2 WHERE id=$1`, [
        target,
        key === "profile" ? JSON.stringify(input[key]) : input[key],
      ]);
}

export function registerAuth(
  app: FastifyInstance,
  pool: pg.Pool,
  origins: string[],
  production: boolean,
  sendLoginCode?: SmsSender,
) {
  const domains = new Set<string>();
  app.addHook("onRoute", (route) => {
    const domain = route.url.split("/")[2];
    if (domain) domains.add(domain);
  });
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: "strict" as const,
    path: "/api",
    maxAge: 60 * 60 * 12,
  };
  app.decorateRequest("actor", null);
  app.addHook("onRequest", async (req) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const origin = req.headers.origin;
      ensure(
        typeof origin === "string" && origins.includes(origin),
        "请求来源不可信",
        403,
        "CSRF",
      );
      ensure(
        !req.headers["sec-fetch-site"] ||
          ["same-origin", "same-site", "none"].includes(
            String(req.headers["sec-fetch-site"]),
          ),
        "跨站请求被拒绝",
        403,
        "CSRF",
      );
    }
    const token = req.cookies.mes_session;
    if (token) {
      const result = await pool.query(
        'SELECT u.id,u.username,u.name,u.name AS "displayName",u.role,u.active,u.allowed_permissions AS "allowedPermissions",u.denied_permissions AS "deniedPermissions" FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.active=true',
        [digest(token)],
      );
      req.actor = result.rows[0] ?? null;
    }
    if (
      (req.routeOptions.url ?? req.url).startsWith("/api/") &&
      ![
        "/api/auth/login",
        "/api/auth/options",
        "/api/auth/sms/request",
        "/api/auth/sms/login",
        "/api/health",
        "/api/android/latest",
      ].includes(req.url.split("?")[0])
    )
      ensure(req.actor, "请先登录", 401, "UNAUTHENTICATED");
  });
  app.addHook("preHandler", async (req) => {
    if (req.actor) actor(req);
  });
  app.get("/api/permissions", async (req) => {
    actor(req, "admin");
    return permissionCatalog(domains);
  });
  app.get("/api/auth/options", async () => ({ smsLogin: !!sendLoginCode }));
  app.post(
    "/api/auth/sms/request",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      ensure(sendLoginCode, "短信登录未配置", 503, "SMS_DISABLED");
      const { mobile } = z
        .object({ mobile: z.string().regex(/^\+?[0-9]{6,20}$/) })
        .strict()
        .parse(req.body);
      await transaction(pool, async (db) => {
        const users = await db.query(
          "SELECT id FROM users WHERE mobile=$1 AND active AND archived_at IS NULL FOR UPDATE",
          [mobile],
        );
        if (!users.rowCount) return;
        const uid = users.rows[0].id;
        const recent = await db.query(
          "SELECT 1 FROM login_codes WHERE user_id=$1 AND requested_at>now()-interval '60 seconds'",
          [uid],
        );
        ensure(!recent.rowCount, "请稍后再请求验证码", 429, "RATE_LIMIT");
        const code = String(randomInt(0, 1000000)).padStart(6, "0"),
          nonce = randomBytes(24).toString("hex");
        try {
          await sendLoginCode(mobile, code);
        } catch {
          throw new ApiError(
            503,
            "SMS_UNAVAILABLE",
            "验证码发送失败，请稍后重试",
          );
        }
        await db.query(
          "INSERT INTO login_codes(user_id,code_hash,nonce,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes') ON CONFLICT(user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,nonce=EXCLUDED.nonce,expires_at=EXCLUDED.expires_at,requested_at=now(),attempts=0,consumed=false",
          [uid, digest(nonce + code), nonce],
        );
        await audit(db, uid, "request-login-code", "auth", uid);
      });
      return { ok: true, intervalSeconds: 60 };
    },
  );
  app.post(
    "/api/auth/sms/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      ensure(sendLoginCode, "短信登录未配置", 503, "SMS_DISABLED");
      const input = z
        .object({
          mobile: z.string().regex(/^\+?[0-9]{6,20}$/),
          code: z.string().regex(/^[0-9]{6}$/),
        })
        .strict()
        .parse(req.body);
      const token = randomBytes(32).toString("base64url");
      const result = await transaction(pool, async (db) => {
        const row = (
          await db.query(
            "SELECT c.*,u.username,u.name,u.role,u.active,u.allowed_permissions,u.denied_permissions FROM login_codes c JOIN users u ON u.id=c.user_id WHERE u.mobile=$1 AND u.active AND u.archived_at IS NULL AND c.expires_at>now() AND NOT c.consumed AND c.attempts<5 FOR UPDATE OF c,u",
            [input.mobile],
          )
        ).rows[0];
        if (!row) return null;
        await db.query(
          "UPDATE login_codes SET attempts=attempts+1 WHERE user_id=$1",
          [row.user_id],
        );
        if (
          !timingSafeEqual(
            Buffer.from(row.code_hash, "hex"),
            Buffer.from(digest(row.nonce + input.code), "hex"),
          )
        )
          return null;
        await db.query(
          "UPDATE login_codes SET consumed=true WHERE user_id=$1",
          [row.user_id],
        );
        await db.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [digest(token), row.user_id],
        );
        await audit(db, row.user_id, "sms-login", "auth", row.user_id);
        return {
          id: row.user_id,
          username: row.username,
          name: row.name,
          role: row.role,
          active: row.active,
          allowedPermissions: row.allowed_permissions,
          deniedPermissions: row.denied_permissions,
        };
      });
      ensure(result, "验证码无效或已过期", 401, "INVALID_CODE");
      reply.setCookie("mes_session", token, cookieOptions);
      return { user: result };
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const input = z
        .object({
          username: z.string().trim().min(1).max(64),
          password: z.string().max(128),
        })
        .strict()
        .parse(req.body);
      const row = (
        await pool.query("SELECT * FROM users WHERE username=$1", [
          input.username,
        ])
      ).rows[0];
      const good = await verifyPassword(
        input.password,
        row?.password_hash ??
          "00000000000000000000000000000000:" + "00".repeat(64),
      );
      ensure(row && row.active && good, "账号或密码错误", 401, "INVALID_LOGIN");
      const token = randomBytes(32).toString("base64url");
      await transaction(pool, async (db) => {
        await db.query(
          "DELETE FROM sessions WHERE expires_at<=now() OR token_hash=$1",
          [digest(req.cookies.mes_session ?? "")],
        );
        await db.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [digest(token), row.id],
        );
        await audit(db, row.id, "login", "auth", row.id);
      });
      reply.setCookie("mes_session", token, cookieOptions);
      return {
        user: camel({
          id: row.id,
          username: row.username,
          name: row.name,
          displayName: row.name,
          role: row.role,
          active: row.active,
          allowedPermissions: row.allowed_permissions,
          deniedPermissions: row.denied_permissions,
        }),
      };
    },
  );
  app.get("/api/auth/me", async (req) => ({ user: actor(req) }));
  app.post("/api/auth/refresh", async (req, reply) => {
    const user = actor(req);
    const token = randomBytes(32).toString("base64url");
    await transaction(pool, async (db) => {
      const prior = await db.query(
        "DELETE FROM sessions WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
        [digest(req.cookies.mes_session ?? "")],
      );
      ensure(prior.rowCount === 1, "请先登录", 401, "UNAUTHENTICATED");
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
        [digest(token), user.id],
      );
    });
    reply.setCookie("mes_session", token, cookieOptions);
    return { user };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(req.cookies.mes_session ?? ""),
    ]);
    reply.clearCookie("mes_session", cookieOptions);
    return { ok: true };
  });
  app.get("/api/lookups/users", async (req) => {
    actor(req);
    const result = await pool.query(
      'SELECT id,name,name AS "displayName" FROM users WHERE active ORDER BY name',
    );
    return {
      items: result.rows,
      total: result.rowCount,
      page: 1,
      pageSize: result.rowCount,
    };
  });
  app.get("/api/users", async (req) => {
    const user = actor(req, "admin", "manager");
    const result = await pool.query(
      'SELECT id,username,name,name AS "displayName",role,active,created_at,allowed_permissions,denied_permissions,department_id,job_title,mobile,revision,profile FROM users WHERE archived_at IS NULL ORDER BY created_at',
    );
    return {
      items: camel(
        result.rows.map((row) =>
          user.role === "admin" ? row : { ...row, profile: undefined },
        ),
      ),
      total: result.rowCount,
      page: 1,
      pageSize: result.rowCount,
    };
  });
  app.post("/api/users", async (req) => {
    const user = actor(req, "admin");
    const input = z
      .object({
        username: z.string().regex(/^[a-zA-Z0-9_.-]{3,64}$/),
        name: z.string().trim().min(1).max(100).optional(),
        displayName: z.string().trim().min(1).max(100).optional(),
        password: passwordSchema,
        role: z.enum(roles),
        ...peopleFields,
      })
      .strict()
      .refine((v) => v.name || v.displayName, "姓名不能为空")
      .parse(req.body);
    ensure(user.role === "admin", "只有管理员可以创建成员", 403, "FORBIDDEN");
    validatePermissionLists(
      input,
      permissionCatalog(domains).map((p) => p.key),
    );
    const hash = await hashPassword(input.password);
    return transaction(pool, async (db) => {
      const result = await one(
        db,
        "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,username,name,role,active",
        [
          id(),
          input.username,
          input.name ?? input.displayName,
          hash,
          input.role,
        ],
      );
      await savePeople(db, result.id, input);
      await audit(db, user.id, "create", "users", result.id, {
        role: input.role,
      });
      return camel(result);
    });
  });
  app.patch("/api/users/:id", async (req) => {
    const user = actor(req, "admin");
    const target = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const input = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        role: z.enum(roles).optional(),
        active: z.boolean().optional(),
        username: z
          .string()
          .regex(/^[a-zA-Z0-9_.-]{3,64}$/)
          .optional(),
        revision: z.number().int().positive().optional(),
        ...peopleFields,
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      ensure(
        user.role === "admin",
        "只有管理员可以修改成员权限",
        403,
        "FORBIDDEN",
      );
      validatePermissionLists(
        input,
        permissionCatalog(domains).map((p) => p.key),
      );
      await db.query("SELECT pg_advisory_xact_lock(8334501)");
      const old = await one(db, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        target,
      ]);
      ensure(
        !input.revision || input.revision === old.revision,
        "成员信息已更新，请刷新重试",
      );
      if (
        old.role === "admin" &&
        old.active &&
        (input.active === false || (input.role && input.role !== "admin"))
      ) {
        const count = Number(
          (
            await db.query(
              "SELECT count(*) FROM users WHERE role='admin' AND active=true",
            )
          ).rows[0].count,
        );
        ensure(count > 1, "不能停用最后一位管理员");
      }
      const row = await one(
        db,
        "UPDATE users SET name=$2,role=$3,active=$4,updated_at=now() WHERE id=$1 RETURNING id,username,name,role,active",
        [
          target,
          input.name ?? old.name,
          input.role ?? old.role,
          input.active ?? old.active,
        ],
      );
      await savePeople(db, target, input);
      if (input.username)
        await db.query("UPDATE users SET username=$2 WHERE id=$1", [
          target,
          input.username,
        ]);
      await db.query("UPDATE users SET revision=revision+1 WHERE id=$1", [
        target,
      ]);
      await db.query("DELETE FROM sessions WHERE user_id=$1", [target]);
      await audit(db, user.id, "update", "users", target, {
        fields: Object.keys(input),
        role: input.role,
        active: input.active,
      });
      return camel(row);
    });
  });
  app.get("/api/users/:id", async (req) => {
    const user = actor(req, "manager");
    const target = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const row = await one(
      pool,
      "SELECT id,username,name,role,active,allowed_permissions,denied_permissions,department_id,job_title,mobile,revision,profile FROM users WHERE id=$1",
      [target],
    );
    if (user.role !== "admin") delete row.profile;
    return camel(row);
  });
  app.delete("/api/users/:id", async (req) => {
    const user = actor(req, "admin");
    ensure(user.role === "admin", "只有管理员可以归档成员", 403, "FORBIDDEN");
    const target = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    ensure(target !== user.id, "不能归档当前账号");
    return transaction(pool, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(8334501)");
      const old = await one(db, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        target,
      ]);
      if (old.role === "admin" && old.active)
        ensure(
          Number(
            (
              await db.query(
                "SELECT count(*) FROM users WHERE role='admin' AND active",
              )
            ).rows[0].count,
          ) > 1,
          "不能停用最后一位管理员",
        );
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM reports WHERE worker_id=$1 AND status IN ('received','working')",
            [target],
          )
        ).rowCount,
        "请先结束该成员正在进行的报工",
      );
      await db.query(
        "UPDATE users SET active=false,archived_at=now(),revision=revision+1 WHERE id=$1",
        [target],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [target]);
      await audit(db, user.id, "archive", "users", target);
      return { ok: true };
    });
  });
  app.post("/api/users/:id/password", async (req) => {
    const user = actor(req);
    const target = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    ensure(
      user.id === target || user.role === "admin",
      "无权修改此密码",
      403,
      "FORBIDDEN",
    );
    const input = z
      .object({
        password: passwordSchema,
        currentPassword: z.string().max(128).optional(),
      })
      .strict()
      .parse(req.body);
    const hash = await hashPassword(input.password);
    return transaction(pool, async (db) => {
      const old = await one(db, "SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        target,
      ]);
      if (user.id === target)
        ensure(
          await verifyPassword(input.currentPassword ?? "", old.password_hash),
          "当前密码错误",
          403,
          "FORBIDDEN",
        );
      await db.query(
        "UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1",
        [target, hash],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [target]);
      await audit(db, user.id, "change-password", "users", target);
      return { ok: true };
    });
  });
}
