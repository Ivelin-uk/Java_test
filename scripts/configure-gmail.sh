#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/.." && pwd)"
sender="${SMTP_USERNAME:-}"
password="${SMTP_PASSWORD:-}"
domains="${MAIL_ALLOWED_DOMAINS:-}"
temporary=''
trap '[[ -z "$temporary" ]] || rm -f "$temporary"; unset password' EXIT

if [[ -z "$sender" ]]; then
  read -r -p 'Gmail / Google Workspace address: ' sender
fi
if [[ ! "$sender" =~ ^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]]; then
  printf 'Invalid email address. Configuration was not changed.\n' >&2
  exit 1
fi
if [[ -z "$password" ]]; then
  printf 'Create an App Password: https://myaccount.google.com/apppasswords\n'
  read -r -s -p 'Google App Password (hidden): ' password
  printf '\n'
fi
password="${password//[[:space:]]/}"
if [[ ! "$password" =~ ^[a-zA-Z0-9]{16}$ ]]; then
  printf 'Enter the 16-character Google App Password. Configuration was not changed.\n' >&2
  exit 1
fi
if [[ -z "$domains" ]]; then
  read -r -p 'Recipient domains, comma-separated [gmail.com,abv.bg,mail.bg,outlook.com,hotmail.com]: ' domains
  domains="${domains:-gmail.com,abv.bg,mail.bg,outlook.com,hotmail.com}"
fi
domains="$(printf '%s' "$domains" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [[ ! "$domains" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(,([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})*$ ]]; then
  printf 'Invalid recipient domains. Configuration was not changed.\n' >&2
  exit 1
fi

mkdir -p "$root/.local"
temporary="$(mktemp "$root/.local/mail.properties.XXXXXX")"
printf '%s\n' \
  'MAIL_ADAPTER=smtp' \
  'SMTP_HOST=smtp.gmail.com' \
  'SMTP_PORT=587' \
  "SMTP_USERNAME=$sender" \
  "SMTP_PASSWORD=$password" \
  'SMTP_AUTH=true' \
  'SMTP_TLS=true' \
  'SMTP_TEST_CONNECTION=true' \
  "MAIL_FROM=$sender" \
  "MAIL_ALLOWED_DOMAINS=$domains" > "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$root/.local/mail.properties"
printf 'Gmail configuration saved locally. Restart the backend to check SMTP login and enable email.\n'
