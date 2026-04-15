# INVESTIGATION: ORCH-0431 — Deck Stuck on Exhausted/Empty After Preference Change

**Date:** 2026-04-14
**Severity:** S1-high
**Surface:** Discovery / Solo deck
**Confidence:** HIGH — every file read, state machine walked step by step, race condition proven

---

## Symptom

User exhausts all cards in the swipe deck (sees "you've seen everything" screen), then
changes preferences. Expected: loading skeleton appears immediately while new cards fetch.
Actual: the exhausted/empty screen persists with no visual feedback. Cards eventually
appear out of nowhere.

**Expected:** EXHAUSTED/EMPTY -> INITIAL_LOADING (skeleton) -> LOADED (new cards)
**Actual:** EXHAUSTED/EMPTY -> EMPTY (no transition) -> LOADED (cards pop in)

---

## Investigation Manifest

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `app-mobile/src/contexts/RecommendationsContext.tsx` | 635-656 | Refresh key handler — what resets on pref change |
| 2 | `app-mobile/src/contexts/RecommendationsContext.tsx` | 1054-1110 | deckUIState state machine — branch evaluation |
| 3 | `app-mobile/src/contexts/RecommendationsContext.tsx` | 916-974 | Mark Fetch Complete effect — race condition |
| 4 | `app-mobile/src/contexts/RecommendationsContext.tsx` | 612-625 | Exhaustion setter — re-trigger risk |
| 5 | `app-mobile/src/contexts/RecommendationsContext.tsx` | 837-907 | Mode transition handler — correct reference implementation |
| 6 | `app-mobile/src/hooks/useDeckCards.ts` | 116-168 | Query key structure + placeholderData |
| 7 | `app-mobile/src/components/SwipeableCards.tsx` | 614-620 | effectiveUIState derivation |
| 8 | `app-mobile/src/components/AppHandlers.tsx` | 438-560 | handleSavePreferences — refreshKey increment |

---

## Findings

### 1. ROOT CAUSE: Refresh Key Handler Missing `hasCompletedFetchForCurrentMode` Reset

**Classification:** Root Cause
**Confidence:** HIGH

**File + line:** `app-mobile/src/contexts/RecommendationsContext.tsx:635-656`

**Exact code (refresh key handler):**
```typescript
useEffect(() => {
  if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
    setBatchSeedReady(false);
    setBatchSeed(0);
    setIsExhausted(false);          // <-- resets exhaustion
    setHasMoreCards(true);
    setIsRefreshingAfterPrefChange(true);
    setDismissedCards([]);
    accumulatedCardsRef.current = [];
    // ... AsyncStorage cleanup ...
    sessionServedIdsRef.current.clear();
    consecutiveSkipCountRef.current = 0;
    // MISSING: setHasCompletedFetchForCurrentMode(false)
    // MISSING: setRecommendations(EMPTY_CARDS)
  }
  previousRefreshKeyRef.current = refreshKey;
}, [refreshKey, user?.id]);
```

**What it does:** Resets most deck state on preference change but leaves
`hasCompletedFetchForCurrentMode = true` and `recommendations = []` (unchanged from
exhaustion state).

**What it should do:** Reset `hasCompletedFetchForCurrentMode` to `false` so the state
machine recognizes this as a fresh fetch cycle and shows INITIAL_LOADING.

**Causal chain:**
1. User exhausts all cards -> `recommendations = []`, `hasCompletedFetchForCurrentMode = true`, `isExhausted = true`
2. User changes preferences -> refreshKey increments
3. Refresh key handler fires:
   - `isExhausted` -> false (correct)
   - `hasCompletedFetchForCurrentMode` -> **still true** (BUG)
   - `recommendations` -> **still []** (never reset)
4. State machine evaluates (line 1054-1110):
   - Line 1056: `locationError` -> false -> skip
   - Line 1062: `soloDeckError && recommendations.length === 0 && hasCompletedFetchForCurrentMode` -> skip (no error)
   - Line 1067: `isModeTransitioning` -> false -> skip
   - Line 1072: `!hasCompletedFetchForCurrentMode && recommendations.length === 0` -> **!true && true = false** -> SKIP (this is where it SHOULD land)
   - Line 1077: `isExhausted && recommendations.length === 0` -> false (isExhausted was reset) -> skip
   - Line 1086: `hasCompletedFetchForCurrentMode && recommendations.length === 0 && !isModeTransitioning` -> **true && true && true = TRUE** -> **LANDS HERE: returns EMPTY**
5. UI renders EMPTY state instead of INITIAL_LOADING skeleton

**Verification:** Compare with mode transition handler (line 868-881) which correctly
resets `setHasCompletedFetchForCurrentMode(hasCachedCards)`. The two handlers represent
the same logical operation (invalidate old deck, fetch new one) but the refresh key
handler was written with an incomplete reset set.

---

### 2. CONTRIBUTING FACTOR: `placeholderData` Prevents `isDeckLoading` After Key Change

**Classification:** Contributing Factor
**Confidence:** HIGH

**File + line:** `app-mobile/src/hooks/useDeckCards.ts:167`

**Exact code:**
```typescript
placeholderData: (previousData) => previousData,
```

**What it does:** When the React Query key changes (new preferences = new key), React
Query keeps the old data as placeholder. With placeholder data present, `query.isLoading`
stays `false`. Only `query.isFetching` becomes `true`.

**Why this matters:** The Mark Fetch Complete effect's settled-state condition at line 946
checks `!isDeckLoading` (which maps to `query.isLoading`). Because placeholderData keeps
this false, the settled-state condition can evaluate to true immediately after a preference
change — even though new data hasn't arrived yet.

**Race scenario:** If Finding 1 is fixed (reset `hasCompletedFetchForCurrentMode = false`),
the very next render could trigger the Mark Fetch Complete effect:
- Guard at line 928: `isModeTransitioning(false) || !hasCompletedFetchForCurrentMode(false)` -> `false || true = true` -> enters body
- Settled-state at line 946: `!isLoadingLocation(false) && !isLoadingPreferences(false) && !isDeckLoading(false, due to placeholderData) && !isModeTransitioning(false)` -> **all true** -> `shouldMarkComplete = true`
- Result: `hasCompletedFetchForCurrentMode` immediately set back to `true`
- State machine: back to EMPTY before new cards arrive

**This means Finding 1 alone is NOT sufficient.** The race condition must also be addressed.

---

### 3. CONTRIBUTING FACTOR: Settled-State Condition Missing `isRefreshingAfterPrefChange` Guard

**Classification:** Contributing Factor
**Confidence:** HIGH

**File + line:** `app-mobile/src/contexts/RecommendationsContext.tsx:946`

**Exact code:**
```typescript
(!isLoadingLocation && !isLoadingPreferences && !isDeckLoading && !isModeTransitioning)
```

**What it does:** Declares the system "settled" based on four conditions. Does NOT check
`isRefreshingAfterPrefChange`. After a preference change, `isRefreshingAfterPrefChange`
is `true` (set at line 643), but this flag is not consulted by the settled-state condition.

**What it should do:** Include `&& !isRefreshingAfterPrefChange` to prevent premature
completion during the preference-change fetch cycle. This mirrors the `!isModeTransitioning`
guard that protects mode transitions.

**Asymmetry evidence:**
- Mode transitions: protected by `!isModeTransitioning` at line 946 + explicit note at line 940
- Pref changes: `isRefreshingAfterPrefChange` exists (line 643) but is NOT included in line 946
- Both represent "new deck loading, old state invalid" — should have equivalent guards

---

### 4. HIDDEN FLAW: `recommendations` State Diverges from `accumulatedCardsRef`

**Classification:** Hidden Flaw
**Confidence:** MEDIUM

**File + line:** `app-mobile/src/contexts/RecommendationsContext.tsx:645`

**Exact code:**
```typescript
accumulatedCardsRef.current = [];
// No corresponding: setRecommendations(EMPTY_CARDS)
```

**What it does:** Clears the ref but leaves `recommendations` state holding old cards.
In the non-exhausted case (user has cards, changes prefs), `recommendations` still
contains old-preference cards.

**Impact:** In the non-exhausted scenario, even after fixing Findings 1-3, the state
machine at line 1095 would return `LOADED` with stale old-preference cards (because
`recommendations.length > 0`). The user would briefly see cards from their OLD preferences
while new ones fetch. Whether this is a bug or acceptable UX (show something while
loading) depends on product intent.

**Note:** The `placeholderData` in useDeckCards serves a similar purpose (keep old data
visible during fetch). But `recommendations` state and `deckCards` from the hook are
separate — `recommendations` is derived from `accumulatedCardsRef` in the card accumulation
effect (line 805-835), not directly from `deckCards`. Clearing the ref without clearing
state creates a divergence window.

---

### 5. OBSERVATION: Mode Transition Handler Is Correct Reference

**Classification:** Observation

The mode transition handler at line 868-881 performs a strictly more complete reset
than the refresh key handler:

| State Variable | Mode Transition (868) | Refresh Key (635) |
|---------------|----------------------|-------------------|
| `isModeTransitioning` | set to `!hasCachedCards` | NOT SET |
| `hasCompletedFetchForCurrentMode` | set to `hasCachedCards` | **NOT SET** |
| `batchSeed` | 0 | 0 |
| `isExhausted` | false | false |
| `hasMoreCards` | true | true |
| `dismissedCards` | [] | [] |
| `accumulatedCardsRef` | [] | [] |
| `recommendations` (via accumulation) | reset via full state clear | **NOT RESET** |
| `sessionServedIdsRef` | clear | clear |
| `consecutiveSkipCountRef` | 0 | 0 |
| `batchSeedReady` | not needed (setBatchSeed(0) is sync) | false then true |
| `isRefreshingAfterPrefChange` | not set | true |

The two missing resets in the refresh key handler are exactly the two that cause this bug.

---

## Five-Layer Cross-Check

| Layer | Status | Finding |
|-------|--------|---------|
| **Docs** | INTENT vs CODE contradiction | Line 1071 comment says INITIAL_LOADING covers "pref change — no cards yet." Code doesn't deliver this. |
| **Schema** | N/A | Pure client-side state management |
| **Code** | BUG CONFIRMED | Refresh key handler missing 2 resets that mode transition handler has |
| **Runtime** | BUG CONFIRMED | State machine evaluates to EMPTY instead of INITIAL_LOADING after pref change from exhausted state |
| **Data** | CONSISTENT | `recommendations = []` is correct for exhausted state; the problem is the state machine misinterpreting what this means |

---

## Blast Radius

| Scenario | Affected? | Severity |
|----------|-----------|----------|
| Exhausted -> pref change | YES (reported bug) | High — user sees dead screen |
| EMPTY (0 results) -> pref change | YES (same code path) | High — same dead screen |
| Cards visible -> pref change | POSSIBLE (Finding 4) | Medium — stale cards briefly visible |
| Mode switch (solo <-> collab) | NO — mode transition handler is correct | N/A |
| First load | NO — `hasCompletedFetchForCurrentMode` starts as `false` | N/A |
| Location change | NO — goes through different path | N/A |
| Collab preferences | NO — different mechanism | N/A |

**Solo-only bug.** Collab mode is not affected.

---

## Invariant Violations

1. **"Response shape truthful in ALL states"** — EMPTY state shown when truth is LOADING
2. **State machine's own documented intent** — line 1071 comment says pref change should show INITIAL_LOADING, but code doesn't deliver

---

## Fix Direction (NOT a spec — direction only)

Three changes needed, all in `RecommendationsContext.tsx`:

1. **Refresh key handler (line 635-656):** Add `setHasCompletedFetchForCurrentMode(false)` and `setRecommendations(EMPTY_CARDS)` to match mode transition handler's reset completeness.

2. **Settled-state condition (line 946):** Add `&& !isRefreshingAfterPrefChange` guard to prevent the Mark Fetch Complete effect from prematurely re-setting `hasCompletedFetchForCurrentMode` during a pref-change fetch cycle.

3. **Decision needed on Finding 4:** Should non-exhausted pref changes show skeleton (clear recommendations) or show stale cards as placeholder (current behavior)? This is a product decision, not a bug per se.

All three changes are confined to a single file. No schema changes. No edge function changes. No component changes needed (SwipeableCards already handles INITIAL_LOADING correctly with the skeleton).

---

## Regression Prevention

- The refresh key handler and mode transition handler should be audited together whenever either is modified — they represent the same logical operation with different trigger sources
- A comment should be added to the refresh key handler listing every state variable it must reset, cross-referencing the mode transition handler
- The settled-state condition should have an explicit comment listing every "in-progress" flag it must guard against

---

## Discoveries for Orchestrator

None — this investigation is self-contained. No side issues discovered.
