#!/usr/bin/env bash
# scripts/orch-worktree/spawn.sh
#
# ORCH-WORKTREE SPAWN — set up a fresh isolated worktree for an ORCH.
#
# Per the worktree-per-ORCH workflow codified 2026-05-24
# (memory rule: feedback_worktree_per_orch_workflow.md;
# canonical doc: docs/WORKTREE_STRATEGY.md).
#
# Usage:
#   scripts/orch-worktree/spawn.sh <ORCH_ID> <short-kebab-label>
#
# Example:
#   scripts/orch-worktree/spawn.sh orch-0946 paywall-tier-copy-refresh
#
# Creates:
#   ~/Desktop/mingla-orchs/<ORCH_ID>-<label>/   (bracket-free — see #2210)
#   Branched from origin/main as <ORCH_ID>-<label>
#   .env* files copied from ~/Desktop/mingla-main
#   node_modules symlinked (no real install unless package.json touched)
#
# Echoes worktree path, branch name, next available Metro port, suggested sim.

set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <ORCH_ID> <short-kebab-label> [--install]" >&2
  echo "Example: $0 orch-0946 paywall-tier-copy-refresh" >&2
  echo "  --install  real \`npm ci\` instead of node_modules symlinks, so the" >&2
  echo "             worktree can actually RUN the app (#1544). ~1 min." >&2
  exit 1
fi
if [ "$#" -eq 3 ] && [ "$3" != "--install" ]; then
  echo "ERROR: unknown third argument '$3' (expected --install)." >&2
  exit 1
fi

ORCH_ID="$1"
LABEL="$2"
ANCHOR="$HOME/Desktop/mingla-main"
ORCH_DIR="$HOME/Desktop/mingla-orchs"
# #2210 — the directory name matches the branch name EXACTLY. It used to be
# "${ORCH_ID}-[${LABEL}]". The square brackets made CMake's file(GLOB ...) match
# ZERO files and exit 0 inside the worktree, so every local Android/native build
# got an empty source list (see assert-safe-worktree-path.sh for the mechanism).
#
# DO NOT ADD A MIGRATION FOR EXISTING BRACKETED WORKTREES. Renaming a live
# worktree in place requires `git worktree repair` and breaks any session
# already holding that path — open editors, a running Metro, a background build
# — for zero benefit, because git keeps using whatever absolute path it
# recorded at `worktree add` time. The bracketed population drains on its own as
# those issues close and their worktrees are reaped. Leave them alone.
WT="$ORCH_DIR/${ORCH_ID}-${LABEL}"
BRANCH="${ORCH_ID}-${LABEL}"

# #2210 GUARD — assert the path we are about to create is safe for build tools
# BEFORE touching the anchor, so a hostile label costs nothing but an error.
# A missing guard is a HARD FAIL, never a silent skip (the repo has produced six
# classes of dark gate; a skippable guard is the seventh).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PATH_GUARD="$SCRIPT_DIR/assert-safe-worktree-path.sh"
if [ ! -f "$PATH_GUARD" ]; then
  echo "ERROR: path guard missing at $PATH_GUARD — refusing to spawn (#2210)." >&2
  exit 1
fi
bash "$PATH_GUARD" "$WT"

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

# Ensure the anchor-hygiene guard is active (ORCH-1185). core.hooksPath lives in
# the shared .git/config, so setting it on the anchor covers every worktree too.
# Blocks direct commits on `main` — enforces "spawn a worktree before any file".
echo "==> Asserting anchor-hygiene guard (no direct commits on main)..."
git -C "$ANCHOR" config core.hooksPath .githooks
chmod +x "$ANCHOR/.githooks/"* 2>/dev/null || true

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
#
# #1544 — THE SYMLINK BREAKS EVERY RUNTIME `import()` IN THIS WORKTREE.
# It points at an ABSOLUTE path in the anchor, which escapes the project root,
# so Metro emits async chunk paths like `../../../mingla-main/...` that flatten
# to `./mingla-main/mingla-business/node_modules/...` and fail to resolve. The
# app boots and then red-screens on the first lazy route.
#
# The trap that kept this unsolved for weeks: EVERY STATIC BUNDLE PROBE PASSES
# ANYWAY. A clean `expo export`, a green `/index.bundle`, and Metro printing
# `Bundled ... (N modules)` are all healthy in a broken worktree — only loading
# a page that fires a dynamic `import()` reproduces it. Testers read the green
# probe as proof the runtime worked and fell back to headless verification,
# which is how #1484 shipped visibly-broken UI behind 29 green tests.
#
# Pass --install to spawn a runtime-capable worktree up front (~1 min total).
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

# --install: replace the symlinks with real installs so the worktree can
# actually run. Measured on this repo: mingla-business ~35s, app-mobile ~19s.
REAL_INSTALL=0
for arg in "$@"; do
  [ "$arg" = "--install" ] && REAL_INSTALL=1
done
if [ "$REAL_INSTALL" = "1" ]; then
  echo "==> --install: replacing symlinks with real installs (#1544)..."
  for sub in mingla-business app-mobile; do
    if [ -L "$WT/$sub/node_modules" ]; then
      rm "$WT/$sub/node_modules"
      echo "    npm ci in $sub ..."
      (cd "$WT/$sub" && npm ci --silent) && echo "    installed: $sub"
    fi
  done
fi

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
if [ "$REAL_INSTALL" = "1" ]; then
  echo "  Runtime:   READY — real npm ci, dynamic import() resolves (#1544)"
else
  echo "  Runtime:   *** NOT RUNNABLE AS SPAWNED (#1544) ***"
  echo "    node_modules is an ABSOLUTE symlink into the anchor, so every"
  echo "    runtime dynamic import() fails and the app red-screens on the"
  echo "    first lazy route. A green expo export / index.bundle / \"Bundled"
  echo "    (N modules)\" does NOT prove otherwise — only loading a page does."
  echo "    Before ANY device or browser testing, run:"
  echo "      rm \"$WT/mingla-business/node_modules\" && (cd \"$WT/mingla-business\" && npm ci)   # ~35s"
  echo "      rm \"$WT/app-mobile/node_modules\"      && (cd \"$WT/app-mobile\" && npm ci)        # ~19s"
  echo "    Or re-spawn with --install."
fi
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
