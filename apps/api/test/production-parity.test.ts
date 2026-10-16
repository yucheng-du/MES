import { before, beforeEach, afterEach, after, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/app.js";
import { createPool, id, one } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
import { migrate } from "../src/migrate.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL must name a dedicated *_test database");
const pool = createPool(url),
  origin = "http://localhost:5173";
let app: FastifyInstance,
  admin: string,
  operator: string,
  other: string,
  quality: string;
let operatorId: string, otherId: string, adminId: string;
async function call(method: any, path: string, payload?: any, cookie = admin) {
  return app.inject({
    method,
    url: "/api" + path,
    headers: { origin, cookie },
    payload,
  });
}
async function ok(method: any, path: string, payload?: any, cookie = admin) {
  const r = await call(method, path, payload, cookie);
  assert.equal(r.statusCode, 200, `${method} ${path}: ${r.body}`);
  return r.json();
}
async function login(name: string) {
  const response = await call(
    "POST",
    "/auth/login",
    { username: name, password: "MesDemo2026!" },
    "",
  );
  assert.equal(response.statusCode, 200);
  return String(response.headers["set-cookie"]).split(";")[0];
}
async function record(resource: string, name: string, data: any = {}) {
  return ok("POST", "/resources/" + resource, { code: id(), name, data });
}
async function product(
  steps: any[] = [{ name: "Cut", unitPrice: 2, expectedMinutes: 1 }],
) {
  return ok("POST", "/products", { code: id(), name: "Parity part", steps });
}
async function work(productId: string, quantity = 10, routeId?: string) {
  return ok("POST", "/work-orders", {
    productId,
    quantity,
    ...(routeId ? { routeId } : {}),
  });
}
async function type(name = "Cut") {
  return ok("POST", "/production/procedure-types", { code: id(), name });
}
async function qualify(
  userId: string,
  typeId: string,
  active = true,
  validUntil?: string,
) {
  return ok("PUT", `/production/qualifications/${userId}/${typeId}`, {
    active,
    validUntil,
  });
}
async function station(typeId: string, deviceId?: string) {
  const s = await record("workstations", "Parity station");
  await ok("PATCH", `/production/stations/${s.id}/config`, {
    procedureTypeId: typeId,
    deviceId,
    idleThresholdMinutes: 1,
  });
  return s;
}
async function receive(taskId: string, stationId?: string, cookie = operator) {
  return ok(
    "POST",
    `/tasks/${taskId}/receive`,
    { workstationId: stationId, requestId: id() },
    cookie,
  );
}
async function finish(reportId: string, quantity = 10, cookie = operator) {
  await ok("POST", `/reports/${reportId}/start`, {}, cookie);
  return ok(
    "POST",
    `/reports/${reportId}/complete`,
    { quantity, requestId: id() },
    cookie,
  );
}
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE users,procedure_types,scrap_types,products CASCADE",
  );
  await pool.query(
    "INSERT INTO auto_review_settings(id) VALUES(true) ON CONFLICT DO NOTHING",
  );
  await pool.query(
    "INSERT INTO production_settings(id) VALUES(true) ON CONFLICT DO NOTHING",
  );
  const hash = await hashPassword("MesDemo2026!");
  for (const [name, role] of [
    ["admin", "admin"],
    ["operator", "operator"],
    ["other", "operator"],
    ["quality", "quality"],
  ]) {
    const uid = id();
    if (name === "operator") operatorId = uid;
    if (name === "other") otherId = uid;
    if (name === "admin") adminId = uid;
    await pool.query(
      "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$2,$3,$4)",
      [uid, name, hash, role],
    );
  }
  app = await createApp({ pool, origins: [origin] });
  admin = await login("admin");
  operator = await login("operator");
  other = await login("other");
  quality = await login("quality");
});
afterEach(async () => app.close());
after(async () => pool.end());

test("product properties and reusable route snapshots retain rates and instructions", async () => {
  const category = await record("product-types", "Fixture type"),
    material = await record("materials", "Fixture material", { unit: "kg" }),
    customer = await record("customers", "Fixture customer");
  const p = await ok("POST", "/products", {
    code: id(),
    name: "Part",
    details: {
      typeId: category.id,
      materialId: material.id,
      model: "P-1",
      unitWeight: 125,
      customerIds: [customer.id],
      safetyStockDays: 30,
    },
    steps: [{ name: "Default", unitPrice: 1, expectedMinutes: 2 }],
  });
  assert.equal(p.details.unitWeight, 125);
  const t = await type();
  const route = await ok("POST", "/production/routes", {
    name: "Shared route",
    productId: null,
    steps: [
      {
        name: "Typed cut",
        unitPrice: 3,
        expectedMinutes: 4,
        procedureTypeId: t.id,
        deductionUnitPrice: 5,
        rewardUnitPrice: 1,
        operationGuide: "Clamp first",
        inspectionGuide: "Check size",
      },
    ],
  });
  const w = await work(p.id, 10, route.id);
  assert.equal(w.tasks[0].production.procedureTypeId, t.id);
  assert.equal(w.tasks[0].production.operationGuide, "Clamp first");
  await ok("PATCH", `/production/routes/${route.id}`, {
    name: route.name,
    productId: null,
    steps: [{ name: "Revised", unitPrice: 99, expectedMinutes: 2 }],
    active: true,
    revision: route.revision,
  });
  const old = await ok("GET", `/work-orders/${w.id}`);
  assert.equal(old.tasks[0].unitPrice, 3);
  assert.equal(old.tasks[0].production.inspectionGuide, "Check size");
  const p2 = await product();
  const exclusive = await ok("POST", "/production/routes", {
    name: "Specific",
    productId: p.id,
    steps: [{ name: "Specific", unitPrice: 2, expectedMinutes: 1 }],
  });
  assert.equal(
    (
      await call("POST", "/work-orders", {
        productId: p2.id,
        quantity: 1,
        routeId: exclusive.id,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await call("POST", "/products", {
        code: id(),
        name: "Bad relation",
        details: { customerIds: [id()] },
        steps: [{ name: "Cut", unitPrice: 1, expectedMinutes: 1 }],
      })
    ).statusCode,
    409,
  );
});

test("qualifications, assignments and station duty are enforced through receipt and completion", async () => {
  const t = await type(),
    s = await station(t.id),
    p = await product([
      { name: "Cut", unitPrice: 2, expectedMinutes: 1, procedureTypeId: t.id },
    ]),
    w = await work(p.id);
  assert.equal(
    (await call("POST", `/production/stations/${s.id}/on-duty`, {}, operator))
      .statusCode,
    409,
  );
  await qualify(operatorId, t.id, true, "2000-01-01");
  assert.equal(
    (await call("POST", `/production/stations/${s.id}/on-duty`, {}, operator))
      .statusCode,
    409,
  );
  await qualify(operatorId, t.id);
  await qualify(otherId, t.id);
  await ok("PATCH", `/tasks/${w.tasks[0].id}/assignment`, {
    workerId: operatorId,
    workstationId: s.id,
  });
  assert.equal(
    (
      await call(
        "POST",
        `/tasks/${w.tasks[0].id}/receive`,
        { workstationId: s.id, requestId: id() },
        other,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        `/tasks/${w.tasks[0].id}/receive`,
        { workstationId: s.id, requestId: id() },
        operator,
      )
    ).statusCode,
    409,
  );
  await ok("POST", `/production/stations/${s.id}/on-duty`, {}, operator);
  const r = await receive(w.tasks[0].id, s.id);
  assert.equal(
    (await call("POST", `/production/stations/${s.id}/off-duty`, {}, operator))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await call("PATCH", `/production/stations/${s.id}/config`, {
        procedureTypeId: t.id,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call("PATCH", `/tasks/${w.tasks[0].id}/assignment`, {
        workerId: otherId,
      })
    ).statusCode,
    409,
  );
  await finish(r.id);
  const states = await ok("GET", "/production/stations");
  assert.equal(states.find((x: any) => x.id === s.id).currentReportId, null);
  await pool.query(
    "UPDATE station_events SET started_at=now()-interval '2 minutes' WHERE station_id=$1 AND event='no_material' AND ended_at IS NULL",
    [s.id],
  );
  const logs = await ok("GET", `/production/station-logs?stationId=${s.id}`);
  assert(
    logs.items.some(
      (e: any) => e.event === "no_material" && e.thresholdExceeded,
    ),
  );
  assert(logs.items.some((e: any) => e.event === "receive"));
  assert.equal(
    (await call("POST", `/production/stations/${s.id}/off-duty`, {}, other))
      .statusCode,
    403,
  );
  await ok("POST", `/production/stations/${s.id}/off-duty`, {}, operator);
  const ended = await one(
    pool,
    "SELECT * FROM station_events WHERE station_id=$1 AND event='no_material' ORDER BY started_at DESC LIMIT 1",
    [s.id],
  );
  assert(ended.ended_at);
});

test("device exclusivity and task device assignments reject mismatched stations", async () => {
  const t = await type(),
    device = await record("devices", "Machine"),
    s = await station(t.id, device.id),
    second = await record("workstations", "Other station");
  assert.equal(
    (
      await call("PATCH", `/production/stations/${second.id}/config`, {
        procedureTypeId: t.id,
        deviceId: device.id,
      })
    ).statusCode,
    409,
  );
  const otherDevice = await record("devices", "Other machine"),
    p = await product([
      { name: "Cut", unitPrice: 2, expectedMinutes: 1, procedureTypeId: t.id },
    ]),
    w = await work(p.id);
  await qualify(operatorId, t.id);
  assert.equal(
    (
      await call("PATCH", `/tasks/${w.tasks[0].id}/assignment`, {
        workstationId: s.id,
        deviceId: otherDevice.id,
      })
    ).statusCode,
    409,
  );
  await ok("PATCH", `/tasks/${w.tasks[0].id}/assignment`, {
    workerId: operatorId,
    workstationId: s.id,
    deviceId: device.id,
  });
  await ok("POST", `/production/stations/${s.id}/on-duty`, {}, operator);
  const r = await receive(w.tasks[0].id, s.id);
  assert.equal(r.deviceId, device.id);
});

test("one worker can operate distinct occupied stations while each station has one task", async () => {
  const t = await type();
  await qualify(operatorId, t.id);
  const s1 = await station(t.id),
    s2 = await station(t.id),
    p = await product([
      { name: "Cut", unitPrice: 2, expectedMinutes: 1, procedureTypeId: t.id },
    ]);
  const w1 = await work(p.id),
    w2 = await work(p.id),
    w3 = await work(p.id);
  await ok("POST", `/production/stations/${s1.id}/on-duty`, {}, operator);
  await ok("POST", `/production/stations/${s2.id}/on-duty`, {}, operator);
  const requests = await Promise.all([
    call(
      "POST",
      `/tasks/${w1.tasks[0].id}/receive`,
      { workstationId: s1.id, requestId: id() },
      operator,
    ),
    call(
      "POST",
      `/tasks/${w2.tasks[0].id}/receive`,
      { workstationId: s1.id, requestId: id() },
      operator,
    ),
  ]);
  assert.deepEqual(requests.map((r) => r.statusCode).sort(), [200, 409]);
  const r2 = await receive(w3.tasks[0].id, s2.id);
  assert.equal(r2.workerId, operatorId);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM reports WHERE worker_id=$1 AND status='received'",
        [operatorId],
      )
    ).rowCount,
    2,
  );
});

test("manager completion entry remains qualified and audited, automatic receive-completion stays manual for wages", async () => {
  const t = await type(),
    s = await station(t.id),
    p = await product([
      { name: "Cut", unitPrice: 2, expectedMinutes: 1, procedureTypeId: t.id },
    ]),
    w = await work(p.id);
  await qualify(operatorId, t.id);
  const input = {
    workerId: operatorId,
    workstationId: s.id,
    forceComplete: true,
    reason: "Recovered paper record",
    requestId: id(),
  };
  assert.equal(
    (await call("POST", `/tasks/${w.tasks[0].id}/receive`, input, operator))
      .statusCode,
    403,
  );
  const result = await ok("POST", `/tasks/${w.tasks[0].id}/receive`, input);
  assert.equal(result.status, "complete");
  assert.equal(result.autoReviewStatus, "manual");
  assert.equal(result.workerId, operatorId);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM audit_logs WHERE resource_id=$1 AND action='force-complete'",
        [result.id],
      )
    ).rowCount,
    1,
  );
  const fast = await product([
    { name: "Rapid", unitPrice: 0, expectedMinutes: 1, autoComplete: true },
  ]);
  const fw = await work(fast.id);
  const r = await receive(fw.tasks[0].id);
  assert.equal(r.status, "complete");
  assert.equal(r.autoReviewStatus, "manual");
  assert.equal((await ok("GET", `/work-orders/${fw.id}`)).status, "complete");
});

test("self-responsible deductible scrap auto-approves once and posts configured deduction", async () => {
  const p = await product([
      {
        name: "Cut",
        unitPrice: 2,
        expectedMinutes: 1,
        deductionUnitPrice: 3,
        rewardUnitPrice: 1,
      },
    ]),
    w = await work(p.id),
    r = await receive(w.tasks[0].id);
  await ok("POST", `/reports/${r.id}/start`, {}, operator);
  const type = await ok("POST", "/production/scrap-types", {
    code: id(),
    name: "Operator defect",
    deductible: true,
  });
  const settings = await ok("GET", "/production/settings");
  await ok("PATCH", "/production/settings", {
    revision: settings.revision,
    scrapAutoReview: true,
    scrapMaxAmount: 100,
  });
  const input = {
    workOrderId: w.id,
    taskId: w.tasks[0].id,
    reportId: r.id,
    responsibleReportId: r.id,
    scrapTypeId: type.id,
    quantity: 2,
    reason: "Self-reported defect",
    requestId: id(),
  };
  const scrap = await ok("POST", "/scraps", input, operator);
  assert.equal(scrap.status, "approved");
  assert.equal(scrap.approvalMode, "automatic");
  assert.equal(scrap.approvedBy, null);
  const replay = await ok("POST", "/scraps", input, operator);
  assert.equal(replay.id, scrap.id);
  assert.equal(
    (
      await one(
        pool,
        "SELECT count(*) AS n,sum(amount) AS amount FROM payroll WHERE source_id=$1",
        [scrap.id],
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await one(
        pool,
        "SELECT sum(amount) AS amount FROM payroll WHERE source_id=$1",
        [scrap.id],
      )
    ).amount,
    -6,
  );
  await ok(
    "POST",
    `/reports/${r.id}/complete`,
    { quantity: 8, requestId: id() },
    operator,
  );
  assert.equal((await ok("GET", `/work-orders/${w.id}`)).goodQuantity, 8);
});

test("non-deductible, foreign responsibility and above-limit scrap stay manual", async () => {
  const p = await product([
      { name: "Cut", unitPrice: 2, expectedMinutes: 1, deductionUnitPrice: 3 },
    ]),
    w = await work(p.id),
    r = await receive(w.tasks[0].id);
  const type = await ok("POST", "/production/scrap-types", {
    code: id(),
    name: "Material defect",
    deductible: false,
  });
  let settings = await ok("GET", "/production/settings");
  await ok("PATCH", "/production/settings", {
    revision: settings.revision,
    scrapAutoReview: true,
    scrapMaxAmount: 1,
  });
  const first = await ok(
    "POST",
    "/scraps",
    {
      workOrderId: w.id,
      reportId: r.id,
      responsibleReportId: r.id,
      scrapTypeId: type.id,
      quantity: 1,
      reason: "Material defect",
      requestId: id(),
    },
    operator,
  );
  assert.equal(first.status, "pending");
  const deductible = await ok("POST", "/production/scrap-types", {
    code: id(),
    name: "Deductible",
    deductible: true,
  });
  const second = await ok(
    "POST",
    "/scraps",
    {
      workOrderId: w.id,
      reportId: r.id,
      responsibleReportId: r.id,
      scrapTypeId: deductible.id,
      quantity: 1,
      reason: "Above limit",
      requestId: id(),
    },
    operator,
  );
  assert.equal(second.status, "pending");
  assert.match(second.autoReviewReason, /上限/);
  const foreign = await ok(
    "POST",
    "/scraps",
    {
      workOrderId: w.id,
      responsibleReportId: r.id,
      scrapTypeId: deductible.id,
      quantity: 1,
      reason: "Quality found",
      requestId: id(),
    },
    quality,
  );
  assert.equal(foreign.status, "pending");
  assert.equal((await pool.query("SELECT 1 FROM payroll")).rowCount, 0);
});

test("later scrap adjusts responsible report wages and manual approval is exactly once", async () => {
  const p = await product([
      { name: "Cut", unitPrice: 2, expectedMinutes: 1, deductionUnitPrice: 3 },
    ]),
    w = await work(p.id),
    r = await receive(w.tasks[0].id);
  await finish(r.id);
  await ok("POST", `/reports/${r.id}/approve`, { requestId: id() });
  const type = await ok("POST", "/production/scrap-types", {
    code: id(),
    name: "Late defect",
    deductible: true,
  });
  const scrap = await ok(
    "POST",
    "/scraps",
    {
      workOrderId: w.id,
      responsibleReportId: r.id,
      scrapTypeId: type.id,
      quantity: 1,
      reason: "Late inspection",
      requestId: id(),
    },
    quality,
  );
  const intent = { requestId: id() };
  await ok("POST", `/scraps/${scrap.id}/approve`, intent);
  await ok("POST", `/scraps/${scrap.id}/approve`, intent);
  const changed = await one(pool, "SELECT * FROM reports WHERE id=$1", [r.id]);
  assert.equal(changed.complete_adjustment, -1);
  assert.equal(
    (
      await one(
        pool,
        "SELECT sum(amount) AS amount FROM payroll WHERE worker_id=$1",
        [operatorId],
      )
    ).amount,
    15,
  );
  assert.equal(
    (await pool.query("SELECT 1 FROM payroll WHERE source_id=$1", [scrap.id]))
      .rowCount,
    2,
  );
});

test("batch report review is atomic and obeys approval permissions", async () => {
  const p = await product(),
    w1 = await work(p.id),
    r1 = await receive(w1.tasks[0].id);
  await finish(r1.id);
  const w2 = await work(p.id),
    r2 = await receive(w2.tasks[0].id);
  assert.equal(
    (
      await call("POST", "/reports/batch-review", {
        ids: [r1.id, r2.id],
        action: "approve",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await one(pool, "SELECT status FROM reports WHERE id=$1", [r1.id])).status,
    "complete",
  );
  assert.equal((await pool.query("SELECT 1 FROM payroll")).rowCount, 0);
  await finish(r2.id);
  assert.equal(
    (
      await call(
        "POST",
        "/reports/batch-review",
        { ids: [r1.id, r2.id], action: "approve" },
        operator,
      )
    ).statusCode,
    403,
  );
  const done = await ok(
    "POST",
    "/reports/batch-review",
    { ids: [r1.id, r2.id], action: "approve" },
    quality,
  );
  assert.equal(done.items.length, 2);
  assert.equal((await pool.query("SELECT 1 FROM payroll")).rowCount, 2);
});

test("sales lines can be edited and copied with revisions, allocation guards and lifecycle controls", async () => {
  const customer = await record("customers", "Sales customer"),
    p = await product(),
    second = await product();
  const order = await ok("POST", "/sales-orders", {
    customerId: customer.id,
    name: "Order A",
    priority: "urgent",
    items: [{ productId: p.id, quantity: 10, unitPrice: 4, notes: "Line A" }],
  });
  assert.equal(order.name, "Order A");
  assert.equal(order.priority, "urgent");
  let current = await ok("GET", `/sales-orders/${order.id}`);
  assert.equal(current.items[0].notes, "Line A");
  const w = await ok("POST", "/work-orders", {
    productId: p.id,
    salesOrderId: order.id,
    quantity: 6,
  });
  const payload = {
    revision: current.revision,
    customerId: customer.id,
    name: "Revised",
    priority: "normal",
    items: [{ productId: p.id, quantity: 5, unitPrice: 7 }],
  };
  assert.equal(
    (await call("PATCH", `/sales-orders/${order.id}`, payload)).statusCode,
    409,
  );
  current = await ok("PATCH", `/sales-orders/${order.id}`, {
    ...payload,
    items: [
      { productId: p.id, quantity: 12, unitPrice: 7, notes: "Updated" },
      { productId: second.id, quantity: 2, unitPrice: 1 },
    ],
  });
  assert.equal(current.name, "Revised");
  assert.equal(current.items.length, 2);
  assert.equal(
    (
      await call("PATCH", `/sales-orders/${order.id}`, {
        ...payload,
        items: [{ productId: p.id, quantity: 12, unitPrice: 7 }],
      })
    ).statusCode,
    409,
  );
  const source = await ok("POST", "/sales-orders", {
    customerId: customer.id,
    items: [{ productId: p.id, quantity: 3, unitPrice: 99 }],
  });
  current = await ok("POST", `/sales-orders/${order.id}/copy-items`, {
    sourceOrderId: source.id,
    revision: current.revision,
  });
  assert.equal(
    current.items.find((r: any) => r.productId === p.id).quantity,
    15,
  );
  assert.equal(
    current.items.find((r: any) => r.productId === p.id).unitPrice,
    7,
  );
  assert.equal(
    (await call("DELETE", `/sales-orders/${order.id}`)).statusCode,
    409,
  );
  assert.equal(
    (
      await call("POST", `/sales-orders/${order.id}/close`, {
        reason: "Cancelled",
      })
    ).statusCode,
    409,
  );
  await ok("DELETE", `/work-orders/${w.id}`);
  assert.equal(
    (await call("POST", `/sales-orders/${order.id}/complete`, {})).statusCode,
    409,
  );
  const closed = await ok("POST", `/sales-orders/${order.id}/close`, {
    reason: "Customer cancellation",
  });
  assert.equal(closed.status, "closed");
  await ok("DELETE", `/sales-orders/${source.id}`);
  assert.equal(
    (await call("GET", `/sales-orders/${source.id}`)).statusCode,
    404,
  );
});

test("product archival prevents new work and restores without changing historical task snapshots", async () => {
  const p = await product(),
    w = await work(p.id);
  await ok("POST", `/products/${p.id}/archive`, {});
  assert.equal(
    (await call("POST", "/work-orders", { productId: p.id, quantity: 1 }))
      .statusCode,
    404,
  );
  assert.equal((await ok("GET", `/work-orders/${w.id}`)).tasks[0].unitPrice, 2);
  await ok("POST", `/products/${p.id}/restore`, {});
  const fresh = await work(p.id);
  await ok("DELETE", `/work-orders/${fresh.id}`);
  const received = await receive(w.tasks[0].id);
  assert.equal((await call("DELETE", `/work-orders/${w.id}`)).statusCode, 409);
  assert.equal(received.status, "received");
});

test("administrators can record scrap on behalf of the worker, without automatic self-approval", async () => {
  const p = await product(),
    w = await work(p.id),
    r = await receive(w.tasks[0].id);
  const s = await ok("POST", "/scraps", {
    workOrderId: w.id,
    taskId: w.tasks[0].id,
    reportId: r.id,
    quantity: 10,
    reason: "Full scrap observed",
    requestId: id(),
  });
  assert.equal(s.status, "pending");
  await ok("POST", `/scraps/${s.id}/approve`, { requestId: id() });
  await ok("POST", `/reports/${r.id}/start`, {}, operator);
  const completed = await ok(
    "POST",
    `/reports/${r.id}/complete`,
    { quantity: 0, requestId: id() },
    operator,
  );
  assert.equal(completed.quantity, 0);
});

test("on-behalf discovery rewards belong to the reporting worker and production list scopes are exact", async () => {
  const p = await product([
    {
      name: "Cut",
      unitPrice: 2,
      expectedMinutes: 1,
      deductionUnitPrice: 3,
      rewardUnitPrice: 1,
    },
  ]);
  const customer = await record("customers", "Scope customer");
  const sale = await ok("POST", "/sales-orders", {
    customerId: customer.id,
    items: [{ productId: p.id, quantity: 30 }],
  });
  const w = await ok("POST", "/work-orders", {
    productId: p.id,
    salesOrderId: sale.id,
    quantity: 10,
  });
  const unrelated = await work(p.id);
  const r1 = await ok(
    "POST",
    `/tasks/${w.tasks[0].id}/receive`,
    { quantity: 5, requestId: id() },
    operator,
  );
  await finish(r1.id, 5, operator);
  const r2 = await ok(
    "POST",
    `/tasks/${w.tasks[0].id}/receive`,
    { quantity: 5, requestId: id() },
    other,
  );
  await finish(r2.id, 5, other);
  const type = await ok("POST", "/production/scrap-types", {
    code: id(),
    name: "Deductible",
    deductible: true,
  });
  const s = await ok("POST", "/scraps", {
    workOrderId: w.id,
    reportId: r2.id,
    responsibleReportId: r1.id,
    scrapTypeId: type.id,
    quantity: 1,
    reason: "Found by second worker",
    requestId: id(),
  });
  assert.equal(s.rewardUnitPrice, 1);
  await ok("POST", `/scraps/${s.id}/approve`, { requestId: id() });
  const reward = await one(
    pool,
    "SELECT * FROM payroll WHERE source_id=$1 AND source_type='scrap-reward'",
    [s.id],
  );
  assert.equal(reward.worker_id, otherId);
  assert.equal(reward.amount, 1);
  assert.deepEqual(
    (await ok("GET", `/work-orders?salesOrderId=${sale.id}`)).items.map(
      (x: any) => x.id,
    ),
    [w.id],
  );
  assert.equal(
    (await ok("GET", `/reports?workOrderId=${unrelated.id}`)).items.length,
    0,
  );
  assert.equal(
    (await ok("GET", `/reports?workOrderId=${w.id}&taskId=${w.tasks[0].id}`))
      .items.length,
    2,
  );
  assert.equal(
    (await ok("GET", `/scraps?reportId=${r2.id}&responsibleReportId=${r1.id}`))
      .items[0].discoveryWorkerName,
    "other",
  );
  assert.equal(
    (await ok("GET", `/scraps?workOrderId=${unrelated.id}`)).items.length,
    0,
  );
});

test("report completion freezes equipment interval evidence and does not reinterpret later changes", async () => {
  const t = await type(),
    device = await record("devices", "Snapshot machine", { pieceScale: 3 }),
    s = await station(t.id, device.id);
  await qualify(operatorId, t.id);
  await ok("POST", `/production/stations/${s.id}/on-duty`, {}, operator);
  const p = await product([
      {
        name: "Measured cut",
        unitPrice: 2,
        expectedMinutes: 1,
        procedureTypeId: t.id,
      },
    ]),
    w = await work(p.id),
    r = await receive(w.tasks[0].id, s.id);
  await ok("POST", `/reports/${r.id}/start`, {}, operator);
  const start = new Date(Date.now() - 120000);
  await pool.query("UPDATE reports SET started_at=$2 WHERE id=$1", [
    r.id,
    start,
  ]);
  for (const [seconds, status, scale] of [
    [20, "idle", 1],
    [30, "running", 1],
    [90, "idle", 2],
    [110, "offline", 3],
  ] as const)
    await pool.query(
      "INSERT INTO device_events(id,device_id,event_key,status,occurred_at,time_source,source,piece_scale) VALUES($1,$2,$1::uuid::text,$3,$4,'device','mqtt',$5)",
      [id(), device.id, status, new Date(+start + seconds * 1000), scale],
    );
  const intent = { quantity: 10, requestId: id() };
  const done = await ok("POST", `/reports/${r.id}/complete`, intent, operator),
    snapshot = done.deviceMetrics;
  assert.equal(snapshot.deviceName, "Snapshot machine");
  assert.equal(snapshot.configuredPieceScale, 3);
  assert.equal(snapshot.seconds.unknown, 20);
  assert.equal(snapshot.seconds.running, 60);
  assert.equal(snapshot.seconds.idle, 30);
  assert.equal(snapshot.effectiveOperatingCount, 1);
  assert.equal(snapshot.operatingPieces, 2);
  assert.ok(snapshot.totalSeconds >= 120);
  assert.ok(snapshot.seconds.offline >= 10);
  await pool.query(
    "UPDATE records SET name='Renamed',data=data||'{\"pieceScale\":8}'::jsonb WHERE id=$1",
    [device.id],
  );
  await pool.query(
    "INSERT INTO device_events(id,device_id,event_key,status,occurred_at,time_source,source) VALUES($1,$2,$1::uuid::text,'fault',$3,'device','mqtt')",
    [id(), device.id, new Date(+start + 45000)],
  );
  assert.deepEqual(
    (await ok("POST", `/reports/${r.id}/complete`, intent, operator))
      .deviceMetrics,
    snapshot,
  );
  assert.deepEqual(
    (await ok("GET", `/reports/${r.id}`, undefined, operator)).deviceMetrics,
    snapshot,
  );
  assert.equal(
    (await call("GET", `/reports/${r.id}`, undefined, other)).statusCode,
    403,
  );
  await ok("POST", `/reports/${r.id}/approve`, { requestId: id() });
  assert.deepEqual(
    (await ok("GET", `/reports/${r.id}`)).deviceMetrics,
    snapshot,
  );
  const auto = await product([
      {
        name: "Automatic cut",
        unitPrice: 2,
        expectedMinutes: 1,
        procedureTypeId: t.id,
        autoComplete: true,
      },
    ]),
    autoWork = await work(auto.id);
  const immediate = await receive(autoWork.tasks[0].id, s.id);
  assert.ok(immediate.deviceMetrics);
  assert.equal(immediate.deviceMetrics.deviceName, "Renamed");
});
