import { ReportEquipment } from "../components/ReportEquipment";
import {
  StationDutyPanel,
  ScrapExtraFields,
  ReportBatchReview,
  ScrapApprove,
  TaskAssignment,
} from "../components/ProductionParity";
import { Drawer, Modal } from "../components/LocalizedOverlays";
import { t, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  ArrowRightOutlined,
  CheckOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ScanOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  api,
  can,
  fetchAllRecords,
  dateTime,
  number,
  requestId,
  useAction,
  useList,
  useOptions,
  type Row,
} from "../api";
import { canManage, canQuality, useUser } from "../auth-context";
import { AutoReviewSettings } from "../components/AutoReviewSettings";
import { reportReviewPresentation } from "../report-review";
import {
  ActionGroup,
  DataTable,
  OptionsEmpty,
  PageHeading,
  Panel,
  QueryError,
  ReasonAction,
  SearchBar,
  Status,
  useFilters,
} from "../components/common";
export function Reports() {
  useLocale();
  const user = useUser();
  const filters = useFilters();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMode = searchParams.get("reviewMode");
  const reviewMode = ["manual", "pending_auto", "automatic"].includes(
    requestedMode || "",
  )
    ? requestedMode!
    : undefined;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedReports, setSelectedReports] = useState<string[]>([]);
  const list = useList("/reports", { ...filters.params, reviewMode });
  const action = useAction(t("报工已审核，计件工资已按工艺单价入账"));
  return (
    <>
      <PageHeading
        eyebrow="QUALITY / PRODUCTION REPORTS"
        title={t("报工审批")}
        description={t(
          "查看每笔报工的审核进度与计薪结果，处理需要人工核对的异常。",
        )}
        action={
          can(user, "settings:write", ["manager"]) && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            >
              {t("自动审核设置")}
            </Button>
          )
        }
      />
      {can(user, "settings:write", ["manager"]) && (
        <AutoReviewSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <Panel>
        <SearchBar onSearch={filters.search} refresh={list.refetch}>
          <Select
            allowClear
            aria-label={t("审核方式筛选")}
            placeholder={t("全部审核方式")}
            value={reviewMode}
            onChange={(value) => {
              filters.setPage(1);
              setSearchParams((previous) => {
                const next = new URLSearchParams(previous);
                if (value) next.set("reviewMode", value);
                else next.delete("reviewMode");
                return next;
              });
            }}
            style={{ width: 240 }}
            options={[
              { value: "manual", label: t("待人工") },
              { value: "pending_auto", label: t("待自动") },
              { value: "automatic", label: t("自动已审") },
            ]}
          />
          <Select
            allowClear
            placeholder={t("全部状态")}
            onChange={filters.filter}
            style={{ width: 190 }}
            options={[
              { value: "complete", label: t("待审核") },
              { value: "approved", label: t("已批准") },
              { value: "rejected", label: t("已退回") },
              { value: "working", label: t("生产中") },
              { value: "received", label: t("已收料") },
            ]}
          />
        </SearchBar>
        {can(user, "reports:approve", ["manager", "quality"]) && (
          <ReportBatchReview
            ids={selectedReports}
            onDone={() => setSelectedReports([])}
          />
        )}
        <DataTable
          rowSelection={
            can(user, "reports:approve", ["manager", "quality"])
              ? {
                  selectedRowKeys: selectedReports,
                  onChange: (keys) => setSelectedReports(keys.map(String)),
                  getCheckboxProps: (r) => ({
                    disabled: r.status !== "complete",
                  }),
                }
              : undefined
          }
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          scroll={{ x: 1180 }}
          empty={
            reviewMode
              ? t("当前筛选下没有报工记录。")
              : t("暂无报工记录，操作员完工后会在这里进入审核。")
          }
          columns={[
            {
              title: t("生产工单"),
              render: (_, r) => (
                <div className="cell-stack">
                  <Link to={`/work-orders/${r.workOrderId}`}>
                    {r.workOrderCode || r.workOrderId?.slice(0, 8)}
                  </Link>
                  <span>{r.productName}</span>
                </div>
              ),
            },
            {
              title: t("工序 / 操作员"),
              render: (_, r) => (
                <div className="cell-stack">
                  <strong>{r.taskName}</strong>
                  <span>{r.workerName}</span>
                </div>
              ),
            },
            {
              title: t("收料数量"),
              dataIndex: "receivedQuantity",
              render: number,
            },
            {
              title: t("完工数量"),
              dataIndex: "quantity",
              render: (v) => <strong>{number(v)}</strong>,
            },
            {
              title: t("状态"),
              dataIndex: "status",
              render: (v) => <Status value={v} />,
            },
            {
              title: t("审核方式 / 自动检查"),
              width: 240,
              render: (_, r) => {
                const review = reportReviewPresentation(r);
                return (
                  <div className="report-review-cell">
                    <Tag color={review.color}>{t(review.label)}</Tag>
                    {review.eligibleAt && (
                      <span>
                        {t("最早检查：{time}", {
                          time: dateTime(review.eligibleAt),
                        })}
                      </span>
                    )}
                    {review.reasons.length > 0 && (
                      <ul>
                        {review.reasons.map((reason, index) => (
                          <li key={`${index}-${reason}`}>{t(reason)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              },
            },
            {
              title: t("报工时间"),
              dataIndex: "completedAt",
              render: dateTime,
            },
            {
              title: t("详情"),
              render: (_, r) => <ReportEquipment report={r} />,
            },
            {
              title: t("审核"),
              width: 180,
              render: (_, r) =>
                can(user, "reports:approve", ["manager", "quality"]) &&
                r.status === "complete" ? (
                  <ActionGroup>
                    <Popconfirm
                      title={t("确认这笔报工数量合格？")}
                      description={t(
                        "批准后按这张工单的工艺单价生成计件工资。",
                      )}
                      onConfirm={() =>
                        action.mutateAsync({
                          path: `/reports/${r.id}/approve`,
                          data: { requestId: requestId() },
                        })
                      }
                    >
                      <Button
                        type="primary"
                        size="small"
                        loading={action.isPending}
                      >
                        {t("批准")}
                      </Button>
                    </Popconfirm>
                    <ReasonAction
                      label={t("退回")}
                      danger
                      path={`/reports/${r.id}/reject`}
                    />
                  </ActionGroup>
                ) : r.status === "rejected" &&
                  (r.workerId === user.id ||
                    ["admin", "manager"].includes(user.role)) ? (
                  <ReasonAction
                    label={t("重新提交")}
                    path={`/reports/${r.id}/resubmit`}
                  />
                ) : (
                  <span className="muted">—</span>
                ),
            },
          ]}
        />
      </Panel>
    </>
  );
}
export function Scraps() {
  useLocale();
  const user = useUser();
  const filters = useFilters();
  const list = useList("/scraps", filters.params);
  const orders = useOptions("/work-orders");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const selected = Form.useWatch("workOrderId", form);
  const detail = useQuery({
    queryKey: ["/work-orders", selected],
    queryFn: () => api<Row>(`/work-orders/${selected}`),
    enabled: !!selected,
  });
  const action = useAction(t("报废申请已提交"));
  const approve = useAction(t("报废记录已审核"));
  return (
    <>
      <PageHeading
        eyebrow="QUALITY / SCRAP CONTROL"
        title={t("报废审核")}
        description={t("记录原因、明确归属，用真实数量守住生产与库存边界。")}
        action={
          can(user, "scraps:write", ["manager", "operator", "quality"]) && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setOpen(true);
              }}
            >
              {t("登记报废")}
            </Button>
          )
        }
      />
      <Panel>
        <SearchBar onSearch={filters.search} refresh={list.refetch}>
          <Select
            allowClear
            placeholder={t("全部状态")}
            onChange={filters.filter}
            style={{ width: 190 }}
            options={[
              { value: "pending", label: t("待审核") },
              { value: "approved", label: t("已批准") },
              { value: "rejected", label: t("已退回") },
            ]}
          />
        </SearchBar>
        <DataTable
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          columns={[
            {
              title: t("关联工单"),
              render: (_, r) => (
                <div className="cell-stack">
                  <Link to={`/work-orders/${r.workOrderId}`}>
                    {r.workOrderCode || r.workOrderId?.slice(0, 8)}
                  </Link>
                  <span>{r.productName}</span>
                </div>
              ),
            },
            { title: t("工序"), dataIndex: "taskName" },
            {
              title: t("报废数量"),
              dataIndex: "quantity",
              render: (v) => (
                <strong className="danger-text">{number(v)}</strong>
              ),
            },
            { title: t("报废原因"), dataIndex: "reason", ellipsis: true },
            {
              title: t("状态"),
              dataIndex: "status",
              render: (v) => <Status value={v} />,
            },
            {
              title: t("审核方式"),
              render: (_, r) =>
                r.approvalMode
                  ? t(r.approvalMode === "automatic" ? "自动审核" : "人工审核")
                  : t(r.autoReviewReason || "待审核"),
            },
            { title: t("登记时间"), dataIndex: "createdAt", render: dateTime },
            {
              title: t("操作"),
              width: 180,
              render: (_, r) =>
                can(user, "scraps:approve", ["manager", "quality"]) &&
                r.status === "pending" ? (
                  <ActionGroup>
                    <ScrapApprove scrap={r} />
                    <ReasonAction
                      label={t("退回")}
                      danger
                      path={`/scraps/${r.id}/reject`}
                    />
                  </ActionGroup>
                ) : (
                  <span className="muted">—</span>
                ),
            },
          ]}
        />
      </Panel>
      <Drawer
        title={t("登记报废")}
        open={open}
        width={500}
        onClose={() => setOpen(false)}
        extra={
          <Button
            type="primary"
            loading={action.isPending}
            onClick={() => form.submit()}
          >
            {t("提交审核")}
          </Button>
        }
      >
        <Form
          name="scrap-editor"
          layout="vertical"
          form={form}
          onFinish={async (v) => {
            await action.mutateAsync({
              path: "/scraps",
              data: { ...v, requestId: requestId() },
            });
            setOpen(false);
          }}
        >
          <Form.Item
            label={t("生产工单")}
            name="workOrderId"
            rules={[{ required: true }]}
          >
            <Select
              loading={orders.isLoading}
              notFoundContent={<OptionsEmpty query={orders} />}
              showSearch
              optionFilterProp="label"
              onChange={() => {
                form.setFieldValue("taskId", undefined);
                form.setFieldValue("reportId", undefined);
                form.setFieldValue("responsibleReportId", undefined);
              }}
              options={orders.data?.items.map((r) => ({
                label: `${r.code} · ${r.productName}`,
                value: r.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("所属工序")}
            name="taskId"
            rules={[{ required: true }]}
          >
            <Select
              placeholder={t("先选择生产工单")}
              options={detail.data?.tasks?.map((r: Row) => ({
                label: `${r.sequence}. ${r.name}`,
                value: r.id,
              }))}
            />
          </Form.Item>
          <ScrapExtraFields reports={detail.data?.reports} />
          <Form.Item
            label={t("报废数量")}
            name="quantity"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label={t("原因")}
            name="reason"
            rules={[{ required: true, message: t("请说明报废原因") }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={t("描述缺陷、发生工序或其他必要信息")}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
export function Station() {
  useLocale();
  const user = useUser();
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get("workOrderId") || undefined;
  const [q, setQ] = useState("");
  const orders = useOptions("/work-orders", { q });
  const detail = useQuery({
    queryKey: ["/work-orders", selected],
    queryFn: () => api<Row>(`/work-orders/${selected}`),
    enabled: !!selected,
  });
  const receivedReports = useOptions("/reports", {
    workerId: user.id,
    status: "received",
  });
  const workingReports = useOptions("/reports", {
    workerId: user.id,
    status: "working",
  });
  const reports = {
    data: {
      items: [
        ...(receivedReports.data?.items || []),
        ...(workingReports.data?.items || []),
      ],
    },
    isLoading: receivedReports.isLoading || workingReports.isLoading,
    error: receivedReports.error || workingReports.error,
    refetch: () =>
      Promise.all([receivedReports.refetch(), workingReports.refetch()]),
  };
  const action = useAction();
  const workstations = useOptions("/resources/workstations");
  const [receive, setReceive] = useState<Row | null>(null);
  const [complete, setComplete] = useState<Row | null>(null);
  const [scanId, setScanId] = useState<string>();
  const [form] = Form.useForm();
  const [completeForm] = Form.useForm();
  const findCode = async (code: string) => {
    setQ(code);
    const r = await fetchAllRecords("/work-orders", { q: code });
    const found =
      r.items.find((x) => x.code === code || x.id === code) ||
      (r.items.length === 1 ? r.items[0] : undefined);
    if (found) setSearchParams({ workOrderId: found.id });
    else void message.info(t("未找到唯一匹配的工单，请从列表选择或检查编号。"));
  };
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type !== "scan" || d.requestId !== scanId) return;
      setScanId(undefined);
      if (d.error) void message.error(t(d.error));
      else if (d.value)
        void findCode(d.value).catch((e) => message.error(t(e.message)));
    };
    window.addEventListener("mes-native", handler);
    return () => window.removeEventListener("mes-native", handler);
  }, [scanId]);
  useEffect(() => {
    if (!scanId) return;
    const timer = setTimeout(() => {
      setScanId(undefined);
      void message.info(t("扫描尚未返回，可以重试或输入工单编号。"));
    }, 60000);
    return () => clearTimeout(timer);
  }, [scanId, message]);
  const mine =
    reports.data?.items.filter(
      (r) =>
        r.workerId === user.id && ["received", "working"].includes(r.status),
    ) || [];
  return (
    <>
      <PageHeading
        eyebrow="SHOP FLOOR / MY STATION"
        title={t("车间工作站")}
        description={t("{name}，从收料开始，做好手中的每一道工序。", {
          name: user.name,
        })}
        action={
          <Space wrap>
            {window.MesNative && (
              <Button
                onClick={() => window.MesNative!.configurePrinter(requestId())}
              >
                {t("配置标签打印机")}
              </Button>
            )}
            <Tag bordered={false} color="green">
              {t("{count} 项进行中的任务", { count: mine.length })}
            </Tag>
          </Space>
        }
      />
      <StationDutyPanel />
      <div className="station-layout">
        <div style={{ minWidth: 0 }}>
          <Panel
            className="station-select"
            title={t("找到本次生产工单")}
            description={t("扫描标签，或输入完整工单编号。")}
          >
            <div className="scan-entry">
              <div className="scan-icon">
                <ScanOutlined />
              </div>
              <div className="scan-entry-controls">
                <Input.Search
                  size="large"
                  placeholder={t("输入工单编号，按回车查找")}
                  enterButton={t("查找")}
                  onSearch={(v) =>
                    void findCode(v.trim()).catch((e) =>
                      message.error(t(e.message)),
                    )
                  }
                />
                {window.MesNative && (
                  <Button
                    size="large"
                    icon={<ScanOutlined />}
                    loading={!!scanId}
                    onClick={() => {
                      const id = requestId();
                      setScanId(id);
                      window.MesNative!.scan(id);
                    }}
                  >
                    {t("扫描工单标签")}
                  </Button>
                )}
              </div>
            </div>
            <Select
              loading={orders.isLoading}
              notFoundContent={<OptionsEmpty query={orders} />}
              size="large"
              className="full-width mt-20"
              showSearch
              optionFilterProp="label"
              placeholder={t("或直接选择生产工单")}
              value={selected}
              onChange={(v) => setSearchParams({ workOrderId: v })}
              options={orders.data?.items.map((r) => ({
                label: `${r.code} · ${r.productName}`,
                value: r.id,
              }))}
            />
          </Panel>
          {detail.error && (
            <QueryError error={detail.error} retry={detail.refetch} />
          )}
          {detail.data && (
            <div className="mt-20">
              <Panel
                title={detail.data.productName}
                description={t("{code} · 计划 {quantity} 件", {
                  code: detail.data.code,
                  quantity: number(detail.data.quantity),
                })}
                action={
                  <Link to={`/work-orders/${selected}`}>
                    {t("工单详情")} <ArrowRightOutlined />
                  </Link>
                }
              >
                <div className="station-tasks">
                  {detail.data.tasks?.map((task: Row, i: number) => (
                    <div className="station-task" key={task.id}>
                      <div className="route-node">{i + 1}</div>
                      <div
                        className="station-task-info"
                        style={{ minWidth: 0, overflowWrap: "anywhere" }}
                      >
                        <strong>{task.name}</strong>
                        <span>
                          {t("实际完工 {quantity} 件", {
                            quantity: number(task.completedQuantity),
                          })}
                        </span>
                        <Status value={task.status} />
                        <TaskAssignment task={task} />
                      </div>
                      <div className="station-task-action">
                        <span className="muted">
                          {t("可收料 {quantity} 件", {
                            quantity: number(task.availableQuantity),
                          })}
                        </span>
                        <Button
                          type="primary"
                          disabled={
                            !can(user, "tasks:write", [
                              "manager",
                              "operator",
                            ]) ||
                            task.status !== "ready" ||
                            Number(task.availableQuantity || 0) <= 0 ||
                            detail.data.status === "closed"
                          }
                          onClick={() => {
                            setReceive(task);
                            form.resetFields();
                            form.setFieldsValue({
                              quantity: Number(task.availableQuantity || 1),
                            });
                          }}
                        >
                          {t("收料")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </div>
        <Panel
          className="my-work-panel"
          title={t("我正在做的")}
          description={t("收料、开工、完工，每一步只记录一次。")}
        >
          {reports.isLoading ? (
            <div className="loading-block">{t("正在加载我的任务…")}</div>
          ) : reports.error ? (
            <QueryError error={reports.error} retry={reports.refetch} />
          ) : mine.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("当前没有进行中的任务，选择工单收料开始。")}
            />
          ) : (
            <div className="my-work-list">
              {mine.map((report) => (
                <article className="my-work-card" key={report.id}>
                  <div className="my-work-top">
                    <span className="mono">{report.workOrderCode}</span>
                    <Status value={report.status} />
                  </div>
                  <h3>{report.taskName}</h3>
                  <p>{report.productName}</p>
                  <div className="my-work-quantity">
                    <strong>{number(report.receivedQuantity)}</strong>
                    <span>{t("件已收料")}</span>
                  </div>
                  {report.status === "received" ? (
                    <Button
                      block
                      size="large"
                      icon={<PlayCircleOutlined />}
                      type="primary"
                      loading={action.isPending}
                      onClick={() =>
                        action.mutate({ path: `/reports/${report.id}/start` })
                      }
                    >
                      {t("开始加工")}
                    </Button>
                  ) : (
                    <Button
                      block
                      size="large"
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={() => {
                        setComplete(report);
                        completeForm.resetFields();
                        completeForm.setFieldValue(
                          "quantity",
                          report.receivedQuantity,
                        );
                      }}
                    >
                      {t("登记完工")}
                    </Button>
                  )}
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <Modal
        open={!!receive}
        title={t("收料 · {name}", { name: receive?.name || "" })}
        okText={t("确认收料")}
        cancelText={t("取消")}
        confirmLoading={action.isPending}
        onCancel={() => setReceive(null)}
        onOk={() => form.submit()}
      >
        <div className="info-note">
          {t("每次收料代表一批由你负责的生产。数量不能超过本工序可用量。")}
        </div>
        <Form
          name="station-receive"
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            await action.mutateAsync({
              path: `/tasks/${receive?.id}/receive`,
              data: { ...v, requestId: requestId() },
            });
            setReceive(null);
          }}
        >
          <Form.Item
            name="quantity"
            label={t("本次收料数量")}
            rules={[{ required: true }]}
          >
            <InputNumber
              min={1}
              max={Number(receive?.availableQuantity || 1)}
              precision={0}
              size="large"
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            name="workstationId"
            label={t(
              receive?.production?.procedureTypeId
                ? "操作工位（必填）"
                : "操作工位（选填）",
            )}
            rules={
              receive?.production?.procedureTypeId ? [{ required: true }] : []
            }
          >
            <Select
              loading={workstations.isLoading}
              notFoundContent={<OptionsEmpty query={workstations} />}
              showSearch
              optionFilterProp="label"
              allowClear
              placeholder={t("选择所在工位")}
              options={workstations.data?.items.map((r) => ({
                label: r.name,
                value: r.id,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={!!complete}
        title={t("登记本次完工")}
        okText={t("提交报工审核")}
        cancelText={t("取消")}
        confirmLoading={action.isPending}
        onCancel={() => setComplete(null)}
        onOk={() => completeForm.submit()}
      >
        <Form
          name="station-complete"
          layout="vertical"
          form={completeForm}
          onFinish={async (v) => {
            await action.mutateAsync({
              path: `/reports/${complete?.id}/complete`,
              data: { ...v, requestId: requestId() },
            });
            setComplete(null);
          }}
        >
          <Form.Item
            label={t("实际完工数量")}
            name="quantity"
            rules={[{ required: true }]}
          >
            <InputNumber
              size="large"
              min={0}
              max={complete?.receivedQuantity}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {t(
              "提交后按已配置的规则自动检查，需要人工确认的由主管或质量管理员审核。当前工序全部完工后可流向下一工序；审核通过后计入个人计件工资。全部已报废时允许完工数量为 0。",
            )}
          </Typography.Paragraph>
        </Form>
      </Modal>
    </>
  );
}
