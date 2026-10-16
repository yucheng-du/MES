import { authenticate } from "./helpers/auth";
import {
  test,
  expect,
  type Page,
  type Locator,
  type TestInfo,
} from "@playwright/test";
const origin = process.env.MES_BASE_URL ?? "http://127.0.0.1:5173";
const unique = (s: string) => `${s}-${crypto.randomUUID().slice(0, 8)}`;
async function api(page: Page, path: string, data?: object, method = "POST") {
  const r = await page.request.fetch(`${origin}/api${path}`, {
    method: data ? method : "GET",
    data,
    headers: { origin },
  });
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return r.json();
}
async function login(page: Page, user = "admin") {
  await authenticate(page, user);
  await page.goto("/products");
  if (
    await page
      .getByRole("button", { name: "Switch to English", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "Switch to English", exact: true })
      .click();
}
async function choose(page: Page, scope: Locator, label: string, text: string) {
  // Select measures its popup from the control. Wait for the dialog's scale/slide
  // animation to finish so that it does not cache the entering control's width.
  await expect
    .poll(() =>
      scope.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          Math.abs(box.width - (element as HTMLElement).offsetWidth) < 1 &&
          box.left >= -1 &&
          box.right <= innerWidth + 1
        );
      }),
    )
    .toBeTruthy();
  const control = scope.getByLabel(label, { exact: false });
  await control.click();
  await control.fill(text);
  const option = page
    .locator(".ant-select-dropdown:visible")
    .getByTitle(text, { exact: true });
  await expect(option).toBeVisible();
  await option.click();
}
async function mutation(page: Page, path: string, run: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith(`/api${path}`) && r.request().method() !== "GET",
  );
  await run();
  const r = await response;
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const active = page.getByRole("dialog").last();
  if (await active.isVisible())
    await expect
      .poll(async () => {
        const box = await active.boundingBox();
        return box
          ? Math.abs(box.x + box.width - page.viewportSize()!.width) < 3 ||
              (box.x >= 0 &&
                box.x + box.width <= page.viewportSize()!.width + 1)
          : false;
      })
      .toBeTruthy();
  await expect(page.getByText(/^(Action completed|操作已完成)$/)).toHaveCount(
    0,
  );
  await page.screenshot({
    path: testInfo.outputPath(name),
    animations: "disabled",
    fullPage: false,
  });
}

test("production setup, process variants and task assignments work in both languages", async ({
  page,
}, testInfo) => {
  await login(page);
  const typeName = unique("Qualified cutting");
  await page
    .getByRole("button", { name: "Production setup", exact: true })
    .click();
  const setup = page.getByRole("dialog", {
    name: "Production setup",
    exact: true,
  });
  await setup.getByLabel("Code", { exact: true }).fill(unique("TYPE"));
  await setup.getByLabel("Name", { exact: true }).fill(typeName);
  const type = await mutation(page, "/production/procedure-types", () =>
    setup.getByRole("button", { name: "Add procedure type" }).click(),
  );
  await setup.getByRole("button", { name: "切换为中文", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "生产基础设置", exact: true })
      .getByRole("tab", { name: "人员工序资格" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "生产基础设置", exact: true })
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await setup.getByRole("button", { name: "Close", exact: true }).click();
  const p = await api(page, "/products", {
    code: unique("P"),
    name: unique("Route part"),
    steps: [{ name: "Base cut", unitPrice: 2, expectedMinutes: 1 }],
  });
  await page.reload();
  const productRow = page.getByRole("row").filter({ hasText: p.code });
  await productRow
    .getByRole("button", { name: "Process routes", exact: true })
    .click();
  const routes = page.getByRole("dialog", {
    name: "Process routes",
    exact: true,
  });
  await routes
    .getByRole("button", { name: "Add process route", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit process route",
    exact: true,
  });
  await editor
    .getByLabel("Route name", { exact: true })
    .fill(unique("Special route"));
  await editor
    .getByText("Qualifications, scrap rates and instructions", { exact: true })
    .click();
  await choose(page, editor, "Procedure type and qualification", typeName);
  await editor
    .getByLabel("Operating instructions", { exact: true })
    .fill("Clamp the fixture before starting.");
  await screenshot(page, testInfo, "production-route-desktop-en.png");
  await editor.getByRole("button", { name: "切换为中文", exact: true }).click();
  const zhEditor = page.getByRole("dialog", {
    name: "编辑工艺方案",
    exact: true,
  });
  await expect(
    zhEditor.getByLabel("作业指导说明", { exact: true }),
  ).toHaveValue("Clamp the fixture before starting.");
  await screenshot(page, testInfo, "production-route-desktop-zh.png");
  await zhEditor
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  const route = await mutation(page, "/production/routes", () =>
    editor
      .getByRole("button", { name: "Save process route", exact: true })
      .click(),
  );
  await expect(editor).not.toBeVisible();
  const users = await api(page, "/users");
  const worker = users.items.find((u: any) => u.username === "operator");
  await api(
    page,
    `/production/qualifications/${worker.id}/${type.id}`,
    { active: true },
    "PUT",
  );
  const work = await api(page, "/work-orders", {
    productId: p.id,
    quantity: 4,
    routeId: route.id,
  });
  await page.goto(`/work-orders/${work.id}`);
  await page.getByRole("button", { name: "Assign task", exact: true }).click();
  const assignment = page.getByRole("dialog", { name: /^Assign task/ });
  await choose(page, assignment, "Assigned operator", worker.name);
  const assigned = await mutation(
    page,
    `/tasks/${work.tasks[0].id}/assignment`,
    () => assignment.getByRole("button", { name: "OK", exact: true }).click(),
  );
  expect(assigned.assignedWorkerId).toBe(worker.id);
  await expect(assignment).not.toBeVisible();
  await expect(
    page.getByText(worker.name, { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByText("Operating and inspection guidance", { exact: true })
    .click();
  await expect(
    page.getByText("Clamp the fixture before starting.", { exact: true }),
  ).toBeVisible();
});

test("qualified operator goes on duty, receives, completes and leaves an idle log on mobile", async ({
  page,
}, testInfo) => {
  await login(page);
  const type = await api(page, "/production/procedure-types", {
    code: unique("TYPE"),
    name: unique("Mobile cut"),
  });
  const users = await api(page, "/users"),
    worker = users.items.find((u: any) => u.username === "operator");
  await api(
    page,
    `/production/qualifications/${worker.id}/${type.id}`,
    { active: true },
    "PUT",
  );
  const device = await api(page, "/resources/devices", {
    code: unique("DEVICE"),
    name: unique("Mobile machine"),
    data: {},
  });
  const station = await api(page, "/resources/workstations", {
    code: unique("ST"),
    name: unique("Mobile station"),
    data: {},
  });
  await api(
    page,
    `/production/stations/${station.id}/config`,
    { procedureTypeId: type.id, deviceId: device.id, idleThresholdMinutes: 1 },
    "PATCH",
  );
  const p = await api(page, "/products", {
    code: unique("PART"),
    name: unique("Mobile part"),
    steps: [
      {
        name: "Mobile cut",
        unitPrice: 2,
        expectedMinutes: 1,
        procedureTypeId: type.id,
      },
    ],
  });
  const work = await api(page, "/work-orders", {
    productId: p.id,
    quantity: 3,
  });
  await login(page, "operator");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/station?workOrderId=${work.id}`);
  const row = page.getByRole("row").filter({ hasText: station.name });
  await mutation(page, `/production/stations/${station.id}/on-duty`, () =>
    row.getByRole("button", { name: "Go on duty", exact: true }).click(),
  );
  await expect(row.getByText("On duty", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Receive materials", exact: true })
    .click();
  const receive = page.getByRole("dialog", {
    name: /^Receive materials · Mobile cut/,
  });
  await choose(page, receive, "Workstation (required)", station.name);
  await mutation(page, `/tasks/${work.tasks[0].id}/receive`, () =>
    receive
      .getByRole("button", { name: "Confirm receipt", exact: true })
      .click(),
  );
  await expect(receive).not.toBeVisible();
  await page.getByRole("button", { name: /Start work$/ }).click();
  await page.getByRole("button", { name: /Report completion$/ }).click();
  const complete = page.getByRole("dialog", {
    name: /^Report completed production/,
  });
  await complete
    .getByRole("button", { name: "Submit report for approval", exact: true })
    .click();
  await expect(complete).not.toBeVisible();
  await mutation(page, `/production/stations/${station.id}/off-duty`, () =>
    row.getByRole("button", { name: "Off duty", exact: true }).click(),
  );
  await row
    .getByRole("button", { name: "Duty and idle logs", exact: true })
    .click();
  const logs = page.getByRole("dialog", {
    name: "Duty and idle logs",
    exact: true,
  });
  await expect(
    logs
      .getByRole("cell", { name: "On duty without material", exact: true })
      .first(),
  ).toBeVisible();
  await screenshot(page, testInfo, "station-logs-mobile-en.png");
  await logs.getByRole("button", { name: "切换为中文", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "状态与无料日志", exact: true })
      .getByRole("columnheader", { name: "持续分钟", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBeTruthy();
  await screenshot(page, testInfo, "station-logs-mobile-zh.png");
  await page
    .getByRole("dialog", { name: "状态与无料日志", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.goto("/reports");
  await page
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: work.code })
    .getByRole("button", { name: "Production report details", exact: true })
    .click();
  const reportDetails = page.getByRole("dialog", {
    name: "Production report details",
    exact: true,
  });
  await expect(
    reportDetails.getByText("Equipment snapshot at completion", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    reportDetails.getByText(device.name, { exact: true }),
  ).toBeVisible();
  await expect(
    reportDetails.getByText("Unknown duration (seconds)", { exact: true }),
  ).toBeVisible();
  await screenshot(page, testInfo, "report-equipment-mobile-en.png");
});
