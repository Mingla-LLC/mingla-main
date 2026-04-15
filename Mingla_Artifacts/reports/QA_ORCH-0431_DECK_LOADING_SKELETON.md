# QA REPORT: ORCH-0431 — Deck Loading Skeleton on Preference Change

**Date:** 2026-04-14
**Mode:** TARGETED (orchestrator-dispatched)
**Verdict:** PASS (code analysis — device confirmation recommended)
**Confidence:** HIGH

---

## Summary

The fix correctly addresses all four investigation findings. Three surgical changes to one
file, all verified independently against the state machine logic. No regressions found in
cold start, mode switching, pagination, or background/foreground transitions. All four
branches of the `shouldMarkComplete` condition verified safe — the race condition is fully
closed, not just partially guarded.

---

## Test Results

### PRIMARY — The Reported Bug

| # | Test | Verdict | Evidence |
|---|------|---------|----------|
| T-01 | Exhausted → pref change | **PASS** | State machine: `!hasCompletedFetchForCurrentMode(true) && recs===0(true)` → INITIAL_LOADING. Mark Fetch Complete blocked by `isRefreshingAfterPrefChange` guard AND `isDeckBatchLoaded=false`. Both gates verified. |
| T-02 | Exhausted → pref change (price tier) | **PASS** | Same code path as T-01. refreshKey increments regardless of which preference changed. Verified at AppHandlers.tsx:538-539. |
| T-03 | Exhausted → pref change (travel mode) | **PASS** | Same code path. |

### SECONDARY — Other Entry States

| # | Test | Verdict | Evidence |
|---|------|---------|----------|
| T-04 | Empty deck → pref change | **PASS** | Before: `hasCompleted=true, recs=[], isExhausted=false` → EMPTY. After: `hasCompleted=false, recs=[]` → INITIAL_LOADING. |
| T-05 | Cards visible → pref change | **PASS** | `setRecommendations(EMPTY_CARDS)` at line 646 clears visible cards. State machine: `!hasCompleted && recs===0` → INITIAL_LOADING. Old cards replaced by skeleton. |
| T-06 | No actual change → save | **PASS (conditional)** | Depends on whether PreferencesSheet increments refreshKey on no-change save. If it does: skeleton flash then same cards reload. If not: no change. Neither is a bug. Not controlled by this fix. |

### STRESS — Race Conditions

| # | Test | Verdict | Evidence |
|---|------|---------|----------|
| T-07 | Rapid pref changes (3x) | **PASS** | Each refreshKey increment re-runs handler, re-setting all state. `isRefreshingAfterPrefChange` stays true throughout (set true on each change, settle effect can't fire while fetching). Final query resolves → settle → Mark Fetch Complete → LOADED. |
| T-08 | Pref change during fetch | **PASS** | Same as T-07. Second refreshKey change re-resets everything. React Query abandons first query (new key), starts second. |
| T-09 | Double exhaust cycle | **PASS** | Second exhaustion sets `isExhausted=true`, `hasCompletedFetchForCurrentMode=true`, `recs=[]`. Second pref change fires refresh handler → resets both → INITIAL_LOADING. Same path as T-01. |

### REGRESSION — Must Not Break

| # | Test | Verdict | Evidence |
|---|------|---------|----------|
| T-10 | Cold start | **PASS** | Initial state: `hasCompletedFetchForCurrentMode=false`, `isRefreshingAfterPrefChange=false`. Both unchanged (line 124-129). Cold start → INITIAL_LOADING → fetch → LOADED. |
| T-11 | Mode switch | **PASS** | Mode handler (line 873-886) untouched. `isRefreshingAfterPrefChange` is false during mode switches — new guard is transparent. |
| T-12 | Background → foreground | **PASS** | refreshKey doesn't change on background/foreground. Handler doesn't fire. No state reset. |
| T-13 | Normal swiping | **PASS** | Swiping doesn't touch refreshKey, `hasCompletedFetchForCurrentMode`, or `isRefreshingAfterPrefChange`. All paths transparent. |
| T-14 | Prefetch / pagination | **PASS** | `setBatchSeed(prev+1)` doesn't touch refreshKey. `isRefreshingAfterPrefChange` stays false. Settled-state guard transparent. Mark Fetch Complete fires normally via Branch 1 (`queryFinished && hasQueryResult`). |

### EDGE CASES

| # | Test | Verdict | Evidence |
|---|------|---------|----------|
| T-15 | Bad network | **PASS (code analysis)** | State reset is synchronous (local state). Skeleton appears immediately regardless of network. If fetch fails: `soloDeckError` eventually set → state machine line 1071: `soloDeckError && recs===0 && hasCompleted(true after settle)` → ERROR state with retry. 20s safety timeout at line 681-689 forces completion if nothing resolves. Not stuck. |
| T-16 | Net-zero pref change | **PASS (conditional)** | Same as T-06. Behavior depends on whether PreferencesSheet detects no-change. Not controlled by this fix. |

---

## Forensic Findings

### All Four shouldMarkComplete Branches Verified

The implementor only guarded the fourth branch (settled-state). I independently verified
the other three cannot fire prematurely:

- **Branch 1** (`queryEnabled && queryFinished && hasQueryResult`): `queryFinished = isDeckBatchLoaded`. With `placeholderData`, `query.isFetching = true` → `isFullBatchLoaded = false` → `isDeckBatchLoaded = false` → branch blocked. **SAFE.**
- **Branch 2** (`hasRecommendationsInState && !isModeTransitioning && !loading`): `setRecommendations(EMPTY_CARDS)` clears recs → `hasRecommendationsInState = false` → branch blocked. **SAFE.**
- **Branch 3** (`locationError && queryFinished`): Only fires on location error → **N/A.**
- **Branch 4** (settled-state): Guarded by `!isRefreshingAfterPrefChange`. **SAFE.**

### Settle → Completion Chain Verified

When `isRefreshingAfterPrefChange` clears (settle effect, line 664-670):
1. `isDeckBatchLoaded=true && !isDeckFetching=true` → settle fires
2. `isRefreshingAfterPrefChange → false`
3. By this point, card accumulation effect has already run `setRecommendations(deckCards)` for batchSeed 0 (line 818-819)
4. Mark Fetch Complete: Branch 1 fires (`queryEnabled && queryFinished && hasQueryResult`) → `hasCompletedFetchForCurrentMode = true`
5. State machine: `recommendations.length > 0` → LOADED

Chain is sound. No gap where the UI could flash EMPTY between INITIAL_LOADING and LOADED.

### Exhaustion Re-trigger Guard Verified

The exhaustion setter effect (line 612-625) has `!isRefreshingAfterPrefChange` guard.
After pref change, `isRefreshingAfterPrefChange = true` → exhaustion effect can't set
`isExhausted = true` during the fetch cycle. **SAFE.**

---

## Constitutional Compliance

All 14 rules checked. 0 violations. 10 N/A (no UI, auth, currency, validation, or
exclusion changes). 4 PASS (one owner, no silent failures, subtract before adding,
persisted-state startup).

---

## Severity Summary

| Severity | Count | Items |
|----------|-------|-------|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 0 | — |
| P3 | 0 | — |
| P4 | 1 | Clean implementation — three surgical changes, correct placement relative to existing resets, protective comment cross-referencing mode handler. Pattern worth replicating for future state-reset parity. |

---

## Discoveries for Orchestrator

None. Self-contained fix, no side issues found.

---

## Recommendation

**PASS.** Ship it. The code analysis covers every state transition exhaustively.
Device testing is recommended to confirm visual timing (skeleton appears fast enough
to be visible, not just technically correct for one frame), but there are no code-level
concerns blocking deployment.
