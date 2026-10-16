# 部署说明

[English](DEPLOYMENT.md) · [项目 README](../README.md#简体中文)

Compose 在一台服务器运行 PostgreSQL、API 和 Caddy。需要 Docker Engine、Compose 插件及解析到该服务器的域名。公网开放 80、443 端口供 HTTPS 使用；数据库和 API 不发布宿主机端口。应用无需 Redis；MQTT 使用单独配置的 broker。

## 首次部署

在仓库根目录执行：

```bash
cp deploy/env.production.example .env.production
# 启动前编辑 .env.production。
docker compose --env-file .env.production up -d --build
```

在 `.env.production` 设置：

| 变量                             | 用途                                                    |
| -------------------------------- | ------------------------------------------------------- |
| `MES_DOMAIN`                     | 公网域名，例如 `mes.example.com`，不含协议或路径        |
| `POSTGRES_PASSWORD`              | 足够长的随机密码，仅使用 URL 安全的字母、数字、`-`、`_` |
| `FACTORY_TIMEZONE`               | 设备日报使用的 IANA 时区，默认 `Asia/Shanghai`          |
| `MQTT_URL`                       | 可选设备 broker 地址，生产连接使用 TLS                  |
| `MQTT_USERNAME`、`MQTT_PASSWORD` | 可选 broker 凭据，仅保存在服务端                        |
| `MQTT_TOPIC`                     | 订阅主题，默认 `device/send/+`                          |

数据库密码会直接插入连接 URL，请避免需要 URL 编码的字符。不要提交 `.env.production`，不要使用示例密码。生产环境不会创建演示账号。

API 启动前应用数据库迁移。Caddy 为 `MES_DOMAIN` 申请并续期 HTTPS 证书；DNS、防火墙和端口占用必须配置正确，证书签发才能成功。

Compose 将 `APP_ORIGIN` 设为 `https://<MES_DOMAIN>`，使用生产安全 Cookie，并在 Caddy 后为 API 开启 `TRUST_PROXY=true`。请保持 API 位于可信代理之后；自定义部署时，`APP_ORIGIN` 必须与浏览器访问的 origin 完全一致。

## 创建首个管理员

在 **Bash** 中执行以下命令。密码不会显示在屏幕上，也不会写入 shell 命令历史：

```bash
read -rsp '管理员密码（至少 12 位）: ' ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
docker compose --env-file .env.production exec -e ADMIN_PASSWORD api npm run admin:create -w @mes/api
unset ADMIN_PASSWORD
```

默认登录名为 `admin`。仅在数据库没有管理员时允许执行初始化命令；它不会创建演示账号或导入工厂数据。登录后添加成员、分配角色，并录入产品、工艺及期初数据。

## 健康检查与运行

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 api web
curl --fail https://mes.example.com/api/health
```

将示例域名替换为实际域名。`/api/health` 同时检查进程与数据库连接；数据库连接失败时返回 503。Compose 也配置了数据库和 API 健康检查。应用日志写到容器 stdout，请为服务器配置日志轮转与保留策略。

报工自动审核在服务端执行，配置入口为“报工审批 → 自动审核设置”。投入业务前检查等待时间、金额上限及其他规则。语言选择按设备保存，两种语言均使用人民币 CNY。

## 备份与恢复演练

```bash
bash scripts/backup.sh
```

脚本在 `backups/` 创建 PostgreSQL 自定义格式 dump 和附件压缩包，两者具有相同的时间戳前缀。请成对保存，并配置异机副本与保留策略。附件内容位于 `uploads` 持久卷，仅恢复数据库无法恢复附件文件。

脚本依次读取数据库和附件，不是跨两者的原子快照。需要一致恢复点时，应在备份维护窗口暂停业务写入；脚本从 API 容器归档上传目录，因此执行时保持该容器运行。

恢复演练使用**新数据库**及独立附件目录。将下方 `TIMESTAMP` 替换为备份文件的时间戳：

```bash
docker compose --env-file .env.production exec -T db createdb -U mes mes_restore_check
docker compose --env-file .env.production exec -T db pg_restore -U mes -d mes_restore_check --no-owner --exit-on-error < backups/mes-TIMESTAMP.dump
mkdir -p .local/restore-check
tar -xzf backups/mes-TIMESTAMP-uploads.tar.gz -C .local/restore-check
```

这些命令不会替换正在使用的 `mes` 数据库或附件卷。正式恢复前，用隔离的应用实例检查订单、库存、工资总额、附件哈希、权限及代表性流程。完整恢复需要同时恢复数据库和附件，并核对文件属主与存储配置。

## 升级与回退

1. 备份数据库和附件，保留当前发布版本或源码版本。
2. 在隔离的数据副本上验证新迁移与相关业务流程。
3. 使用 `docker compose --env-file .env.production up -d --build` 构建并启动选定版本。
4. 检查健康状态、日志、登录及相关业务操作。

迁移按文件名记录，数据库锁防止重复并发执行。回退应用代码前，先确认旧版本能读取当前数据库结构。涉及不可逆的数据变更时，应先验证向独立数据库恢复备份，再决定切换方式；不能把直接删除新列当作通用回退流程。

## 设备接入与现场验收

未配置 MQTT 时，设备页显示采集未连接，有权限的用户仍可手工登记状态。生产 MQTT 默认要求 TLS；可信私网的明文 broker 需要在 `.env.production` 显式设置 `ALLOW_PRIVATE_MQTT=true`，该例外不适合公网。详见[设备协议](EQUIPMENT.md)。

通信时效与设备业务状态是两类信息：通信过期不会自动将设备状态改写为停机。设备状态和 SSE 接口要求登录认证。

投入生产前，在目标环境确认服务器、HTTPS、备份恢复、权限、工厂时区、设备编号与 broker 主题。使用实物验收 Android 扫码、可选打印集成、标签纸及批量操作。仓库提供的配置和自动化测试不能替代目标服务器或现场硬件验收。当前业务提醒通过应用状态及实时刷新呈现，邮件和外部 ERP 投递需另接适配器。可选短信登录及安灯 webhook 见下文。

## 可选短信登录与安灯通知

`SMS_GATEWAY_URL` 使用 HTTPS，服务端 POST `{mobile, code, expiresInSeconds: 300}`，可用 `SMS_GATEWAY_TOKEN` 配置 Bearer 认证。成功响应应为 2xx。仅配置后显示短信登录；手机号码在人员管理登记。验证码仅保存带随机盐的摘要，有效期五分钟、每分钟最多请求一次、最多尝试五次，成功后不可重用。

`ANDON_WEBHOOK_URL` 与可选 `ANDON_WEBHOOK_TOKEN` 启用安灯外发。HTTPS POST 包含 `{type: "mes.andon.alarm", id, recordId, payload}`；payload 含工位、类别、说明和联系人快照。接收方必须按 `Idempotency-Key`/`id` 去重。超时八秒，最多三次尝试。未配置时保留本地报警与处理记录，不会发送真实消息。工位联系人可分别设置延迟，提前响应会取消尚未触发的报警。

请先使用测试网关验收，然后配置自有服务商；仓库不包含服务商账号，也不会为演示发送付费短信。不要把 token 或人员电话提交到仓库。

## 项目介绍网站

`docs/site` 是独立的静态介绍页，语言按钮只更新当前页面。它不连接 MES 数据库，不提供生产账号。运行 `node scripts/build-docs.mjs` 可生成 `.local/site`。GitHub Pages 使用 Actions 构建源，main 分支 CI 成功后自动发布。
