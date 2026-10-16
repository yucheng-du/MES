import { Modal } from "./LocalizedOverlays";
import { t, useLocale } from "../i18n";
import {
  App,
  Alert,
  Button,
  Empty,
  Input,
  QRCode,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useAction, type Row } from "../api";
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{action}</div>
    </div>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export const statusLabels: Record<string, [string, string]> = {
  pending: ["待处理", "gold"],
  ready: ["待收料", "blue"],
  blocked: ["等待前序", "default"],
  received: ["已收料", "cyan"],
  working: ["生产中", "processing"],
  complete: ["已完工", "green"],
  approved: ["已批准", "green"],
  rejected: ["已退回", "red"],
  closed: ["已关闭", "default"],
  draft: ["草稿", "default"],
  submitted: ["待审批", "gold"],
  active: ["启用", "green"],
  inactive: ["停用", "default"],
  archived: ["已归档", "default"],
  open: ["待处理", "gold"],
  resolved: ["已解决", "green"],
  paid: ["已结算", "green"],
  in: ["入库", "green"],
  out: ["出库", "blue"],
  fulfilled: ["已交付", "green"],
  cancelled: ["已取消", "default"],
  on_duty: ["在岗", "green"],
  off_duty: ["离岗", "default"],
  disabled: ["停用", "default"],
  no_material: ["无料等待", "gold"],
  unknown: ["未知", "default"],
  offline: ["停机", "default"],
  idle: ["待机", "blue"],
  running: ["运行", "green"],
  fault: ["故障", "red"],
  maintenance: ["维修保养", "orange"],
  deactivated: ["停用", "default"],
  scrapped: ["报废", "default"],
};
export function Status({ value }: { value?: string }) {
  useLocale();
  const [label, color] = statusLabels[value || ""] || [value || "—", "default"];
  return (
    <Tag color={color} className="status-tag">
      {t(label)}
    </Tag>
  );
}
export function QueryError({
  error,
  retry,
  retryLabel = t("重试"),
}: {
  error: unknown;
  retry: () => unknown;
  retryLabel?: string;
}) {
  return (
    <Alert
      type="error"
      showIcon
      title={t("暂时无法加载")}
      description={
        error instanceof Error ? t(error.message) : t("请检查连接并重试。")
      }
      action={
        <Button size="small" onClick={() => retry()}>
          {retryLabel}
        </Button>
      }
    />
  );
}
export function OptionsEmpty({
  query,
}: {
  query: { isLoading: boolean; error: unknown; refetch: () => unknown };
}) {
  if (query.error)
    return (
      <div className="options-state">
        <span>
          {query.error instanceof Error
            ? t(query.error.message)
            : t("关联记录加载失败")}
        </span>
        <Button size="small" type="link" onClick={() => query.refetch()}>
          {t("重新加载")}
        </Button>
      </div>
    );
  return (
    <div className="options-state">
      {query.isLoading ? t("正在加载关联记录…") : t("没有匹配记录")}
    </div>
  );
}
export function DataTable({
  query,
  columns,
  onPage,
  page = 1,
  pageSize = 15,
  empty = t("这里还没有记录"),
  ...props
}: {
  query: {
    data?: { items: Row[]; total: number };
    isLoading: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  columns: TableProps<Row>["columns"];
  onPage?: (p: number) => void;
  page?: number;
  pageSize?: number;
  empty?: string;
} & Omit<TableProps<Row>, "columns">) {
  if (query.error)
    return <QueryError error={query.error} retry={query.refetch} />;
  return (
    <Table<Row>
      rowKey="id"
      size="middle"
      columns={columns}
      dataSource={query.data?.items || []}
      loading={query.isLoading}
      scroll={{ x: 780 }}
      locale={{
        emptyText: (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
        ),
      }}
      pagination={
        onPage
          ? {
              current: page,
              pageSize,
              total: query.data?.total || 0,
              showSizeChanger: false,
              showTotal: (n) => t("共 {count} 条", { count: n }),
              onChange: onPage,
            }
          : false
      }
      {...props}
    />
  );
}
export function SearchBar({
  onSearch,
  children,
  refresh,
  placeholder = t("搜索编号或名称"),
}: {
  onSearch: (q: string) => void;
  children?: ReactNode;
  refresh?: () => unknown;
  placeholder?: string;
}) {
  return (
    <div className="table-toolbar">
      <Input.Search
        allowClear
        prefix={<SearchOutlined />}
        placeholder={placeholder}
        onSearch={onSearch}
        className="table-search"
      />
      {children}
      <div className="toolbar-spacer" />
      {refresh && (
        <Button
          aria-label={t("刷新数据")}
          icon={<ReloadOutlined />}
          onClick={() => refresh()}
        />
      )}
    </div>
  );
}
export function useFilters() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>();
  return {
    q,
    page,
    status,
    params: { q, page, pageSize: 15, status },
    setPage,
    search: (v: string) => {
      setQ(v);
      setPage(1);
    },
    filter: (v: string | undefined) => {
      setStatus(v);
      setPage(1);
    },
  };
}
export function ReasonAction({
  label,
  path,
  body = {},
  danger = false,
  title,
  required = true,
  onSuccess,
}: {
  label: string;
  path: string;
  body?: object;
  danger?: boolean;
  title?: string;
  required?: boolean;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useAction();
  const { message } = App.useApp();
  const isFeedback = path.endsWith("/feedback");
  return (
    <>
      <Button size="small" danger={danger} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        title={title || label}
        okText={t("确认提交")}
        cancelText={t("取消")}
        confirmLoading={action.isPending}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          if (required && !reason.trim()) {
            void message.warning(
              isFeedback ? t("请填写办理反馈") : t("请填写原因"),
            );
            return;
          }
          await action.mutateAsync({
            path,
            data: {
              ...body,
              ...(isFeedback
                ? { feedback: reason.trim() }
                : path.startsWith("/resources/")
                  ? { notes: reason.trim() }
                  : { reason: reason.trim() }),
              ...(path.startsWith("/scraps/")
                ? { requestId: crypto.randomUUID() }
                : {}),
            },
          });
          setOpen(false);
          setReason("");
          onSuccess?.();
        }}
      >
        <Typography.Paragraph type="secondary">
          {isFeedback
            ? t("记录实际执行情况或处理措施，提交后由主管据此审核。")
            : t("操作会记录到审计日志，便于后续追溯。")}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            isFeedback
              ? t("填写执行结果或处理措施（必填）")
              : required
                ? t("填写原因（必填）")
                : t("补充说明（选填）")
          }
        />
      </Modal>
    </>
  );
}
export function DetailValue({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="detail-value">
      <span>{label}</span>
      <strong>{children || "—"}</strong>
    </div>
  );
}
export function NativePrint({
  label,
}: {
  label: {
    code: string;
    productName: string;
    quantity: number;
    processName?: string;
  };
}) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState(false);
  const labelRef = useRef<HTMLDivElement>(null);
  function printBrowserLabel() {
    const p = window.open("", "_blank", "width=480,height=480");
    if (!p) {
      void message.warning(t("请允许浏览器弹出打印窗口"));
      return;
    }
    p.document.title = t("MES 标签");
    if (labelRef.current)
      p.document.body.appendChild(labelRef.current.cloneNode(true));
    p.document.body.style.cssText =
      "margin:12px;font-family:system-ui;color:#111";
    p.focus();
    p.print();
  }
  return (
    <>
      <Button
        onClick={() => {
          if (window.MesNative) {
            window.MesNative.printLabel(
              crypto.randomUUID(),
              JSON.stringify(label),
            );
            void message.info(t("已交给原生打印，请查看设备结果"));
          } else setPreview(true);
        }}
      >
        {t("打印标签")}
      </Button>
      <Modal
        open={preview}
        title={t("打印工单标签")}
        onCancel={() => setPreview(false)}
        okText={t("浏览器打印")}
        cancelText={t("关闭")}
        onOk={printBrowserLabel}
      >
        <div
          ref={labelRef}
          style={{
            border: "1px solid #222",
            padding: 20,
            display: "flex",
            alignItems: "center",
            gap: 18,
            width: 370,
            maxWidth: "100%",
            background: "#fff",
            color: "#111",
          }}
        >
          <QRCode type="svg" value={label.code} size={116} bordered={false} />
          <div>
            <strong style={{ fontSize: 16 }}>{label.productName}</strong>
            <p style={{ fontSize: 12, marginTop: 10, wordBreak: "break-all" }}>
              {label.code}
            </p>
            <p style={{ fontSize: 13, marginTop: 10 }}>
              {t("数量：")}
              {label.quantity}
            </p>
            {label.processName && <p>{label.processName}</p>}
          </div>
        </div>
        <p className="attachment-hint">
          {t("二维码内容为工单编号。可在工作站扫描，也可手动输入相同编号。")}
        </p>
      </Modal>
    </>
  );
}

declare global {
  interface Window {
    MesNative?: {
      scan: (id: string) => void;
      printLabel: (id: string, json: string) => void;
      configurePrinter: (id: string) => void;
      setLanguage?: (locale: "zh-CN" | "en-US") => void;
    };
  }
}
export function ActionGroup({ children }: { children: ReactNode }) {
  return (
    <Space wrap size="small">
      {children}
    </Space>
  );
}
