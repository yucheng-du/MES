import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select, Space, Table, Alert } from "antd";
import { api, dateTime, number } from "../api";
import { t, useLocale } from "../i18n";
import { PageHeading, Panel, QueryError, Status } from "../components/common";
const views = [
  ["production", "生产看板"],
  ["devices", "设备看板"],
  ["workstations", "工位看板"],
  ["inventory", "成品库存"],
  ["materials", "物料库存"],
  ["inspections", "质量检验"],
  ["quality-summary", "质量汇总"],
  ["incoming-inspections", "来料检验"],
  ["device-inspections", "设备点检"],
  ["production-summary", "待加工任务统计"],
  ["stock-in", "成品入库"],
  ["stock-out", "成品出库"],
  ["material-in", "辅料入库"],
  ["material-out", "辅料出库"],
];
export default function Boards() {
  useLocale();
  const [view, setView] = useState("production");
  const [fullscreenError, setFullscreenError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const result = useQuery({
    queryKey: ["boards", view],
    queryFn: () => api<{ items: any[] }>("/boards?view=" + view),
    refetchInterval: 15000,
  });
  const labels: Record<string, string> = {
    code: "编号",
    name: "名称",
    status: "状态",
    quantity: "数量",
    goodQuantity: "合格数量",
    dueDate: "交付日期",
    deviceNo: "设备编号",
    lifecycle: "设备状态",
    workerName: "人员",
    activity: "当前活动",
    safetyStock: "安全库存",
    conclusion: "结论",
    createdAt: "登记时间",
    lastSeenAt: "最近通信",
    productName: "产品",
    inspectorName: "检验员",
    inspectionType: "检验类型",
    scrapQuantity: "报废数量",
    batchNo: "批次号",
    supplierName: "供应商名称",
    records: "记录数",
    passed: "合格数",
    failed: "不合格数",
    passRate: "合格率（%）",
    expectedMinutes: "预计分钟",
  };
  const values: Record<string, string> = {
    incoming: "来料检验",
    process: "过程检验",
    finished: "成品检验",
    pass: "合格",
    fail: "不合格",
    concession: "让步接收",
    normal: "正常",
    abnormal: "异常",
    unspecified: "未指定",
  };
  const keys = Object.keys(
    result.data?.items[0] ?? { code: "", name: "", status: "" },
  ).filter((key) => key !== "id");
  return (
    <div
      ref={ref}
      style={{ background: "var(--bg,#f7f8f2)", padding: 16, overflow: "auto" }}
    >
      <PageHeading
        eyebrow="LIVE BOARDS"
        title={t("车间看板")}
        description={t("每十五秒刷新，支持全屏展示。")}
        action={
          <Space wrap>
            <Select
              aria-label={t("看板类型")}
              value={view}
              onChange={setView}
              style={{ width: 190 }}
              options={views.map(([value, label]) => ({
                value,
                label: t(label),
              }))}
            />
            <Button
              disabled={!document.fullscreenEnabled}
              onClick={async () => {
                try {
                  setFullscreenError(false);
                  if (document.fullscreenElement)
                    await document.exitFullscreen();
                  else await ref.current?.requestFullscreen();
                } catch {
                  setFullscreenError(true);
                }
              }}
            >
              {t("切换全屏")}
            </Button>
          </Space>
        }
      />
      <Panel>
        {fullscreenError && (
          <Alert type="warning" title={t("无法进入全屏，请检查浏览器设置")} />
        )}
        {result.error ? (
          <QueryError error={result.error} retry={result.refetch} />
        ) : (
          <Table
            loading={result.isPending}
            rowKey="id"
            dataSource={result.data?.items}
            pagination={false}
            scroll={{ x: 800 }}
            columns={keys.map((key) => ({
              title: t(labels[key] ?? key),
              dataIndex: key,
              render: (value: any) =>
                ["status", "lifecycle", "activity"].includes(key) ? (
                  <Status value={value} />
                ) : ["createdAt", "lastSeenAt"].includes(key) ? (
                  dateTime(value)
                ) : typeof value === "number" ? (
                  number(value)
                ) : ["conclusion", "inspectionType"].includes(key) ? (
                  t(values[value] ?? value ?? "—")
                ) : (
                  (value ?? "—")
                ),
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
