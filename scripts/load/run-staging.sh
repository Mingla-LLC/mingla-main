#!/usr/bin/env bash
# #426 G1 — Run k6 against staging (Mingla-dev).
#
# Usage:
#   cp scripts/load/fixtures/example.env scripts/load/fixtures/.env.load
#   # fill SUPABASE_ANON_KEY (+ optional JWT/fixtures)
#   ./scripts/load/run-staging.sh smoke
#   ./scripts/load/run-staging.sh discover
#   ./scripts/load/run-staging.sh scale 50 60s
#   ./scripts/load/run-staging.sh discover 50 60s   # optional VUS + duration (overrides .env.load)
#
# Requires Docker (grafana/k6) OR k6 on PATH.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${LOAD_ENV_FILE:-$ROOT/scripts/load/fixtures/.env.load}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${LOAD_BASE_URL:?Set LOAD_BASE_URL in $ENV_FILE}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY in $ENV_FILE}"

SCRIPT="${1:-smoke}"
shift || true

case "$SCRIPT" in
  scale)
    export LOAD_VUS="${1:-10}"
    export LOAD_DURATION="${2:-30s}"
    K6_SCRIPT="smoke.js"
    ;;
  discover)
    K6_SCRIPT="discover-merged-events.js"
    ;;
  smoke|ticket-checkout-status|ticket-checkout-create|agent-chat|marketing-send)
    K6_SCRIPT="${SCRIPT}.js"
    ;;
  *)
    echo "Unknown script: $SCRIPT" >&2
    echo "Usage: $0 {smoke|discover|...|scale} [VUS] [DURATION]" >&2
    exit 1
    ;;
esac

# CLI VUS/duration override .env.load defaults (scale sets these in the case branch).
if [[ "$SCRIPT" != "scale" ]]; then
  if [[ -n "${1:-}" ]]; then export LOAD_VUS="$1"; fi
  if [[ -n "${2:-}" ]]; then export LOAD_DURATION="$2"; fi
fi

K6_PATH="$ROOT/scripts/load/$K6_SCRIPT"
REPORT_DIR="${G1_REPORT_DIR:-$ROOT/docs/evidence/g1-load/reports}"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_JSON="$REPORT_DIR/${STAMP}-${SCRIPT}-vus${LOAD_VUS:-2}.json"

run_k6() {
  if command -v k6 >/dev/null 2>&1; then
    k6 run --summary-export="$REPORT_JSON" "$K6_PATH"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm --ulimit nofile=65535:65535 \
      -e LOAD_BASE_URL -e SUPABASE_ANON_KEY \
      -e LOAD_VUS -e LOAD_DURATION -e LOAD_RAMP_DURATION \
      -e LOAD_TEST_EVENT_ID -e LOAD_TEST_TICKET_TYPE_ID \
      -e LOAD_TEST_USER_JWT -e LOAD_TEST_CAMPAIGN_ID -e LOAD_TEST_BRAND_ID \
      -v "$ROOT/scripts/load:/scripts/load:ro" \
      -v "$REPORT_DIR:/reports:rw" \
      grafana/k6 run \
      --summary-export="/reports/$(basename "$REPORT_JSON")" \
      "/scripts/load/$K6_SCRIPT"
  else
    echo "Install k6 or Docker to run load tests." >&2
    exit 1
  fi
}

echo ":: G1 staging run :: script=$K6_SCRIPT vus=${LOAD_VUS:-2} duration=${LOAD_DURATION:-15s}"
echo ":: report -> $REPORT_JSON"
run_k6
echo ":: done"
