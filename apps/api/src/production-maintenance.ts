import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { actor } from "./auth.js";
import { audit, camel, ensure, id, one, transaction, type DB } from "./db.js";
import { date, notes, quantity, uuid } from "./query.js";
export const salesItemSchema = z
  .object({
    productId: uuid,
    quantity,
    unitPrice: z.number().nonnegative().max(1000000).default(0),
    notes,
  })
  .strict();
export async function salesDetail(db: DB, sid: string) {
  const row = await one(
    db,
    "SELECT s.*,c.name AS customer_name FROM sales_orders s JOIN records c ON c.id=s.customer_id WHERE s.id=$1",
    [sid],
  );
  row.items = (
    await db.query(
      "SELECT i.*,p.name AS product_name,p.code AS product_code FROM sales_order_items i JOIN products p ON p.id=i.product_id WHERE i.sales_order_id=$1 ORDER BY p.name",
      [sid],
    )
  ).rows;
  return camel(row);
}
async function saveItems(
  db: DB,
  sid: string,
  items: z.infer<typeof salesItemSchema>[],
) {
  ensure(
    new Set(items.map((x) => x.productId)).size === items.length,
    "产品不能重复",
  );
  const old = (
    await db.query(
      "SELECT * FROM sales_order_items WHERE sales_order_id=$1 FOR UPDATE",
      [sid],
    )
  ).rows;
  for (const item of old)
    if (!items.some((x) => x.productId === item.product_id)) {
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM work_orders WHERE sales_order_id=$1 AND product_id=$2 UNION ALL SELECT 1 FROM stock_movements WHERE sales_order_id=$1 AND product_id=$2 LIMIT 1",
            [sid, item.product_id],
          )
        ).rowCount,
        "已关联生产或库存的订单明细不能删除",
      );
      await db.query("DELETE FROM sales_order_items WHERE id=$1", [item.id]);
    }
  for (const item of items) {
    await one(
      db,
      "SELECT id FROM products WHERE id=$1 AND active FOR SHARE",
      [item.productId],
      "产品不存在或已停用",
    );
    const allocated = await one(
      db,
      "SELECT coalesce(sum(good_quantity),0) AS quantity FROM work_orders WHERE sales_order_id=$1 AND product_id=$2 AND status<>'closed'",
      [sid, item.productId],
    );
    const stock = (
      await db.query(
        "SELECT out_quantity FROM stock_balances WHERE sales_order_id=$1 AND product_id=$2",
        [sid, item.productId],
      )
    ).rows[0];
    ensure(
      item.quantity >= Math.max(allocated.quantity, stock?.out_quantity ?? 0),
      "订单数量不能少于已分派或已发货数量",
    );
    await db.query(
      "INSERT INTO sales_order_items(id,sales_order_id,product_id,quantity,unit_price,notes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sales_order_id,product_id) DO UPDATE SET quantity=$4,unit_price=$5,notes=$6",
      [id(), sid, item.productId, item.quantity, item.unitPrice, item.notes],
    );
  }
}
export function registerProductionMaintenance(
  app: FastifyInstance,
  pool: pg.Pool,
) {
  app.patch("/api/sales-orders/:id", async (req) => {
    const user = actor(req, "manager"),
      sid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        revision: z.number().int().positive(),
        name: z.string().trim().max(100).default(""),
        customerId: uuid,
        dueDate: date.nullish(),
        priority: z.enum(["normal", "urgent"]).default("normal"),
        notes,
        items: z.array(salesItemSchema).min(1).max(100),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const order = await one(
        db,
        "SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE",
        [sid],
      );
      ensure(order.status === "open", "订单已结束，不能修改");
      ensure(order.revision === input.revision, "订单已被修改，请刷新后重试");
      await one(
        db,
        "SELECT id FROM records WHERE id=$1 AND resource='customers' AND status='active' FOR SHARE",
        [input.customerId],
      );
      await saveItems(db, sid, input.items);
      await db.query(
        "UPDATE sales_orders SET name=$2,customer_id=$3,due_date=$4,priority=$5,notes=$6,revision=revision+1 WHERE id=$1",
        [
          sid,
          input.name,
          input.customerId,
          input.dueDate ?? null,
          input.priority,
          input.notes,
        ],
      );
      await audit(db, user.id, "update", "sales-orders", sid, input);
      return salesDetail(db, sid);
    });
  });
  app.post("/api/sales-orders/:id/copy-items", async (req) => {
    const user = actor(req, "manager"),
      sid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        sourceOrderId: uuid,
        itemIds: z.array(uuid).min(1).max(100).optional(),
        revision: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    ensure(input.sourceOrderId !== sid, "不能复制当前订单到自身");
    return transaction(pool, async (db) => {
      await db.query(
        "SELECT id FROM sales_orders WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [[sid, input.sourceOrderId]],
      );
      const order = await one(db, "SELECT * FROM sales_orders WHERE id=$1", [
        sid,
      ]);
      ensure(order.status === "open", "订单已结束，不能修改");
      ensure(order.revision === input.revision, "订单已被修改，请刷新后重试");
      const source = (
        await db.query(
          "SELECT * FROM sales_order_items WHERE sales_order_id=$1 AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[]))",
          [input.sourceOrderId, input.itemIds ?? null],
        )
      ).rows;
      ensure(
        source.length > 0 &&
          (!input.itemIds || new Set(input.itemIds).size === source.length),
        "复制的订单明细不存在",
      );
      const current = (
        await db.query(
          "SELECT * FROM sales_order_items WHERE sales_order_id=$1",
          [sid],
        )
      ).rows.map((r) => ({
        productId: r.product_id,
        quantity: r.quantity,
        unitPrice: r.unit_price,
        notes: r.notes,
      }));
      for (const row of source) {
        const existing = current.find((x) => x.productId === row.product_id);
        if (existing) existing.quantity += row.quantity;
        else
          current.push({
            productId: row.product_id,
            quantity: row.quantity,
            unitPrice: row.unit_price,
            notes: row.notes,
          });
      }
      await saveItems(
        db,
        sid,
        z.array(salesItemSchema).max(100).parse(current),
      );
      await db.query(
        "UPDATE sales_orders SET revision=revision+1 WHERE id=$1",
        [sid],
      );
      await audit(db, user.id, "copy-items", "sales-orders", sid, input);
      return salesDetail(db, sid);
    });
  });
  for (const action of ["complete", "close"] as const)
    app.post(`/api/sales-orders/:id/${action}`, async (req) => {
      const user = actor(req, "manager"),
        sid = uuid.parse((req.params as any).id);
      const input = z
        .object({ reason: z.string().trim().max(1000).default("") })
        .strict()
        .parse(req.body ?? {});
      return transaction(pool, async (db) => {
        const order = await one(
          db,
          "SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE",
          [sid],
        );
        ensure(order.status === "open", "订单已结束");
        ensure(
          !(
            await db.query(
              "SELECT 1 FROM work_orders WHERE sales_order_id=$1 AND status IN ('pending','working')",
              [sid],
            )
          ).rowCount,
          "订单仍有未结束的生产工单",
        );
        if (action === "complete")
          ensure(
            !(
              await db.query(
                "SELECT 1 FROM sales_order_items i LEFT JOIN stock_balances b ON b.sales_order_id=i.sales_order_id AND b.product_id=i.product_id WHERE i.sales_order_id=$1 AND coalesce(b.out_quantity,0)<i.quantity",
                [sid],
              )
            ).rowCount,
            "订单尚未全部发货，可填写原因关闭剩余需求",
          );
        else ensure(input.reason.length > 0, "关闭订单必须填写原因");
        await db.query(
          "UPDATE sales_orders SET status=$2,completed_at=now(),revision=revision+1 WHERE id=$1",
          [sid, action === "complete" ? "complete" : "closed"],
        );
        await audit(db, user.id, action, "sales-orders", sid, input);
        return salesDetail(db, sid);
      });
    });
  app.delete("/api/sales-orders/:id", async (req) => {
    const user = actor(req, "manager"),
      sid = uuid.parse((req.params as any).id);
    return transaction(pool, async (db) => {
      await one(db, "SELECT id FROM sales_orders WHERE id=$1 FOR UPDATE", [
        sid,
      ]);
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM work_orders WHERE sales_order_id=$1 UNION ALL SELECT 1 FROM stock_movements WHERE sales_order_id=$1 LIMIT 1",
            [sid],
          )
        ).rowCount,
        "已关联生产或库存的订单不能删除，请关闭订单",
      );
      await db.query("DELETE FROM stock_balances WHERE sales_order_id=$1", [
        sid,
      ]);
      await db.query("DELETE FROM sales_order_items WHERE sales_order_id=$1", [
        sid,
      ]);
      await db.query("DELETE FROM sales_orders WHERE id=$1", [sid]);
      await audit(db, user.id, "delete", "sales-orders", sid);
      return { ok: true };
    });
  });
  for (const action of ["archive", "restore"] as const)
    app.post(`/api/products/:id/${action}`, async (req) => {
      const user = actor(req, "manager"),
        pid = uuid.parse((req.params as any).id);
      return transaction(pool, async (db) => {
        await one(db, "SELECT id FROM products WHERE id=$1 FOR UPDATE", [pid]);
        const row = await one(
          db,
          "UPDATE products SET active=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
          [pid, action === "restore"],
        );
        await audit(db, user.id, action, "products", pid);
        return camel(row);
      });
    });
  app.delete("/api/work-orders/:id", async (req) => {
    const user = actor(req, "manager"),
      wid = uuid.parse((req.params as any).id);
    return transaction(pool, async (db) => {
      const work = await one(
        db,
        "SELECT * FROM work_orders WHERE id=$1 FOR UPDATE",
        [wid],
      );
      ensure(work.status === "pending", "只有未开工的工单可以删除");
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM reports WHERE work_order_id=$1 UNION ALL SELECT 1 FROM scraps WHERE work_order_id=$1 LIMIT 1",
            [wid],
          )
        ).rowCount,
        "工单已有执行记录，不能删除",
      );
      await db.query("DELETE FROM tasks WHERE work_order_id=$1", [wid]);
      await db.query("DELETE FROM work_orders WHERE id=$1", [wid]);
      await audit(db, user.id, "delete", "work-orders", wid);
      return { ok: true };
    });
  });
}
