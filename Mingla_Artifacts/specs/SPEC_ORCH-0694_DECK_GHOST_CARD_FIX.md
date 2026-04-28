# SPEC — ORCH-0694: Deck Ghost-Card Fix

**Status:** READY FOR IMPLEMENTOR
**Date:** 2026-04-27
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0694_DECK_GHOST_CARD_AFTER_SWIPE.md`
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0694_DECK_GHOST_CARD_FIX.md`
**Spec confidence:** **HIGH** (mechanism proven in investigation; collab parity audit complete; pattern α vs β decision committed)

---

## §1 Layman Summary

Investigation proved the swipe-completion code shares a single pair of Animated.Values across all cards in the deck. After a swipe finishes, state advances to the next card before those values reset to zero — a 2-frame window. The new top card briefly inherits the previous card's "off-screen and rotated" transform, and the next-next card stays visible at scale 0.95 because the opacity interpolation extrapolates above 1.

This spec fixes the bug class structurally, not the timing. Each card gets its own React tree node via `key={currentRec.id}`, and the transform values reset BEFORE state advances — so the new card always renders at (0, 0) with rotate 0deg. Two contributing factors are also clamped: `nextCardOpacity` extrapolation gets `clamp`, and `gestureState.dy` is bounded so the exit animation can't drift to extreme diagonals.

Collab parity audit confirmed `SwipeableBoardCards.tsx` uses a fundamentally different architecture (React useState `dragOffset`, no Animated.Value, immediate reset at line 109). No fix needed there.

---

## §2 Scope and Non-Goals

### Scope (exactly these changes)

| ID | Change | File | Line(s) |
|---|---|---|---|
| 0694-A | Add `key={currentRec.id}` to current card Animated.View | `SwipeableCards.tsx` | 2254 |
| 0694-B | Reset `positionX` and `positionY` to 0 INSIDE the `.start()` callback BEFORE `setRemovedCards`/`setCurrentCardIndex` | `SwipeableCards.tsx` | 1322-1327 (insertion point) |
| 0694-C | REMOVE the 2-rAF reset chain entirely | `SwipeableCards.tsx` | 1338-1346 |
| 0694-D | Add `extrapolate: 'clamp'` to `nextCardOpacity` interpolation | `SwipeableCards.tsx` | 675-678 |
| 0694-E | Clamp `gestureState.dy` to ±100 in exit animation `toValue` | `SwipeableCards.tsx` | 1317-1321 |
| 0694-F | Add explanatory comment block at swipe-completion region documenting WHY this works | `SwipeableCards.tsx` | 1311 (preceding comment) |
| 0694-G | Belt-and-suspenders: `useEffect` keyed on `currentRec?.id` that calls `positionX.setValue(0)` + `positionY.setValue(0)` on card change | `SwipeableCards.tsx` | After existing useEffects, before render |
| 0694-H | Collab parity audit verdict | `SwipeableBoardCards.tsx` | N/A — no change |

### Non-Goals (explicitly out of scope)

- Refactoring SwipeableCards to extract per-card `<DeckCardSlot>` child component (Pattern β from investigation §8). Pattern α (this spec's choice) accomplishes the same outcome with ~10× smaller diff and no risk of breaking panResponder/interpolation coupling.
- Touching `useDeckCards`, `RecommendationsContext` (deckStateRegistry), or any data-layer code.
- Touching the panResponder gesture handlers (lines 1224-1300). The gesture path is correct.
- Touching `SwipeableBoardCards.tsx` — different architecture, bug class doesn't exist there (confirmed by spec writer reading lines 86-111: useState `dragOffset`, immediate `setDragOffset({x:0,y:0})` reset, no Animated.Value, no Z-stack with shared transform).
- Performance optimization beyond the four named changes.
- ORCH-0680 (PopularityIndicators conditional `useAnimatedStyle`) — separate ORCH.
- Any of the deferred Wave 2.8/2.8.1 tabs (ConnectionsPage, LikesPage inner-tab scroll).

### Assumptions Verified

| Assumption | Verification | Result |
|---|---|---|
| `key={currentRec.id}` triggers React to unmount the old `<Animated.View>` and mount a new one | React docs + standard reconciliation behavior | ✅ |
| `positionX.setValue(0)` is synchronous on the JS side; native driver propagates within 1 frame | RN Animated docs, `useNativeDriver: true` semantics | ✅ |
| Resetting BEFORE state advance + `key` change means the new Animated.View binds to positionX=0 from frame 1 | React commit semantics (state changes batched and flushed in same render pass) | ✅ |
| The 1-frame "old card might snap back to center" risk is masked by the same-render unmount of the old `key=oldCard.id` view | React reconciliation timing — the old view's transform update and unmount happen within the same commit | ⚠️ Spec calls this out as the highest-risk verification point. Belt-and-suspenders useEffect (0694-G) provides redundancy. |
| `currentRec.id` is stable per card (not regenerated on render) | Investigation confirmed cards come from `availableRecommendations[currentCardIndex]` which is `useMemo`-stabilized at line 682-688 | ✅ |
| `extrapolate: 'clamp'` is supported on `Animated.Value.interpolate()` with native driver | RN Animated docs | ✅ |
| `SwipeableBoardCards.tsx` does NOT share the bug class | Spec writer read lines 1-111 directly; uses React useState `dragOffset` (not Animated.Value), immediate reset at line 109, no Z-stack with shared transform | ✅ |

---

## §3 Per-Layer Specification

### Component layer — `app-mobile/src/components/SwipeableCards.tsx`

**File path:** `app-mobile/src/components/SwipeableCards.tsx`
**Lines touched:** ~10 lines added, ~10 lines removed, ~5 lines modified. Net diff well under 80 LOC.

**0694-A: Add `key` prop to current Animated.View**

At line 2254, modify:

```tsx
// Before
<Animated.View
  style={[
    styles.card,
    {
      transform: [
        { translateX: positionX },
        { translateY: positionY },
        { rotate: rotate },
      ],
    },
  ]}
  {...panResponder.panHandlers}
  pointerEvents="auto"
>
```

```tsx
// After
<Animated.View
  key={currentRec.id}                            // ← ADD: forces remount on card change
  style={[
    styles.card,
    {
      transform: [
        { translateX: positionX },
        { translateY: positionY },
        { rotate: rotate },
      ],
    },
  ]}
  {...panResponder.panHandlers}
  pointerEvents="auto"
>
```

**0694-D: Clamp nextCardOpacity extrapolation**

At line 675-678, modify:

```tsx
// Before
const nextCardOpacity = positionX.interpolate({
  inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
  outputRange: [1, 0, 1],
});
```

```tsx
// After
const nextCardOpacity = positionX.interpolate({
  inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
  outputRange: [1, 0, 1],
  extrapolate: 'clamp',                          // ← ADD: prevents over-1 during the brief reset window
});
```

**0694-B + 0694-C + 0694-E + 0694-F: Swipe completion handler**

At line 1311-1347, modify the entire swipe-completion block:

```tsx
// Before
// Animate card off the screen edge
// ORCH-0675 Wave 1 RC-1 — per-axis timing with native driver.
// Animated.parallel start() callback fires when LAST animation resolves —
// equivalent semantics to single-call ValueXY .start() callback.
Animated.parallel([
  Animated.timing(positionX, {
    toValue: direction === "right" ? SCREEN_WIDTH : -SCREEN_WIDTH,
    duration: 250,
    useNativeDriver: true,
  }),
  Animated.timing(positionY, {
    toValue: gestureState.dy,
    duration: 250,
    useNativeDriver: true,
  }),
]).start(() => {
  // After animation completes, remove the card and advance to next
  setRemovedCards((prev) => {
    const newSet = new Set([...prev, cardToRemove.id]);
    return newSet;
  });

  // Move to next card
  setCurrentCardIndex(0);

  // RELIABILITY: .catch() on fire-and-forget handleSwipe. Without this,
  // any error becomes an unhandled promise rejection.
  handleSwipeRef.current?.(direction, cardToRemove)?.catch((err) => {
    console.error('[SwipeableCards] Swipe handler error:', err);
  });

  // Wait for React to render the next card before resetting position
  // This prevents the flash/flicker — DO NOT remove this rAF chain.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // ORCH-0675 Wave 1 RC-1 — per-axis reset
      positionX.setValue(0);
      positionY.setValue(0);
    });
  });
});
```

```tsx
// After
// Animate card off the screen edge.
// ORCH-0694: clamp dy to ±100 so diagonal swipes don't drift the exit
// animation off-screen-and-down (CF-2). Combined with key={currentRec.id}
// on the card Animated.View + reset-before-state-advance below, this
// structurally eliminates the ghost-card-after-swipe bug class.
Animated.parallel([
  Animated.timing(positionX, {
    toValue: direction === "right" ? SCREEN_WIDTH : -SCREEN_WIDTH,
    duration: 250,
    useNativeDriver: true,
  }),
  Animated.timing(positionY, {
    toValue: Math.max(-100, Math.min(100, gestureState.dy)),  // ← 0694-E: clamp dy
    duration: 250,
    useNativeDriver: true,
  }),
]).start(() => {
  // ORCH-0694 RC-1 fix: reset transforms BEFORE state advance.
  // The old Animated.View has key={oldCard.id} and unmounts in this same
  // render pass; the new Animated.View mounts with key={newCard.id} and
  // binds to positionX/Y already at 0. No 2-rAF dance needed.
  positionX.setValue(0);                         // ← 0694-B: reset BEFORE state advance
  positionY.setValue(0);

  // Advance state. React batches these into a single re-render that swaps
  // the keyed Animated.View atomically.
  setRemovedCards((prev) => new Set([...prev, cardToRemove.id]));
  setCurrentCardIndex(0);

  // RELIABILITY: .catch() on fire-and-forget handleSwipe.
  handleSwipeRef.current?.(direction, cardToRemove)?.catch((err) => {
    console.error('[SwipeableCards] Swipe handler error:', err);
  });

  // ← 0694-C: 2-rAF chain DELETED. The "DO NOT remove this rAF chain"
  //   comment from prior author is obsoleted by 0694-A (per-card key).
});
```

**0694-G: Belt-and-suspenders useEffect (defense-in-depth)**

Locate the existing useEffect block in SwipeableCards (around line 990-1100, near AsyncStorage restore). Add a new useEffect AFTER the existing card-state restore effect, BEFORE the render return:

```tsx
// ORCH-0694 RC-1 defense-in-depth: even if state advance and key remount
// somehow race against transform reset, this effect guarantees a fresh
// (0, 0) origin every time the active card changes. The .start() callback
// at line 1322 is the primary path; this is the safety net.
useEffect(() => {
  if (!currentRec) return;
  positionX.setValue(0);
  positionY.setValue(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [currentRec?.id]);
```

Place this AFTER `availableRecommendations` is computed (line 688) so `currentRec` is in scope. Implementor: locate the exact insertion line; it must run BEFORE any render that reads `positionX`/`positionY` for a NEW card, but AFTER the React Hook ordering invariant (above any early returns — see I-HOOKS-ABOVE-EARLY-RETURNS).

### `SwipeableBoardCards.tsx` — collab parity verdict

**No change required.** Spec writer read lines 1-111 of `SwipeableBoardCards.tsx`. Architecture differs fundamentally:

- Uses `useState({x: 0, y: 0})` for `dragOffset`, NOT a long-lived `Animated.Value` shared across cards.
- No exit animation; release handler at line 96-110 calls `setDragOffset({ x: 0, y: 0 })` synchronously after the threshold check.
- No Z-stack with two `position: absolute` cards rendered simultaneously.
- No interpolation extrapolation logic.

The bug class proven for `SwipeableCards` (shared Animated.Value + 2-rAF window + extrapolation) is structurally absent from `SwipeableBoardCards`.

Implementor: do NOT modify `SwipeableBoardCards.tsx`. Document the audit verdict in your report under §6 Parity Check.

### No other layers touched

- No DB migration
- No edge function changes
- No service layer changes
- No hook changes (useDeckCards, deckStateRegistry, etc. — all untouched)
- No new dependencies
- No new CI gates (existing 10 must remain green)

---

## §4 Success Criteria

| ID | Criterion | Verification |
|---|---|---|
| 0694-SC-1 | After swipe-left past threshold (>120px dx), no fragment of any previous card is visible at any pixel of the screen on the very next frame | Founder dev-client visual verification |
| 0694-SC-2 | After swipe-right past threshold, same — no fragment | Founder dev-client visual verification |
| 0694-SC-3 | The new active card snaps cleanly to (0, 0) with rotate 0deg, scale 1, opacity 1 — no visible flicker, slide-in, or scale pop | Founder dev-client visual verification |
| 0694-SC-4 | Diagonal swipe (e.g., dy=200) exits cleanly bounded — exit animation does not drift below dy=100 magnitude | grep `Math.max(-100, Math.min(100, gestureState.dy))` in SwipeableCards.tsx |
| 0694-SC-5 | Rapid succession (5 swipes in 3 seconds) produces no stacked-stale-transform or cumulative drift; final visible card is correct | Founder stress test |
| 0694-SC-6 | First swipe immediately after a fresh app launch (cold start) produces no ghost artifact | Founder cold-start test (force-quit, reopen, swipe immediately) |
| 0694-SC-7 | First swipe after a tab switch back to Home (Wave 2.8 lifecycle interaction) produces no ghost artifact | Founder cross-tab test |
| 0694-SC-8 | The 2-rAF chain at lines 1338-1346 is REMOVED (not commented out, not left as dead code) | `grep "requestAnimationFrame" app-mobile/src/components/SwipeableCards.tsx` returns ONLY non-swipe-completion matches |
| 0694-SC-9 | `nextCardOpacity` interpolation contains `extrapolate: 'clamp'` | grep `extrapolate.*clamp` near line 675-680 |
| 0694-SC-10 | `key={currentRec.id}` is present on the current card Animated.View | grep `key=\{currentRec.id\}` in SwipeableCards.tsx |
| 0694-SC-11 | Belt-and-suspenders useEffect on `currentRec?.id` resets positionX/Y | grep `currentRec?.id` near a `useEffect` followed by `positionX.setValue(0)` |
| 0694-SC-12 | `SwipeableBoardCards.tsx` is UNTOUCHED | `git diff app-mobile/src/components/SwipeableBoardCards.tsx` returns empty |
| 0694-SC-13 | All 10 existing CI gates green | `bash scripts/ci/check-*.sh` |
| 0694-SC-14 | TypeScript: 3 pre-existing baseline errors only, zero new | `npx tsc --noEmit` |
| 0694-SC-15 | F-01 from Wave 2.8 still passes (1 render-count log per tab tap) | Founder dev-client retest of cross-tab navigation |
| 0694-SC-16 | Solo + collab parity: collab session swipe (board card) behavior unchanged from before this fix | Founder collab-session smoke test |

---

## §5 Invariants

### Preserved
- **All Wave 1+ CI gates** (10/10 green requirement). No CI gate behavior changes.
- **`I-ANIMATIONS-NATIVE-DRIVER-DEFAULT`** — all `Animated.timing` calls remain `useNativeDriver: true`.
- **`I-HOOKS-ABOVE-EARLY-RETURNS`** — the new `useEffect` (0694-G) MUST be placed above any early returns in SwipeableCards.tsx. Implementor verifies via `bash scripts/ci/check-react-hooks-rules.sh`.
- **`I-TAB-SCREENS-MEMOIZED`** — SwipeableCards is not a tab screen; not affected.
- **`deckStateRegistry`** (ORCH-0490) — index/removed are still set/read at the same call sites (`setRemovedCards`, `setCurrentCardIndex`).
- **Constitution #8 (subtract before adding)** — the 2-rAF chain MUST be deleted, not commented out or left as dead code.

### New (informational only — no CI gate this dispatch)
- **Implicit invariant: per-card key on Z-stack Animated.Views** — any future component that renders a single "current item" via `<Animated.View>` driven by a shared Animated.Value pair MUST use `key={item.id}` to prevent shared-state leakage across item changes. Document for future auditors; spec does NOT require a CI gate for it (would need AST parsing to verify reliably).

---

## §6 Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Clean swipe-left (happy path) | Card A on top, swipe left dx=-200, dy=+10 | Card A exits left; card B snaps to center cleanly; no fragment of A or any other card visible at any frame after exit | Component + animation |
| T-02 | Clean swipe-right (happy path) | Card A on top, swipe right dx=+200, dy=+10 | Same as T-01 but card exits right | Component + animation |
| T-03 | Diagonal swipe-left edge case | Card A on top, swipe left dx=-180, dy=+250 | Card A exits left with translateY clamped to +100 (not +250); card B clean | Animation clamp |
| T-04 | Rapid succession stress | Swipe 5 cards left in 3 seconds | All swipes complete cleanly; final visible card is correct; no stacked stale transforms | Stress |
| T-05 | Sub-threshold swipe (no advance) | Drag 80px right then release (below 120 threshold) | Card snaps back to center cleanly; positionX/Y at 0 | Component |
| T-06 | First swipe after tab return (Wave 2.8 lifecycle) | Switch Home→Discover→Home, then swipe left | Same as T-01 — fresh mount of SwipeableCards does not interact with bug class | Cross-feature |
| T-07 | Collab parity (no fix) | Active collab session, swipe board card left/right | Behavior unchanged from before this spec landed (regression-only check) | Collab |
| T-08 | Cold start first swipe | Force-quit app, reopen, swipe first card immediately on Home | Card exits cleanly, no first-mount edge case | Cold start |
| T-09 | Curated card (multi-stop "A → B" format) | Swipe left on a curated experience card (matches founder's original screenshot card type) | Same as T-01 — `cardType === 'curated'` does not affect the fix | Component variant |
| T-10 | Save tap (right swipe save flow) | Tap Save button on the card | Save flow unchanged; positionX/Y reset on success same as right swipe | Integration |
| T-11 | Card expansion (tap-to-expand) | Tap card center | Modal opens; positionX/Y do not advance on tap (only swipe) | Component |
| T-12 | Deck exhaustion | Swipe through all cards in the batch | Empty deck UI shown; no leftover transform on the last "ghost" frame | Edge case |
| T-13 | Solo-collab mode toggle | Toggle from solo to collab while on Home | Mode change re-runs the existing reset effect (line 994-1006); ORCH-0694 does not regress this | Mode toggle |

---

## §7 Implementation Order (for the implementor)

1. Read `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0694_DECK_GHOST_CARD_AFTER_SWIPE.md` (full).
2. Read this spec (full).
3. Read `app-mobile/src/components/SwipeableCards.tsx` lines 660-690, 990-1100, 1220-1360, 2250-2270 (the regions touched).
4. Open `app-mobile/src/components/SwipeableBoardCards.tsx` ONLY to confirm no change required (do NOT modify). Document audit verdict in implementation report.
5. Apply 0694-A (line 2254): add `key={currentRec.id}`.
6. Apply 0694-D (lines 675-678): add `extrapolate: 'clamp'`.
7. Apply 0694-E (line 1317-1321): clamp `gestureState.dy`.
8. Apply 0694-B (inside `.start()` callback): reset positionX/Y BEFORE state advance.
9. Apply 0694-C (lines 1338-1346): DELETE 2-rAF chain entirely. No commented-out fallback. (Constitution #8: subtract before adding.)
10. Apply 0694-F (line 1311 area): replace existing comment with the new explanatory block referencing ORCH-0694 RC-1.
11. Apply 0694-G: add `useEffect` keyed on `currentRec?.id` for belt-and-suspenders reset. Place ABOVE any early returns (Hook ordering invariant).
12. Run `npx tsc --noEmit`. Expected: 3 pre-existing baseline errors, zero new.
13. Run `bash scripts/ci/check-*.sh` for all 10 gates. Expected: 10/10 PASS.
14. Manually exercise T-01 through T-13 on Android dev-client (founder will repeat as final gate).
15. Write implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0694_DECK_GHOST_CARD_FIX_REPORT.md` with the full 15-section template + per-file Old→New receipts + collab parity verdict + verification matrix mapping each SC to evidence.
16. Provide ready-to-use commit message (no Co-Authored-By line per memory).

---

## §8 Regression Prevention

### Structural safeguards
- **`key={currentRec.id}`** is the structural fix. Any future code that drives a single Z-stack slot from shared Animated.Values without a per-item key recreates this bug class. The new comment at line 1311 documents the WHY for future maintainers.
- **`extrapolate: 'clamp'`** on `nextCardOpacity` prevents the next-card from being visible at opacity > 1 during any future timing edge case.
- **`gestureState.dy` clamp** prevents extreme diagonal swipes from leaving the exit animation in geometrically-impossible end states.
- **Belt-and-suspenders useEffect** (0694-G) provides redundancy: even if the primary `.start()` callback path is reordered or interrupted in a future refactor, the per-card-id reset still fires.

### Comment block at line 1311 (verbatim, implementor copies)
```tsx
// ORCH-0694: clamp dy to ±100 so diagonal swipes don't drift the exit
// animation off-screen-and-down (CF-2). Combined with key={currentRec.id}
// on the card Animated.View + reset-before-state-advance below, this
// structurally eliminates the ghost-card-after-swipe bug class.
//
// DO NOT re-introduce a 2-rAF reset chain here. The previous version
// reset transforms AFTER state advance via 2 requestAnimationFrame
// nesting; the gap created a window where the new top card briefly
// inherited the previous card's stale transform values, producing the
// bottom-left wedge artifact reported under ORCH-0694. The fix is
// per-card React key (line 2254) + reset-before-state-advance, NOT
// timing the reset around the React render cycle.
```

### Test catches if regression returns
T-01 (clean swipe-left, no fragment visible) is the canonical regression test. If the wedge artifact returns, T-01 fails immediately on visual inspection.

---

## §9 Discoveries for Orchestrator

- **D-0694-SPEC-1:** Pattern α chosen over Pattern β after spec-writer evaluation. Pattern β (extracting `<DeckCardSlot>` child) would require ~400+ LOC refactor (panResponder + 4 interpolations + entire current-card render block all live at parent scope). Pattern α delivers structural equivalence with ~30 LOC diff. If a future auditor questions Pattern α holding under all timing edge cases, the path to Pattern β is documented in investigation §8 — not required now.

- **D-0694-SPEC-2:** Belt-and-suspenders useEffect (0694-G) is intentionally redundant with 0694-B. Implementor MAY observe that one or the other is sufficient in isolation, but the spec requires BOTH. Reasoning: 0694-B handles the post-swipe-completion path (most common); 0694-G handles any path that advances `currentRec` outside the swipe callback (e.g., `onCardRemoved` from ExpandedCardModal at line 2480-2487 calls `setRemovedCards` + `setCurrentCardIndex(0)` without going through the swipe handler). Both paths must reset transforms.

- **D-0694-SPEC-3:** `SwipeableBoardCards.tsx` was confirmed unaffected by the bug class. However, the spec writer noted SwipeableBoardCards uses React useState for drag offset which causes a JS-thread render on every drag frame — a potential perf concern unrelated to ORCH-0694. NOT in scope; flag for future perf audit.

- **D-0694-SPEC-4:** The investigation report's CF-2 (gestureState.dy residue) is addressed by clamping dy in the exit `toValue`. The clamp magnitude (±100) is a judgment call by the spec writer — chosen because: (a) preserves visual continuity with finger trajectory for normal swipes (most users release with dy<50), (b) caps the worst-case off-screen-down distance to ~100px which the per-card key + reset-before-state-advance covers anyway, (c) avoids needing platform-conditional logic. If founder retest finds this clamp too aggressive (visible discontinuity from finger position), the clamp can be raised to ±150 or ±200 in a follow-up.

- **D-0694-SPEC-5:** No new CI gate proposed for the per-card-key invariant. AST-based detection of "Animated.View driven by shared Animated.Values without key prop" requires real parsing infrastructure that doesn't exist in the current `scripts/ci/` toolkit. Document for future invariant-tooling work; not blocking this dispatch.

---

## §10 Out of Scope (DO NOT touch)

- `app-mobile/src/components/SwipeableBoardCards.tsx` (audit-confirmed safe; do not modify)
- `app-mobile/src/contexts/RecommendationsContext.tsx` (deckStateRegistry — out of scope)
- `app-mobile/src/hooks/useDeckCards.ts` (data layer — out of scope)
- Any panResponder gesture-handling code at lines 1224-1300 (gesture path is correct)
- Any other tab file (Wave 2.8.1 already shipped)
- ConnectionsPage (ORCH-0695 owns)
- LikesPage inner-tab scroll (TS-WAVE2.8.1-2 owns)
- ORCH-0680 PopularityIndicators (separate ORCH)

---

## §11 Constraints (verbatim — implementor MUST honor)

- DO NOT add any new dependencies
- DO NOT add new CI gates
- DO NOT roll back any Wave 2/2.5/2.6/2.7/2.8/2.8.1 work
- DO NOT use `git add .` or `git add -A` — explicit file paths only (per MEMORY.md)
- DO NOT use `--no-verify` on commits
- DO NOT add Co-Authored-By line
- DO NOT modify SwipeableBoardCards.tsx
- DO NOT modify useDeckCards.ts or RecommendationsContext.tsx
- The new `useEffect` at 0694-G MUST be placed above any early returns (Hook ordering — verified by `check-react-hooks-rules.sh`)
- The 2-rAF chain MUST be deleted, NOT commented out (Constitution #8)
- All 10 existing CI gates must remain green
- TypeScript MUST remain at 3 pre-existing baseline errors (zero new)

---

## §12 Estimated Effort

- Implementor: ~30-45 minutes wall time (read 4 file regions + apply 7 changes + verify CI/TS + write report)
- Founder retest: ~5 minutes wall time (T-01, T-04, T-06, T-08, T-15 — the visual gates)
- Total to PASS: ~50 min — 1 hour wall time

---

## §13 Confidence Statement

**Spec confidence: HIGH.**
- Mechanism proven HIGH in investigation report.
- Pattern α vs β decision reasoned with explicit trade-off.
- Collab parity audit complete (architectural difference confirmed by direct file read, not inference).
- All success criteria are observable + grep-verifiable + visually-testable.
- Belt-and-suspenders useEffect (0694-G) hedges against the one residual timing risk (1-frame "old card snaps back" possibility).
- Estimated implementor diff is small enough (<80 LOC) that the implementor cannot accidentally expand scope.

**Residual risk:** Pattern α relies on React's same-render-pass key-swap behavior. If a future React/RN version changes commit timing, 0694-G remains the safety net. If even that fails (extremely unlikely), Pattern β extraction is the documented fallback.

---

**End of spec. Ready for implementor dispatch.**
