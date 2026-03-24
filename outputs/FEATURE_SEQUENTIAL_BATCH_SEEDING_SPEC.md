# Feature Spec: Sequential Batch Seeding with Manual Approval

**Date:** 2026-03-24
**Status:** Draft — awaiting user approval

---

## 1. What This Changes (Plain English)

**Currently:** You hit "Start Seeding" and it blasts through all 13 categories autonomously. Each category processes all ~40 tiles in one go. Progress is React state — refresh and it's gone. You're a spectator watching a firehose.

**After this change:** Seeding becomes a controlled, step-by-step operation. The system takes **one tile + one category** as a single batch, runs it, shows you exactly what happened (8 new places, 2 dupes, 1 rejected — here they are), and **waits for you to approve** the next batch. You're in the driver's seat. Every batch is logged to the database. If you close your laptop and come back tomorrow, the UI shows you exactly where you left off and what happened so far.

**Loop order flips from:**
```
Category 1 → [Tile 1, Tile 2, ... Tile 40]
Category 2 → [Tile 1, Tile 2, ... Tile 40]
```

**To:**
```
Tile 1 → Category 1  ← approve → Category 2  ← approve → ... Category 13
Tile 2 → Category 1  ← approve → Category 2  ← approve → ... Category 13
```

Each arrow is a manual gate. You see results, you approve, next batch runs.

---

## 2. Database Changes

### 2.1 New Table: `seeding_batches`

Replaces the current coarse `seeding_operations` as the granular log. One row = one (tile, category) execution.

```sql
CREATE TABLE public.seeding_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,                    -- groups all batches in one seeding session
  city_id UUID NOT NULL REFERENCES seeding_cities(id) ON DELETE CASCADE,
  tile_id UUID NOT NULL REFERENCES seeding_tiles(id) ON DELETE CASCADE,
  tile_index INTEGER NOT NULL,
  seeding_category TEXT NOT NULL,
  app_category TEXT NOT NULL,

  -- Execution order
  batch_index INTEGER NOT NULL,            -- sequential position in the full queue (0, 1, 2...)

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  -- Results (populated on completion)
  google_api_calls INTEGER NOT NULL DEFAULT 0,
  places_returned INTEGER NOT NULL DEFAULT 0,
  places_rejected_no_photos INTEGER NOT NULL DEFAULT 0,
  places_rejected_closed INTEGER NOT NULL DEFAULT 0,
  places_rejected_excluded_type INTEGER NOT NULL DEFAULT 0,
  places_new_inserted INTEGER NOT NULL DEFAULT 0,
  places_duplicate_skipped INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seeding_batches_run ON seeding_batches (run_id);
CREATE INDEX idx_seeding_batches_city ON seeding_batches (city_id);
CREATE INDEX idx_seeding_batches_status ON seeding_batches (status);
CREATE UNIQUE INDEX idx_seeding_batches_order ON seeding_batches (run_id, batch_index);
```

### 2.2 New Table: `seeding_runs`

Groups batches into a single seeding session. Tracks overall progress.

```sql
CREATE TABLE public.seeding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id UUID NOT NULL REFERENCES seeding_cities(id) ON DELETE CASCADE,

  -- Configuration snapshot (what was selected when run started)
  selected_categories TEXT[] NOT NULL,
  total_tiles INTEGER NOT NULL,
  total_batches INTEGER NOT NULL,           -- tiles × categories

  -- Progress
  completed_batches INTEGER NOT NULL DEFAULT 0,
  failed_batches INTEGER NOT NULL DEFAULT 0,
  current_batch_index INTEGER,              -- NULL = not started or finished

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'paused', 'completed', 'cancelled')),

  -- Aggregated results (updated after each batch)
  total_api_calls INTEGER NOT NULL DEFAULT 0,
  total_places_new INTEGER NOT NULL DEFAULT 0,
  total_places_duped INTEGER NOT NULL DEFAULT 0,
  total_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seeding_runs_city ON seeding_runs (city_id);
CREATE INDEX idx_seeding_runs_status ON seeding_runs (status);
```

RLS: same pattern — service_role ALL, authenticated SELECT.

### 2.3 Existing Tables — No Changes

- `seeding_cities` — unchanged
- `seeding_tiles` — unchanged
- `seeding_operations` — keep for backward compat (existing history), but new seeding uses `seeding_batches`
- `place_pool` — unchanged

---

## 3. Edge Function Changes

### 3.1 New Actions on `admin-seed-places`

**`action: "create_run"`** — Generates the full batch queue

Input:
```json
{
  "action": "create_run",
  "cityId": "uuid",
  "categories": ["nature_views", "first_meet", ...] // or ["all"]
}
```

Logic:
1. Load city + tiles (ordered by tile_index)
2. Build batch queue: for each tile, for each category → one batch row
3. Insert `seeding_runs` row with status='pending'
4. Insert all `seeding_batches` rows with status='pending', sequential batch_index
5. Return run_id, total_batches, queue preview

Batch ordering example (Tile 1 has tile_index=0, Tile 2 has tile_index=1):
```
batch_index 0:  tile_index=0, category=nature_views
batch_index 1:  tile_index=0, category=first_meet
batch_index 2:  tile_index=0, category=picnic_park
...
batch_index 12: tile_index=0, category=groceries
batch_index 13: tile_index=1, category=nature_views
batch_index 14: tile_index=1, category=first_meet
...
```

**`action: "run_next_batch"`** — Executes exactly ONE batch

Input:
```json
{
  "action": "run_next_batch",
  "runId": "uuid"
}
```

Logic:
1. Load run, verify status is 'pending' or 'paused'
2. Find the first batch with status='pending' (ordered by batch_index)
3. If none found → mark run as 'completed', return done signal
4. Mark batch as 'running', mark run as 'running'
5. Load the tile and category config
6. Execute ONE Google Nearby Search (single tile × single category)
7. Apply post-fetch filters
8. Dedup + upsert to place_pool (same 2-step logic as current seedCategory)
9. Update batch row with results (places found, inserted, rejected, errors, cost)
10. Mark batch as 'completed' or 'failed'
11. Update run aggregates (completed_batches++, totals)
12. Mark run as 'paused' (waiting for next approval)
13. Return: batch result + next batch preview (tile/category) + run progress summary

**`action: "skip_batch"`** — Skip one pending batch without running it

Input:
```json
{
  "action": "skip_batch",
  "runId": "uuid",
  "batchId": "uuid"
}
```

**`action: "cancel_run"`** — Stop a run, mark remaining pending batches as 'skipped'

Input:
```json
{
  "action": "cancel_run",
  "runId": "uuid"
}
```

**`action: "run_status"`** — Load full run state (for UI hydration on page load)

Input:
```json
{
  "action": "run_status",
  "runId": "uuid"
}
```

Returns: run record + all batch records (ordered by batch_index) + city/tile metadata.

### 3.2 Existing Actions — Keep As-Is

`generate_tiles`, `preview_cost`, `coverage_check` — unchanged. They still work.

The old `seed` action can stay for backward compat but the UI will no longer call it.

---

## 4. Admin UI Changes

### 4.1 SeedTab — New Flow

**Phase 1: Setup (before seeding starts)**
- Same as today: select city, see tiles, pick categories, preview cost
- "Start Seeding" button now calls `create_run` instead of the old `seed` loop
- After `create_run` returns: show the full batch queue (e.g., "520 batches: 40 tiles × 13 categories")

**Phase 2: Batch-by-Batch Execution**
- Show the current batch: "Tile 3 (row 1, col 2) × Casual Eats"
- **"Run This Batch"** button → calls `run_next_batch`
- While running: spinner on that single batch
- On completion: show result inline:
  - Green: "6 new, 3 dupes, 0 rejected — $0.032"
  - Red: "FAILED: Google API 429 — rate limited"
- **"Run Next"** button appears → calls `run_next_batch` for the next pending batch
- **"Skip"** button → skips current batch
- **"Cancel Run"** button → stops the whole run

**Phase 3: Progress Tracker (persistent)**
- Progress bar: "Batch 47 / 520 (9%)"
- Running totals: X new places, Y dupes, $Z.ZZ spent
- Scrollable log of completed batches — each row shows tile index, category, result, timestamp
- Failures highlighted in red with expandable error details
- This entire view is **hydrated from the database** on page load via `run_status`

**Phase 4: Completion**
- When all batches done (or cancelled): summary card with totals
- Link to Stats tab for full history

### 4.2 On Page Load / Refresh

1. Check: does this city have a `seeding_runs` row with status='running' or 'paused'?
2. If yes → call `run_status` → hydrate the batch-by-batch view at exactly where it left off
3. If no → show normal setup view

### 4.3 Stats Tab — Enhanced

The existing seeding history table (reads from `seeding_operations`) gets a second section:

**Seeding Runs** — one row per run, expandable to show all batches:
- Run date, categories selected, total batches, completed/failed, total cost, status
- Expand → full batch log with per-(tile, category) results
- Filter by: status (completed/failed), category, tile index

---

## 5. What Gets Logged Per Batch

Every single (tile, category) execution writes to `seeding_batches`:

| Field | Value |
|-------|-------|
| `tile_id` + `tile_index` | Which geographic circle |
| `seeding_category` | Which Mingla category |
| `google_api_calls` | Always 1 (single API call per batch) |
| `places_returned` | Raw count from Google |
| `places_rejected_*` | Breakdown by rejection reason |
| `places_new_inserted` | Actually new to pool |
| `places_duplicate_skipped` | Already existed |
| `estimated_cost_usd` | $0.032 per search call |
| `error_message` | NULL on success, error text on failure |
| `error_details` | JSONB with full error context |
| `started_at` / `completed_at` | Timestamps |

---

## 6. Invariants

1. **One batch = one API call.** No batch ever makes more than one Google Nearby Search request.
2. **No auto-advance.** After each batch, the system pauses and waits for manual approval.
3. **Every batch is logged.** Even failures write a complete record to `seeding_batches`.
4. **UI state comes from DB.** The SeedTab reads `seeding_runs` + `seeding_batches` — no ephemeral React state for progress.
5. **Runs are resumable.** A 'paused' run can be continued from any session, any browser, any day.
6. **Batch order is deterministic.** Tile-first (by tile_index ASC), then category (by SEEDING_CATEGORIES array order).

---

## 7. Migration Plan

1. New migration: create `seeding_runs` + `seeding_batches` tables with RLS
2. Edge function: add 5 new actions to `admin-seed-places` (create_run, run_next_batch, skip_batch, cancel_run, run_status)
3. Admin UI: rewrite SeedTab to use new flow
4. Stats tab: add Seeding Runs section
5. Keep old `seed` action and `seeding_operations` table — no breaking changes to existing data

---

## 8. Files to Modify

| File | Change |
|------|--------|
| `supabase/migrations/NEW_sequential_batch_seeding.sql` | New tables: seeding_runs, seeding_batches |
| `supabase/functions/admin-seed-places/index.ts` | Add 5 new action handlers |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Rewrite SeedTab + enhance StatsTab |

---

## 9. What This Does NOT Change

- Tile generation algorithm (same grid math)
- Google API call structure (same Nearby Search request)
- Post-fetch filtering logic (same 3 filters)
- Place pool upsert strategy (same 2-step insert/update)
- Cost controls ($70 hard cap still applies at run creation)
- Other admin pages (PlacePoolBuilder, CityLauncher — unchanged)
- Card generation pipeline — unchanged
