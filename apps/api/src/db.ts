import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
export const { Pool } = pg;
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(20, Number);
export type DB = pg.Pool | pg.PoolClient;
export const id = () => randomUUID();
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL must be set explicitly");
  return new pg.Pool({
    connectionString: url,
    max: 15,
    statement_timeout: 15000,
    application_name: "mes-next",
  });
}
export async function transaction<T>(
  pool: pg.Pool,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const value = await fn(db);
    await db.query("COMMIT");
    return value;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  message: string,
  status = 409,
  code = "CONFLICT",
): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}
export async function one(
  db: DB,
  sql: string,
  args: unknown[] = [],
  message = "记录不存在",
) {
  const { rows } = await db.query(sql, args);
  ensure(rows[0], message, 404, "NOT_FOUND");
  return rows[0];
}
export async function audit(
  db: DB,
  actor: string | null,
  action: string,
  resource: string,
  resourceId: string | null,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_logs(id,actor_id,action,resource,resource_id,details) VALUES($1,$2,$3,$4,$5,$6)",
    [id(), actor, action, resource, resourceId, JSON.stringify(details)],
  );
}
export async function idempotent<T>(
  db: pg.PoolClient,
  actor: string,
  scope: string,
  key: string,
  payload: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const hash = digest(JSON.stringify(payload));
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${actor}/${scope}/${key}`,
  ]);
  const old = (
    await db.query(
      "SELECT payload_hash,response FROM idempotency_keys WHERE actor_id=$1 AND scope=$2 AND request_id=$3",
      [actor, scope, key],
    )
  ).rows[0];
  if (old) {
    ensure(old.payload_hash === hash, "相同 requestId 不得用于不同内容");
    return old.response as T;
  }
  const result = await fn();
  await db.query(
    "INSERT INTO idempotency_keys(actor_id,scope,request_id,payload_hash,response) VALUES($1,$2,$3,$4,$5)",
    [actor, scope, key, hash, JSON.stringify(result)],
  );
  return result;
}
export function camel(row: any): any {
  if (Array.isArray(row)) return row.map(camel);
  if (row instanceof Date) return row.toISOString();
  if (row && typeof row === "object")
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        camel(value),
      ]),
    );
  return row;
}
