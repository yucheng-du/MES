import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
} from "antd";
import type { FieldDefinition } from "@mes/shared";
import { t, useLocale } from "../i18n";
import { api, fetchAllRecords, dateOnly, dateTime, number } from "../api";
import { Attachments, AttachmentLinks } from "./Attachments";
import { OptionsEmpty } from "./common";
const refPath = (resource: string) =>
  resource === "procedure-types"
    ? "/production/procedure-types"
    : resource === "users"
      ? "/lookups/users"
      : ["products", "work-orders", "sales-orders", "reports"].includes(
            resource,
          )
        ? `/${resource}`
        : `/resources/${resource}`;
function useReferenceOptions(field: FieldDefinition, enabled = true) {
  const path = refPath(field.resource!),
    params = field.key === "purchaseOrderIds" ? { unreimbursed: true } : {};
  return useQuery({
    queryKey: [path, "options", params],
    enabled,
    queryFn: async () => {
      if (field.resource === "procedure-types") {
        const items = await api<any[]>(path);
        return { items, total: items.length, page: 1, pageSize: items.length };
      }
      return fetchAllRecords(path, params);
    },
  });
}
function ReferenceSelect({
  field,
  ...props
}: {
  field: FieldDefinition;
  [key: string]: any;
}) {
  useLocale();
  const data = useReferenceOptions(field);
  return (
    <Select
      notFoundContent={<OptionsEmpty query={data} />}
      showSearch
      allowClear
      optionFilterProp="label"
      loading={data.isLoading}
      placeholder={t("选择{field}", { field: t(field.label) })}
      options={data.data?.items.map((r) => ({
        label:
          r.name ||
          (r.workOrderCode
            ? `${r.workOrderCode} · ${r.taskName || ""} · ${r.workerName || ""}`
            : `${r.code} · ${r.productName || ""}`),
        value: r.id,
      }))}
      {...props}
    />
  );
}
function ReferenceValue({
  field,
  value,
}: {
  field: FieldDefinition;
  value: unknown;
}) {
  useLocale();
  const query = useReferenceOptions(field, !!value);
  const record = query.data?.items.find((r) => r.id === value);
  return (
    <>
      {record?.name ||
        record?.code ||
        record?.workOrderCode ||
        (value ? t("关联记录") : "—")}
    </>
  );
}
export function FieldValue({
  field,
  value,
}: {
  field: FieldDefinition;
  value: unknown;
}) {
  useLocale();
  if (value === undefined || value === null || value === "") return <>—</>;
  if (field.type === "rows")
    return (
      <Space direction="vertical">
        {(value as any[]).map((row, i) => (
          <Card size="small" key={i}>
            {field.fields?.map((f) => (
              <div key={f.key}>
                <strong>{t(f.label)}: </strong>
                <FieldValue field={f} value={row[f.key]} />
              </div>
            ))}
          </Card>
        ))}
      </Space>
    );
  if (field.type === "references")
    return (
      <Space wrap>
        {(value as string[]).map((v) => (
          <Tag key={v}>
            <ReferenceValue field={field} value={v} />
          </Tag>
        ))}
      </Space>
    );
  if (field.type === "files")
    return <AttachmentLinks ids={value as string[]} />;
  if (field.type === "reference")
    return <ReferenceValue field={field} value={value} />;
  if (field.type === "boolean")
    return (
      <Tag color={value ? "green" : "default"}>{value ? t("是") : t("否")}</Tag>
    );
  if (field.type === "select")
    return (
      <>
        {t(
          field.options?.find((o) => o.value === value)?.label || String(value),
        )}
      </>
    );
  if (field.type === "number")
    return (
      <>
        {number(value)} {field.unit ? t(field.unit) : ""}
      </>
    );
  if (field.type === "date") return <>{dateOnly(value)}</>;
  if (field.type === "datetime") return <>{dateTime(value)}</>;
  return <>{String(value)}</>;
}
export function FieldInput({
  field,
  ...props
}: {
  field: FieldDefinition;
  [key: string]: any;
}) {
  useLocale();
  if (field.type === "rows") return <RowsInput field={field} {...props} />;
  if (field.type === "references")
    return <ReferenceSelect field={field} mode="multiple" {...props} />;
  if (field.type === "datetime") {
    const date = props.value ? new Date(props.value) : null;
    const local =
      date && !Number.isNaN(date.getTime())
        ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "";
    return (
      <Input
        {...props}
        type="datetime-local"
        value={local}
        onChange={(e) =>
          props.onChange?.(
            e.target.value ? new Date(e.target.value).toISOString() : undefined,
          )
        }
      />
    );
  }
  if (field.type === "files") return <Attachments {...props} />;
  if (field.type === "reference")
    return <ReferenceSelect field={field} {...props} />;
  if (field.type === "select")
    return (
      <Select
        allowClear
        options={field.options?.map((option) => ({
          ...option,
          label: t(option.label),
        }))}
        {...props}
      />
    );
  if (field.type === "boolean") return <Switch {...props} />;
  if (field.type === "number")
    return (
      <InputNumber
        min={field.min}
        max={field.max}
        precision={field.integer ? 0 : undefined}
        style={{ width: "100%" }}
        addonAfter={field.unit ? t(field.unit) : undefined}
        {...props}
      />
    );
  if (field.type === "textarea") return <Input.TextArea rows={4} {...props} />;
  return <Input type={field.type === "date" ? "date" : "text"} {...props} />;
}
function RowsInput({
  field,
  value = [],
  onChange,
}: {
  field: FieldDefinition;
  value?: Record<string, unknown>[];
  onChange?: (v: Record<string, unknown>[]) => void;
}) {
  useLocale();
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {value.map((row, i) => (
        <Card
          size="small"
          key={i}
          title={i + 1}
          extra={
            <Button
              danger
              size="small"
              onClick={() => onChange?.(value.filter((_, j) => j !== i))}
            >
              {t("删除")}
            </Button>
          }
        >
          {field.fields
            ?.filter((f) => !f.readOnly)
            .map((f) => (
              <div key={f.key} style={{ marginBottom: 10 }}>
                <label>
                  {t(f.label)}
                  {f.required ? " *" : ""}
                </label>
                <FieldInput
                  field={f}
                  aria-label={t(f.label)}
                  {...(f.type === "boolean"
                    ? { checked: row[f.key] }
                    : { value: row[f.key] })}
                  onChange={(v: any) =>
                    onChange?.(
                      value.map((r, j) =>
                        j === i
                          ? { ...r, [f.key]: v?.target ? v.target.value : v }
                          : r,
                      ),
                    )
                  }
                />
              </div>
            ))}
        </Card>
      ))}
      <Button
        onClick={() => onChange?.([...value, {}])}
        disabled={value.length >= 100}
      >
        {t("添加明细")}
      </Button>
    </Space>
  );
}
