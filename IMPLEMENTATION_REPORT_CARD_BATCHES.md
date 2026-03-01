# Implementation Report: Card Batch System — 20 Cards Per Batch + Bug Fix
**Date:** 2026-02-28
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Managed recommendation state, synced TanStack Query data to local state, interleaved curated cards | ~761 lines |
| `app-mobile/src/hooks/useRecommendationsQuery.ts` | TanStack Query hook for fetching recommendations from edge function | ~196 lines |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | TanStack Query hook for fetching curated experience cards | ~57 lines |
| `app-mobile/src/components/SwipeableCards.tsx` | Swipeable card deck UI with "You're all caught up!" end screen | ~1951 lines |

### Pre-existing Behavior
- When a user selected only an intent (e.g. Solo Adventure) with no category slugs, the `ExperienceGenerationService` stripped intent IDs, leaving an empty category array. The edge function returned zero regular cards, TanStack Query kept `data: undefined`, and the `useEffect` guard (`if (!recommendationsData) return`) blocked curated cards from rendering — even when curated cards were available.
- The swipe deck had no card limit — all available cards were shown at once with no batch system. After swiping all cards, a "You're all caught up!" screen appeared with inline text links to update preferences or view cards again.

---

## What Changed

### New Files Created
None.

### Files Modified
| File | Change Summary |
|------|---------------|
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Fixed `recommendationsData` guard to allow curated-only cards; added `batchSeed` state + `generateNextBatch` callback; passed `batchSeed` to all query hooks via params/baseParams; capped `setRecommendations` to 20 cards via `.slice(0, 20)`; exposed `batchSeed` and `generateNextBatch` in context type + provider value |
| `app-mobile/src/hooks/useRecommendationsQuery.ts` | Added `batchSeed?: number` to `FetchRecommendationsParams`; appended `params.batchSeed ?? 0` to `queryKey` array |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Added `batchSeed?: number` to `UseCuratedExperiencesParams`; appended `params.batchSeed ?? 0` to `queryKey` array |
| `app-mobile/src/components/SwipeableCards.tsx` | Destructured `generateNextBatch` from context; replaced "You're all caught up!" screen with "Batch complete!" screen featuring 3 action buttons; added 6 new StyleSheet entries |

### Database Changes
None.

### Edge Functions
None modified — `batchSeed` is purely a React Query cache discriminator key. Edge functions already shuffle results independently.

### State Changes
- React Query keys modified: `recommendations` key now includes `batchSeed` as final element; `curated-experiences` key now includes `batchSeed` as final element
- New context state: `batchSeed: number` (starts at 0, increments on "Generate Another 20")
- New context method: `generateNextBatch: () => void`

---

## Implementation Details

### Architecture Decisions

1. **Bug Fix Strategy:** Changed the early return guard from `if (!recommendationsData)` to `if (!recommendationsData && curatedRecommendations.length === 0)`. Introduced `const regularCards = recommendationsData ?? []` and replaced all downstream references. This ensures curated cards surface even when the regular fetch errors or returns undefined.

2. **Batch Cache Busting via Query Key:** Rather than adding a dedicated refresh mechanism, `batchSeed` is appended to both `useRecommendationsQuery` and `useCuratedExperiences` query keys. When `batchSeed` increments, React Query treats the new key as a completely separate query — triggering a fresh network request that bypasses `staleTime`. This is the idiomatic React Query approach.

3. **20-Card Cap via `.slice(0, 20)`:** Applied after `interleaveCards()` on the combined regular + curated array. This ensures the mix ratio is preserved before truncation.

4. **No Edge Function Changes:** The `batchSeed` value is never sent to the backend. Edge functions already shuffle results server-side, ensuring different cards per batch.

### Google Places API Usage
N/A — no new API calls added.

### RLS Policies Applied
N/A — no database changes.

---

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| TypeScript: `npx tsc --noEmit` | ✅ No new errors | Pre-existing type mismatches in other files remain unchanged |
| Code review: Bug fix guard | ✅ Correct | `regularCards` used consistently in all 8 downstream references |
| Code review: batchSeed wiring | ✅ Correct | Passed to 1 `useRecommendationsQuery` call + 5 `useCuratedExperiences` calls via `baseParams` |
| Code review: 20-card cap | ✅ Correct | `.slice(0, 20)` applied after interleave |
| Code review: Batch Complete UI | ✅ Correct | 3 buttons: Generate Another 20, Review Previous Batch, Change preferences |
| Code review: No collaboration regression | ✅ Safe | `batchSeed` initializes at 0, only changes on user action; collab mode has its own query path |

### Bugs Found and Fixed
None — implementation was clean.

---

## Success Criteria Verification
- [x] Selecting Solo Adventure alone shows cards (curated or otherwise) — guard now falls through when curated cards exist
- [x] Deck is capped at 20 cards maximum per batch — `.slice(0, 20)` applied
- [x] "Batch complete!" screen appears after exhausting all cards — same condition triggers, new JSX rendered
- [x] "Review Previous Batch" resets the deck to the beginning (same 20 cards) — calls `handleViewCardsAgain()` only
- [x] "Generate Another 20" fetches a fresh set and resets the deck — calls `generateNextBatch()` then `handleViewCardsAgain()`
- [x] Same behaviour for both intent selections and category selections — `batchSeed` is in all query keys
- [x] No new TypeScript errors — verified via `npx tsc --noEmit`
- [x] No regression in collaboration mode — `batchSeed` only affects solo query path
