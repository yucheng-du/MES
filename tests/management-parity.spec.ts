import { test, expect, type Page, type Locator } from "@playwright/test";
import { authenticate } from "./helpers/auth";
const origin = process.env.MES_BASE_URL ?? "http://127.0.0.1:5173";
async function api(page: Page, path: string, data?: unknown) {
  const r = await page.request.fetch(`${origin}/api${path}`, {
    method: data ? "POST" : "GET",
    data,
    headers: { origin },
  });
  expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  return r.json();
}
async function login(page: Page) {
  await page.addInitScript(() => localStorage.setItem("mes.locale", "zh-CN"));
  await authenticate(page);
}
async function choose(
  page: Page,
  scope: Locator,
  label: string,
  value: string,
) {
  await scope.getByLabel(label, { exact: true }).click();
  await scope.getByLabel(label, { exact: true }).fill(value);
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: value })
    .first()
    .click();
}
async function confirm(page: Page) {
  const dialog = page.locator(".ant-modal:visible");
  await dialog.locator(".ant-modal-footer .ant-btn-primary").click();
  await expect(dialog).toBeHidden();
}
const unique = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
test("nested purchase lines keep values through language switch and payment approval", async ({
  page,
}) => {
  await login(page);
  const name = unique("采购测试");
  const supplier = await api(page, "/resources/suppliers", {
    name: unique("Supplier"),
    data: {},
  });
  const material = await api(page, "/resources/materials", {
    name: unique("Material"),
    data: { unit: "kg" },
  });
  await page.goto("/resources/purchase-orders");
  await page.getByRole("button", { name: /新建采购申请/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("名称 / 标题", { exact: true }).fill(name);
  await choose(page, drawer, "供应商", supplier.name);
  await drawer.getByRole("button", { name: "添加明细" }).click();
  const card = drawer.locator(".ant-card").last();
  await choose(page, card, "原材料", material.name);
  await card.getByLabel("数量", { exact: true }).fill("2");
  await card.getByLabel("单价", { exact: true }).fill("12.5");
  await drawer.getByRole("button", { name: "Switch to English" }).click();
  await expect(card.getByLabel("Quantity", { exact: true })).toHaveValue("2");
  await expect(drawer.getByLabel("Name / Title", { exact: true })).toHaveValue(
    name,
  );
  await drawer.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(drawer).toBeHidden();
  let r = (
    await api(page, `/resources/purchase-orders?q=${encodeURIComponent(name)}`)
  ).items[0];
  expect(r.data.items[0].quantity).toBe(2);
  expect(r.data.totalAmount).toBe(25);
  r = await api(page, `/resources/purchase-orders/${r.id}/transition`, {
    revision: r.revision,
    action: "submit",
  });
  r = await api(page, `/resources/purchase-orders/${r.id}/transition`, {
    revision: r.revision,
    action: "approve",
  });
  await page.reload();
  await page.getByRole("button", { name: "Switch to English" }).first().click();
  await page.getByRole("button", { name, exact: true }).click();
  const detail = page.getByRole("dialog", { name, exact: true });
  await detail
    .getByRole("button", { name: "Request payment", exact: true })
    .click();
  let modal = page.locator(".ant-modal:visible");
  await modal.getByLabel("Payment amount", { exact: true }).fill("25");
  await modal.getByLabel("Payment method", { exact: true }).click();
  await page.getByText("Bank transfer", { exact: true }).click();
  await modal.getByLabel("Payee", { exact: true }).fill("Demo payee");
  await modal.getByLabel("Payee account", { exact: true }).fill("DEMO-ACCOUNT");
  await confirm(page);
  await detail
    .getByRole("button", { name: "Approve payment", exact: true })
    .click();
  await confirm(page);
  await detail
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  modal = page.locator(".ant-modal:visible");
  await modal
    .getByLabel("Payment evidence notes", { exact: true })
    .fill("Demonstration receipt");
  await confirm(page);
  await expect(detail.getByText("Paid in full", { exact: true })).toBeVisible();
  expect(
    (await api(page, `/resources/purchase-orders/${r.id}/activity`)).payments[0]
      .status,
  ).toBe("paid");
});
test("checklist item completion operates in English and Chinese", async ({
  page,
}) => {
  await login(page);
  const me = await api(page, "/auth/me");
  const name = unique("巡检测试");
  const template = await api(page, "/resources/safety-checklist-templates", {
    name: unique("Checklist"),
    data: {
      frequency: "daily",
      requireCheck: false,
      items: [{ title: "用户自定义项目", content: "确认通道畅通" }],
    },
  });
  let r = await api(page, "/resources/safety-checklist-executions", {
    name,
    data: { templateId: template.id, assigneeId: me.user?.id ?? me.id },
  });
  r = await api(
    page,
    `/resources/safety-checklist-executions/${r.id}/transition`,
    { revision: r.revision, action: "submit" },
  );
  await page.goto("/resources/safety-checklist-executions");
  await page.getByRole("button", { name, exact: true }).click();
  const detail = page.getByRole("dialog", { name, exact: true });
  await detail.getByRole("button", { name: "开始检查", exact: true }).click();
  await confirm(page);
  await detail.getByRole("button", { name: "Switch to English" }).click();
  await expect(detail.getByText("确认通道畅通", { exact: true })).toBeVisible();
  await detail
    .getByRole("button", { name: "Record inspection result", exact: true })
    .click();
  await page
    .locator(".ant-modal:visible")
    .getByLabel("Inspection result", { exact: true })
    .fill("Clear");
  await confirm(page);
  await detail
    .getByRole("button", { name: "Submit inspection completion", exact: true })
    .click();
  await page
    .locator(".ant-modal:visible")
    .getByLabel("Execution result", { exact: true })
    .fill("Checked all items");
  await confirm(page);
  await expect(detail.getByText("Confirmed", { exact: true })).toBeVisible();
  const final = await api(
    page,
    `/resources/safety-checklist-executions/${r.id}/activity`,
  );
  expect(final.record.status).toBe("approved");
  expect(final.items[0].result).toBe("Clear");
});
