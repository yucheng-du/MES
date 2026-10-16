import {
  managementResources,
  enhanceManagementDefinitions,
} from "./management.js";
export type Role =
  "admin" | "manager" | "operator" | "quality" | "warehouse" | "viewer";
export const roleLabels: Record<Role, string> = {
  admin: "系统管理员",
  manager: "生产主管",
  operator: "操作员",
  quality: "质量检验员",
  warehouse: "仓库管理员",
  viewer: "只读访客",
};
export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  active?: boolean;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "reference"
  | "boolean"
  | "files"
  | "references"
  | "rows";
export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  min?: number;
  options?: { label: string; value: string }[];
  resource?: string;
  unit?: string;
  fields?: FieldDefinition[];
  max?: number;
  integer?: boolean;
  readOnly?: boolean;
  format?: "https";
}
export interface ResourceDefinition {
  key: string;
  title: string;
  group: string;
  description: string;
  fields: FieldDefinition[];
  workflow: boolean;
  writeRoles: Role[];
  workflowKind?:
    | "purchase"
    | "hours"
    | "checklist"
    | "repair"
    | "execution"
    | "task"
    | "mold-maintenance"
    | "tool-maintenance"
    | "app-version";
}
export interface ResourceRecord {
  id: string;
  code?: string;
  name: string;
  status: string;
  data: Record<string, unknown>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export const statusLabels: Record<string, string> = {
  draft: "草稿",
  submitted: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  active: "启用",
  archived: "已归档",
  pending: "待开始",
  waiting: "待接收",
  queued: "待前序",
  received: "已收料",
  working: "加工中",
  in_progress: "进行中",
  completed: "已完成",
  closed: "已关闭",
  cancelled: "已取消",
  open: "待处理",
  resolved: "已解决",
  complete: "已完工",
  ready: "待收料",
  blocked: "待前序",
};
const field = (
  key: string,
  label: string,
  type: FieldType = "text",
  extra: Partial<FieldDefinition> = {},
): FieldDefinition => ({ key, label, type, ...extra });
const ref = (key: string, label: string, resource: string, required = false) =>
  field(key, label, "reference", { resource, required });
const qty = (key: string, label: string, required = false, unit?: string) =>
  field(key, label, "number", { min: 0, required, unit });
const note = field("notes", "备注", "textarea");
const standard: Role[] = ["admin", "manager"];
const resource = (
  key: string,
  title: string,
  group: string,
  description: string,
  fields: FieldDefinition[],
  workflow = false,
  writeRoles: Role[] = standard,
): ResourceDefinition => ({
  key,
  title,
  group,
  description,
  fields,
  workflow,
  writeRoles,
});
const maintenanceFields = [
  ref("deviceId", "设备", "devices"),
  ref("assigneeId", "负责人", "users"),
  field("scheduledDate", "计划日期", "date"),
  field("description", "作业内容", "textarea", { required: true }),
  note,
];
export const resourceDefinitions: ResourceDefinition[] = [
  resource(
    "customers",
    "客户档案",
    "业务往来",
    "统一管理客户联系方式和交付信息",
    [
      field("contact", "联系人"),
      field("phone", "联系电话"),
      field("address", "交货地址"),
      note,
    ],
  ),
  resource("suppliers", "供应商", "业务往来", "采购供应商及其联系方式", [
    field("contact", "联系人"),
    field("phone", "联系电话"),
    field("address", "地址"),
    field("qualification", "资质说明"),
    note,
  ]),
  resource("departments", "部门", "基础资料", "组织与班组基础资料", [
    field("manager", "负责人"),
    note,
  ]),
  resource(
    "materials",
    "原材料",
    "物料仓储",
    "原材料规格、单位与库存预警",
    [
      field("specification", "规格型号"),
      field("unit", "单位", "text", { required: true }),
      qty("safetyStock", "安全库存"),
      ref("supplierId", "默认供应商", "suppliers"),
      note,
    ],
    false,
    ["admin", "manager", "warehouse"],
  ),
  resource(
    "auxiliary-materials",
    "辅料",
    "物料仓储",
    "生产辅料的分类和领用管理",
    [
      field("category", "分类"),
      field("unit", "单位", "text", { required: true }),
      qty("safetyStock", "安全库存"),
      note,
    ],
    false,
    ["admin", "manager", "warehouse"],
  ),
  resource("devices", "设备台账", "设备现场", "设备身份、采集编号和维护责任", [
    field("model", "型号"),
    field("deviceNo", "采集设备编号"),
    field("location", "位置"),
    ref("managerId", "负责人", "users"),
    field("networked", "已接入采集", "boolean"),
    field("purchasedDate", "购置日期", "date"),
    note,
  ]),
  resource("workstations", "工位", "设备现场", "扫码作业的固定工位与设备", [
    field("location", "车间位置"),
    ref("deviceId", "设备", "devices"),
    field("processName", "适用工序"),
    note,
  ]),
  resource("molds", "模具", "设备现场", "模具寿命与维护台账", [
    field("model", "规格型号"),
    qty("lifeLimit", "寿命上限", false, "次"),
    qty("usedCount", "已用次数", false, "次"),
    ref("managerId", "负责人", "users"),
    note,
  ]),
  resource("tools", "工装刀具", "设备现场", "工装刀具保管与维护", [
    field("category", "类型"),
    field("specification", "规格"),
    ref("managerId", "保管人", "users"),
    qty("quantity", "数量"),
    note,
  ]),
  resource(
    "purchase-orders",
    "采购申请",
    "采购管理",
    "物料采购申请、审核及交期跟踪",
    [
      ref("supplierId", "供应商", "suppliers", true),
      ref("materialId", "原材料", "materials", true),
      qty("quantity", "采购数量", true),
      qty("unitPrice", "采购单价", true, "元"),
      field("dueDate", "要求到货日期", "date"),
      note,
    ],
    true,
    ["admin", "manager", "warehouse"],
  ),
  resource(
    "purchase-receipts",
    "物料入库",
    "物料仓储",
    "到货数量、来源及收货确认",
    [
      ref("purchaseOrderId", "采购申请", "purchase-orders"),
      ref("materialId", "原材料", "materials", true),
      qty("quantity", "入库数量", true),
      field("receivedDate", "到货日期", "date", { required: true }),
      note,
    ],
    true,
    ["admin", "manager", "warehouse"],
  ),
  resource(
    "purchase-issues",
    "物料领用",
    "物料仓储",
    "生产领料与用途追踪",
    [
      ref("materialId", "原材料", "materials", true),
      qty("quantity", "领用数量", true),
      ref("workOrderId", "工单", "work-orders"),
      ref("receiverId", "领用人", "users", true),
      note,
    ],
    true,
    ["admin", "manager", "warehouse"],
  ),
  resource(
    "auxiliary-receipts",
    "辅料入库",
    "物料仓储",
    "辅料到货与库存增加",
    [
      ref("auxiliaryMaterialId", "辅料", "auxiliary-materials", true),
      qty("quantity", "数量", true),
      note,
    ],
    true,
    ["admin", "manager", "warehouse"],
  ),
  resource(
    "auxiliary-issues",
    "辅料领用",
    "物料仓储",
    "辅料领用及责任人",
    [
      ref("auxiliaryMaterialId", "辅料", "auxiliary-materials", true),
      qty("quantity", "数量", true),
      ref("receiverId", "领用人", "users", true),
      note,
    ],
    true,
    ["admin", "manager", "warehouse"],
  ),
  resource(
    "purchase-comparisons",
    "采购比价",
    "采购管理",
    "采购选型的价格与交期依据",
    [
      ref("materialId", "物料", "materials"),
      ref("supplierId", "供应商", "suppliers"),
      qty("quotedPrice", "报价", true, "元"),
      field("deliveryDays", "交期天数", "number", { min: 0 }),
      field("conclusion", "比价结论", "textarea"),
      note,
    ],
    true,
  ),
  resource(
    "reimbursements",
    "采购报销",
    "采购管理",
    "采购费用的申请与审核",
    [
      ref("purchaseOrderId", "采购申请", "purchase-orders"),
      ref("applicantId", "申请人", "users"),
      qty("amount", "金额", true, "元"),
      field("invoiceNumber", "发票号码"),
      note,
    ],
    true,
  ),
  resource(
    "inspections",
    "质量检验",
    "质量管理",
    "来料、过程和成品检验记录",
    [
      field("inspectionType", "检验类型", "select", {
        required: true,
        options: [
          { label: "来料", value: "incoming" },
          { label: "过程", value: "process" },
          { label: "成品", value: "finished" },
        ],
      }),
      ref("workOrderId", "工单", "work-orders"),
      ref("productId", "产品", "products"),
      qty("sampleQuantity", "抽检数", true),
      qty("defectQuantity", "不合格数", true),
      field("result", "结论", "select", {
        required: true,
        options: [
          { label: "合格", value: "pass" },
          { label: "不合格", value: "fail" },
          { label: "让步接收", value: "concession" },
        ],
      }),
      field("description", "检验内容", "textarea"),
      note,
    ],
    true,
    ["admin", "manager", "quality"],
  ),
  resource(
    "maintenance-plans",
    "保养计划",
    "设备现场",
    "设备周期保养与责任安排",
    [...maintenanceFields, qty("intervalDays", "周期", false, "天")],
    true,
  ),
  resource(
    "maintenance-records",
    "保养记录",
    "设备现场",
    "保养执行结果和异常处理",
    [
      ...maintenanceFields,
      ref("planId", "保养计划", "maintenance-plans"),
      field("result", "执行结果", "textarea"),
    ],
    true,
    ["admin", "manager", "operator"],
  ),
  resource(
    "inspection-records",
    "设备点检",
    "设备现场",
    "设备日常点检与异常发现",
    [
      ...maintenanceFields,
      field("result", "点检结论", "select", {
        options: [
          { label: "正常", value: "normal" },
          { label: "异常", value: "abnormal" },
        ],
      }),
    ],
    true,
    ["admin", "manager", "operator"],
  ),
  resource(
    "repair-records",
    "设备维修",
    "设备现场",
    "故障、维修过程及恢复结果",
    [
      ref("deviceId", "设备", "devices", true),
      field("fault", "故障描述", "textarea", { required: true }),
      ref("assigneeId", "维修人", "users"),
      field("resolution", "处理措施", "textarea"),
      qty("cost", "费用", false, "元"),
      note,
    ],
    true,
    ["admin", "manager", "operator"],
  ),
  resource(
    "mold-maintenance",
    "模具维护",
    "设备现场",
    "模具维修保养和寿命记录",
    [
      ref("moldId", "模具", "molds", true),
      field("description", "维护内容", "textarea", { required: true }),
      qty("usedCount", "累计次数"),
      ref("assigneeId", "负责人", "users"),
      note,
    ],
    true,
  ),
  resource(
    "tool-maintenance",
    "刀具维护",
    "设备现场",
    "刀具更换、修磨与维护记录",
    [
      ref("toolId", "工装刀具", "tools", true),
      field("description", "维护内容", "textarea", { required: true }),
      ref("assigneeId", "负责人", "users"),
      note,
    ],
    true,
  ),
  resource(
    "andon-events",
    "安灯呼叫",
    "设备现场",
    "现场问题呼叫、响应与闭环",
    [
      ref("workstationId", "工位", "workstations", true),
      field("category", "问题类型", "select", {
        required: true,
        options: [
          { label: "设备故障", value: "equipment" },
          { label: "质量异常", value: "quality" },
          { label: "缺料", value: "material" },
          { label: "其他", value: "other" },
        ],
      }),
      field("description", "问题描述", "textarea", { required: true }),
      ref("assigneeId", "处理人", "users"),
      field("resolution", "解决措施", "textarea"),
    ],
    true,
    ["admin", "manager", "operator", "quality", "warehouse"],
  ),
  resource(
    "safety-incidents",
    "安全事件",
    "安全改善",
    "安全事故及隐患整改",
    [
      field("occurredAt", "发生时间", "datetime", { required: true }),
      field("location", "地点"),
      field("description", "事件经过", "textarea", { required: true }),
      ref("assigneeId", "整改责任人", "users"),
      field("resolution", "整改措施", "textarea"),
    ],
    true,
    ["admin", "manager", "operator"],
  ),
  resource(
    "safety-checklists",
    "安全检查",
    "安全改善",
    "班组安全检查与整改跟踪",
    [
      field("checkDate", "检查日期", "date", { required: true }),
      ref("departmentId", "部门", "departments"),
      field("description", "检查项目及结果", "textarea", { required: true }),
      field("resolution", "整改内容", "textarea"),
    ],
    true,
    ["admin", "manager", "operator"],
  ),
  resource(
    "safety-training",
    "安全培训",
    "安全改善",
    "安全知识、培训与考核记录",
    [
      field("trainingDate", "培训日期", "date"),
      field("participants", "参与人员"),
      field("description", "培训内容", "textarea", { required: true }),
      field("result", "考核结果", "textarea"),
    ],
    true,
  ),
  resource(
    "safety-penalties",
    "安全奖惩",
    "安全改善",
    "安全行为奖惩的审核记录",
    [
      ref("userId", "人员", "users", true),
      field("reason", "原因", "textarea", { required: true }),
      qty("amount", "金额", true, "元"),
      field("kind", "类型", "select", {
        required: true,
        options: [
          { label: "奖励", value: "reward" },
          { label: "处罚", value: "penalty" },
        ],
      }),
    ],
    true,
  ),
  resource(
    "work-tasks",
    "工作任务",
    "协同管理",
    "非工单任务安排与完成反馈",
    [
      ref("assigneeId", "负责人", "users", true),
      field("dueDate", "截止日期", "date"),
      field("description", "任务内容", "textarea", { required: true }),
      field("result", "完成情况", "textarea"),
    ],
    true,
    ["admin", "manager", "operator"],
  ),
  resource(
    "work-hours",
    "计时工单",
    "薪酬工时",
    "非计件工作的工时与审核",
    [
      ref("userId", "人员", "users", true),
      field("workDate", "工作日期", "date", { required: true }),
      qty("hours", "工时", true, "小时"),
      qty("hourlyRate", "时薪", true, "元"),
      field("description", "工作内容", "textarea", { required: true }),
    ],
    true,
    ["admin", "manager", "operator"],
  ),
  resource(
    "customer-complaints",
    "客户投诉",
    "安全改善",
    "客户质量反馈与改善闭环",
    [
      ref("customerId", "客户", "customers", true),
      ref("productId", "产品", "products"),
      field("description", "反馈内容", "textarea", { required: true }),
      field("rootCause", "原因分析", "textarea"),
      field("resolution", "改善措施", "textarea"),
    ],
    true,
  ),
  resource(
    "improvements",
    "改善建议",
    "安全改善",
    "工艺优化、降本增效与执行记录",
    [
      ref("productId", "关联产品", "products"),
      field("description", "改善方案", "textarea", { required: true }),
      qty("expectedSavings", "预期节约", false, "元"),
      field("result", "执行结果", "textarea"),
    ],
    true,
    ["admin", "manager", "operator", "quality"],
  ),
  resource(
    "documents",
    "作业文件",
    "基础资料",
    "作业指导书、检验规范及制度版本",
    [
      field("category", "类别"),
      field("version", "版本", "text", { required: true }),
      ref("productId", "产品", "products"),
      field("content", "正文", "textarea", { required: true }),
      field("attachmentIds", "文档与图片附件", "files"),
      field("effectiveDate", "生效日期", "date"),
    ],
    true,
  ),
  resource(
    "contracts",
    "合同台账",
    "业务往来",
    "销售与采购合同及履行信息",
    [
      field("type", "合同类型", "select", {
        required: true,
        options: [
          { label: "销售", value: "sales" },
          { label: "采购", value: "purchase" },
        ],
      }),
      field("counterparty", "对方单位", "text", { required: true }),
      qty("amount", "金额", true, "元"),
      field("signedDate", "签订日期", "date"),
      field("dueDate", "履约日期", "date"),
      note,
    ],
    true,
  ),
];
resourceDefinitions.push(...managementResources);
enhanceManagementDefinitions(resourceDefinitions);
export const resourceMap = Object.fromEntries(
  resourceDefinitions.map((item) => [item.key, item]),
) as Record<string, ResourceDefinition>;

export interface LabelPayload {
  code: string;
  productName: string;
  quantity: number;
  processName?: string;
}
export interface NativeResult {
  requestId: string;
  type: "scan" | "print" | "printer";
  value?: string;
  error?: string;
}
