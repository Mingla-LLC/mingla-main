#!/usr/bin/env bash
# #426 G4 — timed DR restore drill helper (staging).
#
# Does NOT perform Supabase restore — operator runs dashboard steps per
# docs/runbooks/DR_RESTORE.md and records timestamps here.
#
# Usage:
#   ./scripts/ops/g4-dr-restore-drill.sh start
#   ./scripts/ops/g4-dr-restore-drill.sh mark restore-submitted
#   ./scripts/ops/g4-dr-restore-drill.sh mark restore-complete
#   ./scripts/ops/g4-dr-restore-drill.sh verify
#   ./scripts/ops/g4-dr-restore-drill.sh finish

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REPORT_DIR="$ROOT/docs/evidence/g4-dr-restore/reports"
STATE_FILE="${G4_DRILL_STATE:-/tmp/mingla-g4-drill-state.txt}"
DEFAULT_PROJECT_REF="${G4_DRILL_PROJECT_REF:-gqnoajqerqhnvulmnyvv}"

utc_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

minutes_between() {
  local start="$1"
  local end="$2"
  if [[ -z "$start" || -z "$end" ]]; then
    echo ""
    return
  fi
  python3 - "$start" "$end" <<'PY'
import sys
from datetime import datetime, timezone
a = datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
b = datetime.fromisoformat(sys.argv[2].replace("Z", "+00:00"))
print(int((b - a).total_seconds() // 60))
PY
}

load_state() {
  T0="" T1="" T2="" T3=""
  REPORT_PATH=""
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
  fi
}

save_state() {
  mkdir -p "$(dirname "$STATE_FILE")"
  cat >"$STATE_FILE" <<EOF
T0="${T0:-}"
T1="${T1:-}"
T2="${T2:-}"
T3="${T3:-}"
REPORT_PATH="${REPORT_PATH:-}"
EOF
}

cmd_start() {
  load_state
  local stamp
  stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  REPORT_PATH="$REPORT_DIR/${stamp}-drill.json"
  T0="$(utc_now)"
  T1=""
  T2=""
  T3=""
  save_state
  mkdir -p "$REPORT_DIR"

  cat <<EOF
G4 DR drill started
  T0 (decision):     $T0
  Staging project:   $DEFAULT_PROJECT_REF
  Report path:       $REPORT_PATH

Next:
  1. Supabase Dashboard → Database → Backups → restore (prefer clone)
  2. ./scripts/ops/g4-dr-restore-drill.sh mark restore-submitted
  3. When complete: ./scripts/ops/g4-dr-restore-drill.sh mark restore-complete
  4. ./scripts/ops/g4-dr-restore-drill.sh verify
  5. ./scripts/ops/g4-dr-restore-drill.sh finish

Runbook: docs/runbooks/DR_RESTORE.md
EOF
}

cmd_mark() {
  local which="${1:-}"
  load_state
  if [[ -z "${REPORT_PATH:-}" ]]; then
    echo "No active drill — run: ./scripts/ops/g4-dr-restore-drill.sh start" >&2
    exit 1
  fi
  case "$which" in
    restore-submitted) T1="$(utc_now)" ;;
    restore-complete)  T2="$(utc_now)" ;;
    verification-complete) T3="$(utc_now)" ;;
    *)
      echo "Unknown mark: $which (use restore-submitted | restore-complete | verification-complete)" >&2
      exit 1
      ;;
  esac
  save_state
  echo "Marked $which at $(utc_now)"
}

cmd_verify() {
  load_state
  if [[ -z "${REPORT_PATH:-}" ]]; then
    echo "No active drill — run start first" >&2
    exit 1
  fi

  local k6_exit=0
  local stripe_skip=true
  local sql_ok=false

  if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_ANON_KEY:-}" ]]; then
    echo ":: Running k6 smoke against $SUPABASE_URL"
    if k6 run "$ROOT/scripts/load/smoke.js"; then
      k6_exit=0
    else
      k6_exit=$?
    fi
  else
    echo ":: SKIP k6 smoke — set SUPABASE_URL and SUPABASE_ANON_KEY"
    k6_exit=-1
  fi

  if [[ -n "${STRIPE_SECRET_KEY:-}" ]]; then
    stripe_skip=false
    echo ":: Running Stripe connect smoke (test key)"
    node "$ROOT/scripts/e2e/stripe-connect-smoke.mjs" || true
  else
    echo ":: SKIP Stripe smoke — STRIPE_SECRET_KEY not set"
  fi

  echo ":: SQL check: run SELECT 1 + row counts in Supabase SQL editor"
  echo ":: Re-run with G4_DRILL_SQL_OK=1 when SQL checks pass"
  if [[ "${G4_DRILL_SQL_OK:-}" == "1" ]]; then
    sql_ok="true"
  fi

  export G4_K6_EXIT="$k6_exit"

  if [[ "$k6_exit" -eq 0 && "$sql_ok" == "true" ]]; then
    T3="$(utc_now)"
    save_state
    echo "Verification passed — T3=$T3"
  else
    echo "Verification incomplete (k6_exit=$k6_exit sql_ok=$sql_ok). Fix and re-run verify." >&2
    exit 1
  fi
}

write_report() {
  load_state
  local restore_min verify_min total_min
  restore_min="$(minutes_between "$T1" "$T2")"
  verify_min="$(minutes_between "$T2" "$T3")"
  total_min="$(minutes_between "$T0" "$T3")"

  python3 - "$REPORT_PATH" "$DEFAULT_PROJECT_REF" "$T0" "$T1" "$T2" "$T3" \
    "${restore_min:-}" "${verify_min:-}" "${total_min:-}" <<'PY'
import json, os, sys
path, project_ref, t0, t1, t2, t3, restore_min, verify_min, total_min = sys.argv[1:]

def num(v):
    return int(v) if v else None

data = {
    "gate": "G4",
    "projectRef": project_ref,
    "restoredProjectRef": os.environ.get("G4_DRILL_RESTORED_REF", ""),
    "recoveryType": os.environ.get("G4_DRILL_RECOVERY_TYPE", "pitr-clone"),
    "recoveryPointUtc": os.environ.get("G4_DRILL_RECOVERY_POINT", ""),
    "timestamps": {
        "t0_decisionUtc": t0,
        "t1_restoreSubmittedUtc": t1,
        "t2_restoreCompleteUtc": t2,
        "t3_verificationCompleteUtc": t3,
    },
    "durationsMinutes": {
        "restoreJob": num(restore_min),
        "verification": num(verify_min),
        "total": num(total_min),
    },
    "verification": {
        "sqlOk": os.environ.get("G4_DRILL_SQL_OK") == "1",
        "k6SmokeExitCode": num(os.environ.get("G4_K6_EXIT", "")),
        "stripeSmokeSkipped": not os.environ.get("STRIPE_SECRET_KEY"),
    },
    "operator": os.environ.get("G4_DRILL_OPERATOR", ""),
    "notes": os.environ.get("G4_DRILL_NOTES", ""),
}
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(path)
PY
}

cmd_finish() {
  load_state
  if [[ -z "$T0" || -z "$T1" || -z "$T2" || -z "$T3" ]]; then
    echo "Missing timestamps — need T0–T3 (start, restore-submitted, restore-complete, verify)" >&2
    exit 1
  fi
  local out
  out="$(write_report)"
  rm -f "$STATE_FILE"
  echo "G4 drill report written: $out"
  echo "Attach to GitHub #426 and update RTO in docs/runbooks/DR_RESTORE.md"
}

CMD="${1:-}"
case "$CMD" in
  start) cmd_start ;;
  mark) cmd_mark "${2:-}" ;;
  verify) cmd_verify ;;
  finish) cmd_finish ;;
  *)
    echo "Usage: $0 {start|mark restore-submitted|mark restore-complete|verify|finish}" >&2
    exit 1
    ;;
esac
