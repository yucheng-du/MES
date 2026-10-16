# Security · 安全

## Reporting a vulnerability

If the repository's **Security** tab offers **Report a vulnerability**, use that private reporting flow. If private reporting is not available, open an issue asking for a private reporting channel without disclosing the vulnerability details. Do not post exploitable details, real factory data, credentials, or private attachments in public issues.

Include the affected revision, relevant configuration with secrets removed, expected and actual behavior, and a minimal reproduction using synthetic data. Do not test against deployments you do not own or have permission to assess.

This project does not promise a response time or long-term support schedule. Apply reviewed fixes to your own deployment and verify its configuration and affected workflows.

## Deployment data

- Demo credentials are public and intended only for isolated development.
- Keep environment files, database backups, uploads, logs, signing keys, and private printer SDKs out of the repository.
- Use HTTPS, keep database and API ports private, and limit access to the host and backup copies.
- Grant users the roles they need. Review application audit records and dependency updates as part of operation.
- Database tests can erase data; browser tests create business records. Use the isolated environments described in [TESTING.md](docs/TESTING.md).

## 漏洞报告

若仓库 **Security** 页提供 **Report a vulnerability**，请使用该私密报告入口。若未开放私密报告，可先提交 issue 请求私密联系渠道，但不要披露漏洞细节。不要在公开 issue 中发布可利用的细节、真实工厂数据、凭据或私有附件。

请说明受影响版本、已去除秘密的相关配置、预期与实际行为，以及使用虚构数据的最小复现。不要测试没有所属权或未获授权的部署。

项目不承诺固定响应时间或长期支持周期。请将已审阅的修复应用到自己的部署，并验证配置及相关业务流程。

## 部署数据

- 演示凭据公开可见，仅用于隔离开发环境。
- 环境文件、数据库备份、上传文件、日志、签名密钥及私有打印 SDK 不应进入仓库。
- 使用 HTTPS，保持数据库和 API 端口私有，并限制服务器与备份副本的访问权限。
- 按职责分配角色，运行维护时检查审计记录和依赖更新。
- 数据库测试可能删除数据；浏览器测试会创建业务记录。请使用[测试说明](docs/TESTING.zh-CN.md)中的隔离环境。
