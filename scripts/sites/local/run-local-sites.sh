#!/usr/bin/env bash
# #2829 W0 — run the LOCAL Sites apps against the local stacks.
#
#   scripts/sites/local/run-local-sites.sh [--prod] [--frozen]
#
#   - Core edge functions: `supabase functions serve` on the Core stack, with
#     the generated supabase/functions/.env.local (MINGLA_SITES_SECURITY_JSON)
#   - Studio (mingla-site-cms):      http://localhost:3101
#   - Public runtime (mingla-sites): http://<label>.sites.localhost:3100
#
# `next dev` by default; --prod runs `next build && next start` (the build
# guard still applies: a Vercel marker in the environment fails the build).
# Site contact forms and newsletter boxes send to the REAL #4111 functions
# (public-brand-enquiry / public-brand-subscribe) served by the Core stack.
# --frozen: serve the edge functions from a snapshot of the current commit
# (~/.mingla-sites-local/<checkout>-<hash>/frozen-<sha>/, outside the repo),
# so code edits in this checkout
# cannot restart a long-lived preview (`functions serve` restarts on any change
# to the folder it serves). Use it whenever someone else is previewing.
# Ctrl-C stops all three. The Supabase stacks keep running; stop them with
# scripts/sites/local/stop-local-sites.sh.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
# shellcheck source=lib/common.sh
source "${script_dir}/lib/common.sh"

mode=dev
frozen=0
for arg in "$@"; do
  case "$arg" in
    --prod) mode=prod ;;
    --frozen) frozen=1 ;;
    *) echo "FAIL run-local-sites: unsupported argument ${arg}" >&2; exit 2 ;;
  esac
done

for file in mingla-sites/.env.local mingla-site-cms/.env.local supabase/functions/.env.local; do
  [[ -f "${repo_root}/${file}" ]] || { echo "FAIL run-local-sites: ${file} missing; run start-local-sites.sh first" >&2; exit 2; }
done
if [[ -n "${VERCEL:-}${VERCEL_ENV:-}" ]]; then
  echo "FAIL run-local-sites: refusing to run local mode with a Vercel marker in the environment" >&2
  exit 2
fi
for port in "$SITES_LOCAL_RUNTIME_PORT" "$SITES_LOCAL_STUDIO_PORT"; do
  if lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "FAIL run-local-sites: port ${port} is already in use" >&2
    exit 2
  fi
done

pids=()
cleanup() {
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  # The ports were free when this script started, so whatever listens on them
  # now is the Next server this script launched (npx runs it as a grandchild).
  for port in "$SITES_LOCAL_RUNTIME_PORT" "$SITES_LOCAL_STUDIO_PORT"; do
    lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  done
  wait 2>/dev/null || true
  # `next dev` (Next 16) writes an AGENTS.md and rewrites next-env.d.ts in
  # each app; remove the untracked file and restore the generated typings so
  # neither is committed by accident.
  for app in mingla-sites mingla-site-cms; do
    if ! git -C "$repo_root" ls-files --error-unmatch "${app}/AGENTS.md" >/dev/null 2>&1; then
      rm -f "${repo_root}/${app}/AGENTS.md"
    fi
    git -C "$repo_root" checkout -- "${app}/next-env.d.ts" 2>/dev/null || true
  done
  # Payload's dev server regenerates its type file; keep the reviewed copy.
  git -C "$repo_root" checkout -- mingla-site-cms/src/payload-types.ts 2>/dev/null || true
}
trap cleanup EXIT INT TERM

functions_workdir="$CORE_WORKDIR"
if [[ "$frozen" == 1 ]]; then
  functions_workdir="$(prepare_frozen_functions_workdir)" || exit 2
  log "serving Core edge functions FROZEN at $(cat "${functions_workdir}/.complete") from ${functions_workdir}"
else
  log "serving Core edge functions (Core stack ${SITES_LOCAL_CORE_PROJECT_ID})"
fi
"$SUPABASE_BIN" functions serve --workdir "$functions_workdir" \
  --env-file "${repo_root}/supabase/functions/.env.local" &
pids+=("$!")
# #2829 W9a (A16) — host.docker.internal inside the edge container, added
# automatically (and again whenever the container is recreated).
edge_host_gateway_watch &
pids+=("$!")

start_app() {
  local app="$1" port="$2"
  shift 2
  if [[ "$mode" == prod ]]; then
    (cd "${repo_root}/${app}" && env SITES_LOCAL_MODE=1 "$@" npm run build && env SITES_LOCAL_MODE=1 "$@" npx next start -p "$port") &
  else
    (cd "${repo_root}/${app}" && env SITES_LOCAL_MODE=1 "$@" npx next dev -p "$port") &
  fi
  pids+=("$!")
}

log "starting Studio on http://localhost:${SITES_LOCAL_STUDIO_PORT}"
start_app mingla-site-cms "$SITES_LOCAL_STUDIO_PORT"
log "starting the public runtime on http://<label>.${LOCAL_HOST_SUFFIX:-sites.localhost}:${SITES_LOCAL_RUNTIME_PORT}"
start_app mingla-sites "$SITES_LOCAL_RUNTIME_PORT"

wait
