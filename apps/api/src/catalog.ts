import {
  resourceDefinitions,
  resourceMap,
  type ResourceDefinition,
} from "@mes/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { actor, hasPermission, type Actor } from "./auth.js";
import { audit, camel, ensure, id, one, transaction, type DB } from "./db.js";
import { date, list, uuid } from "./query.js";
import { code } from "./production.js";
import { validateCatalogData as validateData } from "./catalog-validation.js";
import {
  registerManagement,
  managementTransition,
  calculateCatalogData,
  managementEvent,
  type AndonNotifier,
  configuredAndonNotifier,
} from "./management-parity.js";
import { guardStationCatalogUpdate } from "./production-parity.js";
const feedbackFields: Record<string, string> = {
  "work-tasks": "result",
  "andon-events": "resolution",
};
function definition(key: string) {
  const def = resourceMap[key];
  ensure(def, "未知台账", 404, "NOT_FOUND");
  return def;
}
async function reserveDeviceIdentity(
  db: DB,
  key: string,
  rid: string,
  recordCode: string,
  data: Record<string, unknown>,
) {
  if (key !== "devices") return;
  await db.query("SELECT pg_advisory_xact_lock(72811402)");
  const identifiers = [recordCode, data.deviceNo].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const result = await db.query(
    "SELECT id FROM records WHERE resource='devices' AND id<>$1 AND (code=ANY($2::text[]) OR data->>'deviceNo'=ANY($2::text[]))",
    [rid, identifiers],
  );
  ensure(!result.rowCount, "设备编码或采集编号已由其他设备使用");
}
async function saveRefs(
  db: DB,
  rid: string,
  refs: {
    field: string;
    target: string;
  }[],
) {
  await db.query("DELETE FROM record_references WHERE record_id=$1", [rid]);
  for (const r of refs)
    await db.query(
      "INSERT INTO record_references(record_id,field,target_id) VALUES($1,$2,$3)",
      [rid, r.field, r.target],
    );
}
async function onApprove(db: DB, r: any) {
  const d = r.data;
  const materialKey = ["purchase-receipts", "purchase-issues"].includes(
    r.resource,
  )
    ? "materialId"
    : ["auxiliary-receipts", "auxiliary-issues"].includes(r.resource)
      ? "auxiliaryMaterialId"
      : null;
  if (materialKey) {
    const material = d[materialKey];
    const qty = Number(d.quantity);
    const inbound = ["purchase-receipts", "auxiliary-receipts"].includes(
      r.resource,
    );
    if (r.resource === "purchase-receipts" && d.purchaseOrderId) {
      const po = await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource='purchase-orders' FOR UPDATE",
        [d.purchaseOrderId],
      );
      ensure(po.status === "approved", "采购申请尚未审批");
      const line = po.data.items?.length
        ? po.data.items.find((x: any) => x.materialId === material)
        : po.data;
      ensure(line?.materialId === material, "入库物料与采购申请不匹配");
      const already = Number(
        (
          await db.query(
            "SELECT coalesce(sum((data->>'quantity')::numeric),0) AS n FROM records WHERE resource='purchase-receipts' AND status IN ('approved','archived') AND coalesce(stage,'')<>'reversed' AND data->>'purchaseOrderId'=$1 AND data->>'materialId'=$2",
            [po.id, material],
          )
        ).rows[0].n,
      );
      ensure(already + qty <= Number(line.quantity), "入库数量超出采购申请");
    }
    await db.query(
      "INSERT INTO material_balances(material_id) VALUES($1) ON CONFLICT DO NOTHING",
      [material],
    );
    const b = await one(
      db,
      "SELECT * FROM material_balances WHERE material_id=$1 FOR UPDATE",
      [material],
    );
    if (!inbound) ensure(qty <= b.quantity, "领用数量超出可用库存");
    await db.query(
      `UPDATE material_balances SET ${inbound ? "in_quantity" : "out_quantity"}=${inbound ? "in_quantity" : "out_quantity"}+$2 WHERE material_id=$1`,
      [material, qty],
    );
    if (r.resource === "auxiliary-receipts") {
      await db.query(
        "UPDATE records SET data=data||jsonb_build_object('averageUnitPrice',round(($2::numeric*coalesce((data->>'averageUnitPrice')::numeric,0)+$3::numeric*$4::numeric)/($2::numeric+$3::numeric),4)),revision=revision+1,updated_at=now() WHERE id=$1",
        [material, b.quantity, qty, d.unitPrice ?? 0],
      );
    }
    await db.query(
      "INSERT INTO material_movements(id,material_id,source_id,direction,quantity) VALUES($1,$2,$3,$4,$5)",
      [id(), material, r.id, inbound ? "in" : "out", qty],
    );
  }
  if (r.resource === "reimbursements") {
    const purchases = [
      ...new Set<string>([
        ...(d.purchaseOrderIds ?? []),
        ...(d.purchaseOrderId ? [d.purchaseOrderId] : []),
      ]),
    ].sort();
    let total = 0;
    for (const pid of purchases) {
      const po = await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource='purchase-orders' FOR UPDATE",
        [pid],
      );
      ensure(["approved", "archived"].includes(po.status), "报销采购尚未批准");
      const claimed = await db.query(
        "SELECT id FROM records WHERE resource='reimbursements' AND id<>$1 AND status IN ('approved','archived') AND (data->>'purchaseOrderId'=$2 OR (data->'purchaseOrderIds') ? $2)",
        [r.id, pid],
      );
      ensure(!claimed.rowCount, "采购已被其他报销单使用");
      total += Number(
        (
          await db.query(
            "SELECT coalesce(sum(amount),0) AS amount FROM purchase_payments WHERE purchase_id=$1 AND status='paid'",
            [pid],
          )
        ).rows[0].amount,
      );
    }
    if (purchases.length)
      ensure(Number(d.amount) <= total, "报销金额不能超过关联采购已付金额");
  }
  if (r.resource === "work-hours") {
    const qty = Number(d.hours),
      price = Number(d.hourlyRate);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `hours:${d.userId}:${d.workDate}`,
    ]);
    const used = Number(
      (
        await db.query(
          "SELECT coalesce(sum(quantity),0) AS n FROM payroll WHERE worker_id=$1 AND work_date=$2 AND source_type='hours'",
          [d.userId, d.workDate],
        )
      ).rows[0].n,
    );
    ensure(used + qty <= 24, "该人员当天累计计时工时超过24小时");
    await db.query(
      "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date) VALUES($1,$2,'hours',$3,$4,$5,round($4::numeric*$5::numeric,2),$6)",
      [id(), d.userId, r.id, qty, price, d.workDate],
    );
  }
  if (r.resource === "safety-penalties") {
    await db.query(
      "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date) VALUES($1,$2,$3,$4,1,$5,$6,current_date)",
      [
        id(),
        d.userId,
        d.kind,
        r.id,
        Number(d.amount),
        d.kind === "penalty" ? -Number(d.amount) : Number(d.amount),
      ],
    );
  }
  if (r.resource === "mold-maintenance" && d.usedCount !== undefined) {
    const mold = await one(
      db,
      "SELECT * FROM records WHERE id=$1 AND resource='molds' FOR UPDATE",
      [d.moldId],
    );
    ensure(
      Number(d.usedCount) >= Number(mold.data.usedCount ?? 0) &&
        (!mold.data.lifeLimit ||
          Number(d.usedCount) <= Number(mold.data.lifeLimit)),
      "累计使用次数不能减少",
    );
    await db.query(
      "UPDATE records SET data=jsonb_set(data,'{usedCount}',to_jsonb($2::numeric)),revision=revision+1,updated_at=now() WHERE id=$1",
      [mold.id, d.usedCount],
    );
  }
}
export function registerCatalog(
  app: FastifyInstance,
  pool: pg.Pool,
  options: { andonNotifier?: AndonNotifier } = {},
) {
  registerManagement(
    app,
    pool,
    options.andonNotifier ?? configuredAndonNotifier(),
  );
  app.get("/api/catalog", async () => resourceDefinitions);
  app.get("/api/resources/:key", async (req) => {
    const def = definition((req.params as any).key);
    const user = actor(req);
    const sensitive = [
      "work-hours",
      "work-hour-orders",
      "safety-penalties",
      "quality-rewards",
    ].includes(def.key);
    if (sensitive)
      actor(
        req,
        "manager",
        "operator",
        ...(def.key === "quality-rewards" ? ["quality" as const] : []),
      );
    const ownOnly =
      sensitive &&
      !hasPermission(user, `resources:${def.key}:approve`, [
        "admin",
        "manager",
      ]);
    const query = req.query as Record<string, unknown>;
    const args: unknown[] = ownOnly ? [def.key, user.id] : [def.key];
    let extra = ownOnly ? " AND r.data->>'userId'=$2" : "";
    for (const f of def.fields.filter((f) =>
      ["reference", "select"].includes(f.type),
    ))
      if (query[f.key]) {
        const value =
          f.type === "reference"
            ? uuid.parse(query[f.key])
            : z.string().max(100).parse(query[f.key]);
        args.push(f.key, value);
        extra += ` AND r.data->>$${args.length - 1}=$${args.length}`;
      }
    if (query.code) {
      args.push(z.string().max(80).parse(query.code));
      extra += ` AND r.code=$${args.length}`;
    }
    if (query.createdBy) {
      args.push(uuid.parse(query.createdBy));
      extra += ` AND r.created_by=$${args.length}`;
    }
    if (def.key === "purchase-orders" && query.unreimbursed === "true") {
      extra +=
        " AND r.stage IN ('paid','part-paid') AND NOT EXISTS(SELECT 1 FROM record_references ref JOIN records reimbursement ON reimbursement.id=ref.record_id WHERE ref.target_id=r.id AND reimbursement.resource='reimbursements' AND reimbursement.status IN ('approved','archived'))";
      if (
        !hasPermission(user, `resources:${def.key}:approve`, [
          "admin",
          "manager",
        ])
      ) {
        args.push(user.id);
        extra += ` AND r.created_by=$${args.length}`;
      }
    }
    if (def.key === "purchase-orders" && query.reimbursementId) {
      args.push(uuid.parse(query.reimbursementId));
      extra += ` AND EXISTS(SELECT 1 FROM record_references ref WHERE ref.target_id=r.id AND ref.record_id=$${args.length})`;
    }
    if (query.relatedTo) {
      args.push(uuid.parse(query.relatedTo));
      extra += ` AND EXISTS(SELECT 1 FROM record_references refs WHERE refs.record_id=r.id AND refs.target_id=$${args.length})`;
    }
    return list(
      pool,
      "SELECT r.*,b.quantity AS current_stock FROM records r LEFT JOIN material_balances b ON b.material_id=r.id WHERE r.resource=$1" +
        extra,
      args,
      req.query,
      ["r.name", "r.code"],
      "r.status",
    );
  });
  app.get("/api/resources/:key/:id", async (req) => {
    const def = definition((req.params as any).key);
    const user = actor(req);
    const sensitive = [
      "work-hours",
      "work-hour-orders",
      "safety-penalties",
      "quality-rewards",
    ].includes(def.key);
    if (sensitive)
      actor(
        req,
        "manager",
        "operator",
        ...(def.key === "quality-rewards" ? ["quality" as const] : []),
      );
    const row = await one(
      pool,
      "SELECT r.*,b.quantity AS current_stock FROM records r LEFT JOIN material_balances b ON b.material_id=r.id WHERE r.resource=$1 AND r.id=$2",
      [def.key, uuid.parse((req.params as any).id)],
    );
    if (
      sensitive &&
      !hasPermission(user, `resources:${def.key}:approve`, ["admin", "manager"])
    )
      ensure(
        row.data.userId === user.id,
        "只能查看自己的工时和奖惩",
        403,
        "FORBIDDEN",
      );
    return camel(row);
  });
  const createSchema = z
    .object({
      name: z.string().trim().min(1).max(200),
      code: z.string().trim().min(1).max(80).optional(),
      data: z.record(z.unknown()).default({}),
    })
    .strict();
  app.post("/api/resources/:key", async (req) => {
    const def = definition((req.params as any).key);
    const user = actor(req, ...def.writeRoles);
    const input = createSchema.parse(req.body);
    return transaction(pool, async (db) => {
      const rid = id();
      const refs = await validateData(db, def, input.data, rid, user);
      const recordCode = input.code ?? code(def.key.slice(0, 3).toUpperCase());
      await reserveDeviceIdentity(db, def.key, rid, recordCode, input.data);
      await calculateCatalogData(db, def.key, input.data);
      const r = await one(
        db,
        "INSERT INTO records(id,resource,code,name,status,data,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          rid,
          def.key,
          recordCode,
          input.name,
          def.workflow ? "draft" : "active",
          JSON.stringify(input.data),
          user.id,
        ],
      );
      await saveRefs(db, rid, refs);
      await audit(db, user.id, "create", def.key, rid);
      return camel(r);
    });
  });
  app.patch("/api/resources/:key/:id", async (req) => {
    const def = definition((req.params as any).key);
    const user = actor(req, ...def.writeRoles);
    const rid = uuid.parse((req.params as any).id);
    const input = createSchema
      .extend({ revision: z.number().int().positive() })
      .parse(req.body);
    return transaction(pool, async (db) => {
      const r = await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource=$2 FOR UPDATE",
        [rid, def.key],
      );
      ensure(r.revision === input.revision, "记录已被其他人修改，请刷新");
      ensure(
        ["draft", "rejected", "active"].includes(r.status),
        "已提交或审批的记录不可修改",
      );
      if (
        user.role === "operator" &&
        !hasPermission(user, `resources:${def.key}:approve`, [
          "admin",
          "manager",
        ])
      )
        ensure(
          r.created_by === user.id,
          "只能修改自己的台账",
          403,
          "FORBIDDEN",
        );
      for (const f of def.fields.filter((f) => f.readOnly))
        if (input.data[f.key] === undefined && r.data[f.key] !== undefined)
          input.data[f.key] = r.data[f.key];
      const refs = await validateData(db, def, input.data, rid, user, r.data);
      if (def.key === "workstations")
        await guardStationCatalogUpdate(db, r, input.data, r.status);
      await reserveDeviceIdentity(
        db,
        def.key,
        rid,
        input.code ?? r.code,
        input.data,
      );
      await calculateCatalogData(db, def.key, input.data);
      const result = await one(
        db,
        "UPDATE records SET name=$2,code=$3,data=$4,feedback_by=null,feedback_at=null,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
        [rid, input.name, input.code ?? r.code, JSON.stringify(input.data)],
      );
      await saveRefs(db, rid, refs);
      await audit(db, user.id, "update", def.key, rid, {
        revision: input.revision,
      });
      return camel(result);
    });
  });
  app.delete("/api/resources/:key/:id", async (req) => {
    const def = definition((req.params as any).key);
    const user = actor(req, ...def.writeRoles);
    const rid = uuid.parse((req.params as any).id);
    const input = z
      .object({ revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const r = await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource=$2 FOR UPDATE",
        [rid, def.key],
      );
      ensure(r.revision === input.revision, "记录已被修改，请刷新");
      ensure(
        ["draft", "rejected", "active"].includes(r.status),
        "已审批或归档记录不可删除",
      );
      if (
        user.role === "operator" &&
        !hasPermission(user, `resources:${def.key}:approve`, [
          "admin",
          "manager",
        ])
      )
        ensure(
          r.created_by === user.id,
          "只能删除自己的台账",
          403,
          "FORBIDDEN",
        );
      if (def.key === "workstations")
        await guardStationCatalogUpdate(db, r, r.data, "archived");
      const history = await db.query(
        "SELECT id FROM management_events WHERE record_id=$1 AND kind NOT IN ('submit','reject') LIMIT 1",
        [rid],
      );
      ensure(!history.rowCount, "已有办理记录，请归档以保留历史");
      await db.query("DELETE FROM records WHERE id=$1", [rid]);
      await audit(db, user.id, "delete", def.key, rid, { name: r.name });
      return { ok: true };
    });
  });
  app.post("/api/resources/:key/:id/feedback", async (req) => {
    const def = definition((req.params as any).key);
    const user = actor(req);
    const field = feedbackFields[def.key];
    ensure(field, "此台账不支持执行反馈", 400, "VALIDATION");
    const rid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        revision: z.number().int().positive(),
        feedback: z.string().trim().min(1).max(10000),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const r = await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource=$2 FOR UPDATE",
        [rid, def.key],
      );
      ensure(
        hasPermission(user, `resources:${def.key}:write`, [
          "admin",
          "manager",
        ]) || r.data.assigneeId === user.id,
        "只有受派人或主管可以填写执行反馈",
        403,
        "FORBIDDEN",
      );
      ensure(r.revision === input.revision, "记录已被修改，请刷新");
      ensure(r.status === "submitted", "只有已提交且尚未审批的记录可以反馈");
      const updated = await one(
        db,
        "UPDATE records SET data=jsonb_set(data,$2::text[],to_jsonb($3::text)),feedback_by=$4,feedback_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
        [rid, [field], input.feedback, user.id],
      );
      await managementEvent(
        db,
        r,
        user,
        "feedback",
        {
          feedback: input.feedback,
        },
        false,
      );
      await audit(db, user.id, "feedback", def.key, rid, {
        field,
        feedback: input.feedback,
        revision: input.revision,
      });
      return camel(updated);
    });
  });
  app.post("/api/resources/:key/:id/transition", async (req) => {
    const def = definition((req.params as any).key);
    const user = actor(req, ...def.writeRoles);
    const rid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        action: z.enum(["submit", "approve", "reject", "archive", "restore"]),
        revision: z.number().int().positive(),
        notes: z.string().max(2000).optional(),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const r = await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource=$2 FOR UPDATE",
        [rid, def.key],
      );
      ensure(r.revision === input.revision, "记录已被修改，请刷新");
      let next = "";
      switch (input.action) {
        case "submit":
          ensure(
            def.workflow && ["draft", "rejected"].includes(r.status),
            "当前状态不可提交",
          );
          if (
            user.role === "operator" &&
            !hasPermission(user, `resources:${def.key}:approve`, [
              "admin",
              "manager",
            ])
          )
            ensure(
              r.created_by === user.id,
              "只能提交自己的记录",
              403,
              "FORBIDDEN",
            );
          next = "submitted";
          break;
        case "approve":
        case "reject":
          ensure(
            def.workflow && r.status === "submitted",
            "仅可审核已提交记录",
          );
          ensure(
            hasPermission(user, `resources:${def.key}:approve`, [
              "admin",
              ...(def.key === "app-versions" ? [] : ["manager" as const]),
              ...([
                "inspections",
                "incoming-inspections",
                "quality-rewards",
              ].includes(def.key)
                ? ["quality" as const]
                : []),
            ]) ||
              (def.workflowKind === "checklist" &&
                r.workflow_data.checkerIds?.includes(user.id) &&
                hasPermission(user, `resources:${def.key}:approve`)),
            "没有台账审核权限",
            403,
            "FORBIDDEN",
          );
          if (input.action === "reject")
            ensure(input.notes?.trim(), "驳回必须填写原因", 400, "VALIDATION");
          next = input.action === "approve" ? "approved" : "rejected";
          if (input.action === "approve") {
            const feedbackField = feedbackFields[def.key];
            if (feedbackField && def.workflowKind !== "task")
              ensure(
                r.feedback_at &&
                  r.feedback_by &&
                  typeof r.data[feedbackField] === "string" &&
                  r.data[feedbackField].trim(),
                "请先由受派人或主管填写执行反馈，再审核闭环",
              );
            await validateData(db, def, r.data, r.id, user, r.data);
            await onApprove(db, r);
          }
          break;
        case "archive":
          ensure(
            hasPermission(user, `resources:${def.key}:write`, [
              "admin",
              "manager",
            ]),
            "没有归档权限",
            403,
            "FORBIDDEN",
          );
          ensure(["approved", "active"].includes(r.status), "当前记录不可归档");
          next = "archived";
          break;
        case "restore":
          ensure(
            !def.workflow && r.status === "archived",
            "仅基础资料可以恢复启用",
          );
          ensure(
            hasPermission(user, `resources:${def.key}:write`, [
              "admin",
              "manager",
            ]),
            "没有恢复权限",
            403,
            "FORBIDDEN",
          );
          next = "active";
          break;
      }
      if (def.key === "workstations")
        await guardStationCatalogUpdate(db, r, r.data, next);
      await managementTransition(db, r, def, input.action, user);
      const updated = await one(
        db,
        "UPDATE records SET status=$2,feedback_by=CASE WHEN $3 THEN NULL ELSE feedback_by END,feedback_at=CASE WHEN $3 THEN NULL ELSE feedback_at END,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
        [rid, next, input.action === "submit"],
      );
      await audit(db, user.id, input.action, def.key, rid, {
        notes: input.notes,
      });
      return camel(updated);
    });
  });
  app.get("/api/material-inventory", async (req) =>
    list(
      pool,
      "SELECT b.*,r.name,r.resource,r.code,r.data,r.created_at FROM material_balances b JOIN records r ON r.id=b.material_id WHERE true",
      [],
      req.query,
      ["r.name", "r.code"],
    ),
  );
}
