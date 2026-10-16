import { ReportEquipment } from "../components/ReportEquipment";
import {
  ProductAvailability,
  SalesOrderMaintenance,
  WorkOrderDelete,
} from "../components/ProductionMaintenance";
import {
  ProductionSetup,
  ProductRoutes,
  ProductDetailFields,
  ProductionStepFields,
  productionStepPayload,
  RouteSelect,
  TaskAssignment,
} from "../components/ProductionParity";
import { Drawer, Modal } from "../components/LocalizedOverlays";
import { t, useLocale } from "../i18n";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Row as GridRow,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DeleteOutlined,
  PlusOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import {
  api,
  can,
  dateOnly,
  money,
  number,
  useAction,
  useList,
  useOptions,
  type Row,
} from "../api";
import { canManage, useUser } from "../auth-context";
import {
  ActionGroup,
  DataTable,
  OptionsEmpty,
  DetailValue,
  NativePrint,
  PageHeading,
  Panel,
  QueryError,
  ReasonAction,
  SearchBar,
  Status,
  useFilters,
} from "../components/common";
export function Products() {
  useLocale();
  const filters = useFilters();
  const list = useList("/products", filters.params);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const action = useAction(t("产品工艺已保存"));
  const user = useUser();
  const edit = (r?: Row) => {
    setEditing(r || null);
    form.resetFields();
    form.setFieldsValue(
      r || {
        unit: t("件"),
        safetyStock: 0,
        steps: [{ name: t("加工"), unitPrice: 0, expectedMinutes: 1 }],
      },
    );
    setOpen(true);
  };
  return (
    <>
      <PageHeading
        eyebrow="MASTER DATA / PROCESS"
        title={t("产品与工艺")}
        description={t(
          "定义产品标准与加工顺序。工单创建时保存工艺快照，历史计价有据可查。",
        )}
        action={
          can(user, "products:write", ["manager"]) && (
            <Space wrap>
              <ProductionSetup />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => edit()}
              >
                {t("新建产品")}
              </Button>
            </Space>
          )
        }
      />
      <Panel>
        <SearchBar onSearch={filters.search} refresh={list.refetch} />
        <DataTable
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          empty={t("先创建一个产品，定义它的加工步骤。")}
          columns={[
            {
              title: t("产品"),
              key: "product",
              render: (_, r) => (
                <div className="cell-stack">
                  <strong>{r.name}</strong>
                  <span className="mono">{r.code}</span>
                </div>
              ),
            },
            { title: t("单位"), dataIndex: "unit", width: 90 },
            { title: t("启用"), render: (_, r) => t(r.active ? "是" : "否") },
            {
              title: t("加工步骤"),
              render: (_, r) => (
                <div className="step-chips">
                  {r.steps?.map((s: any, i: number) => (
                    <Tag key={i}>
                      {i + 1}. {s.name}
                    </Tag>
                  ))}
                </div>
              ),
            },
            {
              title: t("标准计件单价"),
              render: (_, r) =>
                money(
                  r.steps?.reduce(
                    (sum: number, s: any) => sum + Number(s.unitPrice),
                    0,
                  ),
                ),
            },
            { title: t("安全库存"), dataIndex: "safetyStock", render: number },
            {
              title: t("操作"),
              width: 140,
              render: (_, r) => (
                <Space wrap>
                  <ProductRoutes product={r} />
                  <ProductAvailability product={r} />
                  <Button type="link" onClick={() => edit(r)}>
                    {can(user, "products:write", ["manager"])
                      ? t("编辑工艺")
                      : t("查看工艺")}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Panel>
      <Drawer
        title={editing ? t("产品与工艺") : t("新建产品")}
        width={680}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          can(user, "products:write", ["manager"]) && (
            <Button
              type="primary"
              loading={action.isPending}
              onClick={() => form.submit()}
            >
              {t("保存产品")}
            </Button>
          )
        }
      >
        <Form
          name="product-editor"
          layout="vertical"
          form={form}
          disabled={!can(user, "products:write", ["manager"])}
          onFinish={async (v) => {
            await action.mutateAsync({
              path: editing ? `/products/${editing.id}` : "/products",
              method: editing ? "PATCH" : "POST",
              data: {
                ...v,
                steps: v.steps.map(productionStepPayload),
                ...(editing ? { revision: editing.revision } : {}),
              },
            });
            setOpen(false);
          }}
        >
          <GridRow gutter={16}>
            <Col span={12}>
              <Form.Item
                name="code"
                label={t("产品编号")}
                rules={[{ required: true }]}
              >
                <Input placeholder={t("例如 P-001")} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label={t("产品名称")}
                rules={[{ required: true }]}
              >
                <Input placeholder={t("输入产品名称")} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="unit"
                label={t("计量单位")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="safetyStock" label={t("安全库存")}>
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </GridRow>
          <ProductDetailFields />
          <Divider>{t("工艺路线")}</Divider>
          <p className="muted">
            {t("从上到下依次流转；当前工序全部完工后，下一工序才能收料。")}
          </p>
          <Form.List
            name="steps"
            rules={[
              {
                validator: async (_, v) => {
                  if (!v?.length) throw new Error(t("至少添加一道工序"));
                },
              },
            ]}
          >
            {(fields, { add, remove, move }, { errors }) => (
              <>
                <div className="process-edit-list">
                  {fields.map((field, i) => (
                    <div className="process-edit-row" key={field.key}>
                      <div className="process-number">{i + 1}</div>
                      <div className="process-edit-fields">
                        <Form.Item
                          name={[field.name, "name"]}
                          label={t("工序名称")}
                          rules={[{ required: true }]}
                        >
                          <Input placeholder={t("例如 精加工")} />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "unitPrice"]}
                          label={t("单价（元/件）")}
                          rules={[{ required: true }]}
                        >
                          <InputNumber
                            min={0}
                            precision={2}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, "expectedMinutes"]}
                          label={t("标准工时（分钟）")}
                          rules={[{ required: true }]}
                        >
                          <InputNumber min={0.01} style={{ width: "100%" }} />
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
                      </div>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t("删除工序")}
                        onClick={() => remove(field.name)}
                      />
                    </div>
                  ))}
                </div>
                <Form.ErrorList errors={errors} />
                <Button
                  block
                  type="dashed"
                  icon={<PlusOutlined />}
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
    </>
  );
}
export function SalesOrders() {
  useLocale();
  const filters = useFilters();
  const list = useList("/sales-orders", filters.params);
  const products = useOptions("/products");
  const customers = useOptions("/resources/customers");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const action = useAction(t("销售订单已创建"));
  const user = useUser();
  return (
    <>
      <PageHeading
        eyebrow="SALES / DELIVERY"
        title={t("销售订单")}
        description={t("从客户需求出发，衔接生产计划与成品交付。")}
        action={
          can(user, "sales-orders:write", ["manager"]) && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setOpen(true);
              }}
            >
              {t("新建订单")}
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
          empty={t("暂无销售订单，创建订单开始安排生产。")}
          columns={[
            {
              title: t("订单编号"),
              dataIndex: "code",
              render: (v, r) => (
                <Button
                  className="table-link mono"
                  type="link"
                  onClick={async () =>
                    setDetail(await api(`/sales-orders/${r.id}`))
                  }
                >
                  {v}
                </Button>
              ),
            },
            { title: t("订单名称"), dataIndex: "name" },
            {
              title: t("优先级"),
              render: (_, r) => t(r.priority === "urgent" ? "加急" : "正常"),
            },
            { title: t("客户"), dataIndex: "customerName" },
            {
              title: t("订单备注"),
              dataIndex: "notes",
              ellipsis: true,
              render: (v) => v || "—",
            },
            { title: t("交付日期"), dataIndex: "dueDate", render: dateOnly },
            {
              title: t("状态"),
              dataIndex: "status",
              render: (v) => <Status value={v} />,
            },
            { title: t("创建时间"), dataIndex: "createdAt", render: dateOnly },
          ]}
        />
      </Panel>
      <Drawer
        title={t("新建销售订单")}
        width={640}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button
            type="primary"
            loading={action.isPending}
            onClick={() => form.submit()}
          >
            {t("创建订单")}
          </Button>
        }
      >
        <Form
          name="sales-order-editor"
          layout="vertical"
          form={form}
          initialValues={{ items: [{ quantity: 1, unitPrice: 0 }] }}
          onFinish={async (v) => {
            await action.mutateAsync({ path: "/sales-orders", data: v });
            setOpen(false);
          }}
        >
          <Form.Item name="name" label={t("订单名称")}>
            <Input />
          </Form.Item>
          <Form.Item name="priority" label={t("优先级")} initialValue="normal">
            <Select
              options={[
                { value: "normal", label: t("正常") },
                { value: "urgent", label: t("加急") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="customerId"
            label={t("客户")}
            rules={[{ required: true }]}
          >
            <Select
              loading={customers.isLoading}
              notFoundContent={<OptionsEmpty query={customers} />}
              showSearch
              optionFilterProp="label"
              placeholder={t("选择客户")}
              options={customers.data?.items.map((r) => ({
                label: r.name,
                value: r.id,
              }))}
            />
          </Form.Item>
          <Form.Item name="dueDate" label={t("计划交付日期")}>
            <Input type="date" />
          </Form.Item>
          <Divider>{t("订单产品")}</Divider>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <div className="order-item-edit" key={f.key}>
                    <Form.Item
                      name={[f.name, "productId"]}
                      label={t("产品")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        loading={products.isLoading}
                        notFoundContent={<OptionsEmpty query={products} />}
                        showSearch
                        optionFilterProp="label"
                        options={products.data?.items
                          .filter((r) => r.active)
                          .map((r) => ({
                            label: `${r.code} · ${r.name}`,
                            value: r.id,
                          }))}
                      />
                    </Form.Item>
                    <div className="form-inline">
                      <Form.Item
                        name={[f.name, "quantity"]}
                        label={t("数量")}
                        rules={[{ required: true }]}
                      >
                        <InputNumber min={1} precision={0} />
                      </Form.Item>
                      <Form.Item
                        name={[f.name, "unitPrice"]}
                        label={t("销售单价（元）")}
                      >
                        <InputNumber min={0} precision={2} />
                      </Form.Item>
                      <Button
                        danger
                        type="text"
                        icon={<DeleteOutlined />}
                        disabled={fields.length === 1}
                        onClick={() => remove(f.name)}
                      />
                    </div>
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => add({ quantity: 1, unitPrice: 0 })}
                >
                  {t("添加产品")}
                </Button>
              </>
            )}
          </Form.List>
          <Form.Item name="notes" label={t("备注")} className="mt-20">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
      <Drawer
        title={detail?.code || t("订单详情")}
        width={680}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <SalesOrderMaintenance order={detail} onChange={setDetail} />
            <Descriptions
              column={2}
              items={[
                {
                  key: "customer",
                  label: t("客户"),
                  children: detail.customerName,
                },
                {
                  key: "date",
                  label: t("交付日期"),
                  children: dateOnly(detail.dueDate),
                },
                {
                  key: "status",
                  label: t("状态"),
                  children: <Status value={detail.status} />,
                },
                {
                  key: "notes",
                  label: t("备注"),
                  children: detail.notes || "—",
                },
              ]}
            />
            <Table
              className="mt-20"
              rowKey={(r: any) => r.id || r.productId}
              pagination={false}
              dataSource={detail.items || []}
              columns={[
                { title: t("产品"), dataIndex: "productName" },
                { title: t("数量"), dataIndex: "quantity", render: number },
                { title: t("单价"), dataIndex: "unitPrice", render: money },
              ]}
            />
            <Link to={`/work-orders?salesOrderId=${detail.id}`}>
              <Button
                type="primary"
                className="mt-20"
                icon={<ArrowRightOutlined />}
              >
                {t("安排生产工单")}
              </Button>
            </Link>
          </>
        )}
      </Drawer>
    </>
  );
}
export function WorkOrders() {
  useLocale();
  const filters = useFilters();
  const list = useList("/work-orders", filters.params);
  const products = useOptions("/products");
  const orders = useOptions("/sales-orders");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const selectedProduct = Form.useWatch("productId", form);
  const action = useAction(t("工单已下达"));
  const user = useUser();
  return (
    <>
      <PageHeading
        eyebrow="PRODUCTION / WORK ORDERS"
        title={t("生产工单")}
        description={t(
          "从第一道工序到最终入库，进度、质量与计件成本一目了然。",
        )}
        action={
          can(user, "work-orders:write", ["manager"]) && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  quantity: 100,
                  priority: "normal",
                  salesOrderId:
                    new URLSearchParams(window.location.search).get(
                      "salesOrderId",
                    ) || undefined,
                });
                setOpen(true);
              }}
            >
              {t("下达工单")}
            </Button>
          )
        }
      />
      <Panel>
        <SearchBar onSearch={filters.search} refresh={list.refetch}>
          <Select
            allowClear
            placeholder={t("全部状态")}
            value={filters.status}
            onChange={filters.filter}
            style={{ width: 140 }}
            options={[
              { value: "pending", label: t("待开始") },
              { value: "working", label: t("生产中") },
              { value: "complete", label: t("已完工") },
              { value: "closed", label: t("已关闭") },
            ]}
          />
        </SearchBar>
        <DataTable
          query={list}
          onPage={filters.setPage}
          page={filters.page}
          empty={t("暂无生产工单。选择产品、确定数量，即可下达生产。")}
          columns={[
            {
              title: t("工单 / 产品"),
              key: "order",
              width: 240,
              render: (_, r) => (
                <div className="cell-stack">
                  <Link className="mono" to={`/work-orders/${r.id}`}>
                    {r.code}
                  </Link>
                  <span>{r.productName}</span>
                </div>
              ),
            },
            {
              title: t("生产进度"),
              width: 190,
              render: (_, r) => (
                <div className="progress-cell">
                  <div>
                    <strong>{number(r.completedQuantity)}</strong>
                    <span>
                      {" "}
                      / {number(r.quantity)} {t("件")}
                    </span>
                  </div>
                  <Progress
                    size="small"
                    percent={Math.min(
                      100,
                      Math.round(
                        (Number(r.completedQuantity || 0) /
                          Number(r.quantity || 1)) *
                          100,
                      ),
                    )}
                    showInfo={false}
                    strokeColor="#378f7c"
                  />
                </div>
              ),
            },
            {
              title: t("状态"),
              dataIndex: "status",
              render: (v) => <Status value={v} />,
            },
            {
              title: t("优先级"),
              dataIndex: "priority",
              render: (v) =>
                ["urgent", "high"].includes(v) ? (
                  <Tag color="orange">{t("加急")}</Tag>
                ) : (
                  <span className="muted">{t("正常")}</span>
                ),
            },
            { title: t("计划交期"), dataIndex: "dueDate", render: dateOnly },
            {
              title: t("操作"),
              width: 140,
              render: (_, r) => (
                <Link to={`/work-orders/${r.id}`}>
                  {t("查看工序")} <ArrowRightOutlined />
                </Link>
              ),
            },
          ]}
        />
      </Panel>
      <Drawer
        title={t("下达生产工单")}
        width={520}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button
            type="primary"
            loading={action.isPending}
            onClick={() => form.submit()}
          >
            {t("下达工单")}
          </Button>
        }
      >
        <div className="info-note">
          {t(
            "创建后会保存当前产品工艺与计件单价，后续修改产品不会改变这张工单。",
          )}
        </div>
        <Form
          name="work-order-editor"
          layout="vertical"
          form={form}
          onFinish={async (v) => {
            await action.mutateAsync({ path: "/work-orders", data: v });
            setOpen(false);
          }}
        >
          <Form.Item
            name="productId"
            label={t("生产产品")}
            rules={[{ required: true }]}
          >
            <Select
              loading={products.isLoading}
              notFoundContent={<OptionsEmpty query={products} />}
              showSearch
              optionFilterProp="label"
              placeholder={t("选择产品")}
              onChange={() => form.setFieldValue("routeId", undefined)}
              options={products.data?.items
                .filter((r) => r.active)
                .map((r) => ({
                  label: `${r.code} · ${r.name}`,
                  value: r.id,
                }))}
            />
          </Form.Item>
          <RouteSelect productId={selectedProduct} />
          <Form.Item name="salesOrderId" label={t("关联销售订单")}>
            <Select
              loading={orders.isLoading}
              notFoundContent={<OptionsEmpty query={orders} />}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("可选")}
              options={orders.data?.items.map((r) => ({
                label: `${r.code} · ${r.customerName || ""}`,
                value: r.id,
              }))}
            />
          </Form.Item>
          <GridRow gutter={16}>
            <Col span={12}>
              <Form.Item
                name="quantity"
                label={t("生产数量")}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label={t("优先级")}>
                <Select
                  options={[
                    { value: "normal", label: t("正常") },
                    { value: "urgent", label: t("加急") },
                  ]}
                />
              </Form.Item>
            </Col>
          </GridRow>
          <Form.Item name="dueDate" label={t("计划交付日期")}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="notes" label={t("生产备注")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
export function WorkOrderDetail() {
  useLocale();
  const { id } = useParams();
  const query = useQuery({
    queryKey: ["/work-orders", id],
    queryFn: () => api<Row>(`/work-orders/${id}`),
  });
  const user = useUser();
  if (query.error)
    return <QueryError error={query.error} retry={query.refetch} />;
  const data = query.data;
  if (!data)
    return (
      <Panel>
        <div className="loading-block">{t("正在加载工单…")}</div>
      </Panel>
    );
  return (
    <>
      <Link to="/work-orders" className="back-link">
        <ArrowLeftOutlined /> {t("返回生产工单")}
      </Link>
      <PageHeading
        eyebrow="WORK ORDER DETAIL"
        title={data.code}
        description={`${data.productName} · ${data.notes || t("每道工序的执行与审核记录，保存在这里。")}`}
        action={
          <Space wrap>
            <WorkOrderDelete
              work={data}
              onDone={() => {
                window.location.assign("/work-orders");
              }}
            />
            <NativePrint
              label={{
                code: data.code,
                productName: data.productName,
                quantity: data.quantity,
              }}
            />
            {can(user, "work-orders:write", ["manager"]) &&
              ["pending", "working"].includes(data.status) && (
                <ReasonAction
                  label={t("关闭工单")}
                  path={`/work-orders/${id}/close`}
                  danger
                  title={t("关闭这张生产工单")}
                />
              )}
            <Link to={`/station?workOrderId=${id}`}>
              <Button type="primary" icon={<ScanOutlined />}>
                {t("进入工作站")}
              </Button>
            </Link>
          </Space>
        }
      />
      <div className="detail-summary">
        <DetailValue label={t("工单状态")}>
          <Status value={data.status} />
        </DetailValue>
        <DetailValue label={t("计划数量")}>
          {number(data.quantity)} <small>{t("件")}</small>
        </DetailValue>
        <DetailValue label={t("合格完工")}>
          {number(
            data.completedQuantity ?? data.tasks?.at(-1)?.completedQuantity,
          )}{" "}
          <small>{t("件")}</small>
        </DetailValue>
        <DetailValue label={t("交付日期")}>
          {dateOnly(data.dueDate)}
        </DetailValue>
      </div>
      <Panel
        title={t("工艺路线")}
        description={t("物理完工推进工序，报工审核确认计件工资。")}
      >
        <div className="route-timeline">
          {data.tasks?.map((task: Row, i: number) => (
            <div
              className={`route-step ${task.status === "complete" ? "done" : ""}`}
              key={task.id}
            >
              <div className="route-node">{i + 1}</div>
              <div className="route-step-main">
                <div className="route-step-title">
                  <strong>{task.name}</strong>
                  <Status value={task.status} />
                </div>
                <p>
                  {t("实际完工 {completed} / {planned} 件", {
                    completed: number(task.completedQuantity),
                    planned: number(data.quantity),
                  })}
                </p>
                <div className="muted">
                  {t("计件单价 {price} / 件 · 标准工时 {minutes} 分钟", {
                    price: money(task.unitPrice),
                    minutes: number(task.expectedMinutes),
                  })}
                </div>
                <TaskAssignment task={task} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <div className="mt-20">
        <Panel
          title={t("报工记录")}
          description={t("从收料到审核，追踪每一次生产交接。")}
        >
          <Table<Row>
            rowKey="id"
            dataSource={data.reports || []}
            pagination={false}
            scroll={{ x: 600 }}
            columns={[
              { title: t("工序"), dataIndex: "taskName" },
              { title: t("操作员"), dataIndex: "workerName" },
              {
                title: t("收料"),
                dataIndex: "receivedQuantity",
                render: number,
              },
              { title: t("完工"), dataIndex: "quantity", render: number },
              {
                title: t("详情"),
                render: (_, r) => <ReportEquipment report={r} />,
              },
              {
                title: t("状态"),
                dataIndex: "status",
                render: (v) => <Status value={v} />,
              },
            ]}
            locale={{
              emptyText: t("还没有报工记录，可在车间工作站收料开工。"),
            }}
          />
        </Panel>
      </div>
      <div className="mt-20">
        <Panel title={t("报废记录")}>
          <Table<Row>
            rowKey="id"
            dataSource={data.scraps || []}
            pagination={false}
            scroll={{ x: 500 }}
            columns={[
              { title: t("工序"), dataIndex: "taskName" },
              { title: t("数量"), dataIndex: "quantity", render: number },
              { title: t("原因"), dataIndex: "reason" },
              {
                title: t("状态"),
                dataIndex: "status",
                render: (v) => <Status value={v} />,
              },
            ]}
            locale={{ emptyText: t("暂无报废记录") }}
          />
        </Panel>
      </div>
    </>
  );
}
