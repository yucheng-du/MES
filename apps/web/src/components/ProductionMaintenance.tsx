import { useState } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
} from "antd";
import { Drawer, Modal } from "./LocalizedOverlays";
import { api, can, useAction, useOptions, type Row } from "../api";
import { useUser } from "../auth-context";
import { t, useLocale } from "../i18n";
import { ReasonAction } from "./common";
export function ProductAvailability({ product }: { product: Row }) {
  useLocale();
  const user = useUser(),
    action = useAction();
  if (!can(user, "products:write", ["manager"])) return null;
  return (
    <Popconfirm
      title={t(product.active ? "归档产品，停止下达新工单？" : "恢复产品？")}
      onConfirm={() =>
        action.mutateAsync({
          path: `/products/${product.id}/${product.active ? "archive" : "restore"}`,
          data: {},
        })
      }
    >
      <Button size="small" loading={action.isPending}>
        {t(product.active ? "归档" : "恢复")}
      </Button>
    </Popconfirm>
  );
}
export function WorkOrderDelete({
  work,
  onDone,
}: {
  work: Row;
  onDone: () => void;
}) {
  useLocale();
  const user = useUser(),
    action = useAction();
  if (work.status !== "pending" || !can(user, "work-orders:write", ["manager"]))
    return null;
  return (
    <Popconfirm
      title={t("删除这张尚未开工的工单？")}
      onConfirm={async () => {
        await action.mutateAsync({
          path: `/work-orders/${work.id}`,
          method: "DELETE",
        });
        onDone();
      }}
    >
      <Button danger loading={action.isPending}>
        {t("删除未开工工单")}
      </Button>
    </Popconfirm>
  );
}
export function SalesOrderMaintenance({
  order,
  onChange,
}: {
  order: Row;
  onChange: (row: Row | null) => void;
}) {
  useLocale();
  const user = useUser(),
    manage = can(user, "sales-orders:write", ["manager"]),
    [open, setOpen] = useState(false),
    [copy, setCopy] = useState(false),
    [source, setSource] = useState<string>(),
    [form] = Form.useForm();
  const products = useOptions("/products", {}, open),
    customers = useOptions("/resources/customers", {}, open),
    orders = useOptions("/sales-orders", {}, copy),
    action = useAction();
  if (!manage) return null;
  const refresh = async () =>
    onChange(await api<Row>(`/sales-orders/${order.id}`));
  return (
    <>
      <Space wrap>
        {order.status === "open" && (
          <>
            <Button
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  ...order,
                  dueDate: order.dueDate?.slice(0, 10),
                  items: order.items.map((r: Row) => ({
                    productId: r.productId,
                    quantity: r.quantity,
                    unitPrice: r.unitPrice,
                    notes: r.notes,
                  })),
                });
                setOpen(true);
              }}
            >
              {t("编辑订单与明细")}
            </Button>
            <Button
              onClick={() => {
                setSource(undefined);
                setCopy(true);
              }}
            >
              {t("复制其他订单明细")}
            </Button>
            <Popconfirm
              title={t("确认订单已全部发货并完成？")}
              onConfirm={async () => {
                await action.mutateAsync({
                  path: `/sales-orders/${order.id}/complete`,
                  data: {},
                });
                await refresh();
              }}
            >
              <Button>{t("完成订单")}</Button>
            </Popconfirm>
          </>
        )}
        <Popconfirm
          title={t("删除没有生产或库存关联的订单？")}
          onConfirm={async () => {
            await action.mutateAsync({
              path: `/sales-orders/${order.id}`,
              method: "DELETE",
            });
            onChange(null);
          }}
        >
          <Button danger>{t("删除订单")}</Button>
        </Popconfirm>
        {order.status === "open" && (
          <SalesClose order={order} refresh={refresh} />
        )}
      </Space>
      <Drawer
        title={t("编辑订单与明细")}
        open={open}
        width={650}
        onClose={() => setOpen(false)}
        extra={
          <Button loading={action.isPending} onClick={() => form.submit()}>
            {t("保存订单")}
          </Button>
        }
      >
        <Form
          layout="vertical"
          form={form}
          onFinish={async (v) => {
            const result = await action.mutateAsync({
              path: `/sales-orders/${order.id}`,
              method: "PATCH",
              data: {
                ...v,
                revision: order.revision,
                dueDate: v.dueDate || null,
                items: v.items.map((r: any) => ({
                  productId: r.productId,
                  quantity: r.quantity,
                  unitPrice: r.unitPrice,
                  notes: r.notes ?? "",
                })),
              },
            });
            onChange(result as Row);
            setOpen(false);
          }}
        >
          <Form.Item name="name" label={t("订单名称")}>
            <Input />
          </Form.Item>
          <Form.Item
            name="customerId"
            label={t("客户")}
            rules={[{ required: true }]}
          >
            <Select
              options={customers.data?.items.map((r) => ({
                value: r.id,
                label: r.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="dueDate" label={t("交付日期")}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="priority" label={t("优先级")}>
            <Select
              options={[
                { value: "normal", label: t("正常") },
                { value: "urgent", label: t("加急") },
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label={t("订单备注")}>
            <Input.TextArea />
          </Form.Item>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <fieldset
                    key={field.key}
                    style={{
                      border: "1px solid #dae5e1",
                      padding: 12,
                      marginBottom: 12,
                    }}
                  >
                    <legend>
                      {t("产品明细")} {field.name + 1}
                    </legend>
                    <Form.Item
                      name={[field.name, "productId"]}
                      label={t("产品")}
                      rules={[{ required: true }]}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={products.data?.items.map((r) => ({
                          value: r.id,
                          label: r.name,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "quantity"]}
                      label={t("数量")}
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={1} precision={0} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "unitPrice"]}
                      label={t("单价")}
                      rules={[{ required: true }]}
                    >
                      <InputNumber min={0} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, "notes"]}
                      label={t("明细备注")}
                    >
                      <Input.TextArea />
                    </Form.Item>
                    <Button
                      danger
                      disabled={fields.length <= 1}
                      onClick={() => remove(field.name)}
                    >
                      {t("删除明细")}
                    </Button>
                  </fieldset>
                ))}
                <Button
                  onClick={() => add({ quantity: 1, unitPrice: 0, notes: "" })}
                >
                  {t("添加产品明细")}
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Drawer>
      <Modal
        title={t("复制其他订单明细")}
        open={copy}
        onCancel={() => setCopy(false)}
        okButtonProps={{ disabled: !source }}
        confirmLoading={action.isPending}
        onOk={async () => {
          const result = await action.mutateAsync({
            path: `/sales-orders/${order.id}/copy-items`,
            data: { sourceOrderId: source, revision: order.revision },
          });
          onChange(result as Row);
          setCopy(false);
        }}
      >
        <p>{t("相同产品合并增加数量，已有明细的单价保留。")}</p>
        <Select
          aria-label={t("来源订单")}
          style={{ width: "100%" }}
          value={source}
          onChange={setSource}
          options={orders.data?.items
            .filter((r) => r.id !== order.id)
            .map((r) => ({
              value: r.id,
              label: `${r.code} · ${r.name || r.customerName}`,
            }))}
        />
      </Modal>
    </>
  );
}
function SalesClose({
  order,
  refresh,
}: {
  order: Row;
  refresh: () => Promise<void>;
}) {
  useLocale();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState("");
  const action = useAction();
  return (
    <>
      <Button
        danger
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
      >
        {t("关闭订单")}
      </Button>
      <Modal
        title={t("关闭订单")}
        open={open}
        onCancel={() => setOpen(false)}
        okButtonProps={{ disabled: !reason.trim() }}
        confirmLoading={action.isPending}
        onOk={async () => {
          await action.mutateAsync({
            path: `/sales-orders/${order.id}/close`,
            data: { reason },
          });
          await refresh();
          setOpen(false);
        }}
      >
        <Input.TextArea
          aria-label={t("关闭原因")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </>
  );
}
