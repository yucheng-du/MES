import { useState } from "react";
import { Button, Descriptions, Alert } from "antd";
import { Drawer } from "./LocalizedOverlays";
import { dateTime, number, type Row } from "../api";
import { t, useLocale } from "../i18n";
import { Status } from "./common";
export function ReportEquipment({ report }: { report: Row }) {
  useLocale();
  const [open, setOpen] = useState(false),
    metrics = report.deviceMetrics;
  const values = metrics
    ? [
        ["设备", metrics.deviceName],
        ["设备编号", metrics.deviceCode],
        ["统计开始", dateTime(metrics.from)],
        ["统计结束", dateTime(metrics.to)],
        ["区间时长（秒）", number(metrics.totalSeconds)],
        ["通电时长（秒）", number(metrics.powerOnSeconds)],
        ["运行时长（秒）", number(metrics.seconds.running)],
        ["空闲时长（秒）", number(metrics.seconds.idle)],
        ["离线时长（秒）", number(metrics.seconds.offline)],
        ["故障时长（秒）", number(metrics.seconds.fault)],
        ["维护时长（秒）", number(metrics.seconds.maintenance)],
        ["停用时长（秒）", number(metrics.seconds.deactivated)],
        ["报废时长（秒）", number(metrics.seconds.scrapped)],
        ["未知时长（秒）", number(metrics.seconds.unknown)],
        ["通电次数", number(metrics.powerOnCount)],
        ["断电次数", number(metrics.shutdownCount)],
        ["有效动作次数", number(metrics.effectiveOperatingCount)],
        ["采集产量", number(metrics.operatingPieces)],
        ["完工时设备计件倍率", number(metrics.configuredPieceScale)],
      ]
    : [];
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        {t("报工详情")}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={t("报工详情")}
        width={600}
      >
        <Descriptions
          column={1}
          items={[
            { label: t("生产工单"), children: report.workOrderCode },
            { label: t("工序"), children: report.taskName },
            { label: t("操作员"), children: report.workerName },
            { label: t("状态"), children: <Status value={report.status} /> },
            { label: t("收料数量"), children: number(report.receivedQuantity) },
            { label: t("完工数量"), children: number(report.quantity) },
            {
              label: t("报废回溯调整"),
              children: number(report.completeAdjustment ?? 0),
            },
            {
              label: t("计薪良品数量"),
              children: number(
                report.quantity + (report.completeAdjustment ?? 0),
              ),
            },
            { label: t("开始时间"), children: dateTime(report.startedAt) },
            { label: t("完工时间"), children: dateTime(report.completedAt) },
          ]}
        />
        <h3>{t("完工设备快照")}</h3>
        {metrics ? (
          <>
            <p>
              {t(
                "快照在完工时保存，后续设备配置或补录事件不会改写此记录。未知时段单独显示，采集产量按当时事件倍率计算。",
              )}
            </p>
            <Descriptions
              column={1}
              items={values.map(([label, value]) => ({
                key: label,
                label: t(label),
                children: value,
              }))}
            />
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            message={t(
              "此记录没有设备快照：未关联设备、尚未完工或早于快照功能启用。",
            )}
          />
        )}
      </Drawer>
    </>
  );
}
