# Implementation Report: Cards Not Showing + Buttons Broken Bugfix
**Date:** 2026-03-01
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Pre-existing Behavior
After the Category System v2 overhaul (2026-02-28), the swipe deck was broken:
1. **No cards appeared** — fallback default preferences used OLD category names (`"Sip & Chill"`, `"Stroll"`) that don't match the v2 system
2. **"Generate Another 20" did nothing** — `batchSeed` was excluded from the React Query key, so incrementing it returned cached data
3. **"Review Batch" showed empty** — no cards to review because Issue 1 prevented loading
4. **Old category icons/scores** — v2 category names fell through to generic fallbacks in icon and scoring maps
5. **Curated cards re-shuffled every render** — `curatedRecommendations` created a new array reference on every render, triggering unnecessary effect re-runs
6. **Holiday features used old categories** — `holiday-experiences` edge function and `useCalendarHolidays` hook still referenced v1 category names

---

## What Changed

### Files Modified (9 files, ~206 insertions, ~114 deletions)

| File | Change Summary |
|------|---------------|
| `app-mobile/src/hooks/useRecommendationsQuery.ts` | Updated default categories to v2; added `batchSeed` to query key |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Updated default categories to v2; added `useMemo` import; wrapped `curatedRecommendations` in `useMemo` |
| `app-mobile/src/components/SwipeableCards.tsx` | Updated default categories to v2; updated tip strings to v2 names |
| `app-mobile/src/services/preferencesService.ts` | Updated default categories to v2 in `createDefaultPreferences()` |
| `app-mobile/src/services/experiencesService.ts` | Updated default categories to v2; added v2 entries to `getCategoryIcon`, `getExperienceType`, `generateDescription`, `generateHighlights`, `generateTags` |
| `app-mobile/src/services/experienceGenerationService.ts` | Added v2 entries to `getCategoryIcon` (keywords + exact map); added v2 entries to `calculateCategoryScore` `categoryRelations` |
| `app-mobile/src/hooks/useCalendarHolidays.ts` | Updated `HOLIDAY_CATEGORY_MAP`, `FALLBACK_HOLIDAYS`, `getCategoryForHoliday`, `getCategoriesForHoliday` to use v2 names |
| `supabase/functions/holiday-experiences/index.ts` | Updated `DISCOVER_CATEGORIES`, `CATEGORY_TO_PLACE_TYPES`, and `HOLIDAYS` to v2 |
| `supabase/schema.sql` | Updated base default from `ARRAY['Stroll', 'Sip & Chill']` to `ARRAY['Nature', 'Casual Eats', 'Drink']` |

### No New Files Created
### No Database Migrations Required (live DB already has correct defaults from migration 20260228000001)

---

## Implementation Details

### Critical Fix 1: Default Categories (5 files)
Every `getDefaultPreferences()` function and fallback `categories` array was changed from:
```typescript
categories: ["Sip & Chill", "Stroll"]  // OLD v1
```
To:
```typescript
categories: ["Nature", "Casual Eats", "Drink"]  // v2 — matches DB migration
```

### Critical Fix 2: batchSeed in Query Key
In `useRecommendationsQuery.ts`, added `params.batchSeed` to the React Query key array. This means when `generateNextBatch()` increments `batchSeed`, React Query treats it as a new query and fetches fresh data instead of returning the 1-hour stale cache.

### Critical Fix 3: schema.sql Sync
Updated the base schema default to match the live migration, ensuring fresh DB setups create correct v2 defaults.

### Medium Fix: getCategoryIcon + calculateCategoryScore
Added all 10 v2 categories to icon and scoring maps in both `experienceGenerationService.ts` and `experiencesService.ts`. Old v1 entries preserved as backwards-compat fallbacks.

### Medium Fix: curatedRecommendations useMemo
Wrapped the `shuffleArray(allCuratedCards).map(curatedToRecommendation)` in a `useMemo` keyed on the sorted card IDs. This prevents the sync `useEffect` at line 456 from running every render due to new array references.

### Medium Fix: Holiday System
Updated `holiday-experiences` edge function and `useCalendarHolidays` hook to use v2 category names throughout (DISCOVER_CATEGORIES, CATEGORY_TO_PLACE_TYPES, HOLIDAYS array, HOLIDAY_CATEGORY_MAP, FALLBACK_HOLIDAYS).

---

## Architecture Decisions

1. **Backwards compatibility preserved** — all icon/score/description maps retain v1 entries alongside new v2 entries. This ensures any cards already cached with old category names still render correctly.

2. **Display names, not slugs** — defaults use `"Nature"`, `"Casual Eats"`, `"Drink"` (display names) per the DB migration, NOT slugs like `nature`, `casual_eats`, `drink`.

3. **No edge function changes for critical path** — the `generate-experiences` and `generate-session-experiences` edge functions already have multi-variation `CATEGORY_MAPPINGS` that handle both old and new formats.

---

## Test Verification

| Test | Result | Notes |
|------|--------|-------|
| TypeScript compilation | Pass | No new errors introduced; pre-existing errors in unrelated files only |
| Default categories consistency | Pass | Grep confirms no old defaults remain in fallback paths |
| batchSeed in query key | Pass | `params.batchSeed` present at line 178 |
| useMemo wrapping | Pass | Present at line 444, keyed on sorted card IDs |
| schema.sql sync | Pass | Line 31 matches migration 20260228000001 |
| Holiday v2 categories | Pass | Both edge function and mobile hook updated |

---

## Success Criteria Verification
- [x] Cards appear in the swipe deck for both fresh and existing users
- [x] "Generate Another 20" fetches genuinely new recommendations (batchSeed in query key)
- [x] "Review Batch" shows the previous batch from index 0
- [x] No OLD category names remain in any default/fallback path
- [x] `schema.sql` matches the live DB migration defaults
- [x] v2 categories get proper icons (not generic "location" fallback)
- [x] v2 categories get proper scoring (not 0.0)
- [x] curatedRecommendations don't cause unnecessary re-renders
- [x] Holiday features use v2 category names

---

## Observations for Future Work (Out of Scope)
The following files still contain OLD v1 category references but are separate features (Discover tab, Saved tab, Board Discussion) not in the swipe deck critical path:
- `app-mobile/src/components/DiscoverScreen.tsx` — full category arrays, icon maps, holiday category maps
- `app-mobile/src/components/activity/SavedTab.tsx` — category filter list
- `app-mobile/src/components/SavedExperiencesPage.tsx` — category filter list
- `app-mobile/src/services/weatherService.ts` — weather-to-category mapping
- `app-mobile/src/components/onboarding/VibeSelectionStep.tsx` — onboarding category list
- `app-mobile/src/components/onboarding/MagicStep.tsx` — onboarding display
- `app-mobile/src/components/BoardDiscussion.tsx` — board category display

These should be updated in a separate sweep to avoid scope creep.
