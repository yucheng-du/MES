import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { actor } from "./auth.js";
import { audit, camel, ensure, id, one, transaction, type DB } from "./db.js";
import {
  approveReport,
  lockReportReview,
  reviewReasons,
} from "./report-review.js";

const leaderLock = 72811404;
type Trigger = "startup" | "timer" | "manual";
type Publish = (event: { resource: string; id?: string }) => void;
const settingsSchema = z
  .object({
    revision: z.number().int().positive(),
    enabled: z.boolean(),
    delayMinutes: z.number().int().min(0).max(1440),
    maxAmount: z
      .number()
      .positive()
      .max(1000000000)
      .refine(
        (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
        "金额最多两位小数",
      ),
    minDurationRatio: z.number().min(0).max(1),
    requireFullQuantity: z.boolean(),
  })
  .strict();

async function view(pool: pg.Pool) {
  const [settings, summary, recent] = await Promise.all([
    one(pool, "SELECT * FROM auto_review_settings WHERE id=true"),
    one(
      pool,
      `SELECT
      count(*) FILTER(WHERE status='complete' AND auto_review_status='pending') AS pending_automatic,
      count(*) FILTER(WHERE status='complete' AND auto_review_status='pending' AND auto_review_eligible_at>clock_timestamp()) AS awaiting_delay,
      count(*) FILTER(WHERE status='complete' AND auto_review_status='pending' AND auto_review_eligible_at<=clock_timestamp()) AS ready_automatic,
      count(*) FILTER(WHERE status='complete' AND auto_review_status='manual') AS manual_required,
      count(*) FILTER(WHERE status='approved' AND approval_mode='automatic') AS approved_automatically,
      count(*) FILTER(WHERE status='approved' AND approval_mode='manual') AS approved_manually FROM reports`,
    ),
    pool.query(
      "SELECT * FROM auto_review_runs ORDER BY started_at DESC LIMIT 1",
    ),
  ]);
  const { id: _singleton, ...fields } = settings;
  return {
    settings: camel({ ...fields, activated_at: settings.eligible_from }),
    summary: camel(summary),
    lastRun: camel(recent.rows[0] ?? null),
  };
}

async function attempt(
  db: DB,
  runId: string,
  reportId: string,
  revision: number,
  outcome: string,
  reasons: string[] = [],
) {
  await db.query(
    "INSERT INTO auto_review_attempts(id,run_id,report_id,rule_revision,outcome,reasons) VALUES($1,$2,$3,$4,$5,$6)",
    [id(), runId, reportId, revision, outcome, JSON.stringify(reasons)],
  );
}

async function requireManual(
  db: DB,
  report: any,
  revision: number,
  reasons: string[],
  runId: string,
) {
  await db.query(
    `UPDATE reports SET auto_review_status='manual',auto_review_reasons=$2,auto_review_eligible_at=null,auto_review_rule_revision=$3 WHERE id=$1`,
    [report.id, JSON.stringify(reasons), revision],
  );
  await audit(db, null, "auto-review-manual", "reports", report.id, {
    reasons,
    ruleRevision: revision,
    runId,
  });
}

async function inspectReport(pool: pg.Pool, reportId: string, runId: string) {
  return transaction(pool, async (db) => {
    const { settings, report, workOrder } = await lockReportReview(
      db,
      reportId,
    );
    if (
      !settings.enabled ||
      report.status !== "complete" ||
      report.auto_review_status === "manual"
    ) {
      await attempt(db, runId, report.id, settings.revision, "skipped");
      return;
    }
    const worker = await one(
      db,
      "SELECT active FROM users WHERE id=$1 FOR SHARE",
      [report.worker_id],
    );
    const reasons: string[] = [];
    if (report.had_rejection) reasons.push(reviewReasons.rejected);
    if (!report.completion_after_enablement)
      reasons.push(reviewReasons.historical);
    if (workOrder.status === "closed") reasons.push(reviewReasons.closed);
    if (!worker.active) reasons.push(reviewReasons.inactive);
    if (!Number.isInteger(report.quantity) || report.quantity <= 0)
      reasons.push(reviewReasons.quantity);
    const seconds = Number(report.duration_seconds);
    if (
      !report.started_at ||
      !report.completed_at ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      !report.completion_not_future
    )
      reasons.push(reviewReasons.time);
    if (
      (
        await db.query(
          "SELECT 1 FROM scraps WHERE work_order_id=$1 AND status IN ('pending','approved') LIMIT 1",
          [workOrder.id],
        )
      ).rowCount
    )
      reasons.push(reviewReasons.scrap);
    if (report.wage_amount > settings.max_amount)
      reasons.push(reviewReasons.amount);
    if (
      settings.min_duration_ratio > 0 &&
      seconds <
        report.expected_minutes *
          report.quantity *
          60 *
          settings.min_duration_ratio
    )
      reasons.push(reviewReasons.duration);
    if (
      settings.require_full_quantity &&
      report.quantity !== report.received_quantity
    )
      reasons.push(reviewReasons.partial);
    if (reasons.length) {
      await requireManual(db, report, settings.revision, reasons, runId);
      await attempt(db, runId, report.id, settings.revision, "manual", reasons);
      return;
    }
    const scheduled = await one(
      db,
      `UPDATE reports SET auto_review_status='pending',auto_review_eligible_at=completed_at+($2::integer*interval '1 minute'),auto_review_rule_revision=$3
      WHERE id=$1 RETURNING auto_review_eligible_at<=clock_timestamp() AS ready`,
      [report.id, settings.delay_minutes, settings.revision],
    );
    if (!scheduled.ready) {
      await attempt(db, runId, report.id, settings.revision, "waiting");
      return;
    }
    await approveReport(db, report, {
      mode: "automatic",
      actorId: null,
      ruleRevision: settings.revision,
      runId,
    });
    await attempt(db, runId, report.id, settings.revision, "approved");
  });
}

/** Deterministic wage/constraint failures require a person. Connection errors,
 * serialization failures, deadlocks and other transient errors stay retryable. */
async function recordFailure(
  pool: pg.Pool,
  reportId: string,
  runId: string,
  error: unknown,
) {
  const deterministic = ["23505", "23503", "23514", "22003", "P0001"].includes(
    String((error as any)?.code),
  );
  await transaction(pool, async (db) => {
    const { settings, report } = await lockReportReview(db, reportId);
    const manual =
      deterministic &&
      report.status === "complete" &&
      report.auto_review_status !== "manual";
    if (manual)
      await requireManual(
        db,
        report,
        settings.revision,
        [reviewReasons.failure],
        runId,
      );
    const reasons = [
      deterministic
        ? reviewReasons.failure
        : "自动审核暂时失败，将在后续运行重试",
    ];
    await attempt(
      db,
      runId,
      report.id,
      settings.revision,
      manual ? "error" : "retry",
      reasons,
    );
    if (!manual)
      await audit(db, null, "auto-review-error", "reports", report.id, {
        reasons,
        ruleRevision: settings.revision,
        runId,
      });
  });
}

async function finishRun(
  db: DB,
  runId: string,
  status: "completed" | "failed",
  errorMessage: string | null,
  actorId: string | null,
) {
  const result = await one(
    db,
    `UPDATE auto_review_runs SET status=$2,finished_at=clock_timestamp(),error_message=$3,
    scanned_count=(SELECT count(*) FROM auto_review_attempts WHERE run_id=$1),
    approved_count=(SELECT count(*) FROM auto_review_attempts WHERE run_id=$1 AND outcome='approved'),
    manual_count=(SELECT count(*) FROM auto_review_attempts WHERE run_id=$1 AND outcome IN ('manual','error')),
    skipped_count=(SELECT count(*) FROM auto_review_attempts WHERE run_id=$1 AND outcome IN ('waiting','skipped')),
    error_count=GREATEST((SELECT count(*) FROM auto_review_attempts WHERE run_id=$1 AND outcome IN ('error','retry')),CASE WHEN $2='failed' THEN 1 ELSE 0 END)
    WHERE id=$1 RETURNING *`,
    [runId, status, errorMessage],
  );
  await audit(
    db,
    actorId,
    "auto-review-run",
    "auto-review",
    runId,
    camel(result),
  );
  return result;
}

export async function runAutoReview(
  pool: pg.Pool,
  options: {
    trigger: Trigger;
    actorId?: string;
    publish?: Publish;
    shouldStop?: () => boolean;
    onError?: (error: unknown) => void;
  },
) {
  const leader = await pool.connect();
  let locked = false;
  let runId: string | undefined;
  try {
    locked = (
      await leader.query("SELECT pg_try_advisory_lock($1) AS locked", [
        leaderLock,
      ])
    ).rows[0].locked;
    const settings = await one(
      leader,
      "SELECT * FROM auto_review_settings WHERE id=true",
    );
    runId = id();
    if (!locked || !settings.enabled) {
      const result = await one(
        leader,
        `INSERT INTO auto_review_runs(id,status,trigger,triggered_by,finished_at,rule_revision,error_message)
        VALUES($1,'skipped',$2,$3,clock_timestamp(),$4,$5) RETURNING *`,
        [
          runId,
          options.trigger,
          options.actorId ?? null,
          settings.revision,
          locked
            ? "自动审核已停用，本次未执行"
            : "另一实例正在执行自动审核，本次已跳过",
        ],
      );
      await audit(
        leader,
        options.actorId ?? null,
        "auto-review-run",
        "auto-review",
        runId,
        camel(result),
      );
      return camel(result);
    }
    // Holding the global leader lock means any old running row has lost its owner.
    const interrupted = await leader.query(
      "SELECT id FROM auto_review_runs WHERE status='running'",
    );
    for (const old of interrupted.rows)
      await transaction(pool, (db) =>
        finishRun(
          db,
          old.id,
          "failed",
          "上次执行意外中断，已完成的审核保持有效；未处理记录将在本轮重扫",
          null,
        ),
      );
    await leader.query(
      `INSERT INTO auto_review_runs(id,status,trigger,triggered_by,rule_revision) VALUES($1,'running',$2,$3,$4)`,
      [runId, options.trigger, options.actorId ?? null, settings.revision],
    );
    let hadError = false;
    // Keyset pagination visits waiting rows once without starving later completions.
    let cursor: { at: Date | string; id: string } | null = null;
    while (!options.shouldStop?.()) {
      const batch: pg.QueryResult<{ id: string; at: string }> =
        await leader.query(
          `SELECT id,coalesce(completed_at,created_at)::text AS at FROM reports
        WHERE status='complete' AND auto_review_status IN ('pending','not_applicable')
        ${cursor ? "AND (coalesce(completed_at,created_at),id)>($1::timestamptz,$2::uuid)" : ""}
        ORDER BY coalesce(completed_at,created_at),id LIMIT 200`,
          cursor ? [cursor.at, cursor.id] : [],
        );
      if (!batch.rowCount) break;
      for (const candidate of batch.rows) {
        if (options.shouldStop?.()) break;
        try {
          await inspectReport(pool, candidate.id, runId);
        } catch (error) {
          options.onError?.(error);
          hadError = true;
          await recordFailure(pool, candidate.id, runId, error);
        }
        cursor = { at: candidate.at, id: candidate.id };
      }
      if (batch.rowCount < 200) break;
    }
    const result = await transaction(pool, (db) =>
      finishRun(
        db,
        runId!,
        hadError ? "failed" : "completed",
        hadError
          ? "部分报工审核失败，工资事务已回滚；业务异常转人工，暂时故障将重试"
          : null,
        options.actorId ?? null,
      ),
    );
    options.publish?.({ resource: "reports" });
    return camel(result);
  } catch (error) {
    if (runId) {
      await transaction(pool, (db) =>
        finishRun(
          db,
          runId!,
          "failed",
          "自动审核执行中断，请检查服务日志；已提交的审核保持有效",
          options.actorId ?? null,
        ),
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    if (locked)
      await leader
        .query("SELECT pg_advisory_unlock($1)", [leaderLock])
        .catch(() => undefined);
    leader.release();
  }
}

export function registerAutoReview(
  app: FastifyInstance,
  pool: pg.Pool,
  publish: Publish,
  workerEnabled: boolean,
) {
  app.get("/api/settings/auto-review", async (req) => {
    actor(req, "manager");
    return view(pool);
  });
  app.patch("/api/settings/auto-review", async (req) => {
    const user = actor(req, "manager");
    const input = settingsSchema.parse(req.body);
    await transaction(pool, async (db) => {
      const old = await one(
        db,
        "SELECT * FROM auto_review_settings WHERE id=true FOR UPDATE",
      );
      ensure(old.revision === input.revision, "配置已更新，请刷新后重试");
      const updated = await one(
        db,
        `UPDATE auto_review_settings SET enabled=$1,delay_minutes=$2,max_amount=$3,min_duration_ratio=$4,require_full_quantity=$5,
        eligible_from=CASE WHEN NOT enabled AND $1 THEN clock_timestamp() ELSE eligible_from END,
        revision=revision+1,updated_by=$6,updated_at=clock_timestamp() WHERE id=true RETURNING *`,
        [
          input.enabled,
          input.delayMinutes,
          input.maxAmount,
          input.minDurationRatio,
          input.requireFullQuantity,
          user.id,
        ],
      );
      const reason = input.enabled
        ? reviewReasons.historical
        : reviewReasons.disabled;
      await db.query(
        `UPDATE reports SET auto_review_status='manual',auto_review_reasons=$1,auto_review_eligible_at=null,auto_review_rule_revision=$2
        WHERE status='complete' AND auto_review_status IN ('pending','not_applicable') AND ($3::boolean=false OR completed_at<$4 OR completed_at IS NULL)`,
        [
          JSON.stringify([reason]),
          updated.revision,
          input.enabled,
          updated.eligible_from,
        ],
      );
      await db.query(
        `UPDATE reports SET auto_review_eligible_at=completed_at+($1::integer*interval '1 minute'),auto_review_rule_revision=$2 WHERE status='complete' AND auto_review_status='pending'`,
        [updated.delay_minutes, updated.revision],
      );
      await audit(db, user.id, "update", "auto-review-settings", null, {
        before: camel(old),
        after: camel(updated),
      });
    });
    publish({ resource: "reports" });
    return view(pool);
  });
  app.post("/api/settings/auto-review/run", async (req) => {
    const user = actor(req, "manager");
    z.object({})
      .strict()
      .parse(req.body ?? {});
    return {
      run: await runAutoReview(pool, {
        trigger: "manual",
        actorId: user.id,
        publish,
        onError: (error) =>
          req.log.error(
            { err: error },
            "Automatic approval transaction failed",
          ),
      }),
    };
  });
  if (workerEnabled) {
    let timer: ReturnType<typeof setInterval> | undefined;
    let current: Promise<unknown> | undefined;
    let closing = false;
    const start = (trigger: Trigger) => {
      if (closing || current) return;
      current = runAutoReview(pool, {
        trigger,
        publish,
        shouldStop: () => closing,
        onError: (error) =>
          app.log.error(
            { err: error },
            "Automatic approval transaction failed",
          ),
      })
        .catch((error) =>
          app.log.error({ err: error }, "Automatic report review failed"),
        )
        .finally(() => {
          current = undefined;
        });
    };
    app.addHook("onReady", async () => {
      start("startup");
      timer = setInterval(() => start("timer"), 60000);
      timer.unref();
    });
    app.addHook("preClose", async () => {
      closing = true;
      clearInterval(timer);
      await current;
    });
  }
}
