#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd "$(dirname "$0")/.." && pwd)"
key="${OPENAI_API_KEY:-}"
if [[ -z "$key" ]]; then
  read -r -s -p 'OpenAI API key: ' key
  printf '\n'
fi
if [[ ! "$key" =~ ^sk-[a-zA-Z0-9_-]+$ ]]; then
  printf 'Invalid API key format. Configuration was not changed.\n' >&2
  exit 1
fi
mkdir -p "$root/.local"
temporary="$(mktemp "$root/.local/openai.properties.XXXXXX")"
trap 'rm -f "$temporary"; unset key' EXIT
printf 'OPENAI_API_KEY=%s\n' "$key" > "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$root/.local/openai.properties"
printf 'OpenAI key configured locally. Restart the backend to apply it.\n'
