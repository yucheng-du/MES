# API 合同

[English](API-CONTRACT.md) · 简体中文

## 共同约定

下列 HTTP 路径均相对于 `/api`。JSON 成功响应直接返回实体或 `{ items, total, page, pageSize }`；错误使用 `{ error: { code, message, details? } }`，配合真实 HTTP 状态。字段采用 camelCase，标识采用 UUID，时间采用 ISO 格式，金额计算使用十进制或整数分。列表接口按适用范围支持 `q`、`status`、`page`、`pageSize`。

认证采用 HttpOnly 会话 Cookie，浏览器请求携带 credentials。写请求校验配置的 Origin 或允许的同源请求上下文；本地开发使用 Vite 代理，生产使用 HTTPS。枚举值、标识和 API 路径不随界面语言改变。服务端系统消息及资源元数据使用中文源文，由 Web 消息目录翻译为英文显示；业务数据保留录入内容。两种语言的金额均为 CNY，不做汇率换算。

## 身份与实时更新

- `POST /auth/login` `{ username, password }` → `{ user }`。
- `POST /auth/logout`；`GET /auth/me` → `{ user }`。
- `GET /events`：已登录用户可连接 SSE，事件为 `change`，数据为 `{ resource, id? }`。客户端重新查询有权限的数据，事件不发送业务详情。
- `GET /health`：进程与数据库健康状态。`GET /dashboard`：工作台聚合数据。
- 角色为 `admin`、`manager`、`operator`、`quality`、`warehouse`、`viewer`。共享定义负责导航和授权意图，API 强制校验权限。

## 生产、库存与薪酬

- `GET/POST /products`，`PATCH /products/:id`；更新必须携带 `revision`。产品字段：`{ id, code, name, unit, safetyStock, steps: [{ name, unitPrice, expectedMinutes }] }`。
- `GET/POST /sales-orders`，`GET /sales-orders/:id`；创建参数：`{ customerId, dueDate?, items: [{ productId, quantity, unitPrice? }], notes? }`。
- `GET/POST /work-orders`，`GET /work-orders/:id`；创建参数：`{ productId, salesOrderId?, quantity, priority?, dueDate?, notes? }`。工序任务从产品步骤快照生成；详情包含 `{ ...workOrder, tasks, reports, scraps }`。
- `POST /work-orders/:id/close` `{ reason }`。
- `POST /tasks/:id/receive` `{ workstationId?, quantity?, requestId }` → 报工；`POST /reports/:id/start`；`POST /reports/:id/complete` `{ quantity, requestId }`；`POST /reports/:id/approve` `{ requestId }`；`POST /reports/:id/reject` 和 `/reports/:id/resubmit` `{ reason }`。
- `GET /reports`；`GET/POST /scraps`。报废创建参数为 `{ workOrderId, taskId?, reportId?, quantity, reason, responsibleUserId?, requestId }`。审批使用 `POST /scraps/:id/approve` 或 `/scraps/:id/reject`，携带 `requestId`；批准可选 `deductionUnitPrice` 和 `rewardUnitPrice`，驳回必须填写 `reason`。
- `GET /inventory`；`GET/POST /stock-movements` `{ productId, salesOrderId?, direction: 'in'|'out', quantity, reason?, requestId }`。流水幂等，禁止负库存，成品入库不得超过对应订单/产品可入库的完工量。演示库存也由真实流水产生。
- `GET /payroll` 支持按月份及人员筛选；审批生成带唯一来源键的工资分录。
- `GET /material-inventory` 提供原材料和辅料库存；入库/领用台账审批产生真实库存流水，禁止负库存。
- `GET /audit-logs`；管理员专用 `GET/POST /users`、`PATCH /users/:id`。密码修改使用独立的 `POST /users/:id/password` 动作。
- `GET /lookups/users` 为人员选择框提供有限的 ID、姓名，不暴露账号和薪酬。管理员/主管可全量读取工资、工时和安全奖罚记录，操作员只能读取本人，其他角色不可读取这些记录。

生产写动作由服务端校验工人归属、状态和数量。实际完工推进生产，报工批准确认计件工资；驳回不撤销物理完工。当前工序全部完工后才开放后续工序。`goodQuantity` 是扣除已批准报废后的目标良品量，`completedQuantity` 是末道工序的实际完工量，不能混用。

同一工序和已选工位只能存在一笔已收料/加工中的活动报工。工人可同时管理多个已明确分派的工位；无工位的活动报工仍限一笔。分批完工后，剩余数量继续留在本工序。此合同不提供同一道工序多人同时拆批加工。

## 报工自动审核

- `GET/PATCH /settings/auto-review`：仅管理员和生产主管；返回 `{ settings, summary, lastRun }`。`PATCH` 必须包含 `revision`、`enabled`、`delayMinutes`、`maxAmount`、`minDurationRatio`、`requireFullQuantity`。比例以 0–1 传输；设置提供 `eligibleFrom`、`activatedAt` 和更新人/时间。
- `POST /settings/auto-review/run`：仅管理员和生产主管；返回 `{ run }`，遵守当前开关、等待时间及规则，不强行批准异常记录。
- `summary` 包含 `pendingAutomatic`、`awaitingDelay`、`readyAutomatic`、`manualRequired`、`approvedAutomatically`、`approvedManually`。`lastRun` 包含状态、触发方式、开始/完成时间、规则版本、扫描/批准/转人工/跳过/错误数量及错误信息。
- 报工列表附带 `approvalMode: null|manual|automatic`、`autoReviewStatus: not_applicable|pending|manual|approved`、中文源文的 `autoReviewReasons` 和 `autoReviewEligibleAt`。`reviewMode=manual|pending_auto|automatic` 分别筛选待人工、待自动和自动已审。
- 服务器每 60 秒检查一次，并在启动时补查，无需保持网页在线。自动与人工审核共用审批事务和工资唯一来源约束。人工驳回、异常转人工标记在重新提交或规则修改后仍保留。
- 启用前完工的积压不会追溯自动通过；停用成功返回后，不会继续按旧配置批准后续记录。默认值与规则见 [自动审核说明](AUTO-REVIEW.zh-CN.md)。

## 管理台账

共享 `resourceDefinitions` 定义资源 key、中文源文标题、分组、字段、关联及工作流标记。`GET /catalog` 返回相同定义。接口包括：

- `GET/POST /resources/:key`。
- `GET/PATCH/DELETE /resources/:key/:id`。
- `POST /resources/:key/:id/transition` `{ action, revision, notes? }`。`action` 为 `submit`、`approve`、`reject`、`archive` 或 `restore`，仍须符合记录允许的状态转换。

记录包含 `{ id, code?, name, status, data, revision, createdAt, updatedAt }`。服务端校验必填、数字、选项、关联、角色、合法状态和引用完整性，客户端不能任意指定状态。更新、删除、转换必须携带当前 `revision`；删除已被引用的记录返回冲突，已批准记录使用归档而非删除。

基础资料示例（完整资源目录以 `GET /catalog` 为准）：`customers`、`suppliers`、`departments`、`materials`、`auxiliary-materials`、`devices`、`workstations`、`molds`、`tools`。

工作流台账示例：`purchase-orders`、`purchase-receipts`、`purchase-issues`、`auxiliary-receipts`、`auxiliary-issues`、`purchase-comparisons`、`reimbursements`、`inspections`、`maintenance-plans`、`maintenance-records`、`inspection-records`、`repair-records`、`mold-maintenance`、`tool-maintenance`、`andon-events`、`safety-incidents`、`safety-checklists`、`safety-training`、`safety-penalties`、`work-tasks`、`work-hours`、`customer-complaints`、`improvements`、`documents`、`contracts`。

界面依据这些定义生成统一的列表、搜索、编辑和审批视图，生产主链使用专用界面及事务逻辑。管理台账以明确定义的字段和状态为准；台账名称不表示具备完整采购、排程或维护计划引擎。

工作任务与安灯提交后，通过 `POST /resources/:key/:id/feedback` `{ revision, feedback }` 记录办理结果；仅受派人或管理员/主管可以填写。服务端写入 `result` 或 `resolution`，以及 `feedbackBy`、`feedbackAt`。批准要求本轮已有反馈；重新提交清除上一轮反馈凭据，草稿预填结果不能绕过实际办理。

## 文件与设备

- `POST /files` 接收 multipart `file`，单文件最多 10 MiB，管理员、主管、操作员、质量和仓库人员可上传业务附件。`GET /files/:id/info` 返回元数据，`GET /files/:id` 需认证下载。作业文件通过 `attachmentIds` 引用持久附件，服务端验证附件存在。
- `GET /telemetry/devices` 返回最新设备状态、事件时间及数据过期提示。`GET /telemetry/summary?day=YYYY-MM-DD` 按工厂时区计算每日状态时长。`GET /telemetry/devices/:id/events` 返回近期事件历史。
- `POST /telemetry/events` 允许管理员/主管登记 `{ deviceId, status, eventId }`。MQTT 在服务端接入，凭据不发送给浏览器；事件去重，晚到事件不覆盖较新的当前状态。详见 [设备协议](EQUIPMENT.zh-CN.md)。
- 携带 `requestId` 的动作以及携带 `eventId` 的设备事件，在响应结果不确定时沿用原键重试。参数改变代表新的意图，必须使用不同键。

## Android 桥接

通过 `window.MesNative` 检测原生能力。硬件方法：

- `scan(requestId)` 在 `window` 发出 `CustomEvent('mes-native')`，detail 为 `{ requestId, type: 'scan', value?, error? }`。
- `printLabel(requestId, json)` 接收 JSON 编码的标签 `{ code, productName, quantity, processName? }`，通过 `type: 'print'` 返回结果。
- `configurePrinter(requestId)` 打开打印机选择，通过 `type: 'printer'` 返回结果。

可选语言方法为 `window.MesNative?.setLanguage?.(locale)`，返回 `void`，调用方不提供 requestId，也无需等待回执。原生语言改变时在 `window` 发出 `CustomEvent('mes-language', { detail: { locale } })`，其中 `locale` 为 `zh-CN` 或 `en-US`。处理该事件时不要再次回传语言修改，避免循环。不提供 `setLanguage` 的较早容器仍可独立使用网页语言切换。

当前 Android 容器在页面脚本执行前，将原生语言偏好写入 Web localStorage 的 `mes.locale`，默认 `zh-CN`。网页切换同步更新原生偏好，供后续启动使用；原生切换无需重载网页。

桥接消息安全编码，仅接受配置的 HTTPS origin 和主 frame，外站不获得桥接权限；拒绝相机或蓝牙权限有可恢复错误路径。Android community 构建不包含厂商打印 SDK，打印需要可选 vendor 构建及另行提供且有授权的依赖。实际扫码和打印仍需真机验收，见 [Android 指南](../apps/android/README.zh-CN.md)。

公开行为变化时同步更新此合同，不对未列出的请求或响应结构作静默兼容猜测。

## 人员、报表与受限文件

- `GET /permissions` 返回管理员可分配的权限目录。用户的 `allowedPermissions`、`deniedPermissions` 使用稳定权限键；禁止优先，管理员保留恢复权限。显式允许不取消对象归属、状态和数量校验。
- `GET /users` 与 `/users/:id` 允许主管读取基本成员信息；人员 `profile` 仅管理员可见。创建、编辑权限和归档仅管理员执行。`DELETE /users/:id` 归档成员并撤销会话，不删除其业务历史；不能归档自己、最后一名管理员或仍在报工的成员。
- `POST /auth/refresh` 旋转会话令牌并使旧令牌失效。`GET /auth/options` 返回 `{smsLogin}`；短信的 `/auth/sms/request` 接收 `{mobile}`，`/auth/sms/login` 接收 `{mobile,code}`。网关见部署文档，接口永不返回验证码。
- `POST /files?purpose=personnel` 仅管理员可上传，人员附件的元数据与内容都受保护，不能作为公共业务附件引用。默认 `purpose=business`。
- `POST /payroll/adjustments` 接收 `{requestId,workerId,quantity,unitPrice,workDate,reason}`；正负单价表示增减工资，确认后写入独立来源分录，不直接改历史工资。
- `GET /statistics?from=YYYY-MM-DD&to=YYYY-MM-DD&view=...` 支持 `production`、`scrap`、`stock-in`、`stock-out`、`products`、`orders`、`order-items`、`procedures`、`workers`、`tasks`。生产/报废仅取已审批记录的审批日期，日期按工厂时区计算。任务 `group` 可选 `procedure/workstation/worker/device`；工序与订单明细可选 `productId/salesOrderId`。
- `GET /inventory/alerts` 返回安全库存缺口及库龄量（当前库存减去阈值天数内入库量，下限为零）。`GET /boards?view=...` 提供生产、设备、工位、库存、物料、质量/来料/点检、质量汇总、待加工汇总和出入库视图，并继续校验各自读取权限。
- 公开只读 `GET /android/latest` 返回已发布的最高版本 `{versionCode,versionName,downloadUrl,remark}` 或 `null`；仅 HTTPS 下载地址，不返回账户信息。

新增流程的资源字段、执行动作和所需状态以 `GET /catalog` 和记录详情返回的可用动作元数据为准，见[功能范围](FEATURES.zh-CN.md)。


## 管理流程执行

`GET /resources/:key/:id/activity` 返回 `{record,actions,events,items,payments,learners,related,notifications,receipts,receiptsComplete,total,canExecute}`。`actions` 元素为 `{action,label,fields}`，已按当前状态、逐人权限和责任人筛选，`fields` 使用共享 FieldDefinition 元数据。标签为中文源文，由界面翻译。

`POST /resources/:key/:id/actions/:action` 接收 `{revision,data}`，`data` 必须匹配对应动作字段，成功返回更新后的记录。后续使用新的 `revision`；过期修订返回 409。`check-item` 的 data 为 `{itemId,result,attachmentIds?}`。`stage` 和 `workflowData` 由服务端维护，客户端不能直接覆盖。可用动作覆盖付款申请/审批/支付、实际完成和确认、逐项检查、学习确认、生命周期和库存冲销；写端再次验证权限与前置条件。


## 生产流程增补

- 产品 `details` 支持 `typeId/materialId/model/unitWeight/drawingIds/customerIds/safetyStockDays`（重量克）。工序扩展 `procedureTypeId/deductionUnitPrice/rewardUnitPrice/autoComplete/operationGuide/inspectionGuide/attachmentIds`。图纸和指导附件须为业务可见附件。`POST /products/:id/archive|restore` 归档或恢复，不改历史任务快照。
- `GET/POST /production/procedure-types` 与 `PATCH /:id` 管理 `code/name/active`。`GET /production/qualifications`、`PUT /production/qualifications/:userId/:typeId` 管理 `active/validUntil`，日期含截止日。
- `GET/POST /production/routes` 管理 `{productId:UUID|null,name,steps}`；null 表示共享工艺，PATCH 带 revision。创建工单可传 `routeId`，未选时使用产品默认工艺。工单列表支持 `salesOrderId/productId`。仅未开工且无报工/报废的工单可 DELETE，关闭需原因并拒绝活动报工和未决报废。
- `PATCH /tasks/:id/assignment` 接收可空的 `workerId/workstationId/deviceId`，仅未领取任务可分派。正常领取有类型工序时，要求资质有效、工位类型匹配且在岗，设备不能处于故障、维修或停用状态。
- 收料额外支持 `workerId/forceComplete/reason`。代他人或强制完工需主管权限及纠正原因，收料和完成事务化记录并保留审计及幂等；不绕过资质与设备约束，工资留待审核。一个工人可同时操作不同指定工位；工位与任务仍各限一笔活动报工。
- `GET /production/stations` 返回在岗人员、当前报工、设备；`PATCH /production/stations/:id/config` 设置 `procedureTypeId/deviceId/idleThresholdMinutes`（1..1440，默认60），仅离岗且不忙碌时允许。`POST /production/stations/:id/on-duty|off-duty|force-off-duty|enable|disable` 办理状态，强制离岗须原因。忙碌工位不得离岗、停用或重配。`GET /production/station-logs?stationId=...` 返回事件及连续无料区间、时长与超阈值标记；外发报警由安灯接口单独配置。
- 报工列表支持 `workerId/workOrderId/taskId/reviewMode`，操作员仅能看自己的记录；`GET /reports/:id` 同样检查归属。`POST /reports/batch-review` 为 `{ids,action:'approve'|'reject',reason?}`，1..100 个不重复已完工记录，退回必填原因，整批事务化。
- 迁移104新增 `reports.deviceMetrics`。普通、纠正和配置自动完工都会在完成事务中冻结设备身份、倍率及 `[from,to)` 精确时间窗内的七态/未知时长、通电/运行秒数、状态比例/次数、通断电次数、有效周期及产量。跨边界时长按区间裁剪，周期按完成时刻和事件倍率归属。迟到事件、配置修改或重试不重写快照；旧报工及未关联设备为 null。设备采集是证据，不自动覆盖合格数量和工资。
- `GET/POST /production/scrap-types` 与 PATCH 管理 `code/name/deductible/active`。`GET/PATCH /production/settings` 使用 `revision/scrapAutoReview/scrapMaxAmount`。报废可指定发现 `reportId` 和责任 `responsibleReportId`，必须同工单，扣款奖励取任务快照。仅本人自责、同一报工、可扣款类型、正扣款率且金额在上限内才可条件自动审核；其他留人工。发现奖归发现报工的工人，不能自责自奖；已审核报工的后续责任报废通过负 `piece-adjustment` 冲销，不覆写历史分录。列表支持工单、发现报工与责任报工筛选。
- 销售单支持 `name/priority` 及明细 notes。PATCH 接收 revision 和完整期望明细，数量不得低于已分配/发货量，不得删被引用明细。`POST /sales-orders/:id/copy-items` 接收 `sourceOrderId/itemIds?/revision`，同产品合并数量、保留目标价格。`complete` 要求全部发货且无活动工单；`close` 要求原因且无活动工单；DELETE 只允许无生产及库存历史的订单。结束订单不可修改。
