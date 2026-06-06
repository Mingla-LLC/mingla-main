# Worktree Registry

**Canonical owner:** orchestrator (Claude `mingla-orchestrator` or Codex `orchestrator-mingla` — full parity).

**Effective:** 2026-05-24 (worktree-per-ORCH cutover).

**Purpose:** live ledger of currently-active per-ORCH worktrees. The orchestrator updates this file at spawn + reap. The operator's VS Code multi-root workspace folder list mirrors it visually.

Reference: [WORKTREE_STRATEGY.md](WORKTREE_STRATEGY.md).

---

## Active worktrees

| Worktree path | Branch | ORCH-ID | Phase | Sim assigned | Metro port | Spawned | Owner |
|---------------|--------|---------|-------|--------------|------------|---------|-------|
| `~/Desktop/mingla-orchs/meta-orch-0952-[buyer-web-confirm-deep-forensics]` | `meta-orch-0952-buyer-web-confirm-deep-forensics` | META-ORCH-0952 | INVESTIGATE | no sim — buyer-web (Playwright Chromium + Safari) | 8083 | 2026-05-24 | Claude `mingla-orchestrator` (dispatch) → Claude `mingla-forensics` (active) |
| `~/Desktop/mingla-orchs/ORCH-0990-[flower-stop-real-florists]` | `ORCH-0990-flower-stop-real-florists` | ORCH-0990 | SPEC | no sim — backend-only (edge fn + RPC + place_pool data) | 8086 | 2026-05-29 | Claude `mingla-orchestrator` (dispatch) → Claude `mingla-forensics` (active) |
| `~/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]` | `ORCH-1006-universal-allin-pricing-engine` | ORCH-1006 | INVESTIGATE done → awaiting SPEC | TBD (native checkout) | 8091 | 2026-05-29 | Claude `mingla-orchestrator` (dispatch) → Claude `mingla-forensics` (active) |
| `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]` | `META-ORCH-1009-Sub-E-business-app-supply-feeder` | META-ORCH-1009 Sub-E | DESIGN review approved -> IMPLEMENTOR ready | iPhone 17 Pro Max `2C3312D9` (business dev build installed) | 8089 | 2026-05-30 | Claude `mingla-orchestrator` (dispatch) -> Codex `orchestrator-mingla` (review) -> Codex `ui-ux-mingla` (design) -> Codex `orchestrator-mingla` (design review) |
| `~/Desktop/mingla-orchs/ORCH-1020-[collab-deck-prefs-swipe-freeze]` | `ORCH-1020-collab-deck-prefs-swipe-freeze` | ORCH-1020 | WATCH / NOT REPRODUCED after INVESTIGATE | iPhone 17 Pro Max sim `2C3312D9-EE52-4EBD-9704-15811D49A2EC`; Android emulator available but parity unresolved | 8088 intended; investigation used app-mobile Metro 8082 when 8088 was occupied | 2026-05-30 | Codex `orchestrator-mingla` (review) -> parked unless Seth can reproduce with exact device/build/session/video |
| `~/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]` | `META-ORCH-1074-business-notifications` | META-ORCH-1074 | INTAKE+INVESTIGATE done → SPEC dispatch (v1 = 12 notifications) | TBD (business iOS dev build) | 8111 | 2026-06-04 | Claude `mingla-orchestrator` (dispatch) → Claude `mingla-forensics` (SPEC) |
| `~/Desktop/mingla-orchs/ORCH-1085-[business-web-code-splitting]` | `ORCH-1085-business-web-code-splitting` | ORCH-1085 | SPEC dispatch - architecture plan only | no sim - business web Playwright + mobile browser validation | 8107 | 2026-06-05 | Codex `orchestrator-mingla` (takeover) -> Codex `forensic-mingla` (SPEC) |
| `~/Desktop/mingla-orchs/ORCH-1089-[business-web-event-creator-signedin-wizard]` | `ORCH-1089-business-web-event-creator-signedin-wizard` | ORCH-1089 | FORENSICS investigate/spec dispatch | physical Android Chrome if connected + Safari-equivalent browser proof | 8109 | 2026-06-06 | Codex `orchestrator-mingla` (dispatch) -> Codex `forensic-mingla` (investigate/spec) |

---

## How orchestrator maintains this

**On spawn:**
1. Append a row with worktree path, branch, ORCH-ID, current phase, assigned sim, Metro port, spawn date, ORCH owner skill.
2. Commit the registry update alongside the first work commit in the new worktree.

**On reap (CLOSE Step 1.7):**
1. The orchestrator MUST delete the row IN THE CLOSE COMMIT on the per-ORCH branch, BEFORE the PR is opened/merged. The merged commit on `main` therefore arrives WITHOUT the row.
2. `reap.sh` removes the worktree + local/remote branch ONLY — it does NOT touch the registry on `main`. If the CLOSE commit forgot to delete the row, `main` ends up with a stale entry that will collide with the next parallel orchestrator's row add. Recovery is a separate cleanup PR — avoid this.

**Live verification:** `git -C ~/Desktop/mingla-main worktree list` should always match the rows in this file (minus the anchor itself, which is always present and not registered here).

---

## Recently reaped (last 5 — for short-term audit trail)

| Worktree path | Branch | ORCH-ID | Reaped | Merged via PR |
|---------------|--------|---------|--------|---------------|
| `~/Desktop/mingla-orchs/ORCH-1022-[dm-shared-card-freeze-policies-reservations]/` | `ORCH-1022-dm-shared-card-freeze-policies-reservations` | ORCH-1022 | 2026-05-31 | PR #287 |
| `~/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]/` | `ORCH-0975-consumer-notifications-redesign` | ORCH-0975 | 2026-05-25 | (PR on push) |
| `~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/` | `ORCH-0963-public-brand-page-events-vs-trip` | ORCH-0963 | 2026-05-25 | (PR on push) |
| `~/Desktop/mingla-orchs/0957-[storage-image-transform-overage]/` | `0957-storage-image-transform-overage` | ORCH-0957 | 2026-05-25 | (pending PR merge) |
| `~/Desktop/mingla-orchs/ORCH-0950-[trip-capacity-single-source]/` | `ORCH-0950-trip-capacity-single-source` | ORCH-0950 | 2026-05-25 | (TBD on push) |
| `~/Desktop/mingla-orchs/ORCH-0956-[stripe-ops-alerts-email]/` | `ORCH-0956-stripe-ops-alerts-email` | ORCH-0956 | 2026-05-25 | PR #202 |

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
