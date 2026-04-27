# Investigation Report — ORCH-0694: Deck Ghost-Card After Swipe-Left

**Status:** root cause **probable** (mechanism proven in code; exact symptom requires one round of runtime confirmation)
**Date:** 2026-04-27
**Investigator:** mingla-forensics
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_ORCH-0694_DECK_GHOST_CARD_AFTER_SWIPE.md`
**Predecessors:** ORCH-0679 Wave 2.8 (Path B IIFE switch — HomePage now mounts/unmounts on tab switch)

---

## §1 Layman Summary

After you swipe a card left, a wedge of the previous card lingers at the bottom-left of the screen. The **mechanism** is proven from code: there's an intentional 2-frame delay between (a) the swiped card finishing its exit animation + state advancing to the next card, and (b) the shared transform values (`positionX`/`positionY`) snapping back to zero. During those 2 frames, two things happen at once: the new top card is rendered with stale transform values that put it far off-screen down-and-left, and the card behind it (the next-next card) is rendered at scale 0.95, fully visible, centered. Combined with the swipe-rotation residue, the visible artifact is exactly the wedge you see.

This bug is **almost certainly pre-existing** in the swipe completion logic. Wave 2.8 did NOT change `SwipeableCards`, but Wave 2.8's tab unmount/remount lifecycle may make the artifact more frequent or visible on Android because every tab return now starts SwipeableCards from a fresh mount (no warm Animated value optimization).

The fix direction is straightforward: close the 2-rAF window. Three viable approaches detailed in §8.

---

## §2 Symptom Summary

**Expected:** After swiping a card left past the threshold, the swiped card animates off-screen left, the next card snaps to the active position (full-size, opaque), and no fragment of the swiped card remains visible.

**Actual (founder, 2026-04-27, Android dev-client):** New card (Frankie's of Raleigh → It's a Southern Thing) is correctly visible at the active position. **A wedge of a different card remains visible at bottom-left of the screen** — appears triangular with a faint shadow, content visible includes a "Share" button (suggesting the bottom-left corner of a card's `cardDetails` strip is showing).

**Reproduction:** Triggered by swipe-left gesture on Home/Explore tab deck. Frequency unknown (one founder screenshot). Exact gesture parameters (swipe speed, dy at release) unknown.

**Mode:** Solo confirmed. Collab parity status unknown — `SwipeableBoardCards` is a separate component (1261 lines, not investigated).

---

## §3 Investigation Manifest

| # | File | Why |
|---|---|---|
| 1 | `app-mobile/src/components/HomePage.tsx` | Parent of SwipeableCards. Establish props passed and wrapper styling/clipping. |
| 2 | `app-mobile/src/components/SwipeableCards.tsx` (3177 lines) | Primary suspect. Rendering structure, swipe handlers, transform logic, rAF chain. |
| 3 | `app-mobile/src/hooks/useDeckCards.ts` | Data source — ruled out (no removal logic, no animation). |
| 4 | `app-mobile/src/components/SwipeableBoardCards.tsx` (line counts only) | Confirmed it's a separate component, not co-rendered. Out of scope for this bug. |

`RecommendationsContext.tsx` (deckStateRegistry, 1798 lines) was NOT read in full. The bug appears to be at the visual render layer of SwipeableCards, not at the registry layer. If runtime data shows the bug is registry-driven, this should be re-investigated.

---

## §4 Findings

### 🔴 ROOT CAUSE (probable) — RC-1: Render-during-rAF artifact in swipe completion

**File + line:** `app-mobile/src/components/SwipeableCards.tsx:1311-1347`

**Exact code:**
```ts
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
  setRemovedCards((prev) => new Set([...prev, cardToRemove.id]));
  setCurrentCardIndex(0);
  handleSwipeRef.current?.(direction, cardToRemove)?.catch((err) => { ... });

  // Wait for React to render the next card before resetting position
  // This prevents the flash/flicker — DO NOT remove this rAF chain.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      positionX.setValue(0);
      positionY.setValue(0);
    });
  });
});
```

**What it does:** When the exit animation completes, it (1) advances state immediately (removes the card, resets index), then (2) waits 2 requestAnimationFrame cycles, then (3) resets positionX and positionY to 0.

**Why this creates the artifact:** Between state advance (step 1) and position reset (step 3), React re-renders. The single `<Animated.View>` block that renders the "Current Card" (line 2253-2266) reuses the same node — no `key` prop on currentRec — so the transform values persist across the card swap. After step 1:
- `availableRecommendations[0]` = NEW current card (e.g., Frankie's)
- The Current Card `Animated.View` now renders Frankie's content but with `positionX = -SCREEN_WIDTH`, `positionY = +gestureState.dy`, `rotate = -30deg`. **Frankie's is rendered off-screen down-and-left, rotated.**
- Simultaneously, the Next Card render (line 2155-2249) renders `availableRecommendations[1]` (next-next card) at `scale 0.95`, with `opacity = nextCardOpacity`. At `positionX = -SCREEN_WIDTH`, the interpolation at line 675-678 (input range [-SCREEN_WIDTH/2, 0, SCREEN_WIDTH/2] → output [1, 0, 1]) extrapolates **above 1** (clamped to 1). Next-next card is **centered, fully visible at scale 0.95**.

**What it should do:** The new current card should be at translation (0, 0) with rotate 0deg, scale 1, opaque. The card behind it should be invisible (opacity 0) until a new swipe starts. There should be no transition window where stale transform values from the previous swipe are applied to a new card.

**Causal chain — step by step:**
1. User swipes card A left past threshold (gestureState.dx < -120).
2. `Animated.parallel` runs: `positionX` 0 → -SCREEN_WIDTH, `positionY` 0 → +gestureState.dy, over 250ms.
3. Animation `.start(callback)` fires when both axes reach target.
4. Callback runs synchronously: `setRemovedCards`, `setCurrentCardIndex(0)`, fire-and-forget `handleSwipe`.
5. React batches state and re-renders.
6. New render: `availableRecommendations` filters out card A (now in `removedCards`). currentRec = card B (was the next card). nextCard = card C.
7. The `<Animated.View>` at line 2254 still has `transform: [{translateX: -SCREEN_WIDTH}, {translateY: +dy}, {rotate: -30deg}]` because `positionX`/`positionY` haven't been reset yet — they're still at their animation end values.
8. Card B renders inside that Animated.View — **off-screen, down-and-left, rotated**.
9. The "Next Card" Animated.View renders card C with `scale 0.95`, `opacity = nextCardOpacity` ≈ 1 (extrapolated/clamped).
10. **User sees: card C centered (scale 0.95), card B off-screen (mostly invisible, but a sliver of its rotated bounding box may extend back into the viewport — bottom-left wedge).**
11. 1 rAF: nothing changes.
12. 2 rAFs: `positionX.setValue(0); positionY.setValue(0);` fires. Native driver propagates. Card B teleports to (0, 0). Card C's `nextCardOpacity` flips to 0 — invisible.
13. Now card B is correctly the active card.

The visible artifact in the screenshot is the **frame at step 10**, captured before step 12 fired. Or persisting because of platform-specific native driver propagation lag.

**Verification step (MUST be run before fix):**
1. Add a temp log at line 1322 (inside `.start(() => { ... })`): `console.log('[SwipeFix] anim done, positionX=', (positionX as any)._value, 'positionY=', (positionY as any)._value, 'dy=', gestureState.dy);`
2. Add a temp log at the rAF reset (line 1343): `console.log('[SwipeFix] rAF reset firing');`
3. Swipe left repeatedly on Android dev-client. Confirm the rAF reset log appears AFTER the animation done log on every swipe.
4. Optional: add a frame counter log on every render of the main Animated.View. Verify the new current card's render happens BEFORE the rAF reset — that's the bug window.
5. **If the rAF reset log NEVER fires after a swipe**, the issue is more severe (callback path broken). That'd be a different root cause.

---

### 🟠 CONTRIBUTING FACTOR — CF-1: nextCardOpacity extrapolation extends above 1

**File + line:** `app-mobile/src/components/SwipeableCards.tsx:675-678`

```ts
const nextCardOpacity = positionX.interpolate({
  inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
  outputRange: [1, 0, 1],
});
```

No `extrapolate: 'clamp'`. Default is `'extend'`. At `positionX = -SCREEN_WIDTH` (end of left swipe, beyond -SCREEN_WIDTH/2), the interpolation extrapolates linearly past 1. React Native clamps the rendered opacity to [0, 1], but the animated value itself drives at value > 1 internally. This guarantees the next-next card stays at maximum opacity during the entire rAF window, contributing to the visible artifact.

**Fix:** add `extrapolate: 'clamp'` (or `extrapolateLeft: 'clamp', extrapolateRight: 'clamp'`).

---

### 🟠 CONTRIBUTING FACTOR — CF-2: positionY animates to gestureState.dy (residual diagonal)

**File + line:** `app-mobile/src/components/SwipeableCards.tsx:1317-1321`

```ts
Animated.timing(positionY, {
  toValue: gestureState.dy,
  duration: 250,
  useNativeDriver: true,
}),
```

The exit animation drives `positionY` to whatever Y-position the user's finger was at on release. If they swiped diagonally (most natural finger gestures), `dy` is non-zero. This means the swipe-end transform is `(±SCREEN_WIDTH, +dy)`. During the rAF window, the new current card inherits this `+dy` translateY — putting it not just off-screen LEFT but also off-screen DOWN.

This is intentional (mirrors finger trajectory for visual continuity) but it **multiplies the visible artifact area** by ensuring the new current card's bounding box is offset both axes.

**Fix:** consider tightening `gestureState.dy` clamp (e.g., `Math.max(-100, Math.min(100, gestureState.dy))`) OR include `positionY` in the rAF reset window (already done — line 1344) but ensure no render happens with stale Y.

---

### 🟡 HIDDEN FLAW — HF-1: Single Animated.Value pair shared across all cards

**File + line:** `app-mobile/src/components/SwipeableCards.tsx:661-662`

```ts
const positionX = useRef(new Animated.Value(0)).current;
const positionY = useRef(new Animated.Value(0)).current;
```

`positionX`/`positionY` are component-instance-level — created once per mount of SwipeableCards, shared by every card that occupies the "current" slot. There is no per-card key. When a swipe completes and the state advances, the new top card inherits the exiting card's transform until the rAF reset fires.

A more robust pattern: give the current card `key={currentRec.id}`, which forces React to unmount the old `<Animated.View>` and create a fresh one (with fresh Animated values) when the card identity changes. This eliminates the shared-state class of bug entirely.

This is the core architectural choice that makes the rAF dance necessary in the first place.

---

### 🔵 OBSERVATION — O-1: HomePage container has overflow:hidden, but deckWrapper does not

**Files:**
- HomePage.tsx:413 — `container` style includes `overflow: "hidden"`
- HomePage.tsx:415-418 — `deckWrapper` style is `{ flex: 1, width: '100%' }` — no overflow
- SwipeableCards.tsx:2522-2539 — `container` and `cardContainer` styles have NO overflow:hidden

The HomePage outer `container` is the actual clipping boundary. Within that boundary, cards translated/rotated outside their natural bounds may still be visible if their rotated bounding box overlaps the visible region. This is consistent with the wedge artifact appearing at bottom-left corner of the visible deck region rather than spilling onto other UI.

---

### 🔵 OBSERVATION — O-2: The "DO NOT remove this rAF chain" comment is load-bearing and brittle

**File + line:** `app-mobile/src/components/SwipeableCards.tsx:1338-1346`

```ts
// Wait for React to render the next card before resetting position
// This prevents the flash/flicker — DO NOT remove this rAF chain.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    positionX.setValue(0);
    positionY.setValue(0);
  });
});
```

The author is aware that the timing is fragile. The comment indicates a previous attempt to remove the chain produced a "flash/flicker" — exactly the artifact this bug now exhibits. The 2-rAF approach is a workaround for a structural design (shared Animated.Value across cards) rather than a fix.

The fix should eliminate the need for the rAF chain entirely (see HF-1 fix direction).

---

### 🔵 OBSERVATION — O-3: Wave 2.8 did NOT modify SwipeableCards or the swipe completion logic

Confirmed by reading the Wave 2.8 implementation report. The IIFE switch only changes WHEN HomePage mounts/unmounts. The swipe handler code is unchanged. Therefore this is **classified as pre-existing**.

However, Wave 2.8's tab unmount/remount lifecycle may **expose this bug more reliably on Android** because:
1. Every tab return creates fresh `Animated.Value` instances (from `useRef(new Animated.Value(0)).current` running anew at mount).
2. AsyncStorage state restoration (line 1037-1083) fires synchronously on mount, potentially altering the render sequence.
3. The first swipe after a tab return is more likely to hit timing edge cases (no warm cache of native driver state).

This is a probable explanation for "why is the founder seeing this NOW after Wave 2.8" without Wave 2.8 being the literal cause.

---

## §5 Five-Layer Cross-Check

| Layer | Result |
|---|---|
| Docs | No spec covers swipe-completion timing. The "DO NOT remove this rAF chain" comment is the only documentation, and it admits fragility. |
| Schema | N/A — pure client visual issue. |
| Code | Mechanism proven (RC-1 + CF-1 + CF-2 + HF-1) above. |
| Runtime | NOT VERIFIED — requires log capture per RC-1 verification step. Founder log shows only [render-count] and tab nav events; no swipe-internal logs to confirm. |
| Data | N/A — `removedCards`/`removedCardIds` data path is correct; the bug is at the visual transform layer, downstream of the data filter. |

**Layer disagreement:** Docs and Code disagree on robustness — the comment claims rAF chain "prevents flash/flicker," but the code path it protects against is exactly what the user is now reporting.

---

## §6 Regression Determination

**Verdict: SUSPECTED PRE-EXISTING.**

**Evidence for pre-existing:**
- The rAF chain at lines 1338-1346 has been in the file for multiple ORCH cycles (ORCH-0675 Wave 1 RC-1 comment at line 1308 indicates per-axis conversion was the most recent change; the rAF chain predates it).
- Wave 2.8 made no changes to SwipeableCards.
- The "DO NOT remove this rAF chain" comment proves the author knew this region was timing-sensitive long before Wave 2.8.

**Evidence Wave 2.8 may make it more visible:**
- Wave 2.8 introduces fresh-mount of SwipeableCards on every Home tab return. Pre-Wave 2.8, SwipeableCards was always-mounted; the rAF timing had a warm-cache advantage.
- Founder reports this bug on the first dev-client retest immediately after Wave 2.8 landed. Either (a) it was always there and the founder never noticed, or (b) Wave 2.8 changed timing characteristics making it more reproducible.

**To confirm definitively:** founder runs the same swipe-left gesture on a build WITHOUT Wave 2.8 (rollback the IIFE switch temporarily, or pull a pre-Wave 2.8 commit). If artifact persists → confirmed pre-existing. If it disappears → Wave 2.8 contributes timing changes.

**Recommendation:** treat as pre-existing for fix priority, since the mechanism is in pre-Wave 2.8 code. But verify the regression assumption with the runtime check above before declaring case closed on the regression question.

---

## §7 Blast Radius

| Surface | Impact |
|---|---|
| Solo Home deck | Confirmed visible artifact |
| Collab/board deck (`SwipeableBoardCards.tsx`) | UNKNOWN — separate component, not investigated. **Must be checked for parity.** |
| Paired-view deck | UNKNOWN — depends on whether paired flows use SwipeableCards or a derivative. Check `usePairedCards.ts` consumers. |
| Saved page swipe interactions | Likely none — Saved uses `SavedExperiencesPage` which doesn't have a swipe-deck pattern. |
| Likes page | Likely none — non-deck UI. |
| Admin dashboard | None — admin doesn't render decks. |

---

## §8 Fix Strategy (DIRECTION ONLY — not a spec)

Three viable approaches, ranked by robustness:

**A. Per-card key + fresh Animated.Values (most robust, biggest change):**
Add `key={currentRec.id}` to the current Animated.View at line 2254. Move `positionX`/`positionY` into a child component that mounts fresh per card. The shared-state bug class is eliminated — every card gets a clean transform from its own mount. The rAF chain becomes unnecessary. Trade-off: more components mount/unmount per swipe; need to verify no perf regression.

**B. Fade-out before rAF reset (medium change):**
Before state advance, instantly set the current card's opacity to 0 (a separate `Animated.Value` not driven by positionX). Then the user sees nothing during the rAF window — no off-screen card, no visible next-next card. After rAF reset, set the current card's opacity back to 1 alongside resetting positionX/Y. Trade-off: more state to track; risk of opacity flicker if timing is off.

**C. Eliminate the rAF window via single-frame batched setState + setValue (smallest change):**
Move `positionX.setValue(0)` and `positionY.setValue(0)` to BEFORE `setRemovedCards` and `setCurrentCardIndex`. Then React's re-render with the new card sees fresh transform values immediately. Trade-off: fights the original "DO NOT remove this rAF chain" comment, which suggests the author tried this and saw flicker — investigation needed into WHY they saw flicker. May be a native-driver timing quirk that re-emerges.

Also apply (independent of A/B/C):
- Add `extrapolate: 'clamp'` to `nextCardOpacity` (line 675-678). Defense-in-depth. CF-1.
- Consider clamping `gestureState.dy` in the exit animation target (line 1317-1321) to prevent extreme diagonal residue. CF-2.

**My recommendation: investigate option C first** (smallest risk, smallest change). If the original flicker re-emerges, escalate to option A. Option B is a fallback if A is too disruptive.

---

## §9 Regression Prevention

If a fix lands, it should be paired with:
- **Per-card render-count log under `__DEV__`:** logs every time the current Animated.View renders with non-zero positionX or positionY. Catches the artifact mechanism returning.
- **Visual snapshot test (if the project supports it):** capture a frame ~50ms after a swipe-left and assert no off-center card content. Hard to wire but high-signal.
- **Comment block at line 1311-1347:** document WHY the chosen fix works, what failure mode it prevents, and what would re-introduce the bug. The current "DO NOT remove this rAF chain" comment is too thin.

---

## §10 Discoveries for Orchestrator

- **D-0694-INV-1:** The `nextCardOpacity` interpolation lacks `extrapolate: 'clamp'`. Even if the primary fix doesn't touch this line, it should be hardened. Low effort, high defense-in-depth.
- **D-0694-INV-2:** The "DO NOT remove this rAF chain" comment indicates a prior author already wrestled with this region. Whoever fixes ORCH-0694 should review git blame on lines 1338-1346 to understand the history before "fixing" their work without context.
- **D-0694-INV-3:** `SwipeableBoardCards.tsx` is 1261 lines and was NOT investigated for parity. If it shares a similar swipe-completion pattern, it likely has the same bug. Collab parity check is REQUIRED before declaring ORCH-0694 fully fixed.
- **D-0694-INV-4:** Wave 2.8.1 (per-tab registry integration) is unrelated to this bug and can proceed in parallel — no scope contention. ORCH-0694 fix and Wave 2.8.1 don't touch the same files.
- **D-0694-INV-5:** Pre-existing classification means no rollback or re-spec of Wave 2.8 is required. Wave 2.8 commit + OTA hold remain on track per the orchestrator's plan.

---

## §11 Confidence Level

**Root cause mechanism: HIGH confidence** — code path proven, transform/state lifecycle traced exactly, two redundant contributing factors identified.

**Exact symptom-to-mechanism match: MEDIUM confidence** — the wedge in the screenshot is consistent with mid-rAF render of the next-next card AND a fragment of a rotated previous card, but cannot be definitively pinned to the specific frame without a video or runtime trace. The verification step in RC-1 will close this gap.

**Regression determination: MEDIUM confidence** — Wave 2.8 code is innocent of the swipe handler. But timing changes from mount lifecycle MAY be a contributor; rollback test would close this.

**Recommendation:** the orchestrator can SPEC the fix immediately based on this investigation — the mechanism is well-enough understood that a fix can be designed without further runtime data. Runtime verification can happen alongside the fix's tester pass.

---

**End of report. Mechanism proven; fix direction identified; runtime confirmation deferred to fix-pass tester.**
