import { type ResourceDefinition, type FieldDefinition } from "@mes/shared";
import { z } from "zod";
import { type Actor, hasPermission } from "./auth.js";
import { type DB, ensure, one } from "./db.js";
import { date, uuid } from "./query.js";
const core: Record<string, string> = {
  users: "users",
  products: "products",
  "work-orders": "work_orders",
  "sales-orders": "sales_orders",
  reports: "reports",
  "procedure-types": "procedure_types",
};
export async function businessFiles(db: DB, value: unknown) {
  const ids = z
    .array(uuid)
    .max(10)
    .parse(value ?? []);
  ensure(new Set(ids).size === ids.length, "附件不能重复", 400, "VALIDATION");
  if (ids.length) {
    const q = await db.query(
      "SELECT id FROM uploaded_files WHERE id=ANY($1::uuid[]) AND visibility='business' FOR SHARE",
      [ids],
    );
    ensure(
      q.rowCount === ids.length,
      "包含不存在或不可用于业务的附件",
      400,
      "VALIDATION",
    );
  }
  return ids;
}
export async function validateCatalogData(
  db: DB,
  def: ResourceDefinition,
  data: Record<string, unknown>,
  recordId: string,
  user: Actor,
  previous?: Record<string, unknown>,
) {
  const references: { field: string; target: string }[] = [];
  async function validate(
    fields: FieldDefinition[],
    values: Record<string, unknown>,
    prefix = "",
  ) {
    ensure(
      Object.keys(values).every((k) => fields.some((f) => f.key === k)),
      "包含未知字段",
      400,
      "VALIDATION",
    );
    for (const f of fields) {
      const val = values[f.key],
        path = prefix + f.key;
      if (
        f.readOnly &&
        JSON.stringify(val) !== JSON.stringify(previous?.[f.key])
      )
        ensure(false, "系统计算字段不可直接修改", 400, "VALIDATION");
      if (val === undefined || val === null || val === "") {
        ensure(!f.required, `${f.label}不能为空`, 400, "VALIDATION");
        continue;
      }
      switch (f.type) {
        case "number": {
          let s = z
            .number()
            .finite()
            .min(f.min ?? -1000000000)
            .max(f.max ?? 1000000000);
          if (f.integer) s = s.int();
          s.parse(val);
          break;
        }
        case "boolean":
          z.boolean().parse(val);
          break;
        case "select":
          ensure(
            f.options?.some((o) => o.value === val),
            `${f.label}选项无效`,
            400,
            "VALIDATION",
          );
          break;
        case "date":
          date.parse(val);
          break;
        case "datetime":
          z.string().datetime({ offset: true }).parse(val);
          break;
        case "files":
          await businessFiles(db, val);
          break;
        case "rows": {
          const items = z.array(z.record(z.unknown())).max(100).parse(val);
          ensure(
            !f.required || items.length > 0,
            `${f.label}不能为空`,
            400,
            "VALIDATION",
          );
          for (let i = 0; i < items.length; i++)
            await validate(f.fields ?? [], items[i], `${path}.${i}.`);
          break;
        }
        case "reference":
        case "references": {
          const ids =
            f.type === "reference"
              ? [uuid.parse(val)]
              : z.array(uuid).max(100).parse(val);
          ensure(
            new Set(ids).size === ids.length,
            "关联记录不能重复",
            400,
            "VALIDATION",
          );
          for (const target of ids) {
            ensure(target !== recordId, "记录不能引用自身", 400, "VALIDATION");
            const table = core[f.resource ?? ""];
            if (table)
              await one(
                db,
                `SELECT id FROM ${table} WHERE id=$1${table === "users" ? " AND active=true" : ""} FOR SHARE`,
                [target],
                `${f.label}不存在`,
              );
            else {
              await one(
                db,
                "SELECT id FROM records WHERE id=$1 AND resource=$2 AND status<>'archived' FOR SHARE",
                [target, f.resource],
                `${f.label}不存在或已归档`,
              );
              references.push({ field: path, target });
            }
          }
          break;
        }
        default: {
          const text = z
            .string()
            .trim()
            .min(f.required ? 1 : 0)
            .max(f.type === "textarea" ? 10000 : 500)
            .parse(val);
          if (f.format === "https")
            ensure(
              new URL(z.string().url().parse(text)).protocol === "https:",
              "下载地址必须使用 HTTPS",
              400,
              "VALIDATION",
            );
        }
      }
    }
  }
  if (
    def.key === "work-hour-orders" &&
    data.typeId &&
    (data.hourlyRate === undefined || data.hourlyRate === null)
  ) {
    const type = await one(
      db,
      "SELECT data FROM records WHERE id=$1 AND resource='work-hour-types' AND status='active' FOR SHARE",
      [uuid.parse(data.typeId)],
    );
    data.hourlyRate = type.data.hourlyRate;
  }
  await validate(def.fields, data);
  if (
    [
      "purchase-receipts",
      "purchase-issues",
      "auxiliary-receipts",
      "auxiliary-issues",
    ].includes(def.key)
  )
    ensure(Number(data.quantity) > 0, "数量必须大于0", 400, "VALIDATION");
  if (def.key === "purchase-orders") {
    const lines =
      Array.isArray(data.items) && data.items.length
        ? data.items
        : [
            {
              materialId: data.materialId,
              quantity: data.quantity,
              unitPrice: data.unitPrice,
            },
          ];
    ensure(
      lines.every(
        (l) =>
          l.materialId && Number(l.quantity) > 0 && Number(l.unitPrice) >= 0,
      ),
      "采购明细必须包含物料、正数数量和单价",
      400,
      "VALIDATION",
    );
    ensure(
      new Set(lines.map((l) => l.materialId)).size === lines.length,
      "采购明细物料不能重复",
      400,
      "VALIDATION",
    );
  }
  if (def.key === "work-hours") {
    ensure(
      Number(data.hours) > 0 && Number(data.hours) <= 24,
      "每日工时必须大于0且不超过24",
      400,
      "VALIDATION",
    );
  }
  if (
    ["work-hours", "work-hour-orders"].includes(def.key) &&
    !hasPermission(user, `resources:${def.key}:approve`, ["manager"])
  )
    ensure(data.userId === user.id, "只能登记自己的计时工单", 403, "FORBIDDEN");
  if (def.key === "inspections")
    ensure(
      Number(data.defectQuantity) <= Number(data.sampleQuantity),
      "不合格数不能超过抽检数",
      400,
      "VALIDATION",
    );
  if (def.key === "molds" && data.lifeLimit !== undefined)
    ensure(
      Number(data.usedCount ?? 0) <= Number(data.lifeLimit),
      "累计次数超过模具寿命上限",
      400,
      "VALIDATION",
    );
  if (def.key === "departments" && data.parentId) {
    const q = await db.query(
      "WITH RECURSIVE parents AS (SELECT id,data->>'parentId' AS parent FROM records WHERE id=$1 UNION SELECT r.id,r.data->>'parentId' FROM records r JOIN parents p ON r.id::text=p.parent) SELECT id FROM parents WHERE id=$2",
      [data.parentId, recordId],
    );
    ensure(!q.rowCount, "部门层级不能形成循环");
  }
  if (def.key === "work-tasks" && data.subtypeId) {
    const s = await one(db, "SELECT data FROM records WHERE id=$1", [
      data.subtypeId,
    ]);
    ensure(s.data.typeId === data.typeId, "任务子类别与类别不匹配");
  }
  if (
    def.key === "purchase-comparisons" &&
    data.purchaseOrderId &&
    data.materialId
  ) {
    const po = await one(db, "SELECT data FROM records WHERE id=$1", [
      data.purchaseOrderId,
    ]);
    const lines = po.data.items?.length ? po.data.items : [po.data];
    ensure(
      lines.some((l: any) => l.materialId === data.materialId),
      "比价物料不属于关联采购申请",
    );
  }
  if (def.key === "inspections") {
    if (data.reportId) {
      const report = await one(
        db,
        "SELECT r.work_order_id,w.product_id FROM reports r JOIN work_orders w ON w.id=r.work_order_id WHERE r.id=$1",
        [data.reportId],
      );
      ensure(
        !data.workOrderId || data.workOrderId === report.work_order_id,
        "检验报工与工单不匹配",
      );
      ensure(
        !data.productId || data.productId === report.product_id,
        "检验报工与产品不匹配",
      );
    }
    if (data.workOrderId && data.productId) {
      const wo = await one(
        db,
        "SELECT product_id FROM work_orders WHERE id=$1",
        [data.workOrderId],
      );
      ensure(wo.product_id === data.productId, "检验工单与产品不匹配");
    }
  }
  if (def.key === "app-versions") {
    await db.query("SELECT pg_advisory_xact_lock(10162801)");
    const q = await db.query(
      "SELECT id FROM records WHERE resource='app-versions' AND id<>$1 AND data->>'versionCode'=$2",
      [recordId, String(data.versionCode)],
    );
    ensure(!q.rowCount, "版本编号已存在");
  }
  return references;
}
