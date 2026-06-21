#!/usr/bin/env bash
#
# Mingla anchor-hygiene hook installer — ORCH-1185.
#
# Points git at the repo-tracked .githooks/ directory. Because git worktrees
# share the common .git/config, setting core.hooksPath ONCE on the anchor
# activates the guard for the anchor AND every current/future worktree.
#
# Idempotent — safe to run any number of times. Called automatically by
# spawn.sh; also run it once manually on a fresh clone:
#     bash scripts/orch-worktree/install-hooks.sh
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "${repo_root:-}" ]; then
  echo "install-hooks: not inside a git repo" >&2
  exit 1
fi

# Resolve to the MAIN working tree's path for .githooks (worktrees share config,
# but the path must exist; .githooks is tracked so it exists in every checkout).
git config core.hooksPath .githooks
chmod +x "${repo_root}/.githooks/"* 2>/dev/null || true

echo "anchor-hygiene guard active: core.hooksPath=.githooks (blocks direct commits on main)"
