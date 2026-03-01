# Feature: Nature Cards — Reliable, Fast, Intelligent Card Engine

**Date:** 2026-03-01
**Status:** Planned
**Requested by:** User testing Nature category — found bugs in preference matching, freezing, slow refresh, no batch history

---

## Summary

Complete overhaul of the Nature card pipeline to fix 6 confirmed bugs and add batch history with preference-gated caching. The current system accepts `datetimePref` but never filters by it, has no timeout on save (causing freezes), stores only 1 previous batch, bypasses the card pool entirely, and has a slow refresh cycle. This spec redesigns the pipeline around 3 north stars: **efficiency, cost, and speed**.

---

## User Stories

1. **As a user**, I want cards to match my exact date/time, travel mode, and location preferences so I only see relevant nature spots.
2. **As a user**, I want the preferences sheet to save instantly and never freeze, so I can iterate quickly.
3. **As a user**, I want 20 cards per batch, and when I exhaust them, I want a fresh 20 that are different from what I already saw.
4. **As a user**, I want to review ALL batches I've seen since my last preference save — not just the most recent 20.
5. **As a user**, I want all my cards cached until I change preferences, then everything resets cleanly.

---

## Root Cause Analysis — Current Bugs

### Bug 1: Cards don't match date/time preferences
**Root cause:** `discover-nature/index.ts` accepts `datetimePref` parameter but **never uses it**. No opening-hours filtering exists. A user picking "This Weekend, Afternoon" still sees places closed on weekends.

### Bug 2: PreferencesSheet freezes in "Saving" state
**Root cause:** `handleApplyPreferences()` in PreferencesSheet.tsx has sequential `await` calls with no timeout: `updateBoardPreferences()` → `PreferencesService.getUserPreferences()` → `offlineService.cacheUserPreferences()`. Any network stall hangs indefinitely. The `isSaving` flag only resets in the catch block, not a `finally` block.

### Bug 3: Long lag before swipe deck refreshes
**Root cause:** After save, PreferencesSheet waits for DB read-back (`getUserPreferences()`), then offline cache write, then 4+ React Query invalidations run sequentially. Cards don't appear until the full chain completes.

### Bug 4: Can only review last batch, not all batches
**Root cause:** `previousBatchRef` in RecommendationsContext holds exactly 1 batch snapshot. No persistent history exists.

### Bug 5: Nature cards bypass card pool (every request hits Google API)
**Root cause:** `discover-nature/index.ts` does not import `cardPoolService`. Every call makes 8 Google Nearby Search API calls (one per nature type). Cached at the `placesCache` level (24h TTL per type+location), but no user-level impression tracking or pool-first serving.

### Bug 6: No preference-gated cache reset
**Root cause:** React Query cache keys include all params, so changing params naturally fetches new data, but OLD batch history is lost because `previousBatchRef` is a single ref that gets overwritten.

---

## Architecture Impact

### Modified Files (11)
| File | Change |
|------|--------|
| `app-mobile/src/components/PreferencesSheet.tsx` | Timeout-wrapped save, non-blocking post-save |
| `app-mobile/src/hooks/useNatureCards.ts` | Pre-fetch trigger, batch history integration |
| `app-mobile/src/services/natureCardsService.ts` | Add `warmNaturePool()` method |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Nature batch history, pre-fetch at 75%, pre-warm on load |
| `app-mobile/src/components/SwipeableCards.tsx` | Multi-batch navigation UI, pre-fetch trigger on card 15 |
| `app-mobile/src/store/appStore.ts` | Add `natureCardHistory` slice |
| `supabase/functions/discover-nature/index.ts` | DateTime filtering, pool integration, warmPool support |
| `supabase/functions/_shared/cardPoolService.ts` | Add nature card pool helpers |
| `app-mobile/src/components/AppHandlers.tsx` | Clear nature history on pref change |
| `app-mobile/app/index.tsx` | Pass nature history reset to RecommendationsProvider |
| `app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx` | Show opening hours for requested datetime |

### New Files (0)
No new files. All changes extend existing modules.

---

## Change 1: DateTime Filtering in discover-nature Edge Function

### Problem
`datetimePref` is received but ignored. Places returned regardless of when user wants to go.

### Solution
Add opening-hours filtering pipeline after Google API results are collected.

**Input parameters already available:**
- `datetimePref` — ISO timestamp of when user wants to go
- `date_option` — "now" | "today" | "weekend" | "custom" (NEW param to pass through)
- `time_slot` — "brunch" | "afternoon" | "dinner" | "lateNight" (NEW param to pass through)

**Time slot → hour ranges:**
```typescript
const TIME_SLOT_RANGES: Record<string, { start: number; end: number }> = {
  brunch:    { start: 9,  end: 13 },
  afternoon: { start: 12, end: 17 },
  dinner:    { start: 17, end: 21 },
  lateNight: { start: 21, end: 2 },  // wraps midnight
};
```

**Filtering logic:**
```
IF date_option === "now":
  Filter by isOpenNow === true (already in Google response)
ELSE:
  1. Parse datetimePref to get target day-of-week + hour
  2. If time_slot provided, use TIME_SLOT_RANGES for hour window
  3. For each place with regularOpeningHours.periods:
     a. Find the period matching target day-of-week
     b. Check if target hour falls within open→close window
     c. Exclude places that are closed at that time
  4. Places WITHOUT opening hours data → INCLUDE (parks, trails often lack hours but are always open)
```

**Why include places without hours:** Most nature spots (parks, trails, beaches) don't have structured hours in Google because they're outdoor/always-open. Filtering them out would eliminate the best results.

### Edge Function Changes (`discover-nature/index.ts`)

Add after line where results are collected (post-`batchSearchPlaces`):

```typescript
// NEW: Filter by datetime preference
function filterByDateTime(
  places: Place[],
  datetimePref: string,
  dateOption: string,
  timeSlot: string | null
): Place[] {
  if (dateOption === 'now') {
    return places.filter(p => p.isOpenNow !== false); // include if unknown
  }

  const targetDate = new Date(datetimePref);
  const targetDay = targetDate.getDay(); // 0=Sun, 6=Sat

  let targetHourStart: number;
  let targetHourEnd: number;

  if (timeSlot && TIME_SLOT_RANGES[timeSlot]) {
    targetHourStart = TIME_SLOT_RANGES[timeSlot].start;
    targetHourEnd = TIME_SLOT_RANGES[timeSlot].end;
  } else {
    targetHourStart = targetDate.getHours();
    targetHourEnd = targetHourStart + 2; // 2-hour window default
  }

  return places.filter(place => {
    // No hours data → assume open (nature spots)
    if (!place.regularOpeningHours?.periods?.length) return true;

    return place.regularOpeningHours.periods.some(period => {
      if (period.open.day !== targetDay) return false;
      const openHour = period.open.hour;
      const closeHour = period.close?.hour ?? 24;
      return targetHourStart >= openHour && targetHourStart < closeHour;
    });
  });
}
```

---

## Change 2: Fix PreferencesSheet Save — Never Freeze

### Problem
Sequential awaits with no timeout. Any stall = permanent freeze.

### Solution
1. Wrap entire save in `Promise.race` with 10s timeout
2. Move non-critical operations to fire-and-forget (offline cache, re-read preferences)
3. Use `finally` block to ALWAYS reset `isSaving`
4. Close sheet immediately after DB write succeeds

### Code Pattern

```typescript
const handleApplyPreferences = async () => {
  if (isSaving) return;
  setIsSaving(true);

  try {
    // CRITICAL PATH (must succeed, has timeout)
    const savePromise = async () => {
      if (isCollaborationMode) {
        await updateBoardPreferences(dbPreferences);
      } else {
        const saved = await onSave?.(preferences);
        if (saved === false) throw new Error('Save failed');
      }
    };

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Save timeout')), 10000)
    );

    await Promise.race([savePromise(), timeoutPromise]);

    // SUCCESS: Invalidate caches (non-blocking)
    queryClient.invalidateQueries({ queryKey: ['recommendations'] });
    queryClient.invalidateQueries({ queryKey: ['curated-experiences'] });
    queryClient.invalidateQueries({ queryKey: ['nature-cards'] });
    queryClient.invalidateQueries({ queryKey: ['userPreferences'] });
    queryClient.invalidateQueries({ queryKey: ['userLocation'] });

    // Close sheet immediately — don't wait for re-fetch
    onClose?.();

    // FIRE-AND-FORGET: Non-critical post-save operations
    PreferencesService.getUserPreferences(user.id)
      .then(prefs => offlineService.cacheUserPreferences(prefs))
      .catch(() => {}); // silent

  } catch (error) {
    console.error('[PreferencesSheet] Save failed:', error);
    // Show user-visible error toast here
  } finally {
    setIsSaving(false); // ALWAYS reset — never freeze
  }
};
```

**Key changes:**
- `finally` block guarantees `isSaving` resets even on timeout/error
- Sheet closes BEFORE re-reading preferences from DB
- Offline cache is fire-and-forget
- React Query invalidation is non-blocking (returns immediately, fetches in background)

---

## Change 3: Nature Card Pool Integration

### Problem
Every nature request makes 8 Google Nearby Search calls (~$0.032/request at $4/1000). No pool-first serving.

### Solution
Integrate `discover-nature` with the existing `cardPoolService` pipeline:
1. Try serving from `card_pool` WHERE `category = 'nature'`
2. Exclude cards the user has already seen (via `user_card_impressions`)
3. If pool has >= 75% of requested limit → serve from pool (0 API cost)
4. If pool insufficient → fall back to Google API → store results in pool

### Edge Function Changes

```typescript
// At top of handler, BEFORE Google API calls:
const poolCards = await serveNatureFromPool(supabaseAdmin, userId, location, maxDistKm, limit);

if (poolCards.length >= Math.ceil(limit * 0.75)) {
  // Pool has enough — serve directly, 0 API cost
  recordImpressions(supabaseAdmin, userId, poolCards.map(c => c.id));
  return new Response(JSON.stringify({ cards: poolCards, source: 'pool' }));
}

// Pool insufficient — fall back to Google API
// ... existing Google API logic ...

// After generating cards, store in pool (fire-and-forget):
storeNatureInPool(supabaseAdmin, cards, location, radiusMeters);
recordImpressions(supabaseAdmin, userId, cards.map(c => c.id));
```

### Pool Query for Nature

```sql
SELECT cp.* FROM card_pool cp
WHERE cp.category = 'nature'
AND ST_DWithin(
  ST_MakePoint(cp.lng, cp.lat)::geography,
  ST_MakePoint($userLng, $userLat)::geography,
  $maxDistMeters
)
AND cp.id NOT IN (
  SELECT card_id FROM user_card_impressions
  WHERE user_id = $userId
  AND created_at > $prefUpdatedAt  -- Only impressions since last pref change
)
ORDER BY cp.match_score DESC
LIMIT $limit;
```

**Note:** `card_pool` table and `user_card_impressions` table already exist from the Card Pool Data Pipeline migration. No new tables needed — just need to populate them from `discover-nature`.

### warmNaturePool Support

Add to `natureCardsService.ts`:

```typescript
async warmNaturePool(params: Omit<DiscoverNatureParams, 'limit'>): Promise<void> {
  await supabase.functions.invoke('discover-nature', {
    body: { ...params, warmPool: true, limit: 40 }
  });
}
```

The edge function handles `warmPool: true` by fetching and storing results but returning an empty response (fast).

---

## Change 4: Batch History Store (Zustand Slice)

### Problem
Only 1 previous batch stored in a ref. User can't review batches 2+ ago.

### Solution
Add a `natureCardHistory` slice to the existing `appStore.ts` Zustand store. Persist with AsyncStorage. Clear on preference change.

### State Shape

```typescript
// In appStore.ts — new slice
interface NatureCardBatch {
  batchSeed: number;
  cards: NatureCard[];
  timestamp: number;
}

interface NatureCardHistorySlice {
  natureCardBatches: NatureCardBatch[];
  currentNatureBatchIndex: number;
  naturePrefsHash: string;

  // Actions
  addNatureBatch: (batch: NatureCardBatch) => void;
  navigateToNatureBatch: (index: number) => void;
  resetNatureHistory: (newPrefsHash: string) => void;
}
```

### Preferences Hash

```typescript
function computePrefsHash(prefs: UserPreferences): string {
  const key = [
    prefs.categories?.sort().join(','),
    prefs.budget_min, prefs.budget_max,
    prefs.travel_mode,
    prefs.travel_constraint_type, prefs.travel_constraint_value,
    prefs.date_option, prefs.time_slot, prefs.datetime_pref,
    prefs.custom_location, prefs.use_gps_location,
  ].join('|');
  // Simple hash (no crypto needed — just deduplication)
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}
```

### Reset Trigger

In `AppHandlers.tsx` → `handleSavePreferences()`:

```typescript
// After successful DB save:
const newHash = computePrefsHash(dbPreferences);
const currentHash = useAppStore.getState().naturePrefsHash;
if (newHash !== currentHash) {
  useAppStore.getState().resetNatureHistory(newHash);
}
```

### Batch Storage Trigger

In `RecommendationsContext.tsx`, when nature cards arrive:

```typescript
useEffect(() => {
  if (natureCards.length > 0 && isNatureBatchLoaded) {
    const existing = useAppStore.getState().natureCardBatches;
    const alreadyStored = existing.some(b => b.batchSeed === batchSeed);
    if (!alreadyStored) {
      useAppStore.getState().addNatureBatch({
        batchSeed,
        cards: natureCards,
        timestamp: Date.now(),
      });
    }
  }
}, [natureCards, isNatureBatchLoaded, batchSeed]);
```

---

## Change 5: Pre-fetch Next Batch at 75% Consumption

### Problem
User exhausts 20 cards → taps "Generate Another 20" → waits for full fetch. Noticeable lag.

### Solution
When user reaches card 15/20 (75%), pre-fetch the next batch in background.

### Implementation in RecommendationsContext

```typescript
// Track current card position
const handleCardIndexChange = useCallback((index: number, total: number) => {
  if (isNatureSelected && index >= Math.floor(total * 0.75)) {
    // Pre-fetch next batch (fire-and-forget)
    const nextSeed = batchSeed + 1;
    queryClient.prefetchQuery({
      queryKey: ['nature-cards', lat, lng, budgetMax, travelMode,
                 constraintType, constraintValue, datetimePref, nextSeed],
      queryFn: () => natureCardsService.discoverNature({
        ...currentParams, batchSeed: nextSeed
      }),
      staleTime: 30 * 60 * 1000, // 30 min
    });
  }
}, [batchSeed, isNatureSelected, /* other deps */]);
```

### In SwipeableCards.tsx

```typescript
// After each swipe, report position to context
const handleSwipe = (direction: string) => {
  // ... existing swipe logic ...
  onCardIndexChange?.(currentCardIndex + 1, availableRecommendations.length);
};
```

**Result:** When user taps "Generate Another 20", React Query already has the data cached → instant display.

---

## Change 6: Multi-Batch Navigation UI

### Current UI (SwipeableCards "All caught up" state)
- "Generate Another 20" button
- "Review Previous Batch" button (single batch only)

### New UI
```
┌─────────────────────────────────┐
│  You've seen all 20 cards!      │
│                                 │
│  [Generate Another 20]          │
│                                 │
│  ── Review History ──           │
│  Batch 1 (20 cards) ← current  │
│  Batch 2 (20 cards)            │
│  Batch 3 (20 cards)            │
│                                 │
│  [Review Batch 1]               │
│  [Review Batch 2]               │
│  [Review Batch 3]               │
└─────────────────────────────────┘
```

**Implementation:** Replace single "Review Previous Batch" button with a batch list from `useAppStore().natureCardBatches`. Each item shows batch number and card count. Tapping loads that batch into the swipe deck.

---

## Change 7: Pass date_option and time_slot to Edge Function

### Problem
PreferencesSheet saves `date_option` and `time_slot` to DB, but the `useNatureCards` hook only passes `datetimePref`. The edge function needs all three to properly filter.

### Hook Changes (`useNatureCards.ts`)

Add to params interface:
```typescript
dateOption?: string;   // 'now' | 'today' | 'weekend' | 'custom'
timeSlot?: string;     // 'brunch' | 'afternoon' | 'dinner' | 'lateNight'
```

Add to query key and function body.

### RecommendationsContext Changes

Pass through from `userPrefs`:
```typescript
const { cards: natureCards } = useNatureCards({
  // ... existing params ...
  dateOption: userPrefs?.date_option ?? 'now',
  timeSlot: userPrefs?.time_slot ?? null,
});
```

---

## Test Cases

### 1. DateTime Filtering
- Select Nature only → Set "This Weekend, Afternoon" → Generate cards → **All cards should be open on Saturday/Sunday between 12pm-5pm** (or have no hours data, indicating always-open)
- Select "Now" → Only see places where `isOpenNow !== false`

### 2. PreferencesSheet Save Reliability
- Open preferences → Change travel mode → Tap Apply → **Sheet closes within 2 seconds, never freezes**
- Simulate slow network (throttle) → Tap Apply → **Sheet closes within 10 seconds (timeout), shows error toast if failed**
- Tap Apply rapidly 3x → **Only 1 save executes** (guard on `isSaving`)

### 3. Batch History
- Generate batch 1 (20 cards) → Exhaust all → Generate batch 2 → Exhaust all → Generate batch 3
- Tap "Review Batch 1" → **See original 20 cards from batch 1**
- Tap "Review Batch 2" → **See original 20 cards from batch 2**
- Change preferences and save → **All 3 batches cleared, fresh start**

### 4. Pre-fetch
- Swipe through 15 of 20 cards → **Network tab shows pre-fetch request for next batch firing**
- Exhaust all 20 → Tap "Generate Another 20" → **Cards appear instantly (< 500ms)**

### 5. Pool-First Serving
- Generate 20 nature cards (cold start, Google API hit) → Change another preference (e.g. budget) back and forth → **Second request served from pool (0 API calls in logs)**

### 6. Card Deduplication Across Batches
- Batch 1: 20 unique places → Batch 2: **20 DIFFERENT places** (no overlap with batch 1)
- Batch 3: **20 more different places** (tracked via impressions table)

---

## Success Criteria

- [ ] Nature cards respect date/time, travel mode, travel distance, and location preferences
- [ ] PreferencesSheet never freezes — always closes within 10s, `isSaving` always resets
- [ ] Card refresh after preference change takes < 3 seconds
- [ ] 20 unique cards per batch, no duplicates across batches
- [ ] Full batch history accessible until preferences change
- [ ] Preference change resets all history cleanly
- [ ] Second request from same area served from pool (0 Google API calls)
- [ ] Pre-fetch fires at 75% consumption — next batch loads instantly

---

## Cost Impact

| Metric | Before | After |
|--------|--------|-------|
| Google API calls per nature request | 8 (cold) / 0 (cached) | 0 (pool) / 8 (cold fallback) |
| API calls for batch 2+ | 8 per batch | 0 (pool-served + impressions tracking) |
| OpenAI calls per batch | 1 (~$0.0005) | 1 (~$0.0005) — unchanged |
| Distance Matrix calls | 0 | 0 — unchanged (haversine math) |
| Average request-to-cards time | ~3-5s | < 1s (pool) / ~3s (cold) |

---

## Data Flow Diagram

```
User Changes Preferences
  │
  ├── handleApplyPreferences() [10s timeout]
  │     ├── DB write (critical, awaited)
  │     ├── Close sheet immediately
  │     ├── Invalidate React Query (non-blocking)
  │     └── Offline cache (fire-and-forget)
  │
  ├── Compute prefsHash → if changed → resetNatureHistory()
  │
  └── React Query re-fetches useNatureCards
        │
        ├── discover-nature edge function
        │     ├── Try card_pool first (0 API cost)
        │     ├── If pool < 75% → Google Nearby Search (8 types)
        │     ├── Filter by datetime (NEW)
        │     ├── Filter by distance / budget
        │     ├── Store results in pool (fire-and-forget)
        │     └── Record impressions (fire-and-forget)
        │
        ├── Cards arrive → addNatureBatch() to Zustand history
        │
        └── At card 15/20 → prefetchQuery(batchSeed + 1)
              │
              └── Next batch cached → "Generate Another 20" = instant
```
