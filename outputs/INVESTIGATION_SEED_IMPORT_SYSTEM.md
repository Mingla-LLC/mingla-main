# Investigation: Seed & Import System — Full Architecture

**Date:** 2026-03-24
**Scope:** How tiles, categories, and places are seeded into the Mingla place pool
**Confidence:** HIGH — every file in the chain was read

---

## 1. Plain English Summary

**What "seeding" means in Mingla:**
You pick a city (e.g., "Miami"). The system divides that city into a grid of overlapping circles (tiles). For each tile, it asks Google "what restaurants/bars/parks/etc. are near this spot?" across all 13 Mingla categories. The results get filtered, deduplicated, and stored in a shared `place_pool` table. From that pool, experience cards are later generated for users to swipe.

**Two separate import flows exist:**
1. **Tile-based seeding** (automated, bulk) — PlacePoolManagementPage → `admin-seed-places` edge function
2. **Manual search-and-import** (cherry-pick) — PlacePoolBuilderPage + CityLauncherPage → `admin-place-search` edge function

---

## 2. The Complete Seeding Pipeline (Tile-Based)

### Step-by-step order of operations:

```
STEP 1: Register a City
    ↓
STEP 2: Generate Tiles (grid of circles covering the city)
    ↓
STEP 3: Preview Cost (estimate Google API spend)
    ↓
STEP 4: Execute Seeding (for each tile × each category → Google Nearby Search)
    ↓
STEP 5: Post-Fetch Filtering (reject closed, no-photo, excluded-type places)
    ↓
STEP 6: Deduplicate by google_place_id
    ↓
STEP 7: Upsert to place_pool (insert new, update existing with fresh Google data)
    ↓
STEP 8: Record seeding_operation result per category
    ↓
STEP 9: Update city status (draft → seeding → seeded)
    ↓
STEP 10: Coverage Check (count places per category, flag gaps < 10)
```

---

## 3. Detailed Breakdown

### 3.1 City Registration

**Where:** `PlacePoolManagementPage.jsx` → `AddCityModal` (line 165)
**Table:** `seeding_cities`
**Schema:**
- `google_place_id` — unique identifier from Google
- `name`, `country`, `country_code`
- `center_lat`, `center_lng` — geographic center
- `coverage_radius_km` — how far to seed (default 10km)
- `tile_radius_m` — radius of each search circle (default 1500m)
- `status` — lifecycle: `draft` → `seeding` → `seeded` → `launched`

**What happens on save:**
1. Insert row into `seeding_cities`
2. Immediately call `admin-seed-places` with `action: "generate_tiles"` to auto-create the tile grid

### 3.2 Tile Grid Generation

**Where:** `admin-seed-places/index.ts` → `generateTileGrid()` (line 85)
**Table:** `seeding_tiles`

**Algorithm:**
1. Take city center + coverage_radius_km + tile_radius_m
2. Spacing = tile_radius × 1.4 (ensures overlap for complete coverage)
3. Convert meters to degrees (approximate: 111,320 m/degree lat, adjusted for longitude)
4. Create a bounding box: center ± coverage_radius
5. Iterate lat/lng grid at `spacing` intervals
6. **Filter:** only keep tiles whose center is within the coverage circle (Euclidean distance check)
7. Each tile gets: `tile_index`, `center_lat`, `center_lng`, `radius_m`, `row_idx`, `col_idx`

**Example:** A 10km radius city with 1500m tiles generates roughly 30-50 tiles (depends on city shape).

**Tile regeneration:** Calling `generate_tiles` again DELETEs all existing tiles for that city and recreates them (line 297).

### 3.3 The 13 Seeding Categories

**Source of truth:** `supabase/functions/_shared/seedingCategories.ts`

| # | ID | Label | Key Google Types |
|---|----|-------|-----------------|
| 1 | `nature_views` | Nature & Views | beach, park, hiking_area, botanical_garden, scenic_spot |
| 2 | `first_meet` | First Meet | cafe, coffee_shop, tea_house, bakery, book_store |
| 3 | `picnic_park` | Picnic Park | picnic_ground, park |
| 4 | `drink` | Drink | bar, cocktail_bar, pub, brewery, beer_garden |
| 5 | `casual_eats` | Casual Eats | restaurant, bistro, brunch_restaurant, pizza_restaurant |
| 6 | `fine_dining` | Fine Dining | fine_dining_restaurant, steak_house, seafood_restaurant |
| 7 | `watch` | Watch | movie_theater |
| 8 | `live_performance` | Live Performance | performing_arts_theater, concert_hall, opera_house |
| 9 | `creative_arts` | Creative & Arts | art_gallery, museum, cultural_center |
| 10 | `play` | Play | bowling_alley, amusement_center, video_arcade, karaoke |
| 11 | `wellness` | Wellness | spa, massage_spa, sauna, yoga_studio |
| 12 | `flowers` | Flowers | florist |
| 13 | `groceries` | Groceries (HIDDEN) | grocery_store, supermarket |

Each category defines:
- `includedTypes` — what Google types to search for
- `excludedPrimaryTypes` — what to reject even if Google returns them

### 3.4 Category Seeding Order

**Fact:** The admin UI (`PlacePoolManagementPage.jsx`, line 368) seeds categories **one at a time, sequentially**, in the order they appear in `selectedCats` (a `Set`, which preserves insertion order = the `ALL_CATEGORIES` array order).

```javascript
for (let i = 0; i < cats.length; i++) {
  const catId = cats[i];
  // calls admin-seed-places with action: "seed", categories: [catId]
}
```

**Inside the edge function** (`handleSeed`, line 724): categories are processed in batches of `MAX_CONCURRENT_CATEGORIES = 4`. But since the admin UI sends one category at a time, this batching only kicks in if someone calls the edge function directly with multiple categories.

**Default order (when "all" selected):**
1. nature_views → 2. first_meet → 3. picnic_park → 4. drink → 5. casual_eats → 6. fine_dining → 7. watch → 8. live_performance → 9. creative_arts → 10. play → 11. wellness → 12. flowers → 13. groceries

### 3.5 What Happens Per Category Per Tile

For each tile in the city:
1. **Google Nearby Search** API call with:
   - `includedTypes` from the category config
   - `excludedPrimaryTypes` from the category config
   - `maxResultCount: 20`
   - `rankPreference: "POPULARITY"`
   - Location circle: tile center + tile radius
   - Field mask: id, name, address, location, types, primaryType, rating, reviews, price, hours, photos, website, businessStatus

2. **Post-fetch filtering** (`applyPostFetchFilters`, line 205):
   - Reject permanently closed businesses
   - Reject places with no photos
   - Reject places whose ANY type (not just primaryType) matches the excluded types set (global + category-specific)

3. **Rate limiting:** 100ms delay between tiles (`TILE_DELAY_MS`)

4. **Error resilience:** If a tile fails (API error, timeout, parse error), it's logged but seeding continues to the next tile

### 3.6 Deduplication & Upsert

After all tiles for a category are processed:

1. **Client-side dedup:** Places are deduplicated by `google_place_id` using a Map (line 538)

2. **Two-step upsert** (line 558-629):
   - **Step 1:** `upsert` with `ignoreDuplicates: true` — only inserts genuinely new places
   - **Step 2:** For existing places, selectively updates only Google-sourced fields (name, address, lat/lng, types, rating, reviews, price_level, hours, photos, website, raw_google_data). **Preserves** admin-edited fields: price_tier, price_min, price_max, is_active, stored_photo_urls, city_id, seeding_category, city, country.
   - Batched in groups of 10 to reduce N+1 overhead

### 3.7 Data Transform: Google → place_pool

`transformGooglePlaceForSeed()` (line 143) maps:

| Google Field | place_pool Column | Notes |
|-------------|------------------|-------|
| `id` | `google_place_id` | |
| `displayName.text` | `name` | |
| `formattedAddress` | `address` | |
| `location.latitude/longitude` | `lat`, `lng` | |
| `types` | `types` (JSONB array) | |
| `primaryType` | `primary_type` | |
| `rating` | `rating` | |
| `userRatingCount` | `review_count` | |
| `priceLevel` | `price_level`, `price_tier`, `price_min`, `price_max` | Mapped via PRICE_LEVEL_MAP |
| `regularOpeningHours` | `opening_hours` (JSONB) | |
| `photos` | `photos` (JSONB array of {name, widthPx, heightPx}) | |
| `websiteUri` | `website` | |
| Full response | `raw_google_data` (JSONB) | |
| — | `fetched_via: "nearby_search"` | |
| — | `is_active: true` | |
| — | `city_id`, `seeding_category`, `country`, `city` | From seeding context |

**Price tier mapping:**
- FREE → chill ($0)
- INEXPENSIVE → chill ($5-15)
- MODERATE → comfy ($15-40)
- EXPENSIVE → bougie ($40-100)
- VERY_EXPENSIVE → lavish ($100-500)

### 3.8 Operation Tracking

**Table:** `seeding_operations`

Every seed run creates one operation row per category with:
- Status lifecycle: `pending` → `running` → `completed`/`failed`
- Metrics: api_calls, places_returned, places_rejected (by reason), new_inserted, duplicate_skipped
- Cost tracking: `estimated_cost_usd`
- Error details: JSONB with per-tile error breakdown

### 3.9 Cost Controls

- **Per Nearby Search call:** $0.032
- **Per photo fetch:** $0.007
- **Hard cap:** $70 USD per seed operation
- **Estimate formula:** `(tiles × categories × $0.032) + (tiles × 10 estimated places × 5 photos × $0.007)`
- Cap is enforced in the edge function (line 698) — throws error unless `acknowledgeHardCap: true`

---

## 4. Alternative Import Flows

### 4.1 PlacePoolBuilderPage (Manual Search & Import)

**Where:** `mingla-admin/src/pages/PlacePoolBuilderPage.jsx`
**Edge function:** `admin-place-search`

Flow: Admin types a text query (e.g., "Italian restaurants in Miami") → calls Google Text Search → displays results on map/table → admin selects places → pushes selected places to `place_pool`.

Key difference from tile seeding: **human curation** — admin hand-picks which places enter the pool.

### 4.2 CityLauncherPage (5-Step Wizard)

**Where:** `mingla-admin/src/pages/CityLauncherPage.jsx`

5 steps:
1. **Define Area** — city name, lat/lng, radius, select Google place categories
2. **Search & Select** — searches one category at a time via `admin-place-search`, auto-selects non-duplicates
3. **Import** — pushes selected places to pool
4. **Review** — shows imported places
5. **Launch** — marks city as launched

**NOTE:** This page uses a DIFFERENT category system (line 17) — raw Google types (`restaurant`, `bar`, `cafe`, `park`, etc.) rather than Mingla's 13 seeding categories. This is an older/alternative flow that predates the tile-based system.

### 4.3 SeedPage (Admin Scripts)

**Where:** `mingla-admin/src/pages/SeedPage.jsx`
**Purpose:** Maintenance scripts, NOT place seeding

4 RPC scripts:
1. `admin_seed_demo_profiles()` — insert 5 test users
2. `admin_clear_expired_caches()` — delete expired cache rows
3. `admin_reset_inactive_sessions()` — mark old sessions inactive
4. `admin_clear_demo_data()` — remove @mingla.app test users

---

## 5. Database Tables Involved

| Table | Purpose | Created By |
|-------|---------|------------|
| `seeding_cities` | Registered cities with center, radius, tile config | Admin UI |
| `seeding_tiles` | Grid of search circles for each city | `generate_tiles` action |
| `seeding_operations` | Per-category operation log with metrics | `seed` action |
| `place_pool` | Central venue repository (shared by all users) | Seeding + manual import |
| `card_pool` | Experience cards generated from place_pool | Card generation functions |
| `google_places_cache` | 24h TTL cache for Google API responses | Cache layer |

---

## 6. Observations & Potential Issues

### 6.1 Category System Divergence (FACT)
`CityLauncherPage` uses raw Google categories (`restaurant`, `bar`, `cafe`) while `PlacePoolManagementPage` uses Mingla's 13 seeding categories (`casual_eats`, `drink`, `first_meet`). These are two different classification systems.

**Inference:** CityLauncherPage appears to be an older flow that hasn't been updated to use the unified seeding category system. Places imported via CityLauncher won't have a `seeding_category` set.

### 6.2 Tile Regeneration Deletes All (FACT)
`handleGenerateTiles` (line 297) runs `DELETE FROM seeding_tiles WHERE city_id = ?` before inserting new tiles. This cascades to `seeding_operations.tile_id` (SET NULL) but operation history is preserved.

### 6.3 Coverage Gap Threshold (FACT)
A category is flagged as having a "gap" if it has fewer than 10 places (line 906: `hasGap: count < 10`). The admin UI offers a "Select Only Gaps" button that auto-selects only underserved categories for re-seeding.

### 6.4 No Pagination on Google Results (FACT)
Nearby Search is called with `maxResultCount: 20`. Google's maximum is 20 per call. There's no `nextPageToken` handling, so each tile returns at most 20 places per category.

**Inference:** Dense urban areas might have >20 relevant places per tile. The 1.4× overlap between tiles partially compensates for this, but some places in very dense areas could be missed.

### 6.5 Selective Update Preserves Admin Edits (FACT)
Re-seeding an existing place only updates Google-sourced fields (line 593-612). Admin-edited fields (`price_tier`, `is_active`, `stored_photo_urls`) are preserved. This is a deliberate design choice documented in comments.

---

## 7. Visual Flow Diagram

```
                    ┌──────────────┐
                    │  Admin Panel │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌────────────┐ ┌────────────┐ ┌────────────┐
     │ Pool Mgmt  │ │Pool Builder│ │City Launcher│
     │ (Tile-based│ │  (Manual   │ │  (5-step   │
     │  seeding)  │ │  search)   │ │  wizard)   │
     └─────┬──────┘ └─────┬──────┘ └─────┬──────┘
           │              │              │
           ▼              ▼              ▼
    ┌──────────────┐ ┌──────────────┐
    │admin-seed-   │ │admin-place-  │
    │places (EF)   │ │search (EF)   │
    └──────┬───────┘ └──────┬───────┘
           │                │
           ▼                ▼
    ┌───────────────────────────┐
    │   Google Places API       │
    │   (Nearby Search /        │
    │    Text Search)           │
    └───────────┬───────────────┘
                │
                ▼
    ┌───────────────────────────┐
    │   Post-Fetch Filters      │
    │   - No photos → reject    │
    │   - Closed → reject       │
    │   - Excluded type → reject│
    └───────────┬───────────────┘
                │
                ▼
    ┌───────────────────────────┐
    │   Dedup by google_place_id│
    └───────────┬───────────────┘
                │
                ▼
    ┌───────────────────────────┐
    │      place_pool           │
    │  (central venue table)    │
    └───────────┬───────────────┘
                │
                ▼
    ┌───────────────────────────┐
    │  Card Generation          │
    │  (generate-single-cards,  │
    │   generate-curated-       │
    │   experiences)            │
    └───────────┬───────────────┘
                │
                ▼
    ┌───────────────────────────┐
    │       card_pool           │
    │  (user-facing cards)      │
    └───────────────────────────┘
```

---

## 8. File Reference Index

| File | Purpose | Lines Read |
|------|---------|------------|
| `supabase/functions/_shared/seedingCategories.ts` | 13 category configs (SoT) | All 260 |
| `supabase/functions/admin-seed-places/index.ts` | Core seeding edge function (4 actions) | All 971 |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | Google type mappings + exclusions | Referenced |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | Tile-based seeding UI | 0-448 |
| `mingla-admin/src/pages/PlacePoolBuilderPage.jsx` | Manual search & import UI | 0-150 |
| `mingla-admin/src/pages/CityLauncherPage.jsx` | 5-step city launch wizard | 0-150 |
| `mingla-admin/src/pages/SeedPage.jsx` | Admin maintenance scripts | Referenced |
| `supabase/migrations/20260320200000_admin_pool_management.sql` | Schema: seeding_cities, tiles, operations | All 269 |
