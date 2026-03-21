# Test Prompt: Category Contract Fix + Curated Label Restoration

**Target skill:** Brutal Tester
**Gate:** 4 (Test)
**Block:** 1 — Category Contract Foundations

---

## What Was Changed

Two fixes in the card serving pipeline:

### Fix A: SQL migration `20260321100000_fix_category_slug_normalization.sql`
- `query_pool_cards` now normalizes incoming `p_categories` to slugs via strict CASE (26 branches)
- Unknown category values are dropped (ELSE NULL), not fuzzy-matched
- `v_hidden_categories` changed from `'Groceries'` to `'groceries'`
- All 3 WHERE clauses use `v_slug_categories` instead of `p_categories`

### Fix B: `supabase/functions/_shared/cardPoolService.ts`
- Added `EXPERIENCE_TYPE_LABELS` const mapping 6 experience types to display labels
- `poolCardToApiCard` now returns `categoryLabel` for curated cards, reconstructed from `experience_type`

---

## Files Changed

1. `supabase/migrations/20260321100000_fix_category_slug_normalization.sql`
2. `supabase/functions/_shared/cardPoolService.ts`

---

## What to Test

### Category A: SQL Normalization (Fix A)

**Test every single one of these. No skipping.**

1. **Display name input returns cards:** Call `query_pool_cards` with `p_categories := ARRAY['Nature & Views']`. Must return >0 rows (assuming nature cards exist in pool).

2. **Slug input returns same cards:** Call with `p_categories := ARRAY['nature_views']`. Must return same count as test 1.

3. **All 12 visible display names work:** Test each individually:
   - Nature & Views, First Meet, Picnic Park, Drink, Casual Eats, Fine Dining, Watch, Live Performance, Creative & Arts, Play, Wellness, Flowers
   - Each must return >0 cards (if pool has cards for that category)

4. **All 12 visible slugs work:** Test each individually:
   - nature_views, first_meet, picnic_park, drink, casual_eats, fine_dining, watch, live_performance, creative_arts, play, wellness, flowers
   - Each must return same count as its display name counterpart

5. **Empty array returns all categories:** `p_categories := '{}'` must return cards from multiple categories.

6. **Unknown category dropped:** `p_categories := ARRAY['nonexistent']` — value dropped, becomes empty array, returns all categories (same as `'{}'`).

7. **Mixed known + unknown:** `p_categories := ARRAY['Nature & Views', 'garbage']` — only nature cards returned, garbage silently dropped.

8. **All unknown = all categories:** `p_categories := ARRAY['garbage', 'NATURE & VIEWS']` — both dropped (case-sensitive), returns all categories.

9. **Groceries-only excluded:** `p_categories := '{}'` must NOT return cards whose categories array is exactly `['groceries']` and nothing else.

10. **Groceries + other included:** Cards with `['groceries', 'flowers']` (picnic stops) MUST still appear when querying for flowers or empty categories.

11. **No p_categories in WHERE clauses:** Read the migration file. Search for `p_categories` — must only appear in parameter declaration, comments, the initial IF check, and the unnest. ZERO occurrences in WHERE clauses.

### Category B: Curated Label Restoration (Fix B)

12. **EXPERIENCE_TYPE_LABELS has all 6 types:** Verify the const in cardPoolService.ts contains: adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll.

13. **Labels match generator:** Cross-check each label value against `CURATED_TYPE_LABELS` in `generate-curated-experiences/index.ts`. Must match exactly.

14. **categoryLabel set for curated cards:** In `poolCardToApiCard`, verify curated card return path includes `categoryLabel: EXPERIENCE_TYPE_LABELS[card.experience_type] || 'Explore'`.

15. **categoryLabel NOT set for single cards:** Verify single card return path does NOT include categoryLabel. Single cards use `category` (slug) resolved by mobile via `getReadableCategoryName`.

16. **Fallback is 'Explore':** If `experience_type` is a value not in the mapping, `categoryLabel` should be `'Explore'`.

17. **Null experience_type:** If `experience_type` is null/undefined, `categoryLabel` should be `null` (not 'Explore').

### Category C: Regression Checks

18. **Function signature unchanged:** `query_pool_cards` parameter list and return type must match the previous version exactly.

19. **No other files changed:** Only the 2 files listed above should be modified. No mobile code, no admin code, no other edge functions.

20. **SECURITY DEFINER preserved:** The SQL function must still be `SECURITY DEFINER`.

21. **Existing card_pool data untouched:** No UPDATE, DELETE, or ALTER on card_pool table. Data was already correct (slugs).

---

## Spec Reference

Full spec with verification queries: `outputs/SPEC_CATEGORY_CONTRACT.md` (sections 12 and 13 have ready-to-run SQL test queries).

---

## Output

Write results to `outputs/TEST_REPORT_CATEGORY_CONTRACT.md` with pass/fail for each numbered test.
