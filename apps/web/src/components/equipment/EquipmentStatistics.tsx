import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Select, Space, Statistic, Table } from "antd";
import { api, queryString, type Row } from "../../api";
import { t } from "../../i18n";
import { Panel, QueryError } from "../common";
export const equipmentStates: Record<string, [string, string]> = {
  offline: ["关机", "default"],
  idle: ["待机", "blue"],
  running: ["加工", "green"],
  fault: ["故障", "red"],
  maintenance: ["维修 / 维护", "gold"],
  deactivated: ["停用", "default"],
  scrapped: ["报废", "red"],
  unknown: ["未采集", "default"],
};
const hours = (n: unknown) => (Number(n ?? 0) / 3600).toFixed(2);
export function EquipmentStatistics({
  devices,
  onHistory,
}: {
  devices: Row[];
  onHistory: (device: Row) => void;
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [deviceId, setDeviceId] = useState<string>(),
    [page, setPage] = useState(1);
  const query = { from, to, deviceId, page, pageSize: 25 };
  const stats = useQuery({
    queryKey: ["/telemetry/statistics", query],
    queryFn: () => api(`/telemetry/statistics?${queryString(query)}`),
    enabled: !!from && !!to,
  });
  const totals = stats.data?.totals;
  return (
    <Panel
      title={t("设备区间统计")}
      description={t("按工厂时区统计，结束日期包含当天；今日累计至当前时刻。")}
      action={
        <Space wrap>
          <Input
            aria-label={t("开始日期")}
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            style={{ width: 150 }}
          />
          <Input
            aria-label={t("结束日期")}
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            style={{ width: 150 }}
          />
          <Select
            allowClear
            placeholder={t("全部设备")}
            aria-label={t("筛选设备")}
            style={{ width: 200 }}
            value={deviceId}
            options={devices.map((d) => ({
              value: d.id,
              label: `${d.code} · ${d.name}`,
            }))}
            onChange={(v) => {
              setDeviceId(v);
              setPage(1);
            }}
          />
        </Space>
      }
    >
      {stats.error ? (
        <QueryError error={stats.error} retry={stats.refetch} />
      ) : (
        <>
          <Space wrap size="large" style={{ marginBottom: 20 }}>
            <Statistic
              title={t("开机时长（小时）")}
              value={hours(totals?.powerOnSeconds)}
            />
            <Statistic
              title={t("加工时间占比")}
              value={Number(totals?.percent?.running ?? 0).toFixed(1)}
              suffix="%"
            />
            <Statistic
              title={t("开机 / 关机次数")}
              value={`${totals?.powerOnCount ?? 0} / ${totals?.shutdownCount ?? 0}`}
            />
            <Statistic
              title={t("有效加工次数 / 件数")}
              value={`${totals?.effectiveOperatingCount ?? 0} / ${totals?.operatingPieces ?? 0}`}
            />
          </Space>
          <Alert
            type="info"
            showIcon
            title={t(
              "有效加工按“加工 → 待机”完成一次计数，件数使用当时设备计件比例；首次状态和重复心跳不计开关次数。",
            )}
          />
          <p className="muted">
            {t("时区：{timezone}；每格显示小时 / 占比 / 次数。", {
              timezone: stats.data?.timezone ?? "—",
            })}
          </p>
          <Table<Row>
            rowKey="id"
            loading={stats.isLoading}
            dataSource={stats.data?.items ?? []}
            scroll={{ x: 1550 }}
            pagination={{
              current: page,
              pageSize: 25,
              total: stats.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            columns={[
              { title: t("日期"), dataIndex: "day", width: 110 },
              {
                title: t("设备"),
                dataIndex: "name",
                width: 160,
                render: (_, r) => (
                  <Button
                    type="link"
                    onClick={() => onHistory({ ...r, id: r.deviceId })}
                  >
                    {r.name}
                  </Button>
                ),
              },
              ...Object.entries(equipmentStates).map(([key, [label]]) => ({
                title: t(label),
                key,
                width: 140,
                render: (_: unknown, r: Row) =>
                  `${hours(r.seconds?.[key])} / ${Number(r.percent?.[key] ?? 0).toFixed(1)}%${key === "unknown" ? "" : ` / ${r.counts?.[key] ?? 0}`}`,
              })),
              {
                title: t("有效加工次数 / 件数"),
                width: 150,
                render: (_, r) =>
                  `${r.effectiveOperatingCount} / ${r.operatingPieces}`,
              },
            ]}
          />
        </>
      )}
    </Panel>
  );
}
