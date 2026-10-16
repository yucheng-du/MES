import type {
  FieldDefinition as F,
  ResourceDefinition as R,
  Role,
} from "./index.js";
const field = (
  key: string,
  label: string,
  type: F["type"] = "text",
  extra: Partial<F> = {},
): F => ({ key, label, type, ...extra });
const ref = (key: string, label: string, resource: string, required = false) =>
  field(key, label, "reference", { resource, required });
const refs = (key: string, label: string, resource = "users") =>
  field(key, label, "references", { resource });
const n = (
  key: string,
  label: string,
  required = false,
  extra: Partial<F> = {},
) => field(key, label, "number", { min: 0, required, ...extra });
const text = (key: string, label: string, required = false) =>
  field(key, label, "textarea", { required });
const sel = (
  key: string,
  label: string,
  options: [string, string][],
  required = false,
) =>
  field(key, label, "select", {
    required,
    options: options.map(([value, label]) => ({ value, label })),
  });
const rows = (key: string, label: string, fields: F[], required = false) =>
  field(key, label, "rows", { fields, required });
const files = field("attachmentIds", "附件", "files");
const note = text("notes", "备注");
const seq = n("sequence", "排序", false, { integer: true });
const all: Role[] = ["admin", "manager", "operator", "quality", "warehouse"];
const resource = (
  key: string,
  title: string,
  group: string,
  description: string,
  fields: F[],
  workflow = false,
  writeRoles: Role[] = ["admin", "manager"],
  workflowKind?: R["workflowKind"],
): R => ({
  key,
  title,
  group,
  description,
  fields,
  workflow,
  writeRoles,
  workflowKind,
});
const checklistRows = rows(
  "items",
  "检查事项",
  [
    field("title", "检查项目", "text", { required: true }),
    text("content", "检查要求", true),
    files,
  ],
  true,
);
const itemFields = [
  ref("deviceId", "设备", "devices", true),
  field("title", "项目标题", "text", { required: true }),
  text("content", "作业要求", true),
  seq,
  files,
];
export const purchaseLineFields: F[] = [
  ref("materialId", "原材料", "materials", true),
  n("quantity", "数量", true),
  n("unitPrice", "单价", true),
  text("notes", "说明"),
];
export const managementResources: R[] = [
  resource("product-types", "产品类型", "基础资料", "产品分类与排序", [
    seq,
    note,
  ]),
  resource("device-types", "设备类型", "设备现场", "设备分类和维护模板", [
    seq,
    note,
  ]),
  resource("auxiliary-types", "辅料类型", "物料仓储", "辅料分类与排序", [
    seq,
    note,
  ]),
  resource("tool-types", "工装刀具类型", "设备现场", "刀具分类及在用数量", [
    note,
  ]),
  resource("mold-types", "模具类型", "设备现场", "模具分类及可用数量", [note]),
  resource("contract-types", "合同类别", "业务往来", "采购与销售合同分类", [
    seq,
    note,
  ]),
  resource("inspection-types", "检验类别", "质量管理", "质量检验项目分类", [
    seq,
    note,
  ]),
  resource(
    "work-hour-types",
    "工时类别",
    "薪酬工时",
    "计时工作类别和默认时薪",
    [n("hourlyRate", "默认时薪", true), seq, note],
  ),
  resource("task-types", "任务类别", "协同管理", "工作任务分类", [seq, note]),
  resource("task-subtypes", "任务子类别", "协同管理", "按任务类别维护子类别", [
    ref("typeId", "任务类别", "task-types", true),
    seq,
    note,
  ]),
  resource(
    "intention-customers",
    "意向客户",
    "业务往来",
    "销售线索、负责人和跟进阶段",
    [
      sel("priority", "优先级", [
        ["normal", "普通"],
        ["high", "高"],
        ["urgent", "紧急"],
      ]),
      sel("stage", "跟进阶段", [
        ["new", "新线索"],
        ["contacted", "已联系"],
        ["quoted", "已报价"],
        ["negotiating", "洽谈中"],
        ["won", "已成交"],
        ["lost", "已流失"],
      ]),
      field("city", "城市地区"),
      field("address", "地址"),
      field("industry", "行业"),
      field("productName", "意向产品"),
      field("website", "网站"),
      field("contact", "联系人"),
      field("phone", "联系电话"),
      ref("ownerId", "负责人", "users"),
      text("progress", "跟进说明"),
      files,
    ],
  ),
  resource(
    "incoming-inspections",
    "来料检验",
    "质量管理",
    "批次、外协、质量证明和检验结论",
    [
      field("batchNo", "批次号", "text", { required: true }),
      ref("supplierId", "供应商", "suppliers"),
      field("supplierName", "供应商名称"),
      field("outsourced", "外协来料", "boolean"),
      n("quantity", "来料数量", true),
      sel(
        "result",
        "检验结论",
        [
          ["pass", "合格"],
          ["fail", "不合格"],
          ["concession", "让步接收"],
        ],
        true,
      ),
      field("certificateIds", "质量证明附件", "files"),
      files,
      text("description", "检验内容", true),
    ],
    true,
    ["admin", "manager", "quality"],
  ),
  resource(
    "quality-rewards",
    "质量奖励",
    "质量管理",
    "质量发现奖励审核并生成工资分录",
    [
      ref("userId", "奖励人员", "users", true),
      ref("inspectionId", "质量检验", "inspections"),
      n("amount", "奖励金额", true),
      text("reason", "奖励原因", true),
      files,
    ],
    true,
    ["admin", "manager", "quality"],
  ),
  resource(
    "work-hour-orders",
    "工时申请",
    "薪酬工时",
    "申请批准、实际完工、主管确认后计薪",
    [
      ref("userId", "人员", "users", true),
      ref("typeId", "工时类别", "work-hour-types"),
      n("hourlyRate", "时薪", true),
      field("plannedStart", "计划开始时间", "datetime"),
      text("description", "工作内容", true),
      files,
    ],
    true,
    ["admin", "manager", "operator"],
    "hours",
  ),
  resource(
    "device-inspection-templates",
    "设备点检模板",
    "设备现场",
    "按设备类型维护点检事项",
    [
      ref("deviceTypeId", "设备类型", "device-types", true),
      field("title", "项目标题", "text", { required: true }),
      text("content", "作业要求", true),
      seq,
      files,
    ],
  ),
  resource(
    "device-maintenance-templates",
    "设备保养模板",
    "设备现场",
    "按设备类型维护保养事项",
    [
      ref("deviceTypeId", "设备类型", "device-types", true),
      field("title", "项目标题", "text", { required: true }),
      text("content", "作业要求", true),
      seq,
      files,
    ],
  ),
  resource(
    "device-inspection-items",
    "设备点检事项",
    "设备现场",
    "设备专用点检事项和操作资料",
    itemFields,
  ),
  resource(
    "device-maintenance-items",
    "设备保养事项",
    "设备现场",
    "设备专用保养事项和操作资料",
    itemFields,
  ),
  resource(
    "device-documents",
    "设备资料",
    "设备现场",
    "设备说明书、知识文件和版本",
    [
      ref("deviceId", "设备", "devices", true),
      sel(
        "kind",
        "资料类型",
        [
          ["instruction", "说明书"],
          ["knowledge", "知识库"],
        ],
        true,
      ),
      field("version", "版本"),
      files,
      seq,
      note,
    ],
  ),
  resource("safety-knowledge", "安全知识", "安全改善", "安全知识资料与版本", [
    text("content", "正文", true),
    files,
    seq,
  ]),
  resource(
    "safety-examinations",
    "安全考核",
    "安全改善",
    "安全考核内容、参与人员和结果",
    [
      text("content", "考核内容", true),
      refs("participantIds", "参与人员"),
      field("examDate", "考核日期", "date"),
      rows("results", "考核成绩", [
        ref("userId", "人员", "users", true),
        n("score", "成绩", true, { max: 100 }),
        text("result", "考核结果"),
      ]),
      files,
    ],
    true,
  ),
  resource(
    "safety-responsibilities",
    "安全责任制度",
    "安全改善",
    "安全责任与岗位制度",
    [text("content", "制度内容", true), files, seq],
  ),
  resource(
    "safety-regulations",
    "安全奖惩规范",
    "安全改善",
    "安全行为奖励和处罚依据",
    [text("content", "制度内容", true), files, seq],
  ),
  resource(
    "safety-accident-cases",
    "事故案例",
    "安全改善",
    "事故案例和学习确认",
    [
      sel("kind", "案例类型", [
        ["incident", "事故"],
        ["hazard", "隐患"],
      ]),
      text("content", "案例经过", true),
      field("procedureNames", "相关工序"),
      files,
    ],
  ),
  resource(
    "safety-checklist-templates",
    "安全检查模板",
    "安全改善",
    "可重复执行的安全检查清单",
    [
      sel(
        "frequency",
        "执行周期",
        [
          ["daily", "每日"],
          ["weekly", "每周"],
          ["monthly", "每月"],
          ["once", "一次"],
        ],
        true,
      ),
      refs("executorIds", "执行人员"),
      refs("checkerIds", "检查人员"),
      field("requireCheck", "需要复核", "boolean"),
      checklistRows,
      files,
    ],
  ),
  resource(
    "safety-checklist-executions",
    "安全检查执行",
    "安全改善",
    "逐项检查、证据、完工和复核",
    [
      ref("templateId", "检查模板", "safety-checklist-templates", true),
      ref("assigneeId", "执行人员", "users", true),
      field("scheduledDate", "计划日期", "date"),
      note,
    ],
    true,
    ["admin", "manager", "operator"],
    "checklist",
  ),
  resource(
    "customer-complaint-actions",
    "客诉改善措施",
    "安全改善",
    "客诉关联整改措施和执行结果",
    [
      ref("complaintId", "客户投诉", "customer-complaints", true),
      ref("assigneeId", "负责人", "users"),
      text("description", "改善措施", true),
      text("result", "执行结果"),
      files,
    ],
    true,
    ["admin", "manager", "quality"],
    "execution",
  ),
  resource(
    "product-optimizations",
    "产品优化",
    "安全改善",
    "产品问题、责任人和改善过程",
    [
      ref("productId", "产品", "products", true),
      ref("customerId", "客户", "customers"),
      ref("assigneeId", "负责人", "users", true),
      sel("priority", "优先级", [
        ["normal", "普通"],
        ["urgent", "紧急"],
      ]),
      text("description", "优化内容", true),
      files,
    ],
    true,
    ["admin", "manager", "quality"],
    "execution",
  ),
  resource(
    "product-optimization-results",
    "产品优化结果",
    "安全改善",
    "产品优化关联执行结果",
    [
      ref("optimizationId", "产品优化", "product-optimizations", true),
      text("content", "执行结果", true),
      files,
    ],
    false,
    ["admin", "manager", "quality"],
  ),
  resource(
    "process-changes",
    "工艺变更申请",
    "质量管理",
    "工艺变更、客户批准和执行过程",
    [
      ref("productId", "产品", "products", true),
      ref("customerId", "客户", "customers"),
      field("processName", "工艺名称"),
      ref("assigneeId", "负责人", "users", true),
      text("description", "变更内容", true),
      field("approvalAttachmentIds", "申请回复附件", "files"),
      files,
    ],
    true,
    ["admin", "manager", "quality"],
    "execution",
  ),
  resource(
    "process-change-records",
    "工艺变更记录",
    "质量管理",
    "关联变更申请的执行过程",
    [
      ref("changeId", "工艺变更申请", "process-changes", true),
      text("content", "执行记录", true),
      files,
    ],
    false,
    ["admin", "manager", "quality"],
  ),
  resource(
    "complaint-suggestions",
    "内部投诉建议",
    "协同管理",
    "员工意见、办理过程和回复",
    [
      field("actualName", "署名"),
      ref("assigneeId", "处理人", "users"),
      text("description", "意见内容", true),
      files,
    ],
    true,
    all,
    "execution",
  ),
  resource(
    "andon-contacts",
    "工位报警联系人",
    "设备现场",
    "按工位配置报警联络人员",
    [
      ref("workstationId", "工位", "workstations", true),
      ref("userId", "联系人", "users"),
      field("contactName", "联系人姓名"),
      field("phone", "联系电话", "text", { required: true }),
      n("timeoutSeconds", "报警延迟秒数", false, { integer: true, max: 86400 }),
      seq,
      note,
    ],
  ),
  resource(
    "app-versions",
    "应用版本",
    "基础资料",
    "Android 公开版本元数据与发布审批",
    [
      n("versionCode", "版本编号", true, { integer: true, min: 1 }),
      field("versionName", "版本名称", "text", { required: true }),
      field("downloadUrl", "下载地址", "text", {
        required: true,
        format: "https",
      }),
      text("remark", "更新说明"),
      files,
    ],
    true,
    ["admin"],
    "app-version",
  ),
];

export function enhanceManagementDefinitions(definitions: R[]) {
  const add = (key: string, fields: F[], kind?: R["workflowKind"]) => {
    const def = definitions.find((d) => d.key === key);
    if (!def) return;
    for (const f of fields)
      if (!def.fields.some((x) => x.key === f.key)) def.fields.push(f);
    if (kind) def.workflowKind = kind;
  };
  add("customers", [
    rows("contacts", "联系人列表", [
      field("name", "姓名", "text", { required: true }),
      field("phone", "联系电话"),
      field("role", "职务"),
      field("email", "电子邮箱"),
    ]),
    refs("productIds", "关联产品", "products"),
    files,
  ]);
  add("workstations", [
    field("procedureTypeId", "工序类型", "reference", {
      resource: "procedure-types",
      readOnly: true,
    }),
  ]);
  add("departments", [ref("parentId", "上级部门", "departments"), seq]);
  add("suppliers", [files]);
  add("materials", [n("unitPrice", "参考单价")]);
  add("auxiliary-materials", [
    ref("typeId", "辅料类型", "auxiliary-types"),
    field("model", "规格型号"),
    n("averageUnitPrice", "平均单价", false, { readOnly: true }),
  ]);
  add("devices", [
    ref("deviceTypeId", "设备类型", "device-types"),
    n("pieceScale", "每次加工件数", false, { integer: true, min: 1 }),
    field("factory", "制造商"),
    field("factoryContact", "厂商联系方式"),
    text("maintenanceInstruction", "保养说明"),
    n("maintenanceCycle", "保养周期天数", false, { integer: true, min: 1 }),
    field("nextMaintenanceDate", "下次保养日期", "date", { readOnly: true }),
    field("lastMaintenanceAt", "上次保养时间", "datetime", { readOnly: true }),
    field("isDigital", "数字设备", "boolean"),
    sel("lifecycle", "设备生命周期", [
      ["active", "启用"],
      ["deactivated", "停用"],
      ["scrapped", "报废"],
    ]),
    files,
  ]);
  add("molds", [
    ref("typeId", "模具类型", "mold-types"),
    n("pieceScale", "每次加工件数", false, { integer: true, min: 1 }),
    ref("mountedDeviceId", "已安装设备", "devices"),
    sel("lifecycle", "模具状态", [
      ["available", "下机"],
      ["mounted", "上机"],
      ["pending-maintenance", "待维保"],
      ["maintenance", "保养中"],
      ["internal-repair", "厂内维修中"],
      ["external-repair", "厂外维修中"],
      ["scrapped", "报废"],
    ]),
    files,
  ]);
  add("tools", [
    ref("typeId", "刀具类型", "tool-types"),
    n("maintenanceCycle", "保养周期天数", false, { integer: true, min: 1 }),
    field("nextMaintenanceDate", "下次保养日期", "date", { readOnly: true }),
    field("lastMaintenanceAt", "上次保养时间", "datetime", { readOnly: true }),
    sel("lifecycle", "刀具状态", [
      ["active", "正常"],
      ["scrapped", "报废"],
    ]),
    files,
  ]);
  add(
    "purchase-orders",
    [
      n("totalAmount", "合计金额", false, { readOnly: true }),
      rows("items", "采购明细", purchaseLineFields),
      ref("contractId", "采购合同", "contracts"),
      text("description", "采购说明"),
      files,
    ],
    "purchase",
  );
  const po = definitions.find((d) => d.key === "purchase-orders")!;
  for (const f of po.fields)
    if (["materialId", "quantity", "unitPrice"].includes(f.key))
      f.required = false;
  add("purchase-comparisons", [
    ref("purchaseOrderId", "采购申请", "purchase-orders", true),
    field("supplierName", "报价单位"),
    field("contact", "联系人"),
    field("phone", "联系电话"),
    text("description", "报价说明"),
    files,
  ]);
  add("reimbursements", [
    refs("purchaseOrderIds", "关联采购", "purchase-orders"),
    files,
  ]);
  add("purchase-receipts", [n("unitPrice", "入库单价"), files]);
  add("purchase-issues", [files]);
  add("auxiliary-receipts", [
    n("unitPrice", "入库单价"),
    ref("supplierId", "供应商", "suppliers"),
    files,
  ]);
  add("auxiliary-issues", [
    ref("departmentId", "部门", "departments"),
    text("purpose", "用途"),
    files,
  ]);
  add("contracts", [
    n("totalAmount", "合计金额", false, { readOnly: true }),
    ref("typeId", "合同类别", "contract-types"),
    ref("supplierId", "供应商", "suppliers"),
    ref("customerId", "客户", "customers"),
    rows("items", "合同明细", [
      field("productName", "产品名称", "text", { required: true }),
      field("model", "规格型号"),
      n("quantity", "数量", true),
      n("unitPrice", "单价", true),
      note,
    ]),
    files,
  ]);
  add("inspections", [
    ref("typeId", "检验类别", "inspection-types"),
    ref("reportId", "报工记录", "reports"),
    ref("inspectorId", "检验人员", "users"),
    files,
  ]);
  add("maintenance-plans", [
    { ...checklistRows, required: false },
    refs("assigneeIds", "执行人员"),
    files,
  ]);
  add("maintenance-records", [checklistRows, files], "checklist");
  add("inspection-records", [checklistRows, files], "checklist");
  for (const key of ["maintenance-records", "inspection-records"])
    for (const f of definitions.find((d) => d.key === key)!.fields)
      if (f.key === "items") f.required = false;
  add(
    "repair-records",
    [n("estimatedMinutes", "预计用时分钟"), files],
    "repair",
  );
  add(
    "mold-maintenance",
    [
      sel(
        "operation",
        "维保类型",
        [
          ["maintenance", "保养"],
          ["internal-repair", "厂内维修"],
          ["external-repair", "厂外维修"],
        ],
        true,
      ),
      n("estimatedMinutes", "预计用时分钟"),
      files,
    ],
    "mold-maintenance",
  );
  add(
    "tool-maintenance",
    [field("scheduledDate", "计划保养日期", "date"), files],
    "tool-maintenance",
  );
  add(
    "work-tasks",
    [
      ref("typeId", "任务类别", "task-types"),
      ref("subtypeId", "任务子类别", "task-subtypes"),
      refs("coAssigneeIds", "协办人员"),
      field("plannedStart", "计划开始时间", "datetime"),
      files,
    ],
    "task",
  );
  add(
    "improvements",
    [
      ref("suggestedById", "建议人", "users"),
      ref("assigneeId", "负责人", "users"),
      refs("coAssigneeIds", "协作人员"),
      n("actualSavings", "实际节约", false, { readOnly: true }),
      files,
    ],
    "execution",
  );
  add(
    "customer-complaints",
    [
      ref("assigneeId", "责任人", "users"),
      ref("operatorId", "操作人员", "users"),
      n("quantity", "涉及数量"),
      n("unitPrice", "赔偿单价"),
      files,
    ],
    "execution",
  );
  add("safety-incidents", [files]);
  add("safety-checklists", [{ ...checklistRows, required: false }, files]);
  add("safety-training", [refs("participantIds", "参与人员"), files]);
  add("safety-penalties", [
    ref("regulationId", "奖惩依据", "safety-regulations"),
    files,
  ]);
  add("andon-events", [
    sel("urgency", "紧急程度", [
      ["normal", "普通"],
      ["urgent", "紧急"],
    ]),
    files,
  ]);
  for (const key of ["devices", "molds", "tools"])
    for (const f of definitions.find((d) => d.key === key)!.fields)
      if (["lifecycle", "mountedDeviceId"].includes(f.key)) f.readOnly = true;
}
