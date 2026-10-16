import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
const sessions = new Map<string, Cookies>();

function origin() {
  return new URL(
    String(test.info().project.use.baseURL ?? "http://127.0.0.1:5173"),
  ).origin;
}

async function loginWithRetry<
  T extends { status(): number; headers(): Record<string, string> },
>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await send();
    if (response.status() !== 429) return response;
    expect(
      attempt,
      "Login remained throttled after server-directed retries",
    ).toBeLessThan(3);
    const retryAfter = response.headers()["retry-after"];
    expect(
      retryAfter,
      "A throttled login must supply Retry-After",
    ).toBeTruthy();
    const seconds = Number(retryAfter);
    const milliseconds = Number.isFinite(seconds)
      ? Math.ceil(seconds * 1000)
      : Math.max(0, Date.parse(retryAfter) - Date.now());
    expect(
      Number.isFinite(milliseconds),
      "Retry-After must be seconds or an HTTP date",
    ).toBeTruthy();
    expect(
      milliseconds,
      "Retry-After must not be negative",
    ).toBeGreaterThanOrEqual(0);
    // The production limiter stays enabled. Extend only by its stated wait so
    // authentication throttling does not consume the business assertion budget.
    const info = test.info();
    if (info.timeout) test.setTimeout(info.timeout + milliseconds);
    await test.step(`Honor login Retry-After (${retryAfter})`, async () => {
      await delay(milliseconds);
    });
  }
}

/** Exercise the real login UI, including rejected credentials, without hiding 401s. */
export async function submitLogin(page: Page, button: Locator) {
  return loginWithRetry(async () => {
    const pending = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/login" &&
        response.request().method() === "POST",
    );
    await button.click();
    return pending;
  });
}

/** Reuse only a server-validated session for this origin and requested user. */
export async function authenticate(page: Page, username = "admin") {
  const host = origin();
  const key = `${host}\0${username}`;
  await page.context().clearCookies({ name: "mes_session" });
  const cached = sessions.get(key);
  if (cached) {
    await page.context().addCookies(cached);
    const response = await page.request.get(`${host}/api/auth/me`);
    if (response.ok() && (await response.json()).user?.username === username)
      return;
    sessions.delete(key);
    await page.context().clearCookies({ name: "mes_session" });
  }
  const response = await loginWithRetry(() =>
    page.request.post(`${host}/api/auth/login`, {
      headers: { origin: host },
      data: { username, password: "MesDemo2026!" },
    }),
  );
  expect(
    response.ok(),
    `Login failed: ${await response.text()}`,
  ).toBeTruthy();
  expect((await response.json()).user?.username).toBe(username);
  const cookies = (await page.context().cookies(`${host}/api`)).filter(
    (cookie) => cookie.name === "mes_session",
  );
  expect(cookies, "Successful login must establish a session").toHaveLength(1);
  sessions.set(key, cookies);
}
