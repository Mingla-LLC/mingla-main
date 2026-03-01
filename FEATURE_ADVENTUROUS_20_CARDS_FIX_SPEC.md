# Feature: Adventurous Turbo Pipeline — Complete 20-Card Fix
**Date:** 2026-03-01
**Status:** Bug Fix Required (Round 2 — comprehensive scan)
**Requested by:** User still sees only 4 cards (up from 2 after first round), "Generate Another 20" gives 1 card, "Review Previous Batch" shows 1-2

## What Happened in Round 1
Round 1 fixed 3 bugs:
- ✅ Pool-first dead path (empty categories for curated) — `cardPoolService.ts:100`
- ✅ Top-5→Top-15 selection cap — `index.ts:627`
- ✅ Pool threshold — `index.ts:1336`

These brought the count from 2 → 4. But 4 is still not 20. A deeper scan revealed **4 more bugs** that compound with the remaining constraints.

---

## Complete Bug Inventory (6 Bugs)

### Bug A (CRITICAL — THE SMOKING GUN): Unknown-price fallback kills most places
**File:** `supabase/functions/generate-curated-experiences/index.ts` line 404-405
**Symptom:** Most parks, museums, galleries, outdoor venues get filtered out of the triad pool
**Root cause:**
```typescript
function priceLevelToRange(level: string | undefined): { min: number; max: number } {
  return PRICE_LEVEL_RANGES[level ?? ''] ?? { min: 10, max: 30 };  // ← THE BUG
}
```

Most Google Places results for **non-commercial venues** (parks, gardens, beaches, museums, art galleries, etc.) return `priceLevel: null/undefined`. The fallback sets `min: 10`.

The triad builder's budget filter:
```typescript
const perStopBudget = budgetMax > 0 ? Math.ceil(budgetMax / 3) : Infinity;
const isUsable = (p: any) =>
  p.id && !usedPlaceIds.has(p.id) &&
  priceLevelToRange(p.priceLevel).min <= perStopBudget;
```

**At $25 budget:** `perStopBudget = ceil(25/3) = 9`. Fallback min=10 > 9 → **ALL unknown-price places filtered!**
**At $50 budget:** `perStopBudget = ceil(50/3) = 17`. Fallback min=10 ≤ 17 → passes. But still restrictive.
**At $100 budget:** `perStopBudget = ceil(100/3) = 34`. Passes fine.

The 4 super-categories and their unknown-priceLevel rates:
- **outdoor-nature** (parks, gardens, beaches): ~80% have no priceLevel → 80% filtered at $25
- **culture-active** (galleries, museums, theaters): ~60% have no priceLevel → 60% filtered at $25
- **food-dining** (restaurants): ~20% have no priceLevel → mostly fine
- **drink-social** (bars, cafes): ~15% have no priceLevel → mostly fine

With $25 budget: outdoor-nature goes from 20 → ~4 usable. culture-active goes from 20 → ~8 usable. After travel + hours filtering, you get ~2 per category. With C(4,3) = 4 patterns, building 4 triads is the realistic ceiling.

**Fix:** Change the fallback to `{ min: 0, max: 20 }`. Places with no price data should be assumed FREE for filtering purposes (parks ARE free, museums often are). The `max: 20` gives them a reasonable upper bound for display.

---

### Bug B (CRITICAL): Closed places burn attempts without getting excluded
**File:** `supabase/functions/generate-curated-experiences/index.ts` lines 616-644
**Symptom:** `MAX_ATTEMPTS` exhausted quickly; many attempts wasted on repeatedly picking closed places
**Root cause:**
The `isUsable` filter (line 616-618) checks: ID exists, not already used, affordable. But **does NOT check opening hours**.

Opening hours are checked AFTER random selection (line 638-640):
```typescript
if (!isPlaceOpenAt(p1, targetDatetime) ||
    !isPlaceOpenAt(p2, targetDatetime) ||
    !isPlaceOpenAt(p3, targetDatetime)) continue;
```

If a place is closed, the triad is rejected (`continue`), but the place is **NOT added to `usedPlaceIds`** — so it stays in the pool and can be picked again on the next attempt. A closed restaurant in the top 15 will be picked over and over, failing every time, burning through `MAX_ATTEMPTS = limit * 8 = 320`.

**Example:** If 40% of places are closed (evening):
- Each triad attempt: P(all 3 open) = 0.6³ = 21.6%
- 320 attempts × 21.6% = ~69 successful triads → should be enough
- BUT: the random selection favors top-ranked places. If the top 5 in a category include 3 closed ones, those 3 keep getting selected, dropping the success rate much lower than 21.6%.

**Fix:** Add `isPlaceOpenAt` to the `isUsable` predicate, so closed places are pre-filtered BEFORE random selection:
```typescript
const isUsable = (p: any) =>
  p.id && !usedPlaceIds.has(p.id) &&
  priceLevelToRange(p.priceLevel).min <= perStopBudget &&
  isPlaceOpenAt(p, targetDatetime);  // ← ADD THIS
```

---

### Bug C (MODERATE): "Generate Another 20" produces near-identical cards
**File:** `supabase/functions/generate-curated-experiences/index.ts` (Turbo Pipeline) + `app-mobile/src/hooks/useCuratedExperiences.ts`
**Symptom:** Second batch returns 1-4 similar cards instead of 20 fresh ones
**Root cause — 3 sub-issues:**

**C1: `batchSeed` not sent to edge function**
The hook includes `batchSeed` in the React Query key (to trigger refetch) but does NOT include it in the request body. The edge function has no concept of "batch number":
```typescript
// useCuratedExperiences.ts:57-63
queryFn: () =>
  curatedExperiencesService.generateCuratedExperiences({
    ...restParams,    // batchSeed is in restParams but NOT in GenerateCuratedParams interface
    location: location!,
    limit: 20,
    skipDescriptions: true,
  }),
```
`GenerateCuratedParams` doesn't have a `batchSeed` field, so it's silently dropped by TypeScript.

**C2: Turbo cache serves same places for 24h**
`fetchPlacesBySuperCategory` caches super-category results for 24 hours. Batch 2 gets the same cached places → same triads (modulo randomness).

**C3: Pool impressions don't cover Turbo-generated cards immediately**
The Turbo Pipeline stores cards to pool (fire-and-forget), but the pool-first check runs BEFORE Turbo. On batch 2:
1. Pool-first: finds batch 1's 4 cards, all marked as impressions → 0 unseen → falls through
2. Turbo: uses same cached places → builds same ~4 triads
3. Returns ~4 cards (or fewer if randomness picks differently)

**Fix:**
- Add `batchSeed` to `GenerateCuratedParams` interface and pass it to the edge function
- In Turbo Pipeline: use `batchSeed` to offset which places are selected (e.g., `startIndex = batchSeed * 15 % pool.length`)
- Alternatively: pass previously-seen place IDs to the edge function so Turbo can exclude them

---

### Bug D (MODERATE): `MAX_ATTEMPTS` too low for filtered pools
**File:** `supabase/functions/generate-curated-experiences/index.ts` line 610
**Current:** `const MAX_ATTEMPTS = limit * 8;` → 160 for limit=20
**Problem:** After budget and hours filtering, only ~30-50% of attempts succeed. With 160 attempts and 20% success rate (low budget + evening), only 32 successful triads. But those 32 need to pass the TOTAL budget check (line 699-700) too, which rejects more.

**Fix:** Increase to `const MAX_ATTEMPTS = limit * 20;` → 400. This gives enough headroom for heavily filtered scenarios without noticeable latency (the loop is pure in-memory computation, <10ms for 400 iterations).

---

### Bug E (LOW): Pool stores `matchScore` in `rating` field
**File:** `supabase/functions/generate-curated-experiences/index.ts` line 1422
```typescript
rating: card.matchScore || 85,  // matchScore is 0-100, rating should be 0-5
```
This causes `popularity_score` in `card_pool` to be wildly inflated (`85 * log10(1) = 0`... actually this evaluates to 0 because `reviewCount = 0`). Not blocking, but the pool ordering is wrong.

**Fix:** `rating: (card.matchScore || 85) / 20` → normalizes back to 0-5 scale.

---

### Bug F (LOW): "Review Previous Batch" only stores 1 batch in memory
**File:** `app-mobile/src/contexts/RecommendationsContext.tsx` line 265, 371, 399-405
**Behavior:** `previousBatchRef.current = recommendations` — overwrites on each `generateNextBatch()`. Only the immediately previous batch can be restored.
**Symptom:** If user had 4 cards in batch 1, swiped 2-3, then generated batch 2, "Review Previous Batch" restores the 4-card batch. But the user may see 1-2 because the swiped cards are still in `removedCards` state (SwipeableCards doesn't clear `removedCards` on batch change).

**Root cause in SwipeableCards:** `removedCards` state is only cleared when `refreshKey` or `currentMode` changes (line 519-527). `batchSeed` changes don't trigger a clear. So swiped card IDs persist across batches.

**Why this mostly works for curated cards:** Curated cards have random IDs (`curated-${Date.now()}-...`), so old removedCards don't match new cards. BUT: regular cards (from `new-generate-experience-`) have stable IDs based on Google place IDs. If the same regular cards appear in both batches, they'll be filtered by `removedCards`.

**Fix:** Clear `removedCards` when `batchSeed` changes. The simplest approach: detect `recommendations` prop change and clear removed state.

---

## Architecture Impact

### Modified Files (All Server-Side + 1 Mobile)
| File | Changes |
|------|---------|
| `supabase/functions/generate-curated-experiences/index.ts` | Bug A: price fallback; Bug B: hours in isUsable; Bug D: MAX_ATTEMPTS; Bug E: rating normalization |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Bug C1: pass batchSeed to service |
| `app-mobile/src/services/curatedExperiencesService.ts` | Bug C1: add batchSeed to GenerateCuratedParams |
| `app-mobile/src/components/SwipeableCards.tsx` | Bug F: clear removedCards on batch change |

### No New Files
### No Database Changes

---

## Detailed Fixes

### Fix A: Change price fallback for unknown places
**File:** `supabase/functions/generate-curated-experiences/index.ts`
```typescript
// BEFORE (line 404-405):
function priceLevelToRange(level: string | undefined): { min: number; max: number } {
  return PRICE_LEVEL_RANGES[level ?? ''] ?? { min: 10, max: 30 };
}

// AFTER:
function priceLevelToRange(level: string | undefined): { min: number; max: number } {
  return PRICE_LEVEL_RANGES[level ?? ''] ?? { min: 0, max: 20 };
}
```

**Impact:** Parks, museums, beaches, galleries with no priceLevel now have min=0 instead of min=10. At $25 budget: `0 ≤ 9` ✓. Dramatic increase in usable places across ALL budget tiers.

---

### Fix B: Pre-filter closed places in isUsable
**File:** `supabase/functions/generate-curated-experiences/index.ts`
```typescript
// BEFORE (lines 616-618):
const isUsable = (p: any) =>
  p.id && !usedPlaceIds.has(p.id) &&
  priceLevelToRange(p.priceLevel).min <= perStopBudget;

// AFTER:
const isUsable = (p: any) =>
  p.id && !usedPlaceIds.has(p.id) &&
  priceLevelToRange(p.priceLevel).min <= perStopBudget &&
  isPlaceOpenAt(p, targetDatetime);
```

Then REMOVE the redundant post-selection check:
```typescript
// REMOVE lines 638-640:
// if (!isPlaceOpenAt(p1, targetDatetime) ||
//     !isPlaceOpenAt(p2, targetDatetime) ||
//     !isPlaceOpenAt(p3, targetDatetime)) continue;
```

**Impact:** Closed places are excluded from the pool upfront. No wasted attempts on repeatedly picking closed venues. The filtered pool accurately represents what's available, so the top-15 selection window operates on OPEN places only.

---

### Fix C: Send batchSeed to edge function + use it for diverse selection
**File 1:** `app-mobile/src/services/curatedExperiencesService.ts`
```typescript
// Add batchSeed to interface:
interface GenerateCuratedParams {
  // ... existing fields ...
  batchSeed?: number;  // ← ADD
}

// Pass it in the body:
async generateCuratedExperiences(params: GenerateCuratedParams): Promise<CuratedExperienceCard[]> {
  const { sessionId, ...edgeParams } = params;
  const { data, error } = await supabase.functions.invoke('generate-curated-experiences', {
    body: { ...edgeParams, session_id: sessionId },
  });
  // ...
}
```

**File 2:** `supabase/functions/generate-curated-experiences/index.ts`
Parse `batchSeed` from body:
```typescript
// Line 1225 — add to destructure:
let { ..., batchSeed = 0 } = body;
```

Use in `buildTriadsFromSuperCategories` — offset the starting pick:
```typescript
// Inside buildTriadsFromSuperCategories, change random selection:
// BEFORE:
const p1 = pool1[Math.floor(Math.random() * Math.min(pool1.length, 15))];

// AFTER:
const offset = batchSeed * 5; // Shift selection window per batch
const pickFrom = (pool: any[]) => {
  const maxIdx = Math.min(pool.length, 15);
  const startIdx = Math.min(offset % pool.length, pool.length - 1);
  const idx = (startIdx + Math.floor(Math.random() * maxIdx)) % pool.length;
  return pool[idx];
};
const p1 = pickFrom(pool1);
const p2 = pickFrom(pool2);
const p3 = pickFrom(pool3);
```

This shifts the selection window by 5 places per batch, ensuring batch 2 picks from a different region of the pool than batch 1.

---

### Fix D: Increase MAX_ATTEMPTS
**File:** `supabase/functions/generate-curated-experiences/index.ts`
```typescript
// BEFORE (line 610):
const MAX_ATTEMPTS = limit * 8;

// AFTER:
const MAX_ATTEMPTS = limit * 20;
```

---

### Fix E: Normalize rating in pool storage
**File:** `supabase/functions/generate-curated-experiences/index.ts`
```typescript
// BEFORE (line 1422):
rating: card.matchScore || 85,

// AFTER:
rating: Math.min(5, (card.matchScore || 85) / 20),
```

---

### Fix F: Clear removedCards on batch change in SwipeableCards
**File:** `app-mobile/src/components/SwipeableCards.tsx`

Add `batchSeed` (or the `recommendations` array identity) to the state-reset logic. Simplest approach — detect when the recommendations array changes significantly (more than just a filter):

In the existing `useEffect` that checks `preferencesChanged || modeChanged` (around line 519), add a batch-change detection:

```typescript
// Add a ref to track previous recommendation IDs
const previousBatchIdsRef = useRef<string>('');

useEffect(() => {
  if (!recommendations.length) return;

  const currentBatchIds = recommendations.map(r => r.id).sort().join(',');
  const batchChanged = previousBatchIdsRef.current !== '' &&
    previousBatchIdsRef.current !== currentBatchIds;

  if (batchChanged) {
    setRemovedCards(new Set());
    setCurrentCardIndex(0);
  }

  previousBatchIdsRef.current = currentBatchIds;
}, [recommendations]);
```

---

## Expected Impact After All Fixes

| Scenario | Before | After |
|----------|--------|-------|
| $25 budget, walking 30min, daytime | 2-4 cards | 15-20 cards |
| $50 budget, walking 30min, daytime | 4-8 cards | 20 cards |
| $100 budget, driving 30min, daytime | 10-15 cards | 20 cards |
| $25 budget, walking 30min, 10pm | 1-2 cards | 8-15 cards |
| "Generate Another 20" (batch 2) | 1 card | 15-20 cards |
| "Review Previous Batch" | 1-2 visible | All cards from previous batch |

## Test Cases
1. **$25 budget, walking 30min, daytime:** Should return 15+ curated cards
2. **$100 budget, walking 30min, daytime:** Should return 20 curated cards
3. **Generate Another 20 (batch 2):** Should return 15+ DIFFERENT cards
4. **Generate Another 20 (batch 3):** Still 10+ cards (diversity decreasing is OK)
5. **Review Previous Batch after batch 2:** Shows ALL cards from batch 1 (not filtered by swipes)
6. **Late night (11pm), $50 budget:** Should return 10+ cards (open venues only)
7. **Pool pre-warming on app load:** Second request within 30min serves from pool (0 API calls)

## Success Criteria
- [ ] User sees 20 swipeable cards after selecting "Adventurous" with default preferences
- [ ] User sees 15+ cards even with $25 budget
- [ ] "Generate Another 20" produces 15+ DIFFERENT cards
- [ ] "Review Previous Batch" shows full previous batch (no phantom filtering)
- [ ] Pool pre-warming works: second request serves from pool
- [ ] No increase in Google API costs
- [ ] TypeScript compiles with no new errors
- [ ] Other experience types (first-dates, romantic, etc.) unaffected
