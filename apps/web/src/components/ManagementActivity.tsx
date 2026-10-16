import { Link } from "react-router-dom";
import { resourceMap } from "@mes/shared";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Space,
  Tag,
  Timeline,
} from "antd";
import type { FieldDefinition } from "@mes/shared";
import { Modal } from "./LocalizedOverlays";
import { FieldInput, FieldValue } from "./ResourceFields";
import { AttachmentLinks } from "./Attachments";
import { api, useAction, dateTime, money, type Row } from "../api";
import { t, useLocale } from "../i18n";
const stages: Record<string, string> = {
  pending: "待批准",
  ready: "待执行",
  running: "执行中",
  completed: "待确认",
  confirmed: "已确认",
  rejected: "已退回",
  accepted: "已受理",
  "payment-requested": "付款待审批",
  "payment-approved": "付款已批准",
  "payment-rejected": "付款已退回",
  "part-paid": "部分已付",
  paid: "已付清",
  responded: "已响应",
  reversed: "已冲销",
};
const eventNames: Record<string, string> = {
  submit: "提交",
  approve: "批准",
  reject: "退回",
  archive: "归档",
  start: "开始执行",
  progress: "登记进展",
  complete: "提交完工",
  confirm: "确认完成",
  return: "退回办理",
  "check-item": "逐项检查",
  "request-payment": "申请付款",
  "approve-payment": "批准付款",
  "reject-payment": "退回付款",
  pay: "登记已付款",
  learn: "确认学习",
  mount: "模具上机",
  unmount: "模具下机",
  deactivate: "停用设备",
  activate: "启用设备",
  scrap: "报废资产",
  reverse: "冲销库存单",
  annotate: "更新业务备注",
  "payment-notes": "更新付款备注",
  respond: "响应呼叫",
  handle: "完成呼叫处理",
  alarm: "安排报警",
  "alarm-fired": "触发报警",
  feedback: "执行反馈",
  "sync-inspection-items": "同步点检模板",
  "sync-maintenance-items": "同步保养模板",
};
type Choice = {
  action: string;
  label: string;
  fields: FieldDefinition[];
  preset?: Record<string, unknown>;
};
export const managementStageLabel = (stage: string) =>
  t(stages[stage] ?? stage);
export function ManagementActivity({
  resource,
  recordId,
  onRecord,
}: {
  resource: string;
  recordId: string;
  onRecord: (r: Row) => void;
}) {
  useLocale();
  const path = `/resources/${resource}/${recordId}`;
  const q = useQuery({
      queryKey: [path, "activity"],
      queryFn: () => api(`${path}/activity`),
    }),
    mutation = useAction();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [form] = Form.useForm();
  const info = q.data;
  if (!info)
    return q.error ? <Alert type="error" message={t(q.error.message)} /> : null;
  const open = (a: Choice) => {
    setChoice(a);
    form.resetFields();
    form.setFieldsValue({ ...info.record.workflowData, ...a.preset });
  };
  const finish = async (values: Record<string, unknown>) => {
    if (!choice) return;
    const record = await mutation.mutateAsync({
      path: `${path}/actions/${choice.action}`,
      data: {
        revision: info.record.revision,
        data: { ...choice.preset, ...values },
      },
    });
    onRecord(record as Row);
    setChoice(null);
  };
  return (
    <div style={{ marginTop: 20 }}>
      {info.record.stage && (
        <p>
          <Tag color="blue">
            {t(stages[info.record.stage] ?? info.record.stage)}
          </Tag>
        </p>
      )}
      <Space wrap>
        {info.actions.map((a: Choice) => (
          <Button key={a.action} onClick={() => open(a)}>
            {t(a.label)}
          </Button>
        ))}
      </Space>
      {info.total !== null && (
        <p>
          {t("采购金额")}: {money(info.total)} · {t("累计已付")}:{" "}
          {money(
            info.payments
              .filter((p: any) => p.status === "paid")
              .reduce((n: number, p: any) => n + Number(p.amount), 0),
          )}
        </p>
      )}
      {info.receipts?.length > 0 && (
        <Card
          size="small"
          title={t(info.receiptsComplete ? "采购已收齐" : "采购到货进度")}
          style={{ marginTop: 12 }}
        >
          {info.receipts.map((line: any) => (
            <p key={line.materialId}>
              <FieldValue
                field={{
                  key: "materialId",
                  label: "原材料",
                  type: "reference",
                  resource: "materials",
                }}
                value={line.materialId}
              />{" "}
              ·{" "}
              {t("已入库 {received} / 订购 {ordered}", {
                received: line.received,
                ordered: line.ordered,
              })}
            </p>
          ))}
        </Card>
      )}
      {info.payments.map((p: any) => (
        <Card
          key={p.id}
          size="small"
          title={`${money(p.amount)} · ${t(({ requested: "待审核", approved: "已批准", rejected: "已退回", paid: "已付款" } as Record<string, string>)[p.status])}`}
          style={{ marginTop: 12 }}
        >
          <Descriptions
            size="small"
            column={1}
            items={[
              { key: "payee", label: t("收款人"), children: p.payee },
              { key: "account", label: t("收款账户"), children: p.account },
              { key: "bank", label: t("开户银行"), children: p.bank },
              { key: "note", label: t("付款说明"), children: p.notes },
              {
                key: "date",
                label: t("付款时间"),
                children: dateTime(p.paidAt),
              },
            ]}
          />
          <AttachmentLinks ids={p.attachmentIds} />
        </Card>
      ))}
      {info.items.map((item: any) => (
        <Card
          key={item.id}
          size="small"
          title={`${item.sequence}. ${item.title}`}
          style={{ marginTop: 12 }}
          extra={
            info.canExecute && (
              <Button
                onClick={() =>
                  open({
                    action: "check-item",
                    label: "登记检查结果",
                    fields: [
                      {
                        key: "result",
                        label: "检查结果",
                        type: "textarea",
                        required: true,
                      },
                      { key: "attachmentIds", label: "附件", type: "files" },
                    ],
                    preset: {
                      itemId: item.id,
                      result: item.result,
                      attachmentIds: item.attachmentIds,
                    },
                  })
                }
              >
                {t(item.completedAt ? "修改检查结果" : "登记检查结果")}
              </Button>
            )
          }
        >
          <p>{item.content}</p>
          <AttachmentLinks ids={item.sourceAttachments} />
          {item.result && (
            <p>
              {t("检查结果")}: {item.result}
            </p>
          )}
          <AttachmentLinks ids={item.attachmentIds} />
          {item.completedAt && (
            <Tag color="green">
              {t("已检查")} · {dateTime(item.completedAt)}
            </Tag>
          )}
        </Card>
      ))}
      {info.record.workflowData.result && (
        <Card size="small" title={t("执行结果")} style={{ marginTop: 12 }}>
          <p>{info.record.workflowData.result}</p>
          <AttachmentLinks ids={info.record.workflowData.attachmentIds ?? []} />
          {info.record.workflowData.hours !== undefined && (
            <p>
              {t("确认工时")}: {info.record.workflowData.hours}
            </p>
          )}
        </Card>
      )}
      {info.learners.length > 0 && (
        <p>
          {t("已学习人员")}: {info.learners.map((p: any) => p.name).join(", ")}
        </p>
      )}
      {info.related?.length > 0 && (
        <Card size="small" title={t("关联业务记录")} style={{ marginTop: 12 }}>
          {info.related.map((r: Row) => (
            <p key={r.id}>
              <Link to={`/resources/${r.resource}?relatedTo=${recordId}`}>
                {t(resourceMap[r.resource]?.title ?? r.resource)}
              </Link>{" "}
              · {r.name}
            </p>
          ))}
        </Card>
      )}
      {info.events.length > 0 && (
        <>
          <h4>{t("办理记录")}</h4>
          <Timeline
            items={info.events.map((e: any) => ({
              children: (
                <>
                  <strong>{t(eventNames[e.kind] ?? e.kind)}</strong> ·{" "}
                  {e.actorName} · {dateTime(e.createdAt)}
                  {Object.entries(e.data)
                    .filter(
                      ([k, v]) =>
                        ["content", "result", "notes", "percent"].includes(k) &&
                        v !== undefined,
                    )
                    .map(([k, v]) => (
                      <p key={k}>{k === "percent" ? `${v}%` : String(v)}</p>
                    ))}
                  {e.data.attachmentIds && (
                    <AttachmentLinks ids={e.data.attachmentIds} />
                  )}
                </>
              ),
            }))}
          />
        </>
      )}
      <Modal
        open={!!choice}
        title={choice ? t(choice.label) : ""}
        onCancel={() => setChoice(null)}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        destroyOnClose
      >
        <Form layout="vertical" form={form} preserve={false} onFinish={finish}>
          {choice?.fields.map((f) => (
            <Form.Item
              key={f.key}
              name={f.key}
              label={t(f.label)}
              rules={
                f.required
                  ? [
                      {
                        required: true,
                        message: t("请填写{field}", { field: t(f.label) }),
                      },
                    ]
                  : []
              }
            >
              <FieldInput field={f} />
            </Form.Item>
          ))}
          {choice && !choice.fields.length && <p>{t("确认执行此操作？")}</p>}
        </Form>
      </Modal>
    </div>
  );
}

export function ManagementAlarmHistory() {
  useLocale();
  const q = useQuery({
    queryKey: ["/andon-alarms"],
    queryFn: () => api("/andon-alarms?pageSize=100"),
  });
  return (
    <Card size="small" title={t("报警记录")} style={{ marginBottom: 16 }}>
      <Space direction="vertical">
        {q.data?.items.map((n: any) => (
          <div key={n.id}>
            <strong>{n.name}</strong> ·{" "}
            {n.payload.contacts
              .map((c: any) => `${c.name} (${c.phone})`)
              .join(", ")}{" "}
            ·{" "}
            {t(
              (
                {
                  scheduled: "等待超时",
                  pending: "待发送",
                  sent: "已发送",
                  failed: "发送失败",
                  cancelled: "已取消",
                } as Record<string, string>
              )[n.status],
            )}{" "}
            · {dateTime(n.dueAt)}
          </div>
        ))}
        {q.data?.total === 0 && t("暂无报警记录")}
      </Space>
    </Card>
  );
}
