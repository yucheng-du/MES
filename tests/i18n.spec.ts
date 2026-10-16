import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { authenticate, submitLogin } from "./helpers/auth";

const cjk = /[\u3400-\u9fff]/;
const screenshotDirectory = ".local/qa/i18n";
const checks = new WeakMap<Page, { writes: string[]; errors: string[] }>();

// The language suite reads existing business data. Even an accidental save is
// blocked, so it can be run independently from the mutating workflow suite.
test.beforeEach(async ({ page }) => {
  const state = { writes: [] as string[], errors: [] as string[] };
  checks.set(page, state);
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      !new URL(request.url()).pathname.endsWith("/auth/login")
    ) {
      state.writes.push(
        `${request.method()} ${new URL(request.url()).pathname}`,
      );
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(checks.get(page)?.writes, "No business writes are allowed").toEqual(
    [],
  );
  expect(checks.get(page)?.errors, "No uncaught browser errors").toEqual([]);
});

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
});

test.use({ viewport: { width: 1440, height: 1000 } });

async function language(page: Page, target: "en" | "zh") {
  const name = target === "en" ? "Switch to English" : "切换为中文";
  const dialogButton = page
    .getByRole("dialog")
    .getByRole("button", { name, exact: true });
  const button = (await dialogButton.count())
    ? dialogButton.last()
    : page.getByRole("button", { name, exact: true }).last();
  await expect(button).toBeInViewport();
  await button.click();
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    target === "en" ? "en-US" : "zh-CN",
  );
}

async function signIn(page: Page) {
  await authenticate(page);
  await page.goto("/");
  await language(page, "en");
  await expect(page.getByRole("menuitem", { name: /Overview/ })).toBeAttached();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Have a productive day",
  );
}

async function englishText(locator: Locator, context: string, minimum = 1) {
  const texts = (await locator.allTextContents())
    .map((value) => value.trim())
    .filter(Boolean);
  expect(
    texts.length,
    `${context}: controls should be rendered`,
  ).toBeGreaterThanOrEqual(minimum);
  expect(
    texts.filter((value) => cjk.test(value)),
    `${context}: system text should be English`,
  ).toEqual([]);
}

async function noPageOverflow(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        width: document.documentElement.scrollWidth,
      })),
    )
    .toMatchObject({ viewport: page.viewportSize()!.width });
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(
    overflow,
    `${new URL(page.url()).pathname}: page-level horizontal overflow`,
  ).toBeLessThanOrEqual(1);
}

async function screenshot(page: Page, name: string) {
  await expect(page.locator(".ant-spin-spinning:visible")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  for (const dialog of await page.getByRole("dialog").all()) {
    if (!(await dialog.isVisible())) continue;
    await expect
      .poll(
        async () => {
          const bounds = await dialog.boundingBox();
          return Boolean(
            bounds &&
            bounds.x >= -1 &&
            bounds.x + bounds.width <= page.viewportSize()!.width + 1,
          );
        },
        { message: "Wait for the dialog to finish entering the viewport" },
      )
      .toBe(true);
  }
  await page.screenshot({
    path: `${screenshotDirectory}/${name}.png`,
    fullPage: (await page.getByRole("dialog").count()) === 0,
    animations: "disabled",
  });
}

const mainRoutes = [
  ["/statistics", "Business statistics"],
  ["/boards", "Shop floor boards"],
  ["/products", "Products & routing"],
  ["/sales-orders", "Sales orders"],
  ["/work-orders", "Work orders"],
  ["/station", "Shop floor"],
  ["/reports", "Production reports"],
  ["/scraps", "Scrap review"],
  ["/inventory", "Finished goods"],
  ["/devices", "Equipment"],
  ["/payroll", "Piecework pay"],
  ["/users", "People & access"],
  ["/audit-logs", "Audit log"],
] as const;

const resourceRoutes = [
  ["customers", "Customers"],
  ["suppliers", "Suppliers"],
  ["departments", "Departments"],
  ["materials", "Raw materials"],
  ["auxiliary-materials", "Consumables"],
  ["devices", "Equipment register"],
  ["workstations", "Workstations"],
  ["molds", "Molds"],
  ["tools", "Fixtures and tools"],
  ["purchase-orders", "Purchase requests"],
  ["purchase-receipts", "Material receipts"],
  ["purchase-issues", "Material issues"],
  ["auxiliary-receipts", "Consumable receipts"],
  ["auxiliary-issues", "Consumable issues"],
  ["purchase-comparisons", "Quotation comparisons"],
  ["reimbursements", "Purchase reimbursements"],
  ["inspections", "Quality inspections"],
  ["maintenance-plans", "Maintenance plans"],
  ["maintenance-records", "Maintenance records"],
  ["inspection-records", "Equipment checks"],
  ["repair-records", "Equipment repairs"],
  ["mold-maintenance", "Mold maintenance"],
  ["tool-maintenance", "Tool maintenance"],
  ["andon-events", "Andon calls"],
  ["safety-incidents", "Safety incidents"],
  ["safety-checklists", "Safety checks"],
  ["safety-training", "Safety training"],
  ["safety-penalties", "Safety rewards and penalties"],
  ["work-tasks", "Work tasks"],
  ["work-hours", "Hourly work"],
  ["customer-complaints", "Customer complaints"],
  ["improvements", "Improvement suggestions"],
  ["documents", "Work documents"],
  ["contracts", "Contracts"],
] as const;

const optionChecks: Record<string, { field: string; values: string[] }[]> = {
  inspections: [
    {
      field: "Inspection type",
      values: ["Incoming", "In-process", "Finished goods"],
    },
    { field: "Conclusion", values: ["Pass", "Fail", "Accept with concession"] },
  ],
  "inspection-records": [
    { field: "Check result", values: ["Normal", "Abnormal"] },
  ],
  "andon-events": [
    {
      field: "Issue type",
      values: [
        "Equipment fault",
        "Quality issue",
        "Material shortage",
        "Other",
      ],
    },
  ],
  "safety-penalties": [{ field: "Type", values: ["Reward", "Penalty"] }],
  contracts: [{ field: "Contract type", values: ["Sales", "Purchasing"] }],
};

test("login language switches with one click and persists after refresh", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎回来", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await screenshot(page, "login-desktop-zh");
  const unchangedUrl = page.url();
  const navigationEntries = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  await language(page, "en");
  expect(page.url()).toBe(unchangedUrl);
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(navigationEntries);
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("MES · Manufacturing Execution System");
  await screenshot(page, "login-desktop-en");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back", exact: true }),
  ).toBeVisible();
  await language(page, "zh");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "欢迎回来", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("账号", { exact: true })).toBeVisible();
});

test("login validation, rejected credentials and successful sign-in retain language", async ({
  page,
}) => {
  await page.goto("/");
  await language(page, "en");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await expect(
    page.getByText("Enter your username", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Enter your password", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("IncorrectForLocaleCheck!");
  const rejected = await submitLogin(
    page,
    page.getByRole("button", { name: /^Sign in/ }),
  );
  expect(rejected.status()).toBe(401);
  await expect(page.getByRole("alert")).toContainText(
    "Incorrect username or password",
  );
  await language(page, "zh");
  await expect(page.getByRole("alert")).toContainText("账号或密码错误");
  await language(page, "en");
  await page.getByLabel("Password", { exact: true }).fill("MesDemo2026!");
  const signedIn = await submitLogin(
    page,
    page.getByRole("button", { name: /^Sign in/ }),
  );
  expect(signedIn.status()).toBe(200);
  await expect(page.getByRole("menuitem", { name: /Overview/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Have a productive day",
  );
});

test("switching an open product editor preserves unsaved business input", async ({
  page,
}) => {
  await signIn(page);
  await screenshot(page, "dashboard-desktop-en");
  await language(page, "zh");
  await screenshot(page, "dashboard-desktop-zh");
  await page.getByRole("menuitem", { name: /产品与工艺/ }).click();
  await page.getByRole("button", { name: /新建产品/ }).click();
  const dialog = page.getByRole("dialog", { name: "新建产品", exact: true });
  await dialog
    .getByLabel("产品编号", { exact: true })
    .fill("UNSAVED-LANGUAGE-CHECK");
  await dialog
    .getByLabel("产品名称", { exact: true })
    .fill("未保存样品 / Unsaved sample");
  await dialog
    .getByLabel("工序名称", { exact: true })
    .fill("用户工序 / User operation");
  await language(page, "en");
  const englishDialog = page.getByRole("dialog", {
    name: "New product",
    exact: true,
  });
  await expect(englishDialog).toBeVisible();
  await expect(
    englishDialog.getByLabel("Product code", { exact: true }),
  ).toHaveValue("UNSAVED-LANGUAGE-CHECK");
  await expect(
    englishDialog.getByLabel("Product name", { exact: true }),
  ).toHaveValue("未保存样品 / Unsaved sample");
  await expect(
    englishDialog.getByLabel("Step name", { exact: true }),
  ).toHaveValue("用户工序 / User operation");
  await expect(
    englishDialog.getByLabel("Piece rate (CNY/pc)", { exact: true }),
  ).toBeVisible();
  await englishText(
    englishDialog.locator("label"),
    "product editor field labels",
    6,
  );
  await screenshot(page, "product-editor-desktop-en");
  await language(page, "zh");
  await expect(
    page
      .getByRole("dialog", { name: "新建产品", exact: true })
      .getByLabel("产品名称", { exact: true }),
  ).toHaveValue("未保存样品 / Unsaved sample");
});

test("all primary routes and 34 resource editors expose English system labels", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  for (const [path, title] of mainRoutes) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: title, level: 1, exact: true }),
      ).toBeVisible();
      if (path === "/station") {
        // The greeting deliberately preserves the signed-in user's name.
        await expect(page.locator(".page-heading p")).toContainText(
          "start by receiving materials and follow each process step through to completion",
        );
        await englishText(
          page.locator(".page-heading h1, .page-heading .eyebrow"),
          `${path}: headings`,
        );
      } else {
        await englishText(
          page.locator(".page-heading"),
          `${path}: heading and description`,
        );
      }
      const headers = page.getByRole("columnheader");
      if (await headers.count())
        await englishText(headers, `${path}: table headers`);
      await noPageOverflow(page);
    });
  }

  const ordersResponse = await page.request.get("/api/work-orders?pageSize=1");
  expect(ordersResponse.ok()).toBeTruthy();
  const firstOrder = (await ordersResponse.json()).items[0];
  expect(
    firstOrder,
    "Seeded environment provides a work order for the detail view",
  ).toBeTruthy();
  await page.goto(`/work-orders/${firstOrder.id}`);
  await expect(
    page.getByRole("heading", { name: firstOrder.code, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Open workstation/ }),
  ).toBeVisible();
  await englishText(
    page.getByRole("columnheader"),
    "work order detail table headers",
  );

  for (const [key, title] of resourceRoutes) {
    await test.step(`resource: ${key}`, async () => {
      await page.goto(`/resources/${key}`);
      await expect(
        page.getByRole("heading", { name: title, level: 1, exact: true }),
      ).toBeVisible();
      await englishText(page.locator(".page-heading"), `${key}: metadata`);
      await englishText(
        page.locator(".resource-directory"),
        `${key}: directory`,
      );
      await expect(
        page.getByRole("columnheader", { name: "Name / Code", exact: true }),
      ).toBeVisible();
      await englishText(
        page.getByRole("columnheader"),
        `${key}: table headers`,
        3,
      );
      await page
        .getByRole("button", { name: new RegExp(`New ${title}`) })
        .click();
      const editor = page.getByRole("dialog", {
        name: `New ${title}`,
        exact: true,
      });
      await expect(
        editor.getByLabel("Name / Title", { exact: true }),
      ).toBeVisible();
      await englishText(editor.locator("label"), `${key}: all form fields`, 3);
      await expect(
        editor.getByRole("button", { name: /^Save(?: draft)?$/, exact: false }),
      ).toBeVisible();
      const placeholders = await editor
        .locator("input[placeholder], textarea[placeholder]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("placeholder") || ""),
        );
      expect(
        placeholders.filter((text) => cjk.test(text)),
        `${key}: placeholders`,
      ).toEqual([]);
      for (const { field, values } of optionChecks[key] || []) {
        await editor.getByLabel(field, { exact: true }).click();
        for (const value of values)
          await expect(page.getByTitle(value, { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await editor.getByRole("button", { name: "Close", exact: true }).click();
      await expect(editor).not.toBeVisible();
    });
  }
});

test("automatic review settings translate without saving or running a check", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/reports");
  await expect(
    page.getByText("Automatic report review", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Automatic review settings/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Automatic review settings",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Delay (minutes)", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Maximum amount per report (CNY)", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Minimum duration ratio (%)", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Require received and completed quantities to match", {
      exact: true,
    }),
  ).toBeVisible();
  await englishText(
    dialog.locator("label, .ant-form-item-extra, p, h3, .ant-tag"),
    "automatic review rules",
    8,
  );
  const delay = await dialog
    .getByLabel("Delay (minutes)", { exact: true })
    .inputValue();
  await screenshot(page, "auto-review-desktop-en");
  await language(page, "zh");
  const chinese = page.getByRole("dialog", {
    name: "自动审核设置",
    exact: true,
  });
  await expect(
    chinese.getByLabel("等待时间（分钟）", { exact: true }),
  ).toHaveValue(delay);
  await screenshot(page, "auto-review-desktop-zh");
});

test("390px mobile views keep language controls reachable and pages within viewport", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await noPageOverflow(page);
  await screenshot(page, "login-mobile-zh");
  await language(page, "en");
  await noPageOverflow(page);
  await screenshot(page, "login-mobile-en");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("MesDemo2026!");
  const signedIn = await submitLogin(
    page,
    page.getByRole("button", { name: /^Sign in/ }),
  );
  expect(signedIn.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Have a productive day",
  );
  await noPageOverflow(page);
  await screenshot(page, "dashboard-mobile-en");
  await language(page, "zh");
  await noPageOverflow(page);
  await screenshot(page, "dashboard-mobile-zh");
  await language(page, "en");
  for (const [path, title] of [
    ...mainRoutes,
    ["/resources/safety-penalties", "Safety rewards and penalties"],
    ["/resources/documents", "Work documents"],
  ]) {
    await test.step(`mobile ${path}`, async () => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: title, level: 1, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "切换为中文", exact: true }).last(),
      ).toBeInViewport();
      await noPageOverflow(page);
    });
  }
  await screenshot(page, "documents-mobile-en");
  await page.goto("/reports");
  await page.getByRole("button", { name: /Automatic review settings/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Automatic review settings",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Delay (minutes)", { exact: true }),
  ).toBeVisible();
  await noPageOverflow(page);
  await screenshot(page, "auto-review-mobile-en");
  const saveEnglish = dialog.getByRole("button", {
    name: "Save settings",
    exact: true,
  });
  await saveEnglish.scrollIntoViewIfNeeded();
  await expect(saveEnglish).toBeInViewport();
  await screenshot(page, "auto-review-mobile-en-bottom");
  await language(page, "zh");
  await noPageOverflow(page);
  await page
    .getByText("正常报工自动计薪，异常交由人工", { exact: true })
    .scrollIntoViewIfNeeded();
  await screenshot(page, "auto-review-mobile-zh");
  const saveChinese = page
    .getByRole("dialog")
    .getByRole("button", { name: "保存设置", exact: true });
  await saveChinese.scrollIntoViewIfNeeded();
  await expect(saveChinese).toBeInViewport();
  await screenshot(page, "auto-review-mobile-zh-bottom");
});

test("primary creation and shop floor dialogs display English fields without submitting", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signIn(page);
  const editors = [
    {
      path: "/sales-orders",
      button: /New order/,
      dialog: "New sales order",
      field: "Customer",
    },
    {
      path: "/work-orders",
      button: /Release work order/,
      dialog: "Release work order",
      field: "Product to manufacture",
    },
    {
      path: "/scraps",
      button: /Report scrap/,
      dialog: "Report scrap",
      field: "Scrap quantity",
    },
    {
      path: "/inventory",
      button: /Receive finished goods/,
      dialog: "Record finished goods movement",
      field: "Quantity",
    },
    {
      path: "/users",
      button: /Add member/,
      dialog: "Add member",
      field: "Username",
    },
  ];
  for (const editor of editors) {
    await test.step(editor.path, async () => {
      await page.goto(editor.path);
      await page.getByRole("button", { name: editor.button }).click();
      const dialog = page.getByRole("dialog", {
        name: editor.dialog,
        exact: true,
      });
      await expect(
        dialog.getByLabel(editor.field, { exact: true }),
      ).toBeVisible();
      await englishText(
        dialog.locator("label"),
        `${editor.path}: editor labels`,
        3,
      );
      if (editor.path === "/work-orders") {
        await dialog.getByLabel("Priority", { exact: true }).click();
        await expect(
          page.getByTitle("Normal", { exact: true }).last(),
        ).toBeVisible();
        await expect(page.getByTitle("Urgent", { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).not.toBeVisible();
    });
  }

  await page.goto("/devices");
  await page
    .getByRole("button", { name: "Record equipment status", exact: true })
    .first()
    .click();
  const deviceDialog = page.getByRole("dialog");
  await expect(
    deviceDialog.getByLabel("Current equipment status", { exact: true }),
  ).toBeVisible();
  await deviceDialog
    .getByLabel("Current equipment status", { exact: true })
    .click();
  const equipmentStatuses = [
    "Powered off",
    "Idle",
    "Processing",
    "Fault",
    "Repair / maintenance",
    "Disabled",
    "Scrapped",
  ];
  const statusDropdown = page.locator(".ant-select-dropdown:visible");
  await expect(
    statusDropdown.locator(".ant-select-item-option-content"),
  ).toHaveText(equipmentStatuses);
  for (const status of equipmentStatuses) {
    await expect(
      statusDropdown.getByTitle(status, { exact: true }),
    ).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await deviceDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  const workOrders = await (
    await page.request.get("/api/work-orders?pageSize=100")
  ).json();
  let available:
    | {
        id: string;
        taskIndex: number;
        taskName: string;
        requiresWorkstation: boolean;
      }
    | undefined;
  for (const order of workOrders.items) {
    const detail = await (
      await page.request.get(`/api/work-orders/${order.id}`)
    ).json();
    const taskIndex =
      detail.tasks?.findIndex(
        (task: { status: string; availableQuantity: number }) =>
          task.status === "ready" && Number(task.availableQuantity) > 0,
      ) ?? -1;
    if (detail.status !== "closed" && taskIndex >= 0) {
      const task = detail.tasks[taskIndex];
      available = {
        id: order.id,
        taskIndex,
        taskName: task.name,
        requiresWorkstation: Boolean(task.production?.procedureTypeId),
      };
      break;
    }
  }
  expect(
    available,
    "Seeded environment provides work awaiting material receipt",
  ).toBeTruthy();
  await page.goto(`/station?workOrderId=${available!.id}`);
  const receiveButton = page
    .locator(".station-task")
    .nth(available!.taskIndex)
    .getByRole("button", { name: "Receive materials", exact: true });
  await expect(receiveButton).toBeVisible();
  await expect(receiveButton).toBeEnabled();
  await receiveButton.click();
  const receiveDialog = page.getByRole("dialog", {
    name: `Receive materials · ${available!.taskName}`,
    exact: true,
  });
  await expect(
    receiveDialog.getByLabel("Quantity to receive", { exact: true }),
  ).toBeVisible();
  await expect(
    receiveDialog.getByLabel(
      available!.requiresWorkstation
        ? "Workstation (required)"
        : "Workstation (optional)",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    receiveDialog.getByLabel(
      available!.requiresWorkstation
        ? "Workstation (optional)"
        : "Workstation (required)",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    receiveDialog.getByRole("button", { name: "Confirm receipt", exact: true }),
  ).toBeVisible();
  await receiveDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
});
