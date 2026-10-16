import { before, beforeEach, afterEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import { createPool, id, one } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
import { migrate } from "../src/migrate.js";
import { runAutoReview } from "../src/auto-review.js";
import { reviewReasons } from "../src/report-review.js";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "TEST_DATABASE_URL must explicitly name a dedicated *_test database",
  );
const pool = createPool(url);
const origin = "http://localhost:5173";
let app: FastifyInstance;
let admin: string, operator: string, quality: string, operatorId: string;
async function call(method: any, path: string, payload?: any, cookie = admin) {
  return app.inject({
    method,
    url: "/api" + path,
    headers: { origin, cookie },
    payload,
  });
}
async function ok(method: any, path: string, payload?: any, cookie = admin) {
  const response = await call(method, path, payload, cookie);
  assert.equal(response.statusCode, 200, `${method} ${path} ${response.body}`);
  return response.json();
}
async function login(username: string) {
  const response = await call(
    "POST",
    "/auth/login",
    { username, password: "MesDemo2026!" },
    "",
  );
  assert.equal(response.statusCode, 200, response.body);
  return String(response.headers["set-cookie"]).split(";")[0];
}
async function settings(changes: Record<string, unknown> = {}) {
  const { settings: value } = await ok("GET", "/settings/auto-review");
  const {
    revision,
    enabled,
    delayMinutes,
    maxAmount,
    minDurationRatio,
    requireFullQuantity,
  } = value;
  return ok("PATCH", "/settings/auto-review", {
    revision,
    enabled,
    delayMinutes,
    maxAmount,
    minDurationRatio,
    requireFullQuantity,
    ...changes,
  });
}
async function run() {
  return (await ok("POST", "/settings/auto-review/run", {})).run;
}
async function report({
  quantity = 10,
  completed = quantity,
  price = 2,
  finish = true,
}: {
  quantity?: number;
  completed?: number;
  price?: number;
  finish?: boolean;
} = {}) {
  const product = await ok("POST", "/products", {
    code: "AUTO-" + id(),
    name: "自动审核产品",
    steps: [{ name: "加工", unitPrice: price, expectedMinutes: 1 }],
  });
  const work = await ok("POST", "/work-orders", {
    productId: product.id,
    quantity,
  });
  const record = await ok(
    "POST",
    `/tasks/${work.tasks[0].id}/receive`,
    { requestId: id() },
    operator,
  );
  await ok("POST", `/reports/${record.id}/start`, {}, operator);
  // A realistic valid start time; the test does not wait for actual manufacturing.
  await pool.query(
    "UPDATE reports SET started_at=clock_timestamp()-interval '30 minutes' WHERE id=$1",
    [record.id],
  );
  const result = finish
    ? await ok(
        "POST",
        `/reports/${record.id}/complete`,
        { quantity: completed, requestId: id() },
        operator,
      )
    : record;
  return { ...result, work };
}
async function current(reportId: string) {
  return one(pool, "SELECT * FROM reports WHERE id=$1", [reportId]);
}
async function wages(reportId: string) {
  return (
    await pool.query("SELECT * FROM payroll WHERE source_id=$1", [reportId])
  ).rows;
}
async function until(predicate: () => Promise<boolean>, message: string) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await pause(20);
  }
  assert.fail(message);
}
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
  await pool.query("INSERT INTO auto_review_settings(id) VALUES(true)");
  const hash = await hashPassword("MesDemo2026!");
  for (const role of ["admin", "operator", "quality"]) {
    const uid = id();
    if (role === "operator") operatorId = uid;
    await pool.query(
      "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$2,$3,$2)",
      [uid, role, hash],
    );
  }
  app = await createApp({ pool, origins: [origin] });
  admin = await login("admin");
  operator = await login("operator");
  quality = await login("quality");
});
afterEach(async () => {
  await app.close();
});
after(async () => {
  await pool.end();
});

test("settings defaults, role boundaries, optimistic revision and schema are enforced", async () => {
  const first = await ok("GET", "/settings/auto-review");
  assert.deepEqual(
    [
      first.settings.enabled,
      first.settings.delayMinutes,
      first.settings.maxAmount,
      first.settings.minDurationRatio,
      first.settings.requireFullQuantity,
    ],
    [true, 5, 2000, 0, false],
  );
  assert.equal(first.settings.eligibleFrom, first.settings.activatedAt);
  for (const cookie of [operator, quality]) {
    assert.equal(
      (await call("GET", "/settings/auto-review", undefined, cookie))
        .statusCode,
      403,
    );
    assert.equal(
      (await call("POST", "/settings/auto-review/run", {}, cookie)).statusCode,
      403,
    );
    assert.equal(
      (await call("PATCH", "/settings/auto-review", {}, cookie)).statusCode,
      403,
    );
  }
  const second = await settings({ delayMinutes: 0 });
  assert.equal(second.settings.revision, first.settings.revision + 1);
  assert.equal(second.settings.eligibleFrom, first.settings.eligibleFrom);
  assert.equal(
    (
      await call("PATCH", "/settings/auto-review", {
        revision: 1,
        enabled: true,
        delayMinutes: 0,
        maxAmount: 2000,
        minDurationRatio: 0,
        requireFullQuantity: false,
      })
    ).statusCode,
    409,
  );
  for (const change of [
    { delayMinutes: 1441 },
    { delayMinutes: -1 },
    { maxAmount: 0 },
    { maxAmount: 1.234 },
    { minDurationRatio: 1.1 },
    { activatedAt: "2020-01-01" },
  ]) {
    const response = await call("PATCH", "/settings/auto-review", {
      revision: 2,
      enabled: true,
      delayMinutes: 0,
      maxAmount: 2000,
      minDurationRatio: 0,
      requireFullQuantity: false,
      ...change,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
});

test("normal and partial completions approve once, with system audit, rule revision and real wages", async () => {
  await settings({ delayMinutes: 0 });
  const full = await report();
  const partial = await report({ quantity: 10, completed: 4 });
  assert.equal(full.autoReviewStatus, "pending");
  assert.equal((await ok("GET", "/reports?reviewMode=pending_auto")).total, 2);
  const first = await run();
  assert.equal(first.status, "completed");
  assert.equal(first.approvedCount, 2);
  for (const record of [full, partial]) {
    const saved = await current(record.id);
    assert.equal(saved.status, "approved");
    assert.equal(saved.approval_mode, "automatic");
    assert.equal(saved.approved_by, null);
    assert.equal(saved.auto_review_rule_revision, 2);
    const payroll = await wages(record.id);
    assert.equal(payroll.length, 1);
    assert.equal(payroll[0].amount, record.quantity * 2);
  }
  assert.equal((await run()).approvedCount, 0);
  assert.equal((await ok("GET", "/reports?reviewMode=automatic")).total, 2);
  assert.equal((await ok("GET", "/reports?reviewMode=manual")).total, 0);
  const logs = await ok("GET", "/audit-logs?q=auto-approve");
  assert.equal(logs.total, 2);
  assert.ok(
    logs.items.every(
      (r: any) =>
        r.actorId === null &&
        r.actorName === "系统" &&
        r.details.ruleRevision === 2,
    ),
  );
  const view = await ok("GET", "/settings/auto-review");
  assert.equal(view.summary.approvedAutomatically, 2);
  assert.equal(view.lastRun.approvedCount, 0);
});

test("delay is honored by manual scans and current rules may shorten the waiting period", async () => {
  const r = await report();
  const v = await ok("GET", "/settings/auto-review");
  assert.equal(v.summary.pendingAutomatic, 1);
  assert.equal(v.summary.awaitingDelay, 1);
  assert.equal((await run()).approvedCount, 0);
  assert.equal((await wages(r.id)).length, 0);
  await settings({ delayMinutes: 0 });
  assert.equal((await run()).approvedCount, 1);
});

test("disable and re-enable preserve manual backlog; only completions after new enablement are eligible", async () => {
  await settings({ delayMinutes: 0 });
  const before = await report();
  const oldBoundary = (await ok("GET", "/settings/auto-review")).settings
    .eligibleFrom;
  await settings({ enabled: false });
  assert.equal((await current(before.id)).auto_review_status, "manual");
  const during = await report();
  const spanning = await report({ finish: false });
  assert.equal((await run()).status, "skipped");
  await pause(3);
  const enabled = await settings({ enabled: true });
  assert.ok(enabled.settings.eligibleFrom > oldBoundary);
  await ok(
    "POST",
    `/reports/${spanning.id}/complete`,
    { quantity: 10, requestId: id() },
    operator,
  );
  assert.equal((await run()).approvedCount, 1);
  assert.equal((await current(spanning.id)).approval_mode, "automatic");
  for (const r of [before, during])
    assert.equal((await current(r.id)).auto_review_status, "manual");
  assert.equal((await ok("GET", "/reports?reviewMode=manual")).total, 2);
  assert.equal((await ok("GET", "/dashboard")).metrics.manualReviewReports, 2);
});

test("invalid quantities/times, inactive workers, closed work orders, scraps and rule exceptions stay manual", async () => {
  await settings({ delayMinutes: 0 });
  const invalidQuantity = await report();
  await pool.query("UPDATE reports SET quantity=0 WHERE id=$1", [
    invalidQuantity.id,
  ]);
  const invalidTime = await report();
  await pool.query(
    "UPDATE reports SET started_at=completed_at+interval '1 minute' WHERE id=$1",
    [invalidTime.id],
  );
  const future = await report();
  await pool.query(
    "UPDATE reports SET completed_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
    [future.id],
  );
  const historical = await report();
  await pool.query(
    "UPDATE reports SET completed_at=(SELECT eligible_from-interval '1 microsecond' FROM auto_review_settings),started_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
    [historical.id],
  );
  const closed = await report({ quantity: 10, completed: 4 });
  await ok("POST", `/work-orders/${closed.work.id}/close`, {
    reason: "取消剩余生产",
  });
  const scrap = await report({ quantity: 10, completed: 4 });
  await ok("POST", "/scraps", {
    workOrderId: scrap.work.id,
    quantity: 1,
    reason: "缺陷",
    requestId: id(),
  });
  const expensive = await report({ price: 201 });
  const partial = await report({ quantity: 10, completed: 4 });
  const tooFast = await report();
  await pool.query(
    "UPDATE reports SET started_at=completed_at-interval '1 second' WHERE id=$1",
    [tooFast.id],
  );
  await settings({ requireFullQuantity: true, minDurationRatio: 0.1 });
  const result = await run();
  assert.equal(result.approvedCount, 0);
  const expected: [[any, string], ...[any, string][]] = [
    [invalidQuantity, reviewReasons.quantity],
    [invalidTime, reviewReasons.time],
    [future, reviewReasons.time],
    [historical, reviewReasons.historical],
    [closed, reviewReasons.closed],
    [scrap, reviewReasons.scrap],
    [expensive, reviewReasons.amount],
    [partial, reviewReasons.partial],
    [tooFast, reviewReasons.duration],
  ];
  for (const [r, reason] of expected) {
    const row = await current(r.id);
    assert.equal(row.auto_review_status, "manual");
    assert.ok(
      row.auto_review_reasons.includes(reason),
      JSON.stringify(row.auto_review_reasons),
    );
  }
  await settings({
    requireFullQuantity: false,
    minDurationRatio: 0,
    maxAmount: 100000,
  });
  assert.equal(
    (await run()).approvedCount,
    0,
    "relaxing rules cannot clear sticky exceptions",
  );
  const inactive = await report();
  await pool.query("UPDATE users SET active=false WHERE id=$1", [operatorId]);
  assert.equal((await run()).manualCount, 1);
  assert.ok(
    (await current(inactive.id)).auto_review_reasons.includes(
      reviewReasons.inactive,
    ),
  );
});

test("approved scraps and full scrap zero completion never approve automatically", async () => {
  await settings({ delayMinutes: 0 });
  const record = await report({ finish: false });
  const scrap = await ok("POST", "/scraps", {
    workOrderId: record.work.id,
    reportId: record.id,
    quantity: 10,
    reason: "全报废",
    requestId: id(),
  });
  await ok("POST", `/scraps/${scrap.id}/approve`, { requestId: id() });
  await ok(
    "POST",
    `/reports/${record.id}/complete`,
    { quantity: 0, requestId: id() },
    operator,
  );
  assert.equal((await run()).manualCount, 1);
  const saved = await current(record.id);
  assert.ok(saved.auto_review_reasons.includes(reviewReasons.scrap));
  assert.ok(saved.auto_review_reasons.includes(reviewReasons.quantity));
  assert.equal((await wages(record.id)).length, 0);
});

test("rejected and resubmitted reports are permanently manual even after another enablement cycle", async () => {
  await settings({ delayMinutes: 0 });
  const r = await report();
  await ok(
    "POST",
    `/reports/${r.id}/reject`,
    { reason: "数量有争议" },
    quality,
  );
  await ok("POST", `/reports/${r.id}/resubmit`, { reason: "已核对" }, operator);
  await settings({ enabled: false });
  await settings({ enabled: true });
  assert.equal((await run()).approvedCount, 0);
  assert.ok((await current(r.id)).had_rejection);
  assert.ok(
    (await current(r.id)).auto_review_reasons.includes(reviewReasons.rejected),
  );
  await ok("POST", `/reports/${r.id}/approve`, { requestId: id() }, quality);
  assert.equal((await current(r.id)).approval_mode, "manual");
  assert.equal((await wages(r.id)).length, 1);
});

test("migration backfills erased rejection history from audit without auto-approving old completions", async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("CREATE SCHEMA legacy_review_test");
    await db.query("SET LOCAL search_path=legacy_review_test");
    await db.query("CREATE TABLE users(id uuid PRIMARY KEY)");
    await db.query(
      "CREATE TABLE reports(id uuid PRIMARY KEY,status text,completed_at timestamptz)",
    );
    await db.query(
      "CREATE TABLE audit_logs(resource text,resource_id uuid,action text)",
    );
    const old = id(),
      normal = id();
    await db.query(
      "INSERT INTO reports VALUES($1,'complete',now()-interval '1 day'),($2,'complete',now()-interval '1 day')",
      [old, normal],
    );
    await db.query("INSERT INTO audit_logs VALUES('reports',$1,'resubmit')", [
      old,
    ]);
    await db.query(
      await readFile(
        new URL("../src/migrations/093_auto_review.sql", import.meta.url),
        "utf8",
      ),
    );
    const recovered = await one(db, "SELECT * FROM reports WHERE id=$1", [old]);
    assert.equal(recovered.had_rejection, true);
    assert.equal(recovered.auto_review_status, "manual");
    assert.ok(recovered.auto_review_reasons.includes(reviewReasons.rejected));
    assert.equal(
      (await one(db, "SELECT * FROM reports WHERE id=$1", [normal]))
        .auto_review_status,
      "manual",
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("manual approval and multiple automatic runners race without duplicate wages", async () => {
  await settings({ delayMinutes: 0 });
  const r = await report();
  const responses = await Promise.all([
    runAutoReview(pool, { trigger: "timer" }),
    runAutoReview(pool, { trigger: "startup" }),
    ok("POST", `/reports/${r.id}/approve`, { requestId: id() }, quality),
  ]);
  assert.equal((await wages(r.id)).length, 1);
  assert.equal((await current(r.id)).status, "approved");
  assert.ok(
    responses
      .slice(0, 2)
      .every((r) => ["completed", "skipped"].includes(r.status)),
  );
  await run();
  assert.equal((await wages(r.id)).length, 1);
});

test("payroll failure rolls back approval, records an error run and leaves the report for manual recovery", async () => {
  await settings({ delayMinutes: 0 });
  const r = await report();
  await pool.query(
    "CREATE FUNCTION reject_auto_wage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected payroll failure'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER auto_payroll_failure BEFORE INSERT ON payroll FOR EACH ROW EXECUTE FUNCTION reject_auto_wage()",
  );
  try {
    const result = await run();
    assert.equal(result.status, "failed");
    assert.equal(result.errorCount, 1);
    assert.equal(result.approvedCount, 0);
    assert.equal(result.manualCount, 1);
    const saved = await current(r.id);
    assert.equal(saved.status, "complete");
    assert.equal(saved.approval_mode, null);
    assert.equal(saved.auto_review_status, "manual");
    assert.ok(saved.auto_review_reasons.includes(reviewReasons.failure));
    assert.equal((await wages(r.id)).length, 0);
  } finally {
    await pool.query("DROP TRIGGER auto_payroll_failure ON payroll");
    await pool.query("DROP FUNCTION reject_auto_wage()");
  }
  assert.equal((await run()).approvedCount, 0);
  await ok("POST", `/reports/${r.id}/approve`, { requestId: id() }, quality);
  assert.equal((await wages(r.id)).length, 1);
});

test("transient database errors roll back wages and retry automatically after recovery", async () => {
  await settings({ delayMinutes: 0 });
  const r = await report();
  await pool.query(
    "CREATE FUNCTION timeout_auto_wage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected query timeout' USING ERRCODE='57014'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER auto_payroll_timeout BEFORE INSERT ON payroll FOR EACH ROW EXECUTE FUNCTION timeout_auto_wage()",
  );
  try {
    const result = await run();
    assert.equal(result.status, "failed");
    assert.equal(result.errorCount, 1);
    assert.equal(result.manualCount, 0);
    assert.equal((await current(r.id)).auto_review_status, "pending");
    assert.equal((await current(r.id)).status, "complete");
    assert.equal((await wages(r.id)).length, 0);
  } finally {
    await pool.query("DROP TRIGGER auto_payroll_timeout ON payroll");
    await pool.query("DROP FUNCTION timeout_auto_wage()");
  }
  assert.equal((await run()).approvedCount, 1);
  assert.equal((await wages(r.id)).length, 1);
});

test("keyset batches preserve microseconds and inspect exceptions beyond a page of waiting reports", async () => {
  const first = await report();
  const source = await current(first.id);
  const adminId = (await ok("GET", "/auth/me")).user.id;
  // Isolated persisted queue fixtures use distinct work orders, tasks and sources.
  // They deliberately share one microsecond timestamp to exercise cursor ties.
  const at = (
    await pool.query(
      "SELECT completed_at::text AS at FROM reports WHERE id=$1",
      [first.id],
    )
  ).rows[0].at;
  for (let n = 0; n < 205; n++) {
    const workId = id(),
      taskId = id(),
      reportId = id();
    await pool.query(
      "INSERT INTO work_orders(id,code,product_id,quantity,good_quantity,status,created_by) VALUES($1,$2,$3,1,1,'complete',$4)",
      [workId, "BATCH-" + workId, first.work.productId, adminId],
    );
    await pool.query(
      "INSERT INTO tasks(id,work_order_id,sequence,name,unit_price,expected_minutes,status,completed_quantity) VALUES($1,$2,1,'加工',2,1,'complete',1)",
      [taskId, workId],
    );
    await pool.query(
      "INSERT INTO reports(id,task_id,work_order_id,worker_id,received_quantity,quantity,status,started_at,completed_at,auto_review_status,auto_review_eligible_at,auto_review_rule_revision) VALUES($1,$2,$3,$4,1,$5,'complete',$6,$7,'pending',$7::timestamptz+interval '5 minutes',1)",
      [
        reportId,
        taskId,
        workId,
        operatorId,
        n === 204 ? 0 : 1,
        source.started_at,
        at,
      ],
    );
  }
  const result = await run();
  assert.equal(result.scannedCount, 206);
  assert.equal(result.manualCount, 1);
  assert.equal(result.skippedCount, 205);
  assert.equal(result.errorCount, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) AS n FROM auto_review_attempts WHERE run_id=$1",
        [result.id],
      )
    ).rows[0].n,
    206,
  );
  await settings({ delayMinutes: 0 });
  assert.equal((await run()).approvedCount, 205);
  assert.equal(
    (await pool.query("SELECT count(*) AS n FROM payroll")).rows[0].n,
    205,
  );
});

test("disabling waits for an in-flight automatic transaction and forbids approvals after its response", async () => {
  await settings({ delayMinutes: 0 });
  const r = await report();
  const gate = await pool.connect();
  await gate.query("SELECT pg_advisory_lock(78239812)");
  await pool.query(
    "CREATE FUNCTION gate_auto_wage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(78239812); RETURN NEW; END $$",
  );
  await pool.query(
    "CREATE TRIGGER auto_payroll_gate BEFORE INSERT ON payroll FOR EACH ROW EXECUTE FUNCTION gate_auto_wage()",
  );
  let running: Promise<any> | undefined, disabling: Promise<any> | undefined;
  try {
    running = run();
    await until(
      async () =>
        !!(
          await pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=78239812 AND NOT granted",
          )
        ).rowCount,
      "worker did not reach gated payroll insert",
    );
    let disabled = false;
    disabling = settings({ enabled: false }).then((result) => {
      disabled = true;
      return result;
    });
    await pause(100);
    assert.equal(
      disabled,
      false,
      "configuration must wait for active review transaction",
    );
    await gate.query("SELECT pg_advisory_unlock(78239812)");
    assert.equal((await running).approvedCount, 1);
    assert.equal((await disabling).settings.enabled, false);
    assert.equal((await wages(r.id)).length, 1);
  } finally {
    await gate.query("SELECT pg_advisory_unlock(78239812)");
    gate.release();
    await Promise.allSettled([running, disabling].filter(Boolean));
    await pool.query("DROP TRIGGER auto_payroll_gate ON payroll");
    await pool.query("DROP FUNCTION gate_auto_wage()");
  }
  const later = await report();
  assert.equal((await run()).status, "skipped");
  assert.equal((await wages(later.id)).length, 0);
});

test("server startup catches up without a browser and shutdown waits for the active review transaction", async () => {
  await settings({ delayMinutes: 0 });
  const r = await report();
  assert.equal(
    (await pool.query("SELECT count(*) AS n FROM auto_review_runs")).rows[0].n,
    0,
    "createApp defaults to no worker",
  );
  await app.close();
  const gate = await pool.connect();
  await gate.query("SELECT pg_advisory_lock(78239813)");
  await pool.query(
    "CREATE FUNCTION gate_startup_wage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(78239813); RETURN NEW; END $$",
  );
  await pool.query(
    "CREATE TRIGGER startup_payroll_gate BEFORE INSERT ON payroll FOR EACH ROW EXECUTE FUNCTION gate_startup_wage()",
  );
  let closing: Promise<void> | undefined;
  try {
    app = await createApp({ pool, origins: [origin], autoReviewWorker: true });
    await app.ready();
    await until(
      async () =>
        !!(
          await pool.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=78239813 AND NOT granted",
          )
        ).rowCount,
      "startup worker did not start",
    );
    let closed = false;
    closing = app.close().then(() => {
      closed = true;
    });
    await pause(100);
    assert.equal(closed, false);
    await gate.query("SELECT pg_advisory_unlock(78239813)");
    await closing;
    assert.equal((await wages(r.id)).length, 1);
    const run = await one(
      pool,
      "SELECT * FROM auto_review_runs ORDER BY started_at DESC LIMIT 1",
    );
    assert.equal(run.trigger, "startup");
    assert.equal(run.status, "completed");
  } finally {
    await gate.query("SELECT pg_advisory_unlock(78239813)");
    gate.release();
    await closing;
    await pool.query("DROP TRIGGER startup_payroll_gate ON payroll");
    await pool.query("DROP FUNCTION gate_startup_wage()");
  }
});
