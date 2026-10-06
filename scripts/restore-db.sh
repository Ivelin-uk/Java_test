#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then printf 'Usage: restore-db.sh backup.sql\n' >&2; exit 1; fi
database="${MYSQL_DATABASE:-test_ai}"
if [[ "${CONFIRM_DATABASE_RESTORE:-}" != "$database" ]]; then printf 'Stop backend, create a fresh backup, then set CONFIRM_DATABASE_RESTORE=%s\n' "$database" >&2; exit 1; fi
export MYSQL_PWD="${DATABASE_PASSWORD:?Set DATABASE_PASSWORD}"
if grep -Eq '^(CREATE DATABASE|USE )' "$1"; then printf 'Use a single-schema backup without CREATE DATABASE/USE statements\n' >&2; exit 1; fi
"${MYSQL_BIN:-mysql}" --protocol=TCP -h "${MYSQL_HOST:-127.0.0.1}" -P "${MYSQL_PORT:-8889}" -u "${DATABASE_USERNAME:-quicktest}" -D "$database" < "$1"
printf 'Restored database. Start backend and validate Flyway before enabling access.\n'
