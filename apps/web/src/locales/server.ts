export const serverMessages: Record<string, string> = {
  输入信息不正确: "Some input is invalid",
  记录已存在或任务已被领取:
    "The record already exists or the task has been claimed",
  "记录被引用，或关联记录不存在":
    "The record is referenced elsewhere or a linked record does not exist",
  业务数量或状态不符合约束: "The quantity or status violates a business rule",
  "并发操作冲突，请刷新重试":
    "Another action conflicted with this one. Refresh and retry.",
  字段格式或日期无效: "Invalid field format or date",
  "服务暂时不可用，请联系管理员":
    "Service temporarily unavailable. Contact your administrator.",
  系统: "System",
  请先登录: "Please sign in",
  没有此操作权限: "You do not have permission for this action",
  只能操作自己的报工: "You can only change your own production reports",
  密码至少12位: "Passwords must contain at least 12 characters",
  请求来源不可信: "Untrusted request origin",
  跨站请求被拒绝: "Cross-site request rejected",
  账号或密码错误: "Incorrect username or password",
  姓名不能为空: "Name is required",
  不能停用最后一位管理员: "The last administrator cannot be deactivated",
  无权修改此密码: "You cannot change this password",
  当前密码错误: "The current password is incorrect",
  金额最多两位小数: "Amounts can have at most two decimal places",
  "自动审核暂时失败，将在后续运行重试":
    "Automatic review temporarily failed and will retry on a later run",
  "自动审核已停用，本次未执行":
    "Automatic review is disabled; this run was skipped",
  "另一实例正在执行自动审核，本次已跳过":
    "Automatic review is running on another instance; this run was skipped",
  "上次执行意外中断，已完成的审核保持有效；未处理记录将在本轮重扫":
    "The previous run was interrupted. Completed approvals remain valid; remaining reports will be checked again.",
  "部分报工审核失败，工资事务已回滚；业务异常转人工，暂时故障将重试":
    "Some reviews failed and their pay transactions were rolled back. Business exceptions need manual review; temporary failures will retry.",
  "自动审核执行中断，请检查服务日志；已提交的审核保持有效":
    "Automatic review was interrupted. Check the server logs. Committed approvals remain valid.",
  "配置已更新，请刷新后重试": "Settings have changed. Refresh and retry.",
  未知台账: "Unknown record type",
  设备编码或采集编号已由其他设备使用:
    "This equipment code or telemetry ID is already in use",
  包含未知字段: "Unknown fields were provided",
  "{field}不能为空": "{field} is required",
  "{field}选项无效": "Invalid option for {field}",
  附件不能重复: "Duplicate attachments are not allowed",
  包含不存在的附件: "One or more attachments do not exist",
  记录不能引用自身: "A record cannot reference itself",
  "{field}不存在或已归档": "{field} does not exist or is archived",
  "{field}不存在": "{field} does not exist",
  数量必须大于0: "Quantity must be greater than 0",
  每日工时必须大于0且不超过24:
    "Daily hours must be greater than 0 and no more than 24",
  只能登记自己的计时工单: "You can only record your own hourly work",
  不合格数不能超过抽检数: "Rejected quantity cannot exceed the sample size",
  累计次数超过模具寿命上限: "Total cycles exceed the mold's life limit",
  采购申请尚未审批: "The purchase request has not been approved",
  入库物料与采购申请不匹配:
    "The received material does not match the purchase request",
  入库数量超出采购申请: "Received quantity exceeds the purchase request",
  领用数量超出可用库存: "Issued quantity exceeds available stock",
  该人员当天累计计时工时超过24小时:
    "This person's total hours exceed 24 for the day",
  累计使用次数不能减少: "Cumulative usage cannot decrease",
  只能查看自己的工时和奖惩:
    "You can only view your own hours and rewards or penalties",
  "记录已被其他人修改，请刷新":
    "Someone else changed this record. Refresh to continue.",
  已提交或审批的记录不可修改: "Submitted or approved records cannot be edited",
  只能修改自己的台账: "You can only edit your own records",
  "记录已被修改，请刷新": "This record has changed. Refresh to continue.",
  已审批或归档记录不可删除: "Approved or archived records cannot be deleted",
  只能删除自己的台账: "You can only delete your own records",
  此台账不支持执行反馈: "This record type does not support action feedback",
  只有受派人或主管可以填写执行反馈:
    "Only the assignee or a manager can record action feedback",
  只有已提交且尚未审批的记录可以反馈:
    "Feedback is only allowed on submitted records awaiting approval",
  当前状态不可提交: "This record cannot be submitted in its current state",
  只能提交自己的记录: "You can only submit your own records",
  仅可审核已提交记录: "Only submitted records can be reviewed",
  没有台账审核权限: "You do not have permission to review these records",
  驳回必须填写原因: "A reason is required when returning a record",
  "请先由受派人或主管填写执行反馈，再审核闭环":
    "The assignee or a manager must record action feedback before approval",
  没有归档权限: "You do not have permission to archive records",
  当前记录不可归档: "This record cannot be archived in its current state",
  仅基础资料可以恢复启用: "Only master data records can be reactivated",
  没有恢复权限: "You do not have permission to reactivate records",
  记录不存在: "Record not found",
  "相同 requestId 不得用于不同内容":
    "The same request ID cannot be reused for different content",
  请选择附件: "Select an attachment",
  "支持 PDF、PNG、JPEG、WebP、TXT、CSV、XLSX、DOCX":
    "Supported formats: PDF, PNG, JPEG, WebP, TXT, CSV, XLSX, DOCX",
  附件不能为空: "An attachment cannot be empty",
  "文件不是有效 PDF": "The file is not a valid PDF",
  "文件不是有效 PNG": "The file is not a valid PNG",
  "文件不是有效 JPEG": "The file is not a valid JPEG",
  附件不存在: "Attachment not found",
  附件存储暂不可用: "Attachment storage is temporarily unavailable",
  必须指定设备: "Select equipment",
  设备事件时间不能在未来: "Equipment events cannot have a future timestamp",
  设备不存在或已归档: "Equipment does not exist or is archived",
  事件标识已被不同内容使用:
    "This event ID was already used for different content",
  不能统计未来日期: "Cannot summarize a future date",
  "无效 MQTT 协议": "Invalid MQTT protocol",
  "生产环境 MQTT 要求 TLS；可信私网需显式开启 ALLOW_PRIVATE_MQTT":
    "Production MQTT requires TLS. A trusted private network must explicitly enable ALLOW_PRIVATE_MQTT.",
  设备采集连接异常: "Equipment telemetry connection error",
  设备消息过大: "Equipment message is too large",
  设备消息处理失败: "Unable to process the equipment message",
  设备事件未入账: "Equipment event was not recorded",
  件: "pcs",
  "产品已被修改，请刷新后重试": "The product has changed. Refresh and retry.",
  同一订单不能重复添加相同产品:
    "A product can only appear once per sales order",
  客户不存在或已归档: "Customer does not exist or is archived",
  产品不存在: "Product not found",
  订单不存在或已关闭: "Sales order does not exist or is closed",
  该产品不属于此销售订单: "This product is not part of the sales order",
  工单数量超出订单剩余需求:
    "Work order quantity exceeds the remaining sales order demand",
  产品尚未设置工艺: "No routing has been defined for this product",
  只能关闭未完工工单: "Only unfinished work orders can be closed",
  尚有正在进行的报工: "There are production reports still in progress",
  "尚有待审核报废，请先处理后关闭工单":
    "Review pending scrap before closing the work order",
  工单已结束: "The work order has ended",
  当前工序不可收料: "This operation is not ready to receive material",
  收料数量超出剩余待加工数量:
    "Received quantity exceeds the remaining quantity to process",
  工位不存在或已归档: "Workstation does not exist or is archived",
  工位不支持此工序: "This workstation does not support the operation",
  此报工不可开始: "This report cannot be started",
  此报工不在加工中: "This report is not in progress",
  请先处理待审核的报废记录: "Review pending scrap records first",
  完工数量超出剩余良品数量:
    "Completed quantity exceeds the remaining good quantity",
  仅剩余良品为零时允许零数量完工:
    "Zero completion is allowed only when no good units remain",
  仅可驳回已完工记录: "Only completed reports can be returned",
  仅可重新提交已驳回报工: "Only returned reports can be resubmitted",
  工单已关闭: "The work order is closed",
  报废数量超出剩余良品: "Scrap quantity exceeds the remaining good quantity",
  工序不属于该工单: "The operation does not belong to this work order",
  报工不属于该工单: "The report does not belong to this work order",
  报工与工序不匹配: "The report does not match the operation",
  只能报告参与过的工单:
    "You can only report on work orders you have participated in",
  责任人不存在: "Responsible person not found",
  只有主管可以确认报废奖扣金额:
    "Only a manager can confirm scrap rewards and deductions",
  报废已被处理: "This scrap record has already been reviewed",
  已关闭工单不能再审批报废: "Scrap cannot be approved for closed work orders",
  报废数量超出良品数: "Scrap quantity exceeds the good quantity",
  "已入库成品不能直接报废，请先办理库存质量处置":
    "Finished goods already in stock require an inventory quality adjustment before scrapping",
  扣款必须指定责任人: "A responsible person is required for a deduction",
  责任人与发现人为同一人时不能生成发现奖励:
    "A person cannot receive a finder reward for their own responsibility",
  订单中不存在此产品: "This product is not in the sales order",
  "入库超出已完工可入库量 {quantity}":
    "Stock receipt exceeds the completed quantity available: {quantity}",
  出库数量超出当前订单产品库存:
    "Shipment quantity exceeds stock for this order and product",
  日期无效: "Invalid date",
  "自动审核已停用，需要人工审核":
    "Automatic review is disabled; manual review is required",
  "启用前的完工积压，需要人工审核":
    "Completed before automatic review was enabled; manual review is required",
  "曾被驳回或重新提交，需要人工复核":
    "Previously returned or resubmitted; manual review is required",
  所属工单已关闭: "The linked work order is closed",
  报工人员已停用: "The reporting user's account is inactive",
  完工数量无效或为零: "Completed quantity is invalid or zero",
  开始或完工时间无效: "Invalid start or completion time",
  所属工单存在待审核或已批准的报废:
    "The work order has pending or approved scrap",
  计件金额超过自动审核上限:
    "Piecework pay exceeds the automatic approval limit",
  加工时长低于设定的标准节拍比例:
    "Processing time is below the configured standard-time ratio",
  完工数量与收料数量不一致: "Completed and received quantities differ",
  "自动审核执行失败，需要人工复核":
    "Automatic review failed; manual review is required",
  仅可审核已完工记录: "Only completed reports can be approved",
  自动批准: "Automatically approved",
  人工批准: "Manually approved",
  完工后检查: "Review after completion",
  需要人工核对: "Manual review required",
};
