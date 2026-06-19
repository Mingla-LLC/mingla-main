#!/usr/bin/env bash
# #426 G5 — timed synthetic incident drill helper.
#
# Records alert → ack → resolve timestamps for gate evidence.
# Does NOT configure Sentry alerts — operator sets those up per runbook.
#
# Usage:
#   ./scripts/ops/g5-synthetic-incident-drill.sh start [--severity P0|P1]
#   ./scripts/ops/g5-synthetic-incident-drill.sh mark alert-received
#   ./scripts/ops/g5-synthetic-incident-drill.sh mark acknowledged
#   ./scripts/ops/g5-synthetic-incident-drill.sh finish

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REPORT_DIR="$ROOT/docs/evidence/g5-synthetic-incident/reports"
STATE_FILE="${G5_DRILL_STATE:-/tmp/mingla-g5-drill-state.txt}"

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
from datetime import datetime
a = datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
b = datetime.fromisoformat(sys.argv[2].replace("Z", "+00:00"))
print(int((b - a).total_seconds() // 60))
PY
}

sla_for_severity() {
  case "$1" in
    P0) echo 15 ;;
    P1) echo 30 ;;
    *) echo 30 ;;
  esac
}

load_state() {
  T0="" T1="" T2="" T3=""
  SEVERITY="P1"
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
SEVERITY="${SEVERITY:-P1}"
REPORT_PATH="${REPORT_PATH:-}"
EOF
}

cmd_start() {
  load_state
  local severity="${1:-P1}"
  if [[ "$severity" != "P0" && "$severity" != "P1" ]]; then
    echo "Severity must be P0 or P1" >&2
    exit 1
  fi
  local stamp
  stamp="$(date -u +"%Y%m%dT%H%M%SZ")"
  REPORT_PATH="$REPORT_DIR/${stamp}-drill.json"
  SEVERITY="$severity"
  T0="$(utc_now)"
  T1=""
  T2=""
  T3=""
  save_state
  mkdir -p "$REPORT_DIR"

  cat <<EOF
G5 synthetic incident drill started
  T0 (start):        $T0
  Severity:          $SEVERITY (ack SLA: $(sla_for_severity "$SEVERITY") min)
  Report path:       $REPORT_PATH

Next:
  1. Inject alert:
       export SENTRY_DSN=...
       node scripts/ops/inject-g5-synthetic-alert.mjs
     (or Sentry alert test / edge logError path)
  2. When notification arrives:
       ./scripts/ops/g5-synthetic-incident-drill.sh mark alert-received
  3. When on-call acks:
       ./scripts/ops/g5-synthetic-incident-drill.sh mark acknowledged
  4. Resolve issue in Sentry, then:
       ./scripts/ops/g5-synthetic-incident-drill.sh finish

Runbook: docs/runbooks/SYNTHETIC_INCIDENT_DRILL.md
EOF
}

cmd_mark() {
  local which="${1:-}"
  load_state
  if [[ -z "${REPORT_PATH:-}" ]]; then
    echo "No active drill — run: ./scripts/ops/g5-synthetic-incident-drill.sh start" >&2
    exit 1
  fi
  case "$which" in
    alert-received) T1="$(utc_now)" ;;
    acknowledged)   T2="$(utc_now)" ;;
    resolved)       T3="$(utc_now)" ;;
    *)
      echo "Unknown mark: $which (use alert-received | acknowledged | resolved)" >&2
      exit 1
      ;;
  esac
  save_state
  echo "Marked $which at $(utc_now)"
}

write_report() {
  load_state
  local alert_min ack_min total_ack_min resolve_min sla sla_met
  alert_min="$(minutes_between "$T0" "$T1")"
  ack_min="$(minutes_between "$T1" "$T2")"
  total_ack_min="$(minutes_between "$T0" "$T2")"
  resolve_min="$(minutes_between "$T2" "$T3")"
  sla="$(sla_for_severity "$SEVERITY")"
  sla_met="false"
  if [[ -n "$total_ack_min" && "$total_ack_min" -le "$sla" ]]; then
    sla_met="true"
  fi

  python3 - "$REPORT_PATH" "$SEVERITY" "$sla" "$sla_met" "$T0" "$T1" "$T2" "$T3" \
    "${alert_min:-}" "${ack_min:-}" "${total_ack_min:-}" "${resolve_min:-}" <<'PY'
import json, os, sys
(path, severity, sla, sla_met, t0, t1, t2, t3,
 alert_min, ack_min, total_ack_min, resolve_min) = sys.argv[1:]

def num(v):
    return int(v) if v else None

data = {
    "gate": "G5",
    "severity": severity,
    "slaAckMinutes": int(sla),
    "injectMethod": os.environ.get("G5_INJECT_METHOD", "inject-g5-synthetic-alert.mjs"),
    "sentryProject": os.environ.get("G5_SENTRY_PROJECT", "mingla-business"),
    "notificationChannel": os.environ.get("G5_NOTIFICATION_CHANNEL", ""),
    "timestamps": {
        "t0_drillStartUtc": t0,
        "t1_alertReceivedUtc": t1,
        "t2_acknowledgedUtc": t2,
        "t3_resolvedUtc": t3,
    },
    "durationsMinutes": {
        "alertDelivery": num(alert_min),
        "ack": num(ack_min),
        "totalToAck": num(total_ack_min),
        "resolve": num(resolve_min),
    },
    "slaMet": sla_met == "true",
    "operator": os.environ.get("G5_DRILL_OPERATOR", ""),
    "onCall": os.environ.get("G5_ON_CALL", ""),
    "notes": os.environ.get("G5_DRILL_NOTES", ""),
}
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(path)
if sla_met != "true":
    sys.exit(1)
PY
}

cmd_finish() {
  load_state
  if [[ -z "$T0" || -z "$T1" || -z "$T2" ]]; then
    echo "Missing timestamps — need start, alert-received, acknowledged" >&2
    exit 1
  fi
  if [[ -z "$T3" ]]; then
    T3="$(utc_now)"
    save_state
  fi
  local out exit_code=0
  set +e
  out="$(write_report)"
  exit_code=$?
  set -e
  rm -f "$STATE_FILE"
  echo "G5 drill report written: $out"
  if [[ "$exit_code" -ne 0 ]]; then
    echo "WARN: ack SLA not met for $SEVERITY (see report)" >&2
    exit 1
  fi
  echo "SLA met — attach report + screenshots to GitHub #426"
}

CMD="${1:-}"
shift || true
case "$CMD" in
  start)
    severity="P1"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --severity) severity="${2:-P1}"; shift 2 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
      esac
    done
    cmd_start "$severity"
    ;;
  mark) cmd_mark "${1:-}" ;;
  finish) cmd_finish ;;
  *)
    echo "Usage: $0 {start [--severity P0|P1]|mark alert-received|mark acknowledged|finish}" >&2
    exit 1
    ;;
esac
