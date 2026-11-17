#!/usr/bin/env bash
# #4238 rework 2 (tester P2-1) — THIS worktree's own Host ads Core stack.
#
#   DOCKER_HOST=unix://$HOME/.docker/run/docker.sock \
#     scripts/sites/local/start-host-ads-stack.sh            # start + migrate
#   node scripts/sites/local/seed-host-ads.mjs                # load the fixture
#   scripts/sites/local/start-host-ads-stack.sh --stop [--wipe]
#
# Core only (no Sites CMS), on a dedicated project id and port set, never the
# shared Sites defaults other chats use (55321/55322/55421/55422):
#   project id HOST_ADS_STACK_PROJECT_ID   (default mingla-host-ads-4238-local)
#   API        HOST_ADS_STACK_API_PORT     (default 56521)
#   DB         HOST_ADS_STACK_DB_PORT      (default 56522)
#   shadow     HOST_ADS_STACK_SHADOW_PORT  (default 56520)
#   inspector  HOST_ADS_STACK_INSPECTOR_PORT (default 56583)
#   mail       HOST_ADS_STACK_MAIL_PORT    (default 56524; the stack's mail
#              catcher, so the native app's email-code sign-in works locally)
# Native sign-in (#4238 rework 3): point the app at http://<this Mac's LAN IP>:56521,
# ask for a code for host-ads-owner@local.invalid, then read it with
#   node scripts/sites/local/host-ads-sign-in-code.mjs --inbox   # from the mail catcher
# or mint one without the app sending mail:
#   node scripts/sites/local/host-ads-sign-in-code.mjs           # admin one-time code
# The workdir is per checkout (outside the repo); state goes to
# scripts/sites/local/.state/host-ads-* (gitignored).
#
# Before it writes anything it proves the database it reaches IS this stack:
#   1. every inherited PG* variable is dropped (PGHOSTADDR, PGSERVICE, ...);
#   2. a reserved port, or a port something already listens on while this
#      stack is not running, is refused before `supabase start`;
#   3. a random identity token is written INSIDE the stack's db container
#      (docker exec, never the host port) and read back through the host
#      port; a mismatch stops here, before any migration.
# Full runbook: docs/runbooks/SITES_LOCAL_STACK.md § Host ads stack (#4238).
set -euo pipefail

# (1) never inherit a psql target.
while IFS= read -r name; do unset "$name"; done < <(compgen -e | grep -E '^PG' || true)

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"

stop=false
wipe=false
for arg in "$@"; do
  case "$arg" in
    --stop) stop=true ;;
    --wipe) wipe=true ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "FAIL host-ads-stack: unsupported argument ${arg}" >&2; exit 2 ;;
  esac
done

export SITES_LOCAL_CORE_PROJECT_ID="${HOST_ADS_STACK_PROJECT_ID:-mingla-host-ads-4238-local}"
export SITES_LOCAL_CORE_API_PORT="${HOST_ADS_STACK_API_PORT:-56521}"
export SITES_LOCAL_CORE_DB_PORT="${HOST_ADS_STACK_DB_PORT:-56522}"
export SITES_LOCAL_CORE_SHADOW_PORT="${HOST_ADS_STACK_SHADOW_PORT:-56520}"
export SITES_LOCAL_CORE_INSPECTOR_PORT="${HOST_ADS_STACK_INSPECTOR_PORT:-56583}"
# #4238 rework 3: the mail catcher is ON for this stack only (common.sh keeps
# it off by default for every other local stack).
export SITES_LOCAL_CORE_MAIL_ENABLED=true
export SITES_LOCAL_CORE_MAIL_PORT="${HOST_ADS_STACK_MAIL_PORT:-56524}"
# A workdir of its own, beside (never inside) the Sites stack's.
default_stacks_dir="${HOME}/.mingla-sites-local/host-ads-$(printf '%s' "$repo_root" | shasum -a 256 | cut -c1-12)"
export SITES_LOCAL_STACKS_DIR="${HOST_ADS_STACKS_DIR:-$default_stacks_dir}"
# shellcheck source=lib/common.sh
source "${script_dir}/lib/common.sh"

identity_path="${STATE_DIR}/host-ads-stack.json"
status_path="${STATE_DIR}/host-ads.status.env"

if [[ "$stop" == true ]]; then
  stop_args=()
  [[ "$wipe" == true ]] && stop_args+=(--no-backup)
  if [[ -f "${CORE_WORKDIR}/supabase/config.toml" ]]; then
    log "stopping the Host ads stack (${SITES_LOCAL_CORE_PROJECT_ID})"
    "$SUPABASE_BIN" stop --workdir "$CORE_WORKDIR" ${stop_args[@]+"${stop_args[@]}"} || true
  fi
  if [[ "$wipe" == true ]]; then
    rm -rf "$SITES_LOCAL_STACKS_DIR"
    rm -f "$identity_path" "$status_path" "${STATE_DIR}/host-ads-owner.json"
  fi
  log "stopped"
  exit 0
fi

# (2) dedicated, free ports (the reserved ones are refused before anything else).
require_tool node
ports=("$SITES_LOCAL_CORE_API_PORT" "$SITES_LOCAL_CORE_DB_PORT" "$SITES_LOCAL_CORE_SHADOW_PORT" "$SITES_LOCAL_CORE_INSPECTOR_PORT" "$SITES_LOCAL_CORE_MAIL_PORT")
node "${script_dir}/lib/host-ads-stack-cli.mjs" check-ports "${ports[@]}"
require_tool docker
require_tool psql
require_tool lsof
[[ -x "$SUPABASE_BIN" ]] || { echo "FAIL host-ads-stack: supabase CLI not found at ${SUPABASE_BIN}" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "FAIL host-ads-stack: Docker is not running at ${DOCKER_HOST}" >&2; exit 2; }

write_core_stack_config
if stack_running "$CORE_WORKDIR"; then
  log "Host ads stack already running (${SITES_LOCAL_CORE_PROJECT_ID}); re-verifying it"
else
  for port in "${ports[@]}"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "FAIL host-ads-stack: port ${port} is already in use by another process (lsof -nP -iTCP:${port} -sTCP:LISTEN); pick free ports with HOST_ADS_STACK_*_PORT" >&2
      exit 2
    fi
  done
  log "starting the Host ads stack (${SITES_LOCAL_CORE_PROJECT_ID}; the first start pulls images)"
  "$SUPABASE_BIN" start --workdir "$CORE_WORKDIR"
fi

"$SUPABASE_BIN" status --workdir "$CORE_WORKDIR" -o env > "$status_path"
chmod 600 "$status_path"
db_url="$(sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$status_path")"

# (3) identity: written inside the container, read back through the host port.
container="supabase_db_${SITES_LOCAL_CORE_PROJECT_ID}"
docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true || {
  echo "FAIL host-ads-stack: container ${container} is not running at ${DOCKER_HOST}" >&2; exit 2; }
token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
printf '%s\n' \
  "CREATE SCHEMA IF NOT EXISTS sites_local;" \
  "REVOKE ALL ON SCHEMA sites_local FROM PUBLIC;" \
  "CREATE TABLE IF NOT EXISTS sites_local.stack_identity (project_id text PRIMARY KEY, token text NOT NULL, written_at timestamptz NOT NULL DEFAULT now());" \
  "INSERT INTO sites_local.stack_identity (project_id, token) VALUES (:'project', :'token') ON CONFLICT (project_id) DO UPDATE SET token = EXCLUDED.token, written_at = now();" |
  docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -v project="$SITES_LOCAL_CORE_PROJECT_ID" -v token="$token" >/dev/null
node "${script_dir}/lib/host-ads-stack-cli.mjs" write-identity \
  "$identity_path" "$SITES_LOCAL_CORE_PROJECT_ID" "$SITES_LOCAL_CORE_API_PORT" "$SITES_LOCAL_CORE_DB_PORT" "$db_url" "$token"
node "${script_dir}/lib/host-ads-stack-cli.mjs" verify "$identity_path"
log "verified: 127.0.0.1:${SITES_LOCAL_CORE_DB_PORT} is ${container}"

log "applying Core migrations (canonical psql replay; the first run takes a few minutes)"
replay_core_migrations "$db_url"
log "Host ads stack ready: API 127.0.0.1:${SITES_LOCAL_CORE_API_PORT}, DB 127.0.0.1:${SITES_LOCAL_CORE_DB_PORT}. Next: node scripts/sites/local/seed-host-ads.mjs"
