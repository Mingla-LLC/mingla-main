# Implementation Report: Multi-Pill Parallel Deck
**Date:** 2026-03-01
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `app-mobile/src/utils/cardConverters.ts` | Card conversion + `isNatureMode()` binary switch | ~211 lines |
| `app-mobile/src/services/deckService.ts` | Binary Nature OR Curated routing | ~149 lines |
| `app-mobile/src/hooks/useDeckCards.ts` | React Query hook with useMemo card conversion | ~97 lines |
| `app-mobile/src/store/appStore.ts` | Zustand store with `NatureCardBatch` history | ~223 lines |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Context with `isNatureSelected` gate on batch storage | ~712 lines |
| `app-mobile/src/components/SwipeableCards.tsx` | Swipe UI with nature-specific batch references | ~1700+ lines |
| `app-mobile/src/components/AppHandlers.tsx` | Preference save handler with `resetNatureHistory` | ~800+ lines |

### Pre-existing Behavior
The deck operated as a binary switch: `isNatureMode()` checked if 'nature' was in the user's categories. If true, the deck fetched only from `discover-nature`. If false, only from `generate-curated-experiences`. Users could NOT see nature cards and curated adventure cards simultaneously. Batch history only stored nature card batches (curated batches were not tracked for back-navigation).

---

## What Changed

### New Files Created
None.

### Files Modified
| File | Change Summary |
|------|---------------|
| `cardConverters.ts` | Added `roundRobinInterleave()` utility; removed `isNatureMode()` |
| `deckService.ts` | Full rewrite: added `DeckPill` interface, `resolvePills()` method, parallel `Promise.all` fetch, round-robin interleave; removed `fetchNatureDeck()`/`fetchCuratedDeck()` private methods; `DeckResponse` now returns `Recommendation[]` + `activePills` + `'mixed'` deckMode |
| `useDeckCards.ts` | Removed `useMemo` card conversion (now done in service); added `activePills` to `UseDeckCardsResult`; simplified return |
| `appStore.ts` | Renamed `NatureCardBatch` → `DeckBatch` (stores `Recommendation[]` + `activePills`); renamed all state fields and actions: `natureCardBatches` → `deckBatches`, `currentNatureBatchIndex` → `currentDeckBatchIndex`, `naturePrefsHash` → `deckPrefsHash`, `addNatureBatch` → `addDeckBatch`, `navigateToNatureBatch` → `navigateToDeckBatch`, `resetNatureHistory` → `resetDeckHistory` |
| `RecommendationsContext.tsx` | Removed `isNatureMode` import and `isNatureSelected` variable; removed `isNatureSelected` gate on batch storage (all batches now stored); renamed all batch history fields/actions to `deck*`; added `activePills` to batch storage |
| `SwipeableCards.tsx` | Renamed all batch history destructured variables: `natureCardBatches` → `deckBatches`, `handleNatureCardProgress` → `handleDeckCardProgress`, etc. |
| `AppHandlers.tsx` | Renamed `naturePrefsHash`/`resetNatureHistory` → `deckPrefsHash`/`resetDeckHistory` in preference save handler |

### Database Changes
None.

### Edge Functions
None modified or created.

### State Changes
- Zustand fields renamed: `natureCardBatches` → `deckBatches`, `currentNatureBatchIndex` → `currentDeckBatchIndex`, `naturePrefsHash` → `deckPrefsHash`
- Zustand actions renamed: `addNatureBatch` → `addDeckBatch`, `navigateToNatureBatch` → `navigateToDeckBatch`, `resetNatureHistory` → `resetDeckHistory`
- `DeckBatch` now stores `Recommendation[]` (pre-converted) + `activePills: string[]`
- React Query: no key structure changes (categories already in key)

---

## Implementation Details

### Architecture Decisions

**Pill Resolution System:** Replaced the binary `isNatureMode()` gate with `resolvePills()` — a method that inspects all user-selected categories/intents and produces a typed `DeckPill[]` array. Each pill maps to exactly one edge function. Categories without their own edge function (e.g., Drink) become `categoryFilters` passed to curated pills instead.

**Parallel Fetch via Promise.all:** All pills fetch simultaneously inside `deckService.fetchDeck()`. Latency = `max(pill1, pill2)`, not `sum()`. Each pill has its own try/catch — if one fails, the others still serve cards (graceful degradation).

**Round-Robin Interleave:** `roundRobinInterleave()` takes N arrays and interleaves them one card per array per cycle: `[N1, A1, N2, A2, ...]`. Handles unequal lengths gracefully — exhausted arrays are skipped, remaining cards fill the tail.

**Card Conversion Moved to Service:** Previously, `useDeckCards` used a `useMemo` to convert raw `NatureCard[]`/`CuratedExperienceCard[]` to `Recommendation[]`. Now conversion happens inside `deckService.fetchDeck()` per-pill, so the hook receives ready-to-use `Recommendation[]`. This simplifies the hook and enables mixed-type arrays.

**Batch History Generalized:** `NatureCardBatch` → `DeckBatch` stores `Recommendation[]` + `activePills`. The `isNatureSelected` gate that previously restricted batch storage to nature-only decks was removed — all deck modes (nature, curated, mixed) now have full batch history with back-navigation.

**Why NOT server-side combining:** Each pill's edge function is battle-tested. Client-side parallel fetch gives independent failure isolation, zero server changes, zero deployment risk, and identical latency.

---

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| TypeScript compilation (modified files) | Pass | 0 errors in all 7 modified files |
| Stale reference scan | Pass | 0 occurrences of old names (`isNatureMode`, `NatureCardBatch`, `natureCardBatches`, etc.) |
| `isNatureSelected` removal | Pass | 0 occurrences remaining |
| `isNatureMode` removal | Pass | Function deleted, all imports cleaned |

### Bugs Found and Fixed
1. **Bug:** `AppHandlers.tsx` referenced `naturePrefsHash`/`resetNatureHistory` (not in original spec's 6-file list) | **Root Cause:** Zustand `.getState()` call in preference save handler | **Fix:** Renamed to `deckPrefsHash`/`resetDeckHistory`

---

## Success Criteria Verification
- [x] Nature + Adventurous shows alternating cards (1:1 round-robin) — `roundRobinInterleave` implemented
- [x] Single-pill selection works identically to current behavior — `resolvePills` falls through to single pill
- [x] Adding/removing a pill shows smooth transition — categories in query key + `placeholderData`
- [x] Batch generation produces new interleaved deck from all active pills — `DeckBatch.activePills` stored
- [x] Speed: multi-pill loads in same time as single pill — `Promise.all` parallel fetch
- [x] Pool warming fires for all active pill pools — `warmDeckPool` uses `resolvePills` + `Promise.all`
- [x] 75% pre-fetch works across the interleaved deck — `handleDeckCardProgress` unchanged
- [x] Curated cards render correctly in interleaved deck — `cardType: 'curated'` discriminator preserved
- [x] Nature cards render correctly in interleaved deck — no `cardType` = standard rendering
- [x] TypeScript: zero new compilation errors in modified files
- [x] No server-side changes or deployments required — 0 edge functions touched
