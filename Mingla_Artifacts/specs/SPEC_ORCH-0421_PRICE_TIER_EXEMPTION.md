# Spec: Category-Aware Price Tier Filtering + Preferences UI (ORCH-0421)

> Date: 2026-04-14
> Source: Investigation ORCH-0421 (root cause proven)
> Confidence: H
> Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0421_DECK_UNDERFILL.md`

---

## 1. Layman Summary

The price preference filter kills 73-100% of cards for categories where price is meaningless
(parks, picnic spots, movie theaters, museums, concert venues). This spec defines a two-part
fix: (1) teach the database which categories are exempt from price filtering, and (2) hide
the price picker on the preferences screen when only exempt categories are selected, so the
user isn't shown a control that has no effect.

---

## 2. Scope

**Part 1 — SQL migration:** Add a price-exempt category list to `query_pool_cards` RPC.
Cards in exempt categories bypass price tier filtering. NULL `price_tier` cards are included
in all categories.

**Part 2 — PreferencesSheet UI:** Generalize the existing nature-only price section hide
(line 983) to cover all 5 exempt categories.

## 3. Non-Goals

- Changing how price tiers are assigned to places (that's the seeding pipeline)
- Changing the scoring algorithm (scoring can still rank by price — this is about filtering)
- Addressing wellness AI approval gaps (ORCH-0422) or picnic_park data seeding (ORCH-0423)
- Changing multi-category array overlap behavior (HF-1 from investigation)

## 4. Architectural Decisions

**D-1: All 5 categories are price-exempt.** Confirmed by user and data.

| Slug (SQL) | ID (client) | Rationale |
|------------|-------------|-----------|
| `nature_views` | `nature` | 99.3% chill/NULL — parks, trails, gardens |
| `picnic_park` | `picnic_park` | 100% chill — free by definition |
| `watch` | `watch` | 94.3% chill — ticket-based, not tier-based |
| `creative_arts` | `creative_arts` | 89.8% chill — museums/galleries, many free |
| `live_performance` | `live_performance` | 86.6% chill — event-priced, not venue-tier |

**D-2: Exempt list lives in two places (must stay in sync).**
- SQL RPC: hardcoded `v_price_exempt_categories` array (category slugs as stored in `card_pool.category`)
- Client: exported `PRICE_EXEMPT_CATEGORIES` constant in `app-mobile/src/constants/priceTiers.ts` (category IDs as used in PreferencesSheet)

Note the slug mismatch: SQL uses `nature_views`, client uses `nature`. Both lists map to the same 5 categories. A comment in each location must cross-reference the other.

**D-3: NULL `price_tier` treated as "matches any tier".** Always included, regardless of user's selected tiers. Applied globally to all categories, not just exempt ones.

**D-4: Price exemption is per-card based on PRIMARY category (`cp.category`), not the `categories` array.** A card with `category = 'nature_views'` is exempt. A card with `category = 'casual_eats'` that also has `'nature_views'` in its `categories` array is NOT exempt — it's a restaurant that happens to have nature as a secondary tag.

---

## 5. Database Layer

### File: `supabase/migrations/[timestamp]_price_exempt_categories.sql`

Single `CREATE OR REPLACE FUNCTION public.query_pool_cards(...)` that replaces the current
definition from `20260412400003_phase6_dead_code_cleanup.sql`.

**Signature:** Unchanged. No new parameters needed.

**New variable in DECLARE block:**
```sql
v_price_exempt TEXT[] := ARRAY['nature_views', 'picnic_park', 'watch', 'creative_arts', 'live_performance'];
-- Price-exempt categories: price tier filtering is skipped for cards whose PRIMARY
-- category (cp.category) is in this list. These categories contain places where
-- price is structurally irrelevant (free parks, ticket-based venues, etc.).
-- Must stay in sync with PRICE_EXEMPT_CATEGORIES in app-mobile/src/constants/priceTiers.ts
```

**Modified price filter clause (appears TWICE — in the count query AND the filtered CTE):**

Current (lines 129-133 and line 190):
```sql
AND (
  v_any_tier
  OR (v_use_tiers AND cp.price_tier = ANY(p_price_tiers))
  OR (NOT v_use_tiers AND cp.price_min <= p_budget_max)
)
```

New:
```sql
AND (
  v_any_tier
  OR cp.category = ANY(v_price_exempt)
  OR cp.price_tier IS NULL
  OR (v_use_tiers AND cp.price_tier = ANY(p_price_tiers))
  OR (NOT v_use_tiers AND cp.price_min <= p_budget_max)
)
```

**Logic breakdown:**
1. `v_any_tier` — user selected "Any" tier → no filtering (unchanged)
2. `cp.category = ANY(v_price_exempt)` — card's primary category is exempt → skip price filter (NEW)
3. `cp.price_tier IS NULL` — card has no price data → always include (NEW — fixes CF-1 NULL bug)
4. `v_use_tiers AND cp.price_tier = ANY(p_price_tiers)` — normal tier match (unchanged)
5. `NOT v_use_tiers AND cp.price_min <= p_budget_max` — fallback budget match (unchanged)

**CRITICAL:** This clause appears in TWO places in the function:
- The `SELECT COUNT(*)` query (count block, ~line 129)
- The `filtered` CTE (main query, ~line 190)

Both MUST be updated identically. If they diverge, `total_unseen` will not match the actual returned cards.

**Everything else in the function remains unchanged.** No changes to:
- Category normalization
- Bounding box / haversine filter
- Type exclusions
- AI approval gate
- Dedup / ranking / enrichment / per_category_cap

---

## 6. Client Constant

### File: `app-mobile/src/constants/priceTiers.ts`

Add at the end of the file, after the existing exports:

```typescript
/**
 * Categories where price tier filtering is structurally irrelevant.
 * Cards in these categories bypass price tier filtering in the SQL RPC.
 *
 * These are client-side category IDs (matching PreferencesSheet).
 * The SQL RPC uses equivalent slugs: nature_views, picnic_park, watch, creative_arts, live_performance.
 * Must stay in sync with v_price_exempt in query_pool_cards RPC.
 */
export const PRICE_EXEMPT_CATEGORIES: readonly string[] = [
  'nature',
  'picnic_park',
  'watch',
  'creative_arts',
  'live_performance',
] as const;
```

---

## 7. Component Layer

### File: `app-mobile/src/components/PreferencesSheet.tsx`

**Change 1: Import the constant**

Add to the existing import from `'../constants/priceTiers'` (line 56):

```typescript
import { PRICE_TIERS, TIER_BY_SLUG, PriceTierSlug, PRICE_EXEMPT_CATEGORIES } from '../constants/priceTiers';
```

**Change 2: Replace the hardcoded nature-only check (line 983)**

Current:
```tsx
{!(selectedCategories.length === 1 && selectedCategories[0] === "nature") && (
```

New:
```tsx
{!(selectedCategories.length > 0 && selectedCategories.every(cat => PRICE_EXEMPT_CATEGORIES.includes(cat))) && (
```

Logic: hide the price section when ALL selected categories are price-exempt. Show it when:
- No categories selected (safe default — user hasn't chosen yet)
- At least one price-relevant category is selected

**Change 3: Fix `isFormComplete` to handle hidden price section (line 676-691)**

Current:
```typescript
const hasBudget = selectedPriceTiers.length > 0;
```

New:
```typescript
const allExempt = selectedCategories.length > 0
  && selectedCategories.every(cat => PRICE_EXEMPT_CATEGORIES.includes(cat));
const hasBudget = allExempt || selectedPriceTiers.length > 0;
```

When all categories are price-exempt, budget is not required for form completion. The price
tiers in state are preserved (not cleared) but not blocking the save button.

**No other changes needed.** The `handleSave` function (line 781+) already persists
`selectedPriceTiers` as-is. When the section is hidden, the previously-saved tiers remain
in state and get persisted — they're just not visible or applied by the SQL RPC.

---

## 8. Success Criteria

### Part 1 — SQL

| SC | Criterion | Verification |
|----|-----------|-------------|
| SC-1 | `query_pool_cards(['Nature & Views'], ['comfy','bougie'])` returns same count as with empty tiers | Run both queries, compare counts |
| SC-2 | `query_pool_cards(['Casual Eats'], ['comfy','bougie'])` returns same count as before migration | Run query before and after migration |
| SC-3 | `query_pool_cards(['Nature & Views','Drink'], ['comfy','bougie'])` returns nature cards unfiltered AND drink cards filtered by tier | Inspect `card->>'category'` distribution in results |
| SC-4 | Cards with `price_tier = NULL` in any category are included regardless of tier selection | Query for NULL-tier cards with restrictive tier filter |
| SC-5 | `total_unseen` count matches the new inclusive logic (not the old count) | Compare `total_unseen` from result with manual COUNT |
| SC-6 | No regression: `query_pool_cards(['Fine Dining'], ['bougie','lavish'])` returns same count as before | Run before and after |

### Part 2 — UI

| SC | Criterion | Verification |
|----|-----------|-------------|
| SC-7 | Only `nature` selected → price section hidden | Visual inspection |
| SC-8 | `nature` + `watch` selected → price section hidden | Visual inspection |
| SC-9 | `nature` + `casual_eats` selected → price section visible | Visual inspection |
| SC-10 | No categories selected → price section visible | Visual inspection |
| SC-11 | Toggle from nature-only to nature+drink → price section appears with previous tiers | Visual + verify state preserved |
| SC-12 | Save with only nature selected → preferences save successfully, previously-saved price tiers preserved in DB | Check DB after save |
| SC-13 | `isFormComplete` returns true when only exempt categories selected and no price tiers visible | Verify save button enabled |

---

## 9. Invariants

| ID | Invariant | Enforced By |
|----|-----------|-------------|
| INV-421-1 | Price-exempt categories return the same card count regardless of `p_price_tiers` | SQL RPC `v_price_exempt` check |
| INV-421-2 | NULL `price_tier` never causes silent card exclusion | SQL RPC `cp.price_tier IS NULL` clause |
| INV-421-3 | `v_price_exempt` in SQL and `PRICE_EXEMPT_CATEGORIES` in client must list the same 5 categories | Comment cross-references in both files |
| INV-421-4 | Price filter clause in count query and filtered CTE must be identical | Both updated in same migration |

---

## 10. Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Nature only, comfy+bougie | `['Nature & Views'], ['comfy','bougie']` | Same count as empty tiers (200 capped) | SQL |
| T-02 | Casual Eats only, comfy+bougie | `['Casual Eats'], ['comfy','bougie']` | Same count as before migration | SQL |
| T-03 | Nature + Drink, comfy+bougie | `['Nature & Views','Drink'], ['comfy','bougie']` | Nature unfiltered, Drink filtered | SQL |
| T-04 | All 12 categories, comfy+bougie | All non-hidden categories | 5 exempt categories unfiltered, 7 filtered | SQL |
| T-05 | NULL price_tier, comfy+bougie | Any category with NULL-tier cards | NULL cards included | SQL |
| T-06 | Fine Dining, chill only | `['Fine Dining'], ['chill']` | No regression — chill fine_dining cards returned | SQL |
| T-07 | Nature only, no price tiers | `['Nature & Views'], []` | Same as before (empty tiers = budget fallback) | SQL |
| T-08 | UI: only nature selected | Select nature pill | Price tier section hidden | Component |
| T-09 | UI: nature + casual_eats | Select both pills | Price tier section visible | Component |
| T-10 | UI: nature → nature+drink toggle | Add drink pill | Price section appears, previous tiers shown | Component |
| T-11 | UI: no categories | Deselect all | Price tier section visible | Component |
| T-12 | UI: save with exempt-only | Save with nature only | Save succeeds, price_tiers preserved in DB | Full stack |
| T-13 | UI: all 5 exempt selected | Select nature+picnic+watch+creative+live | Price tier section hidden | Component |

---

## 11. Implementation Order

1. **`app-mobile/src/constants/priceTiers.ts`** — add `PRICE_EXEMPT_CATEGORIES` export
2. **`supabase/migrations/[timestamp]_price_exempt_categories.sql`** — new migration with updated `query_pool_cards`
3. **`app-mobile/src/components/PreferencesSheet.tsx`** — three changes:
   - Import `PRICE_EXEMPT_CATEGORIES`
   - Replace line 983 hardcoded check with `PRICE_EXEMPT_CATEGORIES.includes()` logic
   - Fix `isFormComplete` to treat all-exempt as budget-not-required

---

## 12. Regression Prevention

- **Structural safeguard:** The exempt list is a named constant in both SQL and client, not an inline condition. Adding a new exempt category requires updating both lists — the cross-referencing comments make this explicit.
- **Test requirement:** After migration, run `query_pool_cards` for each of the 5 exempt categories with restrictive tiers and verify card count matches unrestricted count.
- **Protective comment:** Both `v_price_exempt` in SQL and `PRICE_EXEMPT_CATEGORIES` in client include comments explaining WHY these categories are exempt and pointing to the other location for sync.

---

## 13. Deploy Notes

- The SQL migration must be applied FIRST (via Supabase dashboard or `supabase db push`)
- THEN publish the mobile OTA update (`eas update --branch production --platform ios,android`)
- Order matters: if the OTA deploys before the migration, the old SQL RPC still applies price filtering. Users won't see improvement until the migration runs. No breakage in either order — just delayed benefit.
