#!/usr/bin/env bash
# scripts/orch-worktree/lib/artifact-liveness.sh
#
# Issue #2300 — the ONE correct answer to "is this per-issue artifact dead?"
#
# Sourceable library. Every function is pure w.r.t. the filesystem except the
# explicit probes, and every external command is injectable so the suites in
# scripts/issue-2300/ can shim `gh`, `git` and `xcrun` without a network, a
# GitHub token, or a simulator.
#
# ---------------------------------------------------------------------------
# WHY THIS FILE EXISTS: three liveness gates that all LOOK right and are all
# WRONG in this repo. Each one was measured on 2026-08-18, not theorised.
# ---------------------------------------------------------------------------
#
# TRAP 1 — `git merge-base --is-ancestor <branch> origin/main`
#   Reports a FRESHLY-SPAWNED worktree as merged, because spawn.sh branches off
#   `main`, so a worktree that has not committed yet has HEAD == main and is
#   trivially an ancestor. On 2026-08-18 this flagged #2211, #2245, #2267 and
#   #2291 as reapable while all four were live with simulators booted. Acting on
#   it destroys another session's work. NEVER use ancestry alone.
#
# TRAP 2 — `git rev-list --count origin/main..<branch>`
#   Reports EVERY merged branch as ahead, because this repo squash-merges: the
#   branch's commits are never ancestors of main. `origin/2272-web-dead-paths`
#   measured 1 commit "ahead" with its PR merged and its issue closed. This is
#   the gate reap.sh shipped with, and it is the mechanical reason 46 worktrees
#   accumulated: the normal reap path ALWAYS failed, so the only way through was
#   `--force`, which also disables the uncommitted-changes check. A safety that
#   always fires is a safety everyone learns to bypass.
#
# TRAP 3 — `find <dir> -maxdepth 0 -newermt '-7 days'`
#   `bfs`, the find on the operator's Mac, does NOT accept a relative timestamp.
#   It writes "Invalid timestamp" to stderr and returns EMPTY stdout, so the
#   idiom `[ -z "$(find ... -newermt ...)" ] && rm -rf "$dir"` evaluates TRUE for
#   EVERY directory and deletes all of them. This fired during the #2300 cleanup
#   itself and wiped the whole npx cache instead of the 7-day-stale part.
#   Harmless there; catastrophic guarding a worktree. Idle is computed here from
#   an absolute mtime epoch, and a probe that cannot determine mtime returns
#   "recently touched" — fail-closed, never fail-open.
#
# THE ONLY CORRECT WORKTREE GATE is the conjunction of all four:
#   1. the issue is CLOSED
#   2. the branch's PR state is MERGED   (survives squash-merge; see TRAP 2)
#   3. `git status --porcelain` is empty (no uncommitted work)
#   4. nothing under the worktree root has been modified inside the idle window
#
# Simulators and AVDs additionally require a RUNNING-STATE probe: a Booted
# simulator or a live qemu AVD belongs to another session, whatever its issue
# says.

set -uo pipefail

# Injectable binaries. Tests override these; production uses PATH.
ORCH_GH="${ORCH_GH:-gh}"
ORCH_GIT="${ORCH_GIT:-git}"
ORCH_XCRUN="${ORCH_XCRUN:-xcrun}"
ORCH_PS="${ORCH_PS:-ps}"

# Idle window in seconds. A worktree touched inside this window is treated as
# live regardless of every other signal.
ORCH_IDLE_SECONDS="${ORCH_IDLE_SECONDS:-21600}"   # 6 hours

# Injectable clock so tests are deterministic (no Date.now() drift).
orch_now_epoch() {
  if [ -n "${ORCH_NOW_EPOCH:-}" ]; then printf '%s\n' "$ORCH_NOW_EPOCH"; else date +%s; fi
}

# Portable mtime. BSD stat (macOS) and GNU stat (CI) disagree on flags, so try
# both. TRAP 3: if NEITHER works we must NOT report "old" — an unknown mtime is
# reported as `now`, which makes the caller treat the target as live.
orch_mtime_epoch() {
  local target="$1" m=""
  m="$(stat -f %m "$target" 2>/dev/null)" || m=""
  if [ -z "$m" ]; then m="$(stat -c %Y "$target" 2>/dev/null)" || m=""; fi
  if [ -z "$m" ]; then orch_now_epoch; return 0; fi
  printf '%s\n' "$m"
}

# Newest mtime anywhere in the worktree, excluding node_modules and .git (both
# churn for reasons unrelated to a human working in the tree).
orch_newest_mtime() {
  local root="$1" newest=0 m
  newest="$(orch_mtime_epoch "$root")"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    m="$(orch_mtime_epoch "$f")"
    [ "$m" -gt "$newest" ] 2>/dev/null && newest="$m"
  done < <(find "$root" -maxdepth 2 \
             \( -name node_modules -o -name .git \) -prune -o \
             -type f -print 2>/dev/null | head -400)
  printf '%s\n' "$newest"
}

# 0 = idle beyond the window, 1 = touched recently (fail-closed on any doubt).
orch_is_idle() {
  local root="$1" now newest age
  now="$(orch_now_epoch)"
  newest="$(orch_newest_mtime "$root")"
  case "$newest" in (*[!0-9]*|'') return 1 ;; esac
  age=$(( now - newest ))
  [ "$age" -ge "$ORCH_IDLE_SECONDS" ]
}

# Issue number from a worktree dir name or branch: leading digits only.
# "2211-bigtext-scroll" -> 2211 ; "2262-[composer-responsive-layout]" -> 2262
orch_issue_number() {
  printf '%s\n' "$1" | sed -E 's|^.*/||' | grep -oE '^[0-9]+' | head -1
}

# CLOSED / OPEN / UNKNOWN. Anything that is not verifiably CLOSED is UNKNOWN,
# and UNKNOWN never authorises a delete.
orch_issue_state() {
  local n="$1" s=""
  [ -n "$n" ] || { printf 'UNKNOWN\n'; return 0; }
  s="$("$ORCH_GH" issue view "$n" --json state -q .state 2>/dev/null)" || s=""
  case "$s" in
    CLOSED|OPEN) printf '%s\n' "$s" ;;
    *) printf 'UNKNOWN\n' ;;
  esac
}

# MERGED / OPEN / NONE / UNKNOWN for a branch's PR.
# THIS is the squash-merge-safe replacement for `rev-list --count` (TRAP 2).
orch_branch_pr_state() {
  local br="$1" out=""
  [ -n "$br" ] || { printf 'UNKNOWN\n'; return 0; }
  out="$("$ORCH_GH" pr list --head "$br" --state all --json state -q '.[0].state' 2>/dev/null)" || out=""
  case "$out" in
    MERGED|OPEN|CLOSED) printf '%s\n' "$out" ;;
    null|"") printf 'NONE\n' ;;
    *) printf 'UNKNOWN\n' ;;
  esac
}

# THE worktree gate. Prints a one-word reason; exit 0 only when reapable.
orch_worktree_reapable() {
  local wt="$1" br issue state pr

  [ -d "$wt" ] || { echo "missing"; return 1; }

  br="$("$ORCH_GIT" -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)" || br=""
  [ -n "$br" ] && [ "$br" != "HEAD" ] || { echo "detached-or-nonrepo"; return 1; }
  case "$br" in main|master|Seth) echo "protected-branch"; return 1 ;; esac

  # Uncommitted work is disqualifying on its own and is checked FIRST, because
  # it is the cheapest probe and the most expensive mistake.
  if [ -n "$("$ORCH_GIT" -C "$wt" status --porcelain 2>/dev/null)" ]; then
    echo "dirty"; return 1
  fi

  issue="$(orch_issue_number "$wt")"
  state="$(orch_issue_state "$issue")"
  [ "$state" = "CLOSED" ] || { echo "issue-$state"; return 1; }

  pr="$(orch_branch_pr_state "$br")"
  [ "$pr" = "MERGED" ] || { echo "pr-$pr"; return 1; }

  orch_is_idle "$wt" || { echo "recently-touched"; return 1; }

  echo "reapable"; return 0
}

# --- Simulator ------------------------------------------------------------
# Booted is disqualifying no matter what the issue says: a Booted device is
# being driven by a live session right now.
orch_sim_state() {
  local name="$1" line
  line="$("$ORCH_XCRUN" simctl list devices 2>/dev/null | grep -F "$name (" | head -1)"
  [ -n "$line" ] || { printf 'ABSENT\n'; return 0; }
  case "$line" in
    *"(Booted)"*) printf 'Booted\n' ;;
    *"(Shutdown)"*) printf 'Shutdown\n' ;;
    *) printf 'UNKNOWN\n' ;;
  esac
}

orch_sim_reapable() {
  local name="$1" issue state st
  issue="$(printf '%s\n' "$name" | grep -oE '[0-9]+' | head -1)"
  [ -n "$issue" ] || { echo "unnamed"; return 1; }
  st="$(orch_sim_state "$name")"
  [ "$st" = "Shutdown" ] || { echo "sim-$st"; return 1; }
  state="$(orch_issue_state "$issue")"
  [ "$state" = "CLOSED" ] || { echo "issue-$state"; return 1; }
  echo "reapable"; return 0
}

# --- Android AVD ----------------------------------------------------------
# A qemu process with `-avd <name>` on its command line owns that AVD.
orch_avd_running() {
  local name="$1"
  "$ORCH_PS" -Ao args 2>/dev/null | grep -F -- "-avd $name" | grep -qv grep
}

orch_avd_reapable() {
  local name="$1" issue state
  issue="$(printf '%s\n' "$name" | grep -oE '[0-9]+' | head -1)"
  [ -n "$issue" ] || { echo "unnamed"; return 1; }
  if orch_avd_running "$name"; then echo "avd-running"; return 1; fi
  state="$(orch_issue_state "$issue")"
  [ "$state" = "CLOSED" ] || { echo "issue-$state"; return 1; }
  echo "reapable"; return 0
}
