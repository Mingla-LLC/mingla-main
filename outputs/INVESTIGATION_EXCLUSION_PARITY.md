# Forensic Investigation: Exclusion Parity Across 3 Edge Functions

**Date:** 2026-03-24
**Scope:** `discover-cards`, `discover-experiences`, `generate-curated-experiences`

---

## Executive Summary

There are **5 exclusion mechanisms** in the system. The three edge functions use **completely different exclusion strategies**, with `discover-cards` having the weakest protection (it delegates everything to SQL and a thin JS safety net that only checks `GLOBAL_EXCLUDED_PLACE_TYPES`). `discover-experiences` has the most complete JS-level exclusion. `generate-curated-experiences` has strong exclusion at the `queryPlacePool()` level but never touches the `card_pool` table.

---

## Side-by-Side Exclusion Comparison

| Exclusion Mechanism | `discover-cards` | `discover-experiences` | `generate-curated-experiences` |
|---|---|---|---|
| **1. `category_type_exclusions` table** | YES (SQL only, via `query_pool_cards` RPC) | YES (JS, lines 349-376) | YES (JS, lines 35-46, called in `queryPlacePool` line 381) |
| **2. `GLOBAL_EXCLUDED_PLACE_TYPES`** | YES (SQL via `v_excluded_types` hardcoded subset) + JS safety net in `cardPoolService.ts:852-866` | YES (JS, line 363) | YES (JS, line 27 + line 387) |
| **3. `isChildVenueName()` keyword filter** | NO | YES (JS, line 367) | YES (JS, line 390) |
| **4. `CATEGORY_EXCLUDED_PLACE_TYPES` (per-category in-code lists)** | NO | NO | NO (uses DB-driven `category_type_exclusions` instead) |
| **5. `HIDDEN_CATEGORIES` filter** | YES (JS, line 313) | YES (JS, lines 131, 139) | N/A (generates, doesn't filter by user categories) |
| **6. `query_pool_cards` RPC** | YES (via `cardPoolService.ts:165`) | NO (direct `.from('card_pool')` queries) | NO (queries `place_pool` directly) |

---

## Detailed Findings Per Function

### 1. `discover-cards/index.ts` (550 lines)

**Data source:** `card_pool` table via `serveCardsFromPipeline()` -> `query_pool_cards` RPC

**Exclusion pipeline:**
1. **Line 312-313:** `resolveCategories()` + `HIDDEN_CATEGORIES` filter (removes "Groceries" from requested categories)
2. **`cardPoolService.ts:165`:** Calls `query_pool_cards` SQL RPC which handles:
   - Global type exclusion via `v_excluded_types = ARRAY['gym', 'fitness_center', 'dog_park']` (migration line 43) -- **NOTE: only 3 of the 5 types in `GLOBAL_EXCLUDED_PLACE_TYPES`; missing `school`, `primary_school`, `secondary_school`, `university`, `preschool`**
   - Per-category exclusion via `category_type_exclusions` table (migration lines 139-156)
   - Hidden category suppression (migration line 158)
3. **`cardPoolService.ts:852-866`:** Post-SQL JS safety net checks `GLOBAL_EXCLUDED_PLACE_TYPES` (all 5+5 types) against `primary_type` and curated stop types

**What's MISSING:**
- **`isChildVenueName()` / keyword exclusion** -- NOT applied anywhere in this pipeline. A card titled "Kids Bounce House" with a valid place type would pass through.
- The SQL `v_excluded_types` array is **hardcoded to only 3 types** (`gym`, `fitness_center`, `dog_park`), missing the 5 school-related types that `GLOBAL_EXCLUDED_PLACE_TYPES` includes. The JS safety net in `cardPoolService.ts` does check the full list, but only against `primary_type` -- if a school has `primary_type = 'park'` but `types` includes `'school'`, it would pass the JS filter too.

---

### 2. `discover-experiences/index.ts` (700 lines)

**Data source:** `card_pool` table via direct `.from('card_pool')` queries (NOT via `query_pool_cards` RPC)

**Exclusion pipeline:**
1. **Lines 131, 139:** `HIDDEN_CATEGORIES` filter on `categoriesToFetch`
2. **Lines 327-346:** Per-category queries with `.eq('category', toSlug(cat))` -- natural category filtering
3. **Lines 349-380:** Post-fetch exclusion filter (THE MOST COMPLETE):
   - **Line 350-353:** Queries `category_type_exclusions` table for all requested categories
   - **Line 355-361:** Builds `exclusionMap` (category_slug -> Set of excluded_type)
   - **Line 363:** Creates `globalExcluded` set from `GLOBAL_EXCLUDED_PLACE_TYPES` (all types including schools)
   - **Line 367:** `isChildVenueName(card.title)` -- keyword filter on card title
   - **Lines 369-370:** Checks `card.types` array against `globalExcluded`
   - **Lines 372-373:** Checks `card.types` array against per-category exclusions from DB

**What's MISSING:**
- No `query_pool_cards` RPC -- exclusions are entirely JS-side
- The `card_pool` query at line 331 does NOT select the `types` column. The filter at line 369 checks `card.types || []` which will always be `[]` because `types` was never selected. **This means the `GLOBAL_EXCLUDED_PLACE_TYPES` and `category_type_exclusions` checks on types are DEAD CODE** -- they never match because `card.types` is always undefined/empty.
- Only `isChildVenueName()` (line 367) actually works as a post-fetch filter here.

**CRITICAL BUG:** The `.select()` at line 331 fetches: `id, google_place_id, title, category, image_url, images, rating, review_count, price_min, price_max, price_tier, lat, lng, opening_hours, address, website, description, highlights, base_match_score, popularity_score` -- **`types` is NOT in this list.** Therefore lines 369-373 are checking an empty array and never filter anything.

---

### 3. `generate-curated-experiences/index.ts` (800+ lines)

**Data source:** `place_pool` table via `queryPlacePool()` (NOT `card_pool`)

**Exclusion pipeline:**
1. **Line 27:** `GLOBAL_EXCLUDED = new Set(GLOBAL_EXCLUDED_PLACE_TYPES)` -- all types including schools
2. **Lines 35-46:** `getCategoryExcludedTypes()` -- queries `category_type_exclusions` table with per-invocation caching
3. **Lines 352-393:** `queryPlacePool()` function:
   - **Line 361:** Gets `excludedPrimary` from `seedingCategories.ts` (legacy hardcoded)
   - **Line 374:** `.overlaps('types', includedTypes)` -- only fetches places matching included types
   - **Line 384:** Filters out places with no stored photos
   - **Line 386:** Checks `primary_type` against `excludedPrimary` (per-category hardcoded in seedingCategories)
   - **Line 387:** Checks `primary_type` against `GLOBAL_EXCLUDED` (all types)
   - **Line 389:** Checks `types` array against DB-driven `dbExcludedTypes` from `category_type_exclusions`
   - **Line 390:** `isChildVenueName(p.name)` -- keyword filter

**What's MISSING:**
- Global exclusion check at line 387 only checks `primary_type`, not the full `types` array. A place with `primary_type = 'park'` but `types = ['park', 'dog_park']` would NOT be caught by the global check. However, line 389's DB-driven check DOES scan the full `types` array.
- Whether `dog_park` is actually in the `category_type_exclusions` table determines if it's caught. It IS in `GLOBAL_EXCLUDED_PLACE_TYPES` but the full-types-array check at line 389 only uses DB exclusions, not global ones.

---

## `query_pool_cards` SQL Function Analysis

**File:** `supabase/migrations/20260322300000_serve_time_quality_balancing_and_curated_exclusion.sql`
**Latest definition:** Lines 17-384

### Exclusions built into SQL:

| Exclusion | Location | Details |
|---|---|---|
| Global type exclusion (single cards) | Lines 120-124, 199-203, 301-305 | `v_excluded_types = ARRAY['gym', 'fitness_center', 'dog_park']` -- checks `place_pool.types` via `NOT EXISTS` join |
| Global type exclusion (curated cards) | Lines 130-137, 205-212, 307-314 | Same `v_excluded_types` checked through `card_pool_stops` -> `place_pool` join |
| Per-category DB exclusion (single cards) | Lines 139-146, 214-221, 316-323 | Joins `category_type_exclusions` table against `place_pool.types` |
| Per-category DB exclusion (curated cards) | Lines 148-157, 223-232, 325-334 | Same but through `card_pool_stops` |
| Hidden categories | Lines 158, 233, 335 | `NOT (cp.categories <@ v_hidden_categories)` |

**CRITICAL GAP in SQL:** `v_excluded_types` on line 43 is **hardcoded to only 3 types**: `ARRAY['gym', 'fitness_center', 'dog_park']`. The shared TypeScript `GLOBAL_EXCLUDED_PLACE_TYPES` (categoryPlaceTypes.ts:100-110) includes 5 additional types: `school`, `primary_school`, `secondary_school`, `university`, `preschool`. **Schools are NOT excluded at the SQL level.**

---

## Shared Utility: `categoryPlaceTypes.ts`

**`GLOBAL_EXCLUDED_PLACE_TYPES`** (lines 100-110):
```
gym, fitness_center, dog_park, school, primary_school, secondary_school, university, preschool
```

**`isChildVenueName()` / `isExcludedVenueName()`** (lines 621-627):
Alias for `isExcludedVenueName()`. Checks against `EXCLUDED_VENUE_NAME_KEYWORDS` (lines 590-611):
- Children's venues: kids, kidz, children, child, toddler, baby, bounce, trampoline, play space, mommy, preschool, daycare, jungle gym, fun zone, kidzone
- Educational: school, academy, institute, training center, learning center, university, college, seminary

**`CATEGORY_EXCLUDED_PLACE_TYPES`** (lines 394-545):
Extensive per-category exclusion lists defined in code. These are NOT loaded into the `category_type_exclusions` DB table. They exist for use by `getExcludedTypesForCategory()` which is **not called by any of the 3 edge functions under investigation.**

---

## `category_type_exclusions` Table Usage

| File | Usage |
|---|---|
| `discover-experiences/index.ts:350-353` | Queries table, builds exclusion map (but types check is dead code -- see above) |
| `generate-curated-experiences/index.ts:35-46` | Queries table via `getCategoryExcludedTypes()`, applied in `queryPlacePool()` line 389 |
| `query_pool_cards` SQL (used by `discover-cards`) | Joins table directly in SQL (lines 139-157, etc.) |
| Migration files | Multiple migrations populate this table |

---

## `dog_park` Exclusion Trace

| Layer | Covered? | How |
|---|---|---|
| `GLOBAL_EXCLUDED_PLACE_TYPES` (TS) | YES | `categoryPlaceTypes.ts:103` |
| `query_pool_cards` SQL `v_excluded_types` | YES | Migration line 43: `ARRAY['gym', 'fitness_center', 'dog_park']` |
| `cardPoolService.ts` JS safety net | YES | Line 852: uses full `GLOBAL_EXCLUDED_PLACE_TYPES` |
| `discover-experiences` JS filter | EFFECTIVELY NO | `globalExcluded` set includes it (line 363), but `card.types` is always `[]` (types not in SELECT) |
| `generate-curated-experiences` | PARTIAL | `GLOBAL_EXCLUDED.has(p.primary_type)` at line 387 -- only catches if `primary_type === 'dog_park'`, not if it's in the `types` array |
| `CATEGORY_EXCLUDED_PLACE_TYPES` | YES | Listed under Picnic Park exclusions (line 410) -- but this list is never used by any of the 3 functions |

---

## Summary of Gaps (Ranked by Severity)

### CRITICAL

1. **`discover-experiences` types check is dead code** (`index.ts:369-373`). The `card_pool` SELECT at line 331 does not include `types`, so `card.types` is always undefined. The `GLOBAL_EXCLUDED_PLACE_TYPES` and `category_type_exclusions` checks against types never match. Only `isChildVenueName()` works.

2. **`query_pool_cards` SQL misses school types in global exclusion.** `v_excluded_types = ARRAY['gym', 'fitness_center', 'dog_park']` -- missing `school`, `primary_school`, `secondary_school`, `university`, `preschool`. Schools with these as their place types pass through SQL-level filtering. The JS safety net in `cardPoolService.ts` only checks `primary_type`, so a school with `primary_type = 'community_center'` but `types` containing `'school'` would slip through both layers.

### HIGH

3. **`discover-cards` has NO `isChildVenueName()` filter.** A venue named "Kids Bounce Castle" with type `amusement_center` (not in global exclusions) would be served. Both `discover-experiences` (line 367) and `generate-curated-experiences` (line 390) have this filter.

4. **`generate-curated-experiences` global exclusion only checks `primary_type`** (line 387), not the full `types` array. A place with `primary_type = 'park'` and `types = ['park', 'gym']` would pass the global check. The DB-driven check at line 389 would only catch it if `gym` is in `category_type_exclusions` for the relevant category (it may or may not be -- `gym` is in `GLOBAL_EXCLUDED_PLACE_TYPES` but that doesn't mean it's in every category's DB exclusion rows).

### MEDIUM

5. **`CATEGORY_EXCLUDED_PLACE_TYPES` is unused by all 3 functions.** This extensive per-category exclusion list in `categoryPlaceTypes.ts` (lines 394-545) is never referenced. The functions either use the DB table `category_type_exclusions` or nothing. Whether the DB table contains equivalent data is unknown from code alone.

6. **`discover-experiences` bypasses `query_pool_cards` entirely**, doing direct `.from('card_pool')` queries. This means it misses all the SQL-level exclusion logic (global types, per-category DB exclusions, curated stop checks). It relies entirely on its own JS filter -- which is broken per gap #1.
