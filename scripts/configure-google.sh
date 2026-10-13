#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/.." && pwd)"
client_id="${GOOGLE_CLIENT_ID:-}"
client_secret="${GOOGLE_CLIENT_SECRET:-}"
temporary=''
trap '[[ -z "$temporary" ]] || rm -f "$temporary"; unset client_secret' EXIT

printf 'Create a Web application OAuth client in Google Cloud.\n'
printf 'Authorized redirect URI: %s/login/oauth2/code/google\n' "${BACKEND_URL:-http://localhost:8080}"
if [[ -z "$client_id" ]]; then
  read -r -p 'Google OAuth Client ID: ' client_id
fi
if [[ ! "$client_id" =~ ^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$ ]]; then
  printf 'Invalid OAuth Client ID. Configuration was not changed.\n' >&2
  exit 1
fi
if [[ -z "$client_secret" ]]; then
  read -r -s -p 'Google OAuth Client Secret (hidden, not an App Password): ' client_secret
  printf '\n'
fi
if [[ ! "$client_secret" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  printf 'Invalid OAuth Client Secret. Configuration was not changed.\n' >&2
  exit 1
fi

mkdir -p "$root/.local"
temporary="$(mktemp "$root/.local/google.properties.XXXXXX")"
printf '%s\n' \
  'GOOGLE_ENABLED=true' \
  "GOOGLE_CLIENT_ID=$client_id" \
  "GOOGLE_CLIENT_SECRET=$client_secret" > "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$root/.local/google.properties"
printf 'Google OAuth configuration saved locally. Restart the backend to enable Google registration and sign-in.\n'
