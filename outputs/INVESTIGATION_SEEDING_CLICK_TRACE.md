# Investigation: What Happens When You Click "Start Seeding" (3 Categories)

**Date:** 2026-03-24
**Confidence:** HIGH — every file read, full chain traced

---

## Plain English Summary

The system has **already been rebuilt** to match the spec we discussed. It's no longer the old fire-and-forget flow. Here's what happens now, step by step, when you select 3 categories and click the button.

---

## The Full Chain (Example: 40 tiles, 3 categories selected: drink, casual_eats, nature_views)

### Step 1: Button Click → "Prepare 120 Batches"

**UI:** `PlacePoolManagementPage.jsx:679` — Button label is `Prepare {N} Batches` (NOT "Start Seeding")
**Function:** `createRun()` at line 393

```
Click → createRun() → edge function "admin-seed-places" { action: "create_run" }
```

### Step 2: Edge Function — `handleCreateRun` (line 924-1098)

**What it does, in order:**

1. **Load city** from `seeding_cities` (line 932)
2. **Resolve categories** — `["drink", "casual_eats", "nature_views"]` → look up configs from `SEEDING_CATEGORY_MAP` (line 945)
3. **Load tiles** ordered by `tile_index` ASC (line 954) — gets all 40 tiles
4. **Calculate total batches** = 40 tiles × 3 categories = **120 batches** (line 964)
5. **Check $70 cost cap** — 120 × $0.032 = $3.84 search + photo estimate → passes (line 966)
6. **Check no existing active run** for this city (line 977) — throws if one exists
7. **Insert `seeding_runs` row** with `status: "preparing"` (line 991)
8. **Build batch queue** — tile-first loop (line 1008):

```
batch_index 0:   tile 0 × drink
batch_index 1:   tile 0 × casual_eats
batch_index 2:   tile 0 × nature_views
batch_index 3:   tile 1 × drink
batch_index 4:   tile 1 × casual_eats
batch_index 5:   tile 1 × nature_views
...
batch_index 117: tile 39 × drink
batch_index 118: tile 39 × casual_eats
batch_index 119: tile 39 × nature_views
```

9. **Insert all 120 batch rows** into `seeding_batches` with `status: "pending"` — chunked in groups of 500 (line 1028)
10. **Verify count** — re-counts batch rows to confirm 120 inserted (line 1054). If mismatch → marks run as `failed_preparing`
11. **Transition run to `status: "ready"`** (line 1076)
12. **Return** runId, total batches, preview of first 5 batches

### Step 3: UI Hydrates the Run

Back in the admin panel (`createRun` at line 408-418):

1. Fetches the `seeding_runs` row from DB
2. Fetches all 120 `seeding_batches` rows ordered by `batch_index`
3. Sets `activeRun` and `batches` state → triggers Phase 2 UI

**What you see:** A green "Run Ready" card saying "All 120 batches are prepared and ready for approval." Below it: the "Next Batch" card showing **"Batch 1: Tile #0 × Drink"** with two buttons: **"Run This Batch"** and **"Skip"**.

### Step 4: You Click "Run This Batch"

**Function:** `runNextBatch()` at line 426
**Edge function:** `handleRunNextBatch` (line 1103-1485)

**What it does, in order:**

1. **Load run** — verify status is `ready`/`running`/`paused` (line 1115)
2. **Find first pending batch** — `WHERE status='pending' ORDER BY batch_index LIMIT 1` (line 1120) → gets batch_index 0: tile 0 × drink
3. **Mark batch as `running`**, set `started_at` (line 1148)
4. **Mark run as `running`**, set `current_batch_index = 0` (line 1153)
5. **Load city** name/country (line 1163)
6. **Load tile** center_lat, center_lng, radius_m (line 1172)
7. **Load category config** — `SEEDING_CATEGORY_MAP["drink"]` → includedTypes: bar, cocktail_bar, pub, brewery, etc. (line 1207)
8. **ONE Google Nearby Search** (line 1247-1272):
   - URL: `https://places.googleapis.com/v1/places:searchNearby`
   - Body: includedTypes from Drink config, excludedPrimaryTypes from Drink config, max 20 results, popularity rank, circle = tile center + radius
   - Timeout: 10 seconds
9. **Post-fetch filter** (line 1285) — rejects: no photos, permanently closed, excluded types
10. **Dedup** by google_place_id (line 1292)
11. **Upsert to `place_pool`** (line 1300-1353):
    - Step 1: `upsert` with `ignoreDuplicates: true` — inserts only new places
    - Step 2: For existing places, updates only Google-sourced fields (preserves admin edits)
12. **Update batch row** with full results: places_returned, rejected counts, new_inserted, duplicate_skipped, cost ($0.032), errors if any (line 1367)
13. **Update run aggregates** — completed_batches++, totals (line 1386)
14. **Set run to `paused`** — waiting for your next approval (line 1387)
15. **Check remaining pending batches** (line 1401) — 119 left
16. **Return** batch result + next batch preview (tile 0 × casual_eats)

### Step 5: UI Updates From Database

After `runNextBatch` returns (line 437-446):

1. **Re-fetches ALL batch rows** from `seeding_batches` (not from the response — from DB)
2. **Re-fetches run row** from `seeding_runs`
3. Updates state → UI re-renders

**What you see now:**
- Progress bar: "1 / 120 (1%)"
- Running totals: "New places: 8, Duplicates: 2, Failed: 0, Cost: $0.03"
- Batch log: **"#1 Tile 0 × Drink — 8 new · 2 dupes · 12 found · $0.03"** (green checkmark)
- Next batch card: **"Batch 2: Tile #0 × Casual Eats"** with "Run This Batch" button

### Step 6: You Approve the Next Batch

Same flow: click → `runNextBatch` → edge function processes batch_index 1 (tile 0 × casual_eats) → returns → UI refreshes from DB.

### Step 7: Repeat Until Done (or Cancel/Skip)

Each click processes exactly one batch. You see the result before approving the next.

**If a batch fails:** The batch row gets `status: "failed"` with `error_message`. The UI shows it in red in the batch log with a **"Retry"** button and a **"Skip"** button. The run stays `paused` — you decide what to do.

**If you close the browser and come back:** The `useEffect` at line 317 checks for active runs on city change. It finds the `paused` run, loads all batches from DB, and restores the exact state — progress bar, batch log, next batch card. Nothing lost.

---

## Persistence Verification

| What | Where Stored | Survives Refresh? |
|------|-------------|-------------------|
| Run config (categories, tiles, total) | `seeding_runs` table | Yes |
| Run progress (completed, failed, cost) | `seeding_runs` table | Yes |
| Every batch result | `seeding_batches` table | Yes |
| Current position in queue | `seeding_runs.current_batch_index` | Yes |
| Batch errors | `seeding_batches.error_message` + `error_details` | Yes |
| Retry count per batch | `seeding_batches.retry_count` | Yes |

**React state is secondary.** The UI reads from DB on mount (line 321-348) and re-reads from DB after every action (lines 439-446, 457-462, 478-483). React state is just a local mirror.

---

## Stats Tab Persistence

The Stats tab (`StatsTab` at line 1128) reads from `seeding_operations` (the OLD table). It does **NOT** yet read from the new `seeding_runs`/`seeding_batches` tables.

**This is a gap:** Completed runs from the new batch system won't appear in the Stats tab's "Seeding History" table. The Stats tab still shows the old-style operation log.

---

## File Reference

| File | Lines | What It Does |
|------|-------|-------------|
| `PlacePoolManagementPage.jsx` | 293-968 | SeedTab: setup → create run → batch approval → log |
| `admin-seed-places/index.ts` | 924-1098 | `create_run`: builds queue, inserts batches |
| `admin-seed-places/index.ts` | 1100-1485 | `run_next_batch`: executes ONE batch, pauses |
| `admin-seed-places/index.ts` | 1487-1835 | `retry_batch`: re-runs a failed batch |
| `admin-seed-places/index.ts` | 1837-1914 | `skip_batch`: marks batch as skipped |
| `admin-seed-places/index.ts` | 1916-1968 | `cancel_run`: stops run, skips remaining |
| `20260324000001_sequential_batch_seeding.sql` | All | Creates `seeding_runs` + `seeding_batches` |
| `20260324000002_seeding_runs_two_phase_statuses.sql` | All | Adds preparing/ready/failed_preparing statuses |
| `20260324000003_seeding_batches_retry_count.sql` | All | Adds `retry_count` column |

---

## Findings Summary

- **FACT:** The new batch-by-batch system IS implemented — edge function has 6 new actions, UI has full approval flow, 3 migrations create the tables
- **FACT:** Loop order is tile-first, category-second (line 1008: `for tile → for config`)
- **FACT:** Every batch writes to DB immediately — UI re-reads from DB after each action
- **FACT:** Manual approval gate works — run goes to `paused` after each batch, waits for next click
- **FACT:** Failed batches can be retried or skipped individually
- **FACT:** Page refresh restores full state from DB (hydration at line 317-348)
- **GAP:** Stats tab still reads from old `seeding_operations` table, not from new `seeding_runs`/`seeding_batches` — new run history doesn't show there yet
