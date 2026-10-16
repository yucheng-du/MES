# 测试说明

[English](TESTING.md) · [项目 README](../README.md#简体中文)

除非另有说明，命令均在仓库根目录执行。先运行 `npm ci`，并使用 Node.js 22.13+。

## 类型、构建与前端单测

```bash
npm run typecheck
npm run build
npm run test:web
```

类型检查覆盖 API、网页和共享包。构建检查 API 并生成生产网页产物。前端单测覆盖请求重试与幂等、分页选项、设备事件，以及自动审核表单和状态展示逻辑。

## 数据库测试

使用 PostgreSQL 17，在 `.env` 配置独立连接，例如：

```dotenv
TEST_DATABASE_URL=postgres://mes:change_me@127.0.0.1:5432/mes_test
EQUIPMENT_TEST_DATABASE_URL=postgres://mes:change_me@127.0.0.1:5432/mes_equipment_parity_test
```

运行前先创建数据库并替换示例凭据。也可按 README 使用 `npm run db:local` 创建本地开发集群和测试库。

```bash
npm test
npm run test:integrations
```

脚本会加载 `.env`。测试库 URL 必须显式设置，库名必须以 `_test` 结尾。API 测试**会删除并重建 public schema**，且在用例间重置数据。后缀检查不能让有价值的数据变得安全，请使用只供测试的专用数据库。数据库测试套件按顺序运行，不要并发使用同一个测试库。

覆盖内容包括认证与角色、工艺快照、分批完工、并发收料、按订单隔离的库存、重复请求、事务回滚、报废、工资来源、附件、停用账号及任务反馈。自动审核测试覆盖等待期、生效边界、转人工、重新提交、并发、故障恢复、跨页、启动和关闭。设备集成测试使用真实 PostgreSQL 检查重复及冲突消息、晚到事件、心跳、跨日和未知时段。

## 浏览器流程

浏览器测试需要**独立的、已填充演示用户的开发服务**，不会自动启动应用，也不会使用 `TEST_DATABASE_URL` 决定服务端所连的数据库。

按 README 配置开发数据库并运行迁移和 seed，然后在独立终端启动：

```bash
npm run dev
```

在测试终端执行：

```bash
npx playwright install chromium
npm run test:e2e
```

默认地址为 `http://127.0.0.1:5173`。使用其他隔离开发实例时：

```bash
MES_BASE_URL=http://127.0.0.1:5174 npm run test:e2e
```

该 origin 必须同时提供网页及 `/api` 代理，包含在服务端 `APP_ORIGIN` 中，并具备演示账号。测试会创建用户、客户、产品、工单、报工、库存流水等记录，并操作自动审核配置，可能留下测试数据。不要使用生产 URL 或包含需要保留数据的数据库。

流程覆盖生产到工资和发货、只读权限、附件上传、响应丢失后的重试、任务反馈、短暂连接故障、大量选项及服务端自动审核。后台任务场景会关闭浏览器页面并等待真实定时检查，耗时可能长于普通页面测试。

失败时 Playwright 保留截图和 trace，HTML 报告位于 `playwright-report/`。这些文件可能含业务数据，未经检查不要提交或分享。

## 语言与版面检查

UI 修改需要在桌面和窄屏手机视图检查中文与英文。检查登录页和顶部切换、刷新后语言保留、切换时保持打开的表单、验证信息、通知、状态标签及动态数量。确认用户录入数据保持原样，金额仍为人民币 CNY。检查抽屉、表格、菜单和自动审核设置是否有截字或页面级横向溢出。

## Android

在 `apps/android` 执行：

```bash
./scripts/build-debug.sh
```

默认 community 构建无需私有打印二进制，脚本会运行单测与 lint。可选 vendor 构建需要本地 SDK，并显式选择。工具链与命令见 [Android 说明](../apps/android/README.zh-CN.md)。

## 验证边界

自动化覆盖代表性业务流程与约束，不代表覆盖每家工厂的所有操作习惯。构建或单测通过，不能证明实际相机扫描、蓝牙配对、标签出纸、MQTT broker 连接或云端恢复已经验收。

部署前应在目标环境验证 Compose、HTTPS 证书、备份恢复及相关业务流程。硬件验收需要实际 Android 设备、打印机、标签纸和设备采集环境。现场结果与自动化测试输出应分别记录，不把过去一次本地测试当作新部署的验收。

## 增补流程验证

设备扩展测试使用独立的 `EQUIPMENT_TEST_DATABASE_URL`，库名必须以 `_equipment_parity_test` 结尾；其余数据库测试使用 `TEST_DATABASE_URL`。两个库都只用于自动化测试，会重建 schema。已有 `.env` 不会被本地数据库脚本覆盖，请按 `.env.example` 补充设备测试连接串。

增补测试覆盖工艺选择和分派、资质与工位、销售明细及归档保护、责任报废和薪酬归属、多行采购及分次付款、逐项清单执行、安全考试、人员权限与受限附件、短信验证码、统计口径、库龄预警、设备累计时长与状态占比、Android 文件桥接和 PDF 真实渲染。浏览器测试还验证同页语言切换保留表单、网址与输入内容。

`tests/project-site.spec.ts` 自行构建并启动静态介绍页，验证中英文切换不产生文档跳转、刷新保留选择以及手机宽度布局。发布工作流只在 main 的 CI 成功后部署介绍页。
