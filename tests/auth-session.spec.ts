import { test, expect, type Page } from "@playwright/test";
import { authenticate, submitLogin } from "./helpers/auth";

async function sessionCookie(page: Page) {
  return (await page.context().cookies()).find(
    (cookie) => cookie.name === "mes_session",
  )?.value;
}

test("E2E sessions reuse valid cookies, isolate roles and renew revoked sessions", async ({ page }) => {
  await authenticate(page);
  const original = await sessionCookie(page);
  expect(original).toBeTruthy();
  await authenticate(page);
  expect(await sessionCookie(page)).toBe(original);

  await authenticate(page, "viewer");
  const viewer = await page.request.get("/api/auth/me");
  expect(viewer.ok()).toBeTruthy();
  expect((await viewer.json()).user.username).toBe("viewer");
  expect(await sessionCookie(page)).not.toBe(original);

  await authenticate(page);
  expect(await sessionCookie(page)).toBe(original);
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  const loggedOut = await page.request.post("/api/auth/logout", {
    headers: { origin },
  });
  expect(loggedOut.ok()).toBeTruthy();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await authenticate(page);
  expect(await sessionCookie(page)).not.toBe(original);
  const renewed = await page.request.get("/api/auth/me");
  expect(renewed.ok()).toBeTruthy();
  expect((await renewed.json()).user.username).toBe("admin");
});

test("UI login retry honors Retry-After without retrying rejected credentials", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/auth/login", (route) => {
    attempts++;
    return route.fulfill({
      status: attempts === 1 ? 429 : 401,
      contentType: "application/json",
      headers: attempts === 1 ? { "retry-after": "0" } : {},
      body: JSON.stringify({ error: { code: attempts === 1 ? "RATE_LIMIT" : "INVALID_CREDENTIALS" } }),
    });
  });
  await page.goto("/");
  await page.setContent('<button type="button">Submit login</button>');
  await page.getByRole("button", { name: "Submit login" }).evaluate((button) => {
    button.addEventListener("click", () => {
      void fetch("/api/auth/login", { method: "POST" });
    });
  });
  const response = await submitLogin(
    page,
    page.getByRole("button", { name: "Submit login" }),
  );
  expect(response.status()).toBe(401);
  expect(attempts).toBe(2);
});
