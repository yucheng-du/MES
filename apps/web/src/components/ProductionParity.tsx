import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Alert,
  Popconfirm,
} from "antd";
import { Drawer, Modal } from "./LocalizedOverlays";
import {
  api,
  can,
  dateTime,
  number,
  requestId,
  useAction,
  useOptions,
  type Row,
} from "../api";
import { useUser } from "../auth-context";
import { t, useLocale } from "../i18n";
import { Attachments, AttachmentLinks } from "./Attachments";
import { Panel, QueryError } from "./common";
function useProduction<T = Row[]>(path: string, enabled = true) {
  return useQuery({ queryKey: [path], queryFn: () => api<T>(path), enabled });
}
const options = (rows?: Row[]) =>
  rows?.map((r) => ({ value: r.id, label: r.name }));
const cleanStep = (s: any) => ({
  name: s.name,
  unitPrice: s.unitPrice,
  expectedMinutes: s.expectedMinutes,
  procedureTypeId: s.procedureTypeId ?? null,
  deductionUnitPrice: s.deductionUnitPrice ?? 0,
  rewardUnitPrice: s.rewardUnitPrice ?? 0,
  autoComplete: !!s.autoComplete,
  operationGuide: s.operationGuide ?? "",
  inspectionGuide: s.inspectionGuide ?? "",
  attachmentIds: s.attachmentIds ?? [],
});
export const productionStepPayload = cleanStep;

export function ProductionStepFields({ index }: { index: number }) {
  useLocale();
  const types = useProduction("/production/procedure-types");
  return (
    <details style={{ gridColumn: "1 / -1", width: "100%" }}>
      <summary>{t("资格、报废计价与指导书")}</summary>
      <Form.Item
        name={[index, "procedureTypeId"]}
        label={t("工序类型与资格要求")}
      >
        <Select
          showSearch
          optionFilterProp="label"
          allowClear
          options={options(types.data?.filter((r) => r.active))}
        />
      </Form.Item>
      <Form.Item
        name={[index, "deductionUnitPrice"]}
        label={t("责任报废扣款单价（元/件）")}
      >
        <InputNumber min={0} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item
        name={[index, "rewardUnitPrice"]}
        label={t("发现报废奖励单价（元/件）")}
      >
        <InputNumber min={0} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item
        name={[index, "autoComplete"]}
        label={t("收料后自动完工")}
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      <p className="muted">
        {t("自动完工仍需人工审核工资；启用后收料即记录全部收料数量完工。")}
      </p>
      <Form.Item name={[index, "operationGuide"]} label={t("作业指导说明")}>
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item name={[index, "inspectionGuide"]} label={t("检验标准说明")}>
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item name={[index, "attachmentIds"]} label={t("工序附件")}>
        <Attachments />
      </Form.Item>
    </details>
  );
}
export function ProductDetailFields() {
  useLocale();
  const types = useOptions("/resources/product-types"),
    materials = useOptions("/resources/materials"),
    customers = useOptions("/resources/customers");
  return (
    <details>
      <summary>{t("产品属性与图纸")}</summary>
      <Form.Item name={["details", "typeId"]} label={t("产品类型")}>
        <Select allowClear options={options(types.data?.items)} />
      </Form.Item>
      <Form.Item name={["details", "materialId"]} label={t("产品材料")}>
        <Select allowClear options={options(materials.data?.items)} />
      </Form.Item>
      <Form.Item name={["details", "model"]} label={t("型号规格")}>
        <Input />
      </Form.Item>
      <Form.Item name={["details", "unitWeight"]} label={t("单件重量（克）")}>
        <InputNumber min={0} />
      </Form.Item>
      <Form.Item
        name={["details", "safetyStockDays"]}
        label={t("库存积压提醒天数")}
      >
        <InputNumber min={0} precision={0} />
      </Form.Item>
      <Form.Item name={["details", "customerIds"]} label={t("关联客户")}>
        <Select mode="multiple" options={options(customers.data?.items)} />
      </Form.Item>
      <Form.Item name={["details", "drawingIds"]} label={t("产品图纸")}>
        <Attachments />
      </Form.Item>
    </details>
  );
}

export function ProductionSetup() {
  useLocale();
  const user = useUser(),
    manage = can(user, "production:write", ["manager"]);
  const [open, setOpen] = useState(false);
  const types = useProduction("/production/procedure-types", open),
    qualifications = useProduction("/production/qualifications", open),
    scraps = useProduction("/production/scrap-types", open),
    users = useOptions("/lookups/users", {}, open && manage);
  const [typeForm] = Form.useForm(),
    [qualificationForm] = Form.useForm(),
    [scrapForm] = Form.useForm();
  const action = useAction();
  const [editingType, setEditingType] = useState<Row | null>(null),
    [editingScrap, setEditingScrap] = useState<Row | null>(null);
  if (!manage) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("生产基础设置")}</Button>
      <Drawer
        title={t("生产基础设置")}
        open={open}
        width={780}
        onClose={() => setOpen(false)}
      >
        <Tabs
          items={[
            {
              key: "types",
              label: t("工序类型"),
              children: (
                <>
                  <Form
                    layout="vertical"
                    form={typeForm}
                    onFinish={async (values) => {
                      await action.mutateAsync({
                        path: editingType
                          ? `/production/procedure-types/${editingType.id}`
                          : "/production/procedure-types",
                        method: editingType ? "PATCH" : "POST",
                        data: {
                          ...values,
                          ...(editingType
                            ? { active: editingType.active }
                            : {}),
                        },
                      });
                      typeForm.resetFields();
                      setEditingType(null);
                    }}
                  >
                    <Form.Item
                      name="code"
                      label={t("编码")}
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name="name"
                      label={t("名称")}
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Button htmlType="submit" loading={action.isPending}>
                      {t(editingType ? "保存工序类型" : "添加工序类型")}
                    </Button>
                  </Form>
                  <Table
                    rowKey="id"
                    dataSource={types.data}
                    pagination={false}
                    columns={[
                      { title: t("编码"), dataIndex: "code" },
                      { title: t("名称"), dataIndex: "name" },
                      {
                        title: t("操作"),
                        render: (_, r) => (
                          <Button
                            onClick={() => {
                              setEditingType(r);
                              typeForm.setFieldsValue({
                                code: r.code,
                                name: r.name,
                              });
                            }}
                          >
                            {t("编辑")}
                          </Button>
                        ),
                      },
                      {
                        title: t("启用"),
                        render: (_, r) => (
                          <Switch
                            checked={r.active}
                            onChange={(active) =>
                              action.mutate({
                                path: `/production/procedure-types/${r.id}`,
                                method: "PATCH",
                                data: { code: r.code, name: r.name, active },
                              })
                            }
                          />
                        ),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: "qualifications",
              label: t("人员工序资格"),
              children: (
                <>
                  <Form
                    layout="vertical"
                    form={qualificationForm}
                    initialValues={{ active: true }}
                    onFinish={async (values) => {
                      await action.mutateAsync({
                        path: `/production/qualifications/${values.userId}/${values.typeId}`,
                        method: "PUT",
                        data: {
                          active: values.active,
                          validUntil: values.validUntil || null,
                        },
                      });
                    }}
                  >
                    <Form.Item
                      name="userId"
                      label={t("操作员")}
                      rules={[{ required: true }]}
                    >
                      <Select options={options(users.data?.items)} />
                    </Form.Item>
                    <Form.Item
                      name="typeId"
                      label={t("工序类型")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={options(types.data?.filter((r) => r.active))}
                      />
                    </Form.Item>
                    <Form.Item
                      name="validUntil"
                      label={t("资格有效期至（留空长期有效）")}
                    >
                      <Input type="date" />
                    </Form.Item>
                    <Form.Item
                      name="active"
                      label={t("资格有效")}
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>
                    <Button htmlType="submit" loading={action.isPending}>
                      {t("保存人员资格")}
                    </Button>
                  </Form>
                  <Table
                    rowKey={(r) => r.userId + r.procedureTypeId}
                    dataSource={qualifications.data}
                    pagination={false}
                    columns={[
                      { title: t("操作员"), dataIndex: "workerName" },
                      { title: t("工序类型"), dataIndex: "procedureTypeName" },
                      { title: t("有效期"), dataIndex: "validUntil" },
                      {
                        title: t("资格有效"),
                        render: (_, r) => t(r.active ? "是" : "否"),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: "scraps",
              label: t("报废类型"),
              children: (
                <>
                  <Form
                    layout="vertical"
                    form={scrapForm}
                    initialValues={{ deductible: true }}
                    onFinish={async (values) => {
                      await action.mutateAsync({
                        path: editingScrap
                          ? `/production/scrap-types/${editingScrap.id}`
                          : "/production/scrap-types",
                        method: editingScrap ? "PATCH" : "POST",
                        data: {
                          ...values,
                          ...(editingScrap
                            ? { active: editingScrap.active }
                            : {}),
                        },
                      });
                      scrapForm.resetFields();
                      setEditingScrap(null);
                    }}
                  >
                    <Form.Item
                      name="code"
                      label={t("编码")}
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name="name"
                      label={t("名称")}
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      name="deductible"
                      label={t("扣款并计算发现奖励")}
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>
                    <Button htmlType="submit" loading={action.isPending}>
                      {t(editingScrap ? "保存报废类型" : "添加报废类型")}
                    </Button>
                  </Form>
                  <Table
                    rowKey="id"
                    dataSource={scraps.data}
                    pagination={false}
                    columns={[
                      { title: t("名称"), dataIndex: "name" },
                      {
                        title: t("操作"),
                        render: (_, r) => (
                          <Button
                            onClick={() => {
                              setEditingScrap(r);
                              scrapForm.setFieldsValue({
                                code: r.code,
                                name: r.name,
                                deductible: r.deductible,
                              });
                            }}
                          >
                            {t("编辑")}
                          </Button>
                        ),
                      },
                      {
                        title: t("扣款"),
                        render: (_, r) => t(r.deductible ? "是" : "否"),
                      },
                      {
                        title: t("启用"),
                        render: (_, r) => (
                          <Switch
                            checked={r.active}
                            onChange={(active) =>
                              action.mutate({
                                path: `/production/scrap-types/${r.id}`,
                                method: "PATCH",
                                data: {
                                  code: r.code,
                                  name: r.name,
                                  deductible: r.deductible,
                                  active,
                                },
                              })
                            }
                          />
                        ),
                      },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Drawer>
    </>
  );
}
export function ProductRoutes({ product }: { product: Row }) {
  useLocale();
  const user = useUser(),
    manage = can(user, "production:write", ["manager"]);
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    [editor, setEditor] = useState(false);
  const [form] = Form.useForm();
  const routes = useProduction(
    `/production/routes?productId=${product.id}`,
    open,
  );
  const save = useAction();
  const edit = (row?: Row) => {
    setEditing(row ?? null);
    form.resetFields();
    form.setFieldsValue(
      row
        ? { ...row, shared: !row.productId }
        : {
            name: "",
            shared: false,
            steps: product.steps.map(cleanStep),
            active: true,
          },
    );
    setEditor(true);
  };
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        {t("工艺方案")}
      </Button>
      <Drawer
        title={t("工艺方案")}
        open={open}
        width={780}
        onClose={() => setOpen(false)}
        extra={
          manage && <Button onClick={() => edit()}>{t("添加工艺方案")}</Button>
        }
      >
        <p>
          {t(
            "产品默认工艺保留。创建工单时可另选专用或通用方案，已有工单保持原快照。",
          )}
        </p>
        <Table
          rowKey="id"
          dataSource={routes.data}
          columns={[
            { title: t("名称"), dataIndex: "name" },
            {
              title: t("适用范围"),
              render: (_, r) => t(r.productId ? "当前产品" : "所有产品"),
            },
            { title: t("启用"), render: (_, r) => t(r.active ? "是" : "否") },
            {
              title: t("操作"),
              render: (_, r) => (
                <Button onClick={() => edit(r)}>
                  {t(manage ? "编辑" : "查看")}
                </Button>
              ),
            },
          ]}
        />
        <Drawer
          title={t("编辑工艺方案")}
          open={editor}
          width={650}
          onClose={() => setEditor(false)}
          extra={
            manage && (
              <Button loading={save.isPending} onClick={() => form.submit()}>
                {t("保存工艺方案")}
              </Button>
            )
          }
        >
          <Form
            form={form}
            layout="vertical"
            disabled={!manage}
            onFinish={async (v) => {
              await save.mutateAsync({
                path: editing
                  ? `/production/routes/${editing.id}`
                  : "/production/routes",
                method: editing ? "PATCH" : "POST",
                data: {
                  productId: v.shared ? null : product.id,
                  name: v.name,
                  steps: v.steps.map(cleanStep),
                  ...(editing
                    ? { revision: editing.revision, active: v.active }
                    : {}),
                },
              });
              setEditor(false);
            }}
          >
            <Form.Item
              name="name"
              label={t("方案名称")}
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="shared"
              label={t("通用工艺方案")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="active" label={t("启用")} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.List name="steps">
              {(fields, { add, remove, move }) => (
                <>
                  {fields.map((field) => (
                    <Panel
                      key={field.key}
                      title={`${t("工序")} ${field.name + 1}`}
                    >
                      <Form.Item
                        name={[field.name, "name"]}
                        label={t("工序名称")}
                        rules={[{ required: true }]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "unitPrice"]}
                        label={t("单价（元/件）")}
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={0} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "expectedMinutes"]}
                        label={t("标准工时（分钟）")}
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={0.01} />
                      </Form.Item>
                      <ProductionStepFields index={field.name} />
                      <Space>
                        <Button
                          disabled={field.name === 0}
                          onClick={() => move(field.name, field.name - 1)}
                        >
                          {t("上移工序")}
                        </Button>
                        <Button
                          disabled={field.name === fields.length - 1}
                          onClick={() => move(field.name, field.name + 1)}
                        >
                          {t("下移工序")}
                        </Button>
                      </Space>
                      <Button
                        danger
                        disabled={fields.length <= 1}
                        onClick={() => remove(field.name)}
                      >
                        {t("删除工序")}
                      </Button>
                    </Panel>
                  ))}
                  <Button
                    onClick={() =>
                      add({ name: "", unitPrice: 0, expectedMinutes: 1 })
                    }
                  >
                    {t("添加下一道工序")}
                  </Button>
                </>
              )}
            </Form.List>
          </Form>
        </Drawer>
      </Drawer>
    </>
  );
}
export function RouteSelect({ productId }: { productId?: string }) {
  useLocale();
  const routes = useProduction(
    `/production/routes${productId ? `?productId=${productId}` : ""}`,
    !!productId,
  );
  return (
    <Form.Item name="routeId" label={t("工艺方案")}>
      <Select
        allowClear
        placeholder={t("产品默认工艺")}
        options={options(routes.data?.filter((r) => r.active))}
      />
    </Form.Item>
  );
}
export function TaskAssignment({ task }: { task: Row }) {
  useLocale();
  const user = useUser(),
    manage = can(user, "tasks:write", ["manager"]),
    [open, setOpen] = useState(false),
    [force, setForce] = useState(false),
    [form] = Form.useForm(),
    [forceForm] = Form.useForm();
  const users = useOptions("/lookups/users", {}, open && manage),
    stations = useOptions("/resources/workstations", {}, open),
    devices = useOptions("/resources/devices", {}, open);
  const action = useAction();
  const meta = task.production ?? {};
  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      <Space wrap style={{ maxWidth: "100%" }}>
        <span style={{ overflowWrap: "anywhere" }}>
          {task.assignedWorkerName || t("未指定工人")} ·{" "}
          {task.assignedStationName || t("未指定工位")} ·{" "}
          {task.assignedDeviceName || t("未指定设备")}
        </span>
        {manage && ["ready", "blocked"].includes(task.status) && (
          <Button
            size="small"
            onClick={() => {
              form.setFieldsValue({
                workerId: task.assignedWorkerId,
                workstationId: task.assignedStationId,
                deviceId: task.assignedDeviceId,
              });
              setOpen(true);
            }}
          >
            {t("分派任务")}
          </Button>
        )}
        {manage && task.status === "ready" && (
          <Button
            size="small"
            onClick={() => {
              forceForm.resetFields();
              setForce(true);
              setOpen(true);
            }}
          >
            {t("主管补录完工")}
          </Button>
        )}
      </Space>
      {!!(
        meta.operationGuide ||
        meta.inspectionGuide ||
        meta.attachmentIds?.length
      ) && (
        <details>
          <summary>{t("作业与检验指导")}</summary>
          <p>{meta.operationGuide}</p>
          <p>{meta.inspectionGuide}</p>
          <AttachmentLinks ids={meta.attachmentIds} />
        </details>
      )}
      <Modal
        title={t(force ? "主管补录完工" : "分派任务")}
        open={open}
        onCancel={() => {
          setOpen(false);
          setForce(false);
        }}
        onOk={() => (force ? forceForm : form).submit()}
        confirmLoading={action.isPending}
      >
        <Form
          layout="vertical"
          form={force ? forceForm : form}
          onFinish={async (v) => {
            await action.mutateAsync(
              force
                ? {
                    path: `/tasks/${task.id}/receive`,
                    data: {
                      workerId: v.workerId,
                      workstationId: v.workstationId,
                      quantity: v.quantity,
                      forceComplete: true,
                      reason: v.reason,
                      requestId: requestId(),
                    },
                  }
                : {
                    path: `/tasks/${task.id}/assignment`,
                    method: "PATCH",
                    data: {
                      workerId: v.workerId ?? null,
                      workstationId: v.workstationId ?? null,
                      deviceId: v.deviceId ?? null,
                    },
                  },
            );
            setOpen(false);
            setForce(false);
          }}
        >
          <Form.Item
            name="workerId"
            label={t("指定操作员")}
            rules={force ? [{ required: true }] : []}
          >
            <Select
              showSearch
              optionFilterProp="label"
              allowClear
              options={options(users.data?.items)}
            />
          </Form.Item>
          <Form.Item
            name="workstationId"
            label={t("指定工位")}
            rules={force ? [{ required: true }] : []}
          >
            <Select
              showSearch
              optionFilterProp="label"
              allowClear
              options={options(stations.data?.items)}
            />
          </Form.Item>
          {force ? (
            <>
              <Alert
                type="warning"
                message={t(
                  "补录不会跳过资格、设备和数量校验，工资需人工审核。",
                )}
              />
              <Form.Item
                name="quantity"
                label={t("完工数量")}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} precision={0} />
              </Form.Item>
              <Form.Item
                name="reason"
                label={t("补录原因")}
                rules={[{ required: true }]}
              >
                <Input.TextArea />
              </Form.Item>
            </>
          ) : (
            <Form.Item name="deviceId" label={t("指定设备")}>
              <Select
                showSearch
                optionFilterProp="label"
                allowClear
                options={options(devices.data?.items)}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
const stateLabels: Record<string, string> = {
  off_duty: "离岗",
  on_duty: "在岗",
  disabled: "已停用",
};
const eventLabels: Record<string, string> = {
  "on-duty": "上岗",
  "off-duty": "离岗",
  "force-off-duty": "强制离岗",
  enable: "启用",
  disable: "停用",
  receive: "收料",
  complete: "完工",
  no_material: "在岗无料",
};
export function StationDutyPanel() {
  useLocale();
  const user = useUser(),
    manage = can(user, "production:write", ["manager"]),
    operate = can(user, "production:write", ["manager", "operator"]);
  const stations = useProduction("/production/stations"),
    types = useProduction("/production/procedure-types"),
    devices = useOptions("/resources/devices");
  const [actionRow, setActionRow] = useState<Row | null>(null),
    [logId, setLogId] = useState<string>(),
    [forceRow, setForceRow] = useState<Row | null>(null),
    [form] = Form.useForm(),
    [reason, setReason] = useState("");
  const action = useAction();
  const logs = useProduction<{ items: Row[] }>(
    `/production/station-logs${logId ? `?stationId=${logId}` : ""}`,
    !!logId,
  );
  if (stations.error)
    return <QueryError error={stations.error} retry={stations.refetch} />;
  return (
    <Panel
      title={t("工位上下岗")}
      description={t(
        "先取得工序资格，再在工位上岗。工位有任务时不能离岗或更换设备。",
      )}
    >
      <Table
        rowKey="id"
        dataSource={stations.data}
        pagination={false}
        scroll={{ x: 650 }}
        columns={[
          { title: t("工位"), dataIndex: "name" },
          {
            title: t("状态"),
            render: (_, r) => (
              <Tag>{t(r.configured ? stateLabels[r.state] : "待配置")}</Tag>
            ),
          },
          { title: t("操作员"), dataIndex: "workerName" },
          {
            title: t("当前任务"),
            render: (_, r) => t(r.currentReportId ? "加工任务占用" : "空闲"),
          },
          {
            title: t("操作"),
            render: (_, r) => (
              <Space wrap>
                {operate && r.configured && r.state === "off_duty" && (
                  <Button
                    size="small"
                    onClick={() =>
                      action.mutate({
                        path: `/production/stations/${r.id}/on-duty`,
                        data: {},
                      })
                    }
                  >
                    {t("上岗")}
                  </Button>
                )}
                {operate && r.workerId === user.id && !r.currentReportId && (
                  <Button
                    size="small"
                    onClick={() =>
                      action.mutate({
                        path: `/production/stations/${r.id}/off-duty`,
                        data: {},
                      })
                    }
                  >
                    {t("离岗")}
                  </Button>
                )}
                {manage && r.state === "on_duty" && !r.currentReportId && (
                  <Button
                    size="small"
                    onClick={() => {
                      setReason("");
                      setForceRow(r);
                    }}
                  >
                    {t("强制离岗")}
                  </Button>
                )}
                {manage && r.state !== "on_duty" && (
                  <>
                    <Button
                      size="small"
                      onClick={() => {
                        setActionRow(r);
                        form.setFieldsValue({
                          procedureTypeId: r.procedureTypeId,
                          deviceId: r.deviceId,
                          idleThresholdMinutes: r.idleThresholdMinutes ?? 60,
                        });
                      }}
                    >
                      {t("配置工位")}
                    </Button>
                    {r.configured && (
                      <Button
                        size="small"
                        onClick={() =>
                          action.mutate({
                            path: `/production/stations/${r.id}/${r.state === "disabled" ? "enable" : "disable"}`,
                            data: {},
                          })
                        }
                      >
                        {t(r.state === "disabled" ? "启用" : "停用")}
                      </Button>
                    )}
                  </>
                )}
                <Button size="small" onClick={() => setLogId(r.id)}>
                  {t("状态与无料日志")}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={t("配置工位")}
        open={!!actionRow}
        onCancel={() => setActionRow(null)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            await action.mutateAsync({
              path: `/production/stations/${actionRow?.id}/config`,
              method: "PATCH",
              data: {
                procedureTypeId: v.procedureTypeId ?? null,
                deviceId: v.deviceId ?? null,
                idleThresholdMinutes: v.idleThresholdMinutes,
              },
            });
            setActionRow(null);
          }}
        >
          <Form.Item name="procedureTypeId" label={t("工序类型")}>
            <Select
              allowClear
              options={options(types.data?.filter((r) => r.active))}
            />
          </Form.Item>
          <Form.Item name="deviceId" label={t("设备")}>
            <Select allowClear options={options(devices.data?.items)} />
          </Form.Item>
          <Form.Item
            name="idleThresholdMinutes"
            label={t("无料提醒阈值（分钟）")}
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={1440} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t("强制离岗")}
        open={!!forceRow}
        onCancel={() => setForceRow(null)}
        confirmLoading={action.isPending}
        onOk={async () => {
          if (!reason.trim()) return;
          await action.mutateAsync({
            path: `/production/stations/${forceRow?.id}/force-off-duty`,
            data: { reason },
          });
          setForceRow(null);
        }}
      >
        <Input.TextArea
          aria-label={t("强制离岗原因")}
          placeholder={t("强制离岗原因")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
      <Drawer
        title={t("状态与无料日志")}
        open={!!logId}
        width={800}
        onClose={() => setLogId(undefined)}
      >
        <Table
          rowKey="id"
          dataSource={logs.data?.items}
          scroll={{ x: 650 }}
          columns={[
            {
              title: t("状态事件"),
              render: (_, r) => t(eventLabels[r.event] ?? r.event),
            },
            { title: t("操作员"), dataIndex: "workerName" },
            { title: t("开始时间"), dataIndex: "startedAt", render: dateTime },
            { title: t("结束时间"), dataIndex: "endedAt", render: dateTime },
            {
              title: t("持续分钟"),
              dataIndex: "durationMinutes",
              render: (v) => (v === null ? "—" : number(v)),
            },
            {
              title: t("超过无料阈值"),
              render: (_, r) => t(r.thresholdExceeded ? "是" : "否"),
            },
            { title: t("原因"), dataIndex: "reason" },
          ]}
        />
      </Drawer>
    </Panel>
  );
}
export function ScrapAutomaticSettings() {
  useLocale();
  const user = useUser(),
    manage = can(user, "production:write", ["manager"]),
    query = useProduction<Row>("/production/settings", manage),
    [form] = Form.useForm();
  const save = useAction();
  if (!manage) return null;
  return (
    <Panel
      title={t("本人责任报废自动审核")}
      description={t(
        "仅本人同一报工、类型要求扣款且已配置责任单价的记录可自动批准。其他报废继续人工处理。",
      )}
    >
      <Form
        form={form}
        key={query.data?.revision}
        initialValues={query.data}
        layout="vertical"
        onFinish={(v) =>
          save.mutate({
            path: "/production/settings",
            method: "PATCH",
            data: { ...v, revision: query.data?.revision },
          })
        }
      >
        <Form.Item
          name="scrapAutoReview"
          label={t("启用本人责任报废自动审核")}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Form.Item
          name="scrapMaxAmount"
          label={t("单笔自动扣款上限（元）")}
          rules={[{ required: true }]}
        >
          <InputNumber min={0} />
        </Form.Item>
        <Button htmlType="submit" loading={save.isPending}>
          {t("保存报废审核设置")}
        </Button>
      </Form>
    </Panel>
  );
}
export function ScrapExtraFields({ reports = [] }: { reports?: Row[] }) {
  useLocale();
  const types = useProduction("/production/scrap-types");
  const user = useUser();
  return (
    <>
      <Form.Item name="scrapTypeId" label={t("报废类型")}>
        <Select
          allowClear
          options={options(types.data?.filter((r) => r.active))}
        />
      </Form.Item>
      <Form.Item name="reportId" label={t("发现报工记录")}>
        <Select
          allowClear
          options={reports
            .filter(
              (r) =>
                ["admin", "manager"].includes(user.role) ||
                r.workerId === user.id,
            )
            .map((r) => ({
              value: r.id,
              label: `${r.taskName} · ${r.workerName} · ${dateTime(r.createdAt)}`,
            }))}
        />
      </Form.Item>
      <Form.Item name="responsibleReportId" label={t("责任报工记录")}>
        <Select
          allowClear
          options={reports.map((r) => ({
            value: r.id,
            label: `${r.taskName} · ${r.workerName} · ${dateTime(r.createdAt)}`,
          }))}
        />
      </Form.Item>
    </>
  );
}

export function ReportBatchReview({
  ids,
  onDone,
}: {
  ids: string[];
  onDone: () => void;
}) {
  useLocale();
  const [actionName, setActionName] = useState<"approve" | "reject">(),
    [reason, setReason] = useState("");
  const action = useAction();
  return (
    <Space wrap>
      <span>{t("已选择 {count} 笔报工", { count: ids.length })}</span>
      <Button
        disabled={!ids.length}
        onClick={() => {
          setReason("");
          setActionName("approve");
        }}
      >
        {t("批量批准")}
      </Button>
      <Button
        disabled={!ids.length}
        onClick={() => {
          setReason("");
          setActionName("reject");
        }}
      >
        {t("批量退回")}
      </Button>
      <Modal
        title={t("批量审核报工")}
        open={!!actionName}
        onCancel={() => setActionName(undefined)}
        confirmLoading={action.isPending}
        okButtonProps={{ disabled: actionName === "reject" && !reason.trim() }}
        onOk={async () => {
          await action.mutateAsync({
            path: "/reports/batch-review",
            data: { ids, action: actionName, reason },
          });
          setActionName(undefined);
          onDone();
        }}
      >
        <Input.TextArea
          aria-label={t("批量审核原因")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </Space>
  );
}

export function ScrapApprove({ scrap }: { scrap: Row }) {
  useLocale();
  const user = useUser(),
    canPrice = can(user, "scraps:approve", ["manager"]),
    [open, setOpen] = useState(false),
    [form] = Form.useForm();
  const detail = useProduction<Row>(`/work-orders/${scrap.workOrderId}`, open),
    action = useAction();
  return (
    <>
      <Button
        size="small"
        type="primary"
        onClick={() => {
          form.setFieldsValue({
            responsibleReportId: scrap.responsibleReportId,
            deductionUnitPrice: scrap.deductionUnitPrice ?? 0,
            rewardUnitPrice: scrap.rewardUnitPrice ?? 0,
          });
          setOpen(true);
        }}
      >
        {t("批准")}
      </Button>
      <Modal
        title={t("批准报废并确认奖扣")}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={action.isPending}
      >
        <Form
          layout="vertical"
          form={form}
          onFinish={async (v) => {
            await action.mutateAsync({
              path: `/scraps/${scrap.id}/approve`,
              data: {
                responsibleReportId: v.responsibleReportId ?? null,
                ...(canPrice
                  ? {
                      deductionUnitPrice: v.deductionUnitPrice,
                      rewardUnitPrice: v.rewardUnitPrice,
                    }
                  : {}),
                requestId: requestId(),
              },
            });
            setOpen(false);
          }}
        >
          <Form.Item name="responsibleReportId" label={t("责任报工记录")}>
            <Select
              allowClear
              options={detail.data?.reports?.map((r: Row) => ({
                value: r.id,
                label: `${r.taskName} · ${r.workerName}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="deductionUnitPrice"
            label={t("责任报废扣款单价（元/件）")}
          >
            <InputNumber disabled={!canPrice} min={0} />
          </Form.Item>
          <Form.Item
            name="rewardUnitPrice"
            label={t("发现报废奖励单价（元/件）")}
          >
            <InputNumber disabled={!canPrice} min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
