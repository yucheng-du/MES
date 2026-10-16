import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { execFileSync } from "node:child_process";

let server: Server;
let base = "";
const repository = "https://github.com/yucheng-du/MES";

test.beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/build-docs.mjs"]);
  const root = resolve(".local/site");
  server = createServer(async (req, res) => {
    const path = resolve(
      root,
      "." + new URL(req.url ?? "/", "http://local").pathname.replace(/\/$/, "/index.html"),
    );
    if (!path.startsWith(root + "/")) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(path);
      const types: Record<string, string> = {
        ".html": "text/html;charset=utf-8",
        ".css": "text/css",
        ".js": "text/javascript",
        ".png": "image/png",
        ".mp4": "video/mp4",
      };
      res.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
      res.setHeader("Accept-Ranges", "bytes");
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
        if (start > end || start >= data.length) {
          res.writeHead(416, { "Content-Range": `bytes */${data.length}` }).end();
          return;
        }
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          "Content-Length": end - start + 1,
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.setHeader("Content-Length", data.length);
        res.end(data);
      }
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

test("language changes preserve the page, video position and preference", async ({ page }) => {
  let documents = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents++;
  });
  await page.goto(base + "/#demo");
  const original = page.url();
  const video = page.locator("#demo-video");
  await expect(page.locator("video")).toHaveCount(1);
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("preload", "metadata");
  await expect(video).not.toHaveAttribute("autoplay");
  await expect(video).toHaveAttribute("poster", "assets/demo-poster.png");
  await expect(video.locator("source")).toHaveAttribute("src", "assets/Demo.mp4");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(1);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(39);
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await video.evaluate(async (element: HTMLVideoElement) => {
    await new Promise<void>((done) => {
      element.addEventListener("seeked", () => done(), { once: true });
      element.currentTime = 7;
    });
  });

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("button", { name: "Switch to English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Keep productionin view.");
  expect(page.url()).toBe(original);
  expect(documents).toBe(1);
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(7, 1);
  expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await expect(page.locator("#guide")).toHaveAttribute("href", repository + "#quick-start");
  await expect(page.locator("#deployment-guide")).toHaveAttribute("href", repository + "/blob/main/docs/DEPLOYMENT.md");
  await expect(page.locator("#features-guide")).toHaveAttribute("href", repository + "/blob/main/docs/FEATURES.md");
  await expect(page.locator("#android-guide")).toHaveAttribute("href", repository + "/blob/main/apps/android/README.md");
  await page.goto(base);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: ".local/parity/site-desktop-en.png", fullPage: true });

  await page.getByRole("button", { name: "切换为中文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("#guide")).toHaveAttribute("href", repository + "#快速启动");
  await expect(page.locator("#deployment-guide")).toHaveAttribute("href", repository + "/blob/main/docs/DEPLOYMENT.zh-CN.md");
  expect(documents).toBe(2);
});

test("mobile navigation, video and keyboard controls remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base);
  await expect(page.locator("#language")).toBeInViewport();
  await expect(page.locator(".feature-grid article")).toHaveCount(6);
  const nav = page.locator(".site-header nav");
  await nav.getByRole("link", { name: "演示", exact: true }).click();
  await expect(page).toHaveURL(base + "/#demo");
  await expect(page.locator("#demo-video")).toBeInViewport();
  await nav.getByRole("link", { name: "功能", exact: true }).click();
  await expect(page).toHaveURL(base + "/#capabilities");
  await expect(page.locator("#features-heading")).toBeInViewport();
  await nav.getByRole("link", { name: "文档", exact: true }).click();
  await expect(page).toHaveURL(base + "/#start");
  await expect(page.locator("#start-heading")).toBeInViewport();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await expect(page.locator(".skip-link")).toBeInViewport();
  await page.locator("#language").focus();
  expect(await page.locator("#language").evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Enter");
  await page.locator("#language").blur();
  await expect.poll(() => page.locator("#demo-video").evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: ".local/parity/site-mobile-zh.png", fullPage: true });
});

test("the static page remains useful without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(base);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("看清生产每一步。");
  await expect(page.locator("#language")).toBeHidden();
  await expect(page.locator(".site-header nav").getByRole("link", { name: "English", exact: true })).toHaveAttribute("href", repository + "#english");
  await expect(page.locator("video")).toHaveCount(1);
  await expect(page.locator("#demo-video")).toHaveAttribute("controls", "");
  await expect(page.locator("#guide")).toHaveAttribute("href", repository + "#快速启动");
  await expect(page.locator("#deployment-guide")).toHaveAttribute("href", repository + "/blob/main/docs/DEPLOYMENT.zh-CN.md");
  await page.locator(".site-header nav").getByRole("link", { name: "文档", exact: true }).click();
  await expect(page).toHaveURL(base + "/#start");
  await expect(page.locator("#start-heading")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
