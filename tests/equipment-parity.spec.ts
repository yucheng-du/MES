import { test, expect, type Page } from "@playwright/test";
import { authenticate } from "./helpers/auth";
const origin = process.env.MES_BASE_URL ?? "http://127.0.0.1:5173";
const unique = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
async function api(page: Page, path: string, data?: object, method = "POST") {
  const response = await page.request.fetch(`${origin}/api${path}`, {
    method: data ? method : "GET",
    data,
    headers: { origin },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function login(page: Page) {
  if (process.env.EQUIPMENT_STRICT_CSP === "1")
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'",
        },
      });
    });
  await page.addInitScript(() => localStorage.setItem("mes.locale", "en-US"));
  await authenticate(page);
}
function twoPagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...[1, 2].map((n) => {
      const stream = `BT /F1 18 Tf 20 100 Td (MES drawing page ${n}) Tj ET`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("");
  return Buffer.from(
    text +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}
function jpxPdf() {
  // Self-generated 32×16 red/blue JPEG2000 codestream, with no source document metadata.
  const jpx = Buffer.from(
    "/0//UQAvAAAAAAAgAAAAEAAAAAAAAAAAAAAAIAAAABAAAAAAAAAAAAADBwEBBwEBBwEB/1IADAAAAAEBBQQEAAD/XAAjIncedup26na8bwBvAG7iZ0xnTGdkUANQA1BFV9JX0ldh/2QAEQABS2FrYWR1LXY1LjIuMf+QAAoAAAAAANIAAf+Tz7wIBz/APjAgCchAAsPjAgfH0ggAdsfwBghNKsH3gYABRhbH2AYACfMtx9IMC7LmwfSHAAz4m2UpKqPH5BQADgXTcqZPCtTmDsfkFAANA27PhM9NDHtAw+kWACIas4AvAgwlz/aYz7w8IW4ZSJej1ENFhKmGMTlbz7wwIhoHfhXrOmJoDNIfwfMNADaePN0I/1hwAUm4J0jH2CQANfI7AkrvqfoNMAGAUhGtLAmrx9gkADaeP8T6ybwPyqtzXYbmPm7nG//Z",
    "base64",
  );
  const draw = "q 200 0 0 100 10 10 cm /Image1 Do Q";
  const bodies = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 120] /Resources << /XObject << /Image1 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 32 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode /Length ${jpx.length} >>\nstream\n`,
      ),
      jpx,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`),
  ];
  const pieces = [Buffer.from("%PDF-1.5\n")],
    offsets = [0];
  let size = pieces[0].length;
  bodies.forEach((body, i) => {
    offsets.push(size);
    const piece = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      body,
      Buffer.from("\nendobj\n"),
    ]);
    pieces.push(piece);
    size += piece.length;
  });
  pieces.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(pieces);
}
async function upload(
  page: Page,
  name: string,
  mimeType: string,
  buffer: Buffer,
) {
  const response = await page.request.post(`${origin}/api/files`, {
    headers: { origin },
    multipart: { file: { name, mimeType, buffer } },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("equipment range statistics, history filters and binding work in both languages", async ({
  page,
}) => {
  await login(page);
  const name = unique("Parity machine");
  const device = await api(page, "/resources/devices", {
    code: unique("EQ"),
    name,
    data: { pieceScale: 2, networked: true },
  });
  for (const [status, occurredAt] of [
    ["offline", "2026-01-01T23:00:00+08:00"],
    ["running", "2026-01-02T01:00:00+08:00"],
    ["idle", "2026-01-02T03:00:00+08:00"],
    ["offline", "2026-01-02T04:00:00+08:00"],
  ])
    await api(page, "/telemetry/events", {
      deviceId: device.id,
      status,
      occurredAt,
      eventId: unique("event"),
    });
  await page.goto("/devices");
  await page.getByLabel("Start date", { exact: true }).fill("2026-01-02");
  await page.getByLabel("End date", { exact: true }).fill("2026-01-02");
  await page.getByLabel("Filter equipment", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: name })
    .click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(
    row.getByRole("cell", { name: "1 / 2", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("cell", { name: "2.00 / 8.3% / 1", exact: true }),
  ).toBeVisible();
  const card = page.locator(".device-card").filter({ hasText: name });
  await card
    .getByRole("button", { name: "Status history", exact: true })
    .click();
  const history = page.getByRole("dialog", {
    name: `Equipment status history · ${name}`,
    exact: true,
  });
  await history.getByLabel("Previous status", { exact: true }).click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: /^Processing$/ })
    .click();
  await history
    .getByLabel("Minimum duration (seconds)", { exact: true })
    .fill("7200");
  await expect(
    history.getByRole("cell", { name: "7200.0", exact: true }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "切换为中文", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: `设备状态历史 · ${name}`, exact: true })
      .getByRole("columnheader", { name: "上一状态", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await card
    .getByRole("button", { name: "Telemetry binding", exact: true })
    .click();
  const binding = page.getByRole("dialog", {
    name: new RegExp(`^Telemetry binding · ${name}`),
  });
  const collectionId = unique("SENSOR");
  await binding
    .getByLabel("Collection ID", { exact: false })
    .fill(collectionId);
  await binding
    .getByLabel("Pieces per completed cycle", { exact: false })
    .fill("3.5");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/telemetry/devices/${device.id}/binding`) &&
      r.request().method() === "PATCH",
  );
  await binding.getByRole("button", { name: "OK", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(binding).not.toBeVisible();
  const historical = await api(
    page,
    `/telemetry/statistics?from=2026-01-02&to=2026-01-02&deviceId=${device.id}`,
  );
  expect(historical.totals.operatingPieces).toBe(2);
});

test("protected PDF renders local worker pages and attachments save through the optional native bridge", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workerRequests: string[] = [];
  const decoderRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("openjpeg_nowasm_fallback.js"))
      decoderRequests.push(request.url());
    if (request.url().includes("pdf.worker"))
      workerRequests.push(request.url());
  });
  await login(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "MesNative", {
      value: {
        saveFile(id: string, json: string) {
          (window as any).__savedDocument = JSON.parse(json);
          setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("mes-native", {
                  detail: { type: "file", requestId: id, value: "saved" },
                }),
              ),
            10,
          );
        },
      },
    });
  });
  const pdfName = unique("drawing") + ".pdf",
    textName = unique("instructions") + ".txt",
    wordName = unique("manual") + ".docx",
    jpxName = unique("compressed-drawing") + ".pdf";
  const pdf = await upload(page, pdfName, "application/pdf", twoPagePdf());
  const textBytes = Buffer.from(
    "操作说明 / Work instructions <script>window.attack=true</script>",
  );
  const text = await upload(page, textName, "text/plain", textBytes);
  const word = await upload(
    page,
    wordName,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    Buffer.from("PK\x03\x04fixture"),
  );
  const compressed = await upload(page, jpxName, "application/pdf", jpxPdf());
  const name = unique("PDF operating instructions");
  await api(page, "/resources/documents", {
    code: unique("DOC"),
    name,
    data: {
      version: "1",
      content: "Test operating instructions.",
      attachmentIds: [pdf.id, text.id, word.id, compressed.id],
    },
  });
  await page.goto("/resources/documents");
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("link", { name: pdfName, exact: false }).click();
  const preview = page.getByRole("dialog", { name: new RegExp(`^${pdfName}`) });
  await expect(preview.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  const canvas = preview.getByLabel("PDF page", { exact: true });
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => {
        const pixels = element
          .getContext("2d")!
          .getImageData(0, 0, element.width, element.height).data;
        let marks = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i + 3] > 0 && pixels[i] < 200) marks++;
        return marks;
      }),
    )
    .toBeGreaterThan(100);
  expect(workerRequests.length).toBeGreaterThan(0);
  expect(
    workerRequests.every((url) => new URL(url).origin === origin),
  ).toBeTruthy();
  await preview.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(preview.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await preview
    .getByRole("button", { name: "切换为中文", exact: true })
    .click();
  await expect(preview.getByText("第 2 / 2 页", { exact: true })).toBeVisible();
  await preview
    .getByRole("button", { name: "Switch to English", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page.getByRole("link", { name: textName, exact: false }).click();
  const textPreview = page.getByRole("dialog", {
    name: new RegExp(`^${textName}`),
  });
  await expect(
    textPreview.getByText(textBytes.toString(), { exact: true }),
  ).toBeVisible();
  await textPreview
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__savedDocument?.name))
    .toBe(textName);
  const saved = await page.evaluate(() => (window as any).__savedDocument);
  expect(Object.keys(saved).sort()).toEqual(["base64", "mime", "name"]);
  expect(Buffer.from(saved.base64, "base64")).toEqual(textBytes);
  expect(await page.evaluate(() => (window as any).attack)).toBeUndefined();
  await textPreview
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page.getByRole("link", { name: wordName, exact: false }).click();
  const wordPreview = page.getByRole("dialog", {
    name: new RegExp(`^${wordName}`),
  });
  await expect(
    wordPreview.getByText(
      "Save the attachment and open it in Word, Excel or a compatible app.",
      { exact: true },
    ),
  ).toBeVisible();
  await wordPreview
    .getByRole("button", { name: "Save attachment", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__savedDocument?.name))
    .toBe(wordName);
  await wordPreview
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page.getByRole("link", { name: jpxName, exact: false }).click();
  const compressedPreview = page.getByRole("dialog", {
    name: new RegExp(`^${jpxName}`),
  });
  const compressedCanvas = compressedPreview.getByLabel("PDF page", {
    exact: true,
  });
  await expect
    .poll(() =>
      compressedCanvas.evaluate((element: HTMLCanvasElement) => {
        const pixels = element
          .getContext("2d")!
          .getImageData(0, 0, element.width, element.height).data;
        let red = 0,
          blue = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 180 && pixels[i + 2] < 80) red++;
          if (pixels[i] < 80 && pixels[i + 2] > 180) blue++;
        }
        return Math.min(red, blue);
      }),
    )
    .toBeGreaterThan(500);
  expect(decoderRequests.length).toBeGreaterThan(0);
  expect(
    decoderRequests.every((url) => new URL(url).origin === origin),
  ).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
