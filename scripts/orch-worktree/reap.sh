#!/usr/bin/env bash
# scripts/orch-worktree/reap.sh
#
# ORCH-WORKTREE REAP — tear down an ORCH worktree post-merge.
#
# Per the worktree-per-ORCH workflow (CLOSE Step 1.7).
# Memory rule: feedback_worktree_per_orch_workflow.md
# Canonical doc: Mingla_Artifacts/WORKTREE_STRATEGY.md
#
# Usage:
#   scripts/orch-worktree/reap.sh <worktree-path> [--force]
#
# Example:
#   scripts/orch-worktree/reap.sh ~/Desktop/mingla-orchs/orch-0946-[paywall-tier-copy-refresh]
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
ANCHOR="$HOME/Desktop/mingla-main"

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

# Safety 2: refuse if the branch is ahead of main (you'd lose commits).
git -C "$ANCHOR" fetch origin main --quiet
AHEAD=$(git -C "$WT" rev-list --count "origin/main..$BRANCH" 2>/dev/null || echo "?")
if [ "$AHEAD" != "0" ] && [ "$AHEAD" != "?" ] && [ "$FORCE" != "--force" ]; then
  echo "ERROR: branch '$BRANCH' is $AHEAD commit(s) ahead of origin/main." >&2
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
