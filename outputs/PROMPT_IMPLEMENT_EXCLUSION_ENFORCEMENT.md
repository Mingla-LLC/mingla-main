# Implementation Prompt: Per-Category Exclusion Enforcement (Block 2)

**Target skill:** Implementor
**Gate:** 3 (Implement)
**Block:** 2 — Exclusion / Safety Foundations
**Spec:** `outputs/SPEC_EXCLUSION_ENFORCEMENT.md`

---

## What You're Fixing

Users see inappropriate places in category results — kids' venues in Fine Dining, grocery stores in Drink, fast food in Creative Arts. Per-category exclusions are defined in TypeScript but never enforced at serve time. Only 3 global types (gym, fitness_center, dog_park) are currently filtered.

---

## CRITICAL CORRECTION FROM SPEC

The spec says the new NOT EXISTS clause should use:

```sql
AND cte.category_slug = ANY(cp.categories)  -- card's own categories
```

**THIS IS WRONG.** Use this instead:

```sql
AND cte.category_slug = ANY(v_slug_categories)  -- user's QUERIED categories
```

**Why:** The exclusion should filter based on what the user is browsing, not what the card is tagged with. When a user selects "Picnic Park", we check picnic_park exclusions only. A curated card tagged `['picnic_park', 'groceries', 'flowers']` should NOT be killed because of groceries' exclusion list when the user searched for picnic_park.

**Edge case — empty v_slug_categories (no category filter):** When `v_slug_categories = '{}'`, the user didn't filter by category (they want everything). In this case `ANY('{}')` matches nothing, so no per-category exclusions apply. This is correct: if the user didn't pick a category, there's no category-specific filtering to do. The global exclusions (gym, fitness_center, dog_park) still apply regardless.

---

## Files to Create / Edit

### File 1: NEW — `supabase/migrations/20260321110000_per_category_exclusion_enforcement.sql`

This migration does three things in order:

**Part A — Create the exclusion table:**

```sql
CREATE TABLE public.category_type_exclusions (
  category_slug TEXT NOT NULL,
  excluded_type TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category_slug, excluded_type)
);

CREATE INDEX idx_cte_category_slug ON public.category_type_exclusions (category_slug);

ALTER TABLE public.category_type_exclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read exclusions"
  ON public.category_type_exclusions
  FOR SELECT
  TO authenticated
  USING (true);
```

**Part B — Insert all exclusion rows:**

Copy the full INSERT statement from `outputs/SPEC_EXCLUSION_ENFORCEMENT.md` section 4.2 (lines 112-848). This is ~550 rows covering all 13 categories. Copy it exactly — every row has been verified against `categoryPlaceTypes.ts`. Include the `ON CONFLICT DO NOTHING` at the end.

**Part C — Replace `query_pool_cards` function:**

Read the current function from `supabase/migrations/20260321100000_fix_category_slug_normalization.sql`. Copy the entire `CREATE OR REPLACE FUNCTION public.query_pool_cards(...)` definition. Then add ONE new `AND NOT EXISTS` clause to ALL THREE filtered CTEs (count CTE, primary CTE, fallback CTE).

Add it AFTER the existing global exclusion check:

```sql
-- Existing global exclusion (KEEP — unchanged)
AND NOT EXISTS (
  SELECT 1 FROM public.place_pool pp
  WHERE pp.id = cp.place_pool_id
    AND pp.types && v_excluded_types
)
-- PER-CATEGORY EXCLUSION (Block 2)
-- Excludes cards whose place has types that are excluded for the user's selected categories.
-- Uses v_slug_categories (the user's query), NOT cp.categories (the card's own tags).
-- When v_slug_categories is empty (no filter), no per-category exclusions apply — only globals.
-- The category_type_exclusions table is the schema-enforced source of truth (~550 rows).
AND NOT EXISTS (
  SELECT 1
  FROM public.place_pool pp,
       public.category_type_exclusions cte
  WHERE pp.id = cp.place_pool_id
    AND cte.category_slug = ANY(v_slug_categories)
    AND cte.excluded_type = ANY(pp.types)
)
```

**VERIFY after writing:** Search the new function for `cp.categories` in the NOT EXISTS clause — it must NOT appear there. Only `v_slug_categories` should be used.

---

### File 2: EDIT — `supabase/functions/admin-seed-places/index.ts`

**Read first.** Find `applyPostFetchFilters` (around line 201-227).

**Changes:**

1. Add import at the top of the file (if not already present):
```typescript
import { getExcludedTypesForCategory } from "../_shared/categoryPlaceTypes.ts";
```

2. Change the `applyPostFetchFilters` function signature to accept `categoryId`:
```typescript
function applyPostFetchFilters(places: any[], categoryId: string): FilterResult {
```

3. Build the full exclusion set at the top of the function:
```typescript
const excludedTypes = getExcludedTypesForCategory(categoryId);
const excludedSet = new Set(excludedTypes);
```

4. Replace the existing primaryType-only check:
```typescript
// BEFORE:
if (p.primaryType && GLOBAL_EXCLUDED_PLACE_TYPES.includes(p.primaryType)) {
  rejectedExcludedType++;
  return false;
}

// AFTER:
// Check ALL types (not just primaryType) against full exclusion set (global + category-specific)
const placeTypes: string[] = p.types ?? [];
if (placeTypes.some((t: string) => excludedSet.has(t))) {
  rejectedExcludedType++;
  return false;
}
```

5. Find the call site in `seedCategory()` (around line ~467) and pass the category ID:
```typescript
// BEFORE:
const { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType } =
  applyPostFetchFilters(places);

// AFTER:
const { passed, rejectedNoPhotos, rejectedClosed, rejectedExcludedType } =
  applyPostFetchFilters(places, config.id);
```

**Verify:** `getExcludedTypesForCategory` already exists in `categoryPlaceTypes.ts` — check that the import path resolves. It takes any category format (slug, display name) and returns global + category-specific exclusions via `resolveCategory()` internally.

---

## Files to Read (Do NOT Change)

- `outputs/SPEC_EXCLUSION_ENFORCEMENT.md` — full spec with INSERT data and test queries
- `supabase/migrations/20260321100000_fix_category_slug_normalization.sql` — current `query_pool_cards` (Block 1 version, your base)
- `supabase/functions/_shared/categoryPlaceTypes.ts` — verify `getExcludedTypesForCategory` exists and its import path
- `supabase/functions/admin-seed-places/index.ts` — read current state before editing

---

## Success Criteria

1. `category_type_exclusions` table exists with ~550 rows, composite PK, RLS read-only
2. `query_pool_cards` has per-category NOT EXISTS clause using `v_slug_categories` in all 3 CTEs
3. Fine Dining queries exclude fast_food_restaurant, children_store, hamburger_restaurant places
4. Drink queries exclude asian_grocery_store, grocery_store places
5. Global exclusions (gym, fitness_center, dog_park) still work independently
6. Empty category filter (no pills selected) = no per-category exclusions, only globals
7. Curated cards with NULL place_pool_id pass through safely
8. `applyPostFetchFilters` checks ALL types against category-specific exclusions
9. No regression in Block 1 category normalization

---

## Protective Comments to Add

In the migration, above the new NOT EXISTS clause:
```sql
-- PER-CATEGORY EXCLUSION (Block 2 — hardened 2026-03-21)
-- Excludes cards whose place has types excluded for the user's selected categories.
-- Uses v_slug_categories (user's query), NOT cp.categories (card's tags).
-- Source of truth: category_type_exclusions table (~550 rows, schema-enforced).
-- When v_slug_categories is empty, this clause is inert (no category = no exclusion).
-- Global exclusions above still apply regardless.
-- To add exclusions: INSERT into category_type_exclusions. To audit: SELECT * FROM category_type_exclusions WHERE category_slug = ?.
```

In admin-seed-places, above the enhanced filter:
```typescript
// PER-CATEGORY TYPE EXCLUSION (Block 2 — hardened 2026-03-21)
// Checks ALL types (not just primaryType) against full exclusion set.
// getExcludedTypesForCategory returns global + category-specific exclusions.
// This prevents places with excluded secondary types from entering the pool.
```

---

## After Implementation

Offer a commit message. Then the user will take the changes to the Brutal Tester.
