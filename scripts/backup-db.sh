#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/.." && pwd)"
destination="${1:-$root/.local/backups/test_ai-$(date -u +%Y%m%dT%H%M%SZ).sql}"
mkdir -p "$(dirname "$destination")"
if [[ -e "$destination" ]]; then printf 'Backup file already exists\n' >&2; exit 1; fi
export MYSQL_PWD="${DATABASE_PASSWORD:?Set DATABASE_PASSWORD}"
"${MYSQLDUMP_BIN:-mysqldump}" --protocol=TCP -h "${MYSQL_HOST:-127.0.0.1}" -P "${MYSQL_PORT:-8889}" -u "${DATABASE_USERNAME:-quicktest}" --single-transaction --no-tablespaces "${MYSQL_DATABASE:-test_ai}" --result-file="$destination"
printf 'Backup: %s\n' "$destination"
