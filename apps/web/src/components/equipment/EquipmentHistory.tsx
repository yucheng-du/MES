import { Drawer } from "../LocalizedOverlays";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input, InputNumber, Select, Space, Table, Tag } from "antd";
import { api, dateTime, queryString, type Row } from "../../api";
import { t, useLocale } from "../../i18n";
import { QueryError } from "../common";
import { equipmentStates } from "./EquipmentStatistics";
export function EquipmentHistory({
  device,
  onClose,
}: {
  device: Row;
  onClose: () => void;
}) {
  useLocale();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState<string>(),
    [previousStatus, setPrevious] = useState<string>();
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [durationMin, setMin] = useState<number | null>(null),
    [durationMax, setMax] = useState<number | null>(null);
  const query = {
    deviceId: device.id,
    page,
    pageSize: 25,
    status,
    previousStatus,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    durationMin: durationMin ?? undefined,
    durationMax: durationMax ?? undefined,
  };
  const events = useQuery({
    queryKey: ["/telemetry/events", query],
    queryFn: () => api(`/telemetry/events?${queryString(query)}`),
  });
  const options = Object.entries(equipmentStates)
    .filter(([k]) => k !== "unknown")
    .map(([value, [label]]) => ({ value, label: t(label) }));
  const state = (v: string) => {
    const [label, color] = equipmentStates[v] ?? equipmentStates.unknown;
    return <Tag color={color}>{t(label)}</Tag>;
  };
  return (
    <Drawer
      open
      onClose={onClose}
      size="large"
      title={t("设备状态历史 · {name}", { name: device.name })}
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          value={previousStatus}
          aria-label={t("上一状态")}
          placeholder={t("上一状态")}
          style={{ width: 150 }}
          options={options}
          onChange={(v) => {
            setPrevious(v);
            setPage(1);
          }}
        />
        <Select
          allowClear
          value={status}
          aria-label={t("变更后状态")}
          placeholder={t("变更后状态")}
          style={{ width: 150 }}
          options={options}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />
        <Input
          aria-label={t("事件开始时间")}
          type="datetime-local"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <Input
          aria-label={t("事件结束时间（不含）")}
          type="datetime-local"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
        <InputNumber
          aria-label={t("最小时长（秒）")}
          placeholder={t("最小时长（秒）")}
          min={0}
          value={durationMin}
          onChange={(v) => {
            setMin(v);
            setPage(1);
          }}
        />
        <InputNumber
          aria-label={t("最大时长（秒）")}
          placeholder={t("最大时长（秒）")}
          min={0}
          value={durationMax}
          onChange={(v) => {
            setMax(v);
            setPage(1);
          }}
        />
      </Space>
      <p className="muted">
        {t("时间筛选使用浏览器本地时区；时长是上一状态持续到本次变更的秒数。")}
      </p>
      {events.error ? (
        <QueryError error={events.error} retry={events.refetch} />
      ) : (
        <Table<Row>
          size="small"
          rowKey="id"
          loading={events.isLoading}
          dataSource={events.data?.items ?? []}
          scroll={{ x: 950 }}
          pagination={{
            current: page,
            pageSize: 25,
            total: events.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: t("事件时间"), dataIndex: "occurredAt", render: dateTime },
            {
              title: t("上一状态"),
              dataIndex: "previousStatus",
              render: state,
            },
            { title: t("变更后状态"), dataIndex: "status", render: state },
            {
              title: t("时长（秒）"),
              dataIndex: "duration",
              render: (v) => (v === null ? "—" : Number(v).toFixed(1)),
            },
            { title: t("计件比例"), dataIndex: "pieceScale" },
            {
              title: t("来源"),
              dataIndex: "source",
              render: (v) => (v === "mqtt" ? "MQTT" : t("人工")),
            },
            {
              title: t("操作人"),
              dataIndex: "actorName",
              render: (v) => v ?? "—",
            },
            { title: t("原因"), dataIndex: "reason" },
          ]}
        />
      )}
    </Drawer>
  );
}
