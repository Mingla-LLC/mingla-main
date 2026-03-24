# Implementation Report: Failed Batch Retry Support

**Date:** 2026-03-24
**Status:** Complete

---

## 1. Summary

Adds first-class retry support for execution-time failed batches in the sequential batch seeding system. An admin can now retry any failed batch directly from the batch log — it re-runs exactly that one tile×category API call, updates place_pool, and corrects all run-level counters. No new batch statuses. No new run statuses. No regression to the prepare-first workflow.

---

## 2. Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260324000003_seeding_batches_retry_count.sql` | **New.** Adds `retry_count INTEGER NOT NULL DEFAULT 0` to `seeding_batches`. |
| `supabase/functions/admin-seed-places/index.ts` | New `retry_batch` action handler (~200 lines). Header updated to list 10 actions. Wired into switch statement. |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Added `RotateCcw` import, `retryingBatchId` state, `retryBatch` action function. SeedTab batch log: Retry button on failed batches, retry count badge, spinner during retry. StatsTab: retry count badge on batch rows. "Run This Batch" and "Skip" disabled during retry. |

---

## 3. Retry Lifecycle in Plain English

1. Admin sees a failed batch in the batch log (e.g., "Google API 429: rate limited")
2. Admin clicks "Retry" button on that specific batch
3. System checks: run must be ready/running/paused, batch must be `failed`, no other batch currently running
4. Batch status moves to `running`, `retry_count` increments
5. System executes exactly one Google Nearby Search for that tile×category
6. On success: batch moves to `completed`, run counters corrected (`failed_batches--`, `completed_batches++`, place aggregates adjusted)
7. On failure: batch moves back to `failed` with updated error details, run counters unchanged (was already counted as failed)
8. Run returns to `paused` — the one-at-a-time model is preserved

---

## 4. Exact Rules for When Retry Is Allowed

| Condition | Required? |
|-----------|-----------|
| Run status is `ready`, `running`, or `paused` | Yes |
| Batch status is `failed` | Yes |
| Batch belongs to the specified run | Yes |
| No other batch is currently `running` in the same run | Yes |
| Batch is `completed`, `skipped`, or `pending` | **Not allowed** |
| Run is `completed`, `cancelled`, or `failed_preparing` | **Not allowed** |

Double-click safety: `retryingBatchId` state in UI disables all Retry/Run/Skip buttons during execution. Server-side, the "no running batch" guard prevents concurrent execution even if UI is bypassed.

---

## 5. Counter/Progress Behavior After Retry

### On successful retry (failed → completed):
| Counter | Change |
|---------|--------|
| `failed_batches` | -1 |
| `completed_batches` | +1 |
| `total_api_calls` | +1 (new API call) |
| `total_cost_usd` | +$0.032 (new API call) |
| `total_places_new` | Subtract old batch value, add new |
| `total_places_duped` | Subtract old batch value, add new |
| Progress % | Unchanged (batch was already counted in progress) |

### On failed retry (failed → failed again):
| Counter | Change |
|---------|--------|
| `failed_batches` | No change (already counted) |
| `completed_batches` | No change |
| `total_api_calls` | +1 |
| `total_cost_usd` | +$0.032 |
| `total_places_new` | Subtract old, add new (likely 0→0) |
| `total_places_duped` | Subtract old, add new (likely 0→0) |

### Batch-level tracking:
| Field | Behavior |
|-------|----------|
| `retry_count` | Increments by 1 on each retry attempt |
| `google_api_calls` | Accumulates across all attempts |
| `estimated_cost_usd` | Accumulates across all attempts |
| `places_*` fields | Overwritten with latest attempt results |
| `error_message` / `error_details` | Overwritten with latest attempt (cleared on success) |
| `started_at` | Updated to retry start time |
| `completed_at` | Updated to retry completion time |

Design choice: `retry_count` and `google_api_calls` accumulate (historical truth). Place counts reflect the latest attempt only (current truth). This is intentional — you want to know "how many places did this batch ultimately produce" not "how many places across all attempts."

---

## 6. UI Changes

### SeedTab Batch Log
- **Failed batches**: "Retry" button with `RotateCcw` icon appears on the right
- **During retry**: Button shows spinner + "Retrying...", all other action buttons disabled
- **Retry count badge**: Small `↻N` badge shown on any batch with `retry_count > 0`
- **Toast on result**: "Retry succeeded — N new places" (success) or "Retry failed again — error message" (warning)

### StatsTab Batch Details
- Retry count badge (`↻N`) shown on batch rows when `retry_count > 0`

### Disabled States
While a retry is in flight: "Run This Batch", "Skip", and all other "Retry" buttons are disabled. Prevents concurrent batch execution.

---

## 7. Regression Checks

- [x] Prepare-first workflow untouched — `create_run` flow unchanged
- [x] `run_next_batch` unchanged — still targets next pending batch
- [x] `skip_batch` unchanged
- [x] `cancel_run` unchanged — correctly handles skipped_batches
- [x] `run_status` unchanged — returns all batches including retry_count
- [x] One-at-a-time invariant preserved — retry checks for running batches
- [x] Hydration on refresh — retry_count persisted in DB, retryingBatchId resets to null on refresh (safe — batch reverts to `failed` or `completed`)
- [x] RLS unchanged — retry uses service_role via edge function
- [x] Cost cap not bypassed — retry doesn't check cap (batch was already approved), but adds accurate cost
- [x] 2-step upsert logic identical — batched in groups of 10

---

## 8. Deviations

| Deviation | Justification |
|-----------|--------------|
| `retry_batch` does not check cost cap | The batch was already approved as part of the run. Retry is a correction, not a new allocation. Each retry adds $0.032 which is tracked in run totals. |
| Place counts on batch record reflect latest attempt only | Historical place counts across attempts are not useful — what matters is "did this batch ultimately produce places." Cost and API calls accumulate for billing truth. |
| No limit on retry count | Intentional — an admin retrying a rate-limited batch should be able to try again after waiting. The cost accumulates truthfully. A retry limit would need a policy decision from the user. |

---

## 9. Commit Message

```
feat: add failed-batch retry to sequential batch seeding

New retry_batch edge function action re-executes a specific failed
batch, corrects run counters (failed→completed on success), and
tracks retry_count. UI shows Retry button on failed batches in
the batch log with spinner during execution. One-at-a-time
invariant preserved. No regression to prepare-first workflow.
```
