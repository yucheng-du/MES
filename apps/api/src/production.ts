import { freezeReportEquipment } from "./report-equipment.js";
import {
  registerProductionMaintenance,
  salesItemSchema,
} from "./production-maintenance.js";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { actor, own, hasPermission } from "./auth.js";
import {
  approveReport,
  lockReportReview,
  lockReviewSettings,
  reviewReasons,
  scheduleReportReview,
} from "./report-review.js";
import {
  audit,
  camel,
  ensure,
  id,
  idempotent,
  one,
  transaction,
  type DB,
} from "./db.js";
import { date, list, notes, quantity, requestId, uuid } from "./query.js";
import {
  registerProductionParity,
  parityStepSchema,
  productDetailsSchema,
  validateProductDetails,
  validateSteps,
  stepMetadata,
  validateTaskReceive,
  occupyStation,
  releaseStation,
} from "./production-parity.js";
export const code = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${id().slice(0, 6).toUpperCase()}`;
const stepSchema = parityStepSchema;
const productSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(20).default("件"),
    safetyStock: z.number().int().nonnegative().max(100000000).default(0),
    steps: z.array(stepSchema).min(1).max(50),
    details: productDetailsSchema.optional(),
  })
  .strict();
const reportQuery = `SELECT r.*,u.name AS worker_name,p.name AS product_name,t.name AS task_name,w.code AS work_order_code FROM reports r JOIN users u ON u.id=r.worker_id JOIN tasks t ON t.id=r.task_id JOIN work_orders w ON w.id=r.work_order_id JOIN products p ON p.id=w.product_id WHERE true`;
export async function productDetail(db: DB, productId: string) {
  const p = await one(db, "SELECT * FROM products WHERE id=$1", [productId]);
  p.steps = (
    await db.query(
      "SELECT id,name,sequence,unit_price,expected_minutes,production FROM product_steps WHERE product_id=$1 ORDER BY sequence",
      [productId],
    )
  ).rows;
  p.steps = p.steps.map((s: any) => ({ ...s, ...s.production }));
  return camel(p);
}
export async function workDetail(db: DB, workId: string) {
  const w = await one(
    db,
    "SELECT w.*,p.name AS product_name,p.unit,s.code AS sales_order_code FROM work_orders w JOIN products p ON p.id=w.product_id LEFT JOIN sales_orders s ON s.id=w.sales_order_id WHERE w.id=$1",
    [workId],
  );
  w.tasks = (
    await db.query(
      "SELECT t.*,u.name AS assigned_worker_name,s.name AS assigned_station_name,d.name AS assigned_device_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_worker_id LEFT JOIN records s ON s.id=t.assigned_station_id LEFT JOIN records d ON d.id=t.assigned_device_id WHERE t.work_order_id=$1 ORDER BY t.sequence",
      [workId],
    )
  ).rows.map((t) => ({
    ...t,
    available_quantity:
      t.status === "ready"
        ? Math.max(0, w.good_quantity - t.completed_quantity)
        : 0,
  }));
  w.completed_quantity = Math.min(
    w.good_quantity,
    w.tasks.at(-1)?.completed_quantity ?? 0,
  );
  w.reports = (
    await db.query(
      reportQuery + " AND r.work_order_id=$1 ORDER BY r.created_at DESC",
      [workId],
    )
  ).rows;
  w.scraps = (
    await db.query(
      "SELECT * FROM scraps WHERE work_order_id=$1 ORDER BY created_at DESC",
      [workId],
    )
  ).rows;
  return camel(w);
}
export async function balanceLock(
  db: DB,
  productId: string,
  salesOrderId: string | null,
) {
  await db.query(
    "INSERT INTO stock_balances(id,product_id,sales_order_id) VALUES($1,$2,$3) ON CONFLICT(product_id,sales_order_id) DO NOTHING",
    [id(), productId, salesOrderId],
  );
  return one(
    db,
    "SELECT * FROM stock_balances WHERE product_id=$1 AND sales_order_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE",
    [productId, salesOrderId],
  );
}
export async function produced(
  db: DB,
  productId: string,
  salesOrderId: string | null,
) {
  return Number(
    (
      await db.query(
        "SELECT COALESCE(sum(good_quantity),0) AS n FROM work_orders WHERE product_id=$1 AND sales_order_id IS NOT DISTINCT FROM $2::uuid AND status='complete'",
        [productId, salesOrderId],
      )
    ).rows[0].n,
  );
}
export async function progress(db: DB, w: any) {
  const tasks = (
    await db.query(
      "SELECT * FROM tasks WHERE work_order_id=$1 ORDER BY sequence FOR UPDATE",
      [w.id],
    )
  ).rows;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (task.status === "complete") continue;
    if (
      task.completed_quantity >= w.good_quantity &&
      !(
        await db.query(
          "SELECT 1 FROM reports WHERE task_id=$1 AND status IN ('received','working')",
          [task.id],
        )
      ).rowCount
    ) {
      await db.query("UPDATE tasks SET status='complete' WHERE id=$1", [
        task.id,
      ]);
      continue;
    }
    if (task.status === "blocked")
      await db.query("UPDATE tasks SET status='ready' WHERE id=$1", [task.id]);
    return;
  }
  await db.query(
    "UPDATE work_orders SET status='complete',completed_at=now() WHERE id=$1",
    [w.id],
  );
}
export async function approveScrap(
  db: DB,
  w: any,
  s: any,
  options: {
    actorId: string | null;
    mode: "manual" | "automatic";
    deductionUnitPrice: number;
    rewardUnitPrice: number;
    responsibleReportId?: string | null;
  },
) {
  ensure(s.status === "pending", "报废已被处理");
  ensure(w.status !== "closed", "已关闭工单不能再审批报废");
  ensure(s.quantity <= w.good_quantity, "报废数量超出良品数");
  const balance = await balanceLock(db, w.product_id, w.sales_order_id);
  if (w.status === "complete")
    ensure(
      (await produced(db, w.product_id, w.sales_order_id)) - s.quantity >=
        balance.in_quantity,
      "已入库成品不能直接报废，请先办理库存质量处置",
    );
  const responsibleReportId =
    options.responsibleReportId ?? s.responsible_report_id;
  if (responsibleReportId) {
    const report = await one(
      db,
      "SELECT r.*,t.unit_price FROM reports r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1 AND r.work_order_id=$2 FOR UPDATE OF r",
      [responsibleReportId, w.id],
      "责任报工不属于该工单",
    );
    ensure(
      !s.responsible_user_id || s.responsible_user_id === report.worker_id,
      "责任人与责任报工不匹配",
    );
    s.responsible_user_id = report.worker_id;
    if (["complete", "approved", "rejected"].includes(report.status)) {
      ensure(
        report.quantity + report.complete_adjustment >= s.quantity,
        "报废数量超过责任报工剩余良品",
      );
      await db.query(
        "UPDATE reports SET complete_adjustment=complete_adjustment-$2 WHERE id=$1",
        [report.id, s.quantity],
      );
      if (report.status === "approved")
        await db.query(
          "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date) VALUES($1,$2,'piece-adjustment',$3,$4,$5,-round($4::numeric*$5::numeric,2),current_date)",
          [id(), report.worker_id, s.id, s.quantity, report.unit_price],
        );
    }
  }
  w.good_quantity -= s.quantity;
  await db.query("UPDATE work_orders SET good_quantity=$2 WHERE id=$1", [
    w.id,
    w.good_quantity,
  ]);
  if (w.status !== "complete") await progress(db, w);
  if (options.deductionUnitPrice) {
    ensure(s.responsible_user_id, "扣款必须指定责任人");
    await db.query(
      "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date) VALUES($1,$2,'scrap-penalty',$3,$4,$5,-round($4::numeric*$5::numeric,2),current_date)",
      [
        id(),
        s.responsible_user_id,
        s.id,
        s.quantity,
        options.deductionUnitPrice,
      ],
    );
  }
  if (options.rewardUnitPrice) {
    const discoveryWorker = s.report_id
      ? (
          await one(
            db,
            "SELECT worker_id FROM reports WHERE id=$1 AND work_order_id=$2",
            [s.report_id, w.id],
          )
        ).worker_id
      : s.reported_by;
    ensure(
      discoveryWorker !== s.responsible_user_id,
      "责任人与发现人为同一人时不能生成发现奖励",
    );
    await db.query(
      "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date) VALUES($1,$2,'scrap-reward',$3,$4,$5,round($4::numeric*$5::numeric,2),current_date)",
      [id(), discoveryWorker, s.id, s.quantity, options.rewardUnitPrice],
    );
  }
  const result = await one(
    db,
    "UPDATE scraps SET status='approved',approved_by=$2,approved_at=clock_timestamp(),approval_mode=$3,responsible_report_id=$4,responsible_user_id=$5,deduction_unit_price=$6,reward_unit_price=$7 WHERE id=$1 RETURNING *",
    [
      s.id,
      options.actorId,
      options.mode,
      responsibleReportId ?? null,
      s.responsible_user_id,
      options.deductionUnitPrice,
      options.rewardUnitPrice,
    ],
  );
  await audit(
    db,
    options.actorId,
    options.mode === "automatic" ? "auto-approve" : "approve",
    "scraps",
    s.id,
    options,
  );
  return result;
}

export function registerProduction(app: FastifyInstance, pool: pg.Pool) {
  registerProductionParity(app, pool);
  registerProductionMaintenance(app, pool);
  app.get("/api/products", async (req) => {
    const result = await list(
      pool,
      "SELECT * FROM products WHERE true",
      [],
      req.query,
      ["name", "code"],
    );
    result.items = await Promise.all(
      result.items.map((p: any) => productDetail(pool, p.id)),
    );
    return result;
  });
  app.get("/api/products/:id", async (req) =>
    productDetail(pool, uuid.parse((req.params as any).id)),
  );
  app.post("/api/products", async (req) => {
    const user = actor(req, "manager");
    const input = productSchema.parse(req.body);
    return transaction(pool, async (db) => {
      const pid = id();
      await validateSteps(db, input.steps);
      if (input.details) await validateProductDetails(db, input.details);
      await db.query(
        "INSERT INTO products(id,code,name,unit,safety_stock,details) VALUES($1,$2,$3,$4,$5,$6)",
        [
          pid,
          input.code,
          input.name,
          input.unit,
          input.safetyStock,
          JSON.stringify(input.details ?? {}),
        ],
      );
      for (const [i, s] of input.steps.entries())
        await db.query(
          "INSERT INTO product_steps(id,product_id,sequence,name,unit_price,expected_minutes,production) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id(),
            pid,
            i + 1,
            s.name,
            s.unitPrice,
            s.expectedMinutes,
            JSON.stringify(stepMetadata(s)),
          ],
        );
      await audit(db, user.id, "create", "products", pid);
      return productDetail(db, pid);
    });
  });
  app.patch("/api/products/:id", async (req) => {
    const user = actor(req, "manager");
    const pid = uuid.parse((req.params as any).id);
    const input = productSchema
      .extend({ revision: z.number().int().positive() })
      .parse(req.body);
    return transaction(pool, async (db) => {
      const p = await one(db, "SELECT * FROM products WHERE id=$1 FOR UPDATE", [
        pid,
      ]);
      ensure(p.revision === input.revision, "产品已被修改，请刷新后重试");
      await validateSteps(db, input.steps);
      if (input.details) await validateProductDetails(db, input.details);
      await db.query(
        "UPDATE products SET code=$2,name=$3,unit=$4,safety_stock=$5,details=$6,revision=revision+1,updated_at=now() WHERE id=$1",
        [
          pid,
          input.code,
          input.name,
          input.unit,
          input.safetyStock,
          JSON.stringify(input.details ?? p.details),
        ],
      );
      await db.query("DELETE FROM product_steps WHERE product_id=$1", [pid]);
      for (const [i, s] of input.steps.entries())
        await db.query(
          "INSERT INTO product_steps(id,product_id,sequence,name,unit_price,expected_minutes,production) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id(),
            pid,
            i + 1,
            s.name,
            s.unitPrice,
            s.expectedMinutes,
            JSON.stringify(stepMetadata(s)),
          ],
        );
      await audit(db, user.id, "update", "products", pid, {
        revision: input.revision,
      });
      return productDetail(db, pid);
    });
  });
  app.get("/api/sales-orders", async (req) =>
    list(
      pool,
      "SELECT s.*,c.name AS customer_name FROM sales_orders s JOIN records c ON c.id=s.customer_id WHERE true",
      [],
      req.query,
      ["s.code", "c.name"],
      "s.status",
    ),
  );
  app.get("/api/sales-orders/:id", async (req) => {
    const sid = uuid.parse((req.params as any).id);
    const row = await one(
      pool,
      "SELECT s.*,c.name AS customer_name FROM sales_orders s JOIN records c ON c.id=s.customer_id WHERE s.id=$1",
      [sid],
    );
    row.items = (
      await pool.query(
        "SELECT i.*,p.name AS product_name,p.code AS product_code FROM sales_order_items i JOIN products p ON p.id=i.product_id WHERE sales_order_id=$1",
        [sid],
      )
    ).rows;
    return camel(row);
  });
  app.post("/api/sales-orders", async (req) => {
    const user = actor(req, "manager");
    const input = z
      .object({
        customerId: uuid,
        name: z.string().trim().max(100).default(""),
        priority: z.enum(["normal", "urgent"]).default("normal"),
        dueDate: date.optional(),
        notes,
        items: z.array(salesItemSchema).min(1).max(100),
      })
      .strict()
      .parse(req.body);
    ensure(
      new Set(input.items.map((i) => i.productId)).size === input.items.length,
      "同一订单不能重复添加相同产品",
      400,
      "VALIDATION",
    );
    return transaction(pool, async (db) => {
      await one(
        db,
        "SELECT id FROM records WHERE id=$1 AND resource='customers' AND status='active' FOR SHARE",
        [input.customerId],
        "客户不存在或已归档",
      );
      const sid = id();
      await db.query(
        "INSERT INTO sales_orders(id,code,customer_id,due_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          sid,
          code("SO"),
          input.customerId,
          input.dueDate ?? null,
          input.notes,
          user.id,
        ],
      );
      await db.query(
        "UPDATE sales_orders SET name=$2,priority=$3 WHERE id=$1",
        [sid, input.name, input.priority],
      );
      for (const i of input.items) {
        await one(
          db,
          "SELECT id FROM products WHERE id=$1 AND active FOR SHARE",
          [i.productId],
          "产品不存在",
        );
        await db.query(
          "INSERT INTO sales_order_items(id,sales_order_id,product_id,quantity,unit_price,notes) VALUES($1,$2,$3,$4,$5,$6)",
          [id(), sid, i.productId, i.quantity, i.unitPrice, i.notes],
        );
      }
      await audit(db, user.id, "create", "sales-orders", sid);
      return camel(
        await one(db, "SELECT * FROM sales_orders WHERE id=$1", [sid]),
      );
    });
  });
  app.get("/api/work-orders", async (req) => {
    const { salesOrderId, productId } = z
      .object({ salesOrderId: uuid.optional(), productId: uuid.optional() })
      .parse(req.query);
    return list(
      pool,
      "SELECT w.*,p.name AS product_name,s.code AS sales_order_code,COALESCE((SELECT LEAST(t.completed_quantity,w.good_quantity) FROM tasks t WHERE t.work_order_id=w.id ORDER BY t.sequence DESC LIMIT 1),0) AS completed_quantity FROM work_orders w JOIN products p ON p.id=w.product_id LEFT JOIN sales_orders s ON s.id=w.sales_order_id WHERE ($1::uuid IS NULL OR w.sales_order_id=$1) AND ($2::uuid IS NULL OR w.product_id=$2)",
      [salesOrderId ?? null, productId ?? null],
      req.query,
      ["w.code", "p.name"],
      "w.status",
    );
  });
  app.get("/api/work-orders/:id", async (req) =>
    workDetail(pool, uuid.parse((req.params as any).id)),
  );
  app.post("/api/work-orders", async (req) => {
    const user = actor(req, "manager");
    const input = z
      .object({
        productId: uuid,
        salesOrderId: uuid.nullish(),
        routeId: uuid.nullish(),
        quantity,
        priority: z.enum(["normal", "urgent"]).default("normal"),
        dueDate: date.optional(),
        notes,
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      await one(db, "SELECT * FROM products WHERE id=$1 AND active FOR SHARE", [
        input.productId,
      ]);
      if (input.salesOrderId) {
        await one(
          db,
          "SELECT * FROM sales_orders WHERE id=$1 AND status='open' FOR UPDATE",
          [input.salesOrderId],
          "订单不存在或已关闭",
        );
        const item = await one(
          db,
          "SELECT * FROM sales_order_items WHERE sales_order_id=$1 AND product_id=$2",
          [input.salesOrderId, input.productId],
          "该产品不属于此销售订单",
        );
        const assigned = Number(
          (
            await db.query(
              "SELECT COALESCE(sum(good_quantity),0) AS n FROM work_orders WHERE sales_order_id=$1 AND product_id=$2 AND status<>'closed'",
              [input.salesOrderId, input.productId],
            )
          ).rows[0].n,
        );
        ensure(
          assigned + input.quantity <= item.quantity,
          "工单数量超出订单剩余需求",
        );
      }
      let steps = (
        await db.query(
          "SELECT * FROM product_steps WHERE product_id=$1 ORDER BY sequence",
          [input.productId],
        )
      ).rows;
      let route: any = null;
      if (input.routeId) {
        route = await one(
          db,
          "SELECT * FROM production_routes WHERE id=$1 AND active AND (product_id=$2 OR product_id IS NULL) FOR SHARE",
          [input.routeId, input.productId],
          "工艺不存在、已停用或不属于该产品",
        );
        const selected = z.array(parityStepSchema).parse(route.steps);
        await validateSteps(db, selected);
        steps = selected.map((step, i) => ({
          sequence: i + 1,
          name: step.name,
          unit_price: step.unitPrice,
          expected_minutes: step.expectedMinutes,
          production: stepMetadata(step),
        }));
      }
      ensure(steps.length, "产品尚未设置工艺");
      const wid = id();
      await db.query(
        "INSERT INTO work_orders(id,code,product_id,sales_order_id,quantity,good_quantity,priority,due_date,notes,created_by) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9)",
        [
          wid,
          code("WO"),
          input.productId,
          input.salesOrderId ?? null,
          input.quantity,
          input.priority,
          input.dueDate ?? null,
          input.notes,
          user.id,
        ],
      );
      await db.query(
        "UPDATE work_orders SET route_id=$2,route_name=$3 WHERE id=$1",
        [wid, route?.id ?? null, route?.name ?? null],
      );
      for (const s of steps)
        await db.query(
          "INSERT INTO tasks(id,work_order_id,sequence,name,unit_price,expected_minutes,status,production) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id(),
            wid,
            s.sequence,
            s.name,
            s.unit_price,
            s.expected_minutes,
            s.sequence === 1 ? "ready" : "blocked",
            JSON.stringify(s.production ?? {}),
          ],
        );
      await balanceLock(db, input.productId, input.salesOrderId ?? null);
      await audit(db, user.id, "create", "work-orders", wid);
      return workDetail(db, wid);
    });
  });
  app.post("/api/work-orders/:id/close", async (req) => {
    const user = actor(req, "manager");
    const wid = uuid.parse((req.params as any).id);
    const input = z
      .object({ reason: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const w = await one(
        db,
        "SELECT * FROM work_orders WHERE id=$1 FOR UPDATE",
        [wid],
      );
      ensure(["pending", "working"].includes(w.status), "只能关闭未完工工单");
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM reports WHERE work_order_id=$1 AND status IN ('received','working')",
            [wid],
          )
        ).rowCount,
        "尚有正在进行的报工",
      );
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM scraps WHERE work_order_id=$1 AND status='pending'",
            [wid],
          )
        ).rowCount,
        "尚有待审核报废，请先处理后关闭工单",
      );
      await db.query(
        "UPDATE work_orders SET status='closed',close_reason=$2 WHERE id=$1",
        [wid, input.reason],
      );
      await audit(db, user.id, "close", "work-orders", wid, input);
      return workDetail(db, wid);
    });
  });
  app.post("/api/tasks/:id/receive", async (req) => {
    const user = actor(req, "operator", "manager");
    const tid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        workstationId: uuid.nullish(),
        workerId: uuid.optional(),
        forceComplete: z.boolean().default(false),
        reason: z.string().trim().max(1000).default(""),
        quantity: quantity.optional(),
        requestId,
      })
      .strict()
      .parse(req.body);
    if ((input.workerId && input.workerId !== user.id) || input.forceComplete)
      actor(req, "manager");
    if (input.forceComplete)
      ensure(input.reason.length > 0, "补录完工必须填写原因");
    const workerId = input.workerId ?? user.id;
    return transaction(pool, (db) =>
      idempotent(
        db,
        user.id,
        `receive:${tid}`,
        input.requestId,
        input,
        async () => {
          const taskRef = await one(
            db,
            "SELECT work_order_id FROM tasks WHERE id=$1",
            [tid],
          );
          const w = await one(
            db,
            "SELECT * FROM work_orders WHERE id=$1 FOR UPDATE",
            [taskRef.work_order_id],
          );
          ensure(["pending", "working"].includes(w.status), "工单已结束");
          const task = await one(
            db,
            "SELECT * FROM tasks WHERE id=$1 FOR UPDATE",
            [tid],
          );
          ensure(task.status === "ready", "当前工序不可收料");
          const maximum = w.good_quantity - task.completed_quantity;
          const count = input.quantity ?? maximum;
          ensure(count > 0 && count <= maximum, "收料数量超出剩余待加工数量");
          const deviceId = await validateTaskReceive(
            db,
            task,
            workerId,
            input.workstationId,
            input.forceComplete,
          );
          const rid = id();
          const result = await one(
            db,
            "INSERT INTO reports(id,task_id,work_order_id,worker_id,workstation_id,received_quantity,status,device_id,manager_reason) VALUES($1,$2,$3,$4,$5,$6,'received',$7,$8) RETURNING *",
            [
              rid,
              tid,
              w.id,
              workerId,
              input.workstationId ?? null,
              count,
              deviceId,
              input.forceComplete ? input.reason : null,
            ],
          );
          await db.query("UPDATE tasks SET status='received' WHERE id=$1", [
            tid,
          ]);
          await db.query(
            "UPDATE work_orders SET status='working' WHERE id=$1",
            [w.id],
          );
          if (!input.forceComplete)
            await occupyStation(db, input.workstationId, workerId, rid);
          await audit(db, user.id, "receive", "reports", rid, {
            workerId,
            deviceId,
            reason: input.reason,
          });
          if (input.forceComplete || task.production?.autoComplete) {
            ensure(
              !(
                await db.query(
                  "SELECT 1 FROM scraps WHERE work_order_id=$1 AND status='pending'",
                  [w.id],
                )
              ).rowCount,
              "请先处理待审核的报废记录",
            );
            const finished = await one(
              db,
              "UPDATE reports SET status='complete',quantity=$2,started_at=clock_timestamp(),completed_at=clock_timestamp(),auto_review_status='manual',auto_review_reasons=$3 WHERE id=$1 RETURNING *",
              [
                rid,
                count,
                JSON.stringify([
                  input.forceComplete
                    ? "主管补录完工，需要人工复核"
                    : "收料自动完工，需要人工复核",
                ]),
              ],
            );
            await freezeReportEquipment(db, finished);
            await db.query(
              "UPDATE tasks SET completed_quantity=completed_quantity+$2,status='ready' WHERE id=$1",
              [tid, count],
            );
            await releaseStation(db, finished, user.id);
            await progress(db, w);
            await audit(
              db,
              user.id,
              input.forceComplete ? "force-complete" : "receive-complete",
              "reports",
              rid,
              { reason: input.reason },
            );
            return camel(finished);
          }
          return camel(result);
        },
      ),
    );
  });
  app.post("/api/reports/:id/start", async (req) => {
    const user = actor(req, "operator", "manager");
    const rid = uuid.parse((req.params as any).id);
    return transaction(pool, async (db) => {
      const ref = await one(
        db,
        "SELECT work_order_id FROM reports WHERE id=$1",
        [rid],
      );
      await one(db, "SELECT id FROM work_orders WHERE id=$1 FOR UPDATE", [
        ref.work_order_id,
      ]);
      const r = await one(db, "SELECT * FROM reports WHERE id=$1 FOR UPDATE", [
        rid,
      ]);
      own(user, r.worker_id);
      if (r.status === "working") return camel(r);
      ensure(r.status === "received", "此报工不可开始");
      await db.query("UPDATE tasks SET status='working' WHERE id=$1", [
        r.task_id,
      ]);
      const result = await one(
        db,
        "UPDATE reports SET status='working',started_at=now() WHERE id=$1 RETURNING *",
        [rid],
      );
      await audit(db, user.id, "start", "reports", rid);
      return camel(result);
    });
  });
  app.post("/api/reports/:id/complete", async (req) => {
    const user = actor(req, "operator", "manager");
    const rid = uuid.parse((req.params as any).id);
    const input = z
      .object({ quantity: z.number().int().min(0).max(100000000), requestId })
      .strict()
      .parse(req.body);
    return transaction(pool, (db) =>
      idempotent(
        db,
        user.id,
        `complete:${rid}`,
        input.requestId,
        input,
        async () => {
          const settings = await lockReviewSettings(db);
          const ref = await one(
            db,
            "SELECT work_order_id FROM reports WHERE id=$1",
            [rid],
          );
          const w = await one(
            db,
            "SELECT * FROM work_orders WHERE id=$1 FOR UPDATE",
            [ref.work_order_id],
          );
          const r = await one(
            db,
            "SELECT * FROM reports WHERE id=$1 FOR UPDATE",
            [rid],
          );
          own(user, r.worker_id);
          ensure(r.status === "working", "此报工不在加工中");
          ensure(
            !(
              await db.query(
                "SELECT 1 FROM scraps WHERE work_order_id=$1 AND status='pending'",
                [w.id],
              )
            ).rowCount,
            "请先处理待审核的报废记录",
          );
          const task = await one(
            db,
            "SELECT * FROM tasks WHERE id=$1 FOR UPDATE",
            [r.task_id],
          );
          ensure(
            input.quantity <= r.received_quantity &&
              input.quantity <= w.good_quantity - task.completed_quantity,
            "完工数量超出剩余良品数量",
          );
          ensure(
            input.quantity > 0 || w.good_quantity === task.completed_quantity,
            "仅剩余良品为零时允许零数量完工",
          );
          const result = await one(
            db,
            "UPDATE reports SET status='complete',quantity=$2,completed_at=clock_timestamp() WHERE id=$1 RETURNING *",
            [rid, input.quantity],
          );
          await freezeReportEquipment(db, result);
          await db.query(
            "UPDATE tasks SET completed_quantity=completed_quantity+$2,status='ready' WHERE id=$1",
            [task.id, input.quantity],
          );
          await releaseStation(db, r, user.id);
          await progress(db, w);
          await audit(db, user.id, "complete", "reports", rid, input);
          return camel(await scheduleReportReview(db, result, settings));
        },
      ),
    );
  });
  app.post("/api/reports/:id/approve", async (req) => {
    const user = actor(req, "manager", "quality");
    const rid = uuid.parse((req.params as any).id);
    const input = z.object({ requestId }).strict().parse(req.body);
    return transaction(pool, (db) =>
      idempotent(
        db,
        user.id,
        `approve:${rid}`,
        input.requestId,
        input,
        async () => {
          const { report } = await lockReportReview(db, rid);
          return camel(
            await approveReport(db, report, {
              mode: "manual",
              actorId: user.id,
            }),
          );
        },
      ),
    );
  });
  app.post("/api/reports/:id/reject", async (req) => {
    const user = actor(req, "manager", "quality");
    const rid = uuid.parse((req.params as any).id);
    const input = z
      .object({ reason: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const { report: r, settings } = await lockReportReview(db, rid);
      ensure(r.status === "complete", "仅可驳回已完工记录");
      const result = await one(
        db,
        "UPDATE reports SET status='rejected',rejection_reason=$2,approved_by=$3,approved_at=clock_timestamp(),had_rejection=true,auto_review_status='manual',auto_review_reasons=$4,auto_review_eligible_at=null,auto_review_rule_revision=$5 WHERE id=$1 RETURNING *",
        [
          rid,
          input.reason,
          user.id,
          JSON.stringify([reviewReasons.rejected]),
          settings.revision,
        ],
      );
      await audit(db, user.id, "reject", "reports", rid, input);
      return camel(result);
    });
  });
  app.post("/api/reports/:id/resubmit", async (req) => {
    const user = actor(req, "operator", "manager");
    const rid = uuid.parse((req.params as any).id);
    const input = z
      .object({ reason: z.string().trim().min(1).max(1000) })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const { report: r, settings } = await lockReportReview(db, rid);
      own(user, r.worker_id);
      ensure(r.status === "rejected", "仅可重新提交已驳回报工");
      const result = await one(
        db,
        "UPDATE reports SET status='complete',approved_by=null,approved_at=null,rejection_reason=null,had_rejection=true,auto_review_status='manual',auto_review_reasons=$2,auto_review_eligible_at=null,auto_review_rule_revision=$3 WHERE id=$1 RETURNING *",
        [rid, JSON.stringify([reviewReasons.rejected]), settings.revision],
      );
      await audit(db, user.id, "resubmit", "reports", rid, input);
      return camel(result);
    });
  });
  app.post("/api/reports/batch-review", async (req) => {
    const user = actor(req, "manager", "quality");
    const input = z
      .object({
        ids: z.array(uuid).min(1).max(100),
        action: z.enum(["approve", "reject"]),
        reason: z.string().trim().max(1000).default(""),
      })
      .strict()
      .parse(req.body);
    ensure(new Set(input.ids).size === input.ids.length, "报工记录不能重复");
    if (input.action === "reject")
      ensure(input.reason.length > 0, "驳回必须填写原因");
    return transaction(pool, async (db) => {
      const settings = await lockReviewSettings(db);
      const refs = (
        await db.query(
          "SELECT id,work_order_id FROM reports WHERE id=ANY($1::uuid[]) ORDER BY work_order_id,id",
          [input.ids],
        )
      ).rows;
      ensure(refs.length === input.ids.length, "报工记录不存在");
      const results = [];
      for (const ref of refs) {
        const { report } = await lockReportReview(db, ref.id, settings);
        ensure(report.status === "complete", "批量审核只允许已完工记录");
        if (input.action === "approve")
          results.push(
            await approveReport(db, report, {
              mode: "manual",
              actorId: user.id,
            }),
          );
        else {
          results.push(
            await one(
              db,
              "UPDATE reports SET status='rejected',rejection_reason=$2,approved_by=$3,approved_at=clock_timestamp(),had_rejection=true,auto_review_status='manual',auto_review_reasons=$4,auto_review_eligible_at=NULL WHERE id=$1 RETURNING *",
              [
                report.id,
                input.reason,
                user.id,
                JSON.stringify([reviewReasons.rejected]),
              ],
            ),
          );
          await audit(db, user.id, "reject", "reports", report.id, {
            reason: input.reason,
            batch: true,
          });
        }
      }
      return { items: camel(results) };
    });
  });
  app.get("/api/reports/:id", async (req) => {
    const user = actor(req),
      report = await one(pool, reportQuery + " AND r.id=$1", [
        uuid.parse((req.params as any).id),
      ]);
    if (user.role === "operator") own(user, report.worker_id);
    return camel(report);
  });
  app.get("/api/reports", async (req) => {
    const user = actor(req);
    const args: unknown[] = [];
    let sql = reportQuery;
    const { workerId, reviewMode, workOrderId, taskId } = z
      .object({
        workerId: uuid.optional(),
        workOrderId: uuid.optional(),
        taskId: uuid.optional(),
        reviewMode: z.enum(["manual", "automatic", "pending_auto"]).optional(),
      })
      .parse(req.query);
    if (reviewMode === "manual")
      sql += " AND r.status='complete' AND r.auto_review_status='manual'";
    if (reviewMode === "automatic")
      sql += " AND r.status='approved' AND r.approval_mode='automatic'";
    if (reviewMode === "pending_auto")
      sql += " AND r.status='complete' AND r.auto_review_status='pending'";
    if (user.role === "operator" || workerId) {
      args.push(user.role === "operator" ? user.id : workerId);
      sql += " AND r.worker_id=$1";
    }
    if (workOrderId) {
      args.push(workOrderId);
      sql += ` AND r.work_order_id=$${args.length}`;
    }
    if (taskId) {
      args.push(taskId);
      sql += ` AND r.task_id=$${args.length}`;
    }
    return list(
      pool,
      sql,
      args,
      req.query,
      ["u.name", "w.code", "p.name"],
      "r.status",
    );
  });
  app.get("/api/scraps", async (req) => {
    const { workOrderId, reportId, responsibleReportId } = z
      .object({
        workOrderId: uuid.optional(),
        reportId: uuid.optional(),
        responsibleReportId: uuid.optional(),
      })
      .parse(req.query);
    return list(
      pool,
      "SELECT s.*,w.code AS work_order_code,p.name AS product_name,u.name AS reported_by_name,coalesce(d.name,u.name) AS discovery_worker_name FROM scraps s JOIN work_orders w ON w.id=s.work_order_id JOIN products p ON p.id=w.product_id JOIN users u ON u.id=s.reported_by LEFT JOIN reports r ON r.id=s.report_id LEFT JOIN users d ON d.id=r.worker_id WHERE ($1::uuid IS NULL OR s.work_order_id=$1) AND ($2::uuid IS NULL OR s.report_id=$2) AND ($3::uuid IS NULL OR s.responsible_report_id=$3)",
      [workOrderId ?? null, reportId ?? null, responsibleReportId ?? null],
      req.query,
      ["w.code", "p.name", "s.reason"],
      "s.status",
    );
  });
  app.post("/api/scraps", async (req) => {
    const user = actor(req, "operator", "quality", "manager");
    const input = z
      .object({
        workOrderId: uuid,
        taskId: uuid.nullish(),
        reportId: uuid.nullish(),
        quantity,
        reason: z.string().trim().min(1).max(1000),
        responsibleUserId: uuid.nullish(),
        responsibleReportId: uuid.nullish(),
        scrapTypeId: uuid.nullish(),
        requestId,
      })
      .strict()
      .parse(req.body);
    return transaction(pool, (db) =>
      idempotent(
        db,
        user.id,
        "scrap:create",
        input.requestId,
        input,
        async () => {
          const w = await one(
            db,
            "SELECT * FROM work_orders WHERE id=$1 FOR UPDATE",
            [input.workOrderId],
          );
          ensure(w.status !== "closed", "工单已关闭");
          ensure(input.quantity <= w.good_quantity, "报废数量超出剩余良品");
          if (input.taskId)
            await one(
              db,
              "SELECT id FROM tasks WHERE id=$1 AND work_order_id=$2",
              [input.taskId, w.id],
              "工序不属于该工单",
            );
          if (input.reportId) {
            const r = await one(
              db,
              "SELECT * FROM reports WHERE id=$1 AND work_order_id=$2",
              [input.reportId, w.id],
              "报工不属于该工单",
            );
            ensure(
              !input.taskId || input.taskId === r.task_id,
              "报工与工序不匹配",
            );
            own(user, r.worker_id);
          }
          if (user.role === "operator")
            ensure(
              (
                await db.query(
                  "SELECT 1 FROM reports WHERE work_order_id=$1 AND worker_id=$2",
                  [w.id, user.id],
                )
              ).rowCount,
              "只能报告参与过的工单",
              403,
              "FORBIDDEN",
            );
          if (input.responsibleUserId)
            await one(
              db,
              "SELECT id FROM users WHERE id=$1 AND active",
              [input.responsibleUserId],
              "责任人不存在",
            );
          const sid = id();
          let result = await one(
            db,
            "INSERT INTO scraps(id,work_order_id,task_id,report_id,quantity,reason,responsible_user_id,reported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
            [
              sid,
              w.id,
              input.taskId ?? null,
              input.reportId ?? null,
              input.quantity,
              input.reason,
              input.responsibleUserId ?? null,
              user.id,
            ],
          );
          let deduction = 0,
            reward = 0,
            deductible = false;
          if (input.scrapTypeId) {
            const type = await one(
              db,
              "SELECT * FROM scrap_types WHERE id=$1 AND active FOR SHARE",
              [input.scrapTypeId],
              "报废类型不存在或已停用",
            );
            deductible = type.deductible;
          }
          if (input.responsibleReportId) {
            const responsible = await one(
              db,
              "SELECT r.*,t.production FROM reports r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1 AND r.work_order_id=$2",
              [input.responsibleReportId, w.id],
              "责任报工不属于该工单",
            );
            ensure(
              !input.responsibleUserId ||
                input.responsibleUserId === responsible.worker_id,
              "责任人与责任报工不匹配",
            );
            result.responsible_user_id = responsible.worker_id;
            deduction = deductible
              ? Number(responsible.production.deductionUnitPrice ?? 0)
              : 0;
            if (input.reportId && responsible.worker_id !== user.id) {
              const reporter = await one(
                db,
                "SELECT r.*,t.production FROM reports r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1",
                [input.reportId],
              );
              own(user, reporter.worker_id);
              reward =
                deductible && reporter.worker_id !== responsible.worker_id
                  ? Number(reporter.production.rewardUnitPrice ?? 0)
                  : 0;
            }
          }
          result = await one(
            db,
            "UPDATE scraps SET scrap_type_id=$2,responsible_report_id=$3,responsible_user_id=$4,deductible=$5,deduction_unit_price=$6,reward_unit_price=$7 WHERE id=$1 RETURNING *",
            [
              sid,
              input.scrapTypeId ?? null,
              input.responsibleReportId ?? null,
              result.responsible_user_id,
              deductible,
              deduction,
              reward,
            ],
          );
          const rules = (
            await db.query(
              "SELECT * FROM production_settings WHERE id=true FOR SHARE",
            )
          ).rows[0];
          const self =
            !!input.reportId &&
            input.reportId === input.responsibleReportId &&
            result.responsible_user_id === user.id;
          if (
            rules?.scrap_auto_review &&
            self &&
            deductible &&
            deduction > 0 &&
            deduction * input.quantity <= rules.scrap_max_amount
          ) {
            result = await approveScrap(db, w, result, {
              actorId: null,
              mode: "automatic",
              deductionUnitPrice: deduction,
              rewardUnitPrice: 0,
            });
          } else {
            result = await one(
              db,
              "UPDATE scraps SET auto_review_reason=$2 WHERE id=$1 RETURNING *",
              [
                sid,
                !rules?.scrap_auto_review
                  ? "报废自动审核已停用"
                  : !self
                    ? "非本人同一报工的责任报废，需要人工审核"
                    : !deductible || deduction <= 0
                      ? "未配置责任扣款，需要人工审核"
                      : "报废扣款超过自动审核上限",
              ],
            );
          }
          await audit(db, user.id, "create", "scraps", sid, input);
          return camel(result);
        },
      ),
    );
  });
  for (const action of ["approve", "reject"] as const)
    app.post(`/api/scraps/:id/${action}`, async (req) => {
      const user = actor(req, "manager", "quality");
      const sid = uuid.parse((req.params as any).id);
      const input = z
        .object({
          requestId,
          reason: z.string().max(1000).optional(),
          deductionUnitPrice: z.number().nonnegative().max(100000).optional(),
          rewardUnitPrice: z.number().nonnegative().max(100000).optional(),
          responsibleReportId: uuid.nullish(),
        })
        .strict()
        .parse(req.body);
      if (input.deductionUnitPrice || input.rewardUnitPrice)
        ensure(
          hasPermission(user, "scraps:approve", ["manager"]),
          "只有主管可以确认报废奖扣金额",
          403,
          "FORBIDDEN",
        );
      return transaction(pool, (db) =>
        idempotent(
          db,
          user.id,
          `${action}:scrap:${sid}`,
          input.requestId,
          input,
          async () => {
            const ref = await one(
              db,
              "SELECT work_order_id FROM scraps WHERE id=$1",
              [sid],
            );
            const w = await one(
              db,
              "SELECT * FROM work_orders WHERE id=$1 FOR UPDATE",
              [ref.work_order_id],
            );
            const s = await one(
              db,
              "SELECT * FROM scraps WHERE id=$1 FOR UPDATE",
              [sid],
            );
            ensure(s.status === "pending", "报废已被处理");
            if (action === "approve") {
              return camel(
                await approveScrap(db, w, s, {
                  actorId: user.id,
                  mode: "manual",
                  deductionUnitPrice:
                    input.deductionUnitPrice ?? s.deduction_unit_price,
                  rewardUnitPrice: input.rewardUnitPrice ?? s.reward_unit_price,
                  responsibleReportId: input.responsibleReportId,
                }),
              );
            } else
              ensure(
                input.reason?.trim(),
                "驳回必须填写原因",
                400,
                "VALIDATION",
              );
            const result = await one(
              db,
              "UPDATE scraps SET status=$2,approved_by=$3,approved_at=now(),rejection_reason=$4 WHERE id=$1 RETURNING *",
              [sid, "rejected", user.id, input.reason ?? null],
            );
            await audit(db, user.id, action, "scraps", sid, input);
            return camel(result);
          },
        ),
      );
    });
  app.get("/api/inventory", async (req) =>
    list(
      pool,
      `SELECT b.*,p.name AS product_name,p.code AS product_code,p.unit,p.safety_stock,s.code AS sales_order_code,p.created_at AS created_at,COALESCE(w.produced_quantity,0)::integer AS produced_quantity,GREATEST(COALESCE(w.produced_quantity,0)-b.in_quantity,0)::integer AS available_to_receive FROM stock_balances b JOIN products p ON p.id=b.product_id LEFT JOIN sales_orders s ON s.id=b.sales_order_id LEFT JOIN LATERAL(SELECT sum(good_quantity) AS produced_quantity FROM work_orders WHERE product_id=b.product_id AND sales_order_id IS NOT DISTINCT FROM b.sales_order_id AND status='complete') w ON true WHERE true`,
      [],
      req.query,
      ["p.name", "p.code", "s.code"],
    ),
  );
  app.get("/api/stock-movements", async (req) =>
    list(
      pool,
      "SELECT m.*,p.name AS product_name,s.code AS sales_order_code,u.name AS creator_name FROM stock_movements m JOIN products p ON p.id=m.product_id LEFT JOIN sales_orders s ON s.id=m.sales_order_id JOIN users u ON u.id=m.created_by WHERE true",
      [],
      req.query,
      ["p.name", "s.code"],
    ),
  );
  app.post("/api/stock-movements", async (req) => {
    const user = actor(req, "manager", "warehouse");
    const input = z
      .object({
        productId: uuid,
        salesOrderId: uuid.nullish(),
        direction: z.enum(["in", "out"]),
        quantity,
        reason: notes,
        requestId,
      })
      .strict()
      .parse(req.body);
    return transaction(pool, (db) =>
      idempotent(db, user.id, "stock", input.requestId, input, async () => {
        await one(db, "SELECT id FROM products WHERE id=$1 AND active", [
          input.productId,
        ]);
        if (input.salesOrderId)
          await one(
            db,
            "SELECT id FROM sales_order_items WHERE sales_order_id=$1 AND product_id=$2",
            [input.salesOrderId, input.productId],
            "订单中不存在此产品",
          );
        const b = await balanceLock(
          db,
          input.productId,
          input.salesOrderId ?? null,
        );
        if (input.direction === "in") {
          const available =
            (await produced(db, input.productId, input.salesOrderId ?? null)) -
            b.in_quantity;
          ensure(
            input.quantity <= available,
            `入库超出已完工可入库量 ${available}`,
          );
          await db.query(
            "UPDATE stock_balances SET in_quantity=in_quantity+$2 WHERE id=$1",
            [b.id, input.quantity],
          );
        } else {
          ensure(input.quantity <= b.quantity, "出库数量超出当前订单产品库存");
          await db.query(
            "UPDATE stock_balances SET out_quantity=out_quantity+$2 WHERE id=$1",
            [b.id, input.quantity],
          );
        }
        const mid = id();
        const result = await one(
          db,
          "INSERT INTO stock_movements(id,product_id,sales_order_id,direction,quantity,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            mid,
            input.productId,
            input.salesOrderId ?? null,
            input.direction,
            input.quantity,
            input.reason,
            user.id,
          ],
        );
        await audit(
          db,
          user.id,
          input.direction,
          "stock-movements",
          mid,
          input,
        );
        return camel(result);
      }),
    );
  });
  app.get("/api/payroll", async (req) => {
    const user = actor(req, "manager", "operator");
    const params = z
      .object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
        userId: uuid.optional(),
      })
      .parse(req.query);
    const args: unknown[] = [];
    let sql =
      "SELECT p.*,u.name AS worker_name FROM payroll p JOIN users u ON u.id=p.worker_id WHERE true";
    if (user.role === "operator" || params.userId) {
      args.push(user.role === "operator" ? user.id : params.userId);
      sql += ` AND p.worker_id=$${args.length}`;
    }
    if (params.month) {
      args.push(params.month);
      sql += ` AND to_char(p.work_date,'YYYY-MM')=$${args.length}`;
    }
    return list(pool, sql, args, req.query, ["u.name"]);
  });
}
