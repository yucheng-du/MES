# Contributing · 参与贡献

Contributions and issues are welcome in English or Chinese.

## English

1. Describe the concrete problem and expected behavior. For a substantial feature or workflow change, discuss the scope in an issue before implementation.
2. Follow the [quick start](README.md#quick-start) and use isolated development and test databases.
3. Keep changes focused. Preserve transaction boundaries, role checks, revision checks, and idempotency for business writes. Add migrations rather than rewriting an already released migration.
4. Add or update tests for changed behavior, then run the relevant checks in [TESTING.md](docs/TESTING.md). Describe what you ran and any validation that needs hardware or a deployment environment.
5. Include Chinese and English system text for UI changes. Do not translate stored business names, notes, or protocol values. Keep CNY unchanged when switching language.
6. Open a pull request explaining the problem, resulting behavior, and validation. Screenshots help when a layout changes; use sample data.

Do not commit `.env` files, database dumps, uploads, logs, browser traces, local paths, real customer or employee information, credentials, signing keys, or private SDK binaries. Share only synthetic examples with bugs. Optional printer SDK files belong in local ignored directories and retain their own licenses.

Contributions to this project are provided under the [MIT License](LICENSE). Follow [SECURITY.md](SECURITY.md) for sensitive vulnerability reports.

## 中文

1. 说明具体问题与预期行为。较大的功能或业务流程调整，请先通过 issue 讨论范围。
2. 按[快速启动](README.md#快速启动)准备环境，使用隔离的开发库与测试库。
3. 保持修改集中；业务写入应保留事务、权限、修订号和幂等边界。新增迁移，不改写已发布的迁移文件。
4. 为实际变化补充或更新必要测试，按[测试说明](docs/TESTING.zh-CN.md)运行相关检查。说明执行结果及仍需硬件或部署环境验证的部分。
5. UI 变更同时提供中英文系统文案；不要翻译已存储的业务名称、备注和协议值。切换语言不改变人民币 CNY。
6. Pull request 说明问题、修改后的行为与验证；涉及布局时可附使用样例数据的截图。

不要提交 `.env`、数据库备份、上传文件、日志、浏览器 trace、本机路径、真实客户或员工信息、凭据、签名密钥和私有 SDK 二进制。问题示例仅使用虚构数据。可选打印 SDK 保留在本地忽略目录，遵循其自身许可。

向本项目提交的贡献使用 [MIT 许可证](LICENSE)。敏感漏洞报告请遵循 [SECURITY.md](SECURITY.md)。
