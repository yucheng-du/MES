import { Form, Input, Select, Divider } from "antd";
import { useQuery } from "@tanstack/react-query";
import { api, useOptions } from "../api";
import { t, useLocale } from "../i18n";
import { Attachments } from "./Attachments";
export function PeopleFields() {
  useLocale();
  const departments = useOptions("/resources/departments");
  const permissions = useQuery({
    queryKey: ["permissions"],
    queryFn: () =>
      api<{ key: string; label: string; action: string }[]>("/permissions"),
  });
  const actions: Record<string, string> = {
    read: "查看",
    write: "编辑与办理",
    approve: "审批与确认",
  };
  const options = permissions.data?.map((p) => ({
    value: p.key,
    label: `${t(p.label)} · ${t(actions[p.action] || p.action)}`,
  }));
  return (
    <>
      <Form.Item name="departmentId" label={t("所属部门")}>
        <Select
          allowClear
          options={departments.data?.items.map((d) => ({
            value: d.id,
            label: d.name,
          }))}
        />
      </Form.Item>
      <Form.Item name="jobTitle" label={t("岗位名称")}>
        <Input />
      </Form.Item>
      <Form.Item name="mobile" label={t("联系电话")}>
        <Input />
      </Form.Item>
      <Form.Item name="allowedPermissions" label={t("额外允许权限")}>
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          options={options}
          loading={permissions.isPending}
        />
      </Form.Item>
      <Form.Item
        name="deniedPermissions"
        label={t("额外禁止权限")}
        help={t("禁止优先于额外允许；管理员保留系统恢复权限。")}
      >
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          options={options}
          loading={permissions.isPending}
        />
      </Form.Item>
      <Divider>{t("人员档案")}</Divider>
      <Form.Item name={["profile", "birth"]} label={t("出生日期")}>
        <Input type="date" />
      </Form.Item>
      <Form.Item name={["profile", "gender"]} label={t("性别")}>
        <Select
          allowClear
          options={[
            ["female", "女"],
            ["male", "男"],
            ["other", "其他"],
          ].map(([value, label]) => ({ value, label: t(label) }))}
        />
      </Form.Item>
      <Form.Item name={["profile", "identityNumber"]} label={t("证件号码")}>
        <Input />
      </Form.Item>
      <Form.Item name={["profile", "address"]} label={t("地址")}>
        <Input.TextArea />
      </Form.Item>
      <Form.Item name={["profile", "emergencyName"]} label={t("紧急联系人")}>
        <Input />
      </Form.Item>
      <Form.Item name={["profile", "emergencyPhone"]} label={t("紧急联系电话")}>
        <Input />
      </Form.Item>
      <Form.Item name={["profile", "attachmentIds"]} label={t("受限档案附件")}>
        <Attachments purpose="personnel" />
      </Form.Item>
    </>
  );
}
