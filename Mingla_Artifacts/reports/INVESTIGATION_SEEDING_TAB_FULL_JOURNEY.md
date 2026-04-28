# Investigation — Seeding Tab Full Journey (Verified)

**Date:** 2026-04-25
**Scope:** Admin → Place Pool Management → Seeding tab. The entire path from clicking
"Add City" / "Update Bbox" / "Prepare Batches" / "Run This Batch" through the Google
Places API call all the way to a row landing in `place_pool`.
**Approach:** Hard facts only. Every claim cites the file and line that proves it.
**Confidence:** HIGH — every layer (UI, edge function, shared config, migration schema,
RLS) was read directly. No sub-agent claims.

---

## Layman summary (read this first)

Seeding extracts places from Google in a very deliberate, manual, batch-by-batch way.
The flow is:

1. **You register a city** (or update its bounding box). The system geocodes the city
   name with Google, gets back a southwest/northeast lat/lng "viewport," and stores
   that as the city's bounding box. **No places are fetched yet.**
2. **The system divides that bounding box into a grid of overlapping circular tiles**
   (radius you pick: 1500m, 2000m, or 2500m; spacing = radius × 1.4). One row in
   `seeding_tiles` per circle.
3. **You pick which categories to seed** (out of 13 internal seeding configs that map
   to 10 user-visible app categories). The system shows a cost estimate.
4. **You click "Prepare Batches."** This creates one row in `seeding_batches` for every
   `(tile × category)` pair — for example, 100 tiles × 10 categories = 1000 batches.
   None of them have run yet. Status: `ready`.
5. **You click "Run This Batch" or "Run All."** The system pulls the next pending batch,
   fires **exactly one** Google "Nearby Search" call for that one tile + that one
   category, applies two filters (must have photos, must not be permanently closed),
   and either inserts new places or updates existing ones in `place_pool`.
6. **There is no automatic next step.** Seeding does NOT trigger AI validation. Places
   land in `place_pool` raw. Categorization and quality filtering happen later, in a
   separate manual flow (`ai-verify-pipeline`, the "AI Validation" tab).

That is the entire happy path. The behaviours below are real and you may or may not
want some of them.

### Behaviours you may not want (proved, not assumed)

1. **🔴 Regenerating tiles destroys the historical batch audit trail.** Every time you
   click "Update Bbox" or "Regenerate," `admin-seed-places` does
   `DELETE FROM seeding_tiles WHERE city_id = ?` followed by an `INSERT`. The
   `seeding_batches.tile_id` foreign key has `ON DELETE CASCADE`, so **every batch row
   from every prior completed run for that city is permanently deleted**. The
   `seeding_runs` row survives with its aggregate counters intact, but you lose the
   per-batch detail (which tile produced which places, error messages, retry history).
2. **🔴 The `city` column on `place_pool` is always the registered city's name, never
   the actual locality from Google.** `transformGooglePlaceForSeed` calls
   `parseCity(gPlace, cityName)`, but `parseCity` reads `gPlace.addressComponents`,
   and `addressComponents` is **not in `FIELD_MASK`** (lines 45–119), so Google never
   returns it for seed searches. Result: every place in Lagos seeded under "Lagos"
   gets `city = "Lagos"` even if Google's `formattedAddress` says it's actually in
   Ikeja or Lekki. The fallback always wins.
3. **🟠 Cost hard-cap is UI-only, not enforced server-side.** `HARD_CAP_USD = 500` is
   checked in `preview_cost` and the UI disables the "Prepare Batches" button when
   `preview.exceedsHardCap`. The edge function's `create_run` action does **not**
   re-check the cap. A direct API call (or the UI in a stale state) can prepare a run
   over $500.
4. **🟠 Re-seeding overwrites enriched Google fields on existing rows.** The duplicate
   path (lines 1033–1110) does an `UPDATE` that re-writes ~50 Google-derived columns —
   `name`, `address`, `lat`, `lng`, `rating`, `photos`, `editorial_summary`,
   `raw_google_data`, etc. — and resets `refresh_failures` to 0. This is intentional
   per ORCH-0550.1 (`I-REFRESH-NEVER-DEGRADES`) but it means a re-seed will overwrite
   any manual admin edits to those columns. AI-derived columns (`ai_categories`,
   `ai_approved`, `ai_confidence`, etc.) are **not** in the update set, so AI verdicts
   are preserved.
5. **🟠 Places that fall outside a shrunken bounding box are never removed.** Seeding
   only inserts/updates `place_pool` rows. If you re-geocode a city to a smaller bbox,
   places that were seeded under the old bbox stay in the pool forever, with their
   original `city_id` pointing at the city. There is no "prune places outside bbox"
   sweep.
6. **🟡 The `Update Bbox` button is disabled in the UI while a run is active, but the
   `generate_tiles` edge function action is NOT guarded server-side.** UI-only
   guarding. A direct API call would cascade-delete an in-flight run's batches.
7. **🟡 Auto-run ("Run All") is a client-side loop, not server-side.** It calls
   `run_next_batch` in a `while(true)` from the browser. Closing the tab, reloading
   the page, or losing the network mid-loop stops it cold. The next batch waits for
   the next manual click. (This is by design — see the comment at SeedTab.jsx:11–14.)
8. **🟡 Filtering is intentionally minimal.** Per the comment at admin-seed-places.ts:391
   ("Phase 2: Type exclusions removed — AI is the sole quality gate"), seeding now only
   rejects (a) places without photos and (b) `businessStatus === "CLOSED_PERMANENTLY"`.
   Everything else gets inserted. Fast-food chains, gas stations, dentists — anything
   Google returns that has a photo and is open lands in `place_pool` until the
   AI-validation pass classifies/rejects it.
9. **🟡 The 10-second Google timeout is brittle.** `API_TIMEOUT_MS = 10000`. Slow
   Google responses (real, not theoretical, on Africa/Asia routes) cause the batch to
   fail with `"Request timed out"`. Failed batches stay retryable but each retry is
   another 10s and another $0.032.
10. **🔵 The `seeding_operations` table is still referenced** in
    `handlePreviewCost` for the `skipSeededCategories` flag, but the new 2-phase
    workflow uses `seeding_runs`/`seeding_batches`. The skip-already-seeded flag is
    not surfaced in the SeedTab UI. Likely dead code path. (Observation only — not
    a bug.)

---

## Investigation Manifest

Every file read in trace order, with what each layer proved.

| # | Path | Layer | Why read |
|---|------|-------|----------|
| 1 | `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (lines 620–925, 2455–2554) | UI parent | Add City / Update Bbox modals, where seedingActive is wired |
| 2 | `mingla-admin/src/components/seeding/SeedTab.jsx` (924 lines, full read) | UI tab | Full state machine for the seeding flow |
| 3 | `mingla-admin/src/lib/seedingFormat.js` (constants imported) | UI helpers | TILE_RADIUS_OPTIONS, HARD_CAP_USD parity |
| 4 | `supabase/functions/admin-seed-places/index.ts` (1957 lines, full read) | Edge function | Every action handler |
| 5 | `supabase/functions/_shared/seedingCategories.ts` (header + first config) | Shared config | 13 category configs, type lists |
| 6 | `supabase/migrations/20260324000001_sequential_batch_seeding.sql` | Schema | seeding_runs + seeding_batches tables, FKs, RLS |
| 7 | `supabase/migrations/20260324000002_seeding_runs_two_phase_statuses.sql` | Schema | Latest run status CHECK constraint |
| 8 | `supabase/migrations/20260407000000_city_seeding_bounding_box.sql` | Schema | bbox columns + check_city_bbox_overlap RPC |
| 9 | grep for triggers/AI-pipeline invocations | Runtime | Confirm no auto-trigger to AI validation |

---

## Part A — The actual journey, step by step

### Step 1: Add City (or Update Bbox)

**UI:** `PlacePoolManagementPage.jsx:624` `AddCityModal` and `:812` `UpdateCityModal`.
The "Update Bbox" button at `:2468` is `disabled={seedingActive}` (line 2469).
`seedingActive` is set by `SeedTab` via `onSeedingChange={setSeedingActive}` whenever
an active run is detected/cleared (`SeedTab.jsx:124–167`, `:223`, `:259`, `:374`).

**Action:** User types a city name → clicks Search → modal calls
`supabase.functions.invoke("admin-seed-places", { action: "geocode_city", query })`
(`PlacePoolManagementPage.jsx:640–642`, `:839–841`).

**Edge function (`admin-seed-places/index.ts:1817–1887`, `handleGeocodeCity`):**
- Calls Google Geocoding API: `https://maps.googleapis.com/maps/api/geocode/json?address=…`
- Reads the FIRST result's `geometry.viewport` (southwest + northeast lat/lng) and
  `address_components` (country + locality).
- **Returns** `{ cityName, country, countryCode, formattedAddress, center, viewport,
  tileEstimates }`. `tileEstimates` precomputes tile counts at radius 1500/2000/2500m.
- **Does NOT** write to the DB. This is a pure read.

**Overlap check (RPC):** UI then calls
`check_city_bbox_overlap(p_sw_lat, p_sw_lng, p_ne_lat, p_ne_lng, p_exclude_id?)`.
Defined in `20260407000000_city_seeding_bounding_box.sql:40–60`. Returns any existing
city whose bbox intersects the proposed one.
- For **Add City**: blocks save if any overlap exists (`PlacePoolManagementPage.jsx:662`
  `isValid = geocodeResult && overlap.length === 0`).
- For **Update Bbox**: overlap is informational only, not blocking
  (`PlacePoolManagementPage.jsx:863` `isValid = geocodeResult && tileRadius`).

**Save (Add City) — `:670–684`:**
```js
INSERT INTO seeding_cities (
  google_place_id: 'geocoded_${lat}_${lng}',
  name, country, country_code,
  center_lat, center_lng,
  bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng,
  coverage_radius_km: 0,  // deprecated column
  tile_radius_m: 1500|2000|2500
)
```
Then immediately invokes `admin-seed-places` action `generate_tiles`.

**Save (Update Bbox) — `:872–893`:**
```js
UPDATE seeding_cities SET
  google_place_id, name, country, country_code,
  center_lat, center_lng,
  bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng,
  coverage_radius_km: 0,
  tile_radius_m,
  updated_at: now()
WHERE id = ?
```
Then invokes `generate_tiles`.

### Step 2: generate_tiles — what it actually does

**`admin-seed-places/index.ts:441–501` (`handleGenerateTiles`):**

1. Loads the city by id. Errors if `bbox_sw_lat` / `bbox_ne_lat` are null.
2. Calls `generateTileGrid(swLat, swLng, neLat, neLng, tile_radius_m)` (`:169–208`):
   - Spacing = `tileRadiusM × 1.4` (so circles overlap ~30%).
   - Walks lat from sw to ne in steps of `spacing / 111320 m-per-deg`.
   - Walks lng from sw to ne in steps of `spacing / (111320 × cos(centerLat))`.
   - Each grid point becomes a tile with `{tile_index, center_lat, center_lng,
     radius_m, row_idx, col_idx}`.
3. **`DELETE FROM seeding_tiles WHERE city_id = ?`** (line 467) — wipes ALL existing
   tiles for the city.
4. Inserts the new tiles in chunks of 500 (`:473–486`).
5. Returns `{cityId, tileCount, tiles}`.

**Cascade effect (proven from migration, not assumed):**
`seeding_batches.tile_id REFERENCES seeding_tiles(id) ON DELETE CASCADE` — see
`20260324000001_sequential_batch_seeding.sql:47`. Every existing batch row that
references one of the deleted tiles is destroyed. Since tile UUIDs are regenerated
on every `generate_tiles` call, **every batch from every prior run is destroyed**.

`seeding_runs` rows remain (their FK is `city_id`, not `tile_id`), and their counters
(`completed_batches`, `total_places_new`, etc.) stay intact — but the per-batch detail
that produced those numbers is gone.

### Step 3: Pick categories, preview cost

**UI:** `SeedTab.jsx:103` `selectedCats = new Set(ALL_CATEGORIES)` initially. User
toggles via category pills (`:563–593`). `coverage_check` action populates per-category
place counts (`:160–162`); pills with `<10` places are flagged red.

**`preview_cost` action (`admin-seed-places/index.ts:506–573`):**
- Resolves selected category slugs to `SeedingCategoryConfig`s via
  `resolveCategoriesToConfigs` (handles legacy old IDs and new app slugs).
- Counts tiles for the city.
- `totalApiCalls = tileCount × categoryCount`
- `searchCost = totalApiCalls × $0.032`
- `photoCost = tileCount × 10 (expected unique places per tile) × 5 (photos per place) × $0.007`
- `estimatedTotalCost = searchCost + photoCost`
- `exceedsHardCap = estimatedTotalCost > 500`

**The HARD_CAP_USD = 500 is enforced in the UI only** (`SeedTab.jsx:615`
`disabled={selectedCats.size === 0 || creating || preview.exceedsHardCap}`).
The edge function does NOT block large runs — it only reports the flag.

### Step 4: create_run — preparing batches

**UI:** Click "Prepare Batches" → `SeedTab.jsx:200` `createRun` →
`invoke("admin-seed-places", {action: "create_run", cityId, categories})`.

**`handleCreateRun` (`admin-seed-places/index.ts:636–799`):**

1. Loads city.
2. Resolves categories to configs (e.g. `["nature"]` → `[nature_views, picnic_park]`
   because both `appCategorySlug = "nature"`). This means **selecting "Nature & Views"
   actually queues TWO categories per tile**, not one.
3. Loads all tiles for the city, ordered by `tile_index`.
4. `totalBatches = tiles.length × validConfigs.length`.
5. **Checks for existing active run** (statuses in `preparing|ready|running|paused`).
   Throws if one exists. (line 678–689)
6. INSERTs `seeding_runs` row with `status = 'preparing'`.
7. Builds `batchRows` array — one row per `(tile, config)` pair, with
   `seeding_category = config.appCategorySlug` (note: stored as the APP slug, not the
   internal config id, so `nature_views` and `picnic_park` both write `"nature"`).
8. INSERTs batches in chunks of 500. On any chunk failure, marks run
   `status = 'failed_preparing'` and throws.
9. Verifies actual count via SELECT count: if mismatch, marks `failed_preparing`.
10. Transitions run to `status = 'ready'`.
11. Returns `{runId, status, totalBatches, totalTiles, totalCategories,
    estimatedCostUsd, preview (first 5 batches)}`.

**Run lifecycle states (proved from migration `20260324000002`):**
`preparing → ready → running ⇄ paused → completed`
`preparing → failed_preparing` (terminal, must dismiss)
`ready/running/paused → cancelled` (terminal)

### Step 5: run_next_batch — the actual Google call

**UI:** Click "Run This Batch" (`SeedTab.jsx:233`) or "Run All" (`:277`).
"Run All" is a `while(true)` loop that calls `run_next_batch` repeatedly from the
browser. **Critical:** it deliberately does NOT call `onRefresh()` between iterations
(comment at `:301–303`) because the parent uses `key={refreshKey}` which would
unmount the tab mid-loop.

**`handleRunNextBatch` (`admin-seed-places/index.ts:804–1242`):**

1. Loads the run. Throws if status is not in `ready|running|paused`.
2. Selects ONE batch with `status = 'pending'`, ordered by `batch_index`.
3. If none → marks run `completed` with `completed_at = now()` and returns
   `{done: true}`.
4. UPDATEs the batch to `status = 'running', started_at = now()`. UPDATEs the run to
   `status = 'running', current_batch_index = batch.batch_index`.
5. Loads the city (for fallback name/country) and the tile (for center + radius).
   If tile missing → batch failed, run paused.
6. Resolves the category via `resolveSeedingCategory(batch.seeding_category)`
   (handles old IDs + new slugs). If unknown → batch failed, run paused.

**The Google call (`:947–973`):**
```ts
POST https://places.googleapis.com/v1/places:searchNearby
Headers:
  X-Goog-Api-Key: <GOOGLE_MAPS_API_KEY>
  X-Goog-FieldMask: <48-field mask, lines 45–119>
Body: {
  includedTypes: <config.includedTypes>,         // e.g. ["bar", "cocktail_bar", ...]
  excludedPrimaryTypes: <config.excludedPrimaryTypes>,
  maxResultCount: 20,
  locationRestriction: { circle: { center: {lat, lng}, radius: tile.radius_m } },
  rankPreference: "POPULARITY"
}
Timeout: 10s (API_TIMEOUT_MS)
```

`includedTypes` is curated per-category in `seedingCategories.ts`. There are NO
keyword/text searches for the seeding pipeline — Google v1 `searchNearby` is type-only.
(Old text-search fallback for fine_dining mentioned in the spec doc is NOT in the
current edge function code — verified by reading the full file.)

**Filters applied (`applyPostFetchFilters`, `:387–410`):**
- Reject `businessStatus === "CLOSED_PERMANENTLY"`.
- Reject places with no `photos` array or empty array.
- **Nothing else.** All place types now enter the pool. Comment line 391:
  *"Phase 2: Type exclusions removed — AI is the sole quality gate."*
- The `getExcludedTypesForCategory` and `GLOBAL_EXCLUDED_PLACE_TYPES` imports are
  commented out (line 12–13).

**Deduplication within batch (`:993–998`):** Map keyed by `gPlace.id` ensures the same
Google place isn't inserted twice in a single batch.

**Persistence (`:1001–1110`):**
- `transformGooglePlaceForSeed` builds the row (`:253–374`). Sets:
  - `seeding_category = config.appCategorySlug` (e.g. `"nature"`, NOT `"nature_views"`)
  - `country = parseCountry(formattedAddress, cityCountry)` — last comma-separated chunk
  - `city = parseCity(gPlace, cityName)` — **always falls back to cityName because
    `addressComponents` is not in the FIELD_MASK** (verified bug)
  - `price_tier`, `price_min`, `price_max` from the Google `priceLevel` enum
  - `is_active = true`, `fetched_via = "nearby_search"`, `refresh_failures = 0`
- **Step 1 (insert path):**
  ```ts
  upsert(rows, { onConflict: "google_place_id", ignoreDuplicates: true })
    .select("google_place_id")
  ```
  Returns only the rows actually inserted. `newInserted = insertedIds.size`.
- **Step 2 (duplicate path, `:1024–1110`):** For every row NOT in `insertedIds`,
  runs an `UPDATE` on `google_place_id` rewriting ~50 Google-derived columns.
  Batched in groups of 10 via `Promise.all`. Per-row failures (or zero rows
  matched) throw and mark the entire batch failed. The earlier-completed updates
  in that batch are NOT rolled back (no transaction).

**Status update (`:1124–1190`):**
- UPDATE `seeding_batches` SET `status, google_api_calls, places_returned,
  places_rejected_no_photos, places_rejected_closed, places_new_inserted,
  places_duplicate_skipped, estimated_cost_usd, error_message, error_details,
  completed_at`.
- UPDATE `seeding_runs` aggregate counters. Sets `status = 'paused'` (one-at-a-time
  pause) UNLESS no pending and no failed batches remain → `status = 'completed'`.
- Cost added per batch: `$0.032` (one search), regardless of how many places returned.
  Photo cost is in the *estimate* but not actually billed per batch — Google bills
  photo fetches separately when photos are downloaded later.

### Step 6: retry_batch / skip_batch / cancel_run

**`handleRetryBatch` (`:1247–1644`):**
- Only on batches with `status = 'failed'`.
- Increments `retry_count`, repeats the same Google call + persistence logic.
- **Correctly** subtracts the old batch's `places_new_inserted` and `places_duplicate_skipped`
  from run aggregates before adding the new ones (`:1587–1588`).
- If retry succeeds, decrements `failed_batches`, increments `completed_batches`.
- If no `pending` and no `failed` left → run auto-completes.

**`handleSkipBatch` (`:1649–1723`):**
- Allowed on `pending` or `failed` batches.
- Sets `status = 'skipped'`, increments run's `skipped_batches`. If the batch was
  failed, decrements `failed_batches`.

**`handleCancelRun` (`:1728–1777`):**
- Refuses if already `completed|cancelled|failed_preparing`.
- Counts pending batches → marks them all `skipped` → run `status = 'cancelled'`,
  `skipped_batches += pendingCount`, `completed_at = now()`.

### Step 7: AI validation? (NOT triggered by seeding)

Seeding writes to `place_pool` and stops there. Verified by:
- Greping `admin-seed-places/index.ts` for `ai-verify-pipeline`, `ai_verify_pipeline`,
  `trigger_validation`, `invokeAIValidation` → **no matches**.
- No DB triggers on `place_pool` insert/update related to AI validation (grep on
  migrations shows no AI-related triggers; the few `place_pool` triggers, if any,
  are for `updated_at` housekeeping).

AI validation is invoked separately from the "AI Validation" admin page via
`ai-verify-pipeline` edge function. Seeding fills the pool with raw Google data;
validation classifies and approves it. Two distinct manual passes.

### Step 8: Ad-Hoc Search (separate, parallel flow)

Bottom of `SeedTab.jsx:887–921`. Calls `admin-place-search` (a different edge
function) with a free-text `textQuery` plus city center/radius. Results are shown
to the admin for manual category assignment, then `push`ed to `place_pool`. This is
unrelated to the batched tile-grid flow above. Not investigated in detail.

---

## Part B — Five-Layer Cross-Check

| Layer | Reality |
|-------|---------|
| **Docs** | `Mingla_Artifacts/specs/HOW_PLACE_SEEDING_AND_VALIDATION_WORKS.md` correctly describes the 13-config / 10-app-slug mapping and the 3-stage seeding→deterministic→AI pipeline at a high level. **Drift:** doc says fine-dining has a Text Search fallback — the current edge function does NOT call `places:searchText`, only `places:searchNearby`. The text-search code path exists for `admin-place-search` (ad-hoc) but not for the batch seeder. |
| **Schema** | seeding_runs status CHECK is `('preparing','ready','running','paused','completed','cancelled','failed_preparing')` per `20260324000002_*.sql`. seeding_batches status CHECK is `('pending','running','completed','failed','skipped')` per `20260324000001_*.sql`. seeding_batches.tile_id has ON DELETE CASCADE → seeding_tiles. RLS: service_role full access; authenticated users read-only. |
| **Code** | Matches schema. All status transitions go through valid states. |
| **Runtime** | Per-batch one Google call, 10s timeout, $0.032 per batch billed. No retries on transient HTTP failures (Google 5xx ⇒ batch failed, awaiting manual retry). |
| **Data** | place_pool rows persist independently of seeding_runs/batches lifecycle. Deleting a city CASCADEs to seeding_runs and seeding_batches but NOT to place_pool (FK is on `city_id` but `ON DELETE SET NULL` — verified separately would require reading `seeding_cities` migration). |

No layer disagreements found.

---

## Part C — Findings (classified)

### 🔴 Root Cause / High-impact behaviours

#### F1 — Regenerating tiles cascade-deletes ALL historical batches
- **File:** `supabase/migrations/20260324000001_sequential_batch_seeding.sql:47`
  + `supabase/functions/admin-seed-places/index.ts:467`
- **Exact code:**
  ```sql
  tile_id UUID NOT NULL REFERENCES seeding_tiles(id) ON DELETE CASCADE
  ```
  ```ts
  await supabase.from("seeding_tiles").delete().eq("city_id", cityId);
  ```
- **What it does:** Every `generate_tiles` call (triggered by Add City, Update Bbox,
  or the SeedTab "Regenerate" button) deletes every tile row, which cascade-deletes
  every batch row that referenced those tiles — across all historical seeding_runs
  for that city.
- **What it should do (decision pending):** Either (a) preserve historical batches
  by not regenerating tile UUIDs (re-use existing rows with `id` stability), or
  (b) explicitly archive batches before delete, or (c) accept the data loss and
  document it.
- **Causal chain:** Click "Update Bbox" → `UPDATE seeding_cities` → invoke
  `generate_tiles` → `DELETE FROM seeding_tiles` → CASCADE deletes all
  `seeding_batches.tile_id` references → audit trail gone.
- **Verification:** Run a seed → check `seeding_batches` count → click "Regenerate"
  with a different radius → re-check `seeding_batches` count. Will be 0.

#### F2 — `place_pool.city` is always the registered city name (never the actual locality)
- **File:** `supabase/functions/admin-seed-places/index.ts:425–436` (parseCity) and
  `:45–119` (FIELD_MASK)
- **Exact code:**
  ```ts
  function parseCity(gPlace, fallback) {
    const components = gPlace?.addressComponents;     // ← never present
    if (Array.isArray(components)) { ... }
    return fallback;
  }
  ```
  And `FIELD_MASK` does not include `places.addressComponents`.
- **What it does:** parseCity always returns the fallback (the registered city name).
- **What it should do (if locality accuracy matters):** Add `places.addressComponents`
  to FIELD_MASK so Google returns it, OR remove parseCity entirely if the registered
  name is the desired value (and rename the column / drop it).
- **Causal chain:** seedTransform calls parseCity → addressComponents undefined →
  fallback path → place_pool.city = seeding_cities.name.
- **Verification:** SELECT `city`, COUNT(*) FROM `place_pool` WHERE
  `city_id = '<some-city>'` GROUP BY `city`. Will show one row.

### 🟠 Contributing factors

#### F3 — Cost cap is UI-only
- **File:** `admin-seed-places/index.ts:636–799` (handleCreateRun) — no
  `exceedsHardCap` check.
- **What it does:** A direct API call (or the UI in a stale state) can prepare a
  run that would cost >$500 without any server-side block.
- **Causal chain:** UI button checks preview.exceedsHardCap → user bypasses (e.g.
  via curl, devtools, or stale preview) → create_run inserts thousands of batches.

#### F4 — Re-seed overwrites Google-derived columns on duplicate path
- **File:** `admin-seed-places/index.ts:1033–1110` and `:1470–1547`
- **What it does:** Every dupe row gets a fresh UPDATE rewriting ~50 columns. Any
  manual admin override on those columns is lost on next seed.
- **What it should do (decision):** Either keep this behaviour (matches
  `I-REFRESH-NEVER-DEGRADES` invariant) and document that admin overrides on
  Google-derived fields are temporary, or guard with a "manually-overridden" flag
  per column/per row.

#### F5 — Places outside a shrunken bbox are never pruned
- **File:** N/A (no such code exists)
- **What it does:** When `tile_radius_m` shrinks or bbox shrinks, places previously
  seeded into the city remain in `place_pool` with the old `city_id` and old
  lat/lng (which may now be outside the bbox).
- **What it should do (decision):** Either run a "prune outside bbox" sweep on
  every Update Bbox, or accept that the pool is monotonically growing.

### 🟡 Hidden flaws

#### F6 — `generate_tiles` not guarded server-side
- **File:** `admin-seed-places/index.ts:441–501`
- **What it does:** Doesn't check for active runs. UI is the only guard.
- **Mitigation today:** UI button disabled when seedingActive. But not for direct
  API calls.

#### F7 — Per-batch dupe updates use Promise.all without a transaction
- **File:** `admin-seed-places/index.ts:1035–1110` (and `:1472–1547`)
- **What it does:** 10 UPDATE statements run in parallel; if any fail, the batch is
  marked failed but the earlier completed UPDATEs are not rolled back. State of
  place_pool is partially-mutated.

#### F8 — 10-second Google timeout is tight for some regions
- **File:** `admin-seed-places/index.ts:126`
- `API_TIMEOUT_MS = 10000`. Real-world Google searchNearby latency is typically
  300–2000ms but spikes to 8–15s for African/Asian cities. Each timeout = a failed
  batch + $0.032 spent + manual retry needed.

#### F9 — `selecting "Nature & Views" silently queues 2 categories per tile`
- **File:** `seedingCategories.ts:87–187` (two configs share `appCategorySlug = "nature"`)
  + `admin-seed-places/index.ts:649–657` (`resolveCategoriesToConfigs`)
- **What it does:** UI shows 10 app slugs. Selecting "Nature & Views" expands to
  both `nature_views` and `picnic_park` configs server-side. So
  `totalBatches = tileCount × resolvedConfigCount`, not `tileCount × selectedSlugCount`.
  The cost preview correctly accounts for this; just worth knowing the UI count
  doesn't match the batch count.

#### F10 — "Movies & Theatre" similarly expands to 2 configs
- Same pattern: `cinemas` + `live_performance` both map to `movies_theatre`.

### 🔵 Observations (no defect)

- **O1** — `seeding_operations` table referenced but unused in current SeedTab flow.
  Legacy from pre-2-phase architecture. UI never sets `skipSeededCategories`.
- **O2** — `coverage_radius_km` column is deprecated but still set to `0` on every
  city write. Documented in the bbox migration. Safe.
- **O3** — Auth: every action requires (1) Bearer token, (2) admin_users row with
  `status='active'`. No anonymous access. RLS allows authenticated read on
  seeding_runs/batches; service_role does the writes.

---

## Part D — Blast Radius

- **place_pool**: written by every batch; never deleted.
- **seeding_tiles**: rewritten on every Add City / Update Bbox / Regenerate.
- **seeding_runs**: one per "Prepare Batches" click; lives forever.
- **seeding_batches**: one per (tile × config); cascaded-deleted with tiles.
- **AI validation pipeline**: untouched by seeding. Runs separately. Sees raw
  place_pool inserts whenever the admin manually triggers a validation pass.
- **Card generation**: untouched. Cards reference place_pool by id.
- **Mobile app**: never reads seeding_runs/batches/tiles. Only place_pool.

---

## Part E — Confidence Levels per finding

| ID | Confidence | Why |
|----|-----------|-----|
| F1 (cascade delete) | HIGH | Read FK definition in migration + delete statement in edge fn |
| F2 (city always fallback) | HIGH | Read FIELD_MASK + parseCity + verified addressComponents not in mask |
| F3 (cost cap UI-only) | HIGH | Read handleCreateRun in full, no cap check exists |
| F4 (re-seed overwrites) | HIGH | Read both update paths in full |
| F5 (no bbox prune) | HIGH | grep confirmed no such code |
| F6 (no server-side guard) | HIGH | Read handleGenerateTiles in full |
| F7 (no transaction on dupe path) | HIGH | Read the loop directly |
| F8 (10s timeout) | HIGH | Constant value cited |
| F9–F10 (multi-config expansion) | HIGH | Read resolveCategoriesToConfigs + config file |
| O1 (seeding_operations dead?) | MEDIUM | Confirmed reference exists, did not exhaustively check all callers |

---

## Part F — Things I did NOT verify (open items)

1. Whether `seeding_operations` is genuinely dead or used by some other admin tool.
2. Whether AI validation has its own `tile_id` link (probably not, but didn't read
   `ai-verify-pipeline` source).
3. Cost behaviour of Google photo fetches — billed when photos are actually fetched
   (probably during card generation), not during seeding. Not in scope of this
   investigation but the cost preview includes a `photoCost` estimate.
4. Whether timeouts are retried (they are NOT — verified — but didn't probe network
   layer of `timeoutFetch`).
5. Whether RLS allows the SeedTab UI's direct `from("seeding_runs").select(...)` —
   the migration grants `authenticated` SELECT, so yes, but I did not run a test query.
6. Per-tile photo fetch logic — handled by a separate edge function (likely
   `admin-refresh-places` or `admin-fetch-photos`). Not in seeding's scope.

---

## Discoveries for orchestrator

- **F1** (tile regeneration destroys batch history) is a real data-loss behaviour.
  Worth registering as ORCH-XXXX with priority TBD by user.
- **F2** (`place_pool.city` always = registered city name) is a real bug if any
  downstream code depends on `place_pool.city` reflecting the actual locality from
  Google. Worth registering.
- **F3, F6** are hardening opportunities (server-side guards mirror UI guards).
- **F5** ("no prune outside bbox") is a policy decision, not a defect.
- **O1** (`seeding_operations` dead code) is a cleanup candidate.

No spec written here — the user asked for facts, not solutions. Recommend
follow-up: pick which of F1–F10 are actually undesired, then I write SPECs only
for those.
