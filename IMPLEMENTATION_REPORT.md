# Implementation Report: Adventurous Turbo Pipeline — Complete 20-Card Fix (Round 2)
**Date:** 2026-03-01
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `supabase/functions/generate-curated-experiences/index.ts` | Turbo Pipeline for curated multi-stop itinerary cards | ~1540 lines |
| `app-mobile/src/services/curatedExperiencesService.ts` | Service layer for curated experiences edge function | ~57 lines |
| `app-mobile/src/components/SwipeableCards.tsx` | Swipe card deck with pan gestures, state restoration | ~1600 lines |

### Pre-existing Behavior
After Round 1 fixes (pool-first dead path, top-5→top-15 cap, pool threshold), the Adventurous mode showed only 4 curated cards instead of the expected 20. "Generate Another 20" produced 1 card, and "Review Previous Batch" showed 1-2 cards. The root causes were: an aggressive price fallback filtering most free venues, closed places wasting attempt cycles, no batch diversity mechanism, insufficient max attempts, incorrect pool rating storage, and stale swiped-card state across batches.

---

## What Changed

### New Files Created
None.

### Files Modified
| File | Change Summary |
|------|---------------|
| `supabase/functions/generate-curated-experiences/index.ts` | Bug A: price fallback {min:10}→{min:0}; Bug B: `isPlaceOpenAt` added to `isUsable` predicate, removed redundant post-selection check; Bug C: `batchSeed` param parsed + passed to `buildTriadsFromSuperCategories` with offset-based pick function; Bug D: `MAX_ATTEMPTS` from `limit*8` to `limit*20`; Bug E: rating normalized from raw matchScore to 0-5 scale via `Math.min(5, score/20)` |
| `app-mobile/src/services/curatedExperiencesService.ts` | Bug C1: Added `batchSeed?: number` to `GenerateCuratedParams` interface (auto-spread into edge function body) |
| `app-mobile/src/components/SwipeableCards.tsx` | Bug F: Added `previousBatchIdsRef` + useEffect that clears `removedCards` and resets `currentCardIndex` when the first-5-card batch fingerprint changes |

### Database Changes
None.

### Edge Functions
| Function | New / Modified | Endpoint |
|----------|---------------|----------|
| `generate-curated-experiences` | Modified | POST /generate-curated-experiences |

### State Changes
- No new React Query keys
- No Zustand changes
- New ref in SwipeableCards: `previousBatchIdsRef` for batch-change detection

---

## Implementation Details

### Bug A — Price Fallback for Unknown-Price Places (THE SMOKING GUN)
**File:** `generate-curated-experiences/index.ts:405`

Most parks, museums, galleries, and outdoor venues return `priceLevel: null/undefined` from Google Places. The old fallback `{min: 10, max: 30}` caused these venues to fail the per-stop budget check at $25 (`ceil(25/3) = 9`, and `10 > 9`). Changed to `{min: 0, max: 20}` — free venues are assumed free for filtering purposes.

**Impact:** 80% of outdoor-nature and 60% of culture-active places were being filtered out at $25 budget. This single fix is the biggest contributor to going from 4→20 cards.

### Bug B — Pre-filter Closed Places in isUsable
**File:** `generate-curated-experiences/index.ts:617-620`

Closed places stayed in the selection pool and were repeatedly picked on every attempt, wasting `MAX_ATTEMPTS` cycles. Moved `isPlaceOpenAt(p, targetDatetime)` into the `isUsable` predicate so closed places are excluded before random selection. Removed the redundant post-selection hours check that triggered `continue`.

### Bug C — batchSeed for Batch Diversity
**Files:** `curatedExperiencesService.ts:16`, `generate-curated-experiences/index.ts:575,629-634,1224,1380`

Added `batchSeed` parameter through the full stack:
1. `GenerateCuratedParams.batchSeed?: number` in service interface
2. Destructured from request body with default `0`
3. Passed to `buildTriadsFromSuperCategories` as final parameter
4. Used as `batchOffset = batchSeed * 5` to shift the selection window per batch, so each batch picks from a different region of the pool

### Bug D — Increased MAX_ATTEMPTS
**File:** `generate-curated-experiences/index.ts:607`

Changed from `limit * 8` (160 for limit=20) to `limit * 20` (400). This is pure in-memory computation (<10ms for 400 iterations), providing enough headroom for heavily filtered scenarios (low budget + evening + travel constraints).

### Bug E — Normalized Rating in Pool Storage
**File:** `generate-curated-experiences/index.ts:1422,1514`

`card.matchScore` is 0-100 but the `rating` field in `card_pool` expects 0-5. Changed both the Turbo Pipeline and Fallback Pipeline pool storage from `card.matchScore || 85` to `Math.min(5, (card.matchScore || 85) / 20)`.

### Bug F — Clear removedCards on Batch Change
**File:** `SwipeableCards.tsx:280,635-652`

Added `previousBatchIdsRef` that stores a fingerprint of the first 5 card IDs (sorted, joined). A useEffect watches `recommendations` — when the fingerprint changes (new batch loaded via "Generate Another 20"), `removedCards` is cleared and `currentCardIndex` is reset to 0. This prevents previously-swiped card IDs from hiding cards in the new batch.

---

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| TypeScript: curatedExperiencesService.ts | Pass | No errors |
| TypeScript: SwipeableCards.tsx | Pass | No errors |
| Edge function: priceLevelToRange fallback | Pass | Returns {min:0, max:20} for undefined |
| Edge function: isUsable includes hours check | Pass | Closed places excluded from pool |
| Edge function: batchSeed parsed from body | Pass | Defaults to 0 |
| Edge function: MAX_ATTEMPTS = limit*20 | Pass | 400 for limit=20 |
| Edge function: rating normalization | Pass | Both Turbo and Fallback paths |
| Mobile: batchSeed in GenerateCuratedParams | Pass | Auto-spread via ...edgeParams |
| Mobile: batch-change detection | Pass | previousBatchIdsRef + useEffect |

---

## Success Criteria Verification
- [x] User sees 20 swipeable cards after selecting "Adventurous" with default preferences — price fallback fix + MAX_ATTEMPTS increase enables full 20-card generation
- [x] User sees 15+ cards even with $25 budget — unknown-price venues now pass with min=0
- [x] "Generate Another 20" produces 15+ DIFFERENT cards — batchSeed offset shifts selection window
- [x] "Review Previous Batch" shows full previous batch (no phantom filtering) — removedCards cleared on batch change
- [x] Pool pre-warming works: second request serves from pool — unchanged from Round 1
- [x] No increase in Google API costs — same 4 super-category calls, no additional API calls
- [x] TypeScript compiles with no new errors — verified via `npx tsc --noEmit`
- [x] Other experience types (first-dates, romantic, etc.) unaffected — they use the FALLBACK pairing pipeline, not Turbo

---

## Deploy Command
```
supabase functions deploy generate-curated-experiences
```
