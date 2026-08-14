#!/usr/bin/env bash
#
# #994 (was ORCH-1296) — canonical production OTA publisher for mingla-business.
# Invariant I-PROPOSED-994-PRODUCTION-OTA-ENV-BOUND.
#
# ALL production OTAs for this app MUST go through this script. Three reasons:
#
#   1. THE ENVIRONMENT FLAG. The publish CLI, run without the production
#      environment flag, resolves every EXPO_PUBLIC_* value from the operator's
#      LOCAL .env instead of the EAS 'production' environment — and then exits 0.
#      That has shipped five production incidents. On this app the Stripe key
#      falls back to the committed pk_test_ sandbox literal, the live-mode
#      handshake throws at boot, and the app sticks on the splash screen (#990).
#      This script always passes the flag, on the same visible command.
#
#   2. PRE-FLIGHT, PRESENCE BEFORE PREFIX. Every key this app silently defaults
#      on is checked in the EAS 'production' environment: first that the name is
#      PRESENT, then that the value is non-empty, then that its prefix is right.
#      Checking a prefix on a variable that does not exist reports the wrong
#      failure. REQUIRED misses abort; ADVISORY misses print and continue.
#
#   3. POST-PUBLISH VERIFICATION. The CLI's exit code is not evidence. This
#      script downloads the manifest the CDN will actually serve, per platform,
#      and asserts the expected extra keys carry real values. An unset variable
#      serializes as {} — not null, not absent — which is easy to skim past, so
#      that shape is checked first and named in the output.
#
# KEY TABLE (this app only — do NOT copy it to app-mobile; the two apps
# genuinely differ, and a copied table is a false abort one way and a false
# green the other):
#
#   EXPO_PUBLIC_SENTRY_DSN             REQUIRED  https:// + .ingest.  (app/_layout.tsx:122, static read)
#   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY REQUIRED  pk_live_             (app.config.js -> extra; the #990 brick)
#   EXPO_PUBLIC_GIPHY_API_KEY          REQUIRED  none                 (app.config.js -> extra; GIF tab)
#   EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN    ADVISORY  pk.                  (app.config.js -> extra; trip-page map)
#   EXPO_PUBLIC_MIXPANEL_TOKEN         ADVISORY  none                 (mixpanelService.ts:63, static read)
#   EXPO_PUBLIC_POSTHOG_KEY            ADVISORY  phc_                 (app.config.js carries a committed
#                                                                      literal fallback, so it can NEVER be
#                                                                      absent — it is deliberately not a
#                                                                      tripwire on this app)
#
# WHY MAPBOX IS ADVISORY HERE. SPEC §3.4-V1 made its class conditional on the
# variable existing in the EAS 'production' environment. The read-only check on
# 2026-08-09 found it ABSENT from this app's production environment, so a
# REQUIRED class would abort every correct publish. It also stays out of the
# post-publish expectation table for the same reason. If it is ever provisioned,
# promote it in both places together.
#
# OTA IS ENABLED (resolved). Production business OTA ships pure-JS /
#   zero-native-module-delta changes through THIS script. The 2026-07-02
#   stuck-on-splash brick (COMMS-0063/0052) was a NATIVE-MODULE DELTA — the OTA
#   bundle referenced posthog-react-native, absent from the shipped binary —
#   plus a wrong-key handshake (#990). Both are solved. Keep
#   `eas update:roll-back-to-embedded` ready. A change that ADDS/BUMPS a native
#   module or touches app.json / native config needs a full `eas build`, not an
#   OTA.
#
# Usage: mingla-business/scripts/ota/publish-production-ota.sh <ios|android> "<update message>"

set -euo pipefail

# TEST SEAM (do not repurpose). The publish binary is overridable ONLY so the
# tester can drive this wrapper against a stub without publishing. The DEFAULT
# is the real binary, and the #994 strict-grep gate asserts that default, so the
# seam cannot become a bypass. There is deliberately no rehearsal/no-op mode: a
# mode that does not publish would itself become the thing people run.
MINGLA_EAS_BIN="${MINGLA_EAS_BIN:-eas}"

APP_LABEL="mingla-business"
VERIFY_APP="business"

PLATFORM="${1:-}"
MESSAGE="${2:-}"

usage() {
  echo "Usage: $0 <ios|android> \"<update message>\"" >&2
}

if [ "${PLATFORM}" != "ios" ] && [ "${PLATFORM}" != "android" ]; then
  echo "ERROR: platform must be 'ios' or 'android' — one platform per run; the combined form is rejected." >&2
  usage
  exit 1
fi

# A WHITESPACE-ONLY MESSAGE IS NOT A MESSAGE. `[ -z "   " ]` is FALSE, so a run
# labelled "   " used to sail through and publish with a blank message, costing
# the update list its audit trail — the one record of what a given OTA contained
# (#994 tester P3-994-9). Strip whitespace before the emptiness test.
MESSAGE_STRIPPED="$(printf '%s' "${MESSAGE}" | tr -d '[:space:]')"
if [ -z "${MESSAGE_STRIPPED}" ]; then
  echo "ERROR: a non-empty update message is required (whitespace only is not a message)." >&2
  echo "       The message is the update list's audit trail — it is how anyone later works out" >&2
  echo "       what a given production OTA actually shipped." >&2
  usage
  exit 1
fi

# Run from the mingla-business root (where eas.json lives) regardless of CWD.
#
# BASH_SOURCE is DELIBERATELY NOT symlink-resolved. An invocation through a link
# lands APP_ROOT in the link's directory and this script then refuses to run,
# which is the correct outcome: the tracked path is the only reviewed path, and a
# link can point at any checkout on the machine — including a work-in-progress
# worktree whose bundle nobody has reviewed. Resolving the link would make that
# invocation SUCCEED and publish that bundle to real users.
#
# What was wrong before was only the MESSAGE: it blamed "the verifier is missing"
# and sent the reader hunting for a deleted file that is present (#994 tester
# P4-994-11). The abort below names the actual cause instead.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${APP_ROOT}/.." && pwd)"
VERIFIER="${REPO_ROOT}/scripts/ota/verify-published-manifest.mjs"

if [ ! -f "${APP_ROOT}/app.config.js" ] || [ ! -f "${VERIFIER}" ]; then
  echo "ABORT [#994] this script must be run at its REAL tracked path inside the repo checkout." >&2
  if [ -L "${BASH_SOURCE[0]}" ]; then
    echo "       Confirmed cause: this invocation came through a SYMLINK (${BASH_SOURCE[0]})." >&2
  else
    echo "       Likely cause: the script was copied or moved out of the repo checkout." >&2
  fi
  echo "       Paths resolved relative to the invocation, NOT to the checkout:" >&2
  echo "         APP_ROOT = ${APP_ROOT}   (expected a directory named ${APP_LABEL})" >&2
  echo "         VERIFIER = ${VERIFIER}" >&2
  echo "       This is NOT a missing-file bug, and the link is not followed on purpose: a link" >&2
  echo "       can point at any checkout on this machine, so following it would publish an" >&2
  echo "       unreviewed bundle to real users. Run the tracked path directly:" >&2
  echo "         ${APP_LABEL}/scripts/ota/publish-production-ota.sh <ios|android> \"<summary>\"" >&2
  exit 1
fi

cd "${APP_ROOT}"

TMPBASE="${TMPDIR:-/tmp}"
ERRLOG="$(mktemp "${TMPBASE}/mingla-ota-err.XXXXXX")"
VALLOG="$(mktemp "${TMPBASE}/mingla-ota-val.XXXXXX")"
ENVLIST="$(mktemp "${TMPBASE}/mingla-ota-env.XXXXXX")"
JSONLOG="$(mktemp "${TMPBASE}/mingla-ota-json.XXXXXX")"
trap 'rm -f "${ERRLOG}" "${VALLOG}" "${ENVLIST}" "${JSONLOG}"' EXIT

# --- Pre-flight -------------------------------------------------------------
# One environment listing for every key (not one call per key). Presence is read
# from THIS listing; a value read that fails is an unreadable value, never an
# absent variable — those are different failures and must not be conflated.
echo "[preflight] reading the EAS 'production' environment for ${APP_LABEL}…"
if ! ${MINGLA_EAS_BIN} env:list --environment production >"${ENVLIST}" 2>"${ERRLOG}"; then
  echo "ABORT [#994 preflight] could not list the EAS 'production' environment for ${APP_LABEL}." >&2
  echo "       Without it, presence cannot be established and no publish is safe." >&2
  cat "${ERRLOG}" >&2
  exit 1
fi
if [ ! -s "${ENVLIST}" ]; then
  echo "ABORT [#994 preflight] the EAS 'production' environment listing came back EMPTY." >&2
  echo "       An empty listing would make every presence check below pass for the wrong reason." >&2
  exit 1
fi

# What each key costs when it is missing. Used by both the abort and the warn.
key_consequence() {
  case "$1" in
    EXPO_PUBLIC_SENTRY_DSN)
      echo "crash reporting would be OFF in this OTA" ;;
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY)
      echo "the app would fall back to the committed pk_test_ sandbox literal and brick on the splash screen (#990)" ;;
    EXPO_PUBLIC_GIPHY_API_KEY)
      echo "the cover-picker GIF tab would silently degrade" ;;
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN)
      echo "the public trip page would hide its map" ;;
    EXPO_PUBLIC_MIXPANEL_TOKEN)
      echo "Mixpanel would be dark in this OTA" ;;
    EXPO_PUBLIC_POSTHOG_KEY)
      echo "PostHog analytics would be dark in this OTA" ;;
    *)
      echo "this OTA would ship without it" ;;
  esac
}

# preflight_key <NAME> <required|advisory> <PREFIX or "-">
#
# ORDER IS FIXED AND MAY NOT BE REARRANGED:
#   1 PRESENCE (from the single listing above)
#   2 VALUE READ
#   3 NON-EMPTY (a present-but-empty value is not presence)
#   4 PREFIX (only when the value was actually readable)
#   5 UNREADABLE-VALUE HONESTY (never report a prefix check that did not run)
#   6 LOG THE PREFIX (never the secret)
preflight_key() {
  KEY_NAME="$1"
  KEY_CLASS="$2"
  KEY_PREFIX="$3"

  # 1 — PRESENCE.
  if ! grep -q "^${KEY_NAME}=" "${ENVLIST}"; then
    if [ "${KEY_CLASS}" = "required" ]; then
      echo "ABORT [#994 preflight] ${KEY_NAME} is NOT set in the EAS 'production' environment for ${APP_LABEL}." >&2
      echo "       Publishing now would ship an OTA where $(key_consequence "${KEY_NAME}")." >&2
      if [ "${KEY_NAME}" = "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY" ]; then
        echo "       On mingla-business that bricks the splash (#990); on app-mobile checkout dies" >&2
        echo "       silently while the app looks completely normal (2026-08-06)." >&2
      fi
      echo "       Set it first, then re-run:" >&2
      echo "         eas env:create --environment production --name ${KEY_NAME} --value <value> --visibility sensitive" >&2
      exit 1
    fi
    echo "[preflight] WARN ${KEY_NAME} is not set in the EAS 'production' environment — $(key_consequence "${KEY_NAME}"). Continuing (advisory)."
    return 0
  fi

  # 2 — VALUE READ. A secret-visibility variable cannot be read back at all.
  KEY_VALUE=""
  KEY_READABLE="no"
  if ${MINGLA_EAS_BIN} env:get production --variable-name "${KEY_NAME}" --non-interactive >"${VALLOG}" 2>"${ERRLOG}"; then
    KEY_VALUE="$(grep "^${KEY_NAME}=" "${VALLOG}" | head -1 | sed "s/^${KEY_NAME}=//" || true)"
    case "${KEY_VALUE}" in
      "") KEY_READABLE="no" ;;
      '*****'*) KEY_READABLE="no" ;;
      *) KEY_READABLE="yes" ;;
    esac
  fi

  # 5 — UNREADABLE-VALUE HONESTY (checked here so 3 and 4 only run on real values).
  if [ "${KEY_READABLE}" != "yes" ]; then
    if grep -q "^${KEY_NAME}=\*\*\*\*\*" "${ENVLIST}"; then
      echo "[preflight] ${KEY_NAME}: PRESENT, visibility=secret — value unreadable, prefix NOT verified."
      return 0
    fi
    if [ "${KEY_CLASS}" = "required" ]; then
      # 3 — NON-EMPTY. Present but empty is not presence.
      echo "ABORT [#994 preflight] ${KEY_NAME} is present in the EAS 'production' environment but its value is EMPTY." >&2
      echo "       An empty value ships exactly like an absent one: $(key_consequence "${KEY_NAME}")." >&2
      echo "       Fix the value in the EAS 'production' environment, then re-run." >&2
      exit 1
    fi
    echo "[preflight] WARN ${KEY_NAME} is present but its value could not be read — prefix NOT verified. Continuing (advisory)."
    return 0
  fi

  # 4 — PREFIX.
  if [ "${KEY_PREFIX}" != "-" ]; then
    case "${KEY_VALUE}" in
      "${KEY_PREFIX}"*) : ;;
      *)
        if [ "${KEY_CLASS}" = "required" ]; then
          echo "ABORT [#994 preflight] ${KEY_NAME} is present but does not start with '${KEY_PREFIX}' (got '$(printf '%s' "${KEY_VALUE}" | cut -c1-8)…')." >&2
          if [ "${KEY_NAME}" = "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY" ]; then
            echo "       The backend is in live mode. A pk_test_ key against a live backend is the #990 brick." >&2
          else
            echo "       With a wrong-shaped value, $(key_consequence "${KEY_NAME}")." >&2
          fi
          echo "       Fix the value in the EAS 'production' environment, then re-run." >&2
          exit 1
        fi
        echo "[preflight] WARN ${KEY_NAME} does not start with '${KEY_PREFIX}' — $(key_consequence "${KEY_NAME}"). Continuing (advisory)."
        return 0
        ;;
    esac
  fi

  # The Sentry DSN carries a second contract: it must be a real ingest endpoint.
  if [ "${KEY_NAME}" = "EXPO_PUBLIC_SENTRY_DSN" ]; then
    case "${KEY_VALUE}" in
      *.ingest.*) : ;;
      *)
        echo "ABORT [#994 preflight] ${KEY_NAME} does not look like a Sentry ingest DSN (no '.ingest.' host)." >&2
        echo "       Crash reporting would be silently dead in this OTA." >&2
        exit 1
        ;;
    esac
    echo "[preflight] OK ${KEY_NAME} = $(printf '%s' "${KEY_VALUE}" | sed -E 's#^(https?://)[^@]*@([^/]+)/.*#\1…@\2/…#') (${#KEY_VALUE} chars)"
    return 0
  fi

  # 6 — LOG THE PREFIX, never the secret.
  echo "[preflight] OK ${KEY_NAME} = $(printf '%s' "${KEY_VALUE}" | cut -c1-8)… (${#KEY_VALUE} chars)"
}

preflight_key EXPO_PUBLIC_SENTRY_DSN             required https://
preflight_key EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY required pk_live_
preflight_key EXPO_PUBLIC_GIPHY_API_KEY          required -
preflight_key EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN    advisory pk.
preflight_key EXPO_PUBLIC_MIXPANEL_TOKEN         advisory -
preflight_key EXPO_PUBLIC_POSTHOG_KEY            advisory phc_

# --- Publish ----------------------------------------------------------------
# --json makes stdout pure JSON and routes CLI logs to stderr, so the update
# group comes out of parsed JSON instead of a grep over human text.
echo "[publish] ${APP_LABEL} (branch=production, environment=production, platform=${PLATFORM})"
if ! ${MINGLA_EAS_BIN} update \
  --branch production \
  --environment production \
  --platform "${PLATFORM}" \
  --message "${MESSAGE}" \
  --json --non-interactive >"${JSONLOG}" 2>"${ERRLOG}"; then
  echo "ABORT [#994 publish] the publish command failed for ${APP_LABEL} ${PLATFORM}." >&2
  cat "${ERRLOG}" >&2
  exit 1
fi
cat "${ERRLOG}" >&2

# --- Post-publish verification against the SERVED manifest -------------------
VERIFY_EXIT=0
node "${VERIFIER}" \
  --update-json "${JSONLOG}" \
  --app "${VERIFY_APP}" \
  --platform "${PLATFORM}" \
  --message "${MESSAGE}" || VERIFY_EXIT=$?

if [ "${VERIFY_EXIT}" -ne 0 ]; then
  echo "[#994] post-publish verification did NOT pass (exit ${VERIFY_EXIT}). Treat this OTA as broken." >&2
  exit "${VERIFY_EXIT}"
fi
