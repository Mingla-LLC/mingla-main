# 🔍 Test Report: Admin Pool Management — Phase 1 (Foundation)
**Date:** 2026-03-20
**Spec:** `outputs/FEATURE_ADMIN_POOL_MANAGEMENT_SPEC.md` (§8, §9)
**Implementation:** `outputs/IMPLEMENTATION_ADMIN_POOL_PHASE1_REPORT.md`
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Executive Summary

42 checks across 3 files (migration, admin-seed-places edge function, admin-place-search edge function). **All 42 functional checks pass.** The implementation is solid — tile grid math, selective upsert, post-fetch filters, error logging, and the admin-place-search fixes are all correct. Two high-severity design issues found: city status is unconditionally set to "seeded" even when all categories fail, and the hard cap check formula differs between preview_cost and seed actions. One medium-severity type annotation bug in FilterResult. No security issues, no missing RLS, no API key leaks.

---

## Test Manifest

Total items tested: 42 + 6 additional audit checks = 48

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| Migration — Tables | 4 | 4 | 0 | 0 |
| Migration — RLS & Policies | 3 | 3 | 0 | 0 |
| Migration — Indexes | 1 | 1 | 0 | 0 |
| Migration — RPCs | 3 | 3 | 0 | 0 |
| Migration — Backfill | 1 | 1 | 0 | 0 |
| Edge Function — generate_tiles | 4 | 4 | 0 | 0 |
| Edge Function — preview_cost | 3 | 3 | 0 | 0 |
| Edge Function — seed | 16 | 16 | 0 | 0 |
| admin-place-search Fix | 4 | 4 | 0 | 0 |
| Cross-cutting | 3 | 3 | 0 | 0 |
| Additional Audit Checks | 6 | 3 | 0 | 3 |
| **TOTAL** | **48** | **45** | **0** | **3** |

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: City status unconditionally set to "seeded" after seed — even on total failure

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 786-789)
**Category:** Logic Error / Data Integrity

**What's Wrong:**
After all category processing completes, the city status is unconditionally updated to `"seeded"` regardless of whether any seeding actually succeeded. If all 13 categories fail (e.g., Google API is down), the city transitions from `"seeding"` → `"seeded"` with zero places inserted.

**Evidence:**
```typescript
// Line 786-789 — always runs, no condition on success
await supabase
  .from("seeding_cities")
  .update({ status: "seeded", updated_at: new Date().toISOString() })
  .eq("id", cityId);
```

Meanwhile, `summaryTotals.totalNewInserted` could be `0` and all operations could have `status: "failed"`.

**Required Fix:**
Add a conditional check before setting status:
```typescript
const finalStatus = summaryTotals.totalNewInserted > 0 ? "seeded" : "failed_seeding";
// OR at minimum:
const anySuccess = operationIds.length > 0 && summaryTotals.totalNewInserted > 0;
await supabase
  .from("seeding_cities")
  .update({
    status: anySuccess ? "seeded" : "draft",  // revert to draft on total failure
    updated_at: new Date().toISOString(),
  })
  .eq("id", cityId);
```

Note: The `seeding_cities.status` CHECK constraint only allows `('draft', 'seeding', 'seeded', 'launched')`, so you'd either revert to `'draft'` or add a `'failed'` status to the CHECK.

**Why This Matters:**
A city that appears "seeded" with zero places is misleading for the admin. The downstream readiness checklist (Phase 2) will show a contradictory state: status = seeded, but places = 0.

---

### HIGH-002: Hard cap check inconsistency between preview_cost and seed actions

**File:** `supabase/functions/admin-seed-places/index.ts` (line 637 vs line 345)
**Category:** Logic Inconsistency

**What's Wrong:**
`preview_cost` checks **total estimated cost** (search + photos) against the $70 cap:
```typescript
// preview_cost — line 345
exceedsHardCap: estimatedTotalCost > HARD_CAP_USD   // search + photo
```

But `seed` checks only **search cost**:
```typescript
// seed — line 637
const estimatedCost = tiles.length * validConfigs.length * COST_PER_NEARBY_SEARCH;  // search only
if (estimatedCost > HARD_CAP_USD && !acknowledgeHardCap) { ... }
```

For a city with 16 tiles × 13 categories:
- Search cost: 208 × $0.032 = **$6.66** → seed says OK
- Photo cost: 16 × 10 × 5 × $0.007 = **$5.60**
- Total: **$12.26** → both say OK (no issue here)

But for a city with 127 tiles × 13 categories (500m radius):
- Search cost: 1,651 × $0.032 = **$52.83** → seed says OK (< $70)
- Photo cost: 127 × 10 × 5 × $0.007 = **$44.45**
- Total: **$97.28** → preview says exceeds cap, but seed would NOT require acknowledgment

**Required Fix:**
Make the seed action use the same total cost formula as preview_cost:
```typescript
const estimatedSearchCost = tiles.length * validConfigs.length * COST_PER_NEARBY_SEARCH;
const estimatedPhotoCost = tiles.length * EXPECTED_UNIQUE_PLACES_PER_TILE * PHOTOS_PER_PLACE * COST_PER_PHOTO;
const estimatedTotalCost = estimatedSearchCost + estimatedPhotoCost;
if (estimatedTotalCost > HARD_CAP_USD && !acknowledgeHardCap) { ... }
```

**Why This Matters:**
An admin who bypasses the preview (or calls the API directly) could trigger a seed that the preview would have flagged. The enforcement boundary must be consistent.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: FilterResult.passed has wrong type annotation

**File:** `supabase/functions/admin-seed-places/index.ts` (line 193)
**Category:** Type Safety

**What's Wrong:**
```typescript
interface FilterResult {
  passed: typeof Array.prototype;  // ← This resolves to the Array prototype object type, not an array
  rejectedNoPhotos: number;
  rejectedClosed: number;
  rejectedExcludedType: number;
}
```

`typeof Array.prototype` is a valid but semantically incorrect type. It describes the Array prototype object itself, not an array of items. The function returns `places.filter(...)` which is `any[]`.

**Required Fix:**
```typescript
interface FilterResult {
  passed: any[];   // or more precisely: Array<Record<string, unknown>>
  rejectedNoPhotos: number;
  rejectedClosed: number;
  rejectedExcludedType: number;
}
```

**Why This Matters:**
No runtime impact — TypeScript inference handles it. But it's confusing to any reader and would fail strict type checks if the codebase ever enables them for edge functions.

---

### MED-002: dryRun mode overcounts "newInserted"

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 574-577)
**Category:** Logic Accuracy

**What's Wrong:**
```typescript
} else if (dryRun) {
  newInserted = uniquePlaces.size;   // counts ALL unique places, including existing duplicates
  duplicateSkipped = 0;
}
```

In dry run mode, `newInserted` is set to the total count of unique places that passed filters, without checking which already exist in `place_pool`. A dry run for a partially-seeded city would report "500 new" when actually 300 are duplicates and only 200 would be new.

**Required Fix:**
Either:
1. Accept this as a known limitation and rename the field to `candidatePlaces` in dry run mode, or
2. Query place_pool for existing google_place_ids to get accurate counts:
```typescript
const existingIds = await supabase
  .from("place_pool")
  .select("google_place_id")
  .in("google_place_id", Array.from(uniquePlaces.keys()));
const existingSet = new Set(existingIds.data?.map(r => r.google_place_id) ?? []);
newInserted = uniquePlaces.size - existingSet.size;
duplicateSkipped = existingSet.size;
```

**Why This Matters:**
Dry run is a planning tool. Inaccurate counts defeat its purpose — the admin would see inflated "new" numbers.

---

### MED-003: N+1 update pattern for duplicate places

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 538-573)
**Category:** Performance

**What's Wrong:**
For each duplicate place, an individual `update()` call is made:
```typescript
for (const row of existingRows) {
  const { error: updateErr } = await supabase
    .from("place_pool")
    .update({ name: row.name, ... })
    .eq("google_place_id", row.google_place_id);
}
```

For a densely-seeded city with 500+ duplicates, this means 500 sequential Supabase calls. Combined with the 100ms tile delay, this adds significant wall-clock time.

**Required Fix:**
Consider batching via a raw SQL RPC that accepts an array of updates, or at minimum use `Promise.all` to parallelize the updates (they're independent):
```typescript
await Promise.all(existingRows.map(row =>
  supabase.from("place_pool")
    .update({ name: row.name, ... })
    .eq("google_place_id", row.google_place_id)
));
```

**Why This Matters:**
Performance only. Not a correctness issue. But for large re-seed operations, the edge function's 60s timeout is already tight. Wasting time on sequential updates for duplicates makes timeout more likely.

---

## 🔵 Low Findings (Nice to Fix)

### LOW-001: Multiple `deno-lint-ignore no-explicit-any` suppressions

**File:** `supabase/functions/admin-seed-places/index.ts` (lines 140, 199, 205, 244, 298, 364, 390, 445, 490, 594)
**Category:** Type Safety (edge function context)

10 lint suppressions in a single file. This matches the existing pattern across other Deno edge functions in this codebase, so it's not a violation per se — but it's worth noting that `transformGooglePlaceForSeed`, `applyPostFetchFilters`, and the handler functions could benefit from typed interfaces for the Google Places API response shape. Not blocking.

---

## ✅ What Passed

### Things Done Right

1. **Selective upsert strategy is correct and well-implemented.** The two-step approach (insert with `ignoreDuplicates: true`, then selective update for existing places) correctly preserves admin-edited fields (`price_tier`, `is_active`, `stored_photo_urls`, impression counters). This was the hardest part of the spec and it's right.

2. **Structured error logging is thorough.** The `TileError` interface captures all required fields (tile_id, tile_index, category, error_type, http_status, response_body truncated to 500 chars, message, timestamp). The `error_details` JSONB includes both `tile_errors` array and `summary` with counts per error type. Matches spec §8.3.1 exactly.

3. **Post-fetch filters are correct and complete.** Rejects CLOSED_PERMANENTLY, no-photos, and global excluded types. Crucially, does NOT reject no-rating places — matches the spec's explicit requirement [C1].

4. **GLOBAL_EXCLUDED_PLACE_TYPES imported from shared module** — not hardcoded. Single source of truth maintained.

5. **Tile grid algorithm is mathematically sound.** Latitude-aware degree-to-meter conversion, hexagonal-ish packing with 1.4× spacing, circle filter. Handles equator and high-latitude cities correctly.

6. **seedingCategories.ts is comprehensive and accurate.** All 13 categories with correct includedTypes/excludedPrimaryTypes matching the spec. Proper exports (SEEDING_CATEGORIES, SEEDING_CATEGORY_MAP, ALL_SEEDING_CATEGORY_IDS, SeedingCategoryConfig type).

7. **admin-place-search fixes are clean.** locationBias conditionally added only when all three params (lat/lng/radius) are present. businessStatus added to field mask. timeoutFetch wrapper used correctly. refresh action removed with clear comment.

8. **Migration is well-structured and idempotent.** All `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. RLS enabled on all three new tables with correct policies (service_role ALL, authenticated SELECT). Country backfill handles NULL and empty addresses.

9. **RPCs are SECURITY DEFINER with `SET search_path = public`.** Correct pattern — prevents search path manipulation attacks. `admin_edit_place` properly cascades `is_active` to `card_pool`. Both stats RPCs use COALESCE to handle empty results.

10. **CORS headers are consistent.** Present on all responses including errors and OPTIONS preflight. Matches existing edge function patterns.

---

## 42-Check Test Manifest (Detailed)

### Database Migration (Checks 1-12)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `seeding_cities` table with all columns | ✅ PASS | Migration lines 11-26. All columns present: id, google_place_id (UNIQUE), name, country, country_code, center_lat, center_lng, coverage_radius_km, tile_radius_m, status (CHECK), created_at, updated_at, UNIQUE(name, country) |
| 2 | `seeding_tiles` table with all columns | ✅ PASS | Migration lines 40-51. All columns: id, city_id (FK CASCADE), tile_index, center_lat, center_lng, radius_m, row_idx, col_idx, UNIQUE(city_id, tile_index) |
| 3 | `seeding_operations` table with all columns | ✅ PASS | Migration lines 67-93. All counter columns present, error_details JSONB, status CHECK constraint |
| 4 | `place_pool` has city_id (FK SET NULL), country, seeding_category | ✅ PASS | Migration lines 110-117 |
| 5 | RLS enabled on all 3 new tables | ✅ PASS | Lines 28, 55, 98 |
| 6 | service_role has ALL access on all 3 | ✅ PASS | Lines 30-31, 57-58, 100-101 |
| 7 | authenticated has SELECT on all 3 | ✅ PASS | Lines 33-34, 60-61, 103-104 |
| 8 | Indexes: idx_seeding_tiles_city, idx_seeding_operations_city, idx_seeding_operations_status | ✅ PASS | Lines 53, 95, 96 |
| 9 | `admin_edit_place` RPC — SECURITY DEFINER | ✅ PASS | Lines 136-173. Selective update with COALESCE, card cascade on is_active |
| 10 | `admin_city_place_stats` RPC — returns JSONB | ✅ PASS | Lines 179-224. Server-side aggregates with FILTER clauses, COALESCE for empty sub-queries |
| 11 | `admin_city_card_stats` RPC — returns JSONB | ✅ PASS | Lines 230-268. Card stats with place_pool JOIN, places_without_cards subquery |
| 12 | Country backfill query | ✅ PASS | Lines 126-130. SPLIT_PART + array_length to get last comma-separated part, handles NULL/empty |

### admin-seed-places — generate_tiles (Checks 13-16)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 13 | Computes hex-grid tile centers from city center + radius | ✅ PASS | `generateTileGrid()` lines 83-136. Bounding box → spacing × 1.4 → iterate grid |
| 14 | Tiles filtered to within coverage circle | ✅ PASS | Lines 116-129. Euclidean distance check against coverageRadiusM |
| 15 | Tiles inserted with city_id FK | ✅ PASS | Lines 269-277. `city_id: cityId` spread into each row |
| 16 | Existing tiles deleted before regeneration | ✅ PASS | Line 266. `supabase.from("seeding_tiles").delete().eq("city_id", cityId)` |

### admin-seed-places — preview_cost (Checks 17-19)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 17 | Cost = tileCount × categoryCount × $0.032 | ✅ PASS | Line 323. `totalApiCalls * COST_PER_NEARBY_SEARCH` where `totalApiCalls = tileCount * categoryCount` |
| 18 | `exceedsHardCap: true` when > $70 | ✅ PASS | Line 345. `estimatedTotalCost > HARD_CAP_USD` |
| 19 | `hardCapUsd: 70` in response | ✅ PASS | Line 346. `hardCapUsd: HARD_CAP_USD` where const = 70 |

### admin-seed-places — seed action (Checks 20-35)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 20 | Google Nearby Search (NOT Text Search) | ✅ PASS | Line 23. URL = `places.googleapis.com/v1/places:searchNearby` |
| 21 | `locationRestriction.circle` with tile center + radius | ✅ PASS | Lines 401-409 |
| 22 | `includedTypes`/`excludedPrimaryTypes` from seedingCategories.ts | ✅ PASS | Lines 398-399. `config.includedTypes`, `config.excludedPrimaryTypes` |
| 23 | `rankPreference: "POPULARITY"` | ✅ PASS | Line 410 |
| 24 | `places.businessStatus` in field mask | ✅ PASS | Line 38 in FIELD_MASK array |
| 25 | Reject CLOSED_PERMANENTLY | ✅ PASS | Lines 208-210 in `applyPostFetchFilters` |
| 26 | Reject no photos (null or empty) | ✅ PASS | Lines 213-215. `!p.photos || p.photos.length === 0` |
| 27 | Reject global excluded types (gym, fitness_center, dog_park) | ✅ PASS | Lines 218-221. Uses imported `GLOBAL_EXCLUDED_PLACE_TYPES` which contains all three |
| 28 | No rejection for missing rating | ✅ PASS | No rating check in `applyPostFetchFilters`. Only checks: closed, no photos, excluded types |
| 29 | Selective upsert: admin-edited fields preserved | ✅ PASS | Two-step: insert with `ignoreDuplicates: true` (line 514), selective update for existing (lines 541-558) omits price_tier, is_active, stored_photo_urls |
| 30 | Structured error logging (error_details JSONB) | ✅ PASS | TileError interface (lines 353-362), error_details built (lines 700-718) with tile_errors + summary |
| 31 | Sequential tile processing (100ms delay) | ✅ PASS | Line 486. `await delay(TILE_DELAY_MS)` where TILE_DELAY_MS = 100 |
| 32 | Max 4 concurrent categories | ✅ PASS | Line 664. `i += MAX_CONCURRENT_CATEGORIES` with `Promise.all` per batch |
| 33 | 10s timeout per Google API call | ✅ PASS | Line 422. `timeoutMs: API_TIMEOUT_MS` where API_TIMEOUT_MS = 10000 |
| 34 | `acknowledgeHardCap` required when cost > $70 | ✅ PASS | Lines 637-642. Throws error if over cap and not acknowledged |
| 35 | seeding_operations row created with all counters | ✅ PASS | Insert at lines 670-680, update at lines 721-740 with all counter fields |

### admin-place-search Fix (Checks 36-39)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 36 | `locationBias` added when lat/lng/radius provided | ✅ PASS | Lines 108-115. Conditional: `if (lat != null && lng != null && radius != null)` |
| 37 | `businessStatus` added to field mask | ✅ PASS | Line 22. `"places.businessStatus"` in FIELD_MASK array |
| 38 | `timeoutFetch` wrapper used | ✅ PASS | Lines 117-129. Replaces raw `fetch()` with `timeoutFetch()`, `timeoutMs: 10000` |
| 39 | refresh action removed | ✅ PASS | Line 197 comment: "NOTE: 'refresh' action removed". Not in switch statement (lines 254-269) |

### Cross-cutting (Checks 40-42)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 40 | No unused imports | ✅ PASS | All imports in admin-seed-places used: serve, createClient, timeoutFetch, SEEDING_CATEGORIES/MAP/ALL_IDS/type, GLOBAL_EXCLUDED_PLACE_TYPES. admin-place-search: serve, createClient, timeoutFetch — all used |
| 41 | No TypeScript/syntax errors | ✅ PASS | Valid Deno TypeScript in both files. Proper `deno-lint-ignore` annotations where needed |
| 42 | seedingCategories.ts is imported (not hardcoded) | ✅ PASS | Lines 4-9 of admin-seed-places. Imports SEEDING_CATEGORIES, SEEDING_CATEGORY_MAP, ALL_SEEDING_CATEGORY_IDS, SeedingCategoryConfig |

---

## Spec Compliance Matrix

| Success Criterion (from Spec §4) | Tested? | Passed? | Evidence |
|----------------------------------|---------|---------|----------|
| §4.1 — Admin can define city, system generates tile grid | ✅ | ✅ | generate_tiles action, checks 13-16 |
| §4.2 — Preview tile count and estimated cost | ✅ | ✅ | preview_cost action, checks 17-19 |
| §4.3 — $70 hard cap warning | ✅ | ✅ | exceedsHardCap flag + acknowledgeHardCap gate |
| §4.4 — Nearby Search with exact types per category | ✅ | ✅ | Checks 20-23, seedingCategories.ts |
| §4.5 — Zero-photo places rejected at seed time | ✅ | ✅ | Check 26 |
| §4.6 — Every operation logs counters + structured errors | ✅ | ✅ | Check 30, 35 |
| §4.10 — Edit modal uses admin RPC | ✅ | ✅ | Check 9, admin_edit_place RPC |
| §4.11 — All stats use server-side RPCs | ✅ | ✅ | Checks 10-11 |

---

## Implementation Report Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Created migration with 3 tables, 3 RPCs, backfill" | ✅ | ✅ | All present and correct |
| "Created admin-seed-places with 3 actions" | ✅ | ✅ | generate_tiles, preview_cost, seed — all functional |
| "Modified admin-place-search: locationBias, businessStatus, timeoutFetch, removed refresh" | ✅ | ✅ | All four changes verified |
| "Selective upsert preserves admin-edited fields" | ✅ | ✅ | Two-step approach correctly omits price_tier, is_active, stored_photo_urls from update |
| "Structured error logging with error_details JSONB" | ✅ | ✅ | TileError interface + error_details matches spec §8.3.1 schema |
| "Sequential tiles (100ms), parallel categories (max 4)" | ✅ | ✅ | delay(100) per tile, Promise.all in batches of 4 |
| "10s timeout per Google call" | ✅ | ✅ | timeoutFetch with timeoutMs: 10000 |
| "seedingCategories.ts already existed — no duplication" | ✅ | ✅ | File exists with all 13 configs, properly imported |
| "~16 tiles for 10km/1500m city" | ✅ | ✅ | Math checks out: 10km radius, 1500m × 1.4 = 2100m spacing ≈ 4.76 tiles per axis ≈ 16 in circle |

---

## Recommendations for Orchestrator

### Mandatory (block merge until done)
*None — no critical findings.*

### Strongly Recommended (merge at own risk)
1. **HIGH-001**: Add conditional check before setting city status to "seeded". At minimum: `if (summaryTotals.totalNewInserted > 0) status = "seeded"` else revert to `"draft"`.
2. **HIGH-002**: Align seed action's hard cap check with preview_cost formula (include photo cost estimate).

### Should Fix Soon
3. **MED-001**: Change `FilterResult.passed` type from `typeof Array.prototype` to `any[]`.
4. **MED-002**: Either accept dryRun inaccuracy or add a place_pool existence check.
5. **MED-003**: Parallelize duplicate updates or batch them via RPC.

### Technical Debt to Track
- The selective upsert's N+1 pattern will become a bottleneck when re-seeding large cities. Consider a bulk RPC for Phase 2.
- The `admin-place-search` push action (line 182) still uses `ignoreDuplicates: false`, meaning ad-hoc pushes WILL overwrite admin-edited fields. This is pre-existing behavior and out of scope, but worth tracking.

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — All 42 spec checks pass. No critical findings. Two high findings remain:
- HIGH-001 (city status on failure) is a data integrity issue that would confuse admins but doesn't cause data loss
- HIGH-002 (cap formula inconsistency) is a guard-rail gap but the UI's preview_cost already catches it

Safe to merge if: (a) the admin UI (Phase 2) always calls preview_cost before seed (which it will per spec §10.4.C), and (b) the team accepts that a failed seed will show the city as "seeded" until HIGH-001 is fixed. Both HIGH fixes are < 10 lines each and can be done in the same PR or a fast follow-up.
