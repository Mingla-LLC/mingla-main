# Bugfix: No Cards Showing + Generate Another 20 / Review Batch Broken
**Date:** 2026-03-01
**Status:** Planned
**Severity:** Critical — app is non-functional
**Requested by:** User reports no cards, broken buttons

## Summary
After the Category System v2 overhaul (2026-02-28), three critical issues make the swipe deck unusable:
1. Cards may not load because fallback default preferences use OLD category names (`"Sip & Chill"`, `"Stroll"`) that aren't recognized by the v2 system
2. "Generate Another 20" button does NOT trigger a new API call — it just resets the card index (same behavior as Review Batch)
3. "Review Batch" shows "Batch complete!" immediately when no cards exist

## Root Cause Analysis

### Issue 1: OLD Category Defaults in 5 Files
When `useUserPreferences` returns `null` (user never saved prefs, or query fails), these files provide fallback defaults with the OLD category names:

| File | Line | Old Value |
|------|------|-----------|
| `app-mobile/src/hooks/useRecommendationsQuery.ts` | 27 | `["Sip & Chill", "Stroll"]` |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | 211 | `["Sip & Chill", "Stroll"]` |
| `app-mobile/src/components/SwipeableCards.tsx` | 86 | `["Sip & Chill", "Stroll"]` |
| `app-mobile/src/services/experiencesService.ts` | 278 | `['Stroll', 'Sip & Chill']` |
| `app-mobile/src/services/preferencesService.ts` | 144 | `["Stroll", "Sip & Chill"]` |

**Why this breaks things:** The edge functions (`new-generate-experience-`, `generate-experiences`, `generate-session-experiences`) DO have backwards-compatible CATEGORY_MAPPINGS for old names. However, `"Stroll"` is not a v2 category and may cause downstream scoring/filtering issues. More importantly, if the user HAS saved v2 categories but gets a stale cache or error, the fallback kicks in with the wrong format.

**Correct v2 default:** `['Nature', 'Casual Eats', 'Drink']` (matches DB migration `20260228000001`)

### Issue 2: "Generate Another 20" Can't Work
**File:** `app-mobile/src/hooks/useRecommendationsQuery.ts`, lines 178-180

```typescript
// Note: batchSeed intentionally excluded — regular recommendations don't
// use it on the backend.  Re-fetching them wastes time; only curated cards
// change per batch.
```

`batchSeed` is excluded from the React Query key. When the button calls `generateNextBatch()` (which increments `batchSeed`), React Query sees no key change and returns the cached 1-hour stale data. The user sees the exact same cards.

The button at `SwipeableCards.tsx:1101-1104` calls:
```typescript
onPress={() => {
  generateNextBatch();      // increments batchSeed (no effect on regular cards)
  handleViewCardsAgain();   // resets card index to 0
}}
```

### Issue 3: "Review Batch" Shows Empty Immediately
When no cards loaded in the first place (Issue 1), `handleViewCardsAgain()` resets `removedCards` to empty and `currentCardIndex` to 0, but `availableRecommendations` is still `[]`. The component immediately renders "Batch complete!" again.

### Additional Issues (Medium Priority)

**Issue 4:** `schema.sql` line 31 still has `ARRAY['Stroll', 'Sip & Chill']` as the default. If the schema is ever applied fresh (new environment), it creates wrong defaults.

**Issue 5:** `experienceGenerationService.ts` `getCategoryIcon()` (lines 732-788) uses OLD category keywords. New v2 categories like `nature`, `first_meet`, `drink`, `watch`, `wellness` fall through to generic `"location"` icon.

**Issue 6:** `experiencesService.ts` `calculateCategoryScore()` (lines 476-503) uses OLD `categoryRelations` map. V2 categories get score `0.0`.

**Issue 7:** `curatedRecommendations` in `RecommendationsContext.tsx` line 442 creates a new array reference every render (via `shuffleArray`), causing the sync `useEffect` at line 456 to run every render even when nothing changed.

**Issue 8:** `holiday-experiences/index.ts` still uses entirely OLD category system (`Dining Experiences`, `Sip & Chill`, `Stroll`, `Screen & Relax`, etc.)

## Architecture Impact
- **Modified files:** 7 critical files (see Fix Plan below)
- **New files:** none
- **DB changes:** Update `schema.sql` base defaults
- **Edge functions:** No changes needed for critical fix (CATEGORY_MAPPINGS already has backwards compat)

## Fix Plan

### Critical Fixes (must do — restores functionality)

**Fix 1: Update all default category arrays to v2 format**

In ALL 5 files listed in Issue 1, change the `categories` default from:
```typescript
categories: ["Sip & Chill", "Stroll"],
// or
categories: ['Stroll', 'Sip & Chill'],
```
To:
```typescript
categories: ['Nature', 'Casual Eats', 'Drink'],
```

**Fix 2: Make "Generate Another 20" actually generate new cards**

In `useRecommendationsQuery.ts`, add `batchSeed` to the query key:
```typescript
const queryKey = [
  "recommendations",
  userId,
  currentMode,
  // ... existing params ...
  boardPreferences?.group_size,
  params.batchSeed,  // ADD THIS — triggers new fetch on "Generate Another 20"
];
```

**Fix 3: Update `schema.sql` base defaults**

Change line 31 from:
```sql
categories text[] DEFAULT ARRAY['Stroll', 'Sip & Chill'],
```
To:
```sql
categories text[] DEFAULT ARRAY['Nature', 'Casual Eats', 'Drink'],
```

### Medium Priority Fixes (recommended — improves quality)

**Fix 4: Update `getCategoryIcon()` in `experienceGenerationService.ts`**

Add v2 category keywords to the icon mapping so cards show proper icons.

**Fix 5: Update `calculateCategoryScore()` in `experiencesService.ts`**

Add v2 categories to the `categoryRelations` map so scoring works.

**Fix 6: Stabilize `curatedRecommendations` with useMemo**

Wrap the `shuffleArray(allCuratedCards).map(curatedToRecommendation)` call in `useMemo` keyed on the curated card IDs.

## Test Cases
1. **Fresh user, no saved preferences:** App loads with v2 defaults (`Nature`, `Casual Eats`, `Drink`), cards appear in swipe deck
2. **User who previously saved v2 preferences:** Cards load normally using their saved categories
3. **"Generate Another 20" button:** Pressing it triggers a NEW API call, returns different cards
4. **"Review Batch" button:** Pressing it resets to card 0 and shows the same batch again
5. **"Review Batch" when no cards loaded:** Shows appropriate error/retry state, not instant "Batch complete!"

## Success Criteria
- [ ] Cards appear in the swipe deck for both fresh and existing users
- [ ] "Generate Another 20" fetches genuinely new recommendations
- [ ] "Review Batch" shows the previous batch from index 0
- [ ] No OLD category names remain in any default/fallback path
- [ ] `schema.sql` matches the live DB migration defaults
