# Implementation Report: Admin Pool Management — Phase 1 (Foundation)

**Date:** 2026-03-20
**Spec:** `outputs/FEATURE_ADMIN_POOL_MANAGEMENT_SPEC.md`
**Prompt:** `outputs/IMPLEMENTOR_PROMPT_ADMIN_POOL_PHASE1.md`
**Status:** Complete — ready for testing

---

## 1. What Was There Before

- **place_pool**: No `city_id`, `country`, or `seeding_category` columns. Places had no city affiliation.
- **admin-place-search**: Used raw `fetch()` (no timeout), no `locationBias` support, no `businessStatus` in field mask. Had a `refresh` action duplicating `admin-refresh-places`.
- **query_pool_cards**: Already had `dog_park` in `v_excluded_types` (migration `20260320000001`).
- **seedingCategories.ts**: Already existed with all 13 configs — no changes needed.
- **No seeding infrastructure**: No `seeding_cities`, `seeding_tiles`, or `seeding_operations` tables. No tile grid system. No structured seeding workflow.

---

## 2. What Changed

### New Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260320200000_admin_pool_management.sql` | 3 new tables, 3 new columns on place_pool, 3 RPCs, country backfill, indexes |
| `supabase/functions/admin-seed-places/index.ts` | New edge function: generate_tiles, preview_cost, seed actions |

### Modified Files

| File | Changes |
|------|---------|
| `supabase/functions/admin-place-search/index.ts` | Added `businessStatus` to field mask, `locationBias` support, `timeoutFetch`, removed `refresh` action + dead code |

### Database Changes

**New tables (with RLS + indexes):**
- `seeding_cities` — city definitions with google_place_id, center, radius, status
- `seeding_tiles` — tile grid per city (city_id FK CASCADE)
- `seeding_operations` — per-category operation logs with `error_details` JSONB

**place_pool alterations:**
- `city_id UUID` — FK to seeding_cities (SET NULL on delete)
- `country TEXT` — parsed from address, backfilled for existing rows
- `seeding_category TEXT` — which of the 13 categories found this place

**New RPCs (all SECURITY DEFINER):**
- `admin_edit_place(p_place_id, p_name, p_price_tier, p_is_active)` — selective update, cascades is_active to card_pool
- `admin_city_place_stats(p_city_id)` — server-side aggregates: totals, photo coverage, staleness, by-category, price distribution
- `admin_city_card_stats(p_city_id)` — card totals by type/category, places-without-cards count

---

## 3. Spec Compliance

| Spec Section | Requirement | Status |
|-------------|-------------|--------|
| §8.1 | seeding_cities table with google_place_id UNIQUE | ✅ |
| §8.2 | seeding_tiles with city_id FK CASCADE, tile_index unique per city | ✅ |
| §8.3 | seeding_operations with error_details JSONB (§8.3.1 schema) | ✅ |
| §8.4 | place_pool: city_id, country, seeding_category columns + indexes | ✅ |
| §8.5 | admin_edit_place RPC with card cascade | ✅ |
| §8.6 | admin_city_place_stats + admin_city_card_stats RPCs | ✅ |
| §6.2 | Tile grid algorithm: bounding box → spacing × 1.4 → circle filter | ✅ |
| §7.4 | Nearby Search with includedTypes/excludedPrimaryTypes per category | ✅ |
| §7.5 | Post-fetch filters: closed, no photos, global excluded types | ✅ |
| §7.5 | No-rating places ALLOWED | ✅ (no rating rejection) |
| §9.1 | generate_tiles action | ✅ |
| §9.1 | preview_cost with $70 hard cap (exceedsHardCap flag) | ✅ |
| §9.1 | seed action with selective upsert, structured error logging | ✅ |
| §9.1 | Sequential tiles within category (100ms delay), parallel categories (max 4) | ✅ |
| §9.1 | timeoutFetch 10s per Google call | ✅ |
| §9.2 | admin-place-search: locationBias, businessStatus, timeoutFetch | ✅ |
| §9.2 | Remove refresh action from admin-place-search | ✅ |
| §15 | query_pool_cards dog_park exclusion | ✅ (already done in prior migration) |

---

## 4. Implementation Details

### Tile Grid Algorithm
- Converts coverage_radius_km to bounding box using latitude-aware meter-to-degree conversion
- Spacing = tile_radius_m × 1.4 (hexagonal-ish packing with slight overlap)
- Filters out tiles whose center exceeds coverage circle distance
- Deletes existing tiles on regeneration (safe: CASCADE preserves ops referencing tile_id via SET NULL)

### Selective Upsert Strategy
The spec requires preserving admin-edited fields (`price_tier`, `is_active`, `stored_photo_urls`). Supabase JS `upsert()` overwrites all columns, so the implementation uses a two-step approach:
1. **Insert with `ignoreDuplicates: true`** — captures genuinely new places
2. **For duplicates** — selective `update()` that only overwrites Google-sourced fields (name, address, lat, lng, types, rating, photos, etc.), leaving `price_tier`, `is_active`, `stored_photo_urls`, and impression counters untouched

### Error Logging
Every tile-level failure captures:
- `tile_id`, `tile_index`, `category`
- `error_type`: google_api | timeout | parse | upsert | unknown
- `http_status` and `response_body` (truncated to 500 chars) for Google errors
- ISO 8601 timestamp
- Summary counts by error type

### Cost Model
- Search: tiles × categories × $0.032
- Photos (estimate): tiles × 10 unique places × 5 photos × $0.007
- Hard cap check on preview_cost response + seed action requires `acknowledgeHardCap` if over $70

---

## 5. Deviations from Spec

1. **`seedingCategoryConfigs.ts` not created** — the file already exists as `seedingCategories.ts` with identical content. No duplication needed.
2. **`query_pool_cards` dog_park update not included in this migration** — already done in `20260320000001_add_dog_park_exclusion.sql`.
3. **Selective upsert uses two-step JS approach** instead of raw SQL — achieves same result (admin-edited fields preserved) with existing Supabase client patterns.

---

## 6. Files Inventory

| File | Action | Lines |
|------|--------|-------|
| `supabase/migrations/20260320200000_admin_pool_management.sql` | Created | ~200 |
| `supabase/functions/admin-seed-places/index.ts` | Created | ~530 |
| `supabase/functions/admin-place-search/index.ts` | Modified | ~260 (was 331) |

---

## 7. Verification Checklist

| # | Check | Expected |
|---|-------|----------|
| 1 | Tiles generate for test city (10km, 1500m) | ~16 tiles |
| 2 | preview_cost returns accurate estimates | tiles × cats × $0.032 |
| 3 | preview_cost flags $70 cap | exceedsHardCap: true when over |
| 4 | seed uses Nearby Search (not Text Search) | locationRestriction.circle in request |
| 5 | No-photo places rejected | Not in place_pool |
| 6 | Closed businesses rejected | Not in place_pool |
| 7 | dog_park/gym/fitness_center rejected | Global excluded types filtered |
| 8 | No-rating places ACCEPTED | In place_pool with rating: null |
| 9 | Selective upsert preserves admin edits | price_tier unchanged on re-seed |
| 10 | Error logging captures tile failures | error_details JSONB populated |
| 11 | admin-place-search locationBias works | Request includes locationBias when lat/lng/radius provided |
| 12 | admin-place-search includes businessStatus | Field mask updated |

---

## 8. Handoff to Tester

All Phase 1 foundation work is complete: database schema, RPCs, the `admin-seed-places` edge function with all 3 actions, and `admin-place-search` fixes. No UI in this phase — that's Phase 2.

**Break it.** Key areas to stress-test:
- Tile grid math with different radii and city centers (equator, high latitude, negative coords)
- Upsert behavior: seed same tile twice, verify admin edits survive
- Error handling: what happens when Google returns 429, timeout, malformed JSON
- Cost cap enforcement: preview should flag, seed should reject without acknowledgment
- RLS: authenticated users can read but not write seeding tables
