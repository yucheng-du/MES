import { ScrapAutomaticSettings } from "./ProductionParity";
import { Drawer } from "./LocalizedOverlays";
import { t, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Divider,
  Form,
  InputNumber,
  Skeleton,
  Space,
  Switch,
  Tag,
} from "antd";
import { CheckCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { api, dateTime, money, number, useAction } from "../api";
import {
  autoReviewFormValues,
  autoReviewPayload,
  type AutoReviewFormValues,
  type AutoReviewResponse,
  type AutoReviewRun,
  type AutoReviewSettings as Settings,
} from "../report-review";
import { Panel, QueryError } from "./common";

const endpoint = "/settings/auto-review";
const runLabels: Record<AutoReviewRun["status"], string> = {
  running: "正在检查",
  completed: "检查完成",
  failed: "检查未完成",
  skipped: "本次未执行",
};

export function AutoReviewSettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [endpoint],
    queryFn: () => api<AutoReviewResponse>(endpoint),
    refetchInterval: 30000,
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [form] = Form.useForm<AutoReviewFormValues>();
  const save = useAction(t("自动审核设置已保存"));
  const run = useAction("");
  const current = query.data;

  // Refresh live counts without overwriting an open, possibly edited form.
  useEffect(() => {
    if (!open) setDraft(null);
    else if (!draft && current) setDraft(current.settings);
  }, [open, draft, current]);
  useEffect(() => {
    if (draft) form.setFieldsValue(autoReviewFormValues(draft));
  }, [draft, form]);

  const runNow = async () => {
    try {
      const result = (await run.mutateAsync({
        path: `${endpoint}/run`,
        data: {},
      })) as { run: AutoReviewRun };
      client.setQueryData<AutoReviewResponse>([endpoint], (previous) =>
        previous ? { ...previous, lastRun: result.run } : previous,
      );
      if (result.run.status === "completed") {
        void message.success(
          t("检查完成：自动批准 {approved} 笔，转人工 {manual} 笔", {
            approved: number(result.run.approvedCount),
            manual: number(result.run.manualCount),
          }),
        );
      } else if (result.run.status === "running") {
        void message.info(t("正在检查，请稍后查看结果"));
      } else {
        void message.warning(
          t(result.run.errorMessage || runLabels[result.run.status]),
        );
      }
    } catch {
      // useAction displays the server error while preserving the page.
    }
  };

  return (
    <>
      <Panel className="auto-review-overview">
        {query.error ? (
          <QueryError error={query.error} retry={query.refetch} />
        ) : !current ? (
          <Skeleton active paragraph={{ rows: 1 }} />
        ) : (
          <div className="auto-review-overview-inner">
            <div className="auto-review-intro">
              <div className="auto-review-icon">
                <CheckCircleOutlined />
              </div>
              <div>
                <div className="auto-review-heading">
                  <strong>{t("报工自动审核")}</strong>
                  <Tag color={current.settings.enabled ? "green" : "default"}>
                    {current.settings.enabled ? t("已开启") : t("已停用")}
                  </Tag>
                </div>
                <p>
                  {current.settings.enabled
                    ? t(
                        "完工 {minutes} 分钟后检查，单笔 {amount} 以内按规则自动计薪。",
                        {
                          minutes: number(current.settings.delayMinutes),
                          amount: money(current.settings.maxAmount),
                        },
                      )
                    : t("当前报工由人工审核，已批准的计薪记录不受影响。")}
                </p>
              </div>
            </div>
            <div className="auto-review-quick-actions">
              <div className="auto-review-counts">
                <div>
                  <span>{t("待自动检查")}</span>
                  <strong>{number(current.summary.pendingAutomatic)}</strong>
                </div>
                <div className="needs-review">
                  <span>{t("需要人工")}</span>
                  <strong>{number(current.summary.manualRequired)}</strong>
                </div>
                <div>
                  <span>{t("累计自动批准")}</span>
                  <strong>
                    {number(current.summary.approvedAutomatically)}
                  </strong>
                </div>
              </div>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void runNow()}
                loading={run.isPending}
                disabled={
                  !current.settings.enabled ||
                  save.isPending ||
                  current.lastRun?.status === "running"
                }
              >
                {t("立即检查")}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Drawer
        title={t("自动审核设置")}
        width={560}
        open={open}
        onClose={onClose}
      >
        {query.error && (
          <QueryError error={query.error} retry={query.refetch} />
        )}
        {!draft ? (
          !query.error && <Skeleton active paragraph={{ rows: 8 }} />
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              title={t("正常报工自动计薪，异常交由人工")}
              description={t(
                "系统定时检查符合规则的完工报工。异常只转人工核对，不会自动退回；人工批准和退回入口始终保留。",
              )}
            />
            {current && current.settings.revision !== draft.revision && (
              <Alert
                className="auto-review-conflict"
                type="warning"
                showIcon
                title={t("设置已被更新")}
                description={t(
                  "当前编辑内容已保留。请读取最新设置后再修改，避免覆盖他人的调整。",
                )}
                action={
                  <Button
                    size="small"
                    onClick={() => setDraft(current.settings)}
                  >
                    {t("读取最新设置")}
                  </Button>
                }
              />
            )}
            <Form<AutoReviewFormValues>
              name="report-auto-review-settings"
              form={form}
              layout="vertical"
              className="auto-review-form"
              disabled={save.isPending}
              onFinish={async (values) => {
                try {
                  const result = (await save.mutateAsync({
                    path: endpoint,
                    method: "PATCH",
                    data: autoReviewPayload(draft.revision, values),
                  })) as AutoReviewResponse;
                  client.setQueryData([endpoint], result);
                  setDraft(result.settings);
                  onClose();
                } catch {
                  // Preserve edits after validation, conflict, or network errors.
                }
              }}
            >
              <Form.Item
                name="enabled"
                label={t("启用自动审核")}
                valuePropName="checked"
                extra={t(
                  "停用后，新完成的报工需人工审核。重新启用只覆盖启用后完工的报工。",
                )}
              >
                <Switch
                  checkedChildren={t("开启")}
                  unCheckedChildren={t("停用")}
                />
              </Form.Item>
              <div className="auto-review-field-grid">
                <Form.Item
                  name="delayMinutes"
                  label={t("等待时间（分钟）")}
                  rules={[{ required: true, message: t("请输入等待时间") }]}
                  extra={t("从实际完工开始等待，0 表示无需等待。")}
                >
                  <InputNumber
                    min={0}
                    max={1440}
                    precision={0}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  name="maxAmount"
                  label={t("单笔金额上限（元）")}
                  rules={[{ required: true, message: t("请输入金额上限") }]}
                  extra={t("超过上限的报工交由人工确认。")}
                >
                  <InputNumber
                    min={0.01}
                    max={1000000000}
                    precision={2}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </div>
              <Form.Item
                name="minDurationPercent"
                label={t("最低用时比例（%）")}
                rules={[{ required: true, message: t("请输入最低用时比例") }]}
                extra={t(
                  "0 表示不检查。工艺标准用时校准后，可设置比例，将用时过短的报工转人工核对。",
                )}
              >
                <InputNumber
                  min={0}
                  max={100}
                  precision={2}
                  addonAfter="%"
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <Form.Item
                name="requireFullQuantity"
                label={t("要求收料与完工数量一致")}
                valuePropName="checked"
                extra={t(
                  "关闭时，正常分批完工也可自动审核；开启时，数量不一致的报工交由人工核对。",
                )}
              >
                <Switch
                  checkedChildren={t("要求一致")}
                  unCheckedChildren={t("允许分批")}
                />
              </Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={save.isPending}
                block
              >
                {t("保存设置")}
              </Button>
            </Form>
            <div className="auto-review-boundary">
              <strong>{t("哪些报工仍需人工处理")}</strong>
              <p>
                {t(
                  "启用前已完工的历史报工、曾退回后重新提交、有报废记录、工单已关闭等情况均需人工审核。已转人工的报工不会因调整规则而重新自动批准。",
                )}
              </p>
              {current?.settings.eligibleFrom && (
                <p>
                  {t("本轮启用时间：")}
                  {dateTime(current.settings.eligibleFrom)}
                </p>
              )}
            </div>
            <Divider />
            <section className="auto-review-run">
              <div className="auto-review-run-heading">
                <div>
                  <h3>{t("检查进度")}</h3>
                  <p>{t("立即检查仍遵守已保存的等待时间和审核规则。")}</p>
                </div>
              </div>
              {current && (
                <Space wrap size={[8, 8]}>
                  <Tag>
                    {t("等待时间未到 {count} 笔", {
                      count: number(current.summary.awaitingDelay),
                    })}
                  </Tag>
                  <Tag color="blue">
                    {t("等待下一次检查 {count} 笔", {
                      count: number(current.summary.readyAutomatic),
                    })}
                  </Tag>
                </Space>
              )}
              {current?.lastRun ? (
                <div className="auto-review-last-run">
                  <div className="auto-review-heading">
                    <strong>{t(runLabels[current.lastRun.status])}</strong>
                    <span>
                      {dateTime(
                        current.lastRun.finishedAt || current.lastRun.startedAt,
                      )}
                    </span>
                  </div>
                  <p>
                    {t(
                      "检查 {scanned} 笔 · 自动批准 {approved} 笔 · 转人工 {manual} 笔 · 暂未处理 {skipped} 笔",
                      {
                        scanned: number(current.lastRun.scannedCount),
                        approved: number(current.lastRun.approvedCount),
                        manual: number(current.lastRun.manualCount),
                        skipped: number(current.lastRun.skippedCount),
                      },
                    )}
                  </p>
                  {!!current.lastRun.errorCount && (
                    <p className="danger-text">
                      {t("有 {count} 笔未完成检查，请核对后重试。", {
                        count: number(current.lastRun.errorCount),
                      })}
                    </p>
                  )}
                  {current.lastRun.errorMessage && (
                    <Alert
                      type="warning"
                      showIcon
                      title={t(current.lastRun.errorMessage)}
                    />
                  )}
                </div>
              ) : (
                <p className="muted">
                  {t(
                    "暂未执行检查。开启后系统会定时检查，无需保持此页面打开。",
                  )}
                </p>
              )}
            </section>
          </>
        )}
        <ScrapAutomaticSettings />
      </Drawer>
    </>
  );
}
