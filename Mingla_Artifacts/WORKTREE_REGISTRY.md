# Worktree Registry

Canonical owner: Codex `orchestrator-mingla` (per DEC-133 pipeline routing). Claude `mingla-orchestrator` may read/update as parity mirror.

This artifact tracks all currently-open per-ORCH worktrees. One row per active worktree. Rows are removed when the worktree is closed (merged + `git worktree remove`).

Strategy reference: [WORKTREE_STRATEGY.md](WORKTREE_STRATEGY.md). Codified by META-ORCH-0755 Step 8 (DEC-135 / I-PROPOSED-AC ONE_WORKTREE_PER_ORCH) on 2026-05-10.

---

## Active worktrees

| Worktree path | Branch | ORCH-ID | Current phase | Opened (date) | Last main-sync | Current canonical owner | Notes |
|---------------|--------|---------|---------------|---------------|----------------|-------------------------|-------|
| `.worktrees/orch-0778-orch0777-web-export-stripe-import/` | `orch-0778-orch0777-web-export-stripe-import` | ORCH-0778 | CLOSE ready / operator commit+merge pending | 2026-05-10 | 2026-05-10 | Codex `orchestrator-mingla` | QA PASS; merge ORCH-0778 before canonical ORCH-0777 close, then reconcile seeded ORCH-0777 frontend files. |
| `.worktrees/orch-0776-event-cover-video-processing-speed/` | `orch/0776-event-cover-video-processing-speed` | ORCH-0776 | TEST / retest prompt ready after Edge deploy | 2026-05-11 | 2026-05-11 | Claude `mingla-forensics` TEST mode | Codex orchestrator deployed six-function event-cover video bundle from the ORCH-0776 worktree; retest prompt is `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS.md`. |
| `.worktrees/orch-0779-business-android-google-signin-developer-error/` | `orch/0779-business-android-google-signin-developer-error` | ORCH-0779 | CLOSED PASS / git lock-in pending | 2026-05-10 | 2026-05-11 | Codex `orchestrator-mingla` | Android runtime PASS, production Web authenticated-session PASS after Supabase Auth callback config patch + Vercel deploy `dpl_CPQgBkaXa5nTvVNsCgeAe1UVQ6M5`; iOS out of scope. Worktree still contains uncommitted ORCH-0779 scoped files, so merge/remove requires separate clean lock-in after current main dirty ORCH-0777 work is isolated. |
| `.worktrees/orch-0783-event-cover-image-provider-pivot/` | `orch/0783-event-cover-image-provider-pivot` | ORCH-0783 | CLOSE in progress / branch commit ready | 2026-05-11 | 2026-05-11 | Codex `orchestrator-mingla` | QA CONDITIONAL PASS accepted; scoped branch commit `94622ac7`; close sync + merge pending. |

**Update rule:** the orchestrator updates this table on every phase transition (INVESTIGATE → SPEC → IMPLEMENT → TEST → CLOSE) and on every mid-cycle sync. Updates happen in main only.

---

## Recently closed (last 14 days)

| Worktree path | Branch | ORCH-ID | Closed (date) | Merge SHA | CLOSE entry |
|---------------|--------|---------|---------------|-----------|-------------|
| `.worktrees/orch-0781-clean-tree-stripe-web-import-regression/` | `orch/0781-clean-tree-stripe-web-import-regression` | ORCH-0781 | 2026-05-11 | `9b65912f` | `Mingla_Artifacts/CLOSE_NOTE_ORCH-0781.md` |

**Retention:** entries here for 14 days after CLOSE, then move to the archive section. The retention window lets the operator and orchestrator inspect recent merges without consulting raw git history.

---

## Archive (>14 days old)

Move closed entries here once they age out of the 14-day window. Keep ORCH-ID, branch, close date, and merge SHA — drop the working-tree path (no longer meaningful).

| Branch | ORCH-ID | Closed (date) | Merge SHA |
|--------|---------|---------------|-----------|
| _empty_ | — | — | — |

---

## How to use this artifact

**At INVESTIGATE dispatch (worktree opens):**
1. Orchestrator emits the `git worktree add` + symlink commands in the Next-Handoff paragraph.
2. Operator executes them.
3. Operator confirms; orchestrator appends a new row to the **Active worktrees** table in this file (in main).

**At every phase transition:**
1. Orchestrator updates the row in place: new Current phase, new Current canonical owner.

**At mid-cycle sync (rebase):**
1. Orchestrator emits the rebase command if the branch is >3 days old or main has touched related files.
2. After operator confirms successful rebase, orchestrator updates Last main-sync.

**At CLOSE (worktree closes):**
1. Codex `orchestrator-mingla` runs CLOSE Steps 1 → 1.5 → 2 → 3 → 4 (+ 5a-5h if applicable).
2. After commit + push, Codex emits the `git merge --no-ff` + `git worktree remove` + `git branch -d` commands.
3. Operator executes them.
4. Orchestrator moves the row from **Active worktrees** to **Recently closed**, recording the merge SHA.

**At 14-day aging:**
1. Orchestrator moves the row from **Recently closed** to **Archive**, dropping the worktree path (no longer meaningful).

---

## Edge cases

- **META-ORCH (process/skill/artifact-only work)** — runs in main, no worktree. Not tracked here. Examples: META-ORCH-0755 itself, future skill-parity sweeps, index cleanup.
- **Hot-fix** — still opens a worktree (`orch-HOTFIX-XXXX-<name>`). Discipline matters more under pressure, not less.
- **Sub-ORCH** — each gets its own worktree row. Parent ORCH closes only when its own dispatch closes; sub-ORCHs close independently.
- **Abandoned worktree** — orchestrator records the abandonment in DECISION_LOG.md, then moves the row to Archive with a `(abandoned)` marker in place of the merge SHA.
