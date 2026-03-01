# Feature: Unified Deck Server
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** "When I switch between curated cards and nature cards, the swipeable deck is not reliable. I want one server that serves the deck — whatever the user orders, they get it fast, and preference changes reflect immediately."

## Summary

The swipeable card deck currently relies on **7+ independent React Query hooks** (5 curated experience types + 1 nature + 1 regular) orchestrated by `RecommendationsContext.tsx`. Each hook has its own `enabled` gate, cache lifecycle, and loading state. When the user switches preferences (e.g., nature → curated or vice versa), race conditions between hook enable/disable transitions, inconsistent cache clearing (`removeQueries` vs `invalidateQueries`), and a fragile `allBatchesLoaded` computation cause the deck to show spinners indefinitely, display stale cards, or appear empty.

This feature replaces the multi-hook orchestra with a **single `serve-deck` edge function** and a **single `useDeckCards` React Query hook**. The server determines what to serve based on preferences. The client has one query key, one loading state, one lifecycle. Preference changes cause the query key to change, which triggers an automatic refetch with `placeholderData` showing the previous deck during the transition — no empty states, no race conditions.

## User Story

As a Mingla user, I want to change my preferences (nature, adventure, dates, etc.) and immediately see the deck update with relevant cards, so that I always get what I ordered — fast and reliably.

## Root Cause Analysis

### Current Architecture Problems

| # | Problem | Location | Impact |
|---|---------|----------|--------|
| 1 | **7 independent query hooks** with interdependent `enabled` gates | `RecommendationsContext.tsx:589-651` | Hook A disables before Hook B enables → window with 0 active hooks |
| 2 | **Inconsistent cache clearing** — nature uses `removeQueries` (hard delete), curated uses `invalidateQueries` (soft) | `AppHandlers.tsx:716-742` | Nature loses `placeholderData` fallback → spinner; curated keeps it → smooth |
| 3 | **`allBatchesLoaded`** depends on ALL 5 curated hooks + nature hook finishing | `RecommendationsContext.tsx:632-660` | Disabled hooks return `isFullBatchLoaded: true` prematurely → spinner clears before data arrives |
| 4 | **Warming refs (`warmPoolFired`, `warmNaturePoolFired`)** only reset on `refreshKey` change | `RecommendationsContext.tsx:367-368, 525-526` | Toggling nature off/on without pref change → pool not re-warmed → slow 2nd load |
| 5 | **`interleaveCards` priority** — nature > curated > regular with no transition handling | `RecommendationsContext.tsx:264-272` | During switch, cached nature cards (from `placeholderData`) block new curated cards from appearing |
| 6 | **Manual invalidation gymnastics** in `handleSavePreferences` | `AppHandlers.tsx:715-747` | 3 separate invalidation calls + nature hash check + refreshKey increment — any missed step = stale deck |
| 7 | **Mixed categories array** stores both intents and categories | `AppHandlers.tsx:621-626` | Relies on `INTENT_IDS` Set filter; edge cases cause silent misclassification |

### Why It "Seems Reliable for Nature Cards"

Nature cards work more consistently because:
- Single hook with a simple `enabled` gate (`isSoloMode && isNatureSelected`)
- No interaction with other hook lifecycles when active
- Pool warming fires on selection, pre-populating results
- `removeQueries` on pref change gives clean slate (no stale data mixing)

The unreliability appears when **switching away from nature** — the hard cache removal means curated hooks start from scratch with no `placeholderData`, and the multi-hook enable/disable dance creates timing windows.

## Architecture Impact

### New Files
| File | Purpose |
|------|---------|
| `supabase/functions/serve-deck/index.ts` | Unified edge function — single entry point for the swipeable deck |
| `supabase/functions/_shared/deckHelpers.ts` | Shared helpers extracted from discover-nature + generate-curated-experiences |
| `app-mobile/src/hooks/useDeckCards.ts` | Single React Query hook replacing 7+ hooks |
| `app-mobile/src/services/deckService.ts` | Service layer — calls `serve-deck` edge function |

### Modified Files
| File | Change |
|------|--------|
| `app-mobile/src/contexts/RecommendationsContext.tsx` | **Major refactor** — remove 7 hooks, replace with `useDeckCards`; remove `interleaveCards`; simplify loading/transition logic |
| `app-mobile/src/components/AppHandlers.tsx` | Simplify `handleSavePreferences` — replace 3 invalidation calls + nature hash check with single `invalidateQueries(['deck-cards'])` |
| `app-mobile/src/store/appStore.ts` | Keep nature batch history but wire to unified deck data |
| `app-mobile/src/components/SwipeableCards.tsx` | Minor — remove nature-specific progress handler references (now generic) |

### Existing Files Preserved (NOT modified)
| File | Reason |
|------|--------|
| `supabase/functions/discover-nature/index.ts` | Still used by Discover tab; `serve-deck` imports shared logic |
| `supabase/functions/generate-curated-experiences/index.ts` | Still used by collaboration sessions; `serve-deck` imports shared logic |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | May still be used for collaboration mode |
| `app-mobile/src/hooks/useNatureCards.ts` | May still be used for standalone contexts |
| `app-mobile/src/services/natureCardsService.ts` | Still used by `discover-nature` directly |
| `app-mobile/src/services/curatedExperiencesService.ts` | Still used by collaboration mode |

### External APIs
- No new APIs — reuses existing Google Places API (New) + OpenAI GPT-4o-mini calls
- Same pool-first serving from `card_pool` table (0 API cost on cache hits)

## Edge Function Spec

### `serve-deck`

**Trigger:** HTTP POST (invoked by Supabase JS client)
**Purpose:** Single entry point for the solo swipeable deck. Reads preferences, determines deck mode, serves the right cards.

**Input:**
```typescript
interface ServeDeckRequest {
  location: { lat: number; lng: number };
  // All preferences (flat — no need to separate intents from categories on client)
  categories: string[];       // Mixed intents + categories (e.g., ['solo-adventure', 'Nature'])
  budgetMin: number;
  budgetMax: number;
  travelMode: 'walking' | 'driving' | 'transit' | 'biking';
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;          // 'now' | 'today' | 'weekend' | 'custom'
  timeSlot?: string | null;     // 'brunch' | 'afternoon' | 'dinner' | 'lateNight'
  batchSeed?: number;           // For "Generate Another 20"
  limit?: number;               // Default 20
  warmPool?: boolean;           // Pre-warm mode (returns empty)
}
```

**Output:**
```typescript
interface ServeDeckResponse {
  cards: DeckCard[];            // Unified card format
  deckMode: 'nature' | 'curated';  // What was served
  total: number;                // Total available (for batch info)
  meta: {
    fromPool: number;           // How many came from card pool
    fromApi: number;            // How many required fresh API calls
    elapsed: number;            // Server-side processing time (ms)
  };
}

// DeckCard is a UNION — either a nature card or a curated card
type DeckCard = NatureDeckCard | CuratedDeckCard;

interface NatureDeckCard {
  cardType: 'nature';
  id: string;
  placeId: string;
  title: string;
  description: string;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceLevelLabel: string;
  priceMin: number;
  priceMax: number;
  address: string;
  openingHours: Record<string, string>;
  isOpenNow: boolean;
  website: string | null;
  lat: number;
  lng: number;
  placeType: string;
  placeTypeLabel: string;
  distanceKm: number;
  travelTimeMin: number;
  matchScore: number;
}

interface CuratedDeckCard {
  cardType: 'curated';
  id: string;
  experienceType: string;
  pairingKey: string;
  title: string;
  tagline: string;
  categoryLabel: string;
  stops: CuratedStop[];
  totalPriceMin: number;
  totalPriceMax: number;
  estimatedDurationMinutes: number;
  matchScore: number;
}
```

**Logic (pseudocode):**
```
1. Parse request body
2. Validate location
3. Extract intents vs categories using INTENT_IDS Set
4. Determine deckMode:
   - If categories include 'Nature' (case-insensitive) → deckMode = 'nature'
   - Else → deckMode = 'curated'
5. If warmPool → warm the appropriate pool, return empty
6. If deckMode === 'nature':
   a. Try pool-first (serveCardsFromPipeline with category='Nature')
   b. If pool insufficient → run nature discovery (batchSearchPlaces with 8 NATURE_TYPES)
   c. Filter by distance, budget, datetime
   d. Stable sort by rating + reviews
   e. Offset-based pagination (batchSeed * limit)
   f. Generate AI descriptions (single OpenAI batch)
   g. Store in card_pool (fire-and-forget)
   h. Return NatureDeckCard[]
7. If deckMode === 'curated':
   a. Determine experience types from intents (default: 'solo-adventure')
   b. Try pool-first for each type (serveCuratedCardsFromPool)
   c. If pool insufficient → run curated generation pipeline
   d. Parallel fetch per experience type → merge + shuffle
   e. Offset-based pagination
   f. Store in card_pool (fire-and-forget)
   g. Return CuratedDeckCard[]
8. Return unified response with deckMode discriminator
```

**Key design decision:** The server determines `deckMode`, not the client. The client sends raw categories; the server routes. This eliminates client-side mode detection race conditions.

## Mobile Implementation

### New Hook: `useDeckCards.ts`

```typescript
interface UseDeckCardsParams {
  location: { lat: number; lng: number } | null;
  categories: string[];           // Raw from userPrefs (intents + categories mixed)
  budgetMin: number;
  budgetMax: number;
  travelMode: string;
  travelConstraintType: 'time' | 'distance';
  travelConstraintValue: number;
  datetimePref?: string;
  dateOption?: string;
  timeSlot?: string | null;
  batchSeed: number;
  enabled: boolean;
}

interface UseDeckCardsResult {
  cards: Recommendation[];        // Already mapped to Recommendation format
  deckMode: 'nature' | 'curated';
  isLoading: boolean;
  isFetching: boolean;
  isFullBatchLoaded: boolean;
  error: Error | null;
  refetch: () => void;
}
```

**Query key:**
```typescript
['deck-cards', location.lat, location.lng,
 categories.sort().join(','),   // ← ALL prefs in key = auto-refetch on change
 budgetMin, budgetMax, travelMode,
 travelConstraintType, travelConstraintValue,
 datetimePref, dateOption, timeSlot,
 batchSeed]
```

**Cache settings:**
- `staleTime: 30 * 60 * 1000` (30 min — same as current curated/nature)
- `gcTime: 2 * 60 * 60 * 1000` (2 hours)
- `placeholderData: previousData` — **critical**: shows old deck while new one loads
- `retry: 2`

**Why this fixes everything:**
1. **One hook = one lifecycle** — no interdependent enabled gates
2. **Query key includes ALL prefs** — key changes = auto-refetch, no manual invalidation
3. **`placeholderData`** — old cards visible during transition, no empty deck
4. **Server determines mode** — no client-side `isNatureSelected` derivation race
5. **Single `isLoading`** — no `allBatchesLoaded` computation across 7 hooks

### New Service: `deckService.ts`

```typescript
class DeckService {
  async fetchDeck(params: ServeDeckRequest): Promise<{
    cards: Recommendation[];
    deckMode: 'nature' | 'curated';
    total: number;
  }>;

  async warmDeckPool(params: Omit<ServeDeckRequest, 'limit' | 'batchSeed'>): Promise<void>;
}
```

- `fetchDeck` calls `supabase.functions.invoke('serve-deck', { body: params })`
- Maps server response to `Recommendation[]` using existing `natureToRecommendation` / `curatedToRecommendation` converters
- `warmDeckPool` is fire-and-forget

### Modified: `RecommendationsContext.tsx`

**Remove:**
- 5x `useCuratedExperiences` hook calls (lines 589-628)
- 1x `useNatureCards` hook call (lines 639-651)
- `interleaveCards()` function (lines 264-272)
- `allCuratedBatchesLoaded` computation (lines 632-634)
- `allBatchesLoaded` computation (line 660)
- Nature pre-fetch logic (lines 697-728)
- Nature batch storage effect (lines 672-680)
- Manual `computePrefsHash` / `naturePrefsHash` comparison (lines 663-669)
- Curated pool warming effect (lines 456-469)
- Nature pool warming effect (lines 731-745)
- `curatedToRecommendation` / `natureToRecommendation` converters (move to `deckService.ts`)

**Replace with:**
```typescript
// Single hook replaces 7+
const {
  cards: deckCards,
  deckMode,
  isLoading: isDeckLoading,
  isFetching: isDeckFetching,
  isFullBatchLoaded: isDeckBatchLoaded,
} = useDeckCards({
  location: userLocation,
  categories: userPrefs?.categories ?? [],
  budgetMin: userPrefs?.budget_min ?? 0,
  budgetMax: userPrefs?.budget_max ?? 1000,
  travelMode: userPrefs?.travel_mode ?? 'walking',
  travelConstraintType: (userPrefs?.travel_constraint_type as 'time' | 'distance') ?? 'time',
  travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
  datetimePref: userPrefs?.datetime_pref,
  dateOption: userPrefs?.date_option ?? 'now',
  timeSlot: userPrefs?.time_slot ?? null,
  batchSeed,
  enabled: isSoloMode && !!userLocation,
});
```

**Simplified loading state:**
```typescript
const loading = isLoadingLocation || isLoadingPreferences || isDeckLoading;
const isFetching = isDeckFetching;

// Replace allBatchesLoaded with:
const allBatchesLoaded = isDeckBatchLoaded;
```

**Simplified recommendations sync:**
```typescript
// No more interleaveCards — deck returns final order
useEffect(() => {
  if (deckCards.length > 0) {
    setRecommendations(deckCards);
    if (isBatchTransitioning && isDeckBatchLoaded) {
      setIsBatchTransitioning(false);
    }
  }
}, [deckCards, isDeckBatchLoaded]);
```

**Keep collaboration mode hooks as-is** — `useDeckCards` is for solo mode only. Collaboration still uses `useCuratedExperiences` directly.

### Modified: `AppHandlers.tsx` — `handleSavePreferences`

**Current (lines 715-747):** 3 invalidation calls + nature hash check + refreshKey increment
**New:**
```typescript
// Preferences already embedded in query key — just invalidate the deck
queryClient.invalidateQueries({ queryKey: ['deck-cards'] });
queryClient.invalidateQueries({ queryKey: ['recommendations'] }); // For collaboration fallback
queryClient.invalidateQueries({ queryKey: ['userLocation'] });

// Nature history reset — still needed for batch navigation UI
const newHashStr = computePrefsHash(dbPreferences);
const { naturePrefsHash, resetNatureHistory } = useAppStore.getState();
if (newHashStr !== naturePrefsHash) {
  resetNatureHistory(newHashStr);
}

// Trigger refresh
setPreferencesRefreshKey((prev: number) => prev + 1);
```

### Modified: `appStore.ts`

**Keep as-is.** Nature batch history (`natureCardBatches`, `currentNatureBatchIndex`) still works — it stores batches from the unified deck when `deckMode === 'nature'`. The `addNatureBatch` / `navigateToNatureBatch` actions are unchanged.

### Modified: `SwipeableCards.tsx`

**Minor changes only:**
- `handleNatureCardProgress` → rename to `handleCardProgress` (works for both modes)
- Remove nature-specific gating in progress callback (server handles batching)

## Shared Helpers Module

### `_shared/deckHelpers.ts`

Extract duplicated logic from `discover-nature` and `generate-curated-experiences`:

```typescript
// Travel
export const SPEED_KMH: Record<string, number>;
export function haversineKm(lat1, lng1, lat2, lng2): number;
export function estimateTravelMin(distKm, mode): number;

// Price
export function priceLevelToLabel(level: string | undefined): string;
export function priceLevelToRange(level: string | undefined): { min: number; max: number };

// Photos
export function getPhotoUrl(place: any, apiKey: string): string;
export function getAllPhotoUrls(place: any, apiKey: string, max?: number): string[];

// Opening hours
export function parseOpeningHours(place: any): { hours: Record<string, string>; isOpenNow: boolean };
export function filterByDateTime(places: any[], datetimePref, dateOption, timeSlot): any[];

// Scoring
export function calculateMatchScore(place, userLat, userLng, maxDistKm): number;

// Pagination
export function seededShuffle<T>(arr: T[], seed: number): T[];
```

The existing `discover-nature/index.ts` and `generate-curated-experiences/index.ts` will be refactored to import from `_shared/deckHelpers.ts` instead of defining these inline. This reduces code duplication and ensures consistency.

## Database Changes

**None.** This feature uses existing tables (`card_pool`, `place_pool`, `user_card_impressions`, `preferences`). No migration needed.

## RLS Policies

**None needed.** The `serve-deck` edge function uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) just like existing edge functions. User auth is verified via the Authorization header.

## Test Cases

1. **Nature → Curated switch:** User has Nature selected → opens PreferencesSheet → deselects Nature, selects "solo-adventure" → saves. **Expected:** Deck shows spinner briefly (placeholderData shows old nature cards underneath), then curated cards appear within 1-2s. No empty state.

2. **Curated → Nature switch:** User has solo-adventure selected → opens PreferencesSheet → deselects solo-adventure, selects Nature → saves. **Expected:** Old curated cards visible as placeholder → nature cards replace them within 1s (pool-first). No stuck spinner.

3. **Cold start (no pool):** New user, first load, solo-adventure selected, no card pool data. **Expected:** Spinner shows → curated cards appear within 2-4s (Google API + OpenAI). Subsequent loads serve from pool in <500ms.

4. **Generate Another 20:** User swipes through 20 nature cards → taps "Generate Another 20". **Expected:** batchSeed increments → query key changes → new batch loads → no interference with previous batch display.

5. **Rapid preference toggling:** User rapidly switches nature ↔ curated 3 times within 2 seconds. **Expected:** Only the final preference state triggers a fetch. Previous in-flight requests are superseded by React Query's `placeholderData` behavior (last query key wins). No stale cards from intermediate states.

6. **Pool-first latency:** User with populated card pool switches to nature. **Expected:** Cards appear in <500ms (served from `card_pool`, 0 Google API calls).

7. **Collaboration mode unaffected:** User in a collaboration session. **Expected:** `useDeckCards` is disabled (`enabled: isSoloMode`). Collaboration mode still uses `useCuratedExperiences` directly. No regression.

## Success Criteria

- [ ] Switching between nature and curated modes always produces cards within 2s (pool hit) or 4s (cold)
- [ ] No empty deck states during preference transitions (placeholderData bridge)
- [ ] No stuck spinners — single `isLoading` state, no `allBatchesLoaded` fragility
- [ ] "Generate Another 20" works identically for nature and curated modes
- [ ] Nature batch history (Review Previous Batch) still functions
- [ ] Collaboration mode is unaffected (uses separate hooks)
- [ ] RecommendationsContext.tsx reduced from ~1138 lines to ~600 lines
- [ ] AppHandlers preference save uses single invalidation call instead of 3+

## Architecture Diagram

```
BEFORE (7+ hooks, race conditions):
┌──────────────────────────────────────────────────────┐
│ RecommendationsContext                               │
│  ├─ useRecommendationsQuery (regular)                │
│  ├─ useCuratedExperiences (solo-adventure)  ──┐      │
│  ├─ useCuratedExperiences (first-dates)     ──┤      │
│  ├─ useCuratedExperiences (romantic)        ──┤ 5x   │
│  ├─ useCuratedExperiences (friendly)        ──┤      │
│  ├─ useCuratedExperiences (group-fun)       ──┘      │
│  ├─ useNatureCards                                   │
│  │                                                   │
│  ├─ interleaveCards(regular, curated[], nature[])     │
│  ├─ allBatchesLoaded = solo && date && rom && ...     │
│  └─ 7 enabled gates, 3 invalidation paths            │
└──────────────────────────────────────────────────────┘

AFTER (1 hook, deterministic):
┌──────────────────────────────────────────────────────┐
│ RecommendationsContext                               │
│  ├─ useDeckCards ─────→ serve-deck edge fn           │
│  │   (1 query key,      (determines deckMode,        │
│  │    1 loading state,   routes to nature/curated,    │
│  │    placeholderData)   pool-first serving)          │
│  │                                                   │
│  └─ Solo mode: useDeckCards                          │
│     Collab mode: useCuratedExperiences (unchanged)   │
└──────────────────────────────────────────────────────┘
```

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| New edge function cold start adds latency | Pool-first serving + edge function warming on app load |
| Removing 7 hooks might break collaboration mode | Collaboration mode keeps its own `useCuratedExperiences` hooks — no change |
| Nature batch history might break with unified hook | Deck mode discriminator (`deckMode: 'nature'`) gates batch storage — same logic, different data source |
| Existing edge functions become unused | They remain for collaboration + Discover tab. Mark solo-deck paths with deprecation comments |
| Large refactor risk | Incremental rollout: add `useDeckCards` first, verify it works, then remove old hooks |
