# MES Web

[English](README.md) · 简体中文 · [项目说明](../../README.md#简体中文)

使用 React 19、TypeScript、Vite 8、Ant Design 6，React Query 管理服务器状态。业务数据来自 `/api`，没有前端演示数据替代真实写入。开发代理到 `127.0.0.1:4300`；生产构建输出 `dist`，项目部署配置使静态资源与 API 同源访问。

## 运行与验证

使用 Node.js 22.12 或以上，在仓库根目录安装工作区依赖并执行：

```bash
npm run dev
npm run typecheck -w @mes/web
npm run test:web
npm run build -w @mes/web
```

`npm run dev` 同时启动 API 与网页；已有 API 时，可用 `npm run dev -w @mes/web` 仅启动 Vite。`build` 打包前执行 TypeScript 检查。请求意图测试覆盖并发合并、网络/服务器结果不确定时重试、明确拒绝后创建新意图及设备事件 ID。浏览器流程位于根目录 `tests`，见 [测试说明](../../docs/TESTING.zh-CN.md)。

## 源码入口

- `src/App.tsx`、`src/auth-context.ts`：Cookie 会话、导航、移动端抽屉和 SSE；重连刷新缓存，断开时显示连接状态。
- `src/api.ts`、`src/intent-client.ts`：HTTP 错误、查询、写入和幂等意图。相同写入并发调用只发一次；网络错误或 5xx 后保留原 `requestId`/`eventId` 用于重试，成功或明确 4xx 后释放意图；退出清理意图。
- `src/pages/Production.tsx`：产品工艺、销售订单、工单及追溯。产品编辑使用 `revision`；工单进度使用 `completedQuantity`，`goodQuantity` 是扣除已批准报废后的目标良品量。
- `src/pages/Execution.tsx`：个人车间工作站、收料/开工/完工、报工审核和报废。工作站显示当前工人的活动报工；实际完工推进工序，审批确认计件工资。
- `src/pages/Operations.tsx`：成品出入库、薪酬、用户及审计。
- `src/pages/Resources.tsx`：依据 `@mes/shared` 字段和角色定义生成 34 类台账；提交、审批、归档、删除调用真实接口。工作任务和安灯有独立办理反馈，批准要求本轮 `feedbackAt`。台账实现已定义字段及工作流，并不意味着实现所有可能的专用管理流程。
- `src/pages/Devices.tsx`：真实设备状态、采集连接、过期提示、每日时长和手工状态登记。
- `src/components/Attachments.tsx`：受认证保护的文件上传、关联和下载。
- `src/components/common.tsx`：公共展示、操作原因及原生/浏览器标签打印。
- `src/i18n.ts`、`src/locales/*`、`src/components/LanguageSwitch.tsx`：语言状态、消息目录及切换按钮。

## 中英双语开发约定

支持 `zh-CN` 和 `en-US`，默认中文；登录页和应用顶栏提供一键切换。选择通过 localStorage 的 `mes.locale` 保存，并响应跨标签页的 storage 更新。Ant Design、日期、数字显示、文档语言及页面元信息跟随选择。金额保持 **CNY**，切换语言不换算币种，也不改变业务规则。

`t(source, params?)` 使用稳定的中文源文作为键。英文词条位于 `src/locales` 的命名导出 `commonMessages`、`productionMessages`、`managementMessages`、`serverMessages`，由 `src/i18n.ts` 合并。共用词条应保持一致，不要在不同目录添加含义冲突的重复翻译。

新增界面时：

1. 在渲染翻译文字的组件中调用 `useLocale()`，让语言变化触发重渲染。`t()` 在渲染或实际动作时求值，不要在模块初始化时求值冻结语言。
2. 在合适的消息目录补齐中文键和英文翻译。使用 `{name}` 占位符及 `t("...{name}...", { name })`，避免拼接翻译句子。
3. 在显示边界翻译共享资源标题、分组、说明、字段标签、选项标签及单位；存储键、枚举、路由、标识和请求体保持不变。
4. 只翻译系统文字。产品/客户名称、人员姓名、用户备注、录入的单位、编号和原始审计数据保留原样，作为插值传入或直接渲染；不要把任意业务数据当作翻译键。
5. 日期、数字和金额使用 `src/api.ts` 中的格式化工具。新增需要英文显示的 API 系统消息或参数化错误时，补充 `serverMessages`。
6. 执行 `npm run test:web`、类型检查及相关浏览器检查。`src/i18n.test.ts` 覆盖语言切换、插值原样保留、服务端消息翻译、资源元数据及字面翻译键覆盖；较长的英文文案和手机布局仍需视觉检查。

未知键回退到源文，保证可用，但不能代替补齐翻译。消息目录也可匹配服务端已插值的已知消息模板，在翻译系统文字时保留其中的值。

## 移动端与硬件

响应式导航、详情抽屉、横向表格及大尺寸车间动作支持电脑、平板和手机。通过 `window.MesNative` 检测 Android 能力，扫码、打印机选择和打印使用约定的消息桥。扫码超时可恢复；浏览器支持手工输入工单号，并打印含真实二维码的工单标签。

可选原生 `setLanguage(locale)` 方法将网页切换同步到 Android；原生改变时发出带 `{ locale }` 的 `mes-language`，网页应用语言但不回传。当前容器在页面脚本执行前，用原生偏好初始化网页语言。详见 [桥接合同](../../docs/API-CONTRACT.zh-CN.md#android-桥接)。

Android community 构建不包含打印 SDK，不能向厂商打印机出纸；可选 vendor 构建需另行提供有授权的依赖。相机、蓝牙、标签版面和设备兼容仍需真机验收。目前不提供离线生产写入队列。

产品、订单、工单、工位及通用引用由 `useOptions` 分页读取全部 API 记录，共享缓存，并支持在选择框按名称/编号搜索。工作站活动报工由服务端筛选当前人员后跨页读取，历史记录数量不会遮蔽在制任务。分页测试覆盖超过 100 条、服务器页大小上限及非分页 lookup 响应。SSE 中断恢复后刷新列表。
