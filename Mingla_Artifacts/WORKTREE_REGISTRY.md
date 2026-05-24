# Worktree Registry

**Canonical owner:** orchestrator (Claude `mingla-orchestrator` or Codex `orchestrator-mingla` — full parity).

**Effective:** 2026-05-24 (worktree-per-ORCH cutover).

**Purpose:** live ledger of currently-active per-ORCH worktrees. The orchestrator updates this file at spawn + reap. The operator's VS Code multi-root workspace folder list mirrors it visually.

Reference: [WORKTREE_STRATEGY.md](WORKTREE_STRATEGY.md).

---

## Active worktrees

_(empty — no ORCHs in flight as of cutover)_

| Worktree path | Branch | ORCH-ID | Phase | Sim assigned | Metro port | Spawned | Owner |
|---------------|--------|---------|-------|--------------|------------|---------|-------|

---

## How orchestrator maintains this

**On spawn:**
1. Append a row with worktree path, branch, ORCH-ID, current phase, assigned sim, Metro port, spawn date, ORCH owner skill.
2. Commit the registry update alongside the first work commit in the new worktree.

**On reap:**
1. Remove the row.
2. Commit the registry update in the CLOSE commit.

**Live verification:** `git -C ~/Desktop/mingla-main worktree list` should always match the rows in this file (minus the anchor itself, which is always present and not registered here).

---

## Recently reaped (last 5 — for short-term audit trail)

| Worktree path | Branch | ORCH-ID | Reaped | Merged via PR |
|---------------|--------|---------|--------|---------------|

_(populated as ORCHs close; older rows pruned to keep this short)_

---

## Legacy state (pre-2026-05-24 cutover)

All pre-cutover worktrees from the META-ORCH-0755 era (2026-04-26 → 2026-05-11) were already cleaned up during the 2026-05-11 single-Seth model adoption. The `Seth` branch itself was deleted as part of this cutover commit. All historical work is reachable via `git log main`.

No legacy worktree paths remain on disk.

---

## Cross-references

- Strategy doc: [WORKTREE_STRATEGY.md](WORKTREE_STRATEGY.md)
- Memory rule: `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_worktree_per_orch_workflow.md`
- Scripts: `scripts/orch-worktree/spawn.sh`, `scripts/orch-worktree/reap.sh`
- Skill enforcement: every Claude + Codex skill's "Working-Branch Discipline" stanza
