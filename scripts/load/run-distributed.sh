#!/usr/bin/env bash
# #426 G1 Phase 3 — distributed k6 via execution segments (no k6 Cloud required).
#
# Usage:
#   ./scripts/load/run-distributed.sh discover 4 2500 5m
#     → 4 workers × 2500 VU = 10,000 VU total
#
# Requires native k6 on PATH. Each worker sources scripts/load/fixtures/.env.load.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${LOAD_ENV_FILE:-$ROOT/scripts/load/fixtures/.env.load}"

SCRIPT="${1:-discover}"
WORKERS="${2:-4}"
VUS_PER_WORKER="${3:-2500}"
DURATION="${4:-5m}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${LOAD_BASE_URL:?Set LOAD_BASE_URL in $ENV_FILE}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY in $ENV_FILE}"

case "$SCRIPT" in
  discover) K6_SCRIPT="discover-merged-events.js" ;;
  smoke|ticket-checkout-status|ticket-checkout-create|agent-chat|marketing-send)
    K6_SCRIPT="${SCRIPT}.js" ;;
  *)
    echo "Unknown script: $SCRIPT" >&2
    exit 1
    ;;
esac

REPORT_DIR="${G1_REPORT_DIR:-$ROOT/docs/evidence/g1-load/reports}"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="/tmp/g1-distributed-${STAMP}"
mkdir -p "$LOG_DIR"

export LOAD_VUS="$VUS_PER_WORKER"
export LOAD_DURATION="$DURATION"
export LOAD_RAMP_DURATION="${LOAD_RAMP_DURATION:-2m}"

echo ":: G1 distributed :: script=$K6_SCRIPT workers=$WORKERS vus_per_worker=$VUS_PER_WORKER duration=$DURATION"
echo ":: total VUs=$((WORKERS * VUS_PER_WORKER)) :: logs=$LOG_DIR"

pids=()
for ((i = 0; i < WORKERS; i++)); do
  REPORT_JSON="$REPORT_DIR/${STAMP}-${SCRIPT}-seg${i}of${WORKERS}-vus${VUS_PER_WORKER}.json"
  (
    k6 run \
      --execution-segment "${i}/${WORKERS}" \
      --summary-export="$REPORT_JSON" \
      "$ROOT/scripts/load/$K6_SCRIPT" \
      >"$LOG_DIR/worker-${i}.log" 2>&1
    echo "worker $i exit=$?" >>"$LOG_DIR/status.txt"
  ) &
  pids+=($!)
done

fail=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then fail=1; fi
done

echo ":: done :: fail=$fail :: reports=$REPORT_DIR/${STAMP}-${SCRIPT}-seg*"
tail -30 "$LOG_DIR"/worker-*.log 2>/dev/null || true
exit "$fail"
