#!/usr/bin/env bash
# #2829 — run Mingla Business web against the LOCAL Sites stack.
#   scripts/sites/local/run-business-web.sh [--port 8190]
# Writes scripts/sites/local/.state/business-web.env from the running Core stack, exports
# it (exported values win over mingla-business/.env) and starts Expo web.
# Sign in with a seeded user: type the email, then run
#   node scripts/sites/local/business-web.mjs code brand_owner
# and type the 6-digit code it prints.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
port=8190
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) port="$2"; shift 2 ;;
    *) echo "usage: $0 [--port <port>]" >&2; exit 2 ;;
  esac
done

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "FAIL business-web: port $port is already in use; pick another with --port" >&2
  exit 2
fi

node "${repo_root}/scripts/sites/local/business-web.mjs" env --port "$port"

cd "${repo_root}/mingla-business"
set -a
# shellcheck disable=SC1091
source "${repo_root}/scripts/sites/local/.state/business-web.env"
set +a
unset EAS_BUILD_PROFILE VERCEL_ENV
export BROWSER=none
exec npx expo start --web --port "$port"
