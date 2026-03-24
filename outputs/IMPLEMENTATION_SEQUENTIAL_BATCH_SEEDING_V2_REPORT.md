# Implementation Report: Sequential Batch Seeding V2 — Two-Phase Workflow

**Date:** 2026-03-24
**Spec:** Task description (two-phase prepare-then-approve workflow + test report fixes)
**Status:** Complete

---

## 1. New Run Lifecycle / Status Model

### Before (V1)
```
pending → running ⇄ paused → completed
                              → cancelled
```
- Run created as `pending`, immediately executable
- No verification that all batches were created
- Partial batch creation could leave a "valid-looking" run

### After (V2)
```
preparing → ready → running ⇄ paused → completed
                                       → cancelled
preparing → failed_preparing (terminal — cannot be approved)
ready/running/paused → cancelled
```

| Status | Meaning | Approvable? |
|--------|---------|-------------|
| `preparing` | Batch records being created | No |
| `ready` | All batches verified, waiting for first approval | Yes |
| `running` | A batch is currently executing | No (one at a time) |
| `paused` | Last batch finished, waiting for next approval | Yes |
| `completed` | All batches processed | No |
| `cancelled` | User cancelled, remaining marked skipped | No |
| `failed_preparing` | Batch creation failed partway | No |

---

## 2. Before/After Behavior

### Before
1. User clicks "Start Seeding" → run created as `pending` → batches inserted → UI shows batch controls immediately
2. If batch insertion failed mid-way, run was left in `pending` with partial batches — appeared valid
3. `cancel_run` marked pending batches as skipped but did NOT update `seeding_runs.skipped_batches`
4. `run_next_batch` Step 2 updated existing places one-by-one
5. `run_next_batch` accepted `pending` status

### After
1. User clicks "Prepare N Batches" → run created as `preparing` → batches inserted → count verified → run set to `ready` → UI shows "All batches prepared and ready for approval"
2. If batch insertion fails, run is set to `failed_preparing` — cannot be approved, UI shows clear error
3. `cancel_run` counts pending batches BEFORE skipping them, updates `skipped_batches` accurately
4. `run_next_batch` Step 2 updates in batches of 10 via `Promise.all`
5. `run_next_batch` only accepts `ready`, `running`, or `paused`

---

## 3. Exact Fixes from Test Report

| # | Issue | Fix | Severity |
|---|-------|-----|----------|
| 1 | `cancel_run` doesn't update `skipped_batches` | Count pending batches before marking them skipped, add count to `skipped_batches` | Required — data integrity |
| 2 | Stale file header says "Four actions" | Updated to list all 9 actions with descriptions | Cosmetic |
| 3 | `run_next_batch` Step 2 one-by-one updates | Batched in groups of 10 via `Promise.all` | Performance |
| 4 | Unused `Pause` import | Removed from lucide-react import | Cleanup |
| 5 | StatsTab missing batch filters | Added 3 filter dropdowns: status, category, tile index | Feature gap |

---

## 4. Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260324000002_seeding_runs_two_phase_statuses.sql` | **New.** Drops old CHECK, adds `preparing`/`ready`/`failed_preparing`. Migrates existing `pending` → `ready`. |
| `supabase/functions/admin-seed-places/index.ts` | Updated header. `create_run`: preparing→verify→ready/failed_preparing. `run_next_batch`: accepts `ready` not `pending`, batched Step 2. `cancel_run`: counts+updates skipped_batches. |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Removed `Pause` import. SeedTab: 2-phase UI (preparing/ready/failed_preparing states), updated copy. StatsTab: batch filters (status/category/tile), new status badges. |

---

## 5. Hydration / Resume Verification

| Scenario | Behavior |
|----------|----------|
| Refresh during `preparing` | Hydration query includes `preparing` → shows "Creating N batch records..." |
| Refresh after `ready` | Shows "All batches prepared and ready for approval" with batch controls |
| Refresh during `paused` | Shows progress bar + "Next Batch" controls (unchanged) |
| Refresh after `cancelled` | Shows completion card with skipped count (now accurate) |
| Refresh after `failed_preparing` | Hydration does NOT pick this up (it's a terminal state). User sees setup view. If they expand StatsTab, the run shows with "prep failed" badge. |

Note: `failed_preparing` is intentionally excluded from the hydration query. It's a terminal failure state — showing it as an "active run" would be confusing. Instead, the user sees the setup view and can prepare a new run. The failed run is visible in StatsTab history.

---

## 6. Deviations

| Deviation | Justification |
|-----------|--------------|
| `failed_preparing` excluded from SeedTab hydration | Terminal state — not an active run. Visible in StatsTab. Showing it as "active" would block the user from starting a new run without a dismiss flow for a run they never approved. |

---

## 7. Regression Checks

- [x] Old actions (`generate_tiles`, `preview_cost`, `seed`, `coverage_check`) — untouched
- [x] `skip_batch` — unchanged, still works (only skips `pending` batches)
- [x] `run_status` — unchanged, returns all statuses correctly
- [x] One-batch-per-approval invariant — preserved (`run_next_batch` still pauses after each)
- [x] Cost cap enforcement — preserved in `create_run`
- [x] Duplicate active run guard — updated to include `preparing` and `ready`
- [x] RLS policies — unchanged
- [x] 2-step upsert logic — identical business logic, only batching improved

---

## 8. Commit Message

```
fix: two-phase batch seeding workflow + test report fixes

Redesign run lifecycle: preparing → ready → running ⇄ paused.
Batch creation must fully succeed and be verified before approval
is allowed. Failed preparation is visible and non-approvable.

Fixes from test report:
- cancel_run now updates skipped_batches correctly
- run_next_batch Step 2 uses batched updates (groups of 10)
- Stale file header updated to list all 9 actions
- Unused Pause import removed
- StatsTab batch filters added (status, category, tile index)
```
