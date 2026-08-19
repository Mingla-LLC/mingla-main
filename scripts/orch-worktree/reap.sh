#!/usr/bin/env bash
# scripts/orch-worktree/reap.sh
#
# ORCH-WORKTREE REAP — tear down an ORCH worktree post-merge.
#
# Per the worktree-per-ORCH workflow (CLOSE Step 1.7).
# Memory rule: feedback_worktree_per_orch_workflow.md
# Canonical doc: docs/WORKTREE_STRATEGY.md
#
# Usage:
#   scripts/orch-worktree/reap.sh <worktree-path> [--force]
#
# Example:
#   scripts/orch-worktree/reap.sh ~/Desktop/mingla-orchs/orch-0946-paywall-tier-copy-refresh
#
# Path shape: worktrees are bracket-free as of #2210 (`<ORCH_ID>-<label>`, same
# as the branch). This script is fully path-agnostic — it takes the path as $1
# and quotes "$WT" everywhere — so it reaps the LEGACY bracketed
# `<ORCH_ID>-[<label>]` worktrees spawned before #2210 exactly as well. Those are
# not migrated on purpose (see spawn.sh); reap them normally as their issues
# close and the population drains itself.
#
# Safety:
#   - Refuses to reap if the worktree has uncommitted changes.
#   - Use --force ONLY if you've explicitly confirmed nothing of value will be lost.
#   - Refuses if the worktree branch is not merged to main (you'd lose commits).

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <worktree-path> [--force]" >&2
  exit 1
fi

WT="$1"
FORCE="${2:-}"
# ORCH_ANCHOR override exists so scripts/issue-2300/ can drive this script
# against a disposable repo instead of the operator's real checkout.
ANCHOR="${ORCH_ANCHOR:-$HOME/Desktop/mingla-main}"

if [ ! -d "$WT" ]; then
  echo "ERROR: worktree path not found: $WT" >&2
  exit 1
fi

# Get the branch name.
BRANCH=$(git -C "$WT" branch --show-current)
if [ -z "$BRANCH" ]; then
  echo "ERROR: worktree has no branch checked out: $WT" >&2
  exit 1
fi

# Safety 1: refuse if the worktree is dirty (unless --force).
DIRTY="$(git -C "$WT" status --porcelain)"
if [ -n "$DIRTY" ] && [ "$FORCE" != "--force" ]; then
  echo "ERROR: worktree has uncommitted changes:" >&2
  echo "$DIRTY" >&2
  echo "" >&2
  echo "Either commit/push them, or re-run with --force to discard." >&2
  exit 1
fi

# Safety 2: refuse if the branch carries work that is not in main yet.
#
# issue #2300 — THIS CHECK USED TO BE `rev-list --count origin/main..$BRANCH`
# AND IT REJECTED EVERY LEGITIMATELY MERGED BRANCH. This repo squash-merges, so
# a merged branch's commits are never ancestors of main and the count is always
# >= 1. Measured 2026-08-18: `origin/2272-web-dead-paths` counted 1 commit
# "ahead" with its PR merged and its issue closed.
#
# The consequence was not a nuisance, it was the leak. The documented reap path
# always failed, so the only way through was `--force` — which ALSO disables the
# uncommitted-changes check above. Operators learned to skip reaping entirely,
# and 46 worktrees (63 GB, 53 real node_modules) accumulated until the Mac hit
# 3.5 GB free. A safety that always fires is a safety everyone bypasses.
#
# Correct test: the branch is safe to delete if its PR is MERGED (squash-safe),
# OR its tip is genuinely an ancestor of main (fast-forward / rebase merge).
git -C "$ANCHOR" fetch origin main --quiet
MERGED_PR="$("${ORCH_GH:-gh}" pr list --head "$BRANCH" --state all --json state -q '.[0].state' 2>/dev/null || echo "")"
IS_ANCESTOR=1
git -C "$ANCHOR" merge-base --is-ancestor "$BRANCH" origin/main 2>/dev/null && IS_ANCESTOR=0

if [ "$MERGED_PR" != "MERGED" ] && [ "$IS_ANCESTOR" != "0" ] && [ "$FORCE" != "--force" ]; then
  AHEAD=$(git -C "$WT" rev-list --count "origin/main..$BRANCH" 2>/dev/null || echo "?")
  echo "ERROR: branch '$BRANCH' has no MERGED pull request and is not an ancestor of origin/main." >&2
  echo "       (rev-list reports $AHEAD commit(s) ahead, which on its own proves nothing here —" >&2
  echo "        this repo squash-merges, so merged branches always read as ahead.)" >&2
  echo "       Push + merge the PR before reaping, or re-run with --force to discard." >&2
  exit 1
fi

# Safety 3: never reap main or Seth.
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "Seth" ]; then
  echo "ERROR: refusing to reap protected branch: $BRANCH" >&2
  exit 1
fi

# Remove worktree, local branch, remote branch, prune.
echo "==> Removing worktree: $WT"
if [ "$FORCE" = "--force" ]; then
  git -C "$ANCHOR" worktree remove --force "$WT"
else
  git -C "$ANCHOR" worktree remove "$WT"
fi

echo "==> Deleting local branch: $BRANCH"
git -C "$ANCHOR" branch -D "$BRANCH" 2>/dev/null || echo "    (already gone)"

echo "==> Deleting remote branch: origin/$BRANCH (best-effort)"
git -C "$ANCHOR" push origin --delete "$BRANCH" 2>/dev/null || echo "    (already gone or never pushed)"

# issue #2300 — reap the OTHER per-issue artifacts. Until now CLOSE reclaimed
# the worktree folder and nothing else, so every closed work item left behind a
# 1-3 GB iOS simulator and a 1-5 GB Android AVD forever. Measured 2026-08-18:
# 15 orphaned simulators (24 GB) and 4 AVDs (9.9 GB), including devices for
# issues closed weeks earlier.
#
# Ownership-scoped per the SWEEP-HYGIENE governing rule: a Booted simulator or a
# live qemu AVD belongs to another session and is NEVER touched, whatever its
# name says.
LIB="$(dirname "${BASH_SOURCE[0]}")/lib/artifact-liveness.sh"
if [ -f "$LIB" ]; then
  # shellcheck source=lib/artifact-liveness.sh
  . "$LIB"
  ISSUE_NUM="$(orch_issue_number "$BRANCH")"
  if [ -n "$ISSUE_NUM" ]; then
    echo "==> Reaping per-issue simulators for #$ISSUE_NUM"
    while IFS= read -r simname; do
      [ -n "$simname" ] || continue
      reason="$(orch_sim_reapable "$simname")"
      if [ "$reason" = "reapable" ]; then
        xcrun simctl delete "$simname" >/dev/null 2>&1 && echo "    deleted sim: $simname"
      else
        echo "    kept sim: $simname ($reason)"
      fi
    done < <(xcrun simctl list devices 2>/dev/null \
               | grep -oE "ISSUE${ISSUE_NUM}[A-Za-z0-9_-]*" | sort -u)

    echo "==> Reaping per-issue Android AVDs for #$ISSUE_NUM"
    for avd in "$HOME"/.android/avd/ISSUE"${ISSUE_NUM}"*.avd; do
      [ -e "$avd" ] || continue
      avdname="$(basename "$avd" .avd)"
      reason="$(orch_avd_reapable "$avdname")"
      if [ "$reason" = "reapable" ]; then
        rm -rf "$avd" "${avd%.avd}.ini" && echo "    deleted AVD: $avdname"
      else
        echo "    kept AVD: $avdname ($reason)"
      fi
    done
  fi
fi

echo "==> Pruning stale worktree registrations"
git -C "$ANCHOR" worktree prune

echo ""
echo "============================================================"
echo "  WORKTREE REAPED"
echo "============================================================"
echo "  Worktree:  $WT  (gone)"
echo "  Branch:    $BRANCH  (local + remote deleted)"
echo ""
echo "  Don't forget: remove the folder from your VS Code"
echo "  multi-root workspace via File → Remove Folder from Workspace."
echo "============================================================"
