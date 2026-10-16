import type { DB } from "./db.js";
import { audit, ensure, id, one } from "./db.js";

export const reviewReasons = {
  disabled: "自动审核已停用，需要人工审核",
  historical: "启用前的完工积压，需要人工审核",
  rejected: "曾被驳回或重新提交，需要人工复核",
  closed: "所属工单已关闭",
  inactive: "报工人员已停用",
  quantity: "完工数量无效或为零",
  time: "开始或完工时间无效",
  scrap: "所属工单存在待审核或已批准的报废",
  amount: "计件金额超过自动审核上限",
  duration: "加工时长低于设定的标准节拍比例",
  partial: "完工数量与收料数量不一致",
  failure: "自动审核执行失败，需要人工复核",
} as const;

/** All review writers lock in this order: settings -> work order -> report -> worker.
 * Configuration changes lock settings exclusively, so disabling waits for in-flight
 * reviews and no automatic approval can commit after the disable response. */
export async function lockReviewSettings(db: DB) {
  return one(db, "SELECT * FROM auto_review_settings WHERE id=true FOR SHARE");
}
export async function lockReportReview(
  db: DB,
  reportId: string,
  settings?: any,
) {
  const rules = settings ?? (await lockReviewSettings(db));
  const ref = await one(db, "SELECT work_order_id FROM reports WHERE id=$1", [
    reportId,
  ]);
  const workOrder = await one(
    db,
    "SELECT * FROM work_orders WHERE id=$1 FOR UPDATE",
    [ref.work_order_id],
  );
  const report = await one(
    db,
    `SELECT r.*,t.unit_price,t.expected_minutes,
    extract(epoch FROM (r.completed_at-r.started_at)) AS duration_seconds,
    round((r.quantity+r.complete_adjustment)::numeric*t.unit_price,2) AS wage_amount,
    r.completed_at<=clock_timestamp() AS completion_not_future,
    r.completed_at >= (SELECT eligible_from FROM auto_review_settings WHERE id=true) AS completion_after_enablement
    FROM reports r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1 FOR UPDATE OF r`,
    [reportId],
  );
  return { settings: rules, workOrder, report };
}

/** Called only while the report and work order locks are held in a transaction. */
export async function approveReport(
  db: DB,
  report: any,
  options: {
    mode: "manual" | "automatic";
    actorId: string | null;
    ruleRevision?: number;
    runId?: string;
  },
) {
  if (report.status === "approved")
    return one(db, "SELECT * FROM reports WHERE id=$1", [report.id]);
  ensure(report.status === "complete", "仅可审核已完工记录");
  await db.query(
    `INSERT INTO payroll(id,worker_id,source_type,source_id,quantity,unit_price,amount,work_date)
    VALUES($1,$2,'piece',$3,$4,$5,round($4::numeric*$5::numeric,2),$6)`,
    [
      id(),
      report.worker_id,
      report.id,
      report.quantity + report.complete_adjustment,
      report.unit_price,
      report.completed_at,
    ],
  );
  const result = await one(
    db,
    `UPDATE reports SET status='approved',approved_by=$2,approved_at=clock_timestamp(),approval_mode=$3,
    auto_review_status=$4,auto_review_eligible_at=null,
    auto_review_rule_revision=COALESCE($5,auto_review_rule_revision)
    WHERE id=$1 RETURNING *`,
    [
      report.id,
      options.actorId,
      options.mode,
      options.mode === "automatic" ? "approved" : "manual",
      options.ruleRevision ?? null,
    ],
  );
  await audit(
    db,
    options.actorId,
    options.mode === "automatic" ? "auto-approve" : "approve",
    "reports",
    report.id,
    {
      approvalMode: options.mode,
      ruleRevision: options.ruleRevision ?? null,
      runId: options.runId ?? null,
      amount: report.wage_amount,
    },
  );
  return result;
}

/** Schedule completion using the current enablement boundary, never old pending work. */
export async function scheduleReportReview(db: DB, report: any, settings: any) {
  const reasons: string[] = [];
  if (report.had_rejection) reasons.push(reviewReasons.rejected);
  if (!settings.enabled) reasons.push(reviewReasons.disabled);
  const boundary = await one(
    db,
    "SELECT completed_at >= (SELECT eligible_from FROM auto_review_settings WHERE id=true) AS eligible FROM reports WHERE id=$1",
    [report.id],
  );
  if (!boundary.eligible) reasons.push(reviewReasons.historical);
  return one(
    db,
    `UPDATE reports SET auto_review_status=$2,auto_review_reasons=$3,
    auto_review_eligible_at=CASE WHEN $2='pending' THEN completed_at+($4::integer*interval '1 minute') ELSE NULL END,
    auto_review_rule_revision=$5 WHERE id=$1 RETURNING *`,
    [
      report.id,
      reasons.length ? "manual" : "pending",
      JSON.stringify(reasons),
      settings.delay_minutes,
      settings.revision,
    ],
  );
}
