#!/usr/bin/env bash
# #2829 W0 — stop the LOCAL Sites stacks (Core + Sites CMS).
#
#   scripts/sites/local/stop-local-sites.sh [--wipe]
#
# Stops only this stack's containers (project ids mingla-sites-core-local and
# mingla-sites-cms-local); never touches another chat's containers. Data
# volumes are kept unless --wipe is passed, which also removes the generated
# key material and env files so the next start is a clean slate.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
# shellcheck source=lib/common.sh
source "${script_dir}/lib/common.sh"

wipe=false
for arg in "$@"; do
  case "$arg" in
    --wipe) wipe=true ;;
    *) echo "FAIL stop-local-sites: unsupported argument ${arg}" >&2; exit 2 ;;
  esac
done

stop_args=()
[[ "$wipe" == true ]] && stop_args+=(--no-backup)

if [[ -f "${CORE_WORKDIR}/supabase/config.toml" ]]; then
  log "stopping the Core stack"
  "$SUPABASE_BIN" stop --workdir "$CORE_WORKDIR" ${stop_args[@]+"${stop_args[@]}"} || true
fi
log "stopping the Sites CMS stack"
"$SUPABASE_BIN" stop --workdir "$CMS_WORKDIR" ${stop_args[@]+"${stop_args[@]}"} || true

if [[ "$wipe" == true ]]; then
  log "removing generated keys, env files and seed credentials"
  rm -rf "${STATE_DIR}" "${SITES_LOCAL_STACKS_DIR}" "${LOCAL_DIR}/.stacks"
  rm -f "${LOCAL_DIR}/.seed-credentials.local.json" \
    "${repo_root}/mingla-sites/.env.local" \
    "${repo_root}/mingla-site-cms/.env.local" \
    "${repo_root}/supabase/functions/.env.local"
fi
log "stopped"
