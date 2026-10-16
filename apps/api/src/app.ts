import { configuredSmsSender, type SmsSender } from "./sms.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import type pg from "pg";
import { createPool, ApiError, camel, digest, one } from "./db.js";
import { registerAuth, actor } from "./auth.js";
import { registerProduction } from "./production.js";
import { registerCatalog } from "./catalog.js";
import { registerIntegrations } from "./integrations.js";
import { list } from "./query.js";
import { registerAdministration } from "./administration.js";
import { registerAutoReview } from "./auto-review.js";
type Change = {
  resource: string;
  id?: string;
};
export async function createApp(
  options: {
    pool?: pg.Pool;
    origins?: string[];
    logger?: boolean;
    production?: boolean;
    autoReviewWorker?: boolean;
    smsSender?: SmsSender;
  } = {},
) {
  const pool = options.pool ?? createPool();
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "res.headers.set-cookie",
          ],
        }
      : false,
    bodyLimit: 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  const origins =
    options.origins ??
    (process.env.APP_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((s) => s.trim());
  if (production && origins.some((o) => !o.startsWith("https://")))
    throw new Error("Production APP_ORIGIN must use HTTPS");
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.status(400).send({
        error: {
          code: "VALIDATION",
          message: "输入信息不正确",
          details: error.flatten(),
        },
      });
    if (error instanceof ApiError)
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    const code = (error as any).code;
    if (["23505", "23503", "23514", "40P01", "40001"].includes(code))
      return reply.status(409).send({
        error: {
          code: "CONFLICT",
          message:
            code === "23505"
              ? "记录已存在或任务已被领取"
              : code === "23503"
                ? "记录被引用，或关联记录不存在"
                : code === "23514"
                  ? "业务数量或状态不符合约束"
                  : "并发操作冲突，请刷新重试",
        },
      });
    if (code === "22P02" || code === "22007" || code === "22008")
      return reply
        .status(400)
        .send({ error: { code: "VALIDATION", message: "字段格式或日期无效" } });
    if ((error as any).statusCode && Number((error as any).statusCode) < 500)
      return reply.status(Number((error as any).statusCode)).send({
        error: { code: "REQUEST_ERROR", message: (error as Error).message },
      });
    req.log.error({ err: error }, "Request failed");
    return reply.status(500).send({
      error: { code: "INTERNAL", message: "服务暂时不可用，请联系管理员" },
    });
  });
  registerAuth(app, pool, origins, production, options.smsSender ?? configuredSmsSender());
  const streams = new Set<NodeJS.WritableStream>();
  const publish = (event: Change) => {
    for (const stream of streams)
      stream.write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
  };
  app.get("/api/events", async (req, reply) => {
    actor(req);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");
    streams.add(reply.raw);
    const timer = setInterval(() => {
      void pool
        .query(
          "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.active",
          [digest(req.cookies.mes_session ?? "")],
        )
        .then((r) => {
          if (!r.rowCount) reply.raw.end();
          else reply.raw.write(": heartbeat\n\n");
        })
        .catch(() => reply.raw.end());
    }, 15000);
    timer.unref();
    reply.raw.on("close", () => {
      streams.delete(reply.raw);
      clearInterval(timer);
    });
  });
  app.addHook("onResponse", async (req, reply) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      reply.statusCode < 400
    )
      publish({ resource: req.url.split("/")[2] ?? "all" });
  });
  app.get("/api/health", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok", database: "ok" };
    } catch {
      return reply
        .status(503)
        .send({ status: "unavailable", database: "unavailable" });
    }
  });
  app.get("/api/audit-logs", async (req) => {
    actor(req, "manager");
    return list(
      pool,
      "SELECT a.*,COALESCE(u.name,'系统') AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE true",
      [],
      req.query,
      ["a.action", "a.resource", "u.name"],
    );
  });
  app.get("/api/dashboard", async (req) => {
    const user = actor(req);
    const [m, recent, groups, low] = await Promise.all([
      one(
        pool,
        `SELECT (SELECT count(*) FROM work_orders WHERE status IN ('pending','working')) AS active_work_orders,(SELECT count(*) FROM reports WHERE status='complete') AS pending_reports,(SELECT count(*) FROM reports WHERE status='complete' AND auto_review_status='manual') AS manual_review_reports,(SELECT coalesce(sum(quantity),0) FROM stock_balances) AS inventory_quantity,(SELECT count(*) FROM records WHERE resource='andon-events' AND status IN ('draft','submitted')) AS open_andons,(SELECT coalesce(sum(good_quantity),0) FROM work_orders WHERE completed_at>=current_date AND status='complete') AS today_completed,(SELECT coalesce(sum(quantity),0) FROM scraps WHERE approved_at>=current_date AND status='approved') AS today_scrap`,
      ),
      pool.query(
        "SELECT w.*,p.name AS product_name,COALESCE((SELECT LEAST(t.completed_quantity,w.good_quantity) FROM tasks t WHERE t.work_order_id=w.id ORDER BY t.sequence DESC LIMIT 1),0) AS completed_quantity FROM work_orders w JOIN products p ON p.id=w.product_id ORDER BY w.created_at DESC LIMIT 8",
      ),
      pool.query(
        "SELECT status,count(*)::int AS count FROM work_orders GROUP BY status",
      ),
      pool.query(
        "SELECT p.id,p.code,p.name,p.safety_stock,coalesce(sum(b.quantity),0)::int AS quantity FROM products p LEFT JOIN stock_balances b ON b.product_id=p.id GROUP BY p.id HAVING coalesce(sum(b.quantity),0)<p.safety_stock ORDER BY p.name",
      ),
    ]);
    const metrics = camel(m);
    if (["admin", "manager"].includes(user.role))
      metrics.payrollThisMonth = Number(
        (
          await pool.query(
            "SELECT coalesce(sum(amount),0) AS amount FROM payroll WHERE work_date>=date_trunc('month',current_date)",
          )
        ).rows[0].amount,
      );
    return {
      metrics,
      recentWorkOrders: camel(recent.rows),
      productionByStatus: groups.rows,
      lowStock: camel(low.rows),
    };
  });
  registerAdministration(app, pool);
  registerProduction(app, pool);
  registerCatalog(app, pool);
  await registerIntegrations(app, pool, publish);
  registerAutoReview(app, pool, publish, options.autoReviewWorker ?? false);
  app.addHook("preClose", async () => {
    for (const stream of streams) (stream as any).end();
  });
  app.addHook("onClose", async () => {
    if (!options.pool) await pool.end();
  });
  return app;
}
