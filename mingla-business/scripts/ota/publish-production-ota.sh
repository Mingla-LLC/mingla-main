#!/usr/bin/env bash
#
# ORCH-1296 — canonical production OTA publisher for mingla-business.
#
# ALL production `eas update` OTAs MUST go through this script. Two reasons:
#
#   1. TELEMETRY KEYS. `eas update` WITHOUT `--environment production` omits the
#      EAS-only `EXPO_PUBLIC_*` vars (the Sentry DSN lives ONLY in the EAS
#      `production` environment, not in local `.env`). An OTA published without it
#      silently ships with Sentry / crash-reporting OFF. This script (a) ALWAYS
#      passes `--environment production`, and (b) PRE-FLIGHT verifies
#      `EXPO_PUBLIC_SENTRY_DSN` exists in that environment and ABORTS if it does
#      not — so no OTA can go out blind.
#
#   2. SAFE FLAGS. Per-platform only (never `--platform all`), `--branch
#      production`, `--non-interactive`.
#
# ⚠ COMMS-0063 / COMMS-0052: business-app OTAs have EMPIRICALLY BRICKED launch
#   (an applied OTA stuck the splash screen; rolled back to embedded). Business
#   delivery is NATIVE-BUILD-ONLY until ORCH-1261's appVersion/runtimeVersion bump
#   AND a verified on-device OTA-apply test. This script is the canonical wrapper
#   for WHEN OTA is re-enabled — running it does not by itself make OTA safe; a
#   real-device apply test is still required first.
#
# Usage: scripts/ota/publish-production-ota.sh <ios|android> "<update message>"

set -euo pipefail

PLATFORM="${1:-}"
MESSAGE="${2:-}"

usage() {
  echo "Usage: $0 <ios|android> \"<update message>\"" >&2
}

if [[ "$PLATFORM" != "ios" && "$PLATFORM" != "android" ]]; then
  echo "ERROR: platform must be 'ios' or 'android' — per-platform only, never --platform all." >&2
  usage
  exit 1
fi

if [[ -z "$MESSAGE" ]]; then
  echo "ERROR: a non-empty update message is required." >&2
  usage
  exit 1
fi

# Run from the mingla-business root (where eas.json lives) regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/../.."

# --- Pre-flight: production env MUST carry the telemetry keys (Sentry DSN etc.) ---
echo "[preflight] verifying EXPO_PUBLIC_SENTRY_DSN exists in the EAS 'production' environment…"
if eas env:get --variable-name EXPO_PUBLIC_SENTRY_DSN --environment production >/dev/null 2>&1 \
  || eas env:list --environment production 2>/dev/null | grep -q "EXPO_PUBLIC_SENTRY_DSN"; then
  echo "[preflight] OK — EXPO_PUBLIC_SENTRY_DSN is present in production."
else
  echo "ABORT: EXPO_PUBLIC_SENTRY_DSN is NOT set in the EAS 'production' environment." >&2
  echo "       An OTA without it ships with Sentry / crash-reporting OFF." >&2
  echo "       Set it first, then re-run:" >&2
  echo "         eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <dsn> --visibility sensitive" >&2
  exit 1
fi

# --- Publish: ALWAYS --environment production, per-platform, non-interactive ---
echo "[publish] eas update  (branch=production, environment=production, platform=${PLATFORM})"
UPDATE_OUTPUT="$(eas update \
  --branch production \
  --environment production \
  --platform "${PLATFORM}" \
  --message "${MESSAGE}" \
  --non-interactive)"
echo "${UPDATE_OUTPUT}"

# Surface the update group ID for the operator / audit trail.
GROUP_LINE="$(printf '%s\n' "${UPDATE_OUTPUT}" | grep -iE "update group|group id" | head -1 || true)"
if [[ -n "${GROUP_LINE}" ]]; then
  echo "[done] ${GROUP_LINE}"
else
  echo "[done] published — see the eas.dev dashboard for the update group ID." >&2
fi
