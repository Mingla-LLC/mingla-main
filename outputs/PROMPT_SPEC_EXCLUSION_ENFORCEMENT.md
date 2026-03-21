# Spec Prompt: Per-Category Exclusion Enforcement at SQL Level (Block 2)

**Target skill:** Software and Code Architect (Specer mode)
**Gate:** 2 (Spec)
**Priority:** #2 launch blocker — inappropriate places appear in category results

---

## Context (Verified Facts)

Per-category exclusions are defined but never enforced at serve time. Users see inappropriate places (kids' venues in Fine Dining, Asian grocery stores in Drink, etc.).

**Three exclusion layers exist — all have gaps:**

1. **Google API query-time** (`admin-seed-places`): passes `excludedPrimaryTypes` to Nearby Search, but Google only filters on `primaryType`, not secondary `types`. Places with excluded types in their secondary array pass through.

2. **Post-fetch seeding filter** (`admin-seed-places/index.ts:219`): only checks 3 global types (`gym`, `fitness_center`, `dog_park`). Does NOT check category-specific `excludedPrimaryTypes` from `seedingCategories.ts`.

3. **Serve-time SQL** (`query_pool_cards`): only excludes 3 global types via `NOT EXISTS (... place_pool.types && v_excluded_types)`. Per-category exclusions from `CATEGORY_EXCLUDED_PLACE_TYPES` (27-50 types per category) are never applied.

**Data model:**
- `place_pool.types TEXT[]` — stores ALL Google Places types (indexed with GIN)
- `place_pool.primary_type TEXT` — the primary type from Google
- `card_pool.categories TEXT[]` — stores category slugs (e.g., `['nature_views']`)
- `card_pool` has NO `types` column — place types are only in `place_pool`
- `query_pool_cards` already JOINs `place_pool` via `NOT EXISTS` for global exclusions
- Cards can have multiple categories (e.g., curated cards with `['picnic_park', 'groceries', 'flowers']`)

**The user's decision:** Enforce per-category exclusions at SQL level (strongest enforcement — impossible to bypass).

**Block 1 context:** `query_pool_cards` now receives normalized category slugs in `v_slug_categories`. We know exactly which categories the user selected.

---

## Scope

Write a bounded spec for adding per-category type exclusion filtering to `query_pool_cards`.

### MUST Do

1. Spec a SQL change to `query_pool_cards` that filters out cards whose parent place has types that are excluded for the card's category
2. Handle the multi-category case: a card tagged `['casual_eats']` should be filtered by Casual Eats exclusions. A card tagged `['picnic_park', 'groceries', 'flowers']` should be filtered by the UNION of all its categories' exclusions (if a type is excluded from ANY of the card's categories, exclude it)
3. Define where the exclusion lists live — hardcoded in SQL (like the current global exclusions), or passed as a parameter, or in a lookup table
4. Spec the post-fetch seeding filter enhancement in `admin-seed-places` (check category-specific `excludedPrimaryTypes` against ALL `types`, not just `primaryType`)
5. Spec a one-time data cleanup: identify and deactivate cards whose places have excluded types for their category
6. Define behavior before and after
7. Define test criteria

### MUST NOT Do

- Do NOT change mobile code
- Do NOT change card_pool schema (no new columns)
- Do NOT remove the existing global exclusion (`v_excluded_types`) — per-category exclusions are IN ADDITION to global ones
- Do NOT change the category normalization from Block 1
- Do NOT touch Pool Intelligence or admin page code

### Design Considerations

**Option A — Hardcoded exclusion map in SQL:**
Build a PL/pgSQL function or CASE block that maps each category slug to its excluded types array. Pros: self-contained, no external dependency. Cons: large SQL, must be updated when exclusions change.

**Option B — Exclusion lookup table:**
New table `category_exclusions(category_slug TEXT, excluded_type TEXT)` populated from `CATEGORY_EXCLUDED_PLACE_TYPES`. SQL JOINs this table. Pros: easy to update, admin-editable. Cons: new table, migration, data sync with TypeScript definitions.

**Option C — Pass exclusions as parameter:**
Edge function builds the exclusion arrays from `CATEGORY_EXCLUDED_PLACE_TYPES` and passes them to the RPC. Pros: single source of truth stays in TypeScript. Cons: larger RPC call, more complex parameter.

Recommend whichever is most durable and maintainable. The user values "make the bad state impossible" — strongest enforcement wins.

### Files to Read

- `supabase/functions/_shared/categoryPlaceTypes.ts:100-104` — `GLOBAL_EXCLUDED_PLACE_TYPES`
- `supabase/functions/_shared/categoryPlaceTypes.ts:355-506` — `CATEGORY_EXCLUDED_PLACE_TYPES` (full per-category lists)
- `supabase/functions/_shared/categoryPlaceTypes.ts:512-516` — `getExcludedTypesForCategory()`
- `supabase/functions/_shared/seedingCategories.ts` — `excludedPrimaryTypes` per category
- `supabase/migrations/20260321100000_fix_category_slug_normalization.sql` — current `query_pool_cards` with Block 1 fix
- `supabase/functions/admin-seed-places/index.ts:201-227` — `applyPostFetchFilters()`

### Invariants to Protect

- Global exclusions (gym, fitness_center, dog_park) remain in place — per-category exclusions ADD to them
- Curated cards with multiple categories are evaluated against all their categories' exclusions
- Cards without a place_pool_id (orphaned curated cards) should NOT crash the query — handle NULL place_pool_id
- No performance regression that makes deck loading noticeably slower
- The exclusion list must be auditable — an admin should be able to answer "why was this card excluded?"

---

## Success Criteria

1. Fine Dining cards don't include places with `children_store`, `child_care_agency`, `preschool`, `indoor_playground`, `fast_food_restaurant` in their types
2. Drink cards don't include places with `grocery_store`, `asian_grocery_store` in their types
3. Global exclusions (gym, fitness_center, dog_park) still work
4. Cards with types NOT in their category's exclusion list are still served
5. Curated multi-category cards are correctly filtered
6. Post-fetch seeding filter catches category-specific excluded types against ALL types (not just primaryType)
7. One-time cleanup deactivates existing violating cards
8. No performance regression on `query_pool_cards` (benchmark before/after if possible)

---

## Output Format

Produce a spec document with:
1. **Chosen approach** (A, B, or C above) with reasoning
2. **Behavior Before / After**
3. **Exact SQL changes** to `query_pool_cards`
4. **Post-fetch filter changes** to `admin-seed-places`
5. **Data cleanup query** for existing violations
6. **Edge cases** — NULL place_pool_id, empty types, multi-category cards, empty exclusion list
7. **Test criteria** — specific queries proving enforcement
8. **Migration file name**
9. **README impact**

Write the spec to `outputs/SPEC_EXCLUSION_ENFORCEMENT.md`.
