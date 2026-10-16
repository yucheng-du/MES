import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Input, Space, Spin } from "antd";
import { Modal } from "./LocalizedOverlays";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, requestId } from "../api";
import { t, useLocale } from "../i18n";

export type FileMetadata = {
  id: string;
  name: string;
  size: number;
  mime: string;
  url: string;
};
const limit = 10 * 1024 * 1024;
const assetUrls = import.meta.glob<string>(
  [
    "../../../../node_modules/pdfjs-dist/cmaps/*.bcmap",
    "../../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  ],
  { query: "?url", import: "default", eager: true },
);
// PDF auxiliary data is bundled locally; document-provided URLs never reach this factory.
class LocalPdfData {
  async fetch({ filename, kind }: { filename: string; kind: string }) {
    const dir = {
      cMapUrl: "cmaps",
      standardFontDataUrl: "standard_fonts",
      wasmUrl: "wasm",
    }[kind];
    const url =
      dir &&
      assetUrls[`../../../../node_modules/pdfjs-dist/${dir}/${filename}`];
    if (!url) throw new Error("Unknown PDF resource");
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("PDF resource unavailable");
    return new Uint8Array(await response.arrayBuffer());
  }
}

async function authorizedFile(id: string, signal: AbortSignal) {
  const file = await api<FileMetadata>(`/files/${encodeURIComponent(id)}/info`);
  const url = new URL(file.url, location.origin);
  if (
    url.origin !== location.origin ||
    url.pathname !== `/api/files/${id}` ||
    url.search ||
    url.hash ||
    file.size > limit
  )
    throw new Error("附件地址或大小无效");
  const response = await fetch(url, {
    credentials: "same-origin",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new Error("附件读取失败或无权访问");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("附件读取失败或无权访问");
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("单个附件不能超过 10 MiB");
    }
    parts.push(value);
  }
  return { file, blob: new Blob(parts, { type: file.mime }) };
}

async function saveDocument(file: FileMetadata, blob: Blob) {
  const native = window.MesNative as
    | (NonNullable<Window["MesNative"]> & {
        saveFile?: (id: string, json: string) => void;
      })
    | undefined;
  if (native?.saveFile) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const id = requestId();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener("mes-native", listener);
      };
      const listener = (event: Event) => {
        const result = (event as CustomEvent).detail;
        if (result?.requestId !== id || result.type !== "file") return;
        cleanup();
        if (result.error) reject(new Error(result.error));
        else resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(t("文件保存超时，请重试")));
      }, 300000);
      window.addEventListener("mes-native", listener);
      try {
        native.saveFile!(
          id,
          JSON.stringify({
            name: file.name,
            mime: file.mime,
            base64: btoa(binary),
          }),
        );
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function PdfPages({ blob }: { blob: Blob }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1),
    [scale, setScale] = useState(1);
  const [password, setPassword] = useState("");
  const [unlock, setUnlock] = useState<(value: string) => void>();
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    void (async () => {
      const [pdf, worker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
      ]);
      if (!active) return;
      pdf.GlobalWorkerOptions.workerSrc = worker.default;
      task = pdf.getDocument({
        data: await blob.arrayBuffer(),
        BinaryDataFactory: LocalPdfData,
        useWorkerFetch: false,
        useWasm: false,
        wasmUrl: new URL("/pdf-assets/", location.origin).href,
        stopAtErrors: true,
        maxImageSize: 32 * 1024 * 1024,
        canvasMaxAreaInBytes: 128 * 1024 * 1024,
      });
      task.onPassword = (update: (password: string) => void) => {
        if (active) {
          setLoading(false);
          setUnlock(() => update);
        }
      };
      const loaded = await task.promise;
      if (active) {
        setDocument(loaded);
        setUnlock(undefined);
      }
    })().catch(() => {
      if (active) {
        setError("无法预览此 PDF，可保存后使用阅读器打开");
        setLoading(false);
      }
    });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [blob]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let render:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setLoading(true);
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (!active || !canvas.current) return;
        const viewport = pdfPage.getViewport({
          scale: Math.min(2, window.devicePixelRatio || 1) * scale,
        });
        const factor = Math.min(
          1,
          Math.sqrt((16 * 1024 * 1024) / (viewport.width * viewport.height)),
        );
        const bounded = pdfPage.getViewport({ scale: viewport.scale * factor });
        canvas.current.width = Math.ceil(bounded.width);
        canvas.current.height = Math.ceil(bounded.height);
        render = pdfPage.render({ canvas: canvas.current, viewport: bounded });
        await render.promise;
        if (active) setLoading(false);
      })
      .catch((failure) => {
        if (active && failure.name !== "RenderingCancelledException") {
          setError("无法预览此 PDF，可保存后使用阅读器打开");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [document, page, scale]);
  return (
    <>
      {unlock && (
        <Space>
          <Input.Password
            aria-label={t("PDF 密码")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            onClick={() => {
              unlock(password);
              setLoading(true);
            }}
          >
            {t("打开 PDF")}
          </Button>
        </Space>
      )}
      {error && <Alert type="warning" title={t(error)} />}
      {document && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("上一页")}
          </Button>
          <span>
            {t("第 {page} / {total} 页", { page, total: document.numPages })}
          </span>
          <Button
            disabled={page >= document.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("下一页")}
          </Button>
          <Button
            disabled={scale <= 0.5}
            onClick={() => setScale((s) => s - 0.25)}
          >
            {t("缩小")}
          </Button>
          <Button
            disabled={scale >= 2}
            onClick={() => setScale((s) => s + 0.25)}
          >
            {t("放大")}
          </Button>
        </Space>
      )}
      <Spin spinning={loading}>
        <div style={{ overflow: "auto", maxHeight: "65vh", minHeight: 80 }}>
          <canvas
            aria-label={t("PDF 页面")}
            ref={canvas}
            style={{
              maxWidth: scale === 1 ? "100%" : undefined,
              height: "auto",
            }}
          />
        </div>
      </Spin>
    </>
  );
}

export function FilePreview({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const [data, setData] = useState<{
    file: FileMetadata;
    blob: Blob;
    url: string;
    text?: string;
  }>();
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void authorizedFile(id, controller.signal)
      .then(async ({ file, blob }) => {
        const text = file.mime.startsWith("text/")
          ? await blob.text()
          : undefined;
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setData({ file, blob, text, url: objectUrl });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return (
    <Modal
      open
      width={1000}
      title={data?.file.name || t("附件预览")}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{t("关闭")}</Button>
          <Button
            type="primary"
            disabled={!data}
            loading={saving}
            onClick={async () => {
              if (!data) return;
              setSaving(true);
              try {
                await saveDocument(data.file, data.blob);
              } catch (e) {
                void message.error((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {t("保存附件")}
          </Button>
        </Space>
      }
    >
      {error ? (
        <Alert type="error" title={t(error)} />
      ) : !data ? (
        <Spin />
      ) : data.file.mime === "application/pdf" ? (
        <PdfPages blob={data.blob} />
      ) : data.file.mime.startsWith("image/") ? (
        <img
          alt={data.file.name}
          src={data.url}
          style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
        />
      ) : data.text !== undefined ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            maxHeight: "65vh",
            overflow: "auto",
          }}
        >
          {data.text}
        </pre>
      ) : (
        <Alert
          type="info"
          title={t("请保存附件后使用 Word、Excel 或兼容应用打开")}
        />
      )}
    </Modal>
  );
}
