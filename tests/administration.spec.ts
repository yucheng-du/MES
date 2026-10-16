import { test, expect, type Page } from "@playwright/test";
import { authenticate } from "./helpers/auth";
const origin = process.env.MES_BASE_URL ?? "http://127.0.0.1:5173";
async function login(page: Page) {
  await authenticate(page);
  await page.goto("/");
  await expect(page.locator(".dashboard-welcome")).toBeVisible();
}
async function language(page: Page, locale: "en" | "zh") {
  const scope = (await page.getByRole("dialog").count())
    ? page.getByRole("dialog").last()
    : page;
  await scope
    .getByRole("button", {
      name: locale === "en" ? "Switch to English" : "切换为中文",
      exact: true,
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    locale === "en" ? "en-US" : "zh-CN",
  );
}
async function save(
  page: Page,
  path: string,
  button: ReturnType<Page["getByRole"]>,
) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api" + path &&
      ["POST", "PATCH", "DELETE"].includes(r.request().method()),
  );
  await button.click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.json();
}
test("personnel, payroll, statistics and boards retain context during language changes", async ({
  page,
}) => {
  test.setTimeout(120000);
  const tag = "qa-" + Date.now();
  const display = "Person " + tag;
  await login(page);
  await page.goto("/users");
  await page.getByRole("button", { name: /添加成员/ }).click();
  let dialog = page.getByRole("dialog", { name: "添加成员", exact: true });
  await dialog.getByLabel("姓名", { exact: true }).fill(display);
  await dialog.getByLabel("登录账号", { exact: true }).fill(tag);
  await dialog.getByLabel("初始密码", { exact: true }).fill("MesFixture2026!");
  await dialog
    .getByLabel("岗位名称", { exact: true })
    .fill("Synthetic operator");
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  const url = page.url();
  await language(page, "en");
  dialog = page.getByRole("dialog", { name: "Add member", exact: true });
  expect(page.url()).toBe(url);
  expect(navigations).toBe(0);
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(display);
  await expect(dialog.getByLabel("Job title", { exact: true })).toHaveValue(
    "Synthetic operator",
  );
  const created = await save(
    page,
    "/users",
    dialog.getByRole("button", { name: "Save", exact: true }),
  );
  await expect(dialog).toHaveCount(0);
  const details = await page.request.get(origin + "/api/users/" + created.id);
  expect(details.ok()).toBeTruthy();
  expect((await details.json()).jobTitle).toBe("Synthetic operator");
  await page.goto("/payroll");
  await page
    .getByRole("button", { name: "Manual adjustment", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Record a payroll adjustment",
    exact: true,
  });
  await dialog.getByLabel("Worker", { exact: true }).fill(display);
  await page
    .locator(".ant-select-item-option")
    .filter({ hasText: display })
    .click();
  await dialog.getByLabel("Adjustment rate", { exact: true }).fill("-2.5");
  await dialog
    .getByLabel("Reason for adjustment", { exact: true })
    .fill("Bilingual fixture " + tag);
  const payrollUrl = page.url();
  await language(page, "zh");
  dialog = page.getByRole("dialog", { name: "登记工资调整", exact: true });
  expect(page.url()).toBe(payrollUrl);
  await expect(dialog.getByLabel("调整原因", { exact: true })).toHaveValue(
    "Bilingual fixture " + tag,
  );
  await save(
    page,
    "/payroll/adjustments",
    dialog.getByRole("button", { name: /保\s*存/ }),
  );
  const row = page.getByRole("row").filter({ hasText: display });
  await expect(row).toContainText(/-.*2\.50/);
  await row.getByRole("button", { name: "详情", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "工资分录详情", exact: true });
  await expect(dialog).toContainText("Bilingual fixture " + tag);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.goto("/statistics");
  await language(page, "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Business statistics",
  );
  await page.getByLabel("Report type", { exact: true }).click();
  await page.locator('.ant-select-item-option[title="Pay by person"]').click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: display }),
  ).toContainText(/-.*2\.50/);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toContain("workers");
  await page.goto("/boards");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Shop floor boards",
  );
  await page.getByLabel("Board type", { exact: true }).click();
  await page
    .locator('.ant-select-item-option[title="Equipment board"]')
    .click();
  await expect(
    page.getByRole("columnheader", { name: "Last contact", exact: true }),
  ).toBeVisible();
  await page.goto("/users");
  await language(page, "zh");
  const member = page.getByRole("row").filter({ hasText: display });
  await member.getByRole("button", { name: "归档", exact: true }).click();
  await save(
    page,
    "/users/" + created.id,
    page.getByRole("button", { name: /确\s*定/ }),
  );
  await expect(member).toHaveCount(0);
});
