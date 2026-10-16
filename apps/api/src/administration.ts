import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { actor, hasPermission } from "./auth.js";
import {
  audit,
  camel,
  ensure,
  id,
  idempotent,
  one,
  transaction,
} from "./db.js";

export function registerAdministration(app: FastifyInstance, pool: pg.Pool) {
  app.get("/api/android/latest", async () => {
    const result = await pool.query(
      "SELECT data FROM records WHERE resource='app-versions' AND status='approved' ORDER BY (data->>'versionCode')::numeric DESC,created_at DESC LIMIT 1",
    );
    if (!result.rowCount) return null;
    const value = result.rows[0].data;
    const parsed = z
      .object({
        versionCode: z.coerce.number().int().positive(),
        versionName: z.string().min(1),
        downloadUrl: z
          .string()
          .url()
          .refine((value) => new URL(value).protocol === "https:"),
        remark: z.string().optional().default(""),
      })
      .safeParse(value);
    return parsed.success ? parsed.data : null;
  });
  app.post("/api/payroll/adjustments", async (req) => {
    const user = actor(req, "manager");
    const input = z
      .object({
        requestId: z.string().uuid(),
        workerId: z.string().uuid(),
        quantity: z.number().positive().max(1e8).multipleOf(0.0001),
        unitPrice: z.number().min(-1e8).max(1e8).multipleOf(0.0001),
        workDate: z.string().date(),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict()
      .refine(
        (value) => Math.abs(value.quantity * value.unitPrice) <= 9e13,
        "工资调整金额超出范围",
      )
      .parse(req.body);
    return transaction(pool, (db) =>
      idempotent(
        db,
        user.id,
        "payroll-adjustment",
        input.requestId,
        input,
        async () => {
          await one(
            db,
            "SELECT id FROM users WHERE id=$1",
            [input.workerId],
            "人员不存在",
          );
          const key = id();
          const row = await one(
            db,
            "INSERT INTO payroll_adjustments(id,worker_id,quantity,unit_price,amount,work_date,reason,created_by) VALUES($1,$2,$3,$4,round($3::numeric*$4::numeric,2),$5,$6,$7) RETURNING *",
            [
              key,
              input.workerId,
              input.quantity,
              input.unitPrice,
              input.workDate,
              input.reason,
              user.id,
            ],
          );
          await db.query(
            "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date,description) VALUES($1,$2,'manual-adjustment',$3,$4,$5,$6,$7,$8)",
            [
              id(),
              input.workerId,
              key,
              input.quantity,
              Math.abs(input.unitPrice),
              row.amount,
              input.workDate,
              input.reason,
            ],
          );
          await audit(db, user.id, "adjust", "payroll", key, {
            workerId: input.workerId,
            amount: row.amount,
            reason: input.reason,
          });
          return camel(row);
        },
      ),
    );
  });
  app.get("/api/statistics", async (req) => {
    const user = actor(req, "manager");
    const input = z
      .object({
        from: z.string().date(),
        to: z.string().date(),
        view: z.enum([
          "production",
          "scrap",
          "stock-in",
          "stock-out",
          "products",
          "orders",
          "workers",
          "tasks",
          "procedures",
          "order-items",
        ]),
        productId: z.string().uuid().optional(),
        salesOrderId: z.string().uuid().optional(),
        group: z
          .enum(["procedure", "workstation", "worker", "device"])
          .default("procedure"),
      })
      .parse(req.query);
    ensure(
      input.from <= input.to,
      "开始日期不能晚于结束日期",
      400,
      "VALIDATION",
    );
    const timezone = process.env.FACTORY_TIMEZONE ?? "Asia/Shanghai";
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new Error("Invalid FACTORY_TIMEZONE");
    }
    const args: unknown[] = [input.from, input.to, timezone];
    const queries: Record<typeof input.view, string> = {
      production: `SELECT to_char(timezone($3,r.approved_at),'YYYY-MM-DD') AS label,coalesce(pt.name,t.name) AS detail,p.name AS product_name,u.name AS worker_name,st.name AS workstation_name,sum(r.quantity+r.complete_adjustment) AS quantity,count(*)::int AS records FROM reports r JOIN tasks t ON t.id=r.task_id JOIN work_orders w ON w.id=r.work_order_id JOIN products p ON p.id=w.product_id JOIN users u ON u.id=r.worker_id LEFT JOIN records st ON st.id=r.workstation_id LEFT JOIN procedure_types pt ON pt.id=(t.production->>'procedureTypeId')::uuid WHERE r.status='approved' AND timezone($3,r.approved_at)::date BETWEEN $1::date AND $2::date GROUP BY label,detail,pt.id,p.id,u.id,st.id ORDER BY label DESC,detail,p.name,u.name`,
      scrap: `SELECT to_char(timezone($3,s.approved_at),'YYYY-MM-DD') AS label,p.name AS detail,coalesce(pt.name,t.name) AS procedure_name,u.name AS worker_name,st.name AS scrap_type,sum(s.quantity) AS quantity,count(*)::int AS records FROM scraps s JOIN work_orders w ON w.id=s.work_order_id JOIN products p ON p.id=w.product_id LEFT JOIN reports r ON r.id=s.responsible_report_id LEFT JOIN tasks t ON t.id=coalesce(r.task_id,s.task_id) LEFT JOIN procedure_types pt ON pt.id=(t.production->>'procedureTypeId')::uuid LEFT JOIN users u ON u.id=s.responsible_user_id LEFT JOIN scrap_types st ON st.id=s.scrap_type_id WHERE s.status='approved' AND timezone($3,s.approved_at)::date BETWEEN $1::date AND $2::date GROUP BY label,p.id,procedure_name,pt.id,u.id,st.id ORDER BY label DESC,p.name`,
      "stock-in": `SELECT p.name AS label,p.code AS detail,sum(m.quantity) AS quantity,count(*)::int AS records FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.direction='in' AND timezone($3,m.created_at)::date BETWEEN $1::date AND $2::date GROUP BY p.id ORDER BY p.name`,
      "stock-out": `SELECT p.name AS label,p.code AS detail,sum(m.quantity) AS quantity,count(*)::int AS records FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.direction='out' AND timezone($3,m.created_at)::date BETWEEN $1::date AND $2::date GROUP BY p.id ORDER BY p.name`,
      products: `SELECT p.name AS label,p.code AS detail,sum(w.quantity) AS quantity,sum(CASE WHEN w.status='complete' THEN w.good_quantity ELSE 0 END) AS completed_quantity,count(*)::int AS records FROM work_orders w JOIN products p ON p.id=w.product_id WHERE timezone($3,w.created_at)::date BETWEEN $1::date AND $2::date GROUP BY p.id ORDER BY p.name`,
      orders: `SELECT s.code AS label,c.name AS detail,(SELECT coalesce(sum(i.quantity),0) FROM sales_order_items i WHERE i.sales_order_id=s.id) AS quantity,(SELECT coalesce(sum(w.quantity),0) FROM work_orders w WHERE w.sales_order_id=s.id AND w.status<>'closed') AS planned_quantity,(SELECT coalesce(sum(b.quantity),0) FROM stock_balances b WHERE b.sales_order_id=s.id) AS inventory_quantity,(SELECT coalesce(sum(m.quantity),0) FROM stock_movements m WHERE m.sales_order_id=s.id AND m.direction='out') AS delivered_quantity FROM sales_orders s JOIN records c ON c.id=s.customer_id WHERE timezone($3,s.created_at)::date BETWEEN $1::date AND $2::date ORDER BY s.created_at DESC`,
      workers: `SELECT u.name AS label,p.source_type AS detail,sum(p.quantity) AS quantity,sum(p.amount) AS amount,count(*)::int AS records FROM payroll p JOIN users u ON u.id=p.worker_id WHERE p.work_date BETWEEN $1::date AND $2::date AND $3::text IS NOT NULL GROUP BY u.id,p.source_type ORDER BY u.name,p.source_type`,
      procedures: `SELECT coalesce(pt.id::text,t.name) AS group_id,pt.code AS group_code,coalesce(pt.name,t.name) AS label,'' AS detail,sum(w.quantity) AS quantity,sum(t.completed_quantity) AS completed_quantity,sum(coalesce(s.quantity,0)) AS scrap_quantity,sum(greatest(0,w.good_quantity-t.completed_quantity)) AS pending_quantity,count(*)::int AS records FROM tasks t JOIN work_orders w ON w.id=t.work_order_id LEFT JOIN sales_orders o ON o.id=w.sales_order_id LEFT JOIN procedure_types pt ON pt.id=(t.production->>'procedureTypeId')::uuid LEFT JOIN (SELECT task_id,sum(quantity) AS quantity FROM scraps WHERE status='approved' GROUP BY task_id) s ON s.task_id=t.id WHERE w.status<>'closed' AND (o.id IS NULL OR o.status='open') AND timezone($3,w.created_at)::date BETWEEN $1::date AND $2::date AND ($4::uuid IS NULL OR w.product_id=$4) AND ($5::uuid IS NULL OR w.sales_order_id=$5) GROUP BY label,pt.id,t.name ORDER BY label`,
      "order-items": `SELECT o.code AS label,p.name AS detail,i.quantity,coalesce(w.planned,0) AS planned_quantity,coalesce(w.completed,0) AS completed_quantity,coalesce(w.pending,0) AS pending_quantity,coalesce(w.scrap,0) AS scrap_quantity,coalesce(b.quantity,0) AS inventory_quantity,coalesce(b.in_quantity,0) AS received_quantity,coalesce(b.out_quantity,0) AS delivered_quantity FROM sales_order_items i JOIN sales_orders o ON o.id=i.sales_order_id JOIN products p ON p.id=i.product_id LEFT JOIN (SELECT sales_order_id,product_id,sum(quantity) AS planned,sum(CASE WHEN status='complete' THEN good_quantity ELSE 0 END) AS completed,sum(CASE WHEN status IN ('pending','working') THEN good_quantity ELSE 0 END) AS pending,sum(quantity-good_quantity) AS scrap FROM work_orders WHERE status<>'closed' GROUP BY sales_order_id,product_id) w ON w.sales_order_id=o.id AND w.product_id=p.id LEFT JOIN stock_balances b ON b.sales_order_id=o.id AND b.product_id=p.id WHERE timezone($3,o.created_at)::date BETWEEN $1::date AND $2::date AND ($4::uuid IS NULL OR p.id=$4) AND ($5::uuid IS NULL OR o.id=$5) ORDER BY o.created_at DESC,p.name`,
      tasks: `SELECT t.name AS label,t.status AS detail,count(*)::int AS records,sum(greatest(0,w.good_quantity-t.completed_quantity)) AS quantity FROM tasks t JOIN work_orders w ON w.id=t.work_order_id WHERE t.status<>'complete' AND w.status<>'closed' AND timezone($3,w.created_at)::date BETWEEN $1::date AND $2::date GROUP BY t.name,t.status ORDER BY t.name,t.status`,
    };
    if (input.view === "tasks") {
      const grouping = {
        procedure: {
          join: "LEFT JOIN procedure_types g ON g.id=(t.production->>'procedureTypeId')::uuid",
          label: "coalesce(g.name,t.name)",
        },
        workstation: {
          join: "LEFT JOIN records g ON g.id=t.assigned_station_id",
          label: "coalesce(g.name,'未指定')",
        },
        worker: {
          join: "LEFT JOIN users g ON g.id=t.assigned_worker_id",
          label: "coalesce(g.name,'未指定')",
        },
        device: {
          join: "LEFT JOIN records g ON g.id=t.assigned_device_id",
          label: "coalesce(g.name,'未指定')",
        },
      }[input.group];
      queries.tasks = `SELECT g.id AS group_id,${input.group === "worker" ? "g.username" : "g.code"} AS group_code,${grouping.label} AS label,t.status AS detail,count(*)::int AS records,sum(greatest(0,w.good_quantity-t.completed_quantity)) AS quantity,sum(greatest(0,w.good_quantity-t.completed_quantity)*t.expected_minutes) AS expected_minutes FROM tasks t JOIN work_orders w ON w.id=t.work_order_id ${grouping.join} WHERE t.status<>'complete' AND w.status<>'closed' AND timezone($3,w.created_at)::date BETWEEN $1::date AND $2::date GROUP BY g.id,label,t.status ORDER BY label,t.status`;
    }
    if (["procedures", "order-items"].includes(input.view))
      args.push(input.productId ?? null, input.salesOrderId ?? null);
    const rows = (await pool.query(queries[input.view], args)).rows;
    return {
      items: camel(rows),
      from: input.from,
      to: input.to,
      timezone,
      view: input.view,
    };
  });
  app.get("/api/inventory/alerts", async (req) => {
    actor(req);
    const rows =
      await pool.query(`SELECT p.id,p.code,p.name,p.safety_stock,coalesce(b.quantity,0) AS quantity,
      greatest(0,p.safety_stock-coalesce(b.quantity,0)) AS shortage,
      CASE WHEN coalesce((p.details->>'safetyStockDays')::int,0)>0 THEN greatest(0,coalesce(b.quantity,0)-coalesce((SELECT sum(m.quantity) FROM stock_movements m WHERE m.product_id=p.id AND m.direction='in' AND m.created_at>=now()-make_interval(days=>(p.details->>'safetyStockDays')::int)),0)) ELSE 0 END AS aging_quantity
      FROM products p LEFT JOIN (SELECT product_id,sum(quantity) AS quantity FROM stock_balances GROUP BY product_id) b ON b.product_id=p.id WHERE p.active ORDER BY p.name`);
    return {
      items: camel(
        rows.rows.filter((row) => row.shortage > 0 || row.aging_quantity > 0),
      ),
    };
  });
  app.get("/api/boards", async (req) => {
    const user = actor(req);
    const view = z
      .enum([
        "production",
        "devices",
        "workstations",
        "inventory",
        "materials",
        "inspections",
        "incoming-inspections",
        "device-inspections",
        "quality-summary",
        "production-summary",
        "stock-in",
        "stock-out",
        "material-in",
        "material-out",
      ])
      .parse((req.query as any).view ?? "production");
    const domains: Record<string, string> = {
      production: "work-orders:read",
      devices: "telemetry:read",
      workstations: "resources:workstations:read",
      inventory: "inventory:read",
      materials: "material-inventory:read",
      inspections: "resources:inspections:read",
      "quality-summary": "resources:inspections:read",
      "incoming-inspections": "resources:incoming-inspections:read",
      "device-inspections": "resources:inspection-records:read",
      "production-summary": "work-orders:read",
      "stock-in": "stock-movements:read",
      "stock-out": "stock-movements:read",
      "material-in": "resources:auxiliary-receipts:read",
      "material-out": "resources:auxiliary-issues:read",
    };
    ensure(
      hasPermission(user, domains[view]),
      "没有此操作权限",
      403,
      "FORBIDDEN",
    );
    const queries: Record<string, string> = {
      production:
        "SELECT w.id,w.code,p.name,w.status,w.quantity,w.good_quantity,w.due_date FROM work_orders w JOIN products p ON p.id=w.product_id ORDER BY w.created_at DESC LIMIT 100",
      devices:
        "SELECT r.id,r.code,r.name,coalesce(s.status,'unknown') AS status,s.last_seen_at,r.data->>'deviceNo' AS device_no,r.data->>'lifecycle' AS lifecycle FROM records r LEFT JOIN device_states s ON s.device_id=r.id WHERE r.resource='devices' AND r.status<>'archived' ORDER BY r.name",
      workstations:
        "SELECT r.id,r.code,r.name,coalesce(s.state,'off_duty') AS status,u.name AS worker_name,CASE WHEN s.current_report_id IS NOT NULL THEN 'working' WHEN s.idle_since IS NOT NULL THEN 'no_material' ELSE 'off_duty' END AS activity FROM records r LEFT JOIN station_execution s ON s.station_id=r.id LEFT JOIN users u ON u.id=s.worker_id WHERE r.resource='workstations' ORDER BY r.name LIMIT 100",
      inventory:
        "SELECT p.id,p.code,p.name,coalesce(sum(b.quantity),0) AS quantity,p.safety_stock FROM products p LEFT JOIN stock_balances b ON b.product_id=p.id GROUP BY p.id ORDER BY p.name LIMIT 100",
      materials:
        "SELECT r.id,r.code,r.name,b.quantity,r.data->>'safetyStock' AS safety_stock FROM records r LEFT JOIN material_balances b ON b.material_id=r.id WHERE r.resource IN ('materials','auxiliary-materials') ORDER BY r.name LIMIT 100",
      inspections:
        "SELECT r.id,r.code,r.name,r.status,p.name AS product_name,u.name AS inspector_name,r.data->>'inspectionType' AS inspection_type,r.data->>'result' AS conclusion,r.data->>'sampleQuantity' AS quantity,r.data->>'defectQuantity' AS scrap_quantity,r.created_at FROM records r LEFT JOIN products p ON p.id=(r.data->>'productId')::uuid LEFT JOIN users u ON u.id=(r.data->>'inspectorId')::uuid WHERE r.resource='inspections' ORDER BY r.created_at DESC LIMIT 100",
      "incoming-inspections":
        "SELECT r.id,r.code,r.name,r.status,r.data->>'batchNo' AS batch_no,r.data->>'supplierName' AS supplier_name,r.data->>'result' AS conclusion,r.data->>'quantity' AS quantity,r.created_at FROM records r WHERE r.resource='incoming-inspections' ORDER BY r.created_at DESC LIMIT 100",
      "device-inspections":
        "SELECT r.id,r.code,r.name,r.status,coalesce(r.workflow_data->>'result',r.data->>'result') AS conclusion,r.created_at FROM records r WHERE r.resource='inspection-records' ORDER BY r.created_at DESC LIMIT 100",
      "quality-summary":
        "SELECT coalesce(data->>'inspectionType','unspecified') AS id,coalesce(data->>'inspectionType','unspecified') AS name,count(*)::int AS records,count(*) FILTER(WHERE data->>'result'='pass')::int AS passed,count(*) FILTER(WHERE data->>'result'='fail')::int AS failed,round(100.0*count(*) FILTER(WHERE data->>'result'='pass')/nullif(count(*),0),2) AS pass_rate FROM records WHERE resource='inspections' AND status='approved' GROUP BY data->>'inspectionType' ORDER BY name",
      "production-summary":
        "SELECT coalesce(t.production->>'procedureTypeId',t.name) AS id,coalesce(pt.name,t.name) AS name,count(*)::int AS records,sum(greatest(0,w.good_quantity-t.completed_quantity)) AS quantity,sum(greatest(0,w.good_quantity-t.completed_quantity)*t.expected_minutes) AS expected_minutes FROM tasks t JOIN work_orders w ON w.id=t.work_order_id LEFT JOIN procedure_types pt ON pt.id=(t.production->>'procedureTypeId')::uuid WHERE t.status<>'complete' AND w.status<>'closed' GROUP BY coalesce(t.production->>'procedureTypeId',t.name),pt.name,t.name ORDER BY name",

      "stock-in":
        "SELECT m.id,p.code,p.name,m.quantity,m.created_at FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE direction='in' ORDER BY m.created_at DESC LIMIT 100",
      "stock-out":
        "SELECT m.id,p.code,p.name,m.quantity,m.created_at FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE direction='out' ORDER BY m.created_at DESC LIMIT 100",
      "material-in":
        "SELECT r.id,r.code,r.name,r.status,r.data->>'quantity' AS quantity,r.created_at FROM records r WHERE resource='auxiliary-receipts' ORDER BY r.created_at DESC LIMIT 100",
      "material-out":
        "SELECT r.id,r.code,r.name,r.status,r.data->>'quantity' AS quantity,r.created_at FROM records r WHERE resource='auxiliary-issues' ORDER BY r.created_at DESC LIMIT 100",
    };
    return { items: camel((await pool.query(queries[view])).rows), view };
  });
}
