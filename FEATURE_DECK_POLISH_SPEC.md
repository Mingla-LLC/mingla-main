# Feature: Deck Polish — Bug Fixes, Round-Robin Cards, Performance & History
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** App is broken (bundler error, no cards on load), needs premium card delivery, round-robin pill system, 20 cards/batch, history review, <1s time-to-first-card.

---

## Summary

A comprehensive polish pass that fixes every blocking bug preventing cards from appearing, completes the Groceries & Flowers category, hardens the round-robin multi-pill system, adds a batch history UI, and optimizes the entire pipeline for sub-1-second card delivery by fully leveraging the existing card pool infrastructure. After this pass, the app will reliably deliver 20 interleaved cards per batch, allow users to generate more batches, and review previously swiped cards.

## User Story

As a Mingla user, I want to open the app and immediately see a diverse deck of 20 swipeable cards drawn from every pill I selected (curated intents + categories), interleaved in round-robin order, loading in under 1 second — and I want the option to generate another 20 or review cards I've already swiped.

---

## Workstream Breakdown

This spec is organized into 5 workstreams, ordered by criticality.

---

## Workstream A: Critical Bug Fixes (Blocks Everything)

### A1. Clear Stale Metro Cache (Bundler Syntax Error)

**Problem:** Bundler reports `SyntaxError` in `PreferencesSectionsAdvanced.tsx:624` but the file is syntactically valid (623 lines, properly closed `});`). The error comes from a stale Metro bundler cache.

**Fix:** Developer must run `npx expo start --clear` before anything else. No code change needed.

**Verification:** App bundles successfully after cache clear.

---

### A2. `isFullBatchLoaded` Deadlock — Cards Never Render When < 10 Available

**Problem:** `useDeckCards.ts:78` sets `isFullBatchLoaded: (query.data?.total ?? 0) >= (20 * 0.5)`, requiring ≥10 cards. When a location yields fewer than 10 results (or edge functions fail), the batch is never marked "loaded," the sync effect in `RecommendationsContext.tsx:416-437` never triggers `setIsBatchTransitioning(false)`, and the completion logic at line 551-591 never fires because `queryFinished = isDeckBatchLoaded` is false. **Result:** Permanent loading spinner or empty deck.

**Root cause:** The threshold conflates "batch loaded" (query finished) with "batch is sufficiently large" (≥10 cards). These are different concerns.

**Fix in `useDeckCards.ts`:**
```typescript
// BEFORE (line 78):
isFullBatchLoaded: (query.data?.total ?? 0) >= (20 * 0.5),

// AFTER — batch is "loaded" when query has settled (not loading AND not fetching):
isFullBatchLoaded: !query.isLoading && !query.isFetching && query.data !== undefined,
```

**Why this is safe:** The existing code at `RecommendationsContext.tsx:428` already handles the "genuinely empty" case (`deckCards.length === 0 && isDeckBatchLoaded && !isDeckFetching`). By making `isDeckBatchLoaded` true whenever the query settles (even with 0 cards), this empty-state branch correctly fires.

**Files:** `app-mobile/src/hooks/useDeckCards.ts` (line 78)

---

### A3. Groceries & Flowers — Missing Pill Resolution

**Problem:** `deckService.ts:resolvePills()` has cases for all 10 categories except `groceries_flowers`. When a user selects Groceries & Flowers, `normalized = 'groceries flowers'` falls through to `categoryFilters.push(cat)` (line 100), silently downgrading it to a filter on curated pills instead of creating its own dedicated pill.

**Fix:** Add a Groceries & Flowers service, converter, and pill case. Mirrors the pattern of the other 10 categories.

**New files:**
- `app-mobile/src/services/groceriesFlowersCardsService.ts` — calls `discover-experiences` edge function with category filter
- Edge function: reuse existing `discover-experiences/index.ts` with `categories=["Groceries & Flowers"]` param

**Modified files:**
- `app-mobile/src/services/deckService.ts` — add `groceries_flowers` pill case + import
- `app-mobile/src/utils/cardConverters.ts` — add `groceriesFlowersToRecommendation()` + type import
- `app-mobile/src/services/deckService.ts:resolvePills()` — add `else if (normalized === 'groceries flowers' || normalized === 'groceries & flowers')` case

**Type:**
```typescript
export interface GroceriesFlowersCard {
  id: string;
  title: string;
  description: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  image: string;
  images: string[];
  placeId: string;
  placeType: string;
  placeTypeLabel: string;
  address: string;
  priceMin: number;
  priceMax: number;
  distanceKm: number;
  travelTimeMin: number;
  matchScore: number;
  isOpenNow: boolean | null;
  openingHours: Record<string, string>;
  website?: string;
}
```

---

### A4. Robust Pill Normalization — Prevent Silent Fallthrough

**Problem:** The `resolvePills()` method uses a fragile chain of `if/else if` string comparisons. Future category additions or DB format changes can silently fall through.

**Fix:** Replace with a lookup map:

```typescript
// In deckService.ts, replace the entire for-loop:
const CATEGORY_PILL_MAP: Record<string, string> = {
  'nature': 'nature',
  'first meet': 'first_meet',
  'first_meet': 'first_meet',
  'picnic park': 'picnic_park',
  'picnic_park': 'picnic_park',
  'picnic': 'picnic_park',
  'drink': 'drink',
  'casual eats': 'casual_eats',
  'casual_eats': 'casual_eats',
  'fine dining': 'fine_dining',
  'fine_dining': 'fine_dining',
  'watch': 'watch',
  'creative & arts': 'creative_arts',
  'creative arts': 'creative_arts',
  'creative_arts': 'creative_arts',
  'play': 'play',
  'wellness': 'wellness',
  'groceries & flowers': 'groceries_flowers',
  'groceries flowers': 'groceries_flowers',
  'groceries_flowers': 'groceries_flowers',
};

for (const cat of cats) {
  const normalized = cat.replace(/_/g, ' ').toLowerCase();
  const pillId = CATEGORY_PILL_MAP[normalized] ?? CATEGORY_PILL_MAP[cat.toLowerCase()];
  if (pillId) {
    pills.push({ id: pillId, type: 'category' });
  } else {
    console.warn(`[DeckService] Unrecognized category: "${cat}" — adding to filters`);
    categoryFilters.push(cat);
  }
}
```

**Files:** `app-mobile/src/services/deckService.ts` (lines 75-102)

---

## Workstream B: Round-Robin Card Delivery (Core UX)

### B1. Verify Round-Robin Interleave Works End-to-End

**Current state:** `roundRobinInterleave()` in `cardConverters.ts:34-52` is correctly implemented — it takes N pill result arrays and interleaves 1-from-each in round order with dedup by `placeId`/`id`.

**Problem:** The round-robin is correct at the algorithm level, but the per-pill limit calculation may produce unbalanced results:

```typescript
// deckService.ts:120
const perPillLimit = Math.ceil(limit / pills.length);
```

With 4 pills and limit=20: `perPillLimit = 5`. After round-robin of [5,5,5,5] = 20 cards. Good.
With 2 pills and limit=20: `perPillLimit = 10`. After round-robin of [10,10] = 20. Good.
With 7 pills and limit=20: `perPillLimit = 3`. After round-robin of [3,3,3,3,3,3,3] = 21. Acceptable.

**Fix:** No algorithmic change needed. The round-robin works. However, add a final `.slice(0, limit)` to cap at exactly 20:

```typescript
// deckService.ts, after line 292:
const interleaved = roundRobinInterleave(results).slice(0, limit);
```

**Files:** `app-mobile/src/services/deckService.ts` (line 292)

---

### B2. 20 Cards Per Batch — Enforce Consistent Delivery

**Current state:** `limit: 20` is hardcoded at `useDeckCards.ts:63`. Good.

**Problem:** Individual edge functions may return fewer than `perPillLimit` cards (sparse location, limited place types). This is expected and gracefully handled. No fix needed — the round-robin handles unequal lengths.

**Verification:** Log total cards returned and active pills in dev builds:
```typescript
// deckService.ts after interleave:
if (__DEV__) {
  console.log(`[DeckService] ${interleaved.length} cards from ${pills.length} pills: ${pills.map(p => p.id).join(', ')}`);
}
```

---

## Workstream C: Batch Cycling & History Review (Feature)

### C1. "Get More" (Generate Next 20)

**Current state:** `generateNextBatch()` exists in `RecommendationsContext.tsx:276-280`. It increments `batchSeed`, which changes the React Query key, triggering a fresh fetch with different randomization. Pre-fetch at 75% consumption exists at line 372-409.

**Problem:** The UI button may not be visible or connected. Need to verify SwipeableCards renders it.

**Fix:** Ensure SwipeableCards shows a "Get More" button when the user reaches the end of the current batch. The button calls `generateNextBatch()` from context. Add a visual "batch counter" showing "Batch 1 of N".

**Files to check/modify:**
- `app-mobile/src/components/SwipeableCards.tsx` — verify end-of-deck state triggers "Get More" UI
- `app-mobile/src/contexts/RecommendationsContext.tsx` — already exports `generateNextBatch`

---

### C2. "Review History" — Browse Previously Swiped Cards

**Current state:** Zustand store tracks batch history via `addDeckBatch()`, `deckBatches[]`, `currentDeckBatchIndex`, `navigateToDeckBatch()`. The context exports these. Batch navigation effect exists at `RecommendationsContext.tsx:360-370`.

**Problem:** No UI surface for browsing history. Need a history sheet or tab.

**Spec:**
- Add a small "History" button (e.g., clock icon) in the deck header bar
- Opens a bottom sheet showing batch list: "Batch 1 (20 cards, 2 min ago)", "Batch 2 (18 cards, 5 min ago)"
- Tapping a batch restores it in the swipe deck via `navigateToDeckBatch(index)`
- Individual card history (swiped left/right) tracked by `user_card_impressions` table — can show per-card swipe status
- Keep it simple v1: batch-level navigation only, not per-card

**New files:**
- `app-mobile/src/components/DeckHistorySheet.tsx` — bottom sheet component

**Modified files:**
- `app-mobile/src/components/SwipeableCards.tsx` — add History button to header
- `app-mobile/src/store/appStore.ts` — verify `DeckBatch` type and history slice

---

## Workstream D: Performance Optimization (< 1 Second Delivery)

### D1. Latency Budget

Target: **< 1 second** from app-ready to first card visible.

| Step | Current | Target | Strategy |
|------|---------|--------|----------|
| Location resolution | 100-500ms | <100ms | Cache last-known location in AsyncStorage |
| Preferences load | 100-200ms | <50ms | Already cached by React Query |
| Edge function calls (parallel) | 1-3s | <500ms | Pool-first serving, Google fallback |
| Card conversion + interleave | <50ms | <50ms | Already fast |
| **Total** | **1.5-4s** | **<700ms** | |

### D2. Instant Location — Cache Last-Known GPS

**Problem:** `useUserLocation` hook fetches location from DB or GPS, which can take 100-500ms on first load.

**Fix:** On every successful location resolution, write `{ lat, lng, timestamp }` to AsyncStorage (`@mingla/lastLocation`). On next app launch, immediately return cached location while fresh GPS resolves in background.

**Files:** `app-mobile/src/hooks/useUserLocation.ts`

**Logic:**
```
1. Read AsyncStorage('@mingla/lastLocation') synchronously via initialData
2. Return cached lat/lng immediately (enables deck query)
3. In parallel: resolve fresh location (GPS or DB pref)
4. When fresh arrives: update state + overwrite cache
5. If fresh location differs significantly (>500m): invalidate deck-cards query
```

### D3. Aggressive React Query Cache

**Current:** staleTime 30min, gcTime 2h. Good defaults.

**Enhancement:** Add `initialData` support — if cards for the same prefs hash exist in Zustand batch history, return them as `initialData` to avoid any loading state:

```typescript
// useDeckCards.ts — add initialData from batch history:
const latestBatch = useAppStore.getState().deckBatches.find(
  b => b.batchSeed === params.batchSeed
);

// In useQuery config:
initialData: latestBatch ? {
  cards: latestBatch.cards,
  deckMode: 'mixed',
  activePills: latestBatch.activePills,
  total: latestBatch.cards.length,
} : undefined,
```

**Files:** `app-mobile/src/hooks/useDeckCards.ts`

### D4. Pool-First Warm Start

**Current:** `warmDeckPool()` fires once on mount but results aren't used — the deck query fires independently.

**Fix:** Make pool warming non-blocking AND share results. The warm call writes to `card_pool` in Supabase — when the deck query fires immediately after, the edge function's `serveCardsFromPipeline()` finds those pool entries and serves them instantly (0 Google API calls). This already works — the warm happens fast enough that by the time the deck query reaches the server, pool is populated.

**Verification:** Add timing logs:
```typescript
// RecommendationsContext.tsx warmDeckPool effect:
const start = Date.now();
deckService.warmDeckPool({...}).then(() => {
  if (__DEV__) console.log(`[Deck] Pool warmed in ${Date.now() - start}ms`);
});
```

### D5. Reduce Edge Function Cold Starts

**Problem:** Deno edge functions have ~200-500ms cold start.

**Fix (no code change needed — operational):**
- Keep at least 1 warm instance via Supabase dashboard > Edge Functions > Min Instances = 1
- For the 3 most critical functions: `discover-experiences`, `generate-curated-experiences`, `new-generate-experience-`

---

## Workstream E: Code Quality & Dead Code Cleanup

### E1. Remove `DeckResponse['deckMode']` Stale Types

**Problem:** `DeckResponse.deckMode` union includes all 11 category slugs + 'curated' + 'mixed'. The UI only cares about 'curated' vs 'mixed'. Simplify.

**Fix:**
```typescript
// deckService.ts DeckResponse:
deckMode: 'curated' | 'category' | 'mixed';
```

### E2. Curated Card Icon Fix

**Problem:** `curatedToRecommendation()` in `cardConverters.ts:79` hardcodes icon:
```typescript
categoryIcon: card.categoryLabel?.toLowerCase() === 'nature' ? 'leaf' : 'compass',
```
All non-nature curated cards get a generic compass icon.

**Fix:** Use the category icon map from `categoryUtils.ts`:
```typescript
import { getCategoryIcon } from '../utils/categoryUtils';
// ...
categoryIcon: getCategoryIcon(card.categoryLabel) || 'compass',
```

**Files:** `app-mobile/src/utils/cardConverters.ts` (line 79)

### E3. Console Warn Cleanup

Replace all `console.warn` with a structured logger or remove in production builds.

---

## Architecture Impact Summary

| Layer | New Files | Modified Files |
|-------|-----------|----------------|
| Mobile Services | `groceriesFlowersCardsService.ts` | — |
| Mobile Hooks | — | `useDeckCards.ts`, `useUserLocation.ts` |
| Mobile Utils | — | `cardConverters.ts` |
| Mobile Services | — | `deckService.ts` |
| Mobile Components | `DeckHistorySheet.tsx` | `SwipeableCards.tsx` |
| Mobile Context | — | `RecommendationsContext.tsx` |
| Edge Functions | — | (none — reuse `discover-experiences`) |
| Database | — | (none — no migration needed) |

---

## Test Cases

1. **Fresh install, default prefs (Nature/Casual Eats/Drink):** App loads → 20 cards appear in <1.5s, round-robin from 3 pills
2. **Select 1 curated + 2 categories (e.g., adventurous + Nature + Drink):** Cards interleave A1,N1,D1,A2,N2,D2...
3. **Select only curated pills (e.g., romantic + first-date):** 20 curated cards, alternating types
4. **Select only 1 category (e.g., Nature):** 20 nature cards, no interleaving needed
5. **Select Groceries & Flowers:** Dedicated pill creates grocery/florist cards
6. **Edge location with < 10 total results:** Cards render (no deadlock), shows available cards
7. **Edge location with 0 results:** "No matches" state displays correctly
8. **"Get More" button:** Generates batch 2 with different cards, old batch preserved
9. **"Review History":** Tapping history shows previous batches, can restore any batch
10. **Kill app + reopen:** Cached location returns cards in <1s, fresh location updates in background

## Success Criteria

- [ ] App bundles and runs without syntax errors
- [ ] Cards appear on first load in solo mode within 1.5 seconds
- [ ] Round-robin interleaving confirmed: selecting 3+ pills shows alternating categories in deck
- [ ] Groceries & Flowers category creates its own dedicated pill and cards
- [ ] "Get More" button generates a new batch of 20 cards
- [ ] "Review History" allows browsing and restoring previous batches
- [ ] 0-card edge case shows empty state (not infinite spinner)
- [ ] Card pool serves from cache on subsequent loads (verified by timing logs)
