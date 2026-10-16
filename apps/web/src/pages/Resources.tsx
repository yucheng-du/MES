import { FieldInput, FieldValue } from "../components/ResourceFields";
import {
  ManagementActivity,
  ManagementAlarmHistory,
  managementStageLabel,
} from "../components/ManagementActivity";
import { Drawer } from "../components/LocalizedOverlays";
import { t, useLocale } from "../i18n";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
} from "antd";
import { ArrowRightOutlined, PlusOutlined } from "@ant-design/icons";
import {
  resourceDefinitions,
  resourceMap,
  type FieldDefinition,
} from "@mes/shared";
import {
  can,
  api,
  dateOnly,
  dateTime,
  number,
  useAction,
  useList,
  useOptions,
  type Row,
} from "../api";
import { canManage, useUser } from "../auth-context";
import { Attachments, AttachmentLinks } from "../components/Attachments";
import {
  ActionGroup,
  DataTable,
  OptionsEmpty,
  PageHeading,
  Panel,
  ReasonAction,
  SearchBar,
  Status,
  useFilters,
} from "../components/common";
export default function Resources() {
  useLocale();
  const { key = "customers" } = useParams();
  const def = resourceMap[key];
  const filters = useFilters();
  const [searchParams] = useSearchParams();
  const list = useList(`/resources/${key}`, {
    ...filters.params,
    relatedTo: searchParams.get("relatedTo") ?? undefined,
  });
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [view, setView] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const action = useAction();
  if (!def)
    return (
      <Panel>
        <p>{t("没有找到对应的业务台账。")}</p>
        <Link to="/resources/customers">{t("返回客户档案")}</Link>
      </Panel>
    );
  const writable = can(user, `resources:${key}:write`, def.writeRoles);
  const approval = can(
    user,
    `resources:${key}:approve`,
    key === "app-versions"
      ? ["admin"]
      : [
          "admin",
          "manager",
          ...([
            "inspections",
            "incoming-inspections",
            "quality-rewards",
          ].includes(key)
            ? ["quality"]
            : []),
        ],
  );
  const canApprove = (r: Row) =>
    approval ||
    (def.workflowKind === "checklist" &&
      r.workflowData?.checkerIds?.includes(user.id) &&
      can(user, `resources:${key}:approve`));
  const visibleDefinitions = resourceDefinitions.filter(
    (r) =>
      can(user, `resources:${r.key}:read`) &&
      (![
        "work-hours",
        "work-hour-orders",
        "safety-penalties",
        "quality-rewards",
      ].includes(r.key) ||
        ["admin", "manager", "operator", "quality"].includes(user.role)),
  );
  const groups = [...new Set(visibleDefinitions.map((r) => r.group))];
  const edit = (r?: Row) => {
    setEditing(r || null);
    form.resetFields();
    form.setFieldsValue(
      r ? { name: r.name, code: r.code, data: r.data } : { data: {} },
    );
    setOpen(true);
  };
  const transition = async (r: Row, type: string) =>
    action.mutateAsync({
      path: `/resources/${key}/${r.id}/transition`,
      data: { action: type, revision: r.revision },
    });
  const editable = (r: Row) =>
    writable &&
    (def.workflow
      ? ["draft", "rejected"].includes(r.status)
      : r.status === "active");
  const needsFeedback = ["work-tasks", "andon-events"].includes(key);
  const canFeedback = (r: Row) =>
    needsFeedback &&
    r.status === "submitted" &&
    (can(user, `resources:${key}:write`, ["admin", "manager"]) ||
      r.data?.assigneeId === user.id);
  const hasFeedback = (r: Row) =>
    def.workflowKind === "checklist"
      ? r.stage === "completed"
      : !needsFeedback || r.stage === "completed" || Boolean(r.feedbackAt);

  return (
    <>
      <PageHeading
        eyebrow={`OPERATIONS / ${t(def.group)}`}
        title={t(def.title)}
        description={t(def.description)}
        action={
          <Space>
            {key === "devices" && (
              <Link to="/devices">
                <Button>{t("设备运行看板")}</Button>
              </Link>
            )}
            {writable && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => edit()}
              >
                {t("新建{resource}", { resource: t(def.title) })}
              </Button>
            )}
          </Space>
        }
      />
      <div className="resource-mobile-select">
        <Select
          value={key}
          onChange={(v) => window.location.assign(`/resources/${v}`)}
          options={groups.map((group) => ({
            label: t(group),
            options: visibleDefinitions
              .filter((r) => r.group === group)
              .map((r) => ({ label: t(r.title), value: r.key })),
          }))}
        />
      </div>
      <div className="resource-layout">
        <aside className="resource-directory">
          <div className="resource-directory-title">
            {t("业务台账目录")}
            <span>{visibleDefinitions.length}</span>
          </div>
          {groups.map((group) => (
            <div className="resource-directory-group" key={group}>
              <span>{t(group)}</span>
              {visibleDefinitions
                .filter((r) => r.group === group)
                .map((r) => (
                  <Link
                    className={r.key === key ? "active" : ""}
                    key={r.key}
                    to={`/resources/${r.key}`}
                    onClick={() => {
                      filters.search("");
                      filters.filter(undefined);
                      setView(null);
                      setOpen(false);
                    }}
                  >
                    {t(r.title)}
                    {r.key === key && <ArrowRightOutlined />}
                  </Link>
                ))}
            </div>
          ))}
        </aside>
        <div className="resource-main">
          {def.workflow && (
            <div className="workflow-hint">
              <span>{t("业务流程")}</span>
              <b>{t("登记草稿")}</b>
              <ArrowRightOutlined />
              <b>{t("提交审核")}</b>
              <ArrowRightOutlined />
              <b>{t("审核归档")}</b>
              <span>{t("每一步都有记录")}</span>
            </div>
          )}
          <Panel>
            <SearchBar onSearch={filters.search} refresh={list.refetch}>
              <Select
                allowClear
                placeholder={t("全部状态")}
                value={filters.status}
                onChange={filters.filter}
                style={{ width: 135 }}
                options={
                  def.workflow
                    ? [
                        { value: "draft", label: t("草稿") },
                        { value: "submitted", label: t("待审核") },
                        { value: "approved", label: t("已批准") },
                        { value: "rejected", label: t("已退回") },
                        { value: "archived", label: t("已归档") },
                      ]
                    : [
                        { value: "active", label: t("启用") },
                        { value: "archived", label: t("已归档") },
                      ]
                }
              />
            </SearchBar>
            {key === "andon-events" && <ManagementAlarmHistory />}
            <DataTable
              query={list}
              onPage={filters.setPage}
              page={filters.page}
              empty={t("暂无{resource}记录", { resource: t(def.title) })}
              columns={[
                {
                  title: t("名称 / 编号"),
                  width: 190,
                  render: (_, r) => (
                    <div className="cell-stack">
                      <Button
                        type="link"
                        className="table-link"
                        onClick={() => setView(r)}
                      >
                        {r.name}
                      </Button>
                      <span className="mono">{r.code || "—"}</span>
                    </div>
                  ),
                },
                ...(["materials", "auxiliary-materials"].includes(key)
                  ? [
                      {
                        title: t("当前库存"),
                        key: "currentStock",
                        render: (_: unknown, r: Row) => (
                          <strong>{number(r.currentStock)}</strong>
                        ),
                      },
                    ]
                  : []),
                ...def.fields
                  .filter((f) => f.type !== "textarea" && f.type !== "files")
                  .slice(0, 3)
                  .map((f) => ({
                    title: t(f.label),
                    key: f.key,
                    render: (_: unknown, r: Row) => (
                      <FieldValue field={f} value={r.data?.[f.key]} />
                    ),
                  })),
                {
                  title: t("状态"),
                  dataIndex: "status",
                  render: (v: string, r: Row) => (
                    <Space direction="vertical" size={2}>
                      <Status value={v} />
                      {r.stage && <Tag>{managementStageLabel(r.stage)}</Tag>}
                    </Space>
                  ),
                },
                {
                  title: t("操作"),
                  fixed: "right" as const,
                  width: 190,
                  render: (_, r) => (
                    <ActionGroup>
                      {editable(r) && (
                        <Button size="small" onClick={() => edit(r)}>
                          {t("编辑")}
                        </Button>
                      )}
                      {def.workflow &&
                        writable &&
                        ["draft", "rejected"].includes(r.status) && (
                          <Popconfirm
                            title={t("提交审核后，将暂时锁定编辑。")}
                            onConfirm={() => transition(r, "submit")}
                          >
                            <Button size="small" type="primary">
                              {t("提交")}
                            </Button>
                          </Popconfirm>
                        )}
                      {canApprove(r) && r.status === "submitted" && (
                        <>
                          <Popconfirm
                            title={t("确认批准这条记录？")}
                            onConfirm={() => transition(r, "approve")}
                          >
                            <Button
                              size="small"
                              type="primary"
                              disabled={!hasFeedback(r)}
                              title={
                                !hasFeedback(r)
                                  ? t("请先填写办理反馈")
                                  : undefined
                              }
                            >
                              {t("批准")}
                            </Button>
                          </Popconfirm>
                          <ReasonAction
                            label={t("退回")}
                            danger
                            path={`/resources/${key}/${r.id}/transition`}
                            body={{ action: "reject", revision: r.revision }}
                          />
                        </>
                      )}
                      {canFeedback(r) && (
                        <ReasonAction
                          label={
                            key === "work-tasks" ? t("执行反馈") : t("处理措施")
                          }
                          title={
                            key === "work-tasks"
                              ? t("填写执行反馈")
                              : t("填写安灯处理措施")
                          }
                          path={`/resources/${key}/${r.id}/feedback`}
                          body={{ revision: r.revision }}
                        />
                      )}
                      {writable &&
                        ["approved", "active"].includes(r.status) && (
                          <Popconfirm
                            title={t("将这条记录归档？")}
                            onConfirm={() => transition(r, "archive")}
                          >
                            <Button size="small">{t("归档")}</Button>
                          </Popconfirm>
                        )}
                      {editable(r) && (
                        <Popconfirm
                          title={t("删除这条记录？")}
                          description={t("有业务引用的记录无法删除。")}
                          onConfirm={() =>
                            action.mutateAsync({
                              path: `/resources/${key}/${r.id}`,
                              method: "DELETE",
                              data: { revision: r.revision },
                            })
                          }
                        >
                          <Button size="small" danger>
                            {t("删除")}
                          </Button>
                        </Popconfirm>
                      )}
                      {!editable(r) &&
                        !["submitted", "approved", "active"].includes(
                          r.status,
                        ) && (
                          <Button size="small" onClick={() => setView(r)}>
                            {t("查看")}
                          </Button>
                        )}
                    </ActionGroup>
                  ),
                },
              ]}
            />
          </Panel>
          <div className="resource-explainer">
            {def.workflow
              ? t("已批准的记录保留业务依据，需停止使用时请归档。")
              : t("有业务引用的数据会受到保护，历史记录可随时追溯。")}{" "}
            {t("编辑时会检查版本，防止覆盖他人的修改。")}
          </div>
        </div>
      </div>
      <Drawer
        title={t(editing ? "编辑{resource}" : "新建{resource}", {
          resource: t(def.title),
        })}
        open={open}
        onClose={() => setOpen(false)}
        width={680}
        extra={
          <Button
            type="primary"
            loading={action.isPending}
            onClick={() => form.submit()}
          >
            {t(def.workflow ? "保存草稿" : "保存")}
          </Button>
        }
      >
        <Form
          name="resource-editor"
          layout="vertical"
          form={form}
          onValuesChange={async (changed) => {
            if (key === "work-hour-orders" && changed.data?.typeId) {
              const selectedType = changed.data.typeId;
              const type = await api(
                `/resources/work-hour-types/${selectedType}`,
              ).catch(() => null);
              if (
                type &&
                form.getFieldValue(["data", "typeId"]) === selectedType
              )
                form.setFieldValue(
                  ["data", "hourlyRate"],
                  type.data.hourlyRate,
                );
            }
          }}
          onFinish={async (v) => {
            await action.mutateAsync({
              path: editing
                ? `/resources/${key}/${editing.id}`
                : `/resources/${key}`,
              method: editing ? "PATCH" : "POST",
              data: {
                ...v,
                data: {
                  ...v.data,
                  ...Object.fromEntries(
                    def.fields
                      .filter(
                        (f) =>
                          f.readOnly && editing?.data?.[f.key] !== undefined,
                      )
                      .map((f) => [f.key, editing!.data[f.key]]),
                  ),
                },
                code: v.code || undefined,
                ...(editing ? { revision: editing.revision } : {}),
              },
            });
            setOpen(false);
          }}
        >
          <Form.Item
            name="name"
            label={t("名称 / 标题")}
            rules={[{ required: true, message: t("请输入记录名称") }]}
          >
            <Input
              placeholder={t("为这条{resource}记录命名", {
                resource: t(def.title),
              })}
            />
          </Form.Item>
          <Form.Item name="code" label={t("编号（选填）")}>
            <Input />
          </Form.Item>
          {def.fields
            .filter((f) => !f.readOnly)
            .map((f) => (
              <Form.Item
                key={f.key}
                name={["data", f.key]}
                label={t(f.label)}
                valuePropName={f.type === "boolean" ? "checked" : "value"}
                rules={
                  f.required
                    ? [
                        {
                          required: true,
                          message: t("请填写{field}", { field: t(f.label) }),
                        },
                      ]
                    : []
                }
              >
                <FieldInput field={f} />
              </Form.Item>
            ))}
        </Form>
      </Drawer>
      <Drawer
        title={view?.name || t("记录详情")}
        open={!!view}
        onClose={() => setView(null)}
        width={760}
      >
        {view && (
          <>
            <Descriptions
              column={1}
              bordered
              size="small"
              items={[
                { key: "code", label: t("编号"), children: view.code || "—" },
                {
                  key: "status",
                  label: t("状态"),
                  children: <Status value={view.status} />,
                },
                ...def.fields.map((f) => ({
                  key: f.key,
                  label: t(f.label),
                  children: <FieldValue field={f} value={view.data?.[f.key]} />,
                })),
                {
                  key: "createdAt",
                  label: t("创建时间"),
                  children: dateTime(view.createdAt),
                },
                {
                  key: "updatedAt",
                  label: t("更新时间"),
                  children: dateTime(view.updatedAt),
                },
                {
                  key: "revision",
                  label: t("记录版本"),
                  children: view.revision,
                },
                ...(needsFeedback
                  ? [
                      {
                        key: "feedbackAt",
                        label: t("本轮办理反馈时间"),
                        children: dateTime(view.feedbackAt),
                      },
                    ]
                  : []),
              ]}
            />
            <ManagementActivity
              resource={key}
              recordId={view.id}
              onRecord={setView}
            />
            {canFeedback(view) && (
              <div className="mt-20">
                <ReasonAction
                  label={
                    key === "work-tasks" ? t("填写执行反馈") : t("填写处理措施")
                  }
                  path={`/resources/${key}/${view.id}/feedback`}
                  body={{ revision: view.revision }}
                  onSuccess={() => setView(null)}
                />
              </div>
            )}
            {editable(view) && (
              <Button
                type="primary"
                className="mt-20"
                onClick={() => {
                  setView(null);
                  edit(view);
                }}
              >
                {t("编辑记录")}
              </Button>
            )}
          </>
        )}
      </Drawer>
    </>
  );
}
