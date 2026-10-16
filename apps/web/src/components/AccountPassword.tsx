import { useState } from "react";
import { Button, Form, Input } from "antd";
import { Modal } from "./LocalizedOverlays";
import { api } from "../api";
import { t, useLocale } from "../i18n";
import { useUser } from "../auth-context";
export function AccountPassword() {
  useLocale();
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm();
  return (
    <>
      <Button
        type="text"
        onClick={() => {
          form.resetFields();
          setError("");
          setOpen(true);
        }}
      >
        {t("修改密码")}
      </Button>
      <Modal
        title={t("修改密码")}
        open={open}
        onCancel={() => setOpen(false)}
        confirmLoading={busy}
        onOk={() => form.submit()}
        okText={t("保存")}
        cancelText={t("取消")}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            setError("");
            try {
              await api(`/users/${user.id}/password`, {
                method: "POST",
                body: JSON.stringify(values),
              });
              window.location.assign("/");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item
            name="currentPassword"
            label={t("当前密码")}
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
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
          {error && <p role="alert">{t(error)}</p>}
        </Form>
      </Modal>
    </>
  );
}
