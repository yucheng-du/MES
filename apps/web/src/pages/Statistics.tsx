import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Form, Input, Select, Space, Table } from "antd";
import { api, number, money, queryString, useOptions } from "../api";
import { t, useLocale } from "../i18n";
import { PageHeading, Panel, QueryError, Status } from "../components/common";
const views = [
  ["production", "生产日报"],
  ["scrap", "报废日报"],
  ["stock-in", "产品入库统计"],
  ["stock-out", "产品出库统计"],
  ["products", "产品生产统计"],
  ["orders", "订单交付统计"],
  ["workers", "人员薪酬汇总"],
  ["tasks", "待加工任务统计"],
  ["procedures", "工序进度统计"],
  ["order-items", "订单产品明细统计"],
];
export default function Statistics() {
  useLocale();
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({
    from: today.slice(0, 7) + "-01",
    to: today,
    view: "production",
    group: "procedure",
    productId: undefined as string | undefined,
    salesOrderId: undefined as string | undefined,
  });
  const products = useOptions("/products");
  const orders = useOptions("/sales-orders");
  const result = useQuery({
    queryKey: ["statistics", filters],
    queryFn: () =>
      api<{ items: any[]; timezone: string }>(
        "/statistics?" + queryString(filters),
      ),
  });
  const detailNames: Record<string, string> = {
    piece: "计件报工",
    hours: "计时工单",
    reward: "安全奖励",
    penalty: "安全处罚",
    "scrap-penalty": "报废扣款",
    "scrap-reward": "报废奖励",
    "piece-adjustment": "计件调整",
    "manual-adjustment": "人工调整",
    "quality-reward": "质量奖励",
    ready: "待收料",
    blocked: "等待前序",
    received: "已收料",
    working: "生产中",
    complete: "已完工",
  };
  const columns = [
    ...(filters.view === "tasks"
      ? [
          {
            key: "expectedMinutes",
            title: t("预计分钟"),
            dataIndex: "expectedMinutes",
            render: number,
          },
        ]
      : []),
    { key: "label", title: t("分组"), dataIndex: "label" },
    {
      key: "detail",
      title: t("分类"),
      dataIndex: "detail",
      render: (v: string) => t(detailNames[v] || v),
    },
    {
      key: "quantity",
      title: t("数量"),
      dataIndex: "quantity",
      render: number,
    },
    {
      key: "records",
      title: t("记录数"),
      dataIndex: "records",
      render: number,
    },
    ...(filters.view === "workers"
      ? [
          {
            key: "amount",
            title: t("金额"),
            dataIndex: "amount",
            render: money,
          },
        ]
      : []),
    ...(["products", "procedures", "order-items"].includes(filters.view)
      ? [
          {
            key: "completedQuantity",
            title: t("完工数量"),
            dataIndex: "completedQuantity",
            render: number,
          },
        ]
      : []),
    ...(["orders", "order-items"].includes(filters.view)
      ? [
          ["plannedQuantity", "已排产数量"],
          ["inventoryQuantity", "库存数量"],
          ["deliveredQuantity", "已交付数量"],
        ].map(([key, title]) => ({
          key,
          title: t(title),
          dataIndex: key,
          render: number,
        }))
      : []),
  ];
  if (["procedures", "order-items"].includes(filters.view))
    columns.push(
      ...[
        ["pendingQuantity", "在制数量"],
        ["scrapQuantity", "报废数量"],
      ].map(([key, title]) => ({
        key,
        title: t(title),
        dataIndex: key,
        render: number,
      })),
    );
  if (["production", "scrap"].includes(filters.view))
    columns.push(
      ...[
        ["productName", "产品"],
        ["workerName", "人员"],
        ["workstationName", "工位"],
        ["procedureName", "工序类型"],
        ["scrapType", "报废类型"],
      ].map(([key, title]) => ({
        key,
        title: t(title),
        dataIndex: key,
        render: (v: any) => v ?? "—",
      })),
    );
  if (["tasks", "procedures"].includes(filters.view))
    columns.splice(1, 0, {
      key: "groupCode",
      title: t("编号"),
      dataIndex: "groupCode",
      render: (value: any) => value || "—",
    });
  function download() {
    const quote = (v: unknown) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+\-@]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const csv = [
      columns.map((c) => quote(c.title)).join(","),
      ...(result.data?.items ?? []).map((row) =>
        columns
          .map((c) =>
            quote(
              c.dataIndex === "detail"
                ? t(detailNames[row[c.dataIndex]] || row[c.dataIndex])
                : row[c.dataIndex],
            ),
          )
          .join(","),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `mes-${filters.view}-${filters.from}-${filters.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <PageHeading
        eyebrow="REPORTING"
        title={t("经营统计")}
        description={t("按日期范围汇总生产、库存、订单和薪酬，支持导出。")}
      />
      <Panel>
        <Form
          layout="inline"
          initialValues={filters}
          onFinish={(values) => setFilters(values)}
        >
          <Form.Item name="view" label={t("统计类型")}>
            <Select
              style={{ minWidth: 220 }}
              options={views.map(([value, label]) => ({
                value,
                label: t(label),
              }))}
            />
          </Form.Item>
          <Form.Item name="group" label={t("任务分组")}>
            <Select
              style={{ minWidth: 140 }}
              options={[
                ["procedure", "工序类型"],
                ["workstation", "工位"],
                ["worker", "人员"],
                ["device", "设备"],
              ].map(([value, label]) => ({ value, label: t(label) }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.view !== b.view}>
            {({ getFieldValue }) =>
              ["procedures", "order-items"].includes(getFieldValue("view")) && (
                <>
                  <Form.Item name="productId" label={t("产品")}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      style={{ minWidth: 180 }}
                      options={products.data?.items.map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="salesOrderId" label={t("销售订单")}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      style={{ minWidth: 180 }}
                      options={orders.data?.items.map((p) => ({
                        value: p.id,
                        label: p.code,
                      }))}
                    />
                  </Form.Item>
                </>
              )
            }
          </Form.Item>
          <Form.Item
            name="from"
            label={t("开始日期")}
            rules={[{ required: true }]}
          >
            <Input type="date" />
          </Form.Item>
          <Form.Item
            name="to"
            label={t("结束日期")}
            rules={[{ required: true }]}
          >
            <Input type="date" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              {t("查询")}
            </Button>
            <Button disabled={!result.data?.items.length} onClick={download}>
              {t("导出 CSV")}
            </Button>
          </Space>
        </Form>
        {result.error ? (
          <QueryError error={result.error} retry={result.refetch} />
        ) : (
          <Table
            style={{ marginTop: 24 }}
            rowKey={(row, index) => `${row.label}-${row.detail}-${index}`}
            loading={result.isPending}
            dataSource={result.data?.items}
            columns={columns}
            scroll={{ x: 800 }}
          />
        )}
      </Panel>
    </>
  );
}
