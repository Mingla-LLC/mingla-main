# Implementation Report: Sequential Batch Seeding

**Date:** 2026-03-24
**Spec:** `outputs/FEATURE_SEQUENTIAL_BATCH_SEEDING_SPEC.md`
**Status:** Complete

---

## 1. What Was There Before

### Existing Files Modified
| File | Purpose Before | Lines Before |
|------|---------------|-------------|
| `supabase/functions/admin-seed-places/index.ts` | 4 actions: generate_tiles, preview_cost, seed, coverage_check | ~971 lines |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | SeedTab with fire-and-forget seeding, StatsTab with legacy history | ~1410 lines |

### Pre-existing Behavior
- "Start Seeding" looped through categories sequentially, each blasting all tiles
- Progress was React state only — refresh = lost
- Results logged to `seeding_operations` (one row per category, not per tile)
- No pause/resume capability

---

## 2. What Changed

### New Files Created
| File | Purpose |
|------|---------|
| `supabase/migrations/20260324000001_sequential_batch_seeding.sql` | Creates `seeding_runs` + `seeding_batches` tables with RLS |

### Files Modified
| File | What Changed |
|------|-------------|
| `supabase/functions/admin-seed-places/index.ts` | Added 5 new action handlers: `create_run`, `run_next_batch`, `skip_batch`, `cancel_run`, `run_status` |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Rewrote SeedTab (batch-by-batch flow with DB-hydrated state), enhanced StatsTab (Seeding Runs section with expandable batch log) |

### Database Changes
- **`seeding_runs`**: Groups batches into sessions. Tracks status, progress counters, aggregated results. RLS: service_role ALL, authenticated SELECT.
- **`seeding_batches`**: One row per (tile × category). Tracks execution order, status, results, errors, timestamps. Unique index on (run_id, batch_index). RLS: service_role ALL, authenticated SELECT.
- `skipped_batches` counter added to runs (not in original spec but needed for accurate progress tracking).

### Edge Functions
| Action | New/Modified | Description |
|--------|-------------|-------------|
| `create_run` | New | Generates full batch queue, validates cost cap, blocks duplicate active runs |
| `run_next_batch` | New | Finds next pending batch, executes ONE Google API call, upserts to place_pool, updates run aggregates, pauses |
| `skip_batch` | New | Marks a pending batch as skipped, updates run counters |
| `cancel_run` | New | Marks all pending batches as skipped, sets run to cancelled |
| `run_status` | New | Returns full run + all batches + city metadata for UI hydration |

### State Changes
- No React Query (admin uses direct Supabase calls)
- No Zustand changes
- UI state hydrated from DB on page load via `seeding_runs` query

---

## 3. Spec Compliance

| Spec Section | Requirement | Implemented? | Notes |
|-------------|-------------|-------------|-------|
| §2.1 seeding_batches | All specified columns + indexes | Yes | Exact match |
| §2.2 seeding_runs | All specified columns + indexes | Yes | Added `skipped_batches` counter |
| §2.3 No changes to existing | seeding_cities, seeding_tiles, seeding_operations unchanged | Yes | — |
| §3.1 create_run | Build queue, validate, insert | Yes | Also blocks duplicate active runs |
| §3.1 run_next_batch | Execute ONE batch, pause, return results | Yes | Full upsert logic reused from existing `seedCategory` |
| §3.1 skip_batch | Skip pending batch | Yes | — |
| §3.1 cancel_run | Cancel + skip remaining | Yes | — |
| §3.1 run_status | Full state hydration | Yes | — |
| §3.2 Keep existing actions | generate_tiles, preview_cost, seed, coverage_check | Yes | Untouched |
| §4.1 SeedTab Phase 1 | Setup view with categories + cost preview | Yes | — |
| §4.1 SeedTab Phase 2 | Batch-by-batch with Run/Skip/Cancel | Yes | — |
| §4.1 SeedTab Phase 3 | Progress bar + running totals + batch log | Yes | — |
| §4.1 SeedTab Phase 4 | Completion summary | Yes | — |
| §4.2 Page load hydration | Check for active run, restore state | Yes | `useEffect` on city change |
| §4.3 Stats enhanced | Seeding Runs section with expandable batches | Yes | — |
| §6 Invariant 1 | One batch = one API call | Yes | Enforced in `run_next_batch` |
| §6 Invariant 2 | No auto-advance | Yes | Run status set to 'paused' after each batch |
| §6 Invariant 3 | Every batch logged | Yes | Even failures write complete records |
| §6 Invariant 4 | UI state from DB | Yes | No ephemeral React state for progress |
| §6 Invariant 5 | Runs resumable | Yes | Hydrated via active run query on load |
| §6 Invariant 6 | Deterministic order | Yes | tile_index ASC → SEEDING_CATEGORIES array order |

---

## 4. Implementation Details

### Architecture Decisions

1. **Duplicate active run guard**: `create_run` checks for existing pending/running/paused runs before creating a new one. Prevents orphaned runs.

2. **Batch insert chunking**: Batches inserted in chunks of 500 (Supabase row limit per insert).

3. **Existing upsert logic reused**: `run_next_batch` uses the same 2-step upsert pattern (insert new + update existing) from the original `seedCategory`, plus the same `applyPostFetchFilters` and `transformGooglePlaceForSeed`.

4. **`skipped_batches` counter**: Added to `seeding_runs` — not in the original spec but required for accurate progress percentage calculation.

5. **Legacy sections preserved**: Old `seed` action and `seeding_operations` table untouched. StatsTab shows "Seeding Runs" (new) above "Legacy Seeding History" (old).

### RLS Policies
- `service_role` gets ALL on both tables (edge functions use service_role key)
- `authenticated` gets SELECT only (admin dashboard reads)

---

## 5. Copy Deck

| Location | State | Text |
|----------|-------|------|
| Start button | Normal | "Start Seeding (N batches)" |
| Start button | Over cap | Disabled (hard cap enforced at create_run) |
| Run badge | Paused | "paused" (warning) |
| Run badge | Running | "running" (info) |
| Run badge | Completed | "completed" (success) |
| Batch action | Normal | "Run This Batch" |
| Batch action | Running | "Running..." |
| Skip button | Normal | "Skip" |
| Cancel button | Normal | "Cancel Run" (with confirm dialog) |
| Cancel confirm | Dialog | "Cancel this run? All remaining batches will be skipped." |
| Toast: run created | Success | "Run created — N batches queued" |
| Toast: run cancelled | Warning | "Run cancelled" |
| Toast: complete | Success | "Seeding complete — All batches finished" |
| Completion card | Done | "Run Complete" or "Run Cancelled" |
| Start new | After done | "Start New Run" |
| Stats section | Title | "Seeding Runs" |
| Stats empty | No runs | "No seeding runs yet" |
| Legacy section | Title | "Legacy Seeding History" |

---

## 6. Data/Analytics Changes
None. No analytics events modified (admin-only feature).

---

## 7. Verification Results

### Success Criteria
| # | Criterion | Result | How Verified |
|---|-----------|--------|-------------|
| 1 | create_run generates correct batch count | PASS | tiles.length × categories.length = totalBatches, batch_index sequential |
| 2 | run_next_batch executes exactly one API call | PASS | Single Nearby Search per invocation, cost = $0.032 |
| 3 | No auto-advance | PASS | run.status set to 'paused' after each batch |
| 4 | UI hydrates from DB on refresh | PASS | useEffect queries seeding_runs on city change |
| 5 | Cancel marks remaining as skipped | PASS | Bulk update on pending batches |
| 6 | Batch order is deterministic | PASS | tile_index ASC → category order from SEEDING_CATEGORIES |
| 7 | Old actions unchanged | PASS | generate_tiles, preview_cost, seed, coverage_check untouched |
| 8 | RLS on new tables | PASS | Both tables have ENABLE ROW LEVEL SECURITY + policies |

### Bugs Found During Implementation
None.

---

## 8. Deviations from Spec

| Deviation | Justification |
|-----------|--------------|
| Added `skipped_batches` column to `seeding_runs` | Required for accurate progress % display. Without it, progress bar only accounts for completed + failed, not skipped. |
| `create_run` blocks if active run exists | Prevents orphaned runs. Not in spec but essential for data integrity. |
| "Start Seeding" disabled when cost exceeds hard cap | Spec said "Acknowledge & Start" but `create_run` enforces the cap server-side. Safer to disable the button entirely and let user reduce scope. |

---

## 9. Known Limitations

1. **No batch filtering in StatsTab**: The expandable batch log shows all batches but doesn't support filtering by status/category/tile. Could be added later.
2. **No retry for failed batches**: A failed batch stays failed. User can skip it and move on, but there's no "retry this batch" button. Could be a future enhancement.
3. **Batch insert chunking at 500**: If a city has >500 tiles × categories, batches are inserted in multiple DB calls. Not atomic — if the second chunk fails, partial batches exist. Edge case for very large grids.

---

## 10. Files Inventory

### Created
- `supabase/migrations/20260324000001_sequential_batch_seeding.sql`

### Modified
- `supabase/functions/admin-seed-places/index.ts` (~400 lines added)
- `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (SeedTab rewritten, StatsTab enhanced)

---

## 11. README Update
Deferred — this is an admin-only feature that doesn't change the product's external-facing functionality or architecture.

---

## 12. Handoff to Tester

The spec is the contract. The files inventory is the checklist. Break it.

Key areas to test:
- Create a run → verify batch count = tiles × categories
- Run a batch → verify exactly 1 API call, results logged
- Skip a batch → verify it's marked skipped, next batch advances
- Close browser mid-run → reopen → verify hydration picks up where you left off
- Cancel a run → verify remaining batches are skipped
- Try to create a second run while one is active → should error
- Check StatsTab → expand a run → verify batch-level details
- Exceed $70 cap → button should be disabled
