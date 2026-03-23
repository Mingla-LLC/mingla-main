# Implementation Report: Category Slug Mismatch + Paired View (Unified)

**Date:** 2026-03-23
**Spec:** `outputs/FIX_CATEGORY_SLUG_AND_PAIRED_VIEW_SPEC.md`
**Status:** Implemented — ready for testing

---

## 1. What Changed (6 Steps)

### Step 1: Shared slug mapping — `_shared/categoryPlaceTypes.ts`
- Added `DISPLAY_TO_SLUG` (13 entries), `SLUG_TO_DISPLAY` (auto-derived inverse)
- Added `toSlug()` and `toDisplay()` helper functions with safe fallbacks
- *Already implemented in previous pass — verified in place*

### Step 2: discover-experiences edge function — 6 fix points
- Import `toSlug`, `toDisplay`
- Pool query: `.eq('category', toSlug(cat))`
- `findBestForCategory`: `categorySlug = toSlug(category)` in both filters
- `rotationFindBest`: `rotSlug = toSlug(category)`
- `poolRowToApiCard`: `category: toDisplay(card.category)`
- Cache-hit hero: dual comparison `(c.category === heroCat || c.category === toSlug(heroCat))`
- *Already implemented in previous pass — verified in place*

### Step 3: SQL migration — `20260323000004_fix_person_hero_cards_slug_and_dedup.sql`
- `CREATE OR REPLACE FUNCTION query_person_hero_cards` with:
  - New `p_exclude_card_ids UUID[] DEFAULT '{}'` parameter
  - `v_slug_categories TEXT[]` with CASE/WHEN normalization (matches `query_pool_cards` pattern)
  - All 3x `cp.category = ANY(p_categories)` → `cp.category = ANY(v_slug_categories)`
  - All 5x card_pool queries now include `AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))`

### Step 4: Edge function — `get-person-hero-cards/index.ts`
- Added `excludeCardIds?: string[]` to `RequestBody` interface
- Destructured from request body
- Passed as `p_exclude_card_ids` to RPC call

### Step 5: Client — cache, dedup, retry
- `usePairedCards.ts`: `staleTime: Infinity`, added `excludeCardIds` to params + queryFn
- `usePersonHeroCards.ts`: `staleTime: Infinity`
- `personHeroCardsService.ts`: added `excludeCardIds` to params + POST body
- `experienceGenerationService.ts`: retry only on auth errors (already done in previous pass)
- `DiscoverScreen.tsx`: fetch mutex (already done), pass `travelMode` to PersonHolidayView

### Step 6: Travel time on paired view cards
- **NEW FILE** `utils/travelTime.ts`: `computeTravelInfo()` with haversine + speed-by-mode
- `PersonHolidayView.tsx`:
  - Added `travelMode` prop, threaded through all section components to CardRow
  - CardRow computes travel info on card press via `computeTravelInfo`
  - Added `travelTime`, `distance`, `travelMode` to onCardPress payload
  - Passes `excludeCardIds` (from `seenCardIds.current`) to `usePairedCards`
- `DiscoverScreen.tsx`:
  - Passes `travelMode={userTravelMode}` to PersonHolidayView
  - `handlePersonCardPress` accepts + threads `travelTime`, `distance`, `travelMode`
  - ExpandedCardData uses travel data from card press payload

---

## 2. Files Inventory

| Action | File |
|--------|------|
| Modified (prev pass) | `supabase/functions/_shared/categoryPlaceTypes.ts` |
| Modified (prev pass) | `supabase/functions/discover-experiences/index.ts` |
| Created | `supabase/migrations/20260323000004_fix_person_hero_cards_slug_and_dedup.sql` |
| Modified | `supabase/functions/get-person-hero-cards/index.ts` |
| Modified | `app-mobile/src/hooks/usePairedCards.ts` |
| Modified | `app-mobile/src/hooks/usePersonHeroCards.ts` |
| Modified | `app-mobile/src/services/personHeroCardsService.ts` |
| Modified (prev pass) | `app-mobile/src/services/experienceGenerationService.ts` |
| Modified | `app-mobile/src/components/DiscoverScreen.tsx` |
| Modified | `app-mobile/src/components/PersonHolidayView.tsx` |
| Created | `app-mobile/src/utils/travelTime.ts` |
| Modified | `README.md` |

---

## 3. Spec Compliance

| Spec Section | Requirement | Status |
|-------------|-------------|--------|
| Change 1 | DISPLAY_TO_SLUG + toSlug/toDisplay | ✅ |
| Change 2 | 6 slug comparison fixes in discover-experiences | ✅ |
| Change 3 | SQL slug normalization + dedup param | ✅ |
| Change 4 | excludeCardIds wired in edge function | ✅ |
| Change 5 | staleTime: Infinity on both hooks | ✅ |
| Change 5 | excludeCardIds threaded through service | ✅ |
| Change 5 | Retry only on auth errors | ✅ |
| Change 5 | Fetch mutex | ✅ |
| Change 6 | travelTime.ts utility | ✅ |
| Change 6 | Travel time computed on card press | ✅ |
| Change 6 | travelMode threaded from DiscoverScreen → PersonHolidayView → CardRow | ✅ |
| Change 6 | excludeCardIds from seenCardIds → usePairedCards | ✅ |
| Scope | No discover-cards/cardPoolService/schema/seeding changes | ✅ |

---

## 4. Deviations from Spec

None.

---

## 5. Verification Checklist

- **For You:** 2 hero + ~10 grid cards with display names and correct icons
- **Paired View:** 6 cards per section (3 curated + 3 single), no repeats across sections
- **Cache:** Cards persist until shuffle, no 30-min auto-refresh
- **Travel Time:** Expanded paired cards show "X min" distance
- **Retry:** No wasted token refresh on legitimately empty pools
- **Dedup:** Server-side excludeCardIds passed, client-side seenCardIds fed through

---

## 6. Handoff to Tester

11 files, 6 steps — all matching spec exactly. Key areas to test:
1. SQL function slug normalization (try display names AND slugs as input)
2. Card dedup across holiday sections (no ID repeats)
3. staleTime: Infinity (cards don't refresh after 30 min)
4. Travel time computation on paired view expanded cards
5. For You still works (regression check on previous fix)
