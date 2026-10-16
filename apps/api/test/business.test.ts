import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import { createPool, id, transaction } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
import { migrate } from "../src/migrate.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "TEST_DATABASE_URL must explicitly name a dedicated *_test database",
  );
const pool = createPool(url);
let app: FastifyInstance;
let admin: string, operator: string, viewer: string, quality: string;
let operatorId: string;
const origin = "http://localhost:5173";
async function call(
  method: any,
  path: string,
  payload?: unknown,
  cookie = admin,
) {
  return app.inject({
    method,
    url: "/api" + path,
    headers: { origin, cookie },
    payload: payload as any,
  });
}
async function ok(
  method: any,
  path: string,
  payload?: unknown,
  cookie = admin,
) {
  const result = await call(method, path, payload, cookie);
  assert.equal(result.statusCode, 200, `${method} ${path} ${result.body}`);
  return result.json();
}
async function login(username: string) {
  const result = await call(
    "POST",
    "/auth/login",
    { username, password: "MesDemo2026!" },
    "",
  );
  assert.equal(result.statusCode, 200, result.body);
  return String(result.headers["set-cookie"]).split(";")[0];
}
before(async () => {
  process.env.FILE_STORAGE_DIR = await mkdtemp(
    join(tmpdir(), "mes-api-files-test-"),
  );
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
  await pool.query("INSERT INTO auto_review_settings(id) VALUES(true)");
  const hash = await hashPassword("MesDemo2026!");
  for (const role of ["admin", "operator", "viewer", "quality"]) {
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
  viewer = await login("viewer");
  quality = await login("quality");
});
afterEach(async () => {
  await app.close();
});
after(async () => {
  await pool.end();
  if (process.env.FILE_STORAGE_DIR)
    await rm(process.env.FILE_STORAGE_DIR, { recursive: true, force: true });
});
async function setup(steps = 1, quantity = 100) {
  const c = await ok("POST", "/resources/customers", {
    name: "测试客户",
    data: {},
  });
  const p = await ok("POST", "/products", {
    code: "P-" + id().slice(0, 6),
    name: "测试产品",
    unit: "件",
    safetyStock: 0,
    steps: Array.from({ length: steps }, (_, i) => ({
      name: "工序" + (i + 1),
      unitPrice: 2,
      expectedMinutes: 1,
    })),
  });
  const so = await ok("POST", "/sales-orders", {
    customerId: c.id,
    items: [{ productId: p.id, quantity: quantity * 3, unitPrice: 10 }],
  });
  const w = await ok("POST", "/work-orders", {
    productId: p.id,
    salesOrderId: so.id,
    quantity,
  });
  return { c, p, so, w };
}
async function finish(w: any, count = w.quantity, cookie = operator) {
  const reports = [];
  for (const t of w.tasks) {
    const r = await ok(
      "POST",
      `/tasks/${t.id}/receive`,
      { requestId: id() },
      cookie,
    );
    await ok("POST", `/reports/${r.id}/start`, {}, cookie);
    await ok(
      "POST",
      `/reports/${r.id}/complete`,
      { quantity: count, requestId: id() },
      cookie,
    );
    reports.push(r);
  }
  return reports;
}
async function transition(key: string, r: any, action: string, extra = {}) {
  return ok("POST", `/resources/${key}/${r.id}/transition`, {
    action,
    revision: r.revision,
    ...extra,
  });
}
test("authentication, CSRF and functional/object permissions are enforced", async () => {
  assert.equal((await app.inject({ url: "/api/products" })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "MesDemo2026!" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "https://evil.example" },
        payload: { username: "admin", password: "MesDemo2026!" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("POST", "/products", { name: "denied" }, viewer)).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/users", undefined, operator)).statusCode,
    403,
  );
  const lookup = await ok("GET", "/lookups/users", undefined, operator);
  assert.ok(
    lookup.items.every((u: any) => !("passwordHash" in u) && !("role" in u)),
  );
  const { w } = await setup();
  const r = await ok("POST", `/tasks/${w.tasks[0].id}/receive`, {
    requestId: id(),
  });
  assert.equal(
    (await call("POST", `/reports/${r.id}/start`, {}, operator)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/reports/${r.id}/approve`,
        { requestId: id() },
        operator,
      )
    ).statusCode,
    403,
  );
});
test("partial completion and process snapshots preserve production and order-isolated inventory", async () => {
  const { p, c, so, w } = await setup(2);
  const originalTasks = w.tasks;
  await ok("PATCH", `/products/${p.id}`, {
    code: p.code,
    name: p.name,
    unit: "件",
    safetyStock: 0,
    revision: p.revision,
    steps: [{ name: "新工序", unitPrice: 99, expectedMinutes: 1 }],
  });
  let r = await ok(
    "POST",
    `/tasks/${w.tasks[0].id}/receive`,
    { quantity: 40, requestId: id() },
    operator,
  );
  await ok("POST", `/reports/${r.id}/start`, {}, operator);
  await ok(
    "POST",
    `/reports/${r.id}/complete`,
    { quantity: 40, requestId: id() },
    operator,
  );
  let detail = await ok("GET", `/work-orders/${w.id}`);
  assert.equal(detail.tasks[0].status, "ready");
  assert.equal(detail.tasks[0].availableQuantity, 60);
  assert.equal(detail.tasks[1].status, "blocked");
  assert.equal(detail.tasks[0].unitPrice, 2);
  assert.equal(detail.tasks.length, originalTasks.length);
  r = await ok(
    "POST",
    `/tasks/${w.tasks[0].id}/receive`,
    { requestId: id() },
    operator,
  );
  await ok("POST", `/reports/${r.id}/start`, {}, operator);
  await ok(
    "POST",
    `/reports/${r.id}/complete`,
    { quantity: 60, requestId: id() },
    operator,
  );
  detail = await ok("GET", `/work-orders/${w.id}`);
  assert.equal(detail.tasks[1].status, "ready");
  await finish({ ...w, tasks: [w.tasks[1]] });
  const movement = {
    productId: p.id,
    salesOrderId: so.id,
    direction: "in",
    quantity: 80,
    requestId: id(),
  };
  await ok("POST", "/stock-movements", movement);
  const so2 = await ok("POST", "/sales-orders", {
    customerId: c.id,
    items: [{ productId: p.id, quantity: 100 }],
  });
  const w2 = await ok("POST", "/work-orders", {
    productId: p.id,
    salesOrderId: so2.id,
    quantity: 30,
  });
  await finish(w2, 30);
  await ok("POST", "/stock-movements", {
    productId: p.id,
    salesOrderId: so2.id,
    direction: "in",
    quantity: 20,
    requestId: id(),
  });
  const inv = await ok("GET", "/inventory");
  const a = inv.items.find((v: any) => v.salesOrderId === so.id),
    b = inv.items.find((v: any) => v.salesOrderId === so2.id);
  assert.equal(a.quantity, 80);
  assert.equal(a.availableToReceive, 20);
  assert.equal(b.quantity, 20);
  assert.equal(b.availableToReceive, 10);
  assert.equal(
    (
      await call("POST", "/stock-movements", {
        ...movement,
        quantity: 21,
        requestId: id(),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", "/stock-movements", {
        productId: p.id,
        salesOrderId: so2.id,
        direction: "out",
        quantity: 21,
        requestId: id(),
      })
    ).statusCode,
    409,
  );
  const dashboard = await ok("GET", "/dashboard");
  assert.equal(dashboard.metrics.todayCompleted, 130);
});
test("concurrent claims and stock decrements are serialized, duplicate actions have one effect", async () => {
  const { p, so, w } = await setup();
  const rid = id();
  const responses = await Promise.all([
    call(
      "POST",
      `/tasks/${w.tasks[0].id}/receive`,
      { requestId: rid },
      operator,
    ),
    call(
      "POST",
      `/tasks/${w.tasks[0].id}/receive`,
      { requestId: rid },
      operator,
    ),
  ]);
  assert.deepEqual(
    responses.map((r) => r.statusCode),
    [200, 200],
  );
  assert.equal(responses[0].json().id, responses[1].json().id);
  const report = responses[0].json();
  await ok("POST", `/reports/${report.id}/start`, {}, operator);
  await ok(
    "POST",
    `/reports/${report.id}/complete`,
    { quantity: 100, requestId: id() },
    operator,
  );
  const approvals = await Promise.all([
    call("POST", `/reports/${report.id}/approve`, { requestId: id() }),
    call("POST", `/reports/${report.id}/approve`, { requestId: id() }),
  ]);
  assert.ok(approvals.every((r) => r.statusCode === 200));
  assert.equal(
    (
      await pool.query("SELECT count(*) FROM payroll WHERE source_id=$1", [
        report.id,
      ])
    ).rows[0].count,
    1,
  );
  const receive = {
    productId: p.id,
    salesOrderId: so.id,
    direction: "in",
    quantity: 100,
    requestId: id(),
  };
  const first = await ok("POST", "/stock-movements", receive);
  const again = await ok("POST", "/stock-movements", receive);
  assert.equal(first.id, again.id);
  assert.equal(
    (await call("POST", "/stock-movements", { ...receive, quantity: 50 }))
      .statusCode,
    409,
  );
  const out = () =>
    call("POST", "/stock-movements", {
      ...receive,
      direction: "out",
      quantity: 60,
      requestId: id(),
    });
  const exits = await Promise.all([out(), out()]);
  assert.deepEqual(exits.map((r) => r.statusCode).sort(), [200, 409]);
  const inventory = await ok("GET", "/inventory");
  assert.equal(inventory.items[0].quantity, 40);
});
test("payroll failure rolls back approval and audit in the same real database transaction", async () => {
  const { w } = await setup();
  const [r] = await finish(w);
  await pool.query(
    "CREATE FUNCTION test_payroll_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected payroll failure'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER test_failure BEFORE INSERT ON payroll FOR EACH ROW EXECUTE FUNCTION test_payroll_fail()",
  );
  try {
    assert.equal(
      (await call("POST", `/reports/${r.id}/approve`, { requestId: id() }))
        .statusCode,
      500,
    );
    assert.equal(
      (await pool.query("SELECT status FROM reports WHERE id=$1", [r.id]))
        .rows[0].status,
      "complete",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action='approve'",
          [r.id],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await pool.query("DROP TRIGGER test_failure ON payroll");
    await pool.query("DROP FUNCTION test_payroll_fail()");
  }
  await ok("POST", `/reports/${r.id}/approve`, { requestId: id() });
  assert.equal(
    (await pool.query("SELECT amount FROM payroll WHERE source_id=$1", [r.id]))
      .rows[0].amount,
    200,
  );
});
test("full scrap permits zero-good completion with explicit traceable salary adjustments", async () => {
  const { p, so, w } = await setup(1, 10);
  const r = await ok(
    "POST",
    `/tasks/${w.tasks[0].id}/receive`,
    { requestId: id() },
    operator,
  );
  await ok("POST", `/reports/${r.id}/start`, {}, operator);
  const scrap = await ok("POST", "/scraps", {
    workOrderId: w.id,
    taskId: w.tasks[0].id,
    reportId: r.id,
    quantity: 10,
    reason: "全部来料缺陷",
    responsibleUserId: operatorId,
    requestId: id(),
  });
  assert.equal(
    (
      await call("POST", `/scraps/${scrap.id}/approve`, {
        requestId: id(),
        deductionUnitPrice: 1,
        rewardUnitPrice: 0.5,
      })
    ).statusCode,
    409,
  );
  await ok("POST", `/scraps/${scrap.id}/approve`, {
    requestId: id(),
    deductionUnitPrice: 1,
    rewardUnitPrice: 0,
  });
  await ok(
    "POST",
    `/reports/${r.id}/complete`,
    { quantity: 0, requestId: id() },
    operator,
  );
  const detail = await ok("GET", `/work-orders/${w.id}`);
  assert.equal(detail.status, "complete");
  assert.equal(detail.goodQuantity, 0);
  assert.equal(
    (
      await call("POST", "/stock-movements", {
        productId: p.id,
        salesOrderId: so.id,
        direction: "in",
        quantity: 1,
        requestId: id(),
      })
    ).statusCode,
    409,
  );
  const wages = (
    await pool.query("SELECT source_type,amount FROM payroll ORDER BY amount")
  ).rows;
  assert.deepEqual(
    wages.map((w) => w.amount),
    [-10],
  );
});
test("catalog references, stale revisions and approved material stock effects cannot be bypassed", async () => {
  const material = await ok("POST", "/resources/materials", {
    name: "铝料",
    data: { unit: "kg" },
  });
  const create = await call("POST", "/resources/materials", {
    name: "invalid",
    status: "approved",
    data: { unit: "kg" },
  });
  assert.equal(create.statusCode, 400);
  let receipt = await ok("POST", "/resources/purchase-receipts", {
    name: "收货",
    data: { materialId: material.id, quantity: 10, receivedDate: "2026-10-14" },
  });
  receipt = await transition("purchase-receipts", receipt, "submit");
  receipt = await transition("purchase-receipts", receipt, "approve");
  assert.equal(
    (
      await call("PATCH", `/resources/purchase-receipts/${receipt.id}`, {
        name: "篡改",
        revision: receipt.revision,
        data: receipt.data,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("DELETE", `/resources/materials/${material.id}`, {
        revision: material.revision,
      })
    ).statusCode,
    409,
  );
  let issue = await ok("POST", "/resources/purchase-issues", {
    name: "领料",
    data: { materialId: material.id, quantity: 11, receiverId: operatorId },
  });
  issue = await transition("purchase-issues", issue, "submit");
  assert.equal(
    (
      await call("POST", `/resources/purchase-issues/${issue.id}/transition`, {
        action: "approve",
        revision: issue.revision,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await ok("GET", `/resources/purchase-issues/${issue.id}`)).status,
    "submitted",
  );
  assert.equal((await ok("GET", "/material-inventory")).items[0].quantity, 10);
  assert.equal(
    (
      await call("PATCH", `/resources/materials/${material.id}`, {
        name: "stale",
        revision: 99,
        data: { unit: "kg" },
      })
    ).statusCode,
    409,
  );
});
test("hours and safety approvals create exact signed, source-unique wages and ownership is enforced", async () => {
  const adminId = (await ok("GET", "/auth/me")).user.id;
  assert.equal(
    (
      await call(
        "POST",
        "/resources/work-hours",
        {
          name: "他人工时",
          data: {
            userId: adminId,
            workDate: "2026-10-14",
            hours: 8,
            hourlyRate: 20,
            description: "test",
          },
        },
        operator,
      )
    ).statusCode,
    403,
  );
  let hours = await ok(
    "POST",
    "/resources/work-hours",
    {
      name: "辅助工时",
      data: {
        userId: operatorId,
        workDate: "2026-10-14",
        hours: 8,
        hourlyRate: 20,
        description: "整理车间",
      },
    },
    operator,
  );
  hours = await transition("work-hours", hours, "submit");
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-hours/${hours.id}/transition`,
        { action: "approve", revision: hours.revision },
        operator,
      )
    ).statusCode,
    403,
  );
  hours = await transition("work-hours", hours, "approve");
  assert.equal(
    (
      await call("POST", `/resources/work-hours/${hours.id}/transition`, {
        action: "approve",
        revision: hours.revision,
      })
    ).statusCode,
    409,
  );
  let penalty = await ok("POST", "/resources/safety-penalties", {
    name: "安全处罚",
    data: {
      userId: operatorId,
      reason: "未按规定防护",
      amount: 15,
      kind: "penalty",
    },
  });
  penalty = await transition("safety-penalties", penalty, "submit");
  await transition("safety-penalties", penalty, "approve");
  const wages = await ok("GET", "/payroll?month=2026-10", undefined, operator);
  assert.equal(
    wages.items.reduce((a: number, b: any) => a + b.amount, 0),
    145,
  );
});
test("rejected report can be resubmitted by owner; disabling user revokes sessions", async () => {
  const { w } = await setup();
  const [r] = await finish(w);
  await ok("POST", `/reports/${r.id}/reject`, { reason: "待核实记录" });
  await ok(
    "POST",
    `/reports/${r.id}/resubmit`,
    { reason: "已经核实" },
    operator,
  );
  await ok("POST", `/reports/${r.id}/approve`, { requestId: id() });
  assert.equal(
    (await ok("GET", "/payroll", undefined, operator)).items.length,
    1,
  );
  await ok("PATCH", `/users/${operatorId}`, { active: false });
  assert.equal(
    (await call("GET", "/auth/me", undefined, operator)).statusCode,
    401,
  );
});
test("all collection endpoints execute against PostgreSQL and impossible dates are rejected", async () => {
  await setup();
  for (const endpoint of [
    "/health",
    "/catalog",
    "/products?q=测试",
    "/sales-orders",
    "/work-orders",
    "/reports",
    "/scraps",
    "/inventory",
    "/stock-movements",
    "/payroll",
    "/audit-logs",
    "/users",
    "/lookups/users",
    "/dashboard",
    "/material-inventory",
    "/resources/customers",
    "/telemetry/devices",
  ])
    await ok("GET", endpoint);
  const result = await call("POST", "/resources/safety-checklists", {
    name: "非法日期",
    data: { checkDate: "2026-02-31", description: "不应创建" },
  });
  assert.equal(result.statusCode, 400);
});

test("attachments validate references and device code/telemetry identifiers share one namespace", async () => {
  const boundary = "mes-next-boundary";
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="instructions.txt"\r\nContent-Type: text/plain\r\n\r\nSafe operating procedure.\r\n--${boundary}--\r\n`,
  );
  const upload = await app.inject({
    method: "POST",
    url: "/api/files",
    headers: {
      origin,
      cookie: admin,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const file = upload.json();
  const doc = await ok("POST", "/resources/documents", {
    name: "作业指导书",
    data: { version: "1.0", content: "参见附件", attachmentIds: [file.id] },
  });
  assert.deepEqual(doc.data.attachmentIds, [file.id]);
  const invalid = await call("POST", "/resources/documents", {
    name: "不存在的附件",
    data: { version: "1.0", content: "test", attachmentIds: [id()] },
  });
  assert.equal(invalid.statusCode, 400);
  const downloaded = await ok("GET", `/files/${file.id}/info`);
  assert.equal(downloaded.name, "instructions.txt");
  await ok("POST", "/resources/devices", {
    name: "设备一",
    code: "DEV-A",
    data: { deviceNo: "MQTT-A" },
  });
  assert.equal(
    (
      await call("POST", "/resources/devices", {
        name: "设备二",
        code: "MQTT-A",
        data: {},
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", "/resources/devices", {
        name: "设备三",
        code: "DEV-C",
        data: { deviceNo: "DEV-A" },
      })
    ).statusCode,
    409,
  );
});

test("SSE connections are authenticated and do not block graceful shutdown", async () => {
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  const response = await fetch(`${base}/api/events`, {
    headers: { cookie: admin },
  });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const chunk = await reader.read();
  assert.match(Buffer.from(chunk.value!).toString(), /connected/);
  const timer = setTimeout(() => {
    throw new Error("SSE shutdown exceeded 2 seconds");
  }, 2000);
  timer.unref();
  try {
    await app.close();
    await reader.cancel();
  } finally {
    clearTimeout(timer);
  }
});

test("pending scraps prevent closure and legacy closed orders cannot be reopened by approval", async () => {
  const { w } = await setup(1, 10);
  const scrap = await ok("POST", "/scraps", {
    workOrderId: w.id,
    quantity: 10,
    reason: "全量报废",
    requestId: id(),
  });
  assert.equal(
    (await call("POST", `/work-orders/${w.id}/close`, { reason: "取消生产" }))
      .statusCode,
    409,
  );
  await pool.query("UPDATE work_orders SET status='closed' WHERE id=$1", [
    w.id,
  ]);
  assert.equal(
    (await call("POST", `/scraps/${scrap.id}/approve`, { requestId: id() }))
      .statusCode,
    409,
  );
  const detail = await ok("GET", `/work-orders/${w.id}`);
  assert.equal(detail.status, "closed");
  assert.equal(detail.goodQuantity, 10);
});

test("salary source catalogs enforce the same per-user privacy as payroll", async () => {
  const adminId = (await ok("GET", "/auth/me")).user.id;
  const ownHours = await ok(
    "POST",
    "/resources/work-hours",
    {
      name: "自己的工时",
      data: {
        userId: operatorId,
        workDate: "2026-10-14",
        hours: 1,
        hourlyRate: 20,
        description: "自己的任务",
      },
    },
    operator,
  );
  const otherHours = await ok("POST", "/resources/work-hours", {
    name: "他人的工时",
    data: {
      userId: adminId,
      workDate: "2026-10-14",
      hours: 2,
      hourlyRate: 80,
      description: "其他任务",
    },
  });
  const otherPenalty = await ok("POST", "/resources/safety-penalties", {
    name: "他人的奖惩",
    data: { userId: adminId, reason: "奖金", kind: "reward", amount: 100 },
  });
  const visible = await ok("GET", "/resources/work-hours", undefined, operator);
  assert.deepEqual(
    visible.items.map((r: any) => r.id),
    [ownHours.id],
  );
  assert.equal(
    (
      await call(
        "GET",
        `/resources/work-hours/${otherHours.id}`,
        undefined,
        operator,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "GET",
        `/resources/safety-penalties/${otherPenalty.id}`,
        undefined,
        operator,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/resources/work-hours", undefined, viewer)).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/resources/safety-penalties", undefined, quality))
      .statusCode,
    403,
  );
});

test("assigned work tasks require a scoped, current-round execution feedback before approval", async () => {
  let task = await ok("POST", "/resources/work-tasks", {
    name: "主管派发整理任务",
    data: {
      assigneeId: operatorId,
      description: "整理工位",
      result: "草稿预填不能代替办理",
    },
  });
  task = await transition("work-tasks", task, "submit");
  assert.equal(
    (
      await call("POST", `/resources/work-tasks/${task.id}/transition`, {
        action: "approve",
        revision: task.revision,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-tasks/${task.id}/feedback`,
        { revision: task.revision, feedback: "代办" },
        quality,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-tasks/${task.id}/feedback`,
        { revision: task.revision, feedback: " " },
        operator,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-tasks/${task.id}/feedback`,
        { revision: task.revision, feedback: "完成", name: "任意改名" },
        operator,
      )
    ).statusCode,
    400,
  );
  const beforeRevision = task.revision;
  task = await ok(
    "POST",
    `/resources/work-tasks/${task.id}/feedback`,
    { revision: task.revision, feedback: "已整理并清扫，工具归位" },
    operator,
  );
  assert.equal(task.data.result, "已整理并清扫，工具归位");
  assert.equal(task.feedbackBy, operatorId);
  assert.ok(task.feedbackAt);
  assert.equal(task.name, "主管派发整理任务");
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-tasks/${task.id}/feedback`,
        { revision: beforeRevision, feedback: "覆盖" },
        operator,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-tasks/${task.id}/transition`,
        { action: "approve", revision: task.revision },
        operator,
      )
    ).statusCode,
    403,
  );
  task = await transition("work-tasks", task, "reject", { notes: "补充结果" });
  task = await transition("work-tasks", task, "submit");
  assert.equal(task.feedbackAt, null);
  assert.equal(
    (
      await call("POST", `/resources/work-tasks/${task.id}/transition`, {
        action: "approve",
        revision: task.revision,
      })
    ).statusCode,
    409,
  );
  task = await ok("POST", `/resources/work-tasks/${task.id}/feedback`, {
    revision: task.revision,
    feedback: "主管复核已完成",
  });
  task = await transition("work-tasks", task, "approve");
  assert.equal(task.status, "approved");
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-tasks/${task.id}/feedback`,
        { revision: task.revision, feedback: "审批后篡改" },
        operator,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action='feedback'",
        [task.id],
      )
    ).rows[0].count,
    2,
  );
});

test("submitted andon calls can be resolved by their assignee without generic editing", async () => {
  const qualityId = (
    await pool.query("SELECT id FROM users WHERE username='quality'")
  ).rows[0].id;
  const station = await ok("POST", "/resources/workstations", {
    name: "安灯测试工位",
    data: {},
  });
  let event = await ok(
    "POST",
    "/resources/andon-events",
    {
      name: "工位质量呼叫",
      data: {
        workstationId: station.id,
        category: "quality",
        description: "尺寸异常",
        assigneeId: qualityId,
      },
    },
    operator,
  );
  event = await ok(
    "POST",
    `/resources/andon-events/${event.id}/transition`,
    { action: "submit", revision: event.revision },
    operator,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/andon-events/${event.id}/feedback`,
        { revision: event.revision, feedback: "呼叫人无受派授权" },
        operator,
      )
    ).statusCode,
    403,
  );
  event = await ok(
    "POST",
    `/resources/andon-events/${event.id}/feedback`,
    { revision: event.revision, feedback: "已复测并调整夹具" },
    quality,
  );
  assert.equal(event.data.resolution, "已复测并调整夹具");
  assert.equal(event.feedbackBy, qualityId);
  event = await transition("andon-events", event, "approve");
  assert.equal(event.status, "approved");
});
