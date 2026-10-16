import { Modal } from "../components/LocalizedOverlays";
import { t, useLocale } from "../i18n";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { ArrowRightOutlined, ToolOutlined } from "@ant-design/icons";
import { api, can, dateTime, requestId, useAction, type Row } from "../api";
import { useUser } from "../auth-context";
import { PageHeading, Panel, QueryError } from "../components/common";
import {
  EquipmentStatistics,
  equipmentStates as states,
} from "../components/equipment/EquipmentStatistics";
import { EquipmentHistory } from "../components/equipment/EquipmentHistory";
export default function Devices() {
  useLocale();
  const user = useUser();
  const [history, setHistory] = useState<Row | null>(null);
  const [binding, setBinding] = useState<Row | null>(null);
  const [bindingForm] = Form.useForm();
  const bindingAction = useAction(t("采集绑定已保存"));
  const devices = useQuery({
    queryKey: ["/telemetry/devices"],
    queryFn: () => api("/telemetry/devices"),
    refetchInterval: 15000,
  });
  const [edit, setEdit] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const action = useAction(t("设备状态已记录"));
  const connection = devices.data?.connection;
  return (
    <>
      <PageHeading
        eyebrow="SHOP FLOOR / EQUIPMENT"
        title={t("设备运行")}
        description={t(
          "连接车间现场，识别停机与异常。设备状态来自采集事件或授权的人工登记。",
        )}
        action={
          <Link to="/resources/devices">
            <Button>
              {t("管理设备台账")}
              <ArrowRightOutlined />
            </Button>
          </Link>
        }
      />
      {connection && !connection.configured && (
        <Alert
          className="mb-20"
          type="info"
          showIcon
          title={t("设备采集尚未配置")}
          description={t(
            "当前可通过人工登记记录设备状态。配置 MQTT 采集后，状态会自动同步。",
          )}
        />
      )}
      {connection?.configured && !connection.connected && (
        <Alert
          className="mb-20"
          type="warning"
          showIcon
          title={t("采集连接暂未建立")}
          description={
            connection.lastError ||
            t("正在尝试恢复连接，以下状态请结合最后采集时间判断。")
          }
        />
      )}
      {devices.error ? (
        <QueryError error={devices.error} retry={devices.refetch} />
      ) : (
        <div className="device-grid">
          {devices.data?.items?.map((d: Row) => {
            const s = states[d.status || "unknown"];
            return (
              <article className="device-card" key={d.id}>
                <div className="device-card-top">
                  <div
                    className={`device-icon ${d.status === "running" ? "running" : ""}`}
                  >
                    <ToolOutlined />
                  </div>
                  <Tag color={s?.[1]}>{s?.[0] ? t(s[0]) : d.status}</Tag>
                </div>
                <h3>{d.name}</h3>
                <span className="mono muted">{d.code}</span>
                <p>{d.data?.location || t("未登记位置")}</p>
                <div className="device-last-seen">
                  {t("最近状态事件")}
                  <strong>{dateTime(d.occurredAt)}</strong>
                  {d.stale && (
                    <span className="danger-text">
                      {t("数据已过期，请核实设备连接")}
                    </span>
                  )}
                </div>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Button onClick={() => setHistory(d)}>{t("状态历史")}</Button>
                  {can(user, "telemetry:write", ["admin", "manager"]) && (
                    <Button
                      onClick={() => {
                        setBinding(d);
                        bindingForm.setFieldsValue({
                          deviceNo: d.data?.deviceNo || d.code,
                          networked: d.data?.networked !== false,
                          pieceScale: Number(d.data?.pieceScale ?? 1),
                        });
                      }}
                    >
                      {t("采集绑定")}
                    </Button>
                  )}
                </Space>
                {can(user, "telemetry:write", ["admin", "manager"]) && (
                  <Button
                    block
                    onClick={() => {
                      setEdit(d);
                      form.resetFields();
                    }}
                  >
                    {t("登记设备状态")}
                  </Button>
                )}
              </article>
            );
          })}
          {devices.data?.items?.length === 0 && (
            <Panel>
              <Empty description={t("请先在设备台账添加设备。")} />
            </Panel>
          )}
        </div>
      )}
      <EquipmentStatistics
        devices={devices.data?.items ?? []}
        onHistory={setHistory}
      />
      {history && (
        <EquipmentHistory
          key={history.id}
          device={history}
          onClose={() => setHistory(null)}
        />
      )}
      <Modal
        title={t("采集绑定 · {name}", { name: binding?.name ?? "" })}
        open={!!binding}
        onCancel={() => setBinding(null)}
        onOk={() => bindingForm.submit()}
        confirmLoading={bindingAction.isPending}
      >
        <Form
          form={bindingForm}
          layout="vertical"
          onFinish={async (values) => {
            await bindingAction.mutateAsync({
              path: `/telemetry/devices/${binding?.id}/binding`,
              method: "PATCH",
              data: values,
            });
            setBinding(null);
          }}
        >
          <p>
            {t(
              "采集主题末段必须等于采集编号，编号不能同时绑定其他设备。修改计件比例只影响之后完成的加工次数。",
            )}
          </p>
          <Form.Item
            name="deviceNo"
            label={t("采集编号")}
            rules={[
              { required: true },
              {
                pattern: /^[A-Za-z0-9_.:-]+$/,
                message: t("使用字母、数字、点、下划线、冒号或连字符"),
              },
            ]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item
            name="networked"
            label={t("启用自动采集")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="pieceScale"
            label={t("每次有效加工的件数")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0.001} max={1000000} precision={3} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t("登记设备状态 · {name}", { name: edit?.name || "" })}
        open={!!edit}
        onCancel={() => setEdit(null)}
        onOk={() => form.submit()}
        okText={t("确认记录")}
        cancelText={t("取消")}
        confirmLoading={action.isPending}
      >
        <Form
          name="device-event"
          layout="vertical"
          form={form}
          onFinish={async (v) => {
            await action.mutateAsync({
              path: "/telemetry/events",
              data: { ...v, deviceId: edit?.id, eventId: requestId() },
            });
            setEdit(null);
          }}
        >
          <p className="muted">
            {t("人工登记会记录操作者，并参与后续状态时长统计。")}
          </p>
          <Form.Item
            name="status"
            label={t("当前设备状态")}
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(states)
                .filter(([v]) => v !== "unknown")
                .map(([value, [label]]) => ({ value, label: t(label) }))}
            />
          </Form.Item>
          <Form.Item name="reason" label={t("原因")}>
            <Input.TextArea maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
