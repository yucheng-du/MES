import { StockAlerts } from "../components/StockAlerts";
import { PeopleFields } from "../components/PeopleFields";
import { PayrollAdjustment } from "../components/PayrollAdjustment";
import { Drawer, Modal } from "../components/LocalizedOverlays";
import { t, useLocale } from "../i18n";
import { useState } from "react";
import { resourceMap } from "@mes/shared";
import {
  Button,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Row as GridRow,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  can,
  dateOnly,
  dateTime,
  money,
  number,
  requestId,
  roleNames,
  useAction,
  useList,
  useOptions,
  type Row,
} from "../api";
import { useUser } from "../auth-context";
import {
  DataTable,
  OptionsEmpty,
  PageHeading,
  Panel,
  SearchBar,
  Status,
  useFilters,
} from "../components/common";
export function Inventory() {
  useLocale();
  const user = useUser();
  const [tab, setTab] = useState("inventory");
  const filters = useFilters();
  const list = useList(
    tab === "inventory" ? "/inventory" : "/stock-movements",
    filters.params,
  );
  const products = useOptions("/products");
  const orders = useOptions("/sales-orders");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const action = useAction(t("出入库记录已保存"));
  const canWrite = can(user, "stock-movements:write", [
    "admin",
    "manager",
    "warehouse",
  ]);
  const begin = (direction: string) => {
    form.resetFields();
    form.setFieldsValue({ direction, quantity: 1 });
    setOpen(true);
  };
  return (
    <>
      <PageHeading
        eyebrow="WAREHOUSE / FINISHED GOODS"
        title={t("成品库存")}
        description={t(
          "完工有来源，出入库有流水。数量与订单分开核算，避免超额入库或负库存。",
        )}
        action={
          <Space wrap>
            <StockAlerts />
            {canWrite && (
              <>
                <Button icon={<ArrowUpOutlined />} onClick={() => begin("out")}>
                  {t("登记出库")}
                </Button>
                <Button
                  type="primary"
                  icon={<ArrowDownOutlined />}
                  onClick={() => begin("in")}
                >
                  {t("成品入库")}
                </Button>
              </>
            )}
          </Space>
        }
      />
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={(v) => {
            setTab(v);
            filters.setPage(1);
          }}
          items={[
            { key: "inventory", label: t("实时库存") },
            { key: "movements", label: t("出入库流水") },
          ]}
          className="panel-tabs"
        />
        <SearchBar onSearch={filters.search} refresh={list.refetch} />
        <DataTable
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          rowKey={(r) => r.id || `${r.productId}-${r.salesOrderId || "stock"}`}
          empty={
            tab === "inventory"
              ? t("尚无成品库存，末道工序完工后可登记入库。")
              : t("暂无出入库流水")
          }
          columns={
            tab === "inventory"
              ? [
                  {
                    title: t("产品"),
                    render: (_, r) => (
                      <div className="cell-stack">
                        <strong>{r.productName}</strong>
                        <span className="mono">{r.productCode}</span>
                      </div>
                    ),
                  },
                  {
                    title: t("销售订单"),
                    dataIndex: "salesOrderCode",
                    render: (v) => v || t("备库生产"),
                  },
                  {
                    title: t("当前库存"),
                    dataIndex: "quantity",
                    render: (v) => (
                      <strong className="inventory-number">{number(v)}</strong>
                    ),
                  },
                  {
                    title: t("可入库完工量"),
                    dataIndex: "availableToReceive",
                    render: number,
                  },
                  {
                    title: t("累计入库"),
                    dataIndex: "inQuantity",
                    render: number,
                  },
                  {
                    title: t("累计出库"),
                    dataIndex: "outQuantity",
                    render: number,
                  },
                ]
              : [
                  { title: t("产品"), dataIndex: "productName" },
                  {
                    title: t("方向"),
                    dataIndex: "direction",
                    render: (v) => <Status value={v} />,
                  },
                  { title: t("数量"), dataIndex: "quantity", render: number },
                  {
                    title: t("订单"),
                    dataIndex: "salesOrderCode",
                    render: (v) => v || t("备库生产"),
                  },
                  { title: t("说明"), dataIndex: "reason" },
                  { title: t("经办人"), dataIndex: "creatorName" },
                  {
                    title: t("记录时间"),
                    dataIndex: "createdAt",
                    render: dateTime,
                  },
                ]
          }
        />
      </Panel>
      <Drawer
        title={t("登记成品出入库")}
        width={500}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button
            type="primary"
            loading={action.isPending}
            onClick={() => form.submit()}
          >
            {t("确认入账")}
          </Button>
        }
      >
        <div className="info-note">
          {t(
            "入库数量以末道工序完工后的可入库量为上限；出库数量不能超过对应订单现有库存。",
          )}
        </div>
        <Form
          name="stock-movement"
          form={form}
          layout="vertical"
          onFinish={async (v) => {
            await action.mutateAsync({
              path: "/stock-movements",
              data: { ...v, requestId: requestId() },
            });
            setOpen(false);
          }}
        >
          <Form.Item
            name="direction"
            label={t("操作方向")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "in", label: t("成品入库") },
                { value: "out", label: t("成品出库") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="productId"
            label={t("产品")}
            rules={[{ required: true }]}
          >
            <Select
              loading={products.isLoading}
              notFoundContent={<OptionsEmpty query={products} />}
              showSearch
              optionFilterProp="label"
              options={products.data?.items.map((r) => ({
                label: `${r.code} · ${r.name}`,
                value: r.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="salesOrderId" label={t("销售订单")}>
            <Select
              loading={orders.isLoading}
              notFoundContent={<OptionsEmpty query={orders} />}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("未关联则按备库生产核算")}
              options={orders.data?.items.map((r) => ({
                label: `${r.code} · ${r.customerName || ""}`,
                value: r.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label={t("数量")}
            rules={[{ required: true }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label={t("用途 / 说明")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
export function Payroll() {
  useLocale();
  const [detail, setDetail] = useState<Row | null>(null);
  const filters = useFilters();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const list = useList("/payroll", { ...filters.params, month });
  return (
    <>
      <PageHeading
        eyebrow="PEOPLE / PIECEWORK"
        title={t("计件薪酬")}
        description={t(
          "每一笔收入，都能追溯到审核通过的工作。单价取自工单创建时的工艺快照。",
        )}
      />
      <div className="payroll-banner">
        <div>
          <span>{t("当前查看月份")}</span>
          <strong>{month.replace("-", " / ")}</strong>
        </div>
        <div>
          <span>{t("本页已入账金额")}</span>
          <strong>
            {money(
              list.data?.items.reduce(
                (sum, r) => sum + Number(r.amount || 0),
                0,
              ),
            )}
          </strong>
        </div>
        <p>
          {t("只展示已审核业务产生的工资分录")}
          <br />
          {t("计件与计时来源均保留完整记录")}
        </p>
      </div>
      <Panel>
        <SearchBar onSearch={filters.search} refresh={list.refetch}>
          <PayrollAdjustment />
          <Input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              filters.setPage(1);
            }}
            style={{ width: 170 }}
            aria-label={t("薪酬月份")}
          />
        </SearchBar>
        <DataTable
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          empty={t("该月份还没有工资分录，报工审核后自动生成。")}
          columns={[
            {
              title: t("人员"),
              dataIndex: "workerName",
              render: (v) => <strong>{v}</strong>,
            },
            {
              title: t("业务来源"),
              dataIndex: "sourceType",
              render: (v) => (
                <Tag>
                  {v === "piece"
                    ? t("计件报工")
                    : v === "hours"
                      ? t("计时工单")
                      : v === "reward"
                        ? t("安全奖励")
                        : v === "penalty"
                          ? t("安全处罚")
                          : v === "scrap-penalty"
                            ? t("报废扣款")
                            : v === "scrap-reward"
                              ? t("报废奖励")
                              : v === "piece-adjustment"
                                ? t("计件调整")
                                : v === "quality-reward"
                                  ? t("质量奖励")
                                  : v === "manual-adjustment"
                                    ? t("人工调整")
                                    : v}
                </Tag>
              ),
            },
            {
              title: t("工单 / 工序"),
              render: (_, r) => (
                <div className="cell-stack">
                  <span>
                    {r.workOrderCode || r.sourceCode || r.sourceId || "—"}
                  </span>
                  <span>{r.taskName || r.description}</span>
                </div>
              ),
            },
            { title: t("数量 / 工时"), dataIndex: "quantity", render: number },
            { title: t("单价"), dataIndex: "unitPrice", render: money },
            {
              title: t("金额"),
              dataIndex: "amount",
              render: (v) => <strong>{money(v)}</strong>,
            },
            { title: t("归属日期"), dataIndex: "workDate", render: dateOnly },
            {
              title: t("操作"),
              render: (_, row) => (
                <Button type="link" onClick={() => setDetail(row)}>
                  {t("详情")}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Drawer
        title={t("工资分录详情")}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        <Descriptions
          column={1}
          bordered
          items={
            detail
              ? [
                  {
                    key: "worker",
                    label: t("人员"),
                    children: detail.workerName,
                  },
                  {
                    key: "source",
                    label: t("业务来源"),
                    children: t(detail.sourceType),
                  },
                  {
                    key: "sourceId",
                    label: t("对象标识"),
                    children: detail.sourceId,
                  },
                  {
                    key: "quantity",
                    label: t("数量 / 工时"),
                    children: number(detail.quantity),
                  },
                  {
                    key: "rate",
                    label: t("单价"),
                    children: money(detail.unitPrice),
                  },
                  {
                    key: "amount",
                    label: t("金额"),
                    children: money(detail.amount),
                  },
                  {
                    key: "description",
                    label: t("说明"),
                    children: detail.description || "—",
                  },
                  {
                    key: "date",
                    label: t("归属日期"),
                    children: dateOnly(detail.workDate),
                  },
                  {
                    key: "created",
                    label: t("记录时间"),
                    children: dateTime(detail.createdAt),
                  },
                ]
              : []
          }
        />
      </Drawer>
    </>
  );
}
export function Users() {
  useLocale();
  const user = useUser();
  const canManage = user.role === "admin";
  const filters = useFilters();
  const list = useList("/users", filters.params);
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const [passwordFor, setPasswordFor] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const action = useAction(t("成员信息已保存"));
  const passwordAction = useAction(t("密码已更新"));
  const archiveAction = useAction(t("成员已归档"));
  const begin = (r?: Row) => {
    setEditing(r || null);
    form.resetFields();
    form.setFieldsValue(r || { role: "operator", active: true });
    setOpen(true);
  };
  return (
    <>
      <PageHeading
        eyebrow="TEAM / ACCESS"
        title={t("成员与权限")}
        description={t("按实际职责分配角色，关键业务操作由服务端独立校验。")}
        action={
          canManage && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => begin()}
            >
              {t("添加成员")}
            </Button>
          )
        }
      />
      <Panel>
        <SearchBar onSearch={filters.search} refresh={list.refetch} />
        <DataTable
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          columns={[
            {
              title: t("姓名"),
              dataIndex: "name",
              render: (v, r) => (
                <div className="member-name">
                  <div className="member-avatar">{v?.slice(-2)}</div>
                  <div className="cell-stack">
                    <strong>{v}</strong>
                    <span>{r.username}</span>
                  </div>
                </div>
              ),
            },
            {
              title: t("角色"),
              dataIndex: "role",
              render: (v) => (
                <Tag color="blue">{roleNames[v] ? t(roleNames[v]) : v}</Tag>
              ),
            },
            {
              title: t("状态"),
              dataIndex: "active",
              render: (v) => (
                <Tag color={v ? "green" : "default"}>
                  {v ? t("启用") : t("已停用")}
                </Tag>
              ),
            },
            { title: t("加入时间"), dataIndex: "createdAt", render: dateOnly },
            {
              title: t("操作"),
              render: (_, r) =>
                canManage ? (
                  <Space>
                    <Button type="link" onClick={() => begin(r)}>
                      {t("编辑")}
                    </Button>
                    <Button
                      type="link"
                      onClick={() => {
                        passwordForm.resetFields();
                        setPasswordFor(r);
                      }}
                    >
                      {t("修改密码")}
                    </Button>
                    {r.id !== user.id && (
                      <Popconfirm
                        title={t("归档成员")}
                        description={t(
                          "归档后将无法登录，已有业务记录仍保留。",
                        )}
                        onConfirm={() =>
                          archiveAction.mutateAsync({
                            path: `/users/${r.id}`,
                            method: "DELETE",
                          })
                        }
                      >
                        <Button type="link" danger>
                          {t("归档")}
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </Panel>
      <Drawer
        title={editing ? t("编辑成员") : t("添加成员")}
        open={open}
        width={460}
        onClose={() => setOpen(false)}
        extra={
          <Button
            type="primary"
            loading={action.isPending}
            onClick={() => form.submit()}
          >
            {t("保存")}
          </Button>
        }
      >
        <Form
          name="user-editor"
          layout="vertical"
          form={form}
          onFinish={async (v) => {
            await action.mutateAsync({
              path: editing ? `/users/${editing.id}` : "/users",
              method: editing ? "PATCH" : "POST",
              data: editing
                ? {
                    name: v.name,
                    role: v.role,
                    active: v.active,
                    username: v.username,
                    revision: editing.revision,
                    departmentId: v.departmentId ?? null,
                    jobTitle: v.jobTitle ?? "",
                    mobile: v.mobile ?? "",
                    allowedPermissions: v.allowedPermissions ?? [],
                    deniedPermissions: v.deniedPermissions ?? [],
                    profile: v.profile,
                  }
                : {
                    name: v.name,
                    username: v.username,
                    password: v.password,
                    role: v.role,
                    departmentId: v.departmentId,
                    jobTitle: v.jobTitle,
                    mobile: v.mobile,
                    allowedPermissions: v.allowedPermissions,
                    deniedPermissions: v.deniedPermissions,
                    profile: v.profile,
                  },
            });
            setOpen(false);
          }}
        >
          <Form.Item name="name" label={t("姓名")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="username"
            label={t("登录账号")}
            rules={[{ required: true }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          {!editing && (
            <Form.Item
              name="password"
              label={t("初始密码")}
              rules={[
                { required: true },
                { min: 12, message: t("密码至少 12 位") },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          <Form.Item
            name="role"
            label={t("业务角色")}
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(roleNames).map(([value, label]) => ({
                label: t(label),
                value,
              }))}
            />
          </Form.Item>
          <PeopleFields />
          <Form.Item
            name="active"
            label={t("允许登录")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <div className="info-note">
            {t(
              "生产主管负责安排和审核；操作员负责车间作业；质量人员审核生产质量；仓库人员管理出入库；只读成员仅查看。",
            )}
          </div>
        </Form>
      </Drawer>
      <Modal
        title={t("修改密码 · {name}", { name: passwordFor?.name || "" })}
        open={!!passwordFor}
        onCancel={() => setPasswordFor(null)}
        onOk={() => passwordForm.submit()}
        confirmLoading={passwordAction.isPending}
        okText={t("更新密码")}
        cancelText={t("取消")}
      >
        <Form
          name="user-password"
          layout="vertical"
          form={passwordForm}
          onFinish={async (v) => {
            await passwordAction.mutateAsync({
              path: `/users/${passwordFor?.id}/password`,
              data: v,
            });
            setPasswordFor(null);
          }}
        >
          {passwordFor?.id === user.id && (
            <Form.Item
              name="currentPassword"
              label={t("当前密码")}
              rules={[{ required: true }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
          )}
          <Form.Item
            name="password"
            label={t("新密码")}
            rules={[
              { required: true },
              { min: 12, message: t("密码至少 12 位") },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
const auditActionLabels: Record<string, string> = {
  create: "新建",
  update: "更新",
  delete: "删除",
  feedback: "反馈",
  submit: "提交",
  approve: "批准",
  reject: "退回",
  archive: "归档",
  restore: "恢复",
  bootstrap: "初始化管理员",
  upload: "上传",
  login: "登录",
  "change-password": "修改密码",
  "request-login-code": "请求短信验证码",
  "sms-login": "短信验证码登录",
  close: "关闭",
  receive: "收料",
  start: "开工",
  complete: "完工",
  resubmit: "重新提交",
  in: "入库",
  out: "出库",
  "device-status": "设备状态登记",
  "auto-approve": "自动批准",
  "auto-review-manual": "转人工审核",
  "auto-review-error": "自动审核异常",
  "auto-review-run": "执行自动审核",
};
const auditResourceLabels: Record<string, string> = {
  users: "成员与权限",
  auth: "身份验证",
  products: "产品",
  "sales-orders": "销售订单",
  "work-orders": "工单",
  reports: "报工记录",
  scraps: "报废记录",
  "stock-movements": "出入库流水",
  files: "附件",
  "auto-review": "自动审核",
  "auto-review-settings": "自动审核设置",
};
const auditActionLabel = (value: string) =>
  auditActionLabels[value] ? t(auditActionLabels[value]) : value;
const auditResourceLabel = (value: string) => {
  const label = resourceMap[value]?.title || auditResourceLabels[value];
  return label ? t(label) : value;
};
export function AuditLogs() {
  useLocale();
  const filters = useFilters();
  const list = useList("/audit-logs", filters.params);
  const [detail, setDetail] = useState<Row | null>(null);
  return (
    <>
      <PageHeading
        eyebrow="GOVERNANCE / AUDIT TRAIL"
        title={t("操作记录")}
        description={t(
          "保留操作者、时间、对象与变更内容，让重要业务可以回溯。",
        )}
      />
      <Panel>
        <SearchBar
          onSearch={filters.search}
          refresh={list.refetch}
          placeholder={t("搜索操作或业务对象")}
        />
        <DataTable
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          columns={[
            {
              title: t("发生时间"),
              dataIndex: "createdAt",
              render: dateTime,
              width: 190,
            },
            {
              title: t("操作人"),
              dataIndex: "actorName",
              render: (value) => value || t("系统"),
            },
            {
              title: t("动作"),
              dataIndex: "action",
              render: (v) => <Tag>{auditActionLabel(v)}</Tag>,
            },
            {
              title: t("业务对象"),
              dataIndex: "resource",
              render: auditResourceLabel,
            },
            { title: t("对象标识"), dataIndex: "resourceId", ellipsis: true },
            {
              title: t("变更记录"),
              render: (_, r) => (
                <Button type="link" onClick={() => setDetail(r)}>
                  {t("查看详情")}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Drawer
        title={t("操作详情")}
        width={640}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <Descriptions
              column={1}
              items={[
                {
                  key: "actor",
                  label: t("操作人"),
                  children: detail.actorName || t("系统"),
                },
                {
                  key: "time",
                  label: t("时间"),
                  children: dateTime(detail.createdAt),
                },
                {
                  key: "action",
                  label: t("动作"),
                  children: auditActionLabel(detail.action),
                },
                {
                  key: "resource",
                  label: t("对象"),
                  children: auditResourceLabel(detail.resource),
                },
              ]}
            />
            <pre className="audit-json">
              {JSON.stringify(
                detail.details || detail.metadata || detail,
                null,
                2,
              )}
            </pre>
          </>
        )}
      </Drawer>
    </>
  );
}
