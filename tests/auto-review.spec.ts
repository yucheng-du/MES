import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { authenticate } from "./helpers/auth";

const origin = process.env.MES_BASE_URL ?? "http://127.0.0.1:5173";
const saved = [
  "enabled",
  "delayMinutes",
  "maxAmount",
  "minDurationRatio",
  "requireFullQuantity",
] as const;
let previous: Record<string, any>;

async function request(
  client: APIRequestContext,
  path: string,
  data?: object,
  method = "POST",
) {
  const response = await client.fetch(`${origin}/api${path}`, {
    method: data ? method : "GET",
    data,
    headers: { origin },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function login(page: Page, username = "admin") {
  await authenticate(page, username);
  await page.goto("/");
  await expect(page.locator(".dashboard-welcome")).toBeVisible();
}
async function configure(client: APIRequestContext, values: object) {
  const { settings } = await request(client, "/settings/auto-review");
  return request(
    client,
    "/settings/auto-review",
    {
      ...Object.fromEntries(saved.map((k) => [k, settings[k]])),
      ...values,
      revision: settings.revision,
    },
    "PATCH",
  );
}
async function report(client: APIRequestContext, unitPrice = 2) {
  const product = await request(client, "/products", {
    code: `AUTO-${crypto.randomUUID().slice(0, 12)}`,
    name: "自动审核验收件",
    unit: "件",
    steps: [{ name: "加工", unitPrice, expectedMinutes: 1 }],
  });
  const work = await request(client, "/work-orders", {
    productId: product.id,
    quantity: 3,
  });
  const received = await request(client, `/tasks/${work.tasks[0].id}/receive`, {
    requestId: crypto.randomUUID(),
  });
  await request(client, `/reports/${received.id}/start`, {});
  await request(client, `/reports/${received.id}/complete`, {
    quantity: 3,
    requestId: crypto.randomUUID(),
  });
  return { ...received, workOrderCode: work.code };
}
async function readReport(
  client: APIRequestContext,
  r: { id: string; workOrderCode: string },
) {
  const result = await request(client, `/reports?q=${r.workOrderCode}`);
  return result.items.find((item: any) => item.id === r.id);
}
test.beforeEach(async ({ page }) => {
  await login(page);
  previous = (await request(page.request, "/settings/auto-review")).settings;
});
test.afterEach(async ({ context }) => {
  if (previous)
    await configure(
      context.request,
      Object.fromEntries(saved.map((k) => [k, previous[k]])),
    );
});

test("页面保存自动审核配置，正常报工自动计薪，超额记录留人工并解释原因", async ({
  page,
}) => {
  await page.goto("/reports");
  await page.getByRole("button", { name: "自动审核设置" }).click();
  const drawer = page.getByRole("dialog", { name: "自动审核设置" });
  // Keep field selectors tied to visible labels; these controls are part of the operator-facing contract.
  await drawer.getByLabel("等待时间（分钟）").fill("0");
  await drawer.getByLabel("单笔金额上限（元）").fill("100");
  await drawer.getByLabel("最低用时比例（%）").fill("0");
  const save = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/settings/auto-review") &&
      r.request().method() === "PATCH",
  );
  await drawer.getByRole("button", { name: "保存设置" }).click();
  expect((await save).ok()).toBeTruthy();
  await expect(drawer).not.toBeVisible();
  const normal = await report(page.request);
  const expensive = await report(page.request, 50);
  const run = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/settings/auto-review/run") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "立即检查" }).click();
  expect((await run).ok()).toBeTruthy();
  const approved = await readReport(page.request, normal);
  expect(approved.status).toBe("approved");
  expect(approved.approvalMode).toBe("automatic");
  const manual = await readReport(page.request, expensive);
  expect(manual.status).toBe("complete");
  expect(manual.autoReviewStatus).toBe("manual");
  expect(manual.autoReviewReasons.join(" ")).toMatch(/金额|上限/);
  await request(page.request, "/settings/auto-review/run", {});
  const wages = await request(page.request, "/payroll?pageSize=200");
  expect(wages.items.filter((w: any) => w.sourceId === normal.id)).toHaveLength(
    1,
  );
  expect(
    wages.items.filter((w: any) => w.sourceId === expensive.id),
  ).toHaveLength(0);
  await page.reload();
  await expect(
    page.locator("tr").filter({ hasText: expensive.workOrderCode }),
  ).toContainText(/金额|上限/);
});

test("停用后不审批，重新启用也不会追溯放行停用期间的报工", async ({ page }) => {
  await configure(page.request, {
    enabled: false,
    delayMinutes: 0,
    minDurationRatio: 0,
  });
  const old = await report(page.request);
  await request(page.request, "/settings/auto-review/run", {});
  expect((await readReport(page.request, old)).status).toBe("complete");
  await configure(page.request, {
    enabled: true,
    delayMinutes: 0,
    minDurationRatio: 0,
  });
  await request(page.request, "/settings/auto-review/run", {});
  const held = await readReport(page.request, old);
  expect(held.status).toBe("complete");
  expect(held.autoReviewStatus).toBe("manual");
  expect(held.autoReviewReasons.join(" ")).toMatch(/停用|启用|历史|积压/);
});

test("网页关闭后，服务端定时任务仍自动审核并只计薪一次", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await configure(page.request, {
    enabled: true,
    delayMinutes: 0,
    maxAmount: 2000,
    minDurationRatio: 0,
    requireFullQuantity: false,
  });
  const normal = await report(page.request);
  await page.close();
  await expect
    .poll(async () => (await readReport(context.request, normal)).status, {
      timeout: 75_000,
      intervals: [1000, 2000, 5000],
    })
    .toBe("approved");
  const approved = await readReport(context.request, normal);
  expect(approved.approvalMode).toBe("automatic");
  const status = await request(context.request, "/settings/auto-review");
  expect(status.lastRun.trigger).toBe("timer");
  const wages = await request(context.request, "/payroll?pageSize=200");
  expect(wages.items.filter((w: any) => w.sourceId === normal.id)).toHaveLength(
    1,
  );
});
