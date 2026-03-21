# Implementation Prompt: Category Contract Fix + Curated Label Restoration

**Target skill:** Implementor
**Gate:** 3 (Implement)
**Block:** 1 — Category Contract Foundations
**Spec:** `outputs/SPEC_CATEGORY_CONTRACT.md`

---

## What You're Fixing

Two related issues in the card serving pipeline:

### Fix A: Category slug mismatch (BUG-01) — Launch blocker

The deck serves zero cards. `card_pool.categories` stores slugs (`nature_views`), but `query_pool_cards` receives display names (`Nature & Views`). The SQL `&&` overlap finds zero matches.

Also: `v_hidden_categories` is set to `ARRAY['Groceries']` (display name) but should be `ARRAY['groceries']` (slug). Groceries-only cards leak through.

### Fix B: Curated card labels lost on pool serving

When curated cards are served from `card_pool`, the `categoryLabel` field is dropped. `poolCardToApiCard` doesn't reconstruct it from `experience_type`. Users see no label (or a raw slug) instead of "Romantic", "Group Fun", "Picnic Dates", etc.

---

## Fix A: SQL Migration

**Read first:** `outputs/SPEC_CATEGORY_CONTRACT.md` — this is your complete spec with exact SQL, test queries, and verification plan.

**Read second:** The current `query_pool_cards` function definition. Find it by searching migrations for `CREATE.*FUNCTION.*query_pool_cards`. Copy the entire function as your base.

**Create file:** `supabase/migrations/20260321100000_fix_category_slug_normalization.sql`

**Content:** `CREATE OR REPLACE FUNCTION public.query_pool_cards(...)` with exactly these changes from the spec:

1. Add `v_slug_categories TEXT[]` to DECLARE block
2. Change `v_hidden_categories TEXT[] := ARRAY['Groceries']` to `ARRAY['groceries']`
3. Add the strict normalization block after BEGIN (the CASE with 26 WHEN branches from spec §7.3 — 13 display names + 13 slugs, ELSE NULL for unknowns, wrapped in COALESCE for empty array safety)
4. Replace ALL THREE occurrences of `p_categories` in WHERE clauses with `v_slug_categories`

**Critical rules:**
- Search the function body for `p_categories` after your changes — there should be ZERO remaining references in WHERE clauses (only in the initial IF check and parameter declaration)
- The ELSE branch MUST be NULL, not a regex fallback. Strict mode: unknown values are dropped.
- COALESCE(array_agg(slug), '{}') is required — without it, all-unknown input produces NULL instead of empty array

---

## Fix B: Curated Label Restoration

**Read:** `supabase/functions/_shared/cardPoolService.ts` — find the `poolCardToApiCard` function (around line 572-610).

**Change:** Where curated cards are returned, add `categoryLabel` reconstruction from `experience_type`. The card_pool row stores `experience_type` (e.g., `'romantic'`, `'group-fun'`, `'picnic-dates'`). Map it back to the display label.

**The mapping (must match what generate-curated-experiences uses):**

```typescript
const EXPERIENCE_TYPE_LABELS: Record<string, string> = {
  'adventurous': 'Adventurous',
  'first-date': 'First Date',
  'romantic': 'Romantic',
  'group-fun': 'Group Fun',
  'picnic-dates': 'Picnic Dates',
  'take-a-stroll': 'Take a Stroll',
};
```

**Where to add:** In the return object of `poolCardToApiCard`, add:
```typescript
categoryLabel: card.experience_type
  ? EXPERIENCE_TYPE_LABELS[card.experience_type] || 'Explore'
  : null,
```

**Verify the mapping exists:** Check `generate-curated-experiences/index.ts` for `CURATED_TYPE_LABELS` to confirm the exact experience type keys and label values. Your mapping MUST match exactly.

**Do NOT:**
- Define the mapping inline in the return statement — make it a const at module level for maintainability
- Add a new import or shared file — keep it local to cardPoolService.ts
- Change how single cards work — single cards use `category` (slug) → `getReadableCategoryName()` on mobile, which already works

---

## Files to Change

1. **NEW:** `supabase/migrations/20260321100000_fix_category_slug_normalization.sql` — SQL function replacement
2. **EDIT:** `supabase/functions/_shared/cardPoolService.ts` — add categoryLabel to poolCardToApiCard

That's it. Two files. No mobile changes. No admin changes. No data changes.

---

## Files to Read (Do NOT Change)

- Current `query_pool_cards` function in migrations (search for the latest `CREATE.*FUNCTION.*query_pool_cards`)
- `outputs/SPEC_CATEGORY_CONTRACT.md` — full spec with exact SQL
- `supabase/functions/generate-curated-experiences/index.ts` — verify CURATED_TYPE_LABELS mapping
- `supabase/functions/generate-single-cards/index.ts` — verify categoryToSlug() logic (for understanding, not changing)

---

## Success Criteria

1. `query_pool_cards` called with display names returns >0 cards
2. `query_pool_cards` called with slugs returns same results
3. Unknown category values are silently dropped (not fuzzy-matched)
4. Groceries-only cards are excluded from all-category queries
5. Curated cards served from pool have `categoryLabel` set (e.g., "Romantic", "Group Fun", "Picnic Dates")
6. Single cards are unaffected — they still use `category` slug resolved by mobile
7. No regression in any other card serving behavior

---

## Protective Comments to Add

In the SQL migration, above the normalization block:
```sql
-- STRICT CATEGORY NORMALIZATION
-- card_pool.categories stores slugs (e.g., 'nature_views', 'casual_eats').
-- Callers send display names (e.g., 'Nature & Views') or slugs.
-- Only known categories are accepted. Unknown values are dropped.
-- This is intentional: broken callers fail visibly (too many cards), not silently (zero cards).
-- To add a new category: add WHEN branches for both display name AND slug.
```

In cardPoolService.ts, above the EXPERIENCE_TYPE_LABELS const:
```typescript
// CURATED CARD LABEL RESTORATION
// card_pool stores experience_type but poolCardToApiCard must reconstruct categoryLabel
// from it so mobile can display "Romantic", "Group Fun", etc. on curated cards.
// This mapping MUST match CURATED_TYPE_LABELS in generate-curated-experiences/index.ts.
```

---

## After Implementation

Offer a commit message. Then the user will take the changes to the Brutal Tester for verification.
