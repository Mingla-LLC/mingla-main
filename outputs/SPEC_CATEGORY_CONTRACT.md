# Fix: Category Contract — Slug Normalization in query_pool_cards

**Date:** 2026-03-21
**Status:** Planned
**Mode:** Investigation + Fix
**Reported symptom:** Card deck serves zero cards to every user

---

## 1. Forensic Context

### What Was Reported
Zero cards served to every user. The card deck is completely empty regardless of selected categories.

### Investigation Summary
**Truth layers inspected:** Docs ✅ Schema ✅ Code ✅ Runtime ✅ Data ✅
**Files read:** 6
**Root cause(s):** 1 primary + 1 secondary
**Contributing factors:** 0
**Hidden flaws found:** 0

### Root Cause Analysis

#### 🔴 RC-001: Category format mismatch — display names vs slugs

**Fact:** `cardPoolService.ts:158` calls `resolveCategories(categories)` which converts user pill slugs to canonical display names (e.g., `"Nature & Views"`, `"Casual Eats"`). These display names are passed to `query_pool_cards` as `p_categories`.

**Fact:** `generate-single-cards/index.ts:14-16` calls `categoryToSlug()` before inserting into `card_pool`, converting display names to slugs (e.g., `"Nature & Views"` → `"nature_views"`).

**Fact:** `query_pool_cards` line 136 does `cp.categories && p_categories` — a direct array overlap comparison.

**Inference:** `ARRAY['nature_views'] && ARRAY['Nature & Views']` evaluates to FALSE because PostgreSQL text array overlap is case-sensitive and exact-match. No card will ever match.

**Impact:** User sees zero cards in their deck. The app is completely broken for card serving.

**Defective code (migration line 136, repeated at 183 and 242):**
```sql
AND (p_categories = '{}' OR cp.categories && p_categories)
```

**What it should do:** Normalize `p_categories` to slug format before comparison, so `ARRAY['nature_views'] && ARRAY['nature_views']` evaluates to TRUE.

**Causal chain:**
1. User selects pill "nature" → mobile sends display name `"Nature & Views"` to edge function
2. `resolveCategories()` keeps it as display name (canonical form in code layer)
3. SQL receives `p_categories := ARRAY['Nature & Views']`
4. SQL compares `ARRAY['nature_views'] && ARRAY['Nature & Views']` → FALSE
5. Zero rows pass the filter → zero cards returned → empty deck

**Invariant violated:** "Category comparison in query_pool_cards must use the same format as card_pool.categories storage format (slugs)"

**Enforced by:** Currently nothing — the SQL function blindly trusts that incoming categories match stored format. Fix enforces this at the SQL layer via normalization.

**Verification:** After fix, `SELECT * FROM query_pool_cards(p_categories := ARRAY['Nature & Views'], ...)` returns the same results as `p_categories := ARRAY['nature_views']`.

---

#### 🔴 RC-002: Hidden category exclusion also uses display names instead of slugs

**Fact:** `query_pool_cards` line 117 declares:
```sql
v_hidden_categories TEXT[] := ARRAY['Groceries'];
```

**Fact:** `card_pool.categories` stores slugs, so groceries cards contain `'groceries'` (lowercase slug), not `'Groceries'` (display name).

**Fact:** Lines 154, 201, 259 check:
```sql
AND NOT (cp.categories <@ v_hidden_categories)
```

**Inference:** `ARRAY['groceries'] <@ ARRAY['Groceries']` evaluates to FALSE (case-sensitive). The hidden-category exclusion **never fires**. Cards tagged only with `'groceries'` will appear when `p_categories = '{}'` (all-categories mode).

**Impact:** Groceries-only cards leak into regular card serving when no category filter is applied. Currently masked because users rarely query with empty categories, but it's a latent data leak.

**Invariant violated:** "Hidden category exclusion must use the same format as card_pool.categories storage format (slugs)"

**Enforced by:** Currently nothing. Fix changes the constant to slug format.

**Verification:** After fix, `SELECT NOT (ARRAY['groceries'] <@ ARRAY['groceries'])` → TRUE (excluded correctly).

---

### Invariants That Must Hold After Fix

1. **Category comparison uses slug format** — `p_categories` values are normalized to slugs before any `&&` comparison. Enforced by: SQL normalization logic inside `query_pool_cards`.
2. **Hidden category exclusion uses slug format** — `v_hidden_categories` contains slugs matching stored format. Enforced by: literal constant in SQL function.
3. **Strict slug validation** — only the 13 known category slugs are accepted. Unknown values are silently dropped from the array. If all values are unknown, the array becomes empty (returns all categories). Enforced by: CASE normalization with NULL for unknowns + `array_remove(NULL)`.
4. **Empty categories = all categories** — `p_categories = '{}'` bypasses the filter entirely. Enforced by: existing `p_categories = '{}'` guard (unchanged).
5. **Groceries exclusion** — cards tagged ONLY with groceries are excluded from regular queries. Enforced by: `<@` check against slug-format hidden categories array.

### What NOT to Change

- **`card_pool.categories` data** — already correctly stores slugs. Do not modify stored data.
- **`resolveCategories()` in `categoryPlaceTypes.ts`** — callers can continue sending display names; the SQL normalizes known values and drops unknowns.
- **`PILL_TO_CATEGORY_NAME` in `deckService.ts`** — mobile code is not changing.
- **`categoryToSlug()` in `generate-single-cards`** — insertion pipeline is correct.
- **The `&&` operator semantics** — still any-match, not all-match.

---

## 2. Summary

The `query_pool_cards` SQL function receives category display names (e.g., `"Nature & Views"`) but compares them against slugs stored in `card_pool.categories` (e.g., `"nature_views"`). This mismatch causes zero cards to match. The fix adds a normalization step inside the SQL function that converts any incoming display name to its slug equivalent before comparison. A secondary bug in the hidden-categories constant (`'Groceries'` instead of `'groceries'`) is fixed simultaneously.

## 3. Design Principle

**Slugs are the canonical storage format for categories. Any SQL function that compares against `card_pool.categories` must normalize inputs to slug format at the boundary.**

## 4. Source of Truth Definition

| Entity | Source of Truth | Derived From | Cacheable? | Rebuildable? |
|--------|----------------|-------------|------------|-------------|
| Category slug format | `SEEDING_CATEGORIES[].id` in `seedingCategories.ts` | — | N/A | N/A |
| Category display name | `SEEDING_CATEGORIES[].label` in `seedingCategories.ts` | — | N/A | N/A |
| Card categories (stored) | `card_pool.categories` column (slug format) | `categoryToSlug()` at insert time | No | Yes, via re-generation |
| Category filter (runtime) | `p_categories` param to `query_pool_cards` | Mobile sends display names via `resolveCategories()` | No | N/A |

## 5. Success Criteria

1. `query_pool_cards` called with `p_categories := ARRAY['Nature & Views', 'Casual Eats']` returns the same results as `p_categories := ARRAY['nature_views', 'casual_eats']`
2. Calling with already-slug format (`ARRAY['nature_views']`) still works
3. Calling with an unknown category (`ARRAY['nonexistent']`) drops that value — it does NOT get a fuzzy match or fallback slug. Unknown = ignored.
4. Calling with empty array `'{}'` still returns all categories (existing behavior preserved)
5. All 12 visible categories return >0 cards (assuming pool has cards for each)
6. Groceries-only cards are excluded from regular queries (including `p_categories = '{}'`)
7. No new migration conflicts
8. No performance regression — normalization is O(n) on a small array (max 13 elements)

## 6. Non-Goals

1. Changing mobile code (deckService.ts, cardConverters.ts) — out of scope
2. Changing `resolveCategories()` — caller can continue sending display names
3. Changing `generate-single-cards` or any card generator
4. Changing stored `card_pool.categories` data
5. Adding new tables, RPCs, or edge functions
6. Touching admin page code

---

## 7. Database Changes

### 7.1 New Tables
None.

### 7.2 Modified Tables
None (only modifying the `query_pool_cards` function).

### 7.3 Modified Functions

**Function:** `public.query_pool_cards`

**Change 1 — Add slug normalization at function entry:**

Add a `v_slug_categories TEXT[]` variable and a normalization block immediately after `BEGIN`. This converts every element of `p_categories` to its known slug using a CASE expression. **Unknown values produce NULL and are dropped** — no fuzzy fallback, no guessing. Only the 13 known categories are accepted.

```sql
DECLARE
  -- ... existing variables ...
  v_slug_categories TEXT[];  -- NEW: normalized slug version of p_categories
  v_hidden_categories TEXT[] := ARRAY['groceries'];  -- CHANGED: was 'Groceries'
BEGIN
  -- ── Normalize p_categories to strict slug format ────────────────────────
  -- STRICT MODE: only known categories are accepted. Unknown values are dropped.
  -- This is intentional — we want broken callers to fail visibly, not silently match garbage.
  IF p_categories = '{}' THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(slug), '{}')
    INTO v_slug_categories
    FROM (
      SELECT CASE val
        WHEN 'Nature & Views'   THEN 'nature_views'
        WHEN 'First Meet'       THEN 'first_meet'
        WHEN 'Picnic Park'      THEN 'picnic_park'
        WHEN 'Drink'            THEN 'drink'
        WHEN 'Casual Eats'      THEN 'casual_eats'
        WHEN 'Fine Dining'      THEN 'fine_dining'
        WHEN 'Watch'            THEN 'watch'
        WHEN 'Live Performance' THEN 'live_performance'
        WHEN 'Creative & Arts'  THEN 'creative_arts'
        WHEN 'Play'             THEN 'play'
        WHEN 'Wellness'         THEN 'wellness'
        WHEN 'Flowers'          THEN 'flowers'
        WHEN 'Groceries'        THEN 'groceries'
        -- Slug passthrough: if already a known slug, keep it
        WHEN 'nature_views'     THEN 'nature_views'
        WHEN 'first_meet'       THEN 'first_meet'
        WHEN 'picnic_park'      THEN 'picnic_park'
        WHEN 'drink'            THEN 'drink'
        WHEN 'casual_eats'      THEN 'casual_eats'
        WHEN 'fine_dining'      THEN 'fine_dining'
        WHEN 'watch'            THEN 'watch'
        WHEN 'live_performance' THEN 'live_performance'
        WHEN 'creative_arts'    THEN 'creative_arts'
        WHEN 'play'             THEN 'play'
        WHEN 'wellness'         THEN 'wellness'
        WHEN 'flowers'          THEN 'flowers'
        WHEN 'groceries'        THEN 'groceries'
        ELSE NULL  -- Unknown value → dropped
      END AS slug
      FROM unnest(p_categories) AS val
    ) sub
    WHERE slug IS NOT NULL;
  END IF;
```

**Change 2 — Replace `p_categories` with `v_slug_categories` in all comparisons:**

Three locations where `p_categories` is used in the filter:
- Line 136: `AND (p_categories = '{}' OR cp.categories && p_categories)`
- Line 183: `AND (p_categories = '{}' OR cp.categories && p_categories)`
- Line 242: `AND (p_categories = '{}' OR cp.categories && p_categories)`

All three become:
```sql
AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
```

**Change 3 — Fix hidden categories constant:**

Line 117 changes from:
```sql
v_hidden_categories TEXT[] := ARRAY['Groceries'];
```
To:
```sql
v_hidden_categories TEXT[] := ARRAY['groceries'];
```

### 7.4 Data Integrity Guarantees

| Invariant | Enforced By | Layer |
|-----------|------------|-------|
| Category comparison uses slug format | CASE normalization in `query_pool_cards` | SQL function |
| Hidden categories use slug format | Literal slug constant in function | SQL function |
| Slug passthrough (idempotent) | Known slugs have explicit WHEN branches | SQL function |
| All 13 categories mapped | Exhaustive CASE with 13 display names + 13 slugs = 26 WHEN branches | SQL function |
| Unknown input rejected | ELSE NULL + WHERE slug IS NOT NULL drops unknowns | SQL function |
| Pill = what you get | Only exact known categories match; no fuzzy cross-contamination | SQL function |

---

## 8. Edge Functions

No edge function changes. The normalization happens entirely within the SQL function.

---

## 9. Mobile Implementation

No mobile changes.

---

## 10. Migration Plan

### Forward Migration

**Migration file:** `supabase/migrations/20260321100000_fix_category_slug_normalization.sql`

**Content:** Single `CREATE OR REPLACE FUNCTION public.query_pool_cards(...)` statement. This is a function replacement — non-destructive, no data changes, no table alterations.

**SQL (complete function replacement):**

The full function body is identical to the current version in `20260320100000_category_migration_13.sql` lines 88-293, with exactly three changes:

1. Add `v_slug_categories TEXT[];` to DECLARE block
2. Change `v_hidden_categories TEXT[] := ARRAY['Groceries']` to `ARRAY['groceries']`
3. Add normalization block after BEGIN (the CASE/array_agg block from §7.3 above)
4. Replace all three occurrences of `p_categories` in WHERE clauses with `v_slug_categories`

### Rollback Plan

- **Destructive?** No. `CREATE OR REPLACE FUNCTION` overwrites the function but doesn't touch data.
- **Rollback:** Re-run the previous migration's function definition (from `20260320100000_category_migration_13.sql`). This restores the old behavior.
- **Old/new code coexistence:** Safe. The new function accepts the same inputs and returns the same output shape. Callers sending known slugs or display names get correct results. Callers sending unknown values get those values silently dropped (fail-open to "all categories").

### Data Safety

- No data is modified, dropped, or altered.
- No columns added or removed.
- No table structure changes.
- The migration is purely a function replacement.

---

## 11. Implementation Order

**Step 1:** Create migration file `supabase/migrations/20260321100000_fix_category_slug_normalization.sql` with the complete `CREATE OR REPLACE FUNCTION` statement containing all three changes.

**Step 2:** Apply migration via `supabase migration up` or MCP tool.

**Step 3:** Verify with test queries from §13.

---

## 12. Test Cases

| # | Test | Input | Expected | Layer |
|---|------|-------|----------|-------|
| 1 | Display names match | `p_categories := ARRAY['Nature & Views']` | Returns cards with `categories && ARRAY['nature_views']` | SQL |
| 2 | Slugs pass through | `p_categories := ARRAY['nature_views']` | Same results as test 1 | SQL |
| 3 | Mixed format | `p_categories := ARRAY['Nature & Views', 'casual_eats']` | Returns cards matching either category | SQL |
| 4 | Empty array = all | `p_categories := '{}'` | Returns cards from all categories | SQL |
| 5 | All 12 visible categories | Each display name individually | Each returns >0 cards (if pool populated) | SQL |
| 6 | Groceries exclusion | `p_categories := '{}'` | Cards tagged ONLY with `['groceries']` are excluded | SQL |
| 7 | Groceries + other | Card with `['groceries', 'flowers']` | Included (not ONLY groceries) | SQL |
| 8 | NULL input | `p_categories := NULL` | Should behave as empty (or error gracefully) | SQL |
| 9 | Unknown category | `p_categories := ARRAY['nonexistent']` | Value dropped, empty slug array, returns all categories (same as `'{}'`) | SQL |
| 10 | Mixed known + unknown | `p_categories := ARRAY['Nature & Views', 'garbage']` | Only `nature_views` kept, `garbage` dropped. Returns nature cards only. | SQL |
| 11 | All unknown | `p_categories := ARRAY['garbage', 'NATURE & VIEWS']` | Both dropped (case-sensitive). Returns all categories (empty = all). | SQL |

**Strict mode behavior:** Unknown values are silently dropped, not converted. If ALL values are unknown, the array becomes `'{}'` which means "all categories." This is fail-open by design — a broken caller gets too many cards (visible bug) rather than zero cards (silent failure). The broken caller should be fixed, and the "too many cards" behavior makes the bug obvious.

---

## 13. Verification Queries

### Pre-fix verification (proves the bug exists)

```sql
-- This returns 0 rows (bug: display name doesn't match slug)
SELECT COUNT(*) FROM card_pool
WHERE is_active = true
  AND categories && ARRAY['Nature & Views'];

-- This returns >0 rows (slug matches slug)
SELECT COUNT(*) FROM card_pool
WHERE is_active = true
  AND categories && ARRAY['nature_views'];
```

### Post-fix verification (proves the fix works)

```sql
-- Test 1: Display name input returns cards
SELECT COUNT(*) FROM query_pool_cards(
  p_user_id := '00000000-0000-0000-0000-000000000000',
  p_categories := ARRAY['Nature & Views'],
  p_lat_min := -90, p_lat_max := 90,
  p_lng_min := -180, p_lng_max := 180
);
-- Expected: > 0 (assuming nature cards exist in pool)

-- Test 2: Slug input returns same count
SELECT COUNT(*) FROM query_pool_cards(
  p_user_id := '00000000-0000-0000-0000-000000000000',
  p_categories := ARRAY['nature_views'],
  p_lat_min := -90, p_lat_max := 90,
  p_lng_min := -180, p_lng_max := 180
);
-- Expected: same as Test 1

-- Test 3: Empty categories returns all (minus groceries-only)
SELECT COUNT(*) FROM query_pool_cards(
  p_user_id := '00000000-0000-0000-0000-000000000000',
  p_categories := '{}',
  p_lat_min := -90, p_lat_max := 90,
  p_lng_min := -180, p_lng_max := 180
);
-- Expected: > 0

-- Test 4: Groceries-only cards excluded
SELECT COUNT(*) FROM card_pool
WHERE is_active = true
  AND categories = ARRAY['groceries'];
-- If > 0, these should NOT appear in Test 3 results

-- Test 5: All 12 visible categories return cards
SELECT unnest AS category, (
  SELECT COUNT(*) FROM query_pool_cards(
    p_user_id := '00000000-0000-0000-0000-000000000000',
    p_categories := ARRAY[unnest],
    p_lat_min := -90, p_lat_max := 90,
    p_lng_min := -180, p_lng_max := 180
  )
) AS card_count
FROM unnest(ARRAY[
  'Nature & Views', 'First Meet', 'Picnic Park', 'Drink',
  'Casual Eats', 'Fine Dining', 'Watch', 'Live Performance',
  'Creative & Arts', 'Play', 'Wellness', 'Flowers'
]);
-- Expected: all > 0 (assuming pool has cards for each category)
```

### Slug normalization unit test (strict mode)

```sql
-- Verify the CASE logic: known values resolve, unknown values become NULL
SELECT val,
  CASE val
    WHEN 'Nature & Views'   THEN 'nature_views'
    WHEN 'nature_views'     THEN 'nature_views'
    WHEN 'First Meet'       THEN 'first_meet'
    WHEN 'first_meet'       THEN 'first_meet'
    WHEN 'Casual Eats'      THEN 'casual_eats'
    WHEN 'casual_eats'      THEN 'casual_eats'
    WHEN 'Creative & Arts'  THEN 'creative_arts'
    WHEN 'creative_arts'    THEN 'creative_arts'
    WHEN 'Live Performance' THEN 'live_performance'
    WHEN 'live_performance' THEN 'live_performance'
    WHEN 'Groceries'        THEN 'groceries'
    WHEN 'groceries'        THEN 'groceries'
    ELSE NULL  -- STRICT: unknown → dropped
  END AS slug
FROM unnest(ARRAY[
  'Nature & Views', 'nature_views', 'Casual Eats', 'casual_eats',
  'Creative & Arts', 'creative_arts', 'Live Performance', 'live_performance',
  'unknown_thing', 'Unknown Thing', 'NATURE & VIEWS'
]) AS val;
-- Expected output:
-- Nature & Views   → nature_views
-- nature_views     → nature_views     (slug passthrough)
-- Casual Eats      → casual_eats
-- casual_eats      → casual_eats      (slug passthrough)
-- Creative & Arts  → creative_arts
-- creative_arts    → creative_arts    (slug passthrough)
-- Live Performance → live_performance
-- live_performance → live_performance (slug passthrough)
-- unknown_thing    → NULL             (DROPPED — not a known category)
-- Unknown Thing    → NULL             (DROPPED — not a known category)
-- NATURE & VIEWS   → NULL             (DROPPED — case-sensitive, wrong case)
```

---

## 14. Common Mistakes to Avoid

1. **Using `lower()` alone without the CASE:** → `lower('Nature & Views')` produces `'nature & views'`, NOT `'nature_views'`. The `&` and spaces remain. The CASE mapping is required for known categories.

2. **Adding a fuzzy fallback for unknown values:** → Do NOT add `lower(regexp_replace(...))` as a fallback. Unknown values must produce NULL and be dropped. We want strict contract enforcement — if a caller sends garbage, it should fail visibly, not silently match something unexpected.

3. **Only fixing one of the three WHERE clauses:** → The filter appears THREE times (count query, primary path, fallback path). All three must use `v_slug_categories`.

4. **Leaving `v_hidden_categories` as `'Groceries'`:** → The groceries exclusion would remain broken. Must change to `'groceries'` (slug format).

5. **Forgetting COALESCE on array_agg:** → If all values are dropped (all unknown), `array_agg` returns NULL, not `'{}'`. Must wrap in `COALESCE(array_agg(slug), '{}')` to ensure empty array behavior.

---

## 15. README / Contract Language

After implementation, add to the architecture document or README:

> **Category Format Contract:** `card_pool.categories` stores slugs (e.g., `nature_views`, `casual_eats`). The SQL function `query_pool_cards` accepts both display names and slugs but normalizes strictly to the 13 known category slugs. Unknown values are dropped — no fuzzy matching, no fallback conversion. The canonical slug mapping is defined in `SEEDING_CATEGORIES` (`seedingCategories.ts`). Any new category must be added to both `SEEDING_CATEGORIES` and the CASE expression in `query_pool_cards`. When a user selects a pill, they must only see cards from that exact category — no cross-contamination from loose matching.

---

## 16. Handoff to Implementor

Implementor: this is your single source of truth. §3 is the design principle — slugs are canonical, normalize at the SQL boundary. §4 defines what is authoritative vs derived. §1 contains the forensic diagnosis with two root causes — both must be fixed in a single migration.

Execute in order from §11. The migration is a single file containing `CREATE OR REPLACE FUNCTION`. Copy the entire existing function from the current migration, apply the three changes listed in §7.3, verify with queries from §13.

**Critical:** All three `p_categories` references in WHERE clauses must become `v_slug_categories`. Missing one means that branch still serves zero cards. Search for `p_categories` in the function body — there should be zero remaining references in WHERE clauses after the fix.

Not done until tester's report is green.
