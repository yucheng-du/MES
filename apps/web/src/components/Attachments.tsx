import { t } from "../i18n";
import { lazy, Suspense, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { App, Button, Upload } from "antd";
import { PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { api } from "../api";
const FilePreview = lazy(() =>
  import("./FilePreview").then((module) => ({ default: module.FilePreview })),
);
type Metadata = {
  id: string;
  name: string;
  size: number;
  mime: string;
  url: string;
};
function useFiles(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["file", id],
      queryFn: () => api<Metadata>(`/files/${id}/info`),
      staleTime: 300000,
    })),
  });
}
export function Attachments({
  value = [],
  onChange,
  purpose = "business",
}: {
  value?: string[];
  onChange?: (ids: string[]) => void;
  purpose?: "business" | "personnel";
}) {
  const files = useFiles(value);
  const current = useRef(value);
  current.current = value;
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<string>();
  const { message } = App.useApp();
  return (
    <div>
      <Upload
        multiple
        onPreview={(file) => setPreview(file.uid)}
        maxCount={10}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xlsx,.docx"
        fileList={value.map((id, i) => ({
          uid: id,
          name: files[i]?.data?.name || t("正在读取附件…"),
          status: "done",
          url: files[i]?.data?.url || `/api/files/${id}`,
        }))}
        beforeUpload={(file) => {
          if (file.size > 10 * 1024 * 1024) {
            void message.error(t("单个附件不能超过 10 MiB"));
            return Upload.LIST_IGNORE;
          }
          if (value.length >= 10) {
            void message.error(t("最多添加 10 个附件"));
            return Upload.LIST_IGNORE;
          }
          return true;
        }}
        customRequest={async ({ file, onSuccess, onError }) => {
          setUploading((n) => n + 1);
          try {
            const body = new FormData();
            body.append("file", file as File);
            const response = await fetch(`/api/files?purpose=${purpose}`, {
              method: "POST",
              credentials: "include",
              body,
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error?.message || t("附件上传失败"));
            current.current = [...current.current, result.id];
            onChange?.(current.current);
            onSuccess?.(result);
          } catch (e) {
            onError?.(e as Error);
            void message.error(t((e as Error).message));
          } finally {
            setUploading((n) => n - 1);
          }
        }}
        onRemove={(file) => {
          onChange?.(value.filter((id) => id !== file.uid));
          return true;
        }}
      >
        <Button
          loading={uploading > 0}
          icon={<UploadOutlined />}
          disabled={value.length >= 10}
        >
          {t("上传作业文件")}
        </Button>
      </Upload>
      {preview && (
        <Suspense>
          <FilePreview
            key={preview}
            id={preview}
            onClose={() => setPreview(undefined)}
          />
        </Suspense>
      )}
      <p className="attachment-hint">
        {t(
          "PDF、图片、Word、Excel 或文本，单个不超过 10 MiB。保存记录后保留附件关联。",
        )}
      </p>
    </div>
  );
}
export function AttachmentLinks({ ids = [] }: { ids?: string[] }) {
  const files = useFiles(ids);
  const [preview, setPreview] = useState<string>();
  return (
    <div className="attachment-links">
      {ids.length
        ? ids.map((id, i) => (
            <a
              key={id}
              href={files[i]?.data?.url || `/api/files/${id}`}
              onClick={(event) => {
                event.preventDefault();
                setPreview(id);
              }}
            >
              <PaperClipOutlined /> {files[i]?.data?.name || t("下载附件")}
            </a>
          ))
        : "—"}
      {preview && (
        <Suspense>
          <FilePreview
            key={preview}
            id={preview}
            onClose={() => setPreview(undefined)}
          />
        </Suspense>
      )}
    </div>
  );
}
