#!/usr/bin/env bash
# scripts/orch-worktree/sweep.sh
#
# Issue #2300 — ORCH ARTIFACT SWEEP.
#
# reap.sh cleans ONE work item at close. This sweeps everything that already
# accumulated, or that a close missed because the session died mid-flight.
#
# Usage:
#   scripts/orch-worktree/sweep.sh              # dry run — prints, deletes NOTHING
#   scripts/orch-worktree/sweep.sh --apply      # actually reclaims
#
# DRY RUN IS THE DEFAULT AND THAT IS DELIBERATE. This script can delete tens of
# gigabytes across surfaces that OTHER LIVE SESSIONS are using. Read the plan
# first, every time.
#
# GOVERNING SAFETY RULE (SWEEP-HYGIENE, non-negotiable):
#   Mingla runs MULTIPLE concurrent sessions. This sweep DELETES ONLY WHAT IT
#   CAN PROVE IS DEAD and FLAGS everything else. There is no surface-wide
#   deletion, no `--all`, and no flag that widens the gate. Anything the gate
#   cannot clear is printed as KEPT with its reason, never removed.
#
# The gate lives in lib/artifact-liveness.sh — read the trap commentary there
# before changing any predicate. Three plausible-looking gates are wrong here.

set -uo pipefail

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --help|-h) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown argument '$arg' (expected --apply)" >&2; exit 1 ;;
  esac
done

ANCHOR="${ORCH_ANCHOR:-$HOME/Desktop/mingla-main}"
ORCH_DIR="${ORCH_DIR:-$HOME/Desktop/mingla-orchs}"
AVD_DIR="${ORCH_AVD_DIR:-$HOME/.android/avd}"
LIB="$(dirname "${BASH_SOURCE[0]}")/lib/artifact-liveness.sh"

[ -f "$LIB" ] || { echo "ERROR: missing $LIB" >&2; exit 1; }
# shellcheck source=lib/artifact-liveness.sh
. "$LIB"

if [ "$APPLY" = "1" ]; then MODE="APPLY — deleting"; else MODE="DRY RUN — nothing will be deleted"; fi
echo "============================================================"
echo "  ORCH ARTIFACT SWEEP  ($MODE)"
echo "============================================================"

REAPED=0; KEPT=0

say_kept()   { KEPT=$((KEPT+1));   printf '  KEPT    %-46s %s\n' "$1" "($2)"; }
say_reaped() { REAPED=$((REAPED+1)); printf '  REAPED  %-46s %s\n' "$1" "$2"; }

# --- 1. worktrees ---------------------------------------------------------
echo ""
echo "-- worktrees in $ORCH_DIR"
if [ -d "$ORCH_DIR" ]; then
  for d in "$ORCH_DIR"/*/; do
    [ -d "$d" ] || continue
    name="$(basename "$d")"
    reason="$(orch_worktree_reapable "${d%/}")"
    if [ "$reason" != "reapable" ]; then say_kept "$name" "$reason"; continue; fi
    if [ "$APPLY" = "1" ]; then
      bash "$(dirname "${BASH_SOURCE[0]}")/reap.sh" "${d%/}" >/dev/null 2>&1 \
        || { "$ORCH_GIT" -C "$ANCHOR" worktree remove --force "${d%/}" >/dev/null 2>&1 || rm -rf "${d%/}"; }
      say_reaped "$name" "worktree + branch"
    else
      say_reaped "$name" "would reap (worktree + branch)"
    fi
  done
fi

# --- 2. simulators --------------------------------------------------------
echo ""
echo "-- per-issue iOS simulators"
while IFS= read -r simname; do
  [ -n "$simname" ] || continue
  reason="$(orch_sim_reapable "$simname")"
  if [ "$reason" != "reapable" ]; then say_kept "$simname" "$reason"; continue; fi
  if [ "$APPLY" = "1" ]; then
    "$ORCH_XCRUN" simctl delete "$simname" >/dev/null 2>&1 && say_reaped "$simname" "simulator"
  else
    say_reaped "$simname" "would delete simulator"
  fi
done < <("$ORCH_XCRUN" simctl list devices 2>/dev/null | grep -oE 'ISSUE[0-9]+[A-Za-z0-9_-]*' | sort -u)

# --- 3. Android AVDs ------------------------------------------------------
echo ""
echo "-- per-issue Android AVDs"
if [ -d "$AVD_DIR" ]; then
  for avd in "$AVD_DIR"/ISSUE*.avd; do
    [ -e "$avd" ] || continue
    avdname="$(basename "$avd" .avd)"
    reason="$(orch_avd_reapable "$avdname")"
    if [ "$reason" != "reapable" ]; then say_kept "$avdname" "$reason"; continue; fi
    if [ "$APPLY" = "1" ]; then
      rm -rf "$avd" "${avd%.avd}.ini" && say_reaped "$avdname" "AVD"
    else
      say_reaped "$avdname" "would delete AVD"
    fi
  done
fi

echo ""
echo "============================================================"
if [ "$APPLY" = "1" ]; then
  echo "  reclaimed: $REAPED   kept: $KEPT"
else
  echo "  would reclaim: $REAPED   kept: $KEPT"
  echo "  Re-run with --apply to act on this plan."
fi
echo "============================================================"
