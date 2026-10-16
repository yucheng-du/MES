import { z } from "zod";
import type { DB } from "./db.js";
import { camel } from "./db.js";
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
  q: z.string().max(100).optional(),
  status: z.string().max(40).optional(),
});
export async function list(
  db: DB,
  sql: string,
  args: unknown[],
  query: unknown,
  search: string[],
  status?: string,
) {
  const p = pageSchema.parse(query);
  const conditions: string[] = [];
  let values = [...args];
  if (p.q && search.length) {
    values.push(`%${p.q}%`);
    conditions.push(
      `(${search.map((s) => `${s} ILIKE $${values.length}`).join(" OR ")})`,
    );
  }
  if (p.status && status) {
    values.push(p.status);
    conditions.push(`${status}=$${values.length}`);
  }
  const where = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
  const base = `${sql}${where}`;
  const total = Number(
    (await db.query(`SELECT count(*) FROM (${base}) results`, values)).rows[0]
      .count,
  );
  values.push(p.pageSize, (p.page - 1) * p.pageSize);
  const rows = (
    await db.query(
      `${base} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    )
  ).rows;
  return { items: camel(rows), total, page: p.page, pageSize: p.pageSize };
}
export const uuid = z.string().uuid();
export const quantity = z.number().int().positive().max(100000000);
export const requestId = z.string().min(8).max(128);
export const notes = z.string().max(2000).default("");
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
  }, "日期无效");
