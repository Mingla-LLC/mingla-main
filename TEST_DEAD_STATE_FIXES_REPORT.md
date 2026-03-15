# Test Report: Dead State Fixes (useDeckCards + SwipeableCards)
**Date:** 2026-03-14
**Tester:** Brutal Tester Skill
**Verdict:** 🟡 CONDITIONAL PASS

---

## Executive Summary

Three fixes targeting the "Pulling up more for you" dead-state bug. The defense-in-depth strategy (root cause + pruning + safety net) is sound architecture. However, I found **one confirmed bug** (array mutation via `.sort()`), **one confirmed behavioral defect** (safety net fires in exhausted state, resurrecting dismissed cards), and several medium-severity observations. The core logic is correct and would fix the reported dead state, but the two critical/high findings must be addressed before merge.

---

## Test Manifest

| Category | Items Tested | Passed | Failed | Warnings |
|----------|-------------|--------|--------|----------|
| TypeScript Compliance | 3 files | 3 | 0 | 0 |
| Pattern Compliance | 3 files | 2 | 1 | 0 |
| React State & Immutability | 4 checks | 2 | 2 | 0 |
| Race Condition Analysis | 5 scenarios | 4 | 0 | 1 |
| Edge Case Coverage | 8 scenarios | 5 | 2 | 1 |
| Regression Risk | 4 checks | 3 | 1 | 0 |
| **TOTAL** | **27** | **19** | **6** | **2** |

---

## 🔴 Critical Findings (Must Fix Before Merge)

### CRIT-001: `.sort()` Mutates Props and Zustand Store Data In-Place

**Files:** [useDeckCards.ts:65](app-mobile/src/hooks/useDeckCards.ts#L65), [useDeckCards.ts:69](app-mobile/src/hooks/useDeckCards.ts#L69)

**What's Wrong:**
`Array.prototype.sort()` mutates the original array. Two new `.sort()` calls mutate data they don't own:

```typescript
// Line 65 — mutates params.categories (a prop from the parent)
const currentPillsKey = params.categories.sort().join(',');

// Line 69 — mutates b.activePills (Zustand store data)
b.activePills.sort().join(',') === currentPillsKey
```

**Impact:**
- **Props mutation:** The caller's `categories` array gets reordered in-place every render. Any parent code relying on the original insertion order of categories will break silently. React's reconciliation relies on prop stability — mutating a prop passed from a parent can cause unpredictable re-render behavior.
- **Zustand mutation:** The store's `activePills` array is permanently sorted. Since Zustand uses reference equality by default, mutating data in-place can bypass change detection and cause stale UI. While subsequent comparisons also sort (making this "accidentally correct"), it violates immutability invariants and will confuse anyone debugging state issues.

**Evidence:** `.sort()` returns the original array after sorting it in-place — this is standard JavaScript behavior, not a copy.

**Required Fix:**
```typescript
// Line 65 — copy before sorting
const currentPillsKey = [...params.categories].sort().join(',');

// Line 69 — copy before sorting
[...b.activePills].sort().join(',') === currentPillsKey
```

**Note:** Line 90 has the same pre-existing pattern (`params.categories.sort().join(',')`) in the query key. While this is a pre-existing issue (not introduced by this PR), it should be fixed at the same time:
```typescript
// Line 90
[...params.categories].sort().join(','),
// Line 91
[...(params.intents ?? [])].sort().join(','),
// Line 92
[...(params.priceTiers ?? [])].sort().join(','),
```

**Why This Matters:** Mutating props is a React anti-pattern that causes subtle, hard-to-reproduce bugs. In strict mode (double-render), this would sort an already-sorted array (harmless), so it wouldn't surface in dev testing — making it a prod-only landmine.

---

## 🟠 High Findings (Should Fix Before Merge)

### HIGH-001: Auto-Recovery Safety Net Fires in Exhausted State — Resurrects All Dismissed Cards

**File:** [SwipeableCards.tsx:539-566](app-mobile/src/components/SwipeableCards.tsx#L539-L566)

**What's Wrong:**
The auto-recovery `useEffect` (Fix 3) does not guard against `isExhausted`. When the user has legitimately swiped through all cards and no more batches are available:

1. `availableRecommendations.length === 0` ✅
2. `recommendations.length > 0` ✅ (old cards still in memory)
3. `removedCards.size > 0` ✅ (user swiped them all)
4. `hasCompletedInitialFetch` ✅
5. `!loading && !isModeTransitioning && !isBatchTransitioning && !isWaitingForSessionResolution` ✅

All conditions pass → after 1.5s, `removedCards` is cleared → all dismissed cards reappear → the "exhausted" screen vanishes and the user sees cards they already reviewed.

**How to Reproduce:**
1. Swipe through all cards in a batch
2. Let the system detect no more batches (`isExhausted = true`)
3. Wait 1.5 seconds on the exhausted screen
4. Cards reappear — user sees everything they already dismissed

**Required Fix:**
Add `!isExhausted` to the guard conditions:

```typescript
if (
  availableRecommendations.length === 0 &&
  recommendations.length > 0 &&
  removedCards.size > 0 &&
  hasCompletedInitialFetch &&
  !loading &&
  !isModeTransitioning &&
  !isBatchTransitioning &&
  !isWaitingForSessionResolution &&
  !isExhausted  // ← ADD THIS
) {
```

**Why This Matters:** Without this guard, the exhausted state is unreachable. Users can never finish swiping — cards always come back after 1.5s. This directly contradicts the UX intent of the exhausted flow.

---

### HIGH-002: Auto-Recovery Missing Guard for `isRefreshingAfterPrefChange`

**File:** [SwipeableCards.tsx:539-566](app-mobile/src/components/SwipeableCards.tsx#L539-L566)

**What's Wrong:**
When `isRefreshingAfterPrefChange` is true, the system is actively fetching new cards after a preference change. During this brief window:
- `availableRecommendations.length` might be 0 (old cards cleared, new ones not arrived)
- `recommendations.length > 0` might be true (placeholder data from React Query)
- All other guard conditions could pass

The safety net could fire during this legitimate transition and clear `removedCards`, which is harmless (prefs changed anyway) but creates a confusing console warning and unnecessary state churn.

**Required Fix:**
Add `!isRefreshingAfterPrefChange` to the guard:

```typescript
  !isWaitingForSessionResolution &&
  !isExhausted &&
  !isRefreshingAfterPrefChange  // ← ADD THIS
```

**Severity note:** This is less severe than HIGH-001 because clearing removedCards during a pref change is cosmetically wrong but not behaviorally wrong. Upgrading from Medium to High because the stacked race conditions during pref changes make the console warning misleading and could mask real dead-state occurrences in logs.

---

## 🟡 Medium Findings (Fix Soon)

### MED-001: `addDeckBatch` Deduplicates on `batchSeed` Only — But Fix 1 Matches on `batchSeed + activePills`

**Files:** [appStore.ts:172](app-mobile/src/store/appStore.ts#L172), [useDeckCards.ts:67-70](app-mobile/src/hooks/useDeckCards.ts#L67-L70)

**What's Wrong:**
The Zustand store's `addDeckBatch` checks for duplicates using `batchSeed` alone:

```typescript
const exists = state.deckBatches.some((b: DeckBatch) => b.batchSeed === batch.batchSeed);
if (exists) return state;
```

But Fix 1 now matches on `batchSeed + activePills`. This means:
- If the user changes preferences (new activePills) without changing batchSeed, the new batch won't be stored because the old one with the same seed already exists.
- `useDeckCards` then can't find a matching batch (different pills) → no `initialData` → no instant rendering.

**Impact:** The `initialData` optimization is silently lost after preference changes within the same batch seed. No dead state, but the user sees a loading flash instead of instant rendering.

**Required Fix:** Update `addDeckBatch` to check both `batchSeed` AND `activePills`:

```typescript
const pillsKey = [...batch.activePills].sort().join(',');
const exists = state.deckBatches.some((b: DeckBatch) =>
  b.batchSeed === batch.batchSeed &&
  [...b.activePills].sort().join(',') === pillsKey
);
```

Or alternatively, replace the existing entry when pills differ:
```typescript
const idx = state.deckBatches.findIndex(b => b.batchSeed === batch.batchSeed);
if (idx >= 0) {
  const existing = state.deckBatches[idx];
  if ([...existing.activePills].sort().join(',') === pillsKey) return state;
  // Replace with updated pills
  const updated = [...state.deckBatches];
  updated[idx] = batch;
  return { deckBatches: updated };
}
```

### MED-002: Auto-Recovery Timeout Callback Doesn't Re-Verify Conditions

**File:** [SwipeableCards.tsx:550-558](app-mobile/src/components/SwipeableCards.tsx#L550-L558)

**What's Wrong:**
The `setTimeout` callback at line 550 runs unconditionally once the timer fires. It does not re-check whether the dead state conditions are still true at the moment of execution. While the cleanup function (`return () => clearTimeout(recoveryTimer)`) handles most cases by canceling the timer when dependencies change, there is a narrow window:

If a dependency changes AND the new render hasn't committed yet (React batching), the old timer could fire between the state change and the cleanup. This is a theoretical concern in React 18's concurrent mode.

**Practical Risk:** Low — React's effect cleanup is synchronous before the next effect runs. But the pattern of re-verifying inside the timeout is more defensive:

```typescript
const recoveryTimer = setTimeout(() => {
  // Re-verify conditions at execution time
  const currentRemoved = removedCardsRef.current;
  const currentRecs = recommendationsRef.current;
  if (currentRemoved.size === 0 || currentRecs.length === 0) return;
  // ... proceed with recovery
}, 1500);
```

**Impact:** Theoretical race in concurrent React. Low probability but trivial to guard.

### MED-003: AsyncStorage Restore Runs Before `recommendations` Arrive on True Cold Start (No `initialData`)

**File:** [SwipeableCards.tsx:720-773](app-mobile/src/components/SwipeableCards.tsx#L720-L773)

**What's Wrong:**
On the very first app launch (no Zustand batch → no `initialData`), the restore useEffect runs on mount with `recommendations.length === 0`. The pruning at line 738-739 creates an empty `currentCardIds` Set, so ALL persisted removedCards are pruned to an empty array.

However, this is actually **correct behavior** for this scenario:
- First launch → no removedCards in AsyncStorage anyway
- Subsequent launch with changed prefs → old removedCards should be cleared

But there's one scenario where it's questionable: **app kill + restart with same preferences, but slow network.** If `initialData` doesn't match (e.g., Zustand was cleared by schema migration), recommendations aren't available on first render, and the restore clears all removedCards. When recommendations arrive (same cards), the user's dismiss history is lost.

**Impact:** Edge case — only occurs when Zustand store is cleared but AsyncStorage isn't, which happens during schema version bumps. Low frequency but confusing UX.

**Mitigation:** Consider deferring the restore until `recommendations.length > 0`:
```typescript
// Early return if no recommendations yet — wait for data before restoring
if (recommendations.length === 0) return;
```

---

## 🔵 Low Findings (Nice to Fix)

### LOW-001: Console Logging in Production Build (Fix 2)

**File:** [SwipeableCards.tsx:753-761](app-mobile/src/components/SwipeableCards.tsx#L753-L761)

The existing `console.log` at line 753 now includes the pruning count. Unlike Fix 3's `console.warn` which is gated behind `__DEV__`, this log statement runs in production. Not a bug, but production console logs are noise:

```typescript
// This runs in production:
console.log(
  "✅ Restored state from AsyncStorage - Index:",
  restoredIndex,
  "Removed:",
  removedCardsArray.length,
  rawRemovedCards.length !== removedCardsArray.length
    ? `(pruned ${rawRemovedCards.length - removedCardsArray.length} stale)`
    : ""
);
```

**Suggestion:** Gate behind `__DEV__` to match Fix 3's pattern.

### LOW-002: Magic Number 1500ms

**File:** [SwipeableCards.tsx:550](app-mobile/src/components/SwipeableCards.tsx#L550)

The 1.5s delay is a magic number. Consider extracting to a named constant for clarity:

```typescript
const DEAD_STATE_RECOVERY_DELAY_MS = 1500;
```

---

## ✅ What Passed

### Things Done Right

1. **Defense-in-depth architecture.** Three independent fixes at three different layers (data source, restore, runtime). If any one fails, the others catch it. This is excellent engineering discipline.

2. **Fix 2 (stale ID pruning) is the strongest fix.** It addresses the root cause at the exact point of entry (AsyncStorage restore) with minimal blast radius. The logic is clean: build a set of current IDs, filter the restored set, proceed. Simple, correct, testable.

3. **Fix 1 correctly identifies the initialData mismatch.** Adding `activePills` to the match criteria prevents the most insidious variant of the bug — wrong-category cards being served as initialData. The comment block explaining WHY this matters is excellent.

4. **Fix 3's guard conditions are comprehensive.** Checking `hasCompletedInitialFetch`, `loading`, `isModeTransitioning`, `isBatchTransitioning`, and `isWaitingForSessionResolution` prevents false positives during legitimate loading transitions. The cleanup function correctly cancels the timer on dependency changes.

5. **Good diagnostic logging.** The pruning count in Fix 2 and the dev-only warning in Fix 3 will make future debugging much easier.

### Static Analysis Results

| Check | Result |
|-------|--------|
| No `any` types introduced | ✅ |
| No `@ts-ignore` introduced | ✅ |
| No inline styles introduced | ✅ |
| No direct API calls from mobile | ✅ |
| No security issues | ✅ |
| StyleSheet.create() compliance | ✅ |
| Import ordering consistent | ✅ |
| Named/default export conventions | ✅ |

---

## Spec Compliance Matrix

| Success Criterion | Tested? | Passed? | Evidence |
|-------------------|---------|---------|----------|
| Stale initialData from wrong categories no longer served | ✅ | ✅ | Fix 1: batchSeed + activePills match |
| Persisted removedCards from old session pruned on restore | ✅ | ✅ | Fix 2: currentCardIds filter |
| Dead state auto-recovers if other fixes miss edge case | ✅ | 🟡 | Fix 3: works, but fires incorrectly in exhausted state (HIGH-001) |
| No regression in normal swipe flow | ✅ | ✅ | Guard conditions prevent false triggering during normal usage |
| No regression in preference change flow | ✅ | ✅ | Reset logic at L679-708 clears state on pref change |
| No regression in batch navigation | ✅ | ✅ | isBatchTransitioning guards prevent interference |

---

## Implementation Claim Verification

| Implementor's Claim | Verified? | Accurate? | Notes |
|---------------------|-----------|-----------|-------|
| "Fix 1: initialData lookup now matches on batchSeed + activePills" | ✅ | ✅ | Confirmed at L67-70, but uses mutating `.sort()` (CRIT-001) |
| "Previously it only matched batchSeed" | ✅ | ✅ | Confirmed via git diff — old code was `.find(b => b.batchSeed === params.batchSeed)` |
| "Fix 2: stale IDs that don't match any card in the current batch are pruned" | ✅ | ✅ | Confirmed at L738-739. Clean implementation. |
| "Fix 3: Safety net auto-recovery after 1.5s" | ✅ | 🟡 | Works, but missing `isExhausted` guard causes card resurrection (HIGH-001) |
| "Catches any edge case the first two fixes might miss" | ✅ | 🟡 | Catches dead state from stale persistence, but over-triggers in exhausted state |

---

## Recommendations

### Mandatory (block merge until done)
1. **CRIT-001:** Replace `.sort()` with `[...array].sort()` at useDeckCards.ts lines 65, 69 (and pre-existing lines 90-92)
2. **HIGH-001:** Add `!isExhausted` to auto-recovery guard conditions at SwipeableCards.tsx line 548

### Strongly Recommended (merge at your own risk)
3. **HIGH-002:** Add `!isRefreshingAfterPrefChange` to auto-recovery guard conditions
4. **MED-001:** Update `addDeckBatch` deduplication to consider activePills

### Nice to Have
5. **MED-002:** Re-verify conditions inside setTimeout callback using refs
6. **MED-003:** Defer restore until `recommendations.length > 0`
7. **LOW-001:** Gate console.log behind `__DEV__`
8. **LOW-002:** Extract 1500ms to named constant

---

## Verdict Justification

**🟡 CONDITIONAL PASS** — The three fixes correctly address the dead-state bug with sound defense-in-depth architecture. Fix 2 is particularly well-crafted. However, CRIT-001 (array mutation) is a correctness violation that can cause subtle downstream bugs, and HIGH-001 (missing exhausted guard) breaks the deck-exhaustion flow entirely. Both are trivial to fix (one-line changes each). Fix these two, and this is a clean merge. No need for a full re-test — the fixes are mechanical and verifiable by inspection.
