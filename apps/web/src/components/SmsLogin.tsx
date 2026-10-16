import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";
import { api } from "../api";
import { t, useLocale } from "../i18n";
import { Modal } from "./LocalizedOverlays";
export function SmsLogin({ onLogin }: { onLogin: () => void }) {
  useLocale();
  const config = useQuery({
    queryKey: ["auth-options"],
    queryFn: () => api<{ smsLogin: boolean }>("/auth/options"),
  });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  if (!config.data?.smsLogin) return null;
  return (
    <>
      <Button
        type="link"
        onClick={() => {
          form.resetFields();
          setError("");
          setSent(false);
          setOpen(true);
        }}
      >
        {t("短信验证码登录")}
      </Button>
      <Modal
        title={t("短信验证码登录")}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        okText={t("登录")}
        cancelText={t("取消")}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            setError("");
            try {
              await api("/auth/sms/login", {
                method: "POST",
                body: JSON.stringify(values),
              });
              setOpen(false);
              onLogin();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item
            name="mobile"
            label={t("手机号")}
            rules={[
              { required: true },
              { pattern: /^\+?[0-9]{6,20}$/, message: t("请输入有效手机号") },
            ]}
          >
            <Input autoComplete="tel" />
          </Form.Item>
          <Form.Item
            name="code"
            label={t("验证码")}
            rules={[
              { required: true },
              { pattern: /^[0-9]{6}$/, message: t("请输入六位验证码") },
            ]}
          >
            <Input autoComplete="one-time-code" maxLength={6} />
          </Form.Item>
          <Button
            loading={sending}
            onClick={async () => {
              try {
                const values = await form.validateFields(["mobile"]);
                setSending(true);
                setError("");
                await api("/auth/sms/request", {
                  method: "POST",
                  body: JSON.stringify(values),
                });
                setSent(true);
              } catch (e) {
                if (e instanceof Error) setError(e.message);
              } finally {
                setSending(false);
              }
            }}
          >
            {t("发送验证码")}
          </Button>
          {sent && (
            <p role="status">
              {t("如果手机号已登记，将收到验证码；一分钟后可重新发送。")}
            </p>
          )}
          {error && (
            <Alert style={{ marginTop: 12 }} type="error" title={t(error)} />
          )}
        </Form>
      </Modal>
    </>
  );
}
