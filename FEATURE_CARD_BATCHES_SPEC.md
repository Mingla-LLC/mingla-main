# Feature: Card Batch System — 20 Cards Per Batch with Review/Refresh
**Date:** 2026-02-28
**Status:** Planned
**Requested by:** When selecting Solo Adventure (or any category), show up to 20 cards. After exhausting all 20, offer two actions: "Review Previous Batch" (see the same 20 again) or "Generate Another 20" (fresh 20 different cards, same preferences). Also fixes a bug where selecting only an intent (e.g. Solo Adventure) with no category slugs results in zero cards showing.

---

## Summary

Two related problems are fixed/built here:

**Bug:** When a user selects only the "Solo Adventure" intent in PreferencesSheet (no category slugs like Nature, Drink, etc.), the `ExperienceGenerationService` strips the intent IDs before sending categories to the edge function, leaving an empty array. The edge function returns zero regular cards and may set a `no_matches` error. The `RecommendationsContext` then skips setting state entirely because `recommendationsData` is `undefined` (TanStack Query's behaviour on error). Even though curated cards exist, they never get surfaced. The fix is one targeted change to the effect guard in `RecommendationsContext`.

**Feature:** The swipe deck should be capped at 20 visible cards per batch. When the batch is exhausted (all 20 swiped or removed), a "Batch Complete" screen offers two buttons: "Review Previous Batch" (existing reset-to-zero behaviour) or "Generate Another 20" (force a fresh fetch with the same preferences). The new 20 are guaranteed to differ because both edge functions shuffle before returning results and the query key changes.

---

## User Story

As a user who has selected Solo Adventure, I want to see up to 20 cards at a time. When I've gone through all of them, I want the option to see those same cards again or get a fresh set — without having to change my preferences.

---

## Architecture Impact

- **New files:** None.
- **Modified files:**
  - `app-mobile/src/contexts/RecommendationsContext.tsx` — fix the `recommendationsData` guard; add `batchSeed` state; expose `generateNextBatch()`; cap visible recommendations to 20
  - `app-mobile/src/components/SwipeableCards.tsx` — replace "all caught up" screen with "Batch Complete" screen; wire up the two batch action buttons

- **New DB tables/columns:** None.
- **New edge functions:** None.
- **External APIs:** None new.

---

## Bug Fix Spec

### Problem (RecommendationsContext.tsx — the `recommendationsData` guard)

Current code (around line 428):
```typescript
useEffect(() => {
  if (!recommendationsData) {
    return; // blocks curated cards when regular fetch errors
  }
  ...
  if (recommendationsData.length > 0 || curatedRecommendations.length > 0) {
    setRecommendations(interleaveCards(recommendationsData, curatedRecommendations));
  }
}, [recommendationsData, curatedRecommendations, ...]);
```

When the regular fetch errors (e.g. empty categories → no_matches), TanStack Query keeps `data: undefined`, so `!recommendationsData` is `true` and the effect returns early. Curated cards — which ARE available — never reach `setRecommendations`.

### Fix

Replace:
```typescript
if (!recommendationsData) {
  return;
}
```
With:
```typescript
if (!recommendationsData && curatedRecommendations.length === 0) {
  return;
}
const regularCards = recommendationsData ?? [];
```

Then replace every subsequent reference to `recommendationsData` inside this effect with `regularCards`.

This means: if regular fetch errors but curated cards exist, fall through and surface the curated cards alone.

---

## Batch System Spec

### 1. `RecommendationsContext.tsx` — new state + exposed values

Add inside the context:

```typescript
// Batch seed — incrementing forces a fresh query fetch
const [batchSeed, setBatchSeed] = useState(0);

// generateNextBatch: called when user wants fresh 20 cards
const generateNextBatch = useCallback(() => {
  setBatchSeed(prev => prev + 1);
}, []);
```

Expose `generateNextBatch` and `batchSeed` via the context value object.

Add `batchSeed` to the query keys:
- `useRecommendationsQuery` already uses `userPreferences?.categories` as part of its query key — pass `batchSeed` as an additional param (add it to the `queryKey` array inside `useRecommendationsQuery`)
- Each `useCuratedExperiences` call — pass `batchSeed` into `queryKey` in `useCuratedExperiences.ts`

When `batchSeed` increments, both query keys change → React Query treats them as new queries → fresh fetches happen immediately, bypassing the staleTime cache.

**Important:** Also pass `batchSeed` as a dependency to the `useRecommendationsQuery` `enabled` condition (via its params) and to `useCuratedExperiences` hook's `queryKey`. No DB call needed — this is purely in-memory query key manipulation.

**Cap visible recommendations at 20:**

In the effect where `setRecommendations` is called:
```typescript
const allCards = interleaveCards(regularCards, curatedRecommendations);
setRecommendations(allCards.slice(0, 20)); // Show max 20 per batch
```

This means the deck always has at most 20 cards. When the user exhausts them, the "Batch Complete" screen fires.

### 2. `useRecommendationsQuery.ts` — add `batchSeed` to query key

In the `queryKey` array, append:
```typescript
params.batchSeed ?? 0,
```

Add `batchSeed?: number` to the `FetchRecommendationsParams` interface.

### 3. `useCuratedExperiences.ts` — add `batchSeed` to query key

In the `queryKey` array, append:
```typescript
params.batchSeed ?? 0,
```

Add `batchSeed?: number` to `UseCuratedExperiencesParams`.

### 4. `RecommendationsContext.tsx` — pass `batchSeed` down

Pass `batchSeed` from the context into all 6 hook calls:
```typescript
// In useRecommendationsQuery call:
batchSeed,

// In each useCuratedExperiences call:
batchSeed,
```

### 5. `SwipeableCards.tsx` — replace "all caught up" with "Batch Complete"

The current "all caught up" condition (line ~1080):
```typescript
if (
  hasCompletedInitialFetch &&
  availableRecommendations.length === 0 &&
  !loading &&
  !isModeTransitioning &&
  !isWaitingForSessionResolution
) {
  // Old: "You're all caught up!" with "view cards again" + "update preferences"
}
```

Replace the JSX content with a "Batch Complete" screen:

```tsx
return (
  <View style={styles.noCardsContainer}>
    <View style={styles.noCardsContent}>
      <View style={styles.sparklesContainer}>
        <Ionicons name="checkmark-circle-outline" size={48} color="#eb7825" />
      </View>
      <Text style={styles.noCardsTitle}>Batch complete!</Text>
      <Text style={styles.noCardsSubtitle}>
        You've seen all 20 cards in this batch.
      </Text>

      {/* Primary: Generate fresh 20 */}
      <TouchableOpacity
        style={styles.generateNextButton}
        onPress={() => {
          generateNextBatch();           // increments batchSeed → new fetch
          handleViewCardsAgain();        // resets index/removedCards for the new deck
        }}
        activeOpacity={0.8}
      >
        <Ionicons name="refresh-outline" size={18} color="#ffffff" />
        <Text style={styles.generateNextButtonText}>Generate Another 20</Text>
      </TouchableOpacity>

      {/* Secondary: Review same batch */}
      <TouchableOpacity
        style={styles.reviewBatchButton}
        onPress={handleViewCardsAgain}  // just resets index, same cards
        activeOpacity={0.7}
      >
        <Ionicons name="arrow-undo-outline" size={16} color="#eb7825" />
        <Text style={styles.reviewBatchButtonText}>Review Previous Batch</Text>
      </TouchableOpacity>

      {/* Tertiary: Change preferences */}
      <TouchableOpacity
        onPress={handleOpenPreferences}
        activeOpacity={0.7}
        style={styles.changePrefsLink}
      >
        <Text style={styles.changePrefsLinkText}>Change preferences</Text>
      </TouchableOpacity>
    </View>
  </View>
);
```

**New styles to add to SwipeableCards StyleSheet:**
```typescript
generateNextButton: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  backgroundColor: '#eb7825',
  paddingVertical: 14,
  paddingHorizontal: 28,
  borderRadius: 14,
  marginTop: 20,
  width: '100%',
  justifyContent: 'center',
},
generateNextButtonText: {
  color: '#ffffff',
  fontSize: 16,
  fontWeight: '700',
},
reviewBatchButton: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  paddingVertical: 12,
  paddingHorizontal: 20,
  borderRadius: 12,
  borderWidth: 1.5,
  borderColor: '#eb7825',
  marginTop: 10,
  width: '100%',
  justifyContent: 'center',
},
reviewBatchButtonText: {
  color: '#eb7825',
  fontSize: 15,
  fontWeight: '600',
},
changePrefsLink: {
  marginTop: 16,
},
changePrefsLinkText: {
  color: 'rgba(255,255,255,0.4)',
  fontSize: 13,
  textDecorationLine: 'underline',
},
```

Also pull `generateNextBatch` from the context:
```typescript
const { ..., generateNextBatch } = useRecommendations();
```

### 6. Context interface update

Add to the `RecommendationsContextType` (or however the context type is defined):
```typescript
batchSeed: number;
generateNextBatch: () => void;
```

---

## Test Cases

1. **Solo Adventure only (no category slugs):** Select only the Solo Adventure intent, apply preferences. Within the loading period, curated cards should appear (no "no matches" error shown). At least 1–3 curated plan cards visible.

2. **Curated cards surface without regular cards:** If the regular edge function returns 0 cards (empty categories), the deck should still render with curated-only cards rather than showing the "no matches found" error screen.

3. **20-card cap — regular categories:** Select "Nature" + "Drink" categories. The deck should show exactly 20 cards maximum (or however many are available if < 20).

4. **Batch Complete screen fires:** After swiping all 20 cards, the "Batch complete!" screen appears with both action buttons visible.

5. **"Review Previous Batch" works:** Tap "Review Previous Batch" → the same 20 cards reappear from the beginning, swiped state is reset.

6. **"Generate Another 20" fetches new cards:** Tap "Generate Another 20" → loading spinner appears briefly → a new set of 20 cards is rendered. Cards should differ from the previous batch (shuffle ensures this).

7. **Category selection triggers same batch system:** Select "Fine Dining" category only (no intent). Same 20-card deck cap + batch end screen applies.

8. **"Generate Another 20" with Solo Adventure:** Curated cards from the fresh fetch should be different pairings due to shuffle in the edge function.

---

## Success Criteria

- [ ] Selecting Solo Adventure alone shows cards (curated or otherwise) — no more empty "no matches" screen
- [ ] Deck is capped at 20 cards maximum per batch
- [ ] "Batch complete!" screen appears after exhausting all 20
- [ ] "Review Previous Batch" resets the deck to the beginning (same 20 cards)
- [ ] "Generate Another 20" fetches a fresh set and resets the deck
- [ ] Same behaviour for both intent selections (solo-adventure) and category selections (Nature, Drink, etc.)
- [ ] No TypeScript errors
- [ ] No regression in collaboration mode
