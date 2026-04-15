# IMPLEMENTATION: ORCH-0431 — Show Loading Skeleton on Preference Change

**Date:** 2026-04-14
**Status:** Implemented, partially verified (needs device testing for SC-1 through SC-7)
**File changed:** `app-mobile/src/contexts/RecommendationsContext.tsx` (1 file, 3 changes)

---

## What Changed (plain English)

When you change preferences after exhausting all cards (or seeing an empty deck), the app
now immediately shows the loading skeleton ("curating your lineup") instead of staying on the
dead screen. This also applies when cards are visible — old-preference cards are cleared and
the skeleton appears while new ones load.

---

## Changes

### Change 1: Refresh Key Handler — Added 2 Missing Resets (lines 645-646)

**What it did before:** Reset most deck state on preference change but left
`hasCompletedFetchForCurrentMode = true` and `recommendations` untouched. The state machine
interpreted this as "fetch done + no cards = EMPTY" instead of "new fetch needed = INITIAL_LOADING."

**What it does now:** Resets `hasCompletedFetchForCurrentMode` to `false` and clears
`recommendations` to `EMPTY_CARDS`. The state machine now correctly evaluates
`!hasCompletedFetchForCurrentMode && recommendations.length === 0` → `INITIAL_LOADING`.

**Why:** Addresses Finding 1 (root cause) and Finding 4 (hidden flaw) from the investigation.

**Lines added:** 2

### Change 2: Settled-State Condition — Added `isRefreshingAfterPrefChange` Guard (line 954)

**What it did before:** Declared system "settled" when `!isLoadingLocation && !isLoadingPreferences
&& !isDeckLoading && !isModeTransitioning`. After a pref change, `isDeckLoading` stayed `false`
(because React Query's `placeholderData` satisfies `isLoading`), so this condition fired
immediately — re-setting `hasCompletedFetchForCurrentMode` back to `true` before new cards arrived.

**What it does now:** Adds `&& !isRefreshingAfterPrefChange` to the condition. During a pref
change, `isRefreshingAfterPrefChange` is `true`, blocking premature completion. It clears
naturally when the deck settles (`isDeckBatchLoaded && !isDeckFetching` at line 665-668).

**Why:** Addresses Finding 2 (contributing factor) and Finding 3 (contributing factor).
Mirrors the existing `!isModeTransitioning` guard for mode transitions.

**Also added `isRefreshingAfterPrefChange` to the effect's dependency array** (line 982) so
the effect re-evaluates when the flag changes.

**Lines changed:** 4 (condition + comment + dependency)

### Change 3: Protective Comment (lines 635-637)

**What it did before:** Generic comment about resetting state.

**What it does now:** Cross-references the mode transition handler, noting that both handlers
represent the same logical operation and must stay in sync.

**Why:** Regression prevention per spec.

**Lines added:** 3

---

## Spec Traceability

| Criterion | How Verified | Result |
|-----------|-------------|--------|
| SC-1: Exhausted → pref change → skeleton | State machine walk-through: `!hasCompletedFetchForCurrentMode(true) && recommendations.length===0(true)` → INITIAL_LOADING | PASS (code analysis) |
| SC-2: Empty → pref change → skeleton | Same path as SC-1 (both have `hasCompleted=true, recs=[]` before fix) | PASS (code analysis) |
| SC-3: Cards visible → pref change → skeleton | `setRecommendations(EMPTY_CARDS)` clears visible cards → `recs.length===0` → INITIAL_LOADING | PASS (code analysis) |
| SC-4: Rapid pref changes → no stuck state | Each refreshKey change re-fires the handler, re-setting all state. `isRefreshingAfterPrefChange` guard prevents premature completion between changes. | PASS (code analysis) |
| SC-5: Mode switch → no regression | Mode transition handler unchanged. `isRefreshingAfterPrefChange` is `false` during mode switches, so the new guard is transparent. | PASS (code analysis) |
| SC-6: First app load → no regression | Initial state: `hasCompletedFetchForCurrentMode=false`, `isRefreshingAfterPrefChange=false`. Both unchanged. | PASS (code analysis) |
| SC-7: Settle flag clears | Existing settle effect (line 665-668) checks `isDeckBatchLoaded && !isDeckFetching`. Adding `isRefreshingAfterPrefChange` to settled-state deps means the Mark Fetch Complete effect re-runs when settle flag clears. | PASS (code analysis) |

**All 7 criteria pass code analysis. Device testing needed to confirm runtime behavior.**

---

## Invariant Verification

| Invariant | Preserved? |
|-----------|-----------|
| State machine covers all states | YES — no new states added, evaluation order unchanged |
| No EMPTY flash between INITIAL_LOADING and LOADED | YES — settled-state guard prevents premature completion |
| Mode transitions unaffected | YES — `isRefreshingAfterPrefChange` is false during mode switches |
| `isRefreshingAfterPrefChange` always clears | YES — existing settle effect at line 665-668 unchanged |

---

## Parity Check

- **Solo mode:** Fixed (this is the affected path)
- **Collab mode:** Not affected — uses mode transition handler (already correct) and session-deck query, not refreshKey

---

## Cache Safety

- No query keys changed
- No mutation logic changed
- No data shape changed
- No AsyncStorage format changed

---

## Regression Surface

1. **Mode switching (solo ↔ collab)** — shares the Mark Fetch Complete effect
2. **First app load / cold start** — uses same state machine
3. **Preference save flow** — triggers the fixed handler
4. **Background refetch** — settled-state condition is in the same effect
5. **Card accumulation** — reads `recommendations` state

---

## Discoveries for Orchestrator

None.
