import type { FastifyInstance } from "fastify";
import type pg from "pg";
import {
  resourceMap,
  type FieldDefinition,
  type ResourceDefinition,
} from "@mes/shared";
import { z } from "zod";
import { actor, hasPermission, type Actor } from "./auth.js";
import { audit, camel, ensure, id, one, transaction, type DB } from "./db.js";
import { uuid, list } from "./query.js";
import { businessFiles } from "./catalog-validation.js";
import { recordDeviceStatus } from "./equipment.js";
const text = (
  key: string,
  label: string,
  required = true,
): FieldDefinition => ({ key, label, type: "textarea", required });
const files: FieldDefinition = {
  key: "attachmentIds",
  label: "附件",
  type: "files",
};
const num = (key: string, label: string, required = true): FieldDefinition => ({
  key,
  label,
  type: "number",
  required,
  min: 0,
});
const dt = (key: string, label: string): FieldDefinition => ({
  key,
  label,
  type: "datetime",
  required: true,
});
export type AndonNotifier = (notification: {
  id: string;
  recordId: string;
  payload: Record<string, unknown>;
}) => Promise<void>;
export function configuredAndonNotifier(): AndonNotifier | undefined {
  const endpoint = process.env.ANDON_WEBHOOK_URL?.trim();
  if (!endpoint) return;
  const url = new URL(endpoint);
  if (url.protocol !== "https:")
    throw new Error("ANDON_WEBHOOK_URL must use HTTPS");
  const token = process.env.ANDON_WEBHOOK_TOKEN;
  return async (notification) => {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": notification.id,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ type: "mes.andon.alarm", ...notification }),
    });
    if (!response.ok)
      throw new Error(`Andon webhook returned HTTP ${response.status}`);
  };
}
/** An adapter must deduplicate by notification.id. No messages leave the process without an explicitly configured adapter. */
export async function dispatchAndonNotifications(
  pool: pg.Pool,
  deliver?: AndonNotifier,
  limit = 20,
) {
  let count = 0;
  for (let i = 0; i < limit; i++) {
    const found = await transaction(pool, async (db) => {
      const q = await db.query(
        "SELECT n.*,r.status AS record_status,r.stage,r.created_by,r.workflow_data FROM andon_notifications n JOIN records r ON r.id=n.record_id WHERE n.status=ANY($1::text[]) AND n.due_at<=now() AND n.attempts<3 ORDER BY n.created_at LIMIT 1 FOR UPDATE OF n SKIP LOCKED FOR SHARE OF r",
        [deliver ? ["scheduled", "pending"] : ["scheduled"]],
      );
      const n = q.rows[0];
      if (!n) return false;
      const contactId = n.payload.contacts?.[0]?.contactId;
      const currentContact = contactId
        ? (
            await db.query(
              "SELECT id FROM records WHERE id=$1 AND resource='andon-contacts' AND status='active'",
              [contactId],
            )
          ).rowCount
        : 0;
      if (
        n.record_status !== "submitted" ||
        n.workflow_data.respondedAt ||
        !currentContact
      ) {
        await db.query(
          "UPDATE andon_notifications SET status='cancelled' WHERE id=$1",
          [n.id],
        );
        return true;
      }
      if (n.status === "scheduled") {
        await db.query(
          "UPDATE andon_notifications SET status='pending' WHERE id=$1",
          [n.id],
        );
        await db.query(
          "INSERT INTO management_events(id,record_id,kind,data,actor_id) VALUES($1,$2,'alarm-fired',$3,$4)",
          [id(), n.record_id, JSON.stringify(n.payload), n.created_by],
        );
      }
      if (deliver) {
        try {
          await deliver({
            id: n.id,
            recordId: n.record_id,
            payload: n.payload,
          });
          await db.query(
            "UPDATE andon_notifications SET status='sent',attempts=attempts+1,delivered_at=now() WHERE id=$1",
            [n.id],
          );
        } catch (error) {
          await db.query(
            "UPDATE andon_notifications SET status=CASE WHEN attempts>=2 THEN 'failed' ELSE 'pending' END,attempts=attempts+1,last_error=$2 WHERE id=$1",
            [
              n.id,
              error instanceof Error
                ? error.message.slice(0, 1000)
                : "Delivery failed",
            ],
          );
        }
      }
      return true;
    });
    if (!found) break;
    count++;
  }
  return count;
}
export async function managementEvent(
  db: DB,
  r: any,
  user: Actor,
  kind: string,
  data: unknown = {},
  writeAudit = true,
) {
  await db.query(
    "INSERT INTO management_events(id,record_id,kind,data,actor_id) VALUES($1,$2,$3,$4,$5)",
    [id(), r.id, kind, JSON.stringify(data), user.id],
  );
  if (writeAudit) await audit(db, user.id, kind, r.resource, r.id, data);
}
const manage = (u: Actor, key: string) =>
  hasPermission(
    u,
    `resources:${key}:approve`,
    key === "app-versions"
      ? ["admin"]
      : [
          "admin",
          "manager",
          ...([
            "inspections",
            "incoming-inspections",
            "quality-rewards",
          ].includes(key)
            ? ["quality" as const]
            : []),
        ],
  );
const assigned = (u: Actor, r: any) => {
  const ids = [
    r.data.assigneeId,
    r.data.userId,
    ...(r.data.coAssigneeIds ?? []),
  ].filter(Boolean);
  return (
    manage(u, r.resource) ||
    (ids.length ? ids.includes(u.id) : r.created_by === u.id)
  );
};
export async function purchaseTotal(db: DB, r: any) {
  const items = r.data.items?.length
    ? r.data.items
    : [{ quantity: r.data.quantity, unitPrice: r.data.unitPrice }];
  return (
    await db.query(
      "SELECT round(coalesce(sum((x->>'quantity')::numeric*(x->>'unitPrice')::numeric),0),2) AS amount FROM jsonb_array_elements($1::jsonb) x",
      [JSON.stringify(items)],
    )
  ).rows[0].amount as number;
}
export async function calculateCatalogData(
  db: DB,
  key: string,
  data: Record<string, any>,
) {
  if (["devices", "molds", "tools"].includes(key) && !data.lifecycle)
    data.lifecycle = key === "molds" ? "available" : "active";
  if (
    ["devices", "tools"].includes(key) &&
    data.maintenanceCycle &&
    !data.nextMaintenanceDate
  )
    data.nextMaintenanceDate = (
      await db.query("SELECT (current_date+$1::int)::text AS next", [
        data.maintenanceCycle,
      ])
    ).rows[0].next;
  if (
    key === "purchase-orders" ||
    (key === "contracts" && data.items?.length)
  ) {
    const items = data.items?.length
      ? data.items
      : [{ quantity: data.quantity, unitPrice: data.unitPrice }];
    data.totalAmount = (
      await db.query(
        "SELECT round(sum((x->>'quantity')::numeric*(x->>'unitPrice')::numeric),2) AS amount FROM jsonb_array_elements($1::jsonb) x",
        [JSON.stringify(items)],
      )
    ).rows[0].amount;
  }
}
async function snapshot(db: DB, r: any) {
  let items = r.data.items ?? [],
    requireCheck = true,
    checkerIds: string[] = [],
    executorIds: string[] = [];
  if (r.resource === "safety-checklist-executions") {
    const tpl = await one(
      db,
      "SELECT * FROM records WHERE id=$1 AND resource='safety-checklist-templates' AND status='active' FOR SHARE",
      [r.data.templateId],
    );
    items = tpl.data.items ?? [];
    requireCheck = !!tpl.data.requireCheck;
    checkerIds = tpl.data.checkerIds ?? [];
    executorIds = tpl.data.executorIds ?? [];
    ensure(
      !executorIds.length || executorIds.includes(r.data.assigneeId),
      "执行人员未被检查模板授权",
    );
  } else if (!items.length && r.data.deviceId) {
    const device = await one(
      db,
      "SELECT * FROM records WHERE id=$1 AND resource='devices' FOR SHARE",
      [r.data.deviceId],
    );
    const kind =
      r.resource === "inspection-records" ? "inspection" : "maintenance";
    const specific = await db.query(
      "SELECT id AS source_id,data FROM records WHERE resource=$1 AND status='active' AND data->>'deviceId'=$2 ORDER BY coalesce((data->>'sequence')::int,0),created_at",
      [`device-${kind}-items`, device.id],
    );
    const templates = specific.rows.length
      ? specific
      : await db.query(
          "SELECT id AS source_id,data FROM records WHERE resource=$1 AND status='active' AND data->>'deviceTypeId'=$2 ORDER BY coalesce((data->>'sequence')::int,0),created_at",
          [`device-${kind}-templates`, device.data.deviceTypeId ?? ""],
        );
    items = templates.rows.map((x) => ({ ...x.data, sourceId: x.source_id }));
    if (!items.length && r.data.planId) {
      const plan = await one(
        db,
        "SELECT * FROM records WHERE id=$1 FOR SHARE",
        [r.data.planId],
      );
      items = plan.data.items ?? [];
    }
  }
  ensure(items.length > 0, "请配置至少一个检查事项");
  await db.query("DELETE FROM checklist_execution_items WHERE record_id=$1", [
    r.id,
  ]);
  for (let i = 0; i < items.length; i++)
    await db.query(
      "INSERT INTO checklist_execution_items(id,record_id,sequence,title,content,source_id,source_attachments) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id(),
        r.id,
        i + 1,
        items[i].title,
        items[i].content,
        items[i].sourceId ?? null,
        JSON.stringify(items[i].attachmentIds ?? []),
      ],
    );
  return { requireCheck, checkerIds, executorIds };
}
export async function managementTransition(
  db: DB,
  r: any,
  def: ResourceDefinition,
  action: string,
  user: Actor,
) {
  let stage = r.stage,
    workflow = r.workflow_data ?? {};
  if (action === "submit") {
    if (r.resource === "andon-events") {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `andon:${r.data.workstationId}`,
      ]);
      const existing = await db.query(
        "SELECT id FROM records WHERE resource='andon-events' AND id<>$1 AND status='submitted' AND data->>'workstationId'=$2",
        [r.id, r.data.workstationId],
      );
      ensure(!existing.rowCount, "工位已有未处理的安灯呼叫");
      const station = await one(
        db,
        "SELECT code,name FROM records WHERE id=$1",
        [r.data.workstationId],
      );
      const contacts = (
        await db.query(
          "SELECT id,name,data FROM records WHERE resource='andon-contacts' AND status='active' AND data->>'workstationId'=$1 ORDER BY coalesce((data->>'sequence')::int,0),created_at",
          [r.data.workstationId],
        )
      ).rows.map((x) => ({
        contactId: x.id,
        name: x.data.contactName || x.name,
        phone: x.data.phone,
        timeoutSeconds: x.data.timeoutSeconds ?? 0,
        userId: x.data.userId ?? null,
      }));
      const payload = {
        station,
        category: r.data.category,
        description: r.data.description ?? r.data.notes ?? "",
        contacts,
      };
      for (const contact of contacts)
        await db.query(
          "INSERT INTO andon_notifications(id,record_id,payload,due_at) VALUES($1,$2,$3,now()+$4::int*interval '1 second')",
          [
            id(),
            r.id,
            JSON.stringify({ ...payload, contacts: [contact] }),
            contact.timeoutSeconds,
          ],
        );
      await managementEvent(db, r, user, "alarm", payload);
    }
    stage = "pending";
    workflow = {};
    if (def.workflowKind === "checklist") {
      workflow = await snapshot(db, r);
      stage = "ready";
    }
    if (def.workflowKind === "task") stage = "ready";
  }
  if (action === "approve") {
    if (def.workflowKind === "checklist") {
      ensure(r.stage === "completed", "请先完成全部检查事项并提交完工");
      if (workflow.checkerIds?.length)
        ensure(
          workflow.checkerIds.includes(user.id) || user.role === "admin",
          "只有指定检查人员可以复核",
          403,
          "FORBIDDEN",
        );
      stage = "confirmed";
    } else if (def.workflowKind === "task") {
      ensure(
        r.stage === "completed" || r.feedback_at,
        "请先由受派人或主管填写执行反馈，再审核闭环",
      );
      stage = "confirmed";
    } else if (def.workflowKind === "hours") stage = "ready";
    else if (
      [
        "execution",
        "task",
        "repair",
        "mold-maintenance",
        "tool-maintenance",
      ].includes(def.workflowKind ?? "")
    )
      stage = r.feedback_at ? "confirmed" : "ready";
    else if (def.workflowKind === "purchase") stage = "accepted";
    if (r.resource === "quality-rewards")
      await db.query(
        "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date) VALUES($1,$2,'quality-reward',$3,1,$4,$4,current_date)",
        [id(), r.data.userId, r.id, r.data.amount],
      );
  }
  if (action === "reject") stage = "rejected";
  if (action === "archive") {
    if (
      [
        "hours",
        "checklist",
        "repair",
        "mold-maintenance",
        "tool-maintenance",
        "execution",
        "task",
      ].includes(def.workflowKind ?? "")
    )
      ensure(["confirmed", null].includes(r.stage), "流程尚未完成，不能归档");
    if (def.workflowKind === "purchase") {
      const q = await db.query(
        "SELECT id FROM purchase_payments WHERE purchase_id=$1 AND status IN ('requested','approved')",
        [r.id],
      );
      ensure(!q.rowCount, "仍有未完成的付款申请");
    }
  }
  await db.query("UPDATE records SET stage=$2,workflow_data=$3 WHERE id=$1", [
    r.id,
    stage,
    JSON.stringify(workflow),
  ]);
  await managementEvent(db, r, user, action, {}, false);
}
async function maintenanceEffect(
  db: DB,
  r: any,
  user: Actor,
  start: boolean,
  at: string,
) {
  const kind = resourceMap[r.resource].workflowKind;
  if (
    ["repair", "checklist"].includes(kind ?? "") &&
    r.data.deviceId &&
    r.resource !== "inspection-records"
  ) {
    await one(db, "SELECT id FROM records WHERE id=$1 FOR UPDATE", [
      r.data.deviceId,
    ]);
    if (start) {
      const busy = await db.query(
        "SELECT id FROM records WHERE id<>$1 AND resource IN ('repair-records','maintenance-records') AND stage='running' AND data->>'deviceId'=$2",
        [r.id, r.data.deviceId],
      );
      ensure(!busy.rowCount, "设备已有进行中的维修或保养");
    }
    await recordDeviceStatus(
      db,
      r.data.deviceId,
      start ? "maintenance" : "idle",
      user.id,
      `management:${r.id}:${start ? "start" : "complete"}:${r.revision}`,
      { occurredAt: at, reason: r.name },
    );
    if (!start && r.resource === "maintenance-records")
      await updateMaintenanceDate(db, r.data.deviceId, at);
  }
  if (kind === "mold-maintenance") {
    const m = await one(
      db,
      "SELECT * FROM records WHERE id=$1 AND resource='molds' FOR UPDATE",
      [r.data.moldId],
    );
    if (start)
      ensure(
        ![
          "mounted",
          "scrapped",
          "maintenance",
          "internal-repair",
          "external-repair",
        ].includes(m.data.lifecycle),
        "模具当前状态不能开始维保",
      );
    await db.query(
      "UPDATE records SET data=data||jsonb_build_object('lifecycle',$2::text),revision=revision+1,updated_at=now() WHERE id=$1",
      [m.id, start ? (r.data.operation ?? "maintenance") : "available"],
    );
  }
  if (kind === "tool-maintenance" && start) {
    const tool = await one(db, "SELECT * FROM records WHERE id=$1 FOR UPDATE", [
      r.data.toolId,
    ]);
    ensure(tool.data.lifecycle !== "scrapped", "报废刀具不能开始维保");
    const busy = await db.query(
      "SELECT id FROM records WHERE resource='tool-maintenance' AND stage='running' AND data->>'toolId'=$1",
      [tool.id],
    );
    ensure(!busy.rowCount, "刀具已有进行中的维保");
  }
  if (kind === "tool-maintenance" && !start)
    await updateMaintenanceDate(db, r.data.toolId, at);
}
async function updateMaintenanceDate(db: DB, rid: string, at: string) {
  await db.query(
    "UPDATE records SET data=data||jsonb_build_object('lastMaintenanceAt',$2::text,'nextMaintenanceDate',($2::timestamptz::date+coalesce((data->>'maintenanceCycle')::int,30))::text),revision=revision+1,updated_at=now() WHERE id=$1",
    [rid, at],
  );
}
type Action = { action: string; label: string; fields: FieldDefinition[] };
function actions(r: any, u: Actor): Action[] {
  const out: Action[] = [],
    d = resourceMap[r.resource],
    write = hasPermission(u, `resources:${r.resource}:write`, d.writeRoles),
    manager = manage(u, r.resource),
    writeManager = hasPermission(u, `resources:${r.resource}:write`, [
      "admin",
      "manager",
    ]),
    add = (action: string, label: string, fields: FieldDefinition[] = []) =>
      out.push({ action, label, fields });
  if (
    [
      "purchase-receipts",
      "purchase-issues",
      "auxiliary-receipts",
      "auxiliary-issues",
    ].includes(r.resource) &&
    r.status === "approved" &&
    r.stage !== "reversed"
  ) {
    if (write) add("annotate", "更新业务备注", [text("notes", "备注")]);
    if (manager) add("reverse", "冲销库存单", [text("notes", "冲销原因")]);
  }
  if (write && r.resource === "purchase-orders" && r.status === "approved")
    add("payment-notes", "更新付款备注", [
      { key: "paymentId", label: "付款记录编号", type: "text", required: true },
      text("notes", "付款说明"),
    ]);
  if (
    write &&
    r.resource === "andon-events" &&
    r.status === "submitted" &&
    !r.workflow_data.respondedAt
  )
    add("respond", "响应呼叫", [text("content", "响应说明", false)]);
  if (write && r.resource === "devices" && r.status === "active") {
    add("sync-inspection-items", "同步点检模板");
    add("sync-maintenance-items", "同步保养模板");
  }
  if (
    write &&
    r.resource === "andon-events" &&
    r.status === "submitted" &&
    r.workflow_data.respondedAt &&
    (writeManager || r.workflow_data.respondedBy === u.id)
  )
    add("handle", "完成呼叫处理", [text("result", "处理结果"), files]);
  if (r.status === "archived") return out;
  if (
    hasPermission(u, `resources:${r.resource}:write`) &&
    [
      "safety-accident-cases",
      "safety-knowledge",
      "safety-responsibilities",
      "safety-regulations",
    ].includes(r.resource)
  )
    add("learn", "确认学习");
  if (r.resource === "purchase-orders" && r.status === "approved") {
    if (write)
      add("request-payment", "申请付款", [
        num("amount", "付款金额"),
        {
          key: "method",
          label: "付款方式",
          type: "select",
          required: true,
          options: [
            { value: "bank", label: "银行转账" },
            { value: "cash", label: "现金" },
            { value: "other", label: "其他" },
          ],
        },
        text("payee", "收款人"),
        text("account", "收款账户"),
        text("bank", "开户银行", false),
        text("notes", "付款说明", false),
      ]);
    if (manager) {
      add("approve-payment", "批准付款");
      add("reject-payment", "退回付款", [text("notes", "退回原因")]);
      add("pay", "登记已付款", [files, text("notes", "付款凭证说明")]);
    }
  }
  if (d.workflowKind === "hours" && r.status === "approved") {
    if (write && assigned(u, r) && r.stage === "ready")
      add("complete", "提交工时完工", [
        dt("startedAt", "实际开始时间"),
        dt("endedAt", "实际结束时间"),
        text("result", "完工说明"),
        files,
      ]);
    if (manager && r.stage === "completed") {
      add("confirm", "确认工时", [
        dt("startedAt", "确认开始时间"),
        dt("endedAt", "确认结束时间"),
      ]);
      add("return", "退回办理", [text("notes", "退回原因")]);
    }
  }
  if (
    d.workflowKind === "checklist" &&
    r.status === "submitted" &&
    write &&
    assigned(u, r)
  ) {
    if (r.stage === "ready") add("start", "开始检查");
    if (r.stage === "running")
      add("complete", "提交检查完工", [text("result", "执行结果"), files]);
  }
  if (
    [
      "repair",
      "mold-maintenance",
      "tool-maintenance",
      "execution",
      "task",
    ].includes(d.workflowKind ?? "") &&
    (r.status === "approved" ||
      (d.workflowKind === "task" && r.status === "submitted"))
  ) {
    if (write && assigned(u, r)) {
      if (r.stage === "ready") add("start", "开始执行");
      if (r.stage === "running") {
        add("progress", "登记进展", [
          num("percent", "进度百分比"),
          text("content", "进展内容"),
          files,
        ]);
        add("complete", "提交执行完工", [
          text("result", "执行结果"),
          ...(r.resource === "improvements"
            ? [num("actualSavings", "实际节约")]
            : []),
          files,
        ]);
      }
    }
    if (manager && r.stage === "completed" && d.workflowKind !== "task") {
      add("confirm", "确认完成");
      add("return", "退回办理", [text("notes", "退回原因")]);
    }
  }
  if (
    writeManager &&
    r.status === "active" &&
    ["devices", "molds", "tools"].includes(r.resource)
  ) {
    const life =
      r.data.lifecycle ?? (r.resource === "molds" ? "available" : "active");
    if (r.resource === "devices") {
      if (life === "active")
        add("deactivate", "停用设备", [text("notes", "停用原因")]);
      if (life === "deactivated") add("activate", "启用设备");
    }
    if (r.resource === "molds") {
      if (life === "available")
        add("mount", "模具上机", [
          {
            key: "deviceId",
            label: "设备",
            type: "reference",
            resource: "devices",
            required: true,
          },
        ]);
      if (life === "mounted")
        add("unmount", "模具下机", [text("notes", "下机说明")]);
    }
    if (
      ![
        "scrapped",
        "mounted",
        "maintenance",
        "internal-repair",
        "external-repair",
      ].includes(life)
    )
      add("scrap", "报废资产", [text("notes", "报废原因")]);
  }
  return out;
}
export function registerManagement(
  app: FastifyInstance,
  pool: pg.Pool,
  notifier?: AndonNotifier,
) {
  {
    let active = false;
    const timer = setInterval(() => {
      if (active) return;
      active = true;
      void dispatchAndonNotifications(pool, notifier)
        .catch((error) => app.log.error(error))
        .finally(() => {
          active = false;
        });
    }, 30000);
    timer.unref();
    app.addHook("onClose", async () => {
      clearInterval(timer);
    });
  }

  app.get("/api/andon-alarms", async (req) => {
    actor(req);
    return list(
      pool,
      "SELECT n.*,r.name,r.code FROM andon_notifications n JOIN records r ON r.id=n.record_id WHERE true",
      [],
      req.query,
      ["r.name", "r.code"],
      "n.status",
    );
  });
  app.get("/api/resources/:key/:id/activity", async (req) => {
    const u = actor(req),
      p = req.params as any,
      r = await one(pool, "SELECT * FROM records WHERE resource=$1 AND id=$2", [
        p.key,
        uuid.parse(p.id),
      ]);
    if (
      [
        "work-hours",
        "work-hour-orders",
        "quality-rewards",
        "safety-penalties",
      ].includes(r.resource)
    ) {
      actor(
        req,
        "manager",
        "operator",
        ...(r.resource === "quality-rewards" ? ["quality" as const] : []),
      );
    }
    if (
      [
        "work-hours",
        "work-hour-orders",
        "quality-rewards",
        "safety-penalties",
      ].includes(r.resource) &&
      !manage(u, r.resource)
    )
      ensure(
        r.data.userId === u.id,
        "只能查看自己的工时和奖惩",
        403,
        "FORBIDDEN",
      );
    const [events, items, payments, learners] = await Promise.all([
      pool.query(
        "SELECT e.*,u.name AS actor_name FROM management_events e JOIN users u ON u.id=e.actor_id WHERE record_id=$1 ORDER BY e.created_at,e.id",
        [r.id],
      ),
      pool.query(
        "SELECT * FROM checklist_execution_items WHERE record_id=$1 ORDER BY sequence",
        [r.id],
      ),
      pool.query(
        "SELECT * FROM purchase_payments WHERE purchase_id=$1 ORDER BY created_at",
        [r.id],
      ),
      pool.query(
        "SELECT l.*,u.name FROM safety_learning l JOIN users u ON u.id=l.user_id WHERE record_id=$1 ORDER BY learned_at",
        [r.id],
      ),
    ]);
    const choices = actions(r, u)
      .filter(
        (a) =>
          a.action !== "request-payment" ||
          !payments.rows.some((p) =>
            ["requested", "approved"].includes(p.status),
          ),
      )
      .filter(
        (a) =>
          !["approve-payment", "reject-payment"].includes(a.action) ||
          payments.rows.some((p) => p.status === "requested"),
      )
      .filter(
        (a) =>
          a.action !== "pay" ||
          payments.rows.some((p) => p.status === "approved"),
      );
    const notifications = (
      await pool.query(
        "SELECT id,status,attempts,due_at,created_at,delivered_at FROM andon_notifications WHERE record_id=$1 ORDER BY created_at",
        [r.id],
      )
    ).rows;
    const related = (
      await pool.query(
        "SELECT DISTINCT child.id,child.resource,child.name,child.status,child.data FROM records child JOIN record_references ref ON ref.record_id=child.id WHERE ref.target_id=$1 LIMIT 100",
        [r.id],
      )
    ).rows
      .filter(
        (child) =>
          hasPermission(u, `resources:${child.resource}:read`) &&
          (![
            "work-hours",
            "work-hour-orders",
            "quality-rewards",
            "safety-penalties",
          ].includes(child.resource) ||
            manage(u, child.resource) ||
            child.data.userId === u.id),
      )
      .map(({ data, ...row }) => row);
    const paymentNotes = choices.find((a) => a.action === "payment-notes");
    if (paymentNotes)
      paymentNotes.fields[0] = {
        key: "paymentId",
        label: "付款记录",
        type: "select",
        required: true,
        options: payments.rows.map((p) => ({
          value: p.id,
          label: `${p.id.slice(0, 8)} · ${p.amount}`,
        })),
      };
    let receipts: any[] = [];
    if (r.resource === "purchase-orders") {
      const quantities = (
        await pool.query(
          "SELECT data->>'materialId' AS material_id,sum((data->>'quantity')::numeric) AS quantity FROM records WHERE resource='purchase-receipts' AND status IN ('approved','archived') AND coalesce(stage,'')<>'reversed' AND data->>'purchaseOrderId'=$1 GROUP BY data->>'materialId'",
          [r.id],
        )
      ).rows;
      receipts = (r.data.items?.length ? r.data.items : [r.data]).map(
        (line: any) => ({
          materialId: line.materialId,
          ordered: line.quantity,
          received:
            quantities.find((q) => q.material_id === line.materialId)
              ?.quantity ?? 0,
        }),
      );
    }
    return camel({
      receipts,
      receiptsComplete:
        receipts.length > 0 &&
        receipts.every((x) => Number(x.received) >= Number(x.ordered)),
      related,
      notifications,
      record: r,
      events: events.rows,
      items: items.rows,
      payments: payments.rows,
      learners: learners.rows,
      actions: choices,
      can_execute:
        hasPermission(
          u,
          `resources:${r.resource}:write`,
          resourceMap[r.resource].writeRoles,
        ) &&
        assigned(u, r) &&
        r.stage === "running",
      total:
        r.resource === "purchase-orders" ? await purchaseTotal(pool, r) : null,
    });
  });
  app.post("/api/resources/:key/:id/actions/:action", async (req) => {
    const p = req.params as any,
      def = resourceMap[p.key];
    ensure(def, "未知台账", 404, "NOT_FOUND");
    const privileged = [
      "approve-payment",
      "reject-payment",
      "pay",
      "confirm",
      "return",
      "reverse",
    ].includes(p.action);
    const u =
      p.action === "learn"
        ? actor(req)
        : actor(
            req,
            ...(privileged ? (["admin", "manager"] as const) : def.writeRoles),
          );
    const input = z
      .object({
        revision: z.number().int().positive(),
        data: z.record(z.unknown()).default({}),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const r = await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource=$2 FOR UPDATE",
        [uuid.parse(p.id), def.key],
      );
      ensure(r.revision === input.revision, "记录已被修改，请刷新");
      const a = actions(r, u).find((a) => a.action === p.action);
      ensure(
        a ||
          (p.action === "check-item" &&
            def.workflowKind === "checklist" &&
            r.status === "submitted" &&
            r.stage === "running" &&
            assigned(u, r)),
        "当前状态或权限不允许此操作",
        403,
        "FORBIDDEN",
      );
      const v = input.data;
      let stage = r.stage,
        w = { ...r.workflow_data },
        data = { ...r.data };
      const now = new Date().toISOString();
      if (a) {
        ensure(
          Object.keys(v).every((k) => a.fields.some((f) => f.key === k)),
          "包含未知字段",
          400,
          "VALIDATION",
        );
        for (const f of a.fields) {
          const val = v[f.key];
          if (val === undefined || val === "") {
            ensure(!f.required, `${f.label}不能为空`, 400, "VALIDATION");
            continue;
          }
          if (f.type === "number") {
            z.number().min(0).max(1e9).parse(val);
          } else if (f.type === "datetime")
            z.string().datetime({ offset: true }).parse(val);
          else if (f.type === "files") await businessFiles(db, val);
          else if (f.type === "reference") uuid.parse(val);
          else
            z.string()
              .trim()
              .min(f.required ? 1 : 0)
              .max(10000)
              .parse(val);
        }
      }
      switch (p.action) {
        case "handle": {
          data.resolution = v.result;
          w.handledAt = now;
          w.handledBy = u.id;
          w.result = v.result;
          w.attachmentIds = v.attachmentIds ?? [];
          stage = "confirmed";
          await db.query(
            "UPDATE records SET status='approved',feedback_by=$2,feedback_at=now() WHERE id=$1",
            [r.id, u.id],
          );
          break;
        }
        case "annotate":
          data.notes = v.notes;
          break;
        case "payment-notes": {
          const q = await db.query(
            "UPDATE purchase_payments SET notes=$3 WHERE id=$1 AND purchase_id=$2 RETURNING id",
            [uuid.parse(v.paymentId), r.id, v.notes],
          );
          ensure(q.rowCount, "付款记录不存在", 404, "NOT_FOUND");
          break;
        }
        case "respond": {
          w.respondedAt = now;
          w.respondedBy = u.id;
          w.response = v.content ?? "";
          stage = "responded";
          if (!data.assigneeId) data.assigneeId = u.id;
          break;
        }
        case "reverse": {
          ensure(manage(u, r.resource), "没有台账审核权限", 403, "FORBIDDEN");
          const move = await one(
            db,
            "SELECT * FROM material_movements WHERE source_id=$1 AND reverses_id IS NULL FOR UPDATE",
            [r.id],
          );
          const balance = await one(
            db,
            "SELECT * FROM material_balances WHERE material_id=$1 FOR UPDATE",
            [move.material_id],
          );
          if (move.direction === "in")
            ensure(
              Number(balance.quantity) >= Number(move.quantity),
              "库存不足，无法冲销入库单",
            );
          const column =
            move.direction === "in" ? "out_quantity" : "in_quantity";
          await db.query(
            `UPDATE material_balances SET ${column}=${column}+$2 WHERE material_id=$1`,
            [move.material_id, move.quantity],
          );
          await db.query(
            "INSERT INTO material_movements(id,material_id,source_id,direction,quantity,reverses_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              id(),
              move.material_id,
              r.id,
              move.direction === "in" ? "out" : "in",
              move.quantity,
              move.id,
            ],
          );
          stage = "reversed";
          await db.query("UPDATE records SET status='archived' WHERE id=$1", [
            r.id,
          ]);
          break;
        }
        case "sync-inspection-items":
        case "sync-maintenance-items": {
          ensure(data.deviceTypeId, "请先设置设备类型");
          const kind =
            p.action === "sync-inspection-items" ? "inspection" : "maintenance";
          const templates = await db.query(
            "SELECT * FROM records WHERE resource=$1 AND status='active' AND data->>'deviceTypeId'=$2 ORDER BY coalesce((data->>'sequence')::int,0),created_at",
            [`device-${kind}-templates`, data.deviceTypeId],
          );
          ensure(templates.rows.length, "设备类型未配置相应模板");
          await db.query(
            "UPDATE records SET status='archived',revision=revision+1,updated_at=now() WHERE resource=$1 AND data->>'deviceId'=$2 AND status='active'",
            [`device-${kind}-items`, r.id],
          );
          for (const tpl of templates.rows) {
            const iid = id(),
              d = {
                deviceId: r.id,
                title: tpl.data.title,
                content: tpl.data.content,
                sequence: tpl.data.sequence ?? 0,
                attachmentIds: tpl.data.attachmentIds ?? [],
              };
            await db.query(
              "INSERT INTO records(id,resource,code,name,status,data,created_by) VALUES($1,$2,$3,$4,'active',$5,$6)",
              [
                iid,
                `device-${kind}-items`,
                `ITEM-${iid}`,
                tpl.data.title,
                JSON.stringify(d),
                u.id,
              ],
            );
            await db.query(
              "INSERT INTO record_references(record_id,field,target_id) VALUES($1,'deviceId',$2)",
              [iid, r.id],
            );
          }
          w[`${kind}SyncedAt`] = now;
          break;
        }

        case "learn":
          await db.query(
            "INSERT INTO safety_learning(record_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [r.id, u.id],
          );
          break;
        case "request-payment": {
          ensure(Number(v.amount) > 0, "付款金额必须大于0");
          ensure(
            ["bank", "cash", "other"].includes(String(v.method)),
            "付款方式无效",
          );
          const total = await purchaseTotal(db, r);
          const q = await db.query(
            "SELECT coalesce(sum(amount),0) AS paid,count(*) FILTER(WHERE status IN ('requested','approved')) AS pending FROM purchase_payments WHERE purchase_id=$1 AND status<>'rejected'",
            [r.id],
          );
          ensure(!q.rows[0].pending, "仍有未完成的付款申请");
          ensure(
            Number(q.rows[0].paid) + Number(v.amount) <= total,
            "累计付款不能超过采购金额",
          );
          await db.query(
            "INSERT INTO purchase_payments(id,purchase_id,status,amount,method,payee,account,bank,notes,requested_by) VALUES($1,$2,'requested',$3,$4,$5,$6,$7,$8,$9)",
            [
              id(),
              r.id,
              v.amount,
              v.method,
              v.payee,
              v.account,
              v.bank ?? "",
              v.notes ?? "",
              u.id,
            ],
          );
          stage = "payment-requested";
          break;
        }
        case "approve-payment":
        case "reject-payment": {
          ensure(manage(u, r.resource), "没有台账审核权限", 403, "FORBIDDEN");
          const payment = await one(
            db,
            "SELECT * FROM purchase_payments WHERE purchase_id=$1 AND status='requested' FOR UPDATE",
            [r.id],
            "没有待审核的付款申请",
          );
          await db.query(
            "UPDATE purchase_payments SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1",
            [
              payment.id,
              p.action === "approve-payment" ? "approved" : "rejected",
              u.id,
            ],
          );
          stage =
            p.action === "approve-payment"
              ? "payment-approved"
              : "payment-rejected";
          break;
        }
        case "pay": {
          ensure(manage(u, r.resource), "没有台账审核权限", 403, "FORBIDDEN");
          const payment = await one(
            db,
            "SELECT * FROM purchase_payments WHERE purchase_id=$1 AND status='approved' FOR UPDATE",
            [r.id],
            "付款申请尚未批准",
          );
          await db.query(
            "UPDATE purchase_payments SET status='paid',paid_by=$2,paid_at=now(),attachment_ids=$3,notes=notes||E'\n'||$4 WHERE id=$1",
            [payment.id, u.id, JSON.stringify(v.attachmentIds ?? []), v.notes],
          );
          const paid = (
            await db.query(
              "SELECT sum(amount) AS n FROM purchase_payments WHERE purchase_id=$1 AND status='paid'",
              [r.id],
            )
          ).rows[0].n;
          stage = paid >= (await purchaseTotal(db, r)) ? "paid" : "part-paid";
          break;
        }
        case "start":
          stage = "running";
          w.startedAt = now;
          await maintenanceEffect(db, r, u, true, now);
          break;
        case "progress":
          ensure(Number(v.percent) <= 100, "进度不能超过100%");
          ensure(Number(v.percent) >= Number(w.percent ?? 0), "进度不能倒退");
          w.percent = v.percent;
          break;
        case "check-item": {
          const x = z
            .object({
              itemId: uuid,
              result: z.string().trim().min(1).max(10000),
              attachmentIds: z.array(uuid).max(10).default([]),
            })
            .strict()
            .parse(v);
          await businessFiles(db, x.attachmentIds);
          const result = await db.query(
            "UPDATE checklist_execution_items SET result=$3,attachment_ids=$4,completed_by=$5,completed_at=now() WHERE id=$1 AND record_id=$2 RETURNING id",
            [x.itemId, r.id, x.result, JSON.stringify(x.attachmentIds), u.id],
          );
          ensure(result.rowCount, "检查事项不存在", 404, "NOT_FOUND");
          break;
        }
        case "complete": {
          if (def.workflowKind === "checklist") {
            const q = await db.query(
              "SELECT count(*) AS n FROM checklist_execution_items WHERE record_id=$1 AND completed_at IS NULL",
              [r.id],
            );
            ensure(Number(q.rows[0].n) === 0, "仍有未完成的检查事项");
          }
          if (def.workflowKind === "hours") {
            ensure(
              new Date(String(v.endedAt)) > new Date(String(v.startedAt)),
              "结束时间必须晚于开始时间",
            );
            ensure(
              new Date(String(v.endedAt)).getTime() <= Date.now() + 60000,
              "结束时间不能在未来",
            );
            w.startedAt = v.startedAt;
            w.endedAt = v.endedAt;
          }
          w.result = v.result;
          w.attachmentIds = v.attachmentIds ?? [];
          w.completedAt = now;
          w.percent = 100;
          stage = "completed";
          if (r.resource === "improvements")
            data.actualSavings = v.actualSavings;
          await maintenanceEffect(db, r, u, false, now);
          if (def.workflowKind === "checklist" && w.requireCheck === false) {
            stage = "confirmed";
            await db.query("UPDATE records SET status='approved' WHERE id=$1", [
              r.id,
            ]);
          }
          break;
        }
        case "confirm": {
          ensure(manage(u, r.resource), "没有台账审核权限", 403, "FORBIDDEN");
          if (def.workflowKind === "hours") {
            const start = new Date(String(v.startedAt)),
              end = new Date(String(v.endedAt));
            ensure(
              end > start && end.getTime() <= Date.now() + 60000,
              "确认时间范围无效",
            );
            const hours = (end.getTime() - start.getTime()) / 3600000;
            ensure(hours <= 24, "单次计时工时不能超过24小时");
            const day = start.toISOString().slice(0, 10);
            await db.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`hours:${r.data.userId}:${day}`],
            );
            const used = (
              await db.query(
                "SELECT coalesce(sum(quantity),0) AS n FROM payroll WHERE worker_id=$1 AND work_date=$2 AND source_type='hours'",
                [r.data.userId, day],
              )
            ).rows[0].n;
            ensure(used + hours <= 24, "该人员当天累计计时工时超过24小时");
            await db.query(
              "INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date) VALUES($1,$2,'hours',$3,$4,$5,round($4::numeric*$5::numeric,2),$6)",
              [id(), r.data.userId, r.id, hours, r.data.hourlyRate, day],
            );
            w.confirmedStart = v.startedAt;
            w.confirmedEnd = v.endedAt;
            w.hours = hours;
          }
          stage = "confirmed";
          w.confirmedAt = now;
          w.confirmedBy = u.id;
          break;
        }
        case "return":
          ensure(manage(u, r.resource), "没有台账审核权限", 403, "FORBIDDEN");
          stage = [
            "hours",
            "repair",
            "mold-maintenance",
            "tool-maintenance",
          ].includes(def.workflowKind ?? "")
            ? "ready"
            : "running";
          w.returnReason = v.notes;
          break;
        case "mount": {
          await db.query("SELECT pg_advisory_xact_lock(10162802)");
          await one(
            db,
            "SELECT id FROM records WHERE id=$1 AND resource='devices' AND status='active' AND coalesce(data->>'lifecycle','active')='active' FOR UPDATE",
            [v.deviceId],
            "设备未启用",
          );
          const occupied = await db.query(
            "SELECT id FROM records WHERE resource='molds' AND data->>'lifecycle'='mounted' AND data->>'mountedDeviceId'=$1",
            [v.deviceId],
          );
          ensure(!occupied.rowCount, "该设备已有上机模具");
          data.lifecycle = "mounted";
          data.mountedDeviceId = v.deviceId;
          await db.query(
            "INSERT INTO record_references(record_id,field,target_id) VALUES($1,'mountedDeviceId',$2) ON CONFLICT DO NOTHING",
            [r.id, v.deviceId],
          );
          break;
        }
        case "unmount":
          data.lifecycle = "pending-maintenance";
          delete data.mountedDeviceId;
          await db.query(
            "DELETE FROM record_references WHERE record_id=$1 AND field='mountedDeviceId'",
            [r.id],
          );
          break;
        case "deactivate":
        case "activate":
        case "scrap": {
          const busy = await db.query(
            "SELECT id FROM records WHERE stage='running' AND ((data->>'deviceId'=$1 AND resource IN ('maintenance-records','repair-records')) OR (data->>'toolId'=$1 AND resource='tool-maintenance'))",
            [r.id],
          );
          ensure(!busy.rowCount, "资产仍有进行中的维保");
          data.lifecycle =
            p.action === "scrap"
              ? "scrapped"
              : p.action === "deactivate"
                ? "deactivated"
                : "active";
          if (r.resource === "devices")
            await recordDeviceStatus(
              db,
              r.id,
              data.lifecycle === "active" ? "idle" : data.lifecycle,
              u.id,
              `lifecycle:${r.id}:${r.revision}`,
              { reason: String(v.notes ?? "") },
            );
          break;
        }
      }
      await managementEvent(db, r, u, p.action, v);
      return camel(
        await one(
          db,
          "UPDATE records SET stage=$2,workflow_data=$3,data=$4,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
          [r.id, stage, JSON.stringify(w), JSON.stringify(data)],
        ),
      );
    });
  });
}
