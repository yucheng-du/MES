import { test, expect, type Page, type Locator } from "@playwright/test";
import { resourceDefinitions } from "../packages/shared/src/index";
import { authenticate } from "./helpers/auth";

const origin = process.env.MES_BASE_URL ?? "http://127.0.0.1:5173";
const unique = (kind: string) =>
  `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;

async function login(page: Page, user = "admin") {
  await authenticate(page, user);
  await page.goto("/");
  await expect(page.locator(".dashboard-welcome")).toBeVisible();
}
async function api(page: Page, path: string, data?: object) {
  const res = await page.request.fetch(`${origin}/api${path}`, {
    method: data ? "POST" : "GET",
    data,
    headers: { origin },
  });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}
async function choose(page: Page, scope: Locator, label: string, text: string) {
  await scope.getByLabel(label, { exact: true }).click();
  await scope.getByLabel(label, { exact: true }).fill(text);
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: text })
    .click();
}
function mutation(page: Page, path: string) {
  return page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api${path}` && r.request().method() === "POST",
  );
}
async function save(page: Page, scope: Locator, text: string, path: string) {
  const pending = mutation(page, path);
  await scope.getByRole("button", { name: text, exact: true }).click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function stockForm(
  page: Page,
  code: string,
  name: string,
  quantity: number,
  direction: "in" | "out",
  salesCode?: string,
  customer?: string,
) {
  await page
    .getByRole("button", { name: direction === "in" ? "成品入库" : "登记出库" })
    .click();
  const drawer = page.getByRole("dialog", { name: "登记成品出入库" });
  await choose(page, drawer, "产品", `${code} · ${name}`);
  if (salesCode)
    await choose(page, drawer, "销售订单", `${salesCode} · ${customer}`);
  await drawer.getByLabel("数量", { exact: true }).fill(String(quantity));
  await drawer.getByLabel("用途 / 说明").fill("自动化浏览器验收");
  return drawer;
}

test("真实网页完成产品、订单、两道工序、跨角色审核和入出库", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const code = unique("E2E");
  const name = `验收产品 ${code}`;
  const workerLogin = unique("worker");
  await login(page);
  await api(page, "/users", {
    username: workerLogin,
    name: `验收操作员 ${code}`,
    password: "MesDemo2026!",
    role: "operator",
  });
  await page.goto("/products");
  await page.getByRole("button", { name: "新建产品" }).click();
  let drawer = page.getByRole("dialog", { name: "新建产品" });
  await drawer.getByLabel("产品编号").fill(code);
  await drawer.getByLabel("产品名称").fill(name);
  await drawer.getByLabel("工序名称").fill("车削");
  await drawer.getByLabel("单价（元/件）", {exact:true}).fill("2.5");
  await drawer.getByRole("button", { name: "添加下一道工序" }).click();
  await drawer.getByLabel("工序名称").nth(1).fill("终检");
  await drawer.getByLabel("单价（元/件）", {exact:true}).nth(1).fill("0.5");
  const product = await save(page, drawer, "保存产品", "/products");
  const customer = await api(page, "/resources/customers", {
    code: unique("C"),
    name: `客户 ${code}`,
    data: {},
  });
  await page.goto("/sales-orders");
  await page.getByRole("button", { name: "新建订单" }).click();
  drawer = page.getByRole("dialog", { name: "新建销售订单" });
  await choose(page, drawer, "客户", customer.name);
  await choose(page, drawer, "产品", `${code} · ${name}`);
  await drawer.getByLabel("数量", { exact: true }).fill("3");
  const order = await save(page, drawer, "创建订单", "/sales-orders");
  await page.goto("/work-orders");
  await page.getByRole("button", { name: "下达工单" }).click();
  drawer = page.getByRole("dialog", { name: "下达生产工单" });
  await choose(page, drawer, "生产产品", `${code} · ${name}`);
  await choose(
    page,
    drawer,
    "关联销售订单",
    `${order.code} · ${customer.name}`,
  );
  await drawer.getByLabel("生产数量").fill("3");
  const wo = await save(page, drawer, "下达工单", "/work-orders");

  await login(page, workerLogin);
  await page.goto(`/station?workOrderId=${wo.id}`);
  await expect(page.locator(".station-task")).toHaveCount(2);
  await expect(
    page
      .locator(".station-task")
      .nth(1)
      .getByRole("button", { name: /收\s*料$/ }),
  ).toBeDisabled();
  for (let i = 0; i < 2; i++) {
    await page
      .locator(".station-task")
      .nth(i)
      .getByRole("button", { name: /收\s*料$/ })
      .click();
    const receive = page.getByRole("dialog", { name: /^收料 ·/ });
    const report = await save(
      page,
      receive,
      "确认收料",
      `/tasks/${wo.tasks[i].id}/receive`,
    );
    const startResponse = mutation(page, `/reports/${report.id}/start`);
    const card = page.locator(".my-work-card").filter({ hasText: wo.code });
    await card.getByRole("button", { name: "开始加工" }).click();
    expect((await startResponse).ok()).toBeTruthy();
    await card.getByRole("button", { name: "登记完工" }).click();
    const complete = page.getByRole("dialog", { name: "登记本次完工" });
    await complete.getByLabel("实际完工数量").fill("3");
    await save(
      page,
      complete,
      "提交报工审核",
      `/reports/${report.id}/complete`,
    );
    await expect(card).toHaveCount(0);
  }
  const completed = await api(page, `/work-orders/${wo.id}`);
  expect(completed.status).toBe("complete");
  expect(Number(completed.completedQuantity)).toBe(3);
  await login(page, "quality");
  await page.goto("/reports");
  for (const report of completed.reports) {
    const row = page
      .locator("tr")
      .filter({ hasText: wo.code })
      .filter({ hasText: report.taskName });
    await row.getByRole("button", { name: /批\s*准$/ }).click();
    const pending = mutation(page, `/reports/${report.id}/approve`);
    await page.getByRole("button", { name: /确\s*定$/ }).click();
    expect((await pending).ok()).toBeTruthy();
    await expect(row.getByRole("button", { name: /批\s*准$/ })).toHaveCount(0);
  }
  await login(page, "warehouse");
  await page.goto("/inventory");
  for (const [direction, quantity] of [
    ["in", 3],
    ["out", 1],
  ] as const) {
    drawer = await stockForm(
      page,
      code,
      name,
      quantity,
      direction,
      order.code,
      customer.name,
    );
    await save(page, drawer, "确认入账", "/stock-movements");
    await expect(drawer).not.toBeVisible();
  }
  const inventory = await api(page, `/inventory?q=${code}`);
  expect(
    Number(
      inventory.items.find(
        (x: any) => x.productId === product.id && x.salesOrderId === order.id,
      )?.quantity,
    ),
  ).toBe(2);
  await login(page, workerLogin);
  const wages = await api(page, "/payroll");
  expect(
    wages.items
      .filter((x: any) =>
        completed.reports.some((r: any) => r.id === x.sourceId),
      )
      .reduce((s: number, x: any) => s + Number(x.amount), 0),
  ).toBe(9);
});

test("所有管理页面及资源目录真实加载，桌面和手机没有页面级溢出", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (
      r.url().includes("/api/") &&
      r.status() >= 400 &&
      !r.url().endsWith("/auth/me")
    )
      errors.push(`${r.status()} ${r.url()}`);
  });
  await login(page);
  const paths = [
    "/products",
    "/sales-orders",
    "/work-orders",
    "/station",
    "/reports",
    "/scraps",
    "/inventory",
    "/devices",
    "/payroll",
    "/users",
    "/audit-logs",
    ...resourceDefinitions.map((r) => `/resources/${r.key}`),
  ];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator(".page-heading h1")).toBeVisible();
    await expect(page.locator(".ant-spin-spinning")).toHaveCount(0);
    await expect(page.locator(".ant-alert-error")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      path,
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/station",
    "/work-orders",
    "/inventory",
    "/resources/documents",
  ]) {
    await page.goto(path);
    await expect(page.locator(".page-heading h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      path,
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
  await page.goto("/station");
  await page.screenshot({
    path: ".local/qa/mobile-station.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("只读角色无写入入口，敏感工资和人员接口由服务端拒绝", async ({ page }) => {
  await login(page, "viewer");
  await page.goto("/products");
  await expect(page.getByRole("button", { name: "新建产品" })).toHaveCount(0);
  await page.goto("/inventory");
  await expect(
    page.getByRole("button", { name: "成品入库", exact: true }),
  ).toHaveCount(0);
  for (const path of [
    "/payroll",
    "/users",
    "/resources/work-hours",
    "/resources/safety-penalties",
  ]) {
    const response = await page.request.get(`${origin}/api${path}`);
    expect(response.status(), path).toBe(403);
  }
  const write = await page.request.post(`${origin}/api/products`, {
    headers: { origin },
    data: { code: "DENY", name: "不可创建" },
  });
  expect(write.status()).toBe(403);
});

test("文件上传后可关联作业文件，刷新仍能读取原始附件", async ({ page }) => {
  await login(page);
  await page.goto("/resources/documents");
  await page.getByRole("button", { name: /新建/ }).click();
  const drawer = page.getByRole("dialog", { name: /^新建/ });
  const name = unique("作业指导");
  await drawer.getByLabel("名称 / 标题").fill(name);
  await drawer.getByLabel("版本", { exact: true }).fill("1.0");
  await drawer
    .getByLabel("正文", { exact: true })
    .fill("夹紧工件，核对图纸，完成后登记实际数量。");
  const upload = mutation(page, "/files");
  await drawer
    .locator("input[type=file]")
    .setInputFiles({
      name: "作业说明.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("夹紧工件后开机。", "utf8"),
    });
  const file = await (await upload).json();
  await expect(drawer.getByText("作业说明.txt", { exact: true })).toBeVisible();
  await save(page, drawer, "保存草稿", "/resources/documents");
  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("作业说明.txt", { exact: true }),
  ).toBeVisible();
  const response = await page.request.get(`${origin}/api/files/${file.id}`);
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toBe("夹紧工件后开机。");
});

test("入库响应丢失后重试沿用幂等键，库存只记一次", async ({ page }) => {
  await login(page);
  const code = unique("RETRY");
  const name = "网络恢复验收";
  const product = await api(page, "/products", {
    code,
    name,
    unit: "件",
    steps: [{ name: "加工", unitPrice: 1, expectedMinutes: 1 }],
  });
  const wo = await api(page, "/work-orders", {
    productId: product.id,
    quantity: 5,
  });
  const report = await api(page, `/tasks/${wo.tasks[0].id}/receive`, {
    requestId: crypto.randomUUID(),
  });
  await api(page, `/reports/${report.id}/start`, {});
  await api(page, `/reports/${report.id}/complete`, {
    quantity: 5,
    requestId: crypto.randomUUID(),
  });
  await page.goto("/inventory");
  const drawer = await stockForm(page, code, name, 2, "in");
  const bodies: any[] = [];
  await page.route("**/api/stock-movements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort("failed");
    } else await route.continue();
  });
  await drawer.getByRole("button", { name: "确认入账", exact: true }).click();
  await expect(page.locator(".ant-message-error")).toBeVisible();
  await save(page, drawer, "确认入账", "/stock-movements");
  expect(bodies).toHaveLength(2);
  expect(bodies[0].requestId).toBe(bodies[1].requestId);
  const result = await api(page, `/inventory?q=${code}`);
  expect(
    Number(result.items.find((x: any) => x.productId === product.id)?.quantity),
  ).toBe(2);
});

test("主管派任务、操作员反馈、主管确认形成实际办理闭环", async ({ page }) => {
  await login(page);
  const users = await api(page, "/users");
  const operator = users.items.find((u: any) => u.username === "operator");
  expect(operator).toBeTruthy();
  const name = unique("派工验收");
  const task = await api(page, "/resources/work-tasks", {
    name,
    data: { assigneeId: operator.id, description: "核对工装和备料" },
  });
  await api(page, `/resources/work-tasks/${task.id}/transition`, {
    revision: task.revision,
    action: "submit",
  });
  await login(page, "operator");
  await page.goto("/resources/work-tasks");
  let row = page.locator("tr").filter({ hasText: name });
  await row.getByRole("button", { name: "执行反馈" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill("已核对工装并备齐材料。");
  const pending = mutation(page, `/resources/work-tasks/${task.id}/feedback`);
  await dialog.getByRole("button", { name: /提交/ }).click();
  expect((await pending).ok()).toBeTruthy();
  await login(page);
  await page.goto("/resources/work-tasks");
  row = page.locator("tr").filter({ hasText: name });
  await row.getByRole("button", { name: /批\s*准$/ }).click();
  const approved = mutation(
    page,
    `/resources/work-tasks/${task.id}/transition`,
  );
  await page.getByRole("button", { name: /确\s*定$/ }).click();
  expect((await approved).ok()).toBeTruthy();
  const result = await api(page, `/resources/work-tasks/${task.id}`);
  expect(result.status).toBe("approved");
  expect(result.data.result).toBe("已核对工装并备齐材料。");
  expect(result.feedbackBy).toBe(operator.id);
});

test("会话检查短暂失败保留未提交表单，重新连接可恢复", async ({ page }) => {
  await login(page);
  await page.goto("/inventory");
  await page.getByRole("button", { name: "成品入库" }).click();
  const drawer = page.getByRole("dialog", { name: "登记成品出入库" });
  await drawer.getByLabel("用途 / 说明").fill("这条未提交说明必须保留");
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "暂时维护" } }),
    }),
  );
  const recheck = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth/me") && r.status() === 503,
  );
  await api(page, "/resources/customers", {
    name: unique("触发实时刷新"),
    data: {},
  });
  await recheck;
  await expect(drawer.getByLabel("用途 / 说明")).toHaveValue(
    "这条未提交说明必须保留",
  );
  await page.unroute("**/api/auth/me");
  // The drawer masks the header retry control; close it after proving form survival.
  await drawer.getByRole("button", { name: /关闭/ }).click();
  await page.getByRole("button", { name: "重新连接" }).click();
  await expect(page.getByRole("button", { name: "重新连接" })).toHaveCount(0);
  await expect(page.locator(".page-heading h1")).toHaveText("成品库存");
});

test("客户超过一页后，销售订单仍可选择较早的客户", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  const prefix = unique("分页验收");
  const target = await api(page, "/resources/customers", {
    name: `${prefix} 早期客户`,
    data: {},
  });
  for (let group = 0; group < 11; group++) {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        api(page, "/resources/customers", {
          name: `${prefix} 后续客户 ${group * 10 + i}`,
          data: {},
        }),
      ),
    );
  }
  await page.goto("/sales-orders");
  await page.getByRole("button", { name: "新建订单" }).click();
  const drawer = page.getByRole("dialog", { name: "新建销售订单" });
  await choose(page, drawer, "客户", target.name);
  const product = (await api(page, "/products?pageSize=1")).items[0];
  await choose(page, drawer, "产品", `${product.code} · ${product.name}`);
  const order = await save(page, drawer, "创建订单", "/sales-orders");
  expect(order.customerId).toBe(target.id);
});
