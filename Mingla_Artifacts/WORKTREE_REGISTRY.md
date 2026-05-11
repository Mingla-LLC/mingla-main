# Worktree Registry

Canonical owner: Codex `orchestrator-mingla`.

Status: LEGACY TRANSITION LEDGER as of 2026-05-11. New Mingla work no longer opens per-ORCH git worktrees. The canonical working location is `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`; completed close work promotes from `Seth` to `main`.

Strategy reference: [WORKTREE_STRATEGY.md](WORKTREE_STRATEGY.md). This supersedes META-ORCH-0755 Step 8 / DEC-135 / I-PROPOSED-AC ONE_WORKTREE_PER_ORCH.

---

## Active legacy worktrees to migrate or clean up

These rows existed before the 2026-05-11 branch-flow change. Do not route new work here. Before closing or deleting any legacy path, inspect it, preserve scoped evidence if still needed, and move only reviewed files into the `Seth` branch.

| Legacy worktree path | Branch | ORCH-ID | Last known phase | Opened | Last sync | Owner | Migration / cleanup note |
|----------------------|--------|---------|------------------|--------|-----------|-------|--------------------------|
| `.worktrees/orch-0778-orch0777-web-export-stripe-import/` | `orch-0778-orch0777-web-export-stripe-import` | ORCH-0778 | CLOSE ready / operator commit+merge pending | 2026-05-10 | 2026-05-10 | Codex `orchestrator-mingla` | Legacy state from old model; inspect before migrating scoped files into `Seth`. |
| `.worktrees/orch-0776-event-cover-video-processing-speed/` | `orch/0776-event-cover-video-processing-speed` | ORCH-0776 | TEST / retest prompt ready after Edge deploy | 2026-05-11 | 2026-05-11 | Claude `mingla-forensics` TEST mode | Legacy state from old model; inspect before migrating scoped files into `Seth`. |
| `.worktrees/orch-0779-business-android-google-signin-developer-error/` | `orch/0779-business-android-google-signin-developer-error` | ORCH-0779 | CLOSED PASS / git lock-in pending | 2026-05-10 | 2026-05-11 | Codex `orchestrator-mingla` | Legacy state from old model; inspect before migrating scoped files into `Seth`. |

---

## Recently closed legacy worktrees

| Legacy worktree path | Branch | ORCH-ID | Closed | Merge SHA | CLOSE entry |
|----------------------|--------|---------|--------|-----------|-------------|
| `.worktrees/orch-0783-event-cover-image-provider-pivot/` | `orch/0783-event-cover-image-provider-pivot` | ORCH-0783 | 2026-05-11 | `6151201f` | `Mingla_Artifacts/CLOSE_NOTE_ORCH-0783.md` |
| `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/` | `orch/0781-clean-tree-stripe-web-import-regression` | ORCH-0781 | 2026-05-11 | `9b65912f` | `Mingla_Artifacts/CLOSE_NOTE_ORCH-0781.md` |

---

## New routing rule

For every new Mingla dispatch, write:

`Working tree: /Users/sethogieva/Desktop/mingla-main on branch Seth`

Do not add new active rows to this registry. Use ORCH-specific reports, prompts, specs, close notes, and commit messages for tracking new work.

---

## Operator plain-English rule

When the operator has to do anything, explain it before the command. Example: "Seth, open the repo once, make sure it says branch `Seth`, then paste the next prompt into Claude. You do not need to choose a `.worktrees` folder anymore."
