import { Button, Form, Input, InputNumber, Select } from "antd";
import { useState } from "react";
import { useUser } from "../auth-context";
import { can, requestId, useAction, useOptions } from "../api";
import { t, useLocale } from "../i18n";
import { Drawer } from "./LocalizedOverlays";
export function PayrollAdjustment() {
  useLocale();
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const action = useAction();
  const allowed = can(user, "payroll:write", ["admin", "manager"]);
  const people = useOptions("/lookups/users", {}, allowed);
  if (!allowed) return null;
  return (
    <>
      <Button
        onClick={() => {
          form.resetFields();
          setOpen(true);
        }}
      >
        {t("人工调整")}
      </Button>
      <Drawer
        title={t("登记工资调整")}
        open={open}
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
          form={form}
          layout="vertical"
          initialValues={{
            quantity: 1,
            workDate: new Date().toISOString().slice(0, 10),
          }}
          onFinish={async (values) => {
            await action.mutateAsync({
              path: "/payroll/adjustments",
              data: { ...values, requestId: requestId() },
            });
            setOpen(false);
          }}
        >
          <Form.Item
            name="workerId"
            label={t("人员")}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={people.data?.items.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label={t("数量")}
            rules={[{ required: true }]}
          >
            <InputNumber precision={4} min={0.0001} />
          </Form.Item>
          <Form.Item
            name="unitPrice"
            label={t("调整单价")}
            help={t("正数增加工资，负数扣减工资。")}
            rules={[{ required: true }]}
          >
            <InputNumber precision={4} />
          </Form.Item>
          <Form.Item
            name="workDate"
            label={t("归属日期")}
            rules={[{ required: true }]}
          >
            <Input type="date" />
          </Form.Item>
          <Form.Item
            name="reason"
            label={t("调整原因")}
            rules={[{ required: true }]}
          >
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
