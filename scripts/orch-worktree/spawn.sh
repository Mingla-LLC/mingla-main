#!/usr/bin/env bash
# scripts/orch-worktree/spawn.sh
#
# ORCH-WORKTREE SPAWN — set up a fresh isolated worktree for an ORCH.
#
# Per the worktree-per-ORCH workflow codified 2026-05-24
# (memory rule: feedback_worktree_per_orch_workflow.md;
# canonical doc: Mingla_Artifacts/WORKTREE_STRATEGY.md).
#
# Usage:
#   scripts/orch-worktree/spawn.sh <ORCH_ID> <short-kebab-label>
#
# Example:
#   scripts/orch-worktree/spawn.sh orch-0946 paywall-tier-copy-refresh
#
# Creates:
#   ~/Desktop/mingla-orchs/<ORCH_ID>-[<label>]/
#   Branched from origin/main as <ORCH_ID>-<label>
#   .env* files copied from ~/Desktop/mingla-main
#   node_modules symlinked (no real install unless package.json touched)
#
# Echoes worktree path, branch name, next available Metro port, suggested sim.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <ORCH_ID> <short-kebab-label>" >&2
  echo "Example: $0 orch-0946 paywall-tier-copy-refresh" >&2
  exit 1
fi

ORCH_ID="$1"
LABEL="$2"
ANCHOR="$HOME/Desktop/mingla-main"
ORCH_DIR="$HOME/Desktop/mingla-orchs"
WT="$ORCH_DIR/${ORCH_ID}-[${LABEL}]"
BRANCH="${ORCH_ID}-${LABEL}"

# Validate anchor checkout exists + is on main.
if [ ! -d "$ANCHOR/.git" ]; then
  echo "ERROR: anchor checkout not found at $ANCHOR" >&2
  exit 1
fi
ANCHOR_BRANCH="$(git -C "$ANCHOR" branch --show-current)"
if [ "$ANCHOR_BRANCH" != "main" ]; then
  echo "WARN: anchor checkout is on '$ANCHOR_BRANCH', not 'main'." >&2
  echo "      Run 'git -C $ANCHOR checkout main && git pull --ff-only' first," >&2
  echo "      or the worktree will branch off the wrong base." >&2
  exit 1
fi

# Ensure orch dir exists.
mkdir -p "$ORCH_DIR"

# Reject if the worktree path already exists.
if [ -e "$WT" ]; then
  echo "ERROR: worktree path already exists: $WT" >&2
  exit 1
fi

# Sync anchor with origin first so we branch off latest main.
echo "==> Syncing anchor with origin/main..."
git -C "$ANCHOR" fetch origin main --quiet
git -C "$ANCHOR" merge --ff-only origin/main --quiet || {
  echo "WARN: anchor cannot fast-forward to origin/main. Continuing with current local main." >&2
}

# Spawn the worktree off main with a fresh branch.
echo "==> Spawning worktree: $WT"
git -C "$ANCHOR" worktree add "$WT" -b "$BRANCH" main

# Copy .env files (gitignored, not in tree). Use a per-sub-project list.
echo "==> Copying .env files..."
ENV_FILES=(
  "app-mobile/.env"
  "app-mobile/.env.local"
  "mingla-business/.env"
  "mingla-business/.env.local"
  "mingla-admin/.env"
  "mingla-admin/.env.local"
  "mingla-marketing/.env"
  "mingla-marketing/.env.local"
  "supabase/.env"
)
for env_file in "${ENV_FILES[@]}"; do
  src="$ANCHOR/$env_file"
  dst="$WT/$env_file"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "    copied: $env_file"
  fi
done

# Symlink node_modules to avoid 5-min reinstalls per worktree.
# Per the memory rule: if the ORCH touches package.json, the implementor must
# remove the symlink and run a real `npm install` in the worktree.
echo "==> Symlinking node_modules from anchor..."
SUB_PROJECTS=(app-mobile mingla-business mingla-admin mingla-marketing packages)
for sub in "${SUB_PROJECTS[@]}"; do
  src="$ANCHOR/$sub/node_modules"
  dst="$WT/$sub/node_modules"
  if [ -d "$src" ] && [ ! -e "$dst" ]; then
    ln -s "$src" "$dst"
    echo "    symlinked: $sub/node_modules"
  fi
done

# Pick the next available Metro port (8081 default, increment if active worktrees exist).
ACTIVE_WORKTREE_COUNT=$(git -C "$ANCHOR" worktree list | wc -l | tr -d ' ')
# Anchor + this new worktree count as 2; first active ORCH gets 8082, etc.
# Default to 8081 for the first ORCH, 8082 for the second, etc.
METRO_PORT=$((8080 + ACTIVE_WORKTREE_COUNT - 1))

# Echo dispatch info.
echo ""
echo "============================================================"
echo "  ORCH WORKTREE SPAWNED"
echo "============================================================"
echo "  Worktree:  $WT"
echo "  Branch:    $BRANCH"
echo "  Metro:     --port $METRO_PORT"
echo ""
echo "  Suggested sim (orchestrator chooses based on availability):"
echo "    iPhone 17 Pro / iPhone 16 / Android emu / physical iPhone"
echo "    (or 'no sim — backend-only' for migration/edge-fn ORCHs)"
echo ""
echo "  Next: add this folder to your VS Code multi-root workspace:"
echo "    File → Add Folder to Workspace → $WT"
echo ""
echo "  When ORCH closes, reap with:"
echo "    scripts/orch-worktree/reap.sh \"$WT\""
echo "============================================================"
