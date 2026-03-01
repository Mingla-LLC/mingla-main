# Feature: Multi-Pill Parallel Deck
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** Users should be able to select multiple pill types simultaneously (e.g., Nature + Adventurous) and see one card from each selected pill per swipe, round-robin style, with zero performance degradation.

## Summary

Transform the unified deck from a single-source binary switch (Nature OR Curated) into a multi-source parallel pipeline where each selected pill fetches independently and results are round-robin interleaved. The user sees alternating cards — one Nature, one Adventure, one Nature, one Adventure — in a seamless stream. The key architectural decision: **parallel `Promise.all` inside the existing single `useQuery`**, which preserves the exact same caching, `placeholderData` smooth transitions, batch navigation, and 75% pre-fetch behavior while adding zero latency (parallel requests complete in `max(pill1, pill2)` time, not `sum()`).

## User Story

As a Mingla user, I want to select both "Adventurous" and "Nature" (and eventually more pill types) in the Preferences Sheet so that my swipe deck shows alternating cards from each source — giving me variety without having to switch modes.

## Architecture Impact

### No Server Changes
All existing edge functions remain untouched:
- `discover-nature` — continues serving Nature single-place cards
- `generate-curated-experiences` — continues serving curated multi-stop cards
- Pool pipeline (`cardPoolService.ts`) — no changes
- No new edge functions needed

### Modified Files (6 files)
| File | Change Scope | Lines Changed (est.) |
|------|-------------|---------------------|
| `app-mobile/src/services/deckService.ts` | Major refactor — pill resolution, parallel fetch, round-robin interleave, card conversion moved here | ~120 lines rewritten |
| `app-mobile/src/hooks/useDeckCards.ts` | Simplification — remove useMemo conversion, add `activePills` to return type | ~25 lines changed |
| `app-mobile/src/utils/cardConverters.ts` | Add `roundRobinInterleave()`, remove `isNatureMode()` | ~25 lines added, ~5 removed |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Rename nature-specific batch history to generic deck batch history | ~30 lines renamed |
| `app-mobile/src/store/appStore.ts` | Rename `NatureCardBatch` → `DeckBatch`, store `Recommendation[]` | ~25 lines renamed |
| `app-mobile/src/components/SwipeableCards.tsx` | Update batch history references from `nature*` → `deck*` | ~10 lines renamed |

### Files NOT Changed
| File | Why |
|------|-----|
| `PreferencesSheet.tsx` | Multi-select already works for both intents and categories |
| `AppHandlers.tsx` | `handleSavePreferences` already saves combined `[...intents, ...categories]` array |
| `recommendation.ts` | Type already supports both nature and curated cards |
| All edge functions | No server-side changes — routing stays client-side |
| `CardsCacheContext.tsx` | Only used for collaboration mode |

---

## Core Concept: Deck Pills

A **pill** is an independent card source in the deck. Two families:

### Category Pills (single-place cards)
Cards from category-specific edge functions that return flat, single-place results.
- **Nature** → `discover-nature` edge function → `NatureCard[]` → `natureToRecommendation()`
- Future: **Drink**, **Play**, **Wellness**, etc. → each gets its own discovery edge function

### Intent Pills (curated multi-stop cards)
Cards from `generate-curated-experiences` that return multi-stop itinerary results.
- **solo-adventure** (Adventurous) → curated pipeline → `CuratedExperienceCard[]` → `curatedToRecommendation()`
- **romantic**, **first-dates**, **friendly**, **group-fun**, **business** → same edge function, different `experienceType`

### Pill Resolution Algorithm
```
Input: categories[] from DB (e.g., ['solo-adventure', 'nature', 'Drink'])
       ↓
separateIntentsAndCategories()
       ↓
intents = ['solo-adventure']       ← intent pills
cats    = ['nature', 'Drink']      ← check for category pills
       ↓
Resolved pills:
  1. Nature pill     (because 'nature' is in cats)
  2. Adventure pill  (because 'solo-adventure' is in intents)
  Note: 'Drink' has no edge function yet → used as category filter within curated pills
       ↓
Fetch both in parallel: Promise.all([natureFetch, adventureFetch])
       ↓
Round-robin interleave: [N1, A1, N2, A2, N3, A3, ...]
```

### How Non-Pill Categories Work
Categories without their own edge function (Drink, Casual Eats, etc.) are passed as `selectedCategories` to curated pills, filtering which Google Place types appear in triads. They do NOT create separate pills. Example:

- User selects: `[solo-adventure, nature, drink, casual_eats]`
- Resolved pills: Nature pill + Adventure pill (with `selectedCategories: ['drink', 'casual_eats']`)
- Result: Nature cards interleaved with curated adventures filtered to drink/food places

---

## Detailed Design: deckService.ts

### New Interface: DeckPill
```typescript
interface DeckPill {
  id: string;                                    // 'nature', 'solo-adventure', 'romantic', etc.
  type: 'category' | 'curated';                  // determines fetch strategy + converter
}
```

### New Method: resolvePills()
```typescript
private resolvePills(categories: string[]): { pills: DeckPill[]; categoryFilters: string[] } {
  const { intents, categories: cats } = separateIntentsAndCategories(categories);
  const pills: DeckPill[] = [];
  const categoryFilters: string[] = [];

  // Category-based pills
  for (const cat of cats) {
    if (cat.toLowerCase() === 'nature') {
      pills.push({ id: 'nature', type: 'category' });
    } else {
      // No dedicated edge function yet — pass as filter to curated pills
      categoryFilters.push(cat);
    }
  }

  // Intent-based pills (one per selected intent)
  for (const intent of intents) {
    pills.push({ id: intent, type: 'curated' });
  }

  // Fallback: if nothing resolved, default to solo-adventure
  if (pills.length === 0) {
    pills.push({ id: 'solo-adventure', type: 'curated' });
  }

  return { pills, categoryFilters };
}
```

### Refactored fetchDeck()
```typescript
async fetchDeck(params: DeckParams): Promise<DeckResponse> {
  const { pills, categoryFilters } = this.resolvePills(params.categories);
  const limit = params.limit ?? 20;
  const perPillLimit = Math.ceil(limit / pills.length);

  // Fetch ALL pills in parallel
  const results = await Promise.all(
    pills.map(async (pill): Promise<Recommendation[]> => {
      try {
        if (pill.type === 'category') {
          // Nature (and future category pills)
          const cards = await natureCardsService.discoverNature({
            location: params.location,
            budgetMax: params.budgetMax,
            travelMode: params.travelMode,
            travelConstraintType: params.travelConstraintType,
            travelConstraintValue: params.travelConstraintValue,
            datetimePref: params.datetimePref,
            dateOption: params.dateOption,
            timeSlot: params.timeSlot,
            batchSeed: params.batchSeed,
            limit: perPillLimit,
          });
          return cards.map(natureToRecommendation);
        } else {
          // Curated intent pill
          const cards = await curatedExperiencesService.generateCuratedExperiences({
            experienceType: pill.id as any,
            location: params.location,
            budgetMin: params.budgetMin,
            budgetMax: params.budgetMax,
            travelMode: params.travelMode,
            travelConstraintType: params.travelConstraintType,
            travelConstraintValue: params.travelConstraintValue,
            datetimePref: params.datetimePref,
            batchSeed: params.batchSeed,
            selectedCategories: categoryFilters.length > 0 ? categoryFilters : undefined,
            limit: perPillLimit,
            skipDescriptions: true,
          });
          return cards.map(curatedToRecommendation);
        }
      } catch (err) {
        console.warn(`[DeckService] Pill ${pill.id} failed:`, err);
        return []; // Graceful degradation — other pills still serve
      }
    })
  );

  // Round-robin interleave
  const interleaved = roundRobinInterleave(results);

  // Determine deckMode
  const deckMode: DeckResponse['deckMode'] =
    pills.length === 1
      ? (pills[0].type === 'category' ? 'nature' : 'curated')
      : 'mixed';

  return {
    cards: interleaved,
    deckMode,
    activePills: pills.map(p => p.id),
    total: interleaved.length,
  };
}
```

### Refactored warmDeckPool()
```typescript
async warmDeckPool(params: Omit<DeckParams, 'limit' | 'batchSeed'>): Promise<void> {
  const { pills } = this.resolvePills(params.categories);

  // Warm ALL pill pools in parallel
  await Promise.all(
    pills.map(async (pill) => {
      try {
        if (pill.type === 'category') {
          await natureCardsService.warmNaturePool({ ... });
        } else {
          await curatedExperiencesService.warmPool({
            experienceType: pill.id,
            location: params.location,
            ...
          });
        }
      } catch { /* silent */ }
    })
  );
}
```

---

## Detailed Design: DeckResponse Type Change

### Before
```typescript
export interface DeckResponse {
  cards: NatureCard[] | CuratedExperienceCard[];
  deckMode: 'nature' | 'curated';
  total: number;
}
```

### After
```typescript
export interface DeckResponse {
  cards: Recommendation[];                         // Pre-converted, ready to render
  deckMode: 'nature' | 'curated' | 'mixed';       // 'mixed' = multi-pill
  activePills: string[];                           // ['nature', 'solo-adventure']
  total: number;
}
```

Card conversion moves FROM `useDeckCards` (useMemo) INTO `deckService.fetchDeck()`. The hook receives ready-to-use `Recommendation[]`.

---

## Detailed Design: Round-Robin Interleave

```typescript
export function roundRobinInterleave(pillResults: Recommendation[][]): Recommendation[] {
  const result: Recommendation[] = [];
  const maxLen = Math.max(0, ...pillResults.map(p => p.length));

  for (let round = 0; round < maxLen; round++) {
    for (let p = 0; p < pillResults.length; p++) {
      if (round < pillResults[p].length) {
        result.push(pillResults[p][round]);
      }
    }
  }
  return result;
}
```

### Behavior Examples

**2 pills, balanced (Nature=10, Adventure=10):**
```
[N1, A1, N2, A2, N3, A3, N4, A4, N5, A5, N6, A6, N7, A7, N8, A8, N9, A9, N10, A10]
```

**2 pills, unbalanced (Nature=6, Adventure=10):**
```
[N1, A1, N2, A2, N3, A3, N4, A4, N5, A5, N6, A6, A7, A8, A9, A10]
```
After Nature exhausts, remaining Adventure cards fill the tail. No empty slots.

**3 pills (Nature=7, Adventure=7, Romantic=7):**
```
[N1, A1, R1, N2, A2, R2, N3, A3, R3, N4, A4, R4, N5, A5, R5, N6, A6, R6, N7, A7, R7]
```

**1 pill fails, 1 succeeds (Nature=0, Adventure=10):**
```
[A1, A2, A3, A4, A5, A6, A7, A8, A9, A10]
```
Graceful degradation — deck still works.

---

## Detailed Design: useDeckCards.ts Simplification

### Before (97 lines)
```typescript
// useMemo converts NatureCard[] or CuratedExperienceCard[] → Recommendation[]
const cards = useMemo(() => {
  if (!query.data?.cards) return [];
  return query.data.cards.map(card =>
    deckMode === 'nature' ? natureToRecommendation(card) : curatedToRecommendation(card)
  );
}, [query.data]);
```

### After (~70 lines)
```typescript
// No conversion needed — deckService returns Recommendation[] directly
return {
  cards: query.data?.cards ?? [],
  deckMode: query.data?.deckMode ?? 'curated',
  activePills: query.data?.activePills ?? [],
  isLoading: query.isLoading,
  isFetching: query.isFetching,
  isFullBatchLoaded: (query.data?.total ?? 0) >= ((params.limit ?? 20) * 0.5),
  error: query.error as Error | null,
  refetch: query.refetch,
};
```

### Updated Return Type
```typescript
export interface UseDeckCardsResult {
  cards: Recommendation[];
  deckMode: 'nature' | 'curated' | 'mixed';
  activePills: string[];                     // NEW
  isLoading: boolean;
  isFetching: boolean;
  isFullBatchLoaded: boolean;
  error: Error | null;
  refetch: () => void;
}
```

---

## Detailed Design: Batch History Generalization

### Zustand Store (appStore.ts)

**Before:**
```typescript
export interface NatureCardBatch {
  batchSeed: number;
  cards: NatureCard[];
  timestamp: number;
}
// State: natureCardBatches, currentNatureBatchIndex, naturePrefsHash
// Actions: addNatureBatch, navigateToNatureBatch, resetNatureHistory
```

**After:**
```typescript
export interface DeckBatch {
  batchSeed: number;
  cards: Recommendation[];
  activePills: string[];        // which pills were active for this batch
  timestamp: number;
}
// State: deckBatches, currentDeckBatchIndex, deckPrefsHash
// Actions: addDeckBatch, navigateToDeckBatch, resetDeckHistory
```

**Why store `Recommendation[]` not raw cards:** The batch stores already-converted cards. When navigating back, the React Query cache likely has the data (same batchSeed → same query key), but Zustand provides a fallback for offline or GC'd cache scenarios.

### RecommendationsContext Renames
| Before | After |
|--------|-------|
| `isNatureSelected` | `const hasDeckData = deckCards.length > 0` (no mode check needed) |
| `addNatureBatch(...)` | `addDeckBatch(...)` |
| `resetNatureHistory(...)` | `resetDeckHistory(...)` |
| `naturePrefsHash` | `deckPrefsHash` |
| `natureCardBatches` | `deckBatches` |
| `currentNatureBatchIndex` | `currentDeckBatchIndex` |
| `navigateToNatureBatch(...)` | `navigateToDeckBatch(...)` |
| `totalNatureCardsViewed` | `totalDeckCardsViewed` |
| `handleNatureCardProgress(...)` | `handleDeckCardProgress(...)` |

### SwipeableCards Renames
Same field renames in the destructured context values. The rendering logic is unchanged — cards already carry `cardType: 'curated'` for curated card detection.

---

## Performance Analysis

### Current: Single Pill
```
1 network request → 1 edge function → 20 cards → ~500ms (or ~50ms from pool)
```

### New: Two Pills (Nature + Adventure)
```
2 parallel requests → 2 edge functions → 10+10 = 20 cards
Latency = max(nature_500ms, adventure_500ms) = ~500ms (same!)
Pool-first: max(nature_50ms, adventure_50ms) = ~50ms (same!)
```

### New: Three Pills (Nature + Adventure + Romantic)
```
3 parallel requests → 3 edge functions → 7+7+7 = 21 cards
Latency = max(nature, adventure, romantic) ≈ same
Each pill requests FEWER cards → each is individually FASTER
```

### Why Not Server-Side Combining?
A combined edge function would:
1. Still call the same internal functions in parallel → same latency
2. Add network overhead for a larger payload
3. Prevent independent per-pill caching on the server
4. Require a new edge function deployment + maintenance
5. If one pill fails, the entire request fails

Client-side parallel fetch gives us independent failure isolation (one pill fails → others still serve) with zero additional latency.

### Cache Behavior
- **Same pills, same prefs:** React Query cache hit → 0ms
- **Add a pill:** Query key changes (categories change) → refetch all pills in parallel → `placeholderData` shows previous deck during load
- **Remove a pill:** Same as above — smooth transition
- **Batch navigation (batchSeed change):** React Query cache hit for that seed → instant

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| One pill fails (network error) | Other pills still serve cards. Deck shows partial results. |
| One pill returns 0 cards (no matches) | Round-robin skips empty pill. Other pills fill the deck. |
| All pills fail | Empty deck → "No matches" error UI (existing behavior) |
| User deselects a pill | Categories change → query key change → refetch → smooth transition via placeholderData |
| User adds a pill | Same as above |
| No intents AND no nature selected | Fallback to solo-adventure curated pill |
| Only non-nature categories (e.g., just Drink) | No category pill (no edge fn) → solo-adventure curated pill filtered by Drink |

---

## Test Cases

1. **Nature + Adventurous interleave:** Select both pills → deck shows alternating Nature (single-place) and Adventure (multi-stop curated) cards. Verify card 1 is Nature, card 2 is Curated, card 3 is Nature, etc.

2. **Single pill backwards compatibility:** Select only Nature → deck shows all Nature cards, identical to current behavior. Select only Adventurous → deck shows all curated cards, identical to current behavior.

3. **Pill add/remove transition:** Start with Nature only → add Adventurous while cards are visible → old Nature cards remain visible as placeholder → new interleaved deck loads within ~500ms with no blank screen.

4. **Batch generation with multi-pill:** Swipe through 20 interleaved cards → tap "Generate Another 20" → new batch of 20 interleaved cards loads (10 nature + 10 curated). Verify batch history tracks this mixed batch.

5. **One pill graceful degradation:** Simulate nature edge function failure → deck shows only curated cards (no error screen). Verify no crash or infinite spinner.

6. **Three pills (future):** Select Nature + Adventurous + Romantic → deck shows N1, A1, R1, N2, A2, R2 pattern. Verify ~7 cards per pill (20/3 rounded up).

7. **Pool warming:** On first load with multi-pill selection → verify both nature pool AND curated pool warm in parallel (check console logs).

8. **75% pre-fetch:** Swipe through 15 of 20 interleaved cards → verify next batch (batchSeed+1) is pre-fetched for ALL active pills.

9. **Batch history navigation:** Generate 3 batches → navigate back to batch 1 → verify the interleaved deck from batch 1 is restored (from cache or Zustand).

10. **Preference change reset:** Change budget while multi-pill is active → verify batchSeed resets to 0, all deck-cards queries invalidated, both pills refetch with new budget, refresh spinner stays until ALL pills complete.

## Success Criteria

- [ ] Nature + Adventurous shows alternating cards (1:1 round-robin)
- [ ] Single-pill selection works identically to current behavior (backwards compat)
- [ ] Adding/removing a pill shows smooth transition (no blank deck, no stuck spinner)
- [ ] Batch generation produces new interleaved deck from all active pills
- [ ] Speed: multi-pill loads in same time as single pill (parallel fetch, not sequential)
- [ ] Pool warming fires for all active pill pools
- [ ] 75% pre-fetch works across the interleaved deck
- [ ] Curated cards still render CuratedExperienceSwipeCard correctly in interleaved deck
- [ ] Nature cards still render standard card template correctly in interleaved deck
- [ ] Card expand (swipe up) still works correctly for both card types
- [ ] Swipe tracking (save/like) still works correctly for both card types
- [ ] TypeScript: zero new compilation errors
- [ ] No server-side changes or deployments required
