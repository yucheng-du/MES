#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
umask 077
backup_file="backups/mes-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env.production exec -T db pg_dump -U mes -d mes -Fc > "$backup_file.tmp"
docker compose --env-file .env.production exec -T api tar -czf - -C /var/lib/mes uploads > "${backup_file%.dump}-uploads.tar.gz.tmp"
mv "$backup_file.tmp" "$backup_file"
mv "${backup_file%.dump}-uploads.tar.gz.tmp" "${backup_file%.dump}-uploads.tar.gz"
echo "Database and attachments saved: ${backup_file%.dump}"
