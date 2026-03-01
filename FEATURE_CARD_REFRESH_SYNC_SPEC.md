# Feature: Card Refresh Loader Sync & Speed Optimization
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** "The speed at which the swipeable deck loads refreshed cards when preferences change is way too slow. The spinner stops but the refresh keeps going, making the user feel like nothing is happening. Sync the loader with the actual load time and optimize the speed. 3-second max."

## Summary
When a user saves new preferences, the card deck refreshes via 3 parallel data pipelines (recommendations, curated experiences, nature cards). The overlay spinner currently tracks only the recommendations pipeline (`isFetchingRecommendations`), causing it to dismiss 1-3 seconds before curated and nature data arrives. Additionally, the full-screen loader never activates on re-fetches because `placeholderData` keeps `isLoading` false. This fix syncs the loader to the true completion of ALL data sources, removes redundant cache invalidations that waste work, and adds a unified "preference refresh in progress" flag so the UI always reflects actual loading state.

## User Story
As a user, I want the loading indicator to stay visible until ALL my new cards have actually loaded after I change my preferences, so I know when my fresh results are ready (and it happens in under 3 seconds).

---

## Root Cause Analysis (5 bugs)

### Bug 1: `isFetching` Only Tracks Recommendations
**File:** `RecommendationsContext.tsx` line 954
```typescript
const isFetching = isFetchingRecommendations;  // ← ignores curated + nature
```
The context exposes `isFetching` which SwipeableCards uses to dismiss the overlay spinner. But this only reflects the `useRecommendationsQuery` hook — the 5 curated hooks and 1 nature hook are invisible. The overlay hides when recommendations arrive (~500ms), while curated cards are still loading (~1-2s more).

### Bug 2: Full-Screen Loader Never Shows on Re-fetch
**File:** `RecommendationsContext.tsx` line 952
```typescript
const loading = isLoadingLocation || isLoadingPreferences ||
  isLoadingRecommendations || isLoadingCuratedSolo || (isNatureSelected && isLoadingNature);
```
All hooks use `placeholderData: (prev) => prev`. On a preference change, React Query creates new query entries but immediately populates them with placeholder data from the previous query → `status: 'success'` → `isLoading: false`. The full-screen spinner requires `loading` to be true, which it never is after the first load.

### Bug 3: Double Cache Invalidation
**File:** `AppHandlers.tsx` lines 715-716 + `RecommendationsContext.tsx` line 528

AppHandlers fires:
```typescript
queryClient.invalidateQueries({ queryKey: ["recommendations"] });
queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
```

Then the refreshKey increment (line 747) triggers the effect in RecommendationsContext that fires AGAIN:
```typescript
queryClient.invalidateQueries({ queryKey: ['curated-experiences'] });
```

The first invalidation in AppHandlers targets OLD query keys (since params haven't propagated yet). The refreshKey-driven invalidation is the one that matters. The AppHandlers ones are wasted work.

### Bug 4: `allBatchesLoaded` Not Used for Overlay
**File:** `RecommendationsContext.tsx` line 660
```typescript
const allBatchesLoaded = allCuratedBatchesLoaded && (isNatureSelected ? isNatureBatchLoaded : true);
```
This perfectly tracks whether ALL curated + nature data sources have settled. It's used to clear `isBatchTransitioning` (line 807) but NOT exposed to SwipeableCards for the overlay spinner.

### Bug 5: Nature Cards Double-Handled
**File:** `AppHandlers.tsx` line 742
```typescript
queryClient.removeQueries({ queryKey: ['nature-cards'] });
```
This hard-removes nature cache, then the hash-based reset in RecommendationsContext (line 663-669) ALSO detects the change and calls `resetNatureHistory()`. The `removeQueries` is redundant because the query key changes anyway when params change, and `invalidateQueries` via refreshKey handles staleness.

---

## Architecture Impact
- **New files:** None
- **Modified files:** 3
  - `app-mobile/src/contexts/RecommendationsContext.tsx` — add `isRefreshingAfterPrefChange` flag, expose `allBatchesLoaded`, widen `isFetching`
  - `app-mobile/src/components/SwipeableCards.tsx` — sync overlay dismiss to new flag
  - `app-mobile/src/components/AppHandlers.tsx` — remove redundant invalidations
- **New DB tables/columns:** None
- **New edge functions:** None
- **External APIs:** None

---

## Mobile Implementation

### Modified: `RecommendationsContext.tsx`

**Change 1: Add `isRefreshingAfterPrefChange` state**

Add a ref-based flag that:
- Sets to `true` when `refreshKey` changes (the preference-save trigger)
- Sets to `false` when `allBatchesLoaded && !isFetchingRecommendations`

```typescript
// New state
const [isRefreshingAfterPrefChange, setIsRefreshingAfterPrefChange] = useState(false);
```

In the refreshKey detection effect (line 521-531):
```typescript
useEffect(() => {
  if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
    setBatchSeed(0);
    setIsBatchTransitioning(false);
    warmPoolFired.current = false;
    warmNaturePoolFired.current = false;
    setIsRefreshingAfterPrefChange(true);   // ← NEW: signal refresh started
    queryClient.invalidateQueries({ queryKey: ['curated-experiences'] });
  }
  previousRefreshKeyRef.current = refreshKey;
}, [refreshKey, queryClient]);
```

**Change 2: Add clearing effect for `isRefreshingAfterPrefChange`**

New effect that monitors allBatchesLoaded + recommendations fetch state:
```typescript
useEffect(() => {
  if (!isRefreshingAfterPrefChange) return;

  const allSettled = allBatchesLoaded && !isFetchingRecommendations && !isLoadingRecommendations;
  if (allSettled) {
    setIsRefreshingAfterPrefChange(false);
  }
}, [isRefreshingAfterPrefChange, allBatchesLoaded, isFetchingRecommendations, isLoadingRecommendations]);
```

Add a safety timeout (8 seconds max) to prevent infinite spinner if a query hangs:
```typescript
useEffect(() => {
  if (!isRefreshingAfterPrefChange) return;
  const timeout = setTimeout(() => {
    console.warn('[RecommendationsContext] Preference refresh safety timeout — clearing spinner');
    setIsRefreshingAfterPrefChange(false);
  }, 8_000);
  return () => clearTimeout(timeout);
}, [isRefreshingAfterPrefChange]);
```

**Change 3: Widen `isFetching` to cover all pipelines**

Replace:
```typescript
const isFetching = isFetchingRecommendations;
```
With:
```typescript
const isFetching = isFetchingRecommendations || isRefreshingAfterPrefChange;
```

**Change 4: Expose `isRefreshingAfterPrefChange` via context**

Add to the context type interface and the provider value:
```typescript
interface RecommendationsContextType {
  // ... existing fields ...
  isRefreshingAfterPrefChange: boolean;
}
```

### Modified: `SwipeableCards.tsx`

**Change 1: Consume `isRefreshingAfterPrefChange` from context**

Destructure from `useRecommendations()`:
```typescript
const {
  // ... existing ...
  isRefreshingAfterPrefChange,
} = useRecommendations();
```

**Change 2: Sync overlay dismiss to new flag**

Replace the `showNextBatchLoader` dismiss effect (lines 385-401):

OLD:
```typescript
useEffect(() => {
  if (!showNextBatchLoader) return;
  if (!isFetching && !isModeTransitioning && !isWaitingForSessionResolution) {
    const hideTimer = setTimeout(() => setShowNextBatchLoader(false), 220);
    return () => clearTimeout(hideTimer);
  }
}, [showNextBatchLoader, isFetching, isModeTransitioning, isWaitingForSessionResolution]);
```

NEW:
```typescript
useEffect(() => {
  if (!showNextBatchLoader) return;
  if (
    !isFetching &&
    !isRefreshingAfterPrefChange &&
    !isModeTransitioning &&
    !isWaitingForSessionResolution
  ) {
    const hideTimer = setTimeout(() => setShowNextBatchLoader(false), 220);
    return () => clearTimeout(hideTimer);
  }
}, [showNextBatchLoader, isFetching, isRefreshingAfterPrefChange, isModeTransitioning, isWaitingForSessionResolution]);
```

### Modified: `AppHandlers.tsx`

**Change 1: Remove redundant invalidations (lines 715-716)**

Remove these two lines:
```typescript
// REMOVE — refreshKey increment (line 747) already triggers refetch via query key change
// queryClient.invalidateQueries({ queryKey: ["recommendations"] });
// queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
```

Keep the userLocation invalidation (line 717) since location parsing may need re-evaluation:
```typescript
queryClient.invalidateQueries({ queryKey: ["userLocation"] });
```

**Change 2: Remove redundant nature `removeQueries` (line 742)**

Remove:
```typescript
// REMOVE — the nature hash check in RecommendationsContext handles this,
// plus the query key changes automatically when params change
// queryClient.removeQueries({ queryKey: ['nature-cards'] });
```

Keep the hash computation and `resetNatureHistory()` call (lines 720-741) since it resets Zustand batch history.

---

## Expected Timing (After Fix)

| Phase | Duration | What Happens |
|-------|----------|-------------|
| T=0ms | Instant | User taps Save, prefs update optimistically, sheet closes |
| T=0-50ms | Instant | refreshKey increments, `isRefreshingAfterPrefChange` = true |
| T=50ms | Instant | `showNextBatchLoader` overlay appears on current cards |
| T=50-500ms | ~450ms | React Query creates new queries, old data shown as placeholder |
| T=500-2500ms | ~1-2s | Edge functions return (pool-first: ~500ms, API fallback: ~2s) |
| T=2500ms | Instant | `allBatchesLoaded` becomes true, `isRefreshingAfterPrefChange` clears |
| T=2720ms | 220ms | Overlay fades out (220ms delay) |

**Total perceived time: 2-3 seconds** (down from current 5-8 seconds of perceived limbo)

---

## Test Cases

1. **Loader stays visible until all cards load** — Change any preference → save → overlay spinner must remain visible until new cards physically appear in the deck. No gap between spinner stopping and cards appearing.

2. **Loader dismisses within 3 seconds** (warm pool) — With a warm card pool, changing budget from $50 to $100 → overlay should dismiss in under 3 seconds.

3. **Safety timeout at 8 seconds** — Simulate a hanging edge function (e.g., disconnect network after save) → overlay must dismiss after 8 seconds max, showing whatever partial data is available.

4. **No double-fetch on save** — Monitor network tab while saving preferences → each edge function should be called ONCE per preference change, not twice.

5. **Nature category toggle** — Toggle Nature on/off in categories → overlay stays until nature cards load/unload correctly. No stale nature cards shown after deselecting Nature.

6. **Mode transition still works** — Switch from solo to collaboration mode → full-screen loader shows and clears correctly (unrelated to this fix, but regression test).

7. **Batch generation unaffected** — After preference refresh, tap "Generate Another 20" → batch transition spinner works independently from preference refresh spinner.

## Success Criteria
- [ ] Overlay spinner stays visible until ALL data pipelines have settled
- [ ] No gap between spinner dismissal and new card appearance
- [ ] Preference change → cards ready in ≤3 seconds (warm pool)
- [ ] Safety timeout prevents infinite spinner (8s max)
- [ ] No redundant edge function calls on preference save
- [ ] Existing batch-generation and mode-transition loaders unaffected
