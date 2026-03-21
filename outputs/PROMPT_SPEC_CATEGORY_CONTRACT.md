# Spec Prompt: Category Contract Fix (Block 1)

**Target skill:** Software and Code Architect (Specer mode)
**Gate:** 2 (Spec)
**Priority:** #1 launch blocker — zero cards served until this is fixed

---

## Context (Verified Facts)

The card deck serves zero cards to every user due to a category format mismatch.

**The proven chain:**
1. Mobile `deckService.ts:257` converts user-selected pill slugs (`nature`, `casual_eats`) to display names (`"Nature & Views"`, `"Casual Eats"`) via `PILL_TO_CATEGORY_NAME`
2. These display names are sent to `discover-cards` edge function
3. `cardPoolService.ts:158` calls `resolveCategories()` which keeps them as display names (canonical display name form)
4. SQL RPC `query_pool_cards` receives `ARRAY['Nature & Views', 'Casual Eats']` as `p_categories`
5. SQL does `cp.categories && p_categories` (array overlap)
6. But `card_pool.categories` stores **slugs**: `ARRAY['nature_views']`, `ARRAY['casual_eats']`
7. `ARRAY['nature_views'] && ARRAY['Nature & Views']` → **FALSE** → zero cards

**Why card_pool stores slugs:** `generate-single-cards/index.ts:212-219` calls `categoryToSlug()` before insertion. This converts `"Nature & Views"` → `"nature_views"`.

**Strategic decision (approved by user):** Slugs are the canonical format. The fix is in the SQL RPC — normalize incoming display names to slugs before comparison.

---

## Scope

Write a bounded fix spec for normalizing category comparison in `query_pool_cards`.

### MUST Do
1. Spec a SQL change to `query_pool_cards` that converts incoming `p_categories` values to slug format before the `&&` comparison with `cp.categories`
2. Define the slug normalization logic (must match what `categoryToSlug()` does: lowercase, replace non-alphanumeric with underscore, handle known mappings like "Nature & Views" → "nature_views")
3. Spec should handle: already-slug input (passthrough), display name input (convert), mixed input (handle both)
4. Specify behavior before and after the fix
5. Define test criteria

### MUST NOT Do
- Do NOT change mobile code (deckService.ts, cardConverters.ts)
- Do NOT change `resolveCategories()` in cardPoolService.ts
- Do NOT change `generate-single-cards` or any generator
- Do NOT change `card_pool.categories` data (it's already correct as slugs)
- Do NOT add new tables or new RPCs
- Do NOT touch any admin page code
- Do NOT expand scope beyond the SQL function

### Files to Read
- `supabase/migrations/20260320100000_category_migration_13.sql` — current `query_pool_cards` definition (the function to modify)
- `supabase/functions/generate-single-cards/index.ts:14-16` — `categoryToSlug()` logic (the slug format to match)
- `supabase/functions/_shared/categoryPlaceTypes.ts:217-250` — `resolveCategories()` and `resolveCategory()` (what the caller sends)
- `supabase/functions/_shared/cardPoolService.ts:145-170` — how categories flow into the RPC call
- `app-mobile/src/services/deckService.ts:62-75` — `PILL_TO_CATEGORY_NAME` mapping

### Invariants to Protect
- `card_pool.categories` continues to store slugs (do NOT change storage format)
- All 12 visible categories must match (nature, first_meet, picnic_park, drink, casual_eats, fine_dining, watch, live_performance, creative_arts, play, wellness, flowers)
- Groceries (hidden 13th category) must still be excluded from regular serving
- The `&&` overlap operator semantics must be preserved (any-match, not all-match)
- No performance regression — slug conversion must be efficient

---

## Success Criteria

1. `query_pool_cards` called with `p_categories := ARRAY['Nature & Views', 'Casual Eats']` returns the same results as calling with `p_categories := ARRAY['nature_views', 'casual_eats']`
2. Calling with already-slug format (`ARRAY['nature_views']`) still works (backward compat)
3. Calling with empty array `'{}'` still returns all categories (existing behavior preserved)
4. All 12 visible categories return >0 cards (assuming pool has cards for each)
5. Groceries-only cards are still excluded from regular queries
6. No new migration conflicts

---

## Output Format

Produce a spec document with:
1. **Behavior Before** — exact SQL comparison that fails
2. **Behavior After** — exact SQL comparison that succeeds
3. **Slug normalization logic** — the PL/pgSQL function or inline logic
4. **Edge cases** — mixed input, unknown categories, empty categories, NULL
5. **Test criteria** — specific SQL queries that prove the fix works
6. **Migration file name** — following the project's timestamp convention
7. **README impact** — what contract language to add about canonical category format

Write the spec to `outputs/SPEC_CATEGORY_CONTRACT.md`.
