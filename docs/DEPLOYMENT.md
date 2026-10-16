# Deployment

[简体中文](DEPLOYMENT.zh-CN.md) · [Project README](../README.md)

The Compose stack runs PostgreSQL, the API, and Caddy on one server. It requires Docker Engine with the Compose plugin and a domain resolving to that server. Allow incoming ports 80 and 443 for HTTPS. The database and API have no published host ports. Redis is not required; MQTT uses a separately configured broker.

## First deployment

From the repository root:

```bash
cp deploy/env.production.example .env.production
# Edit .env.production before starting the stack.
docker compose --env-file .env.production up -d --build
```

Set these values in `.env.production`:

| Variable                         | Purpose                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| `MES_DOMAIN`                     | Public hostname, such as `mes.example.com`, without a scheme or path  |
| `POSTGRES_PASSWORD`              | A long, random password using URL-safe letters, numbers, `-`, and `_` |
| `FACTORY_TIMEZONE`               | IANA time zone for equipment daily summaries; default `Asia/Shanghai` |
| `MQTT_URL`                       | Optional equipment broker URL; use TLS for production connections     |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | Optional broker credentials, retained on the server                   |
| `MQTT_TOPIC`                     | Subscription topic; default `device/send/+`                           |

The database password is interpolated into a connection URL, so avoid characters that require URL encoding. Do not commit `.env.production` or use the example password. Production is not seeded with demo users.

The API applies migrations before starting. Caddy obtains and renews HTTPS certificates for `MES_DOMAIN`. DNS, firewall rules, and available ports must be correct before certificate issuance can succeed.

Compose sets `APP_ORIGIN` to `https://<MES_DOMAIN>`, enables secure production cookies, and places the API behind Caddy with `TRUST_PROXY=true`. Keep the API behind that trusted proxy. If you customize the deployment, ensure `APP_ORIGIN` exactly matches the browser origin.

## Create the first administrator

Run the following in **Bash**. It reads the password without echoing it or writing it into shell history:

```bash
read -rsp 'Administrator password (at least 12 characters): ' ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
docker compose --env-file .env.production exec -e ADMIN_PASSWORD api npm run admin:create -w @mes/api
unset ADMIN_PASSWORD
```

The default login name is `admin`. The bootstrap command only succeeds when no administrator exists. It does not create demo accounts or import factory data. Sign in to add other members, assign roles, and enter products, process routes, and opening data.

## Health and operation

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 api web
curl --fail https://mes.example.com/api/health
```

Replace the example hostname with your configured domain. `/api/health` checks both the process and database connectivity; a database failure returns 503. Compose also checks database and API health. Application logs go to container stdout; configure log rotation and retention for your host.

Automatic report approval runs on the server and is configured in **Report Approval → Automatic approval settings**. Check its delay, amount limit, and other rules before business use. Language selection is per device; CNY remains the currency in either language.

## Backups and restore checks

```bash
bash scripts/backup.sh
```

The script creates a PostgreSQL custom-format dump and an attachment archive in `backups/`, with the same timestamp prefix. Keep the pair together, and configure an off-host copy and retention policy. Uploads live in the `uploads` persistent volume; a database dump alone cannot restore attachment contents.

The script reads the database and attachments sequentially. For a coordinated recovery point, use a maintenance window that pauses business writes during the backup. Keep the API container running while this script archives its upload directory.

Restore into a **new** database and a separate attachment directory for verification. Replace `TIMESTAMP` below with the prefix from your backup files:

```bash
docker compose --env-file .env.production exec -T db createdb -U mes mes_restore_check
docker compose --env-file .env.production exec -T db pg_restore -U mes -d mes_restore_check --no-owner --exit-on-error < backups/mes-TIMESTAMP.dump
mkdir -p .local/restore-check
tar -xzf backups/mes-TIMESTAMP-uploads.tar.gz -C .local/restore-check
```

These commands do not replace the running `mes` database or upload volume. In an isolated application instance, verify orders, stock, pay totals, attachment hashes, permissions, and representative workflows before planning a production recovery. A complete recovery must restore both database and attachments with their ownership and storage configuration.

## Upgrade and rollback

1. Back up the database and attachments; retain the current release or source revision.
2. Test the new migrations and relevant workflows against an isolated data copy.
3. Build and start the selected version with `docker compose --env-file .env.production up -d --build`.
4. Check health, logs, login, and relevant workflows.

Migrations are recorded by filename and protected by a database lock. Before rolling back application code, verify that the earlier version can read the current database schema. When a data change is not reversible, verify restoration into a separate database before deciding how to switch. Dropping new columns is not a general rollback procedure.

## Equipment and acceptance

Without MQTT configuration, equipment pages show that collection is not connected. Authorized users can record states manually. Production MQTT connections require TLS; a trusted private-network plaintext broker requires explicit `ALLOW_PRIVATE_MQTT=true` in `.env.production`. Do not use that exception for a public connection. See the [equipment protocol](EQUIPMENT.md).

Communication age and equipment state are separate: a stale connection does not automatically rewrite an equipment state to stopped. State and SSE endpoints require authentication.

Before live use, verify the target server, HTTPS, backup restoration, account permissions, factory time zone, equipment identifiers, and broker topics. Validate Android scanning, the optional printer integration, actual labels, and batch operations with the physical devices. The supplied configuration and automated tests do not establish acceptance for your server or hardware. Notifications are currently represented through application state and live refresh; business email and ERP delivery require separate adapters. Optional SMS sign-in and Andon webhooks are described below.

## Optional SMS sign-in and Andon notifications

`SMS_GATEWAY_URL` must use HTTPS and accept a POST body `{mobile, code, expiresInSeconds: 300}` with a successful 2xx response. `SMS_GATEWAY_TOKEN` supplies optional Bearer authentication. SMS sign-in appears only when configured; register each mobile number in user management. Codes are stored only as salted digests, expire after five minutes, allow five attempts, cannot be reused, and have a one-minute request cooldown.

`ANDON_WEBHOOK_URL` and optional `ANDON_WEBHOOK_TOKEN` enable external Andon delivery. HTTPS POST bodies contain `{type: "mes.andon.alarm", id, recordId, payload}`; the payload snapshots the station, category, description and contacts. Receivers must deduplicate using `Idempotency-Key`/`id`. Requests time out after eight seconds and have at most three attempts. Without configuration, alarms and handling remain local and no real messages are sent. Each station contact can have a delay; responding cancels alarms that have not fired.

Validate with a test gateway before configuring your own provider. This repository includes no provider account and the demo sends no paid SMS. Keep tokens and personnel phone numbers out of Git.

## Project introduction website

`docs/site` is an independent static introduction with a language button that updates the current page. It has no MES database connection or production accounts. Run `node scripts/build-docs.mjs` to generate `.local/site`. GitHub Pages uses Actions as its build source and publishes after successful main-branch CI.
