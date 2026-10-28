#!/usr/bin/env bash
# #2829 W0 — bring up the LOCAL Mingla Sites stack (Core + Sites CMS).
#
# One command, from a clean Docker state or on top of a running stack:
#   scripts/sites/local/start-local-sites.sh [--reset] [--no-run]
#
#   1. starts the Core stack (a copy of supabase/config.toml with its own
#      project id and ports, so it never collides with another chat's stack)
#   2. starts the Sites CMS stack (mingla-site-cms/local-supabase)
#   3. applies Core migrations by canonical psql replay (`db reset` first only
#      with --reset; see lib/common.sh for why the CLI cannot apply them)
#   4. generates local key material and writes the three gitignored env files
#   5. seeds Core (scripts/sites/local/seed-local.mjs)
#   6. bootstraps the CMS database + buckets and applies Payload migrations
#   7. creates the runtime storage reader user
#   8. starts the apps (scripts/sites/local/run-local-sites.sh) unless --no-run
#
# Nothing here talks to a remote project: every URL is loopback, and the
# scripts it calls refuse non-loopback targets in local mode.
# Full runbook: docs/runbooks/SITES_LOCAL_STACK.md
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
# shellcheck source=lib/common.sh
source "${script_dir}/lib/common.sh"

reset=false
run_apps=true
for arg in "$@"; do
  case "$arg" in
    --reset) reset=true ;;
    --no-run) run_apps=false ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "FAIL start-local-sites: unsupported argument ${arg}" >&2
      exit 2
      ;;
  esac
done

require_tool docker
require_tool node
require_tool psql
[[ -x "$SUPABASE_BIN" ]] || { echo "FAIL start-local-sites: supabase CLI not found at ${SUPABASE_BIN}" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "FAIL start-local-sites: Docker is not running" >&2; exit 2; }

log "writing the Core stack workdir (${CORE_WORKDIR})"
write_core_stack_config
if [[ -d "${LOCAL_DIR}/.stacks" ]]; then
  # #2829 W11 — stack workdirs moved out of the repository tree.
  log "NOTE the old in-repo workdir ${LOCAL_DIR}/.stacks is no longer used; delete it once nothing is served from it (stop-local-sites.sh --wipe also removes it)"
fi

start_stack() {
  local workdir="$1" label="$2"
  if stack_running "$workdir"; then
    log "${label} stack already running"
  else
    log "starting the ${label} stack (the first start pulls images and takes a few minutes)"
    "$SUPABASE_BIN" start --workdir "$workdir"
  fi
}

start_stack "$CORE_WORKDIR" "Core"
start_stack "$CMS_WORKDIR" "Sites CMS"

if [[ "$reset" == true ]]; then
  log "resetting the Core database (--reset)"
  "$SUPABASE_BIN" db reset --local --workdir "$CORE_WORKDIR"
fi

log "capturing local stack status"
"$SUPABASE_BIN" status --workdir "$CORE_WORKDIR" -o env > "${STATE_DIR}/core.status.env"
"$SUPABASE_BIN" status --workdir "$CMS_WORKDIR" -o env > "${STATE_DIR}/cms.status.env"
chmod 600 "${STATE_DIR}/core.status.env" "${STATE_DIR}/cms.status.env"

log "applying Core migrations (canonical psql replay; first run takes a few minutes)"
core_db_url="$(sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "${STATE_DIR}/core.status.env")"
replay_core_migrations "$core_db_url"

log "generating local key material and env files"
node "${script_dir}/generate-local-keys.mjs" \
  --core-status "${STATE_DIR}/core.status.env" \
  --cms-status "${STATE_DIR}/cms.status.env"

log "seeding Core"
node "${script_dir}/seed-local.mjs"

log "bootstrapping the Sites CMS database and applying Payload migrations"
node "${script_dir}/cms-env.mjs" --exec -- \
  node "${repo_root}/scripts/sites/apply-sites-cms-migrations.mjs"

log "creating the runtime storage reader"
node "${script_dir}/seed-local.mjs" --storage-reader

log "local stack ready"
node "${script_dir}/print-env-summary.mjs"

if [[ "$run_apps" == true ]]; then
  exec "${script_dir}/run-local-sites.sh"
fi
