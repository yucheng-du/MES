import { dispatchAndonNotifications } from "../src/management-parity.js";
import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createPool, id } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
import { migrate } from "../src/migrate.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("An isolated *_test database is required");
const pool = createPool(url);
let app: Awaited<ReturnType<typeof createApp>>,
  admin: string,
  operator: string,
  warehouse: string,
  uid: string;
const origin = "http://localhost:5173";
async function call(method: any, path: string, payload?: any, cookie = admin) {
  return app.inject({
    method,
    url: "/api" + path,
    headers: { origin, cookie },
    payload,
  });
}
async function ok(method: any, path: string, payload?: any, cookie = admin) {
  const res = await call(method, path, payload, cookie);
  assert.equal(res.statusCode, 200, `${path}: ${res.body}`);
  return res.json();
}
const record = (key: string, data: any = {}, cookie = admin) =>
  ok("POST", `/resources/${key}`, { name: key, data }, cookie);
const transition = (key: string, r: any, action: string, cookie = admin) =>
  ok(
    "POST",
    `/resources/${key}/${r.id}/transition`,
    { revision: r.revision, action },
    cookie,
  );
const action = (
  key: string,
  r: any,
  a: string,
  data: any = {},
  cookie = admin,
) =>
  ok(
    "POST",
    `/resources/${key}/${r.id}/actions/${a}`,
    { revision: r.revision, data },
    cookie,
  );
async function approve(key: string, r: any) {
  return transition(key, await transition(key, r, "submit"), "approve");
}
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query("TRUNCATE users CASCADE");
  await pool.query("INSERT INTO auto_review_settings(id) VALUES(true)");
  const hash = await hashPassword("Test-Password-2026!");
  for (const role of ["admin", "operator", "warehouse"]) {
    const u = id();
    if (role === "operator") uid = u;
    await pool.query(
      "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$2,$3,$2)",
      [u, role, hash],
    );
  }
  app = await createApp({ pool, origins: [origin] });
  for (const role of ["admin", "operator", "warehouse"]) {
    const r = await call(
      "POST",
      "/auth/login",
      { username: role, password: "Test-Password-2026!" },
      "",
    );
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    if (role === "admin") admin = cookie;
    if (role === "operator") operator = cookie;
    if (role === "warehouse") warehouse = cookie;
  }
});
afterEach(async () => {
  await app.close();
});
after(async () => pool.end());
test("multi-material purchasing, partial payments and receipt limits remain transactional", async () => {
  const a = await record("materials", { unit: "kg" }),
    b = await record("materials", { unit: "kg" }),
    supplier = await record("suppliers");
  let po = await approve(
    "purchase-orders",
    await record("purchase-orders", {
      supplierId: supplier.id,
      items: [
        { materialId: a.id, quantity: 5, unitPrice: 10 },
        { materialId: b.id, quantity: 2, unitPrice: 15 },
      ],
    }),
  );
  const activity = await ok(
    "GET",
    `/resources/purchase-orders/${po.id}/activity`,
  );
  assert.equal(activity.total, 80);
  po = await action("purchase-orders", po, "request-payment", {
    amount: 30,
    method: "bank",
    payee: "Demo supplier",
    account: "DEMO-ONLY",
  });
  assert.equal(
    (
      await call("POST", `/resources/purchase-orders/${po.id}/actions/pay`, {
        revision: po.revision,
        data: { notes: "early" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/purchase-orders/${po.id}/actions/approve-payment`,
        { revision: po.revision },
        warehouse,
      )
    ).statusCode,
    403,
  );
  po = await action("purchase-orders", po, "approve-payment");
  po = await action("purchase-orders", po, "pay", { notes: "Demo proof" });
  assert.equal(po.stage, "part-paid");
  assert.equal(
    (
      await call(
        "POST",
        `/resources/purchase-orders/${po.id}/actions/request-payment`,
        {
          revision: po.revision,
          data: { amount: 51, method: "cash", payee: "Demo", account: "Demo" },
        },
      )
    ).statusCode,
    409,
  );
  let receipt = await approve(
    "purchase-receipts",
    await record("purchase-receipts", {
      purchaseOrderId: po.id,
      materialId: b.id,
      quantity: 2,
      receivedDate: "2026-10-15",
    }),
  );
  assert.equal(receipt.status, "approved");
  receipt = await transition(
    "purchase-receipts",
    await record("purchase-receipts", {
      purchaseOrderId: po.id,
      materialId: b.id,
      quantity: 1,
      receivedDate: "2026-10-15",
    }),
    "submit",
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/purchase-receipts/${receipt.id}/transition`,
        { revision: receipt.revision, action: "approve" },
      )
    ).statusCode,
    409,
  );
});
test("hour application only pays after confirmed actual duration and cannot pay twice", async () => {
  const type = await record("work-hour-types", { hourlyRate: 24 });
  let r = await record(
    "work-hour-orders",
    { userId: uid, typeId: type.id, description: "Tool preparation" },
    operator,
  );
  r = await transition("work-hour-orders", r, "submit", operator);
  r = await transition("work-hour-orders", r, "approve");
  assert.equal((await pool.query("SELECT * FROM payroll")).rowCount, 0);
  r = await action(
    "work-hour-orders",
    r,
    "complete",
    {
      startedAt: "2026-10-14T08:00:00.000Z",
      endedAt: "2026-10-14T10:30:00.000Z",
      result: "Prepared",
    },
    operator,
  );
  const before = r;
  r = await action("work-hour-orders", r, "confirm", {
    startedAt: "2026-10-14T08:00:00.000Z",
    endedAt: "2026-10-14T10:00:00.000Z",
  });
  const wage = (await pool.query("SELECT * FROM payroll")).rows[0];
  assert.equal(wage.amount, 48);
  assert.equal(wage.quantity, 2);
  assert.equal(r.stage, "confirmed");
  assert.equal(
    (
      await call(
        "POST",
        `/resources/work-hour-orders/${r.id}/actions/confirm`,
        {
          revision: before.revision,
          data: {
            startedAt: "2026-10-14T08:00:00.000Z",
            endedAt: "2026-10-14T10:00:00.000Z",
          },
        },
      )
    ).statusCode,
    409,
  );
});
test("checklist snapshots survive template edits and require every item", async () => {
  const type = await record("device-types");
  const device = await record("devices", { deviceTypeId: type.id });
  let tpl = await record("device-inspection-templates", {
    deviceTypeId: type.id,
    title: "Guard",
    content: "Verify guard closed",
  });
  let r = await record(
    "inspection-records",
    { deviceId: device.id, assigneeId: uid, description: "Daily inspection" },
    operator,
  );
  r = await transition("inspection-records", r, "submit", operator);
  await ok("PATCH", `/resources/device-inspection-templates/${tpl.id}`, {
    name: tpl.name,
    revision: tpl.revision,
    data: { ...tpl.data, content: "Changed next time" },
  });
  const activity = await ok(
    "GET",
    `/resources/inspection-records/${r.id}/activity`,
  );
  assert.equal(activity.items[0].content, "Verify guard closed");
  r = await action("inspection-records", r, "start", {}, operator);
  assert.equal(
    (
      await call(
        "POST",
        `/resources/inspection-records/${r.id}/actions/complete`,
        { revision: r.revision, data: { result: "Done" } },
        operator,
      )
    ).statusCode,
    409,
  );
  r = await action(
    "inspection-records",
    r,
    "check-item",
    { itemId: activity.items[0].id, result: "Closed" },
    operator,
  );
  r = await action(
    "inspection-records",
    r,
    "complete",
    { result: "All checked" },
    operator,
  );
  r = await transition("inspection-records", r, "approve");
  assert.equal(r.stage, "confirmed");
});
test("mold mount exclusivity and maintenance lifecycle enforce state", async () => {
  const device = await record("devices");
  let mold = await record("molds"),
    other = await record("molds");
  mold = await action("molds", mold, "mount", { deviceId: device.id });
  assert.equal(
    (
      await call("POST", `/resources/molds/${other.id}/actions/mount`, {
        revision: other.revision,
        data: { deviceId: device.id },
      })
    ).statusCode,
    409,
  );
  mold = await action("molds", mold, "unmount", { notes: "Service due" });
  assert.equal(mold.data.lifecycle, "pending-maintenance");
  let repair = await approve(
    "mold-maintenance",
    await record("mold-maintenance", {
      moldId: mold.id,
      description: "Cleaning",
      operation: "maintenance",
    }),
  );
  repair = await action("mold-maintenance", repair, "start");
  repair = await action("mold-maintenance", repair, "complete", {
    result: "Cleaned",
  });
  mold = await ok("GET", `/resources/molds/${mold.id}`);
  assert.equal(mold.data.lifecycle, "available");
});
test("task co-assignee progress, completion, approval and quality reward wages", async () => {
  let task = await record("work-tasks", {
    assigneeId: uid,
    description: "Review fixture",
  });
  task = await transition("work-tasks", task, "submit");
  task = await action("work-tasks", task, "start", {}, operator);
  task = await action(
    "work-tasks",
    task,
    "progress",
    { percent: 50, content: "Half checked" },
    operator,
  );
  task = await action(
    "work-tasks",
    task,
    "complete",
    { result: "Ready" },
    operator,
  );
  task = await transition("work-tasks", task, "approve");
  assert.equal(task.stage, "confirmed");
  const reward = await approve(
    "quality-rewards",
    await record("quality-rewards", {
      userId: uid,
      amount: 12.5,
      reason: "Defect found",
    }),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT amount FROM payroll WHERE source_type='quality-reward' AND source_id=$1",
        [reward.id],
      )
    ).rows[0].amount,
    12.5,
  );
});
test("nested references, computed fields and department cycles are protected", async () => {
  const material = await record("materials", { unit: "kg" });
  const supplier = await record("suppliers");
  await record("purchase-orders", {
    supplierId: supplier.id,
    items: [{ materialId: material.id, quantity: 1, unitPrice: 1 }],
  });
  assert.equal(
    (
      await call("DELETE", `/resources/materials/${material.id}`, {
        revision: material.revision,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", "/resources/devices", {
        name: "Fake lifecycle",
        data: { lifecycle: "scrapped" },
      })
    ).statusCode,
    400,
  );
  const a = await record("departments");
  const b = await record("departments", { parentId: a.id });
  assert.equal(
    (
      await call("PATCH", `/resources/departments/${a.id}`, {
        name: a.name,
        revision: a.revision,
        data: { parentId: b.id },
      })
    ).statusCode,
    409,
  );
});
test("contract totals, reimbursement deduplication and consumable cost averaging", async () => {
  const contract = await record("contracts", {
    type: "purchase",
    counterparty: "Demo",
    amount: 25,
    items: [{ productName: "Example", quantity: 2, unitPrice: 12.5 }],
  });
  assert.equal(contract.data.totalAmount, 25);
  const supplier = await record("suppliers"),
    material = await record("materials", { unit: "kg" });
  let po = await approve(
    "purchase-orders",
    await record("purchase-orders", {
      supplierId: supplier.id,
      materialId: material.id,
      quantity: 2,
      unitPrice: 10,
    }),
  );
  po = await action("purchase-orders", po, "request-payment", {
    amount: 20,
    method: "cash",
    payee: "Demo",
    account: "Demo",
  });
  po = await action("purchase-orders", po, "approve-payment");
  po = await action("purchase-orders", po, "pay", { notes: "Paid" });
  assert.equal(po.stage, "paid");
  await approve(
    "reimbursements",
    await record("reimbursements", { purchaseOrderIds: [po.id], amount: 20 }),
  );
  const duplicate = await transition(
    "reimbursements",
    await record("reimbursements", { purchaseOrderId: po.id, amount: 1 }),
    "submit",
  );
  assert.equal(
    (
      await call(
        "POST",
        `/resources/reimbursements/${duplicate.id}/transition`,
        { revision: duplicate.revision, action: "approve" },
      )
    ).statusCode,
    409,
  );
  const aux = await record("auxiliary-materials", { unit: "box" });
  await approve(
    "auxiliary-receipts",
    await record("auxiliary-receipts", {
      auxiliaryMaterialId: aux.id,
      quantity: 2,
      unitPrice: 10,
    }),
  );
  await approve(
    "auxiliary-receipts",
    await record("auxiliary-receipts", {
      auxiliaryMaterialId: aux.id,
      quantity: 3,
      unitPrice: 20,
    }),
  );
  assert.equal(
    (await ok("GET", `/resources/auxiliary-materials/${aux.id}`)).data
      .averageUnitPrice,
    16,
  );
});
test("business attachments exclude personnel documents and explicit permission denial wins", async () => {
  const fid = id();
  await pool.query(
    "INSERT INTO uploaded_files(id,name,mime,size,sha256,uploaded_by,visibility) VALUES($1,'private.txt','text/plain',5,'demo',$2,'personnel')",
    [fid, uid],
  );
  assert.equal(
    (
      await call("POST", "/resources/customers", {
        name: "Demo",
        data: { attachmentIds: [fid] },
      })
    ).statusCode,
    400,
  );
  await pool.query(
    "UPDATE users SET allowed_permissions=ARRAY['resources:work-tasks:write'],denied_permissions=ARRAY['resources:work-tasks:write'] WHERE id=$1",
    [uid],
  );
  assert.equal(
    (
      await call(
        "POST",
        "/resources/work-tasks",
        { name: "Denied", data: { assigneeId: uid, description: "Test" } },
        operator,
      )
    ).statusCode,
    403,
  );
});
test("repair start excludes concurrent maintenance and completion restores equipment", async () => {
  const device = await record("devices");
  let a = await approve(
    "repair-records",
    await record("repair-records", {
      deviceId: device.id,
      fault: "Example fault",
    }),
  );
  let b = await approve(
    "repair-records",
    await record("repair-records", {
      deviceId: device.id,
      fault: "Second request",
    }),
  );
  a = await action("repair-records", a, "start");
  assert.equal(
    (
      await call("POST", `/resources/repair-records/${b.id}/actions/start`, {
        revision: b.revision,
      })
    ).statusCode,
    409,
  );
  a = await action("repair-records", a, "complete", { result: "Restored" });
  const states = await pool.query(
    "SELECT status FROM device_events WHERE device_id=$1 ORDER BY occurred_at",
    [device.id],
  );
  assert.deepEqual(
    states.rows.map((x) => x.status),
    ["maintenance", "idle"],
  );
  a = await action("repair-records", a, "confirm");
  assert.equal(a.stage, "confirmed");
});
test("safety executor completes snapshot without review when configured and app releases validate HTTPS", async () => {
  const tpl = await record("safety-checklist-templates", {
    frequency: "daily",
    executorIds: [uid],
    requireCheck: false,
    items: [{ title: "Walkway", content: "Keep clear" }],
  });
  let r = await record(
    "safety-checklist-executions",
    { templateId: tpl.id, assigneeId: uid },
    operator,
  );
  r = await transition("safety-checklist-executions", r, "submit", operator);
  r = await action("safety-checklist-executions", r, "start", {}, operator);
  const info = await ok(
    "GET",
    `/resources/safety-checklist-executions/${r.id}/activity`,
    undefined,
    operator,
  );
  r = await action(
    "safety-checklist-executions",
    r,
    "check-item",
    { itemId: info.items[0].id, result: "Clear" },
    operator,
  );
  r = await action(
    "safety-checklist-executions",
    r,
    "complete",
    { result: "Complete" },
    operator,
  );
  assert.equal(r.status, "approved");
  assert.equal(r.stage, "confirmed");
  assert.equal(
    (
      await call("POST", "/resources/app-versions", {
        name: "Bad URL",
        data: {
          versionCode: 1,
          versionName: "1.0",
          downloadUrl: "http://example.com/mes.apk",
        },
      })
    ).statusCode,
    400,
  );
  const release = await approve(
    "app-versions",
    await record("app-versions", {
      versionCode: 1,
      versionName: "1.0",
      downloadUrl: "https://example.com/mes.apk",
    }),
  );
  assert.equal(release.status, "approved");
});
test("stock reversals retain opposite ledger entries, notes and reference filters", async () => {
  const material = await record("materials", { unit: "kg" });
  let r = await approve(
    "purchase-receipts",
    await record("purchase-receipts", {
      materialId: material.id,
      quantity: 5,
      receivedDate: "2026-10-15",
    }),
  );
  r = await action("purchase-receipts", r, "annotate", {
    notes: "Receiving corrected",
  });
  r = await action("purchase-receipts", r, "reverse", {
    notes: "Duplicate delivery document",
  });
  assert.equal(r.stage, "reversed");
  assert.equal(
    (
      await pool.query(
        "SELECT quantity FROM material_balances WHERE material_id=$1",
        [material.id],
      )
    ).rows[0].quantity,
    0,
  );
  const moves = (
    await pool.query(
      "SELECT direction,reverses_id FROM material_movements WHERE source_id=$1 ORDER BY created_at",
      [r.id],
    )
  ).rows;
  assert.equal(moves.length, 2);
  assert.ok(moves.find((x) => x.direction === "out" && x.reverses_id));
  const filtered = await ok(
    "GET",
    `/resources/purchase-receipts?materialId=${material.id}`,
  );
  assert.equal(filtered.total, 1);
});
test("explicit equipment template sync archives old items while preserving execution snapshots", async () => {
  const type = await record("device-types");
  let device = await record("devices", { deviceTypeId: type.id });
  await record("device-inspection-templates", {
    deviceTypeId: type.id,
    title: "Template check",
    content: "Verify",
  });
  device = await action("devices", device, "sync-inspection-items");
  let items = await ok(
    "GET",
    `/resources/device-inspection-items?deviceId=${device.id}&status=active`,
  );
  assert.equal(items.total, 1);
  device = await action("devices", device, "sync-inspection-items");
  items = await ok(
    "GET",
    `/resources/device-inspection-items?deviceId=${device.id}&status=active`,
  );
  assert.equal(items.total, 1);
  assert.equal(
    (
      await ok(
        "GET",
        `/resources/device-inspection-items?deviceId=${device.id}&status=archived`,
      )
    ).total,
    1,
  );
});
test("andon contacts schedule local escalation, response cancels delays and adapter is explicit", async () => {
  const station = await record("workstations");
  await record("andon-contacts", {
    workstationId: station.id,
    contactName: "Demo contact",
    phone: "DEMO-NOT-A-NUMBER",
    timeoutSeconds: 0,
  });
  let alarm = await record("andon-events", {
    workstationId: station.id,
    category: "equipment",
    description: "Fixture issue",
  });
  alarm = await transition("andon-events", alarm, "submit");
  await dispatchAndonNotifications(pool);
  let pending = (
    await pool.query("SELECT * FROM andon_notifications WHERE record_id=$1", [
      alarm.id,
    ])
  ).rows[0];
  assert.equal(pending.status, "pending");
  assert.equal(pending.attempts, 0);
  let deliveries = 0;
  await dispatchAndonNotifications(pool, async (n) => {
    deliveries++;
    assert.equal(n.payload.contacts instanceof Array, true);
  });
  assert.equal(deliveries, 1);
  alarm = await action(
    "andon-events",
    alarm,
    "respond",
    { content: "On the way" },
    operator,
  );
  alarm = await action(
    "andon-events",
    alarm,
    "handle",
    { result: "Resolved" },
    operator,
  );
  assert.equal(alarm.status, "approved");
  let another = await record("andon-events", {
    workstationId: station.id,
    category: "equipment",
    description: "New issue",
  });
  another = await transition("andon-events", another, "submit");
  another = await action("andon-events", another, "respond", {}, operator);
  await dispatchAndonNotifications(pool, async () => {
    deliveries++;
  });
  assert.equal(deliveries, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM andon_notifications WHERE record_id=$1",
        [another.id],
      )
    ).rows[0].status,
    "cancelled",
  );
});
test("configured Andon adapter uses HTTPS, a fixed envelope and idempotency without live network", async () => {
  const { configuredAndonNotifier } =
    await import("../src/management-parity.js");
  const oldUrl = process.env.ANDON_WEBHOOK_URL,
    oldToken = process.env.ANDON_WEBHOOK_TOKEN,
    oldFetch = globalThis.fetch;
  try {
    process.env.ANDON_WEBHOOK_URL = "http://example.com/alarms";
    assert.throws(() => configuredAndonNotifier(), /HTTPS/);
    process.env.ANDON_WEBHOOK_URL = "https://example.com/alarms";
    process.env.ANDON_WEBHOOK_TOKEN = "demo-placeholder";
    let captured: any;
    globalThis.fetch = (async (_url: any, init: any) => {
      captured = init;
      return new Response("", { status: 202 });
    }) as typeof fetch;
    await configuredAndonNotifier()!({
      id: "event-demo",
      recordId: "record-demo",
      payload: { contacts: [] },
    });
    assert.equal(captured.redirect, "error");
    assert.equal(captured.headers["Idempotency-Key"], "event-demo");
    assert.equal(captured.headers.Authorization, "Bearer demo-placeholder");
    assert.equal(JSON.parse(captured.body).type, "mes.andon.alarm");
    assert.ok(captured.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.ANDON_WEBHOOK_URL;
    else process.env.ANDON_WEBHOOK_URL = oldUrl;
    if (oldToken === undefined) delete process.env.ANDON_WEBHOOK_TOKEN;
    else process.env.ANDON_WEBHOOK_TOKEN = oldToken;
  }
});
