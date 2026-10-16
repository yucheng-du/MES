import { createPool, transaction, id, ensure, audit } from "./db.js";
import { hashPassword, passwordSchema } from "./auth.js";
const username = process.env.ADMIN_USERNAME ?? "admin";
const password = passwordSchema.parse(process.env.ADMIN_PASSWORD);
const pool = createPool();
try {
  const passwordHash = await hashPassword(password);
  await transaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(8334501)");
    ensure(
      !(await db.query("SELECT id FROM users WHERE role='admin'")).rowCount,
      "管理员已存在；请使用已登录的用户管理流程",
    );
    const uid = id();
    await db.query(
      "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,'admin')",
      [uid, username, process.env.ADMIN_NAME ?? "系统管理员", passwordHash],
    );
    await audit(db, uid, "bootstrap", "users", uid);
  });
  console.log("Administrator created. Password was not logged.");
} finally {
  await pool.end();
}
