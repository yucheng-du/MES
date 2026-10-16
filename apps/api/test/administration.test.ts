import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { createPool, id } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { hashPassword } from "../src/auth.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Dedicated *_test database required");
const pool = createPool(url);
let app: Awaited<ReturnType<typeof createApp>>;
let admin = "",
  manager = "",
  viewer = "",
  workerId = "";
let storage = "";
const sentCodes = new Map<string, string>();
const origin = "http://localhost:5173";
const call = (method: any, path: string, payload?: unknown, cookie = admin) =>
  app.inject({
    method,
    url: "/api" + path,
    headers: { origin, cookie },
    payload: payload as any,
  });
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
  storage = await mkdtemp(join(tmpdir(), "mes-personnel-test-"));
  process.env.FILE_STORAGE_DIR = storage;
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
  const hash = await hashPassword("MesDemo2026!");
  for (const role of ["admin", "manager", "viewer", "operator"]) {
    const key = id();
    if (role === "operator") workerId = key;
    await pool.query(
      "INSERT INTO users(id,username,name,role,password_hash) VALUES($1,$2,$2,$2,$3)",
      [key, role, hash],
    );
  }
  app = await createApp({
    pool,
    origins: [origin],
    smsSender: async (mobile, code) => {
      sentCodes.set(mobile, code);
    },
  });
  admin = await login("admin");
  manager = await login("manager");
  viewer = await login("viewer");
});
after(async () => {
  await app?.close();
  await pool.end();
  await rm(storage, { recursive: true, force: true });
});
test("per-person grants and denials are enforced, including encoded resource URLs and session refresh", async () => {
  const permissions = await call("GET", "/permissions");
  assert.equal(permissions.statusCode, 200);
  assert(
    permissions.json().some((p: any) => p.key === "resources:customers:write"),
  );
  const input = {
    username: "limited",
    name: "Limited operator",
    role: "viewer",
    password: "MesDemo2026!",
    allowedPermissions: ["resources:customers:write"],
    deniedPermissions: ["resources:suppliers:read"],
  };
  const created = await call("POST", "/users", input);
  assert.equal(created.statusCode, 200, created.body);
  const cookie = await login("limited");
  const customer = await call(
    "POST",
    "/resources/customers",
    { name: "Permission fixture", data: {} },
    cookie,
  );
  assert.equal(customer.statusCode, 200, customer.body);
  assert.equal(
    (await call("GET", "/resources/suppliers", undefined, cookie)).statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/resources/%73uppliers", undefined, cookie)).statusCode,
    403,
  );
  assert.equal(
    (await call("POST", "/users", { ...input, username: "escalation" }, cookie))
      .statusCode,
    403,
  );
  const updated = await call("PATCH", "/users/" + created.json().id, {
    deniedPermissions: ["resources:customers:write"],
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(
    (await call("GET", "/auth/me", undefined, cookie)).statusCode,
    401,
  );
  const fresh = await login("limited");
  assert.equal(
    (
      await call(
        "POST",
        "/resources/customers",
        { name: "Denied fixture", data: {} },
        fresh,
      )
    ).statusCode,
    403,
  );
});
test("payroll adjustments are authorized, signed, atomic and idempotent; summaries use date bounds", async () => {
  const input = {
    workerId,
    quantity: 2,
    unitPrice: -3.25,
    reason: "Correction fixture",
    workDate: "2026-10-15",
    requestId: id(),
  };
  assert.equal(
    (await call("POST", "/payroll/adjustments", input, viewer)).statusCode,
    403,
  );
  const first = await call("POST", "/payroll/adjustments", input, manager);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().amount, -6.5);
  const second = await call("POST", "/payroll/adjustments", input, manager);
  assert.deepEqual(second.json(), first.json());
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM payroll WHERE source_type='manual-adjustment'",
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/payroll/adjustments",
        { ...input, quantity: 3 },
        manager,
      )
    ).statusCode,
    409,
  );
  const summary = await call(
    "GET",
    "/statistics?view=workers&from=2026-10-15&to=2026-10-15",
    undefined,
    manager,
  );
  assert.equal(summary.statusCode, 200, summary.body);
  assert.equal(summary.json().items[0].amount, -6.5);
  assert.equal(
    (
      await call(
        "GET",
        "/statistics?view=workers&from=2026-10-16&to=2026-10-16",
        undefined,
        manager,
      )
    ).json().items.length,
    0,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/statistics?view=workers&from=2026-10-16&to=2026-10-15",
        undefined,
        manager,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        "GET",
        "/statistics?view=workers&from=2026-10-15&to=2026-10-15",
        undefined,
        viewer,
      )
    ).statusCode,
    403,
  );
});
test("personnel attachments and profile fields are restricted, even to ordinary managers", async () => {
  const fileId = id();
  const adminId = (
    await pool.query("SELECT id FROM users WHERE username='admin'")
  ).rows[0].id;
  await pool.query(
    "INSERT INTO uploaded_files(id,name,mime,size,sha256,uploaded_by,visibility) VALUES($1,'identity.txt','text/plain',1,'fixture',$2,'personnel')",
    [fileId, adminId],
  );
  assert.equal(
    (await call("GET", "/files/" + fileId + "/info", undefined, viewer))
      .statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/files/" + fileId + "/info", undefined, manager))
      .statusCode,
    403,
  );
  assert.equal(
    (await call("GET", "/files/" + fileId + "/info")).statusCode,
    200,
  );
  const update = await call("PATCH", "/users/" + workerId, {
    profile: { identityNumber: "SYNTHETIC-ONLY", attachmentIds: [fileId] },
  });
  assert.equal(update.statusCode, 200, update.body);
  const rows = (await call("GET", "/users", undefined, manager)).json().items;
  assert.equal(rows.find((r: any) => r.id === workerId).profile, undefined);
  const adminRows = (await call("GET", "/users")).json().items;
  assert.equal(
    adminRows.find((r: any) => r.id === workerId).profile.identityNumber,
    "SYNTHETIC-ONLY",
  );
});
test("public Android update metadata only exposes an approved version", async () => {
  const owner = (
    await pool.query("SELECT id FROM users WHERE username='admin'")
  ).rows[0].id;
  for (const [version, status] of [
    [7, "approved"],
    [8, "draft"],
  ] as const)
    await pool.query(
      "INSERT INTO records(id,resource,code,name,status,data,created_by) VALUES($1,'app-versions',$2,$2,$3,$4,$5)",
      [
        id(),
        "fixture-" + version,
        status,
        JSON.stringify({
          versionCode: version,
          versionName: "1." + version,
          downloadUrl: "https://example.com/app.apk",
          remark: "Fixture",
        }),
        owner,
      ],
    );
  const response = await call("GET", "/android/latest", undefined, "");
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().versionCode, 7);
  assert.deepEqual(Object.keys(response.json()).sort(), [
    "downloadUrl",
    "remark",
    "versionCode",
    "versionName",
  ]);
});

test("SMS codes are private, throttled, single-use and limited to five attempts", async () => {
  const mobile = "+15550001001";
  await pool.query("UPDATE users SET mobile=$2 WHERE id=$1", [
    workerId,
    mobile,
  ]);
  const response = await call("POST", "/auth/sms/request", { mobile }, "");
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().code, undefined);
  const code = sentCodes.get(mobile)!;
  assert.match(code, /^[0-9]{6}$/);
  assert.equal(
    (await call("POST", "/auth/sms/request", { mobile }, "")).statusCode,
    429,
  );
  const loginResponse = await call(
    "POST",
    "/auth/sms/login",
    { mobile, code },
    "",
  );
  assert.equal(loginResponse.statusCode, 200, loginResponse.body);
  assert.equal(
    (await call("POST", "/auth/sms/login", { mobile, code }, "")).statusCode,
    401,
  );
  await pool.query(
    "UPDATE login_codes SET requested_at=now()-interval '2 minutes' WHERE user_id=$1",
    [workerId],
  );
  assert.equal(
    (await call("POST", "/auth/sms/request", { mobile }, "")).statusCode,
    200,
  );
  const latest = sentCodes.get(mobile)!;
  const wrong = latest === "000000" ? "999999" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call("POST", "/auth/sms/login", { mobile, code: wrong }, ""))
        .statusCode,
      401,
    );
  assert.equal(
    (await call("POST", "/auth/sms/login", { mobile, code: latest }, ""))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await pool.query("SELECT attempts FROM login_codes WHERE user_id=$1", [
        workerId,
      ])
    ).rows[0].attempts,
    5,
  );
});
test("boards and inventory alerts enforce access and calculate aged stock against recent receipts", async () => {
  const product = await call("POST", "/products", {
    code: "AGE-FIXTURE",
    name: "Age fixture",
    unit: "piece",
    safetyStock: 10,
    details: { safetyStockDays: 30 },
    steps: [{ name: "Fixture step", unitPrice: 1, expectedMinutes: 1 }],
  });
  assert.equal(product.statusCode, 200, product.body);
  const key = product.json().id;
  await pool.query(
    "INSERT INTO stock_balances(id,product_id,in_quantity,out_quantity) VALUES($1,$2,12,4)",
    [id(), key],
  );
  const owner = (
    await pool.query("SELECT id FROM users WHERE username='admin'")
  ).rows[0].id;
  await pool.query(
    "INSERT INTO stock_movements(id,product_id,direction,quantity,created_by,created_at) VALUES($1,$2,'in',3,$3,now()),($4,$2,'in',9,$3,now()-interval '60 days')",
    [id(), key, owner, id()],
  );
  const alerts = await call("GET", "/inventory/alerts");
  assert.equal(alerts.statusCode, 200, alerts.body);
  const record = alerts.json().items.find((r: any) => r.id === key);
  assert.equal(record.shortage, 2);
  assert.equal(record.agingQuantity, 5);
  for (const view of [
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
  ]) {
    const board = await call("GET", "/boards?view=" + view);
    assert.equal(board.statusCode, 200, board.body);
  }
  assert.equal(
    (await call("GET", "/boards?view=inventory", undefined, "")).statusCode,
    401,
  );
});

test("session rotation invalidates the old token; self-service passwords ignore user-management denial", async () => {
  const row = await call("POST", "/users", {
    username: "self_password",
    name: "Self fixture",
    role: "viewer",
    password: "MesDemo2026!",
    deniedPermissions: ["users:write"],
  });
  assert.equal(row.statusCode, 200, row.body);
  const prior = await login("self_password");
  const rotated = await call("POST", "/auth/refresh", {}, prior);
  assert.equal(rotated.statusCode, 200, rotated.body);
  const next = String(rotated.headers["set-cookie"]).split(";")[0];
  assert.notEqual(next, prior);
  assert.equal(
    (await call("GET", "/auth/me", undefined, prior)).statusCode,
    401,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/users/" + row.json().id + "/password",
        { currentPassword: "MesDemo2026!", password: "ChangedFixture2026!" },
        next,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await call("GET", "/auth/me", undefined, next)).statusCode,
    401,
  );
  assert.equal(
    (await call("DELETE", "/users/" + row.json().id)).statusCode,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        "/auth/login",
        { username: "self_password", password: "ChangedFixture2026!" },
        "",
      )
    ).statusCode,
    401,
  );
});
test("production statistics use approved dates and preserve product, person and procedure dimensions", async () => {
  const owner = (
    await pool.query("SELECT id FROM users WHERE username='admin'")
  ).rows[0].id;
  const product = id(),
    work = id(),
    task = id();
  await pool.query(
    "INSERT INTO products(id,code,name) VALUES($1,'STATS-FIXTURE','Statistics fixture')",
    [product],
  );
  await pool.query(
    "INSERT INTO work_orders(id,code,product_id,quantity,good_quantity,created_by) VALUES($1,'STAT-WO',$2,20,20,$3)",
    [work, product, owner],
  );
  await pool.query(
    "INSERT INTO tasks(id,work_order_id,sequence,name,unit_price,expected_minutes,status) VALUES($1,$2,1,'Turning fixture',1,1,'ready')",
    [task, work],
  );
  for (const status of ["approved", "complete", "rejected"])
    await pool.query(
      "INSERT INTO reports(id,task_id,work_order_id,worker_id,received_quantity,quantity,status,completed_at,approved_at,complete_adjustment) VALUES($1,$2,$3,$4,5,2,$5,'2026-10-14T12:00:00Z','2026-10-15T12:00:00Z',1)",
      [id(), task, work, workerId, status],
    );
  const query = "/statistics?from=2026-10-15&to=2026-10-15&view=production";
  const response = await call("GET", query);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().items.length, 1);
  assert.equal(response.json().items[0].quantity, 3);
  assert.equal(response.json().items[0].productName, "Statistics fixture");
  assert.equal(response.json().items[0].workerName, "operator");
  assert.equal(
    (await call("GET", query.replaceAll("2026-10-15", "2026-10-14"))).json()
      .items.length,
    0,
  );
  for (const view of [
    "scrap",
    "stock-in",
    "stock-out",
    "products",
    "orders",
    "workers",
    "tasks",
    "procedures",
    "order-items",
  ]) {
    const result = await call(
      "GET",
      "/statistics?from=2000-01-01&to=2099-12-31&view=" + view,
    );
    assert.equal(result.statusCode, 200, view + ": " + result.body);
  }
  for (const group of ["workstation", "worker", "device"]) {
    const result = await call(
      "GET",
      "/statistics?from=2000-01-01&to=2099-12-31&view=tasks&group=" + group,
    );
    assert.equal(result.statusCode, 200, result.body);
  }
});

test("request bodies cannot reclassify write permissions and workstation boards honor catalog denials", async () => {
  const product = await call("POST", "/products", {
    code: "PERMISSION-ARCHIVE",
    name: "Permission archive fixture",
    steps: [{ name: "Step", unitPrice: 1, expectedMinutes: 1 }],
  });
  assert.equal(product.statusCode, 200, product.body);
  const user = await call("POST", "/users", {
    username: "permission_action",
    name: "Permission action fixture",
    role: "manager",
    password: "MesDemo2026!",
    allowedPermissions: ["products:approve"],
    deniedPermissions: ["products:write", "resources:workstations:read"],
  });
  assert.equal(user.statusCode, 200, user.body);
  const cookie = await login("permission_action");
  const archive = await call(
    "POST",
    "/products/" + product.json().id + "/archive",
    { action: "approve" },
    cookie,
  );
  assert.equal(archive.statusCode, 403, archive.body);
  assert.equal(
    (
      await pool.query("SELECT active FROM products WHERE id=$1", [
        product.json().id,
      ])
    ).rows[0].active,
    true,
  );
  assert.equal(
    (await call("GET", "/boards?view=workstations", undefined, cookie))
      .statusCode,
    403,
  );
});

test("payroll precision is consistent and same-name task assignees remain separate", async () => {
  for (const values of [
    { quantity: 100000, unitPrice: 0.123456 },
    { quantity: 0.123456, unitPrice: 10 },
    { quantity: 1e8, unitPrice: 1e8 },
  ]) {
    const response = await call("POST", "/payroll/adjustments", {
      ...values,
      workerId,
      reason: "Precision fixture",
      workDate: "2026-10-16",
      requestId: id(),
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  const exact = await call("POST", "/payroll/adjustments", {
    quantity: 100000,
    unitPrice: 0.1234,
    workerId,
    reason: "Precision fixture",
    workDate: "2026-10-16",
    requestId: id(),
  });
  assert.equal(exact.statusCode, 200, exact.body);
  assert.equal(exact.json().amount, 12340);
  const owner = (
    await pool.query("SELECT id FROM users WHERE username='admin'")
  ).rows[0].id;
  const workerA = id(),
    workerB = id(),
    product = id(),
    work = id(),
    hash = await hashPassword("MesDemo2026!");
  for (const [key, username] of [
    [workerA, "same-a"],
    [workerB, "same-b"],
  ])
    await pool.query(
      "INSERT INTO users(id,username,name,role,password_hash) VALUES($1,$2,'Same name','operator',$3)",
      [key, username, hash],
    );
  await pool.query(
    "INSERT INTO products(id,code,name) VALUES($1,'SAME-NAME','Same name fixture')",
    [product],
  );
  await pool.query(
    "INSERT INTO work_orders(id,code,product_id,quantity,good_quantity,created_by) VALUES($1,'SAME-WO',$2,10,10,$3)",
    [work, product, owner],
  );
  for (const [sequence, worker] of [
    [1, workerA],
    [2, workerB],
  ])
    await pool.query(
      "INSERT INTO tasks(id,work_order_id,sequence,name,unit_price,expected_minutes,status,assigned_worker_id) VALUES($1,$2,$3,'Same task',1,1,'ready',$4)",
      [id(), work, sequence, worker],
    );
  const response = await call(
    "GET",
    "/statistics?view=tasks&group=worker&from=2000-01-01&to=2099-12-31",
  );
  assert.equal(response.statusCode, 200, response.body);
  const matches = response
    .json()
    .items.filter((r: any) => r.label === "Same name");
  assert.equal(matches.length, 2);
  assert.deepEqual(
    new Set(matches.map((r: any) => r.groupId)),
    new Set([workerA, workerB]),
  );
  assert(matches.every((r: any) => r.quantity === 10));
});
