# Feature: Curated Experiences End-to-End Fix
**Date:** 2026-02-28
**Status:** Planned
**Requested by:** User navigates to explore page, selects "Solo Adventure" in PreferencesSheet, hits Apply — but sees "You're all caught up!" instead of curated experience cards.

---

## Summary

Three stacked bugs prevent curated experience cards from ever reaching the swipe deck. The most critical is that `PreferencesSheet.tsx` saves only the selected *categories* (e.g. "Nature", "Drink") to the database/React Query cache, silently dropping the selected *intents* (e.g. "solo-adventure"). `RecommendationsContext.tsx` reads both from the same `categories` array and uses intents to enable the `useCuratedExperiences` hooks — so they are permanently disabled. Even if that were fixed, a secondary gate in the sync `useEffect` blocks curated cards from appearing when regular recommendations return 0 results. A third issue is that `interleaveCards()` only appends curated after every 3rd regular card, so if regular cards are sparse, very few curated cards surface.

---

## User Story

As a solo user, I want to select "Solo Adventure" in my preferences and hit Apply so that I immediately see a deck of curated 3-stop day plans sourced from Google Places that match my location and budget.

---

## Architecture Impact

- **New files:** none
- **Modified files:**
  - `app-mobile/src/components/PreferencesSheet.tsx` — save intents with categories
  - `app-mobile/src/contexts/RecommendationsContext.tsx` — fix secondary gate + interleave strategy
  - `app-mobile/src/services/curatedExperiencesService.ts` — fix TypeScript type annotation (minor)
- **New DB tables/columns:** none
- **New edge functions:** none (edge function is correct)
- **External APIs:** none new

---

## Root Cause Analysis

### Bug 1 — CRITICAL: Intents dropped on save (PreferencesSheet.tsx)

**Location:** `app-mobile/src/components/PreferencesSheet.tsx` lines 795–825

The `handleApplyPreferences` function builds two objects that are persisted: `nextUserPreferences` (written to React Query cache) and `dbPrefs` (written to Supabase). Both set:

```typescript
categories: selectedCategories   // ← only categories, intents missing!
```

`selectedIntents` (which holds `['solo-adventure']` etc.) is **never included**.

`RecommendationsContext.tsx` (line 288) reads intents back out via:

```typescript
const experienceTypes = (userPrefs?.categories ?? []).filter(c => INTENT_IDS.has(c));
```

This filter always returns `[]` because intents are never saved, so every `useCuratedExperiences` call has `enabled: false`.

**Fix:** Include `selectedIntents` in the saved categories array (matching the LOAD path that correctly separates them on read):

```typescript
// Both locations:
categories: [...selectedIntents, ...selectedCategories]
```

---

### Bug 2 — SECONDARY: Curated cards gated on non-zero regular recommendations

**Location:** `app-mobile/src/contexts/RecommendationsContext.tsx` line 371

```typescript
if (recommendationsData.length > 0) {
  setRecommendations(interleaveCards(recommendationsData, curatedRecommendations));
}
```

If `recommendationsData` returns `0` results (e.g. no regular recommendations match the user's preferences at that moment), this `if` is never entered, and `setRecommendations` is never called with the curated cards either. The user sees the "all caught up" empty state even if curated cards were fetched successfully.

**Fix:** Always call `setRecommendations` when either array is non-empty:

```typescript
if (recommendationsData.length > 0 || curatedRecommendations.length > 0) {
  setRecommendations(interleaveCards(recommendationsData, curatedRecommendations));
}
```

---

### Bug 3 — TERTIARY: interleaveCards inserts 0 curated cards when regular < 3

**Location:** `app-mobile/src/contexts/RecommendationsContext.tsx` lines 111–125

Current logic inserts 1 curated card after every 3rd regular card. If there are 0–2 regular cards, no curated cards ever appear. If there are exactly 6 regular cards, only 2 curated show.

The user expects up to 20 curated cards. Curated cards should be the primary content when "solo adventure" is selected, not a sparse sprinkle.

**Fix (two-part):**

1. Append any remaining curated cards after the regular cards run out (so they all surface):

```typescript
function interleaveCards(regular: Recommendation[], curated: Recommendation[]): Recommendation[] {
  if (curated.length === 0) return regular;
  if (regular.length === 0) return curated;          // ← new: curated-only mode
  const result: Recommendation[] = [];
  let curatedIdx = 0;
  regular.forEach((card, idx) => {
    result.push(card);
    if ((idx + 1) % 3 === 0 && curatedIdx < curated.length) {
      result.push(curated[curatedIdx++]);
    }
  });
  // Append remaining curated cards after regular deck ends    ← new
  while (curatedIdx < curated.length) {
    result.push(curated[curatedIdx++]);
  }
  return result;
}
```

---

### Bug 4 — MINOR: TypeScript type annotation in curatedExperiencesService.ts

**Location:** `app-mobile/src/services/curatedExperiencesService.ts` line 5

```typescript
experienceType: 'solo_adventure';   // ← underscore — wrong type annotation
```

Should be `'solo-adventure' | 'first-dates' | 'romantic' | 'friendly' | 'group-fun'` to match `CuratedExperienceType` in the hook. This doesn't affect runtime (the hook passes the correct hyphenated strings anyway), but it weakens TypeScript safety.

---

## Database Changes

None required.

---

## Edge Function Spec

No changes to `generate-curated-experiences`. The edge function is correct:
- `PAIRINGS_BY_TYPE` keys use hyphens: `'solo-adventure'`, `'first-dates'`, etc.
- Falls back to `SOLO_ADVENTURE_PAIRINGS` if key not found (line 440)
- Returns up to `limit` (default 15) resolved cards

---

## Mobile Implementation

### Modified Components

#### `app-mobile/src/components/PreferencesSheet.tsx`

**Change 1 — line 800** (solo mode save, inside `nextUserPreferences`):
```typescript
// BEFORE:
categories: selectedCategories,

// AFTER:
categories: [...selectedIntents, ...selectedCategories],
```

**Change 2 — line 825** (collaboration mode save, inside `dbPrefs`):
```typescript
// BEFORE:
categories: selectedCategories,

// AFTER:
categories: [...selectedIntents, ...selectedCategories],
```

#### `app-mobile/src/contexts/RecommendationsContext.tsx`

**Change 1 — lines 111–125** (`interleaveCards` function):
```typescript
function interleaveCards(
  regular: Recommendation[],
  curated: Recommendation[]
): Recommendation[] {
  if (curated.length === 0) return regular;
  if (regular.length === 0) return curated;
  const result: Recommendation[] = [];
  let curatedIdx = 0;
  regular.forEach((card, idx) => {
    result.push(card);
    if ((idx + 1) % 3 === 0 && curatedIdx < curated.length) {
      result.push(curated[curatedIdx++]);
    }
  });
  while (curatedIdx < curated.length) {
    result.push(curated[curatedIdx++]);
  }
  return result;
}
```

**Change 2 — line 371** (useEffect sync gate):
```typescript
// BEFORE:
if (recommendationsData.length > 0) {

// AFTER:
if (recommendationsData.length > 0 || curatedRecommendations.length > 0) {
```

### Modified Services

#### `app-mobile/src/services/curatedExperiencesService.ts`

Fix the `experienceType` type annotation:
```typescript
// BEFORE:
experienceType: 'solo_adventure';

// AFTER:
experienceType: 'solo-adventure' | 'first-dates' | 'romantic' | 'friendly' | 'group-fun';
```

---

## RLS Policies

No new policies needed.

---

## Test Cases

1. **Primary fix** — Open PreferencesSheet, select "Solo Adventure" intent, select "Nature" category, hit Apply. Immediately check React Query devtools (or add a `console.log(userPrefs.categories)` in RecommendationsContext): value should be `['solo-adventure', 'nature']`. Previously it would have been `['nature']`.

2. **Curated cards appear** — After step 1, wait 5–10 seconds (edge function fetches Places API). The swipe deck should contain curated experience cards (identifiable by their 3-stop format and `cardType: 'curated'`). At least 1–5 should appear depending on what Google Places finds near your location.

3. **Expand curated card** — Tap a curated card. The expanded modal should render `CuratedPlanView` with 3 stops, travel times, ratings, and images for each stop.

4. **Regular + curated interleaved** — If the user also has non-solo-adventure categories selected, regular recommendation cards should be interspersed (1 curated after every 3 regular), with all remaining curated cards appended at the end.

5. **Curated-only deck** — Select only "Solo Adventure" with no matching regular categories. The deck should still populate with curated cards even if `recommendationsData` returns 0 regular results.

6. **Collaboration mode** — (Verify existing behavior) In a collaboration session, curated cards are intentionally disabled (`isSoloMode = false`). Confirm this remains working or decide to enable for collaboration too.

7. **Preferences reload** — Close and reopen the PreferencesSheet after applying. Previously selected intents (e.g. "Solo Adventure") should still be selected, because they are stored in the `categories` array and correctly separated on load (lines 483–495 of PreferencesSheet already do this).

---

## Success Criteria

- [ ] After selecting "Solo Adventure" and hitting Apply, curated experience cards appear in the swipe deck
- [ ] Expanding a curated card shows the 3-stop plan with real place data from Google Places
- [ ] Swiping left/right on curated cards works without crashing (no Supabase write attempted)
- [ ] Re-opening PreferencesSheet after applying shows the intents still selected (persistence verified)
- [ ] If regular recommendations are 0, curated cards still appear
- [ ] All remaining curated cards appear after the regular deck ends (not capped at regular.length / 3)
