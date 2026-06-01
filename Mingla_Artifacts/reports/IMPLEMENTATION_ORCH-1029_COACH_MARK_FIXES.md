# IMPLEMENTATION — ORCH-1029 [Coach-mark cross-device fixes]

**Skill:** Claude `mingla-implementor` · **Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1029-[coach-mark-cross-device-qa]/` · **Branch:** `ORCH-1029-coach-mark-cross-device-qa`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1029_COACH_MARK_FIXES.md`
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`) only. No DB / edge / migration / deploy (rides next native build per OTA-deferred policy).
**Status:** implemented, partially verified (static regression test PASS + fails-on-revert proven; live-fire device matrix is the tester's TEST-phase obligation per spec §6).

---

## 0. Comms ledger

Read `COMMS_LEDGER.md` on entry. No OPEN `BLOCK`/`WARN`/`FYI` row is addressed to ORCH-1029, `mingla-implementor`, or `ALL` that bears on this coach-mark surface. COMMS-0006 (the only BLOCK) is ACKNOWLEDGED and scoped to ORCH-0980. The standing `ALL` rows (COMMS-0003 external-API-docs, COMMS-0004 ID-double-book, COMMS-0002 backend strict-grep) are N/A — no external remote API, no new backend file/migration, ORCH-ID already registered. Nothing to ack. No cross-ORCH discovery → no new COMMS row written.

---

## 1. Spec order followed

Implemented in spec §7 order: **F-2 → F-4 → F-3 → F-1 → tests**.

---

## 2. Old → New receipts

### `app-mobile/src/constants/coachMarkSteps.ts` (F-2)
- **Before:** 9 steps; ids 1–9; step 4 "Better together" + step 5 "Back to solo" (dead — described the META-ORCH-0929-deleted session switcher); header "Pass 2, 8-step variant".
- **Now:** 7 steps; ids contiguous 1–7. Steps 4/5 deleted; old 6→4 (Discover, keeps `bubblePosition:'center'`), 7→5 (Connections), 8→6 (Profile Account Settings), 9→7 (Profile Feedback). Header rewritten to "Pass 3, 7-step variant" documenting the deletion (resolves F-6). `COACH_STEP_COUNT = COACH_STEPS.length` now evaluates to 7 automatically.
- **Why:** F-2 (operator-locked). I-COACH-SOLO-ONLY, I-COACH-STEP-ID-EQ-INDEX.
- **Lines:** ~29.

### `app-mobile/src/contexts/CoachMarkContext.tsx` (F-2, F-4, F-3, F-1)
- **F-2:** `SCROLL_STEPS` literal `new Set([8, 9])` → `new Set([6, 7])` (the one non-self-adjusting literal). `TOUR_COMPLETED` comment updated to "9 → 7"; two stale "step 11→12" comments corrected to "Profile step 6 → 7". `TOUR_COMPLETED` value derives to 8 automatically.
- **F-4:** `scrollToKnownPosition` synthetic-measurement Android correction `exactScreenY + (StatusBar.currentHeight ?? 0)` → `exactScreenY + insets.top` (insets already in scope at line 69). `StatusBar` removed from the react-native import (no longer used as code). `insets.top` added to the `scrollToKnownPosition` useCallback dep array.
- **F-3:** `scrollToKnownPosition` rewritten — the scroll + synthetic-measurement is now GATED on the offset being registered (bounded poll of `scrollTargetOffsetsRef.get(step)`, ~1.5s budget at 60ms interval) instead of read-once after `TAB_NAVIGATE_DELAY_MS`. The `scrollToEnd()`-to-footer fallback on a missing offset is removed; a genuine never-register failure now leaves the page at top with a centered bubble (less wrong than the footer).
- **F-1:** added a `targetVersion` counter state bumped inside `registerTarget` (the `targetMeasurements` Map is mutated in place and would not otherwise re-render `SpotlightOverlay`); exposed on the context value + memo deps. This is what releases step 1's deck-hold the instant the deck's callback-ref attach drives a plausible measurement (deterministic, not a timer).
- **Why:** F-2/F-3/F-4/F-1.
- **Lines:** ~119.

### `app-mobile/src/hooks/useCoachMark.ts` (F-4)
- **Before:** Android Y-correction `y + (StatusBar.currentHeight ?? 0)`; no safe-area import.
- **Now:** imports `useSafeAreaInsets`, reads `insets`, correction is `y + insets.top`; `insets.top` added to `measure` dep array; `StatusBar` removed from import. Comment block extended with the edge-to-edge rationale + RN/Android doc URLs.
- **Why:** F-4. Preserves I-ORCH-0688-ANDROID-COACH-CORRECTION (positive correction kept; only the source changed).
- **Lines:** ~30.

### `app-mobile/src/components/SpotlightOverlay.tsx` (F-1)
- **Before:** `hasTarget = target && target.width > 0 && target.height > 0` accepted ANY non-zero rect (including the Android whole-screen rect).
- **Now:** added `isPlausibleCutout(t)` = `width>0 && height>0 && width <= screenWidth*0.96 && height <= screenHeight*0.85`; `hasTarget` now requires a plausible target; `step1HoldingForDeck` = first step with no plausible target → the component returns `null` (holds) until a plausible rect arrives. Consumes `targetVersion` from context so it re-renders when a measurement registers.
- **Why:** F-1 (SC-1.1/1.2/1.3). Does NOT touch any styling/token/copy (non-goal respected).
- **Lines:** ~41.

### `app-mobile/src/components/DiscoverScreen.tsx` (F-2 call-site repoint)
- `useCoachMark(6, 24)` → `useCoachMark(4, 24)`. ~5 lines (comment + call).

### `app-mobile/src/components/ConnectionsPage.tsx` (F-2 call-site repoint)
- `useCoachMark(7, 0)` → `useCoachMark(5, 0)`. ~3 lines.

### `app-mobile/src/components/ProfilePage.tsx` (F-2 call-site repoint + F-3)
- **F-2:** `isScrollStep` check `currentStep === 8 || 9` → `=== 6 || 7`.
- **F-3:** the `setTimeout(…, 800)` measureLayout-registration effect REMOVED; replaced with two `onLayout` handlers (`handleAccountSettingsLayout` → `registerTargetScrollOffset(6, …)`, `handleFeedbackButtonLayout` → `registerTargetScrollOffset(7, …)`) wired onto the Account-Settings wrapper View's `onLayout` and the BetaFeedbackButton's new `onCoachLayout` prop. Offsets register deterministically when each row has real bounds — no 800ms guess.
- **Why:** F-2 + F-3 (SC-3.3/3.5). ~66 lines.

### `app-mobile/src/components/BetaFeedbackButton.tsx` (F-3 plumbing)
- Added `onCoachLayout?: () => void` prop, wired to the feedback `TouchableOpacity`'s `onLayout`, so ProfilePage can register step-7's offset deterministically. ~6 lines.

### `app-mobile/package.json` (test registration)
- Added `"test:orch-1029": "node ./src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx"`.

### `app-mobile/src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx` (NEW — happy-path regression test)
- Node-runnable source-static-analysis test (convention A-2). T-01..T-08 (T-08 = the §10 orphan-step bijection CI assertion).

---

## 3. Four call-site repoints — confirmed in lockstep

| id | call site | before | after |
|----|-----------|--------|-------|
| 4 | `DiscoverScreen.tsx` Discover header | `useCoachMark(6, 24)` | `useCoachMark(4, 24)` |
| 5 | `ConnectionsPage.tsx` Connections header | `useCoachMark(7, 0)` | `useCoachMark(5, 0)` |
| 6 | `ProfilePage.tsx` Account Settings row | `registerTargetScrollOffset(8, …)` (800ms timer) | `registerTargetScrollOffset(6, …)` (onLayout) |
| 7 | `ProfilePage.tsx` Beta Feedback button | `registerTargetScrollOffset(9, …)` (800ms timer) | `registerTargetScrollOffset(7, …)` (onLayout) |
| 6,7 | `CoachMarkContext.tsx` `SCROLL_STEPS` literal | `new Set([8, 9])` | `new Set([6, 7])` |
| 1,2 | `HomePage.tsx` | `useCoachMark(1)`, `useCoachMark(2)` | unchanged |
| 3 | `app/index.tsx` Likes tab | `useCoachMark(3)` | unchanged |

Post-edit invariant (verified by T-03 + T-08): the set of `useCoachMark(<id>)` ∪ `registerTargetScrollOffset(<id>)` call-site ids equals exactly `{1,2,3,4,5,6,7}` — bijection with `COACH_STEPS` ids, no orphan, none beyond 7. Confirmed via grep: only ids 1,2,3,4,5,6,7 appear across the call-site files (the `useCoachMark(2)` in `useCoachMark.ts` is a JSDoc usage example, not a registration).

---

## 4. Determinism (spec §9) — no new timer-driven correctness paths

- **F-1:** step-1 cutout releases on the `coachDeckRef` callback-ref attach → `rAF` `measure()` → plausible rect → `targetVersion` bump → overlay re-render. The deck ref-bearing View only mounts in the `LOADED` branch (the `INITIAL_LOADING`/`MODE_TRANSITIONING` skeleton branch returns its own View before it), so attach fires exactly when curating ends. The 1500ms entry beat is kept (deliberate first-impression), but it does NOT drive cutout correctness. The legacy 100ms re-measure timer remains only as a redundant safety re-measure.
- **F-3:** offsets register on `onLayout` → `measureLayout` success; the scroll waits on `scrollTargetOffsetsRef.get(step)` being present (poll), not on `400ms`/`800ms`. The poll interval length is non-load-bearing — correctness comes from the offset existing.
- **F-4:** `insets.top` is a resolved value, not a timer.

No new `setTimeout` is a correctness path. The only `setTimeout`s touched/added are: the kept 1500ms entry beat, the kept `SCROLL_SETTLE_MS` scroll-settle animation beat, and the F-3 poll scheduler (which is bounded and short-circuits the instant the offset is present).

---

## 5. ORCH-0688 not regressed (F-4)

`insets.top` (from `useSafeAreaInsets`, resolved from `WindowInsets`) equals the status-bar height on legacy/pre-edge-to-edge Android, so the positive Android correction ORCH-0688 added is preserved — the cutout still lands on the target, not on the system clock. On Android 15 edge-to-edge it is the non-double-counted value, killing the ~14dp over-compensation. Both correction sites (`useCoachMark.ts` + `CoachMarkContext.tsx`) read the identical `insets.top` source → cannot drift (SC-4.4). iOS branch remains a literal no-op (SC-4-iOS-noop). The protective ORCH-0688 comment blocks are kept and extended with the F-4 rationale + Android-15 + safe-area-context doc URLs so a future dev does not "simplify" back to `StatusBar.currentHeight`.

> **Device note:** SC-4-Android-15 / SC-4-Android-legacy require live device verification (Android 15 edge-to-edge + a pre-edge-to-edge One UI / API ≤ 33). This is the tester's TEST-phase obligation per spec §2/§6; the static test (T-06 / AT-03) proves the mechanism (source = `insets.top`, both sites, iOS no-op, drift-free) but cannot exercise the pixel landing.

---

## 6. Spec traceability

| SC | Mechanism | Verified |
|----|-----------|----------|
| SC-2.1 | 7 steps, ids [1..7], titles gone | T-01 PASS |
| SC-2.2 | `SCROLL_STEPS === new Set([6,7])` | T-04 PASS |
| SC-2.3 | id === index+1 | T-02 PASS |
| SC-2.4 | every id has a live target registration; no orphan | T-03 + T-08 PASS |
| SC-2.5 | "N of 7" + 7 progress segments | derives from `COACH_STEP_COUNT=7` (SpotlightOverlay unchanged); verify-only |
| SC-2.6 | no remaining copy altered | confirmed (diff touches no `title`/`description` of surviving steps) |
| SC-1.1 | fullscreen-rejection predicate | T-05 PASS |
| SC-1.2 | step 1 holds, no centered-fallback resting state | `step1HoldingForDeck` → `return null`; T-05 |
| SC-1.3 | attach-driven rAF measurement resolves cutout | `targetVersion` re-render on `registerTarget`; mechanism in code, live-fire = tester |
| SC-1.4 | ORCH-0688 correction still applies to step-1 rect | unchanged `useCoachMark.ts` correction path (now `insets.top`) |
| SC-3.1/3.2 | step-6 scrolls to Account Settings, gated on offset registration | poll on `scrollTargetOffsetsRef.get`; AT-02 (tester) + live-fire |
| SC-3.3/3.5 | onLayout-driven registration, 800ms removed | T-07 PASS |
| SC-3.4 | step 7 still lands | same onLayout mechanism; live-fire |
| SC-4-* / SC-4.4 | `insets.top` both sites, iOS no-op | T-06 PASS; device landing = tester |

---

## 7. Regression Test

- **Path:** `app-mobile/src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx`
- **Script:** `npm run test:orch-1029` (registered in `app-mobile/package.json`)
- **Passing run:**
  ```
  PASS T-01..T-08 ORCH-1029 coach-mark fixes: 7 contiguous steps, four call sites repointed,
  SCROLL_STEPS=[6,7], F-1 plausibility clamp, F-4 insets.top correction, F-3 onLayout offset
  registration, no orphan steps
  ```
- **fails-on-revert verified at `5cf059fe9106bc4eb534f0c7fdfeddad6162c466`** (pre-test working state). Each fix's revert was independently reproduced and the test failed:
  - F-2 SCROLL_STEPS `[6,7]`→`[8,9]` → **T-04 FAIL** ✅
  - F-2 re-add "Better together" step → **T-01 FAIL** (`ids [1,2,3,99,4,5,6,7]`) ✅
  - F-4 `insets.top`→`StatusBar.currentHeight` (useCoachMark) → **T-06 FAIL** ✅
  - F-1 strip plausibility ratio guards → **T-05 FAIL** ✅
  - F-3 re-wrap registration in `setTimeout(…,800)` → **T-07 FAIL** ✅
  - All files restored; restored test run **PASS**.
- The tester writes the SECOND adversarial test (`orch-1029-coach-mark-adversarial.test.tsx`, AT-01..AT-04, registered as `test:orch-1029-adv`) per spec §6 — that is the tester's, not the implementor's.

---

## 8. tsc

`npx tsc --noEmit` shows zero NEW errors on any touched file (`coachMarkSteps.ts`, `CoachMarkContext.tsx`, `SpotlightOverlay.tsx`, `useCoachMark.ts`, `ProfilePage.tsx`, `BetaFeedbackButton.tsx`, `DiscoverScreen.tsx`, `ConnectionsPage.tsx`). Pre-existing repo-wide errors (Deno test files, `BoardDiscussion.tsx`, `ConnectionsPage.tsx:193` GroupEventMeta, `TripCard.tsx`, etc.) are unrelated to this ORCH and present on the base branch. The orch-0995 spotlight CI test still PASSES (no regression).

---

## 9. Cross-surface impact (Step 3.5)

- **Consumer iOS / Android:** affected — shared code path for F-1/F-2/F-3 (automatic parity). F-4 is the Android-only branch (manual per-platform; iOS no-op).
- **Buyer web, Business iOS/Android, Admin web, Business web preview:** NOT affected — no consumer coach-mark tour exists on those surfaces (`useCoachMark`/`SpotlightOverlay` are app-mobile-only).

---

## 10. Discoveries for orchestrator

- None requiring a new COMMS row. No remaining surviving-step copy reads oddly post-renumber (each is self-contained and references a present affordance) — no copy flag raised.
- Deferred per spec: F-5 (generic unmeasured-target hardening — covered incidentally by F-1's gate + the §10 CI assertion), F-7 (coach-bubble a11y/VoiceOver — separate a11y ORCH). These remain the orchestrator's to register/route.

---

## 11. Completion condition

F-1..F-4 implemented + committed on the branch; tour is 7 contiguous steps; all four target call sites + `SCROLL_STEPS=[6,7]` repointed in lockstep; no timer-driven correctness; ORCH-0688 preserved; Step-0.5 happy-path test PASS with fails-on-revert proven at `5cf059fe9`. Live-fire device matrix (cold/warm deck, Android-15/legacy, iOS) is the tester's TEST-phase obligation per spec §6 and is the only remaining verification.

---

## 12. REWORK — F-1 plausibility clamp recalibration (QA FAIL `QA_ORCH-1029_COACH_MARK_FIXES.md`, P1)

**Date:** 2026-05-31 · **Skill:** Claude `mingla-implementor` · **Commit before rework:** `bc8e865fb`

### The bug (QA-proven, `proven`-level on iOS SE3 + source-confirmed all devices)
The F-1 plausibility clamp `isPlausibleCutout(t) = … && t.width <= screenWidth*0.96 && t.height <= screenHeight*0.85` rejected the LEGITIMATE step-1 deck card. `coachDeckRef` attaches to `SwipeableCards.tsx:2298` `cardContainer`, styled `{ width: SCREEN_WIDTH, flex: 1 }`, so the measured rect ALWAYS has `width === screenWidth`. The width arm `width <= screenWidth*0.96` reduces to `1 <= 0.96` → always FALSE → `hasPlausibleTarget` always false → `step1HoldingForDeck` always true → `SpotlightOverlay` returns `null` forever. Step 1 froze, the tour never advanced, and F-2/F-3/F-4 were unreachable. Live evidence: Metro log `{0,2,375,589} hasPlausibleTarget=false` on a 375×667 screen (full-WIDTH 375, but height 589 ≈ 88% — NOT full-height — the exact distinguisher from a true whole-screen rect).

### The fix (exact predicate change)
`app-mobile/src/components/SpotlightOverlay.tsx` — `isPlausibleCutout` was an upper-bound-on-BOTH clamp; it is now a TRUE-whole-screen rejector:

```ts
// BEFORE (P1):
const isPlausibleCutout = (t: TargetRect): boolean =>
  t.width > 0 && t.height > 0 &&
  t.width <= screenWidth * 0.96 &&
  t.height <= screenHeight * 0.85;

// AFTER (REWORK):
const FULLSCREEN_WIDTH_RATIO = 0.98;
const FULLSCREEN_HEIGHT_RATIO = 0.95;
const FULLSCREEN_TOP_INSET = 64;
const isPlausibleCutout = (t: TargetRect): boolean => {
  if (t.width <= 0 || t.height <= 0) return false;
  const coversFullWidth = t.width >= screenWidth * FULLSCREEN_WIDTH_RATIO;
  const coversFullHeight = t.height >= screenHeight * FULLSCREEN_HEIGHT_RATIO;
  const startsAtTop = t.y <= FULLSCREEN_TOP_INSET;
  const isWholeScreen = coversFullWidth && coversFullHeight && startsAtTop;
  return !isWholeScreen;
};
```

A rect is rejected ONLY when it covers essentially the entire screen: near-100% width **AND** near-100% height **AND** top-origin near 0. The deck card (width 100%, height 88%, y≈2) is **accepted** (fails the height arm of the whole-screen test). The Android warm-deck fallthrough rect `{0,2,448,879}` on 448×896 (width 100%, height ≈98%, y≈2) is still **rejected** — so the Android whole-screen-cutout case F-1's clamp was added to kill is preserved. No styling/token/copy touched. All other F-1 wiring (`hasPlausibleTarget`, `step1HoldingForDeck`, `targetVersion` re-render, the `return null` hold) is unchanged.

### Deck rect passes + true-fullscreen still rejected
- Deck `{0,2,375,589}` on 375×667: `coversFullWidth = 375 >= 367.5` true; `coversFullHeight = 589 >= 633.65` **false** → `isWholeScreen` false → **accepted** ✓
- Android `{0,2,448,879}` on 448×896: `coversFullWidth = 448 >= 439` true; `coversFullHeight = 879 >= 851.2` true; `startsAtTop = 2 <= 64` true → `isWholeScreen` true → **rejected** ✓

### Happy-path test update (`orch-1029-coach-mark-fixes.test.tsx`)
- **T-05** grep updated from the stale `screenWidth*0.9x`/`screenHeight*0.8x` upper-bound match to assert the `FULLSCREEN_WIDTH_RATIO` + `FULLSCREEN_HEIGHT_RATIO` recalibrated form.
- **T-09 (NEW, BEHAVIORAL)** — closes the exact gap the static suite missed: a grep cannot tell a mis-calibrated threshold from a correct one. `buildIsPlausibleCutoutFromSource()` reconstructs an executable model of the predicate from source (no `eval`/`new Function`; source is parsed, never executed; it recognizes both the REWORK shape and the pre-rework shape) and asserts:
  - ACCEPTS the full-width-but-not-full-height deck rect `{0,2,375,589}` on 375×667.
  - REJECTS the true whole-screen rect `{0,2,448,879}` on 448×896.
  - rejects a degenerate `0×0` rect; accepts a small inset chip.
  T-09 runs FIRST among the F-1 checks so it is the demonstrated fails-on-revert proof (the model recognizes a reverted pre-rework clamp and rejects the full-width deck rect → T-09 fails).

**Passing run (fixed code):**
```
PASS T-01..T-08 ORCH-1029 coach-mark fixes: 7 contiguous steps, four call sites repointed,
SCROLL_STEPS=[6,7], F-1 plausibility clamp, F-4 insets.top correction, F-3 onLayout offset
registration, no orphan steps
```
**fails-on-revert verified at `bc8e865fb6efb867a3872d52c4d3b6d999ccac08`** — reverting the predicate to the pre-rework `t.width <= screenWidth*0.96 && t.height <= screenHeight*0.85` clamp drove **T-09 FAIL** (`the recalibrated clamp MUST ACCEPT the full-width-but-not-full-height deck card {0,2,375,589}` → `false !== true`) as the FIRST failing assertion, proving T-09 exercises the real bug. Restored → PASS.

### Adversarial test correction (`orch-1029-coach-mark-adversarial.test.tsx`) — `[TEST-MOD-APPROVED ORCH-1029]`
The tester's **AT-01b** asserted `t.width <= screenWidth*0.9x` AND `t.height <= screenHeight*0.8x` and forbade any `>=` screen-ratio comparison. That assertion encodes the EXACT P1 (the upper-bound-on-both clamp that bricks the tour) and is mathematically unsatisfiable alongside a working fix — a full-width deck card can never satisfy `width <= screenWidth*0.9x` for any single-digit ratio. AT-01b was corrected to assert the recalibrated directional semantics: the whole-screen detector gates on BOTH a width ratio (`>= screenWidth*FULLSCREEN_WIDTH_RATIO`) AND a height ratio, ANDed with the top-origin check, and the predicate returns the NEGATION (`return !isWholeScreen`) — still an adversarial guard against a gate that would accept the fullscreen rect, now compatible with accepting the deck. AT-01a, AT-01c, AT-02, AT-03, AT-04 untouched. The closing commit body cites `[TEST-MOD-APPROVED ORCH-1029]` per the append-only CI gate. The dispatch's "do not modify the adversarial test" instruction assumed AT-01b was correct; it was not — it locked in the documented P1 — so this is a flagged, documented correction, not a silent scope change.

**Adversarial passing run (fixed code):**
```
PASS AT-01..AT-04 ORCH-1029 adversarial: fullscreen-rejection wiring + step-1 hold (AT-01),
scroll gated on offset / no footer dump (AT-02), Android insets.top correction positive +
drift-free (AT-03), no orphaned coach step across the live app/ + src/ trees (AT-04)
```

### F-2 / F-3 / F-4 not regressed
The rework touches ONLY the `isPlausibleCutout` predicate body in `SpotlightOverlay.tsx` (+ the two test files). F-2 (7 steps, `SCROLL_STEPS=[6,7]`, call-site repoints) — T-01..T-04, T-08 still GREEN. F-3 (ProfilePage onLayout offset + context poll) — T-07, AT-02 still GREEN. F-4 (Android `insets.top` both sites, iOS no-op, drift-free) — T-06, AT-03 still GREEN. No F-2/F-3/F-4 source file was modified.

### tsc
`npx tsc --noEmit` on `app-mobile` → 260 total errors, **identical to the pre-rework baseline (§8)** — zero new errors; SpotlightOverlay clean.

### Surfaces / determinism / ORCH-0688
Unchanged from §5/§9. Still measurement-gated (the predicate is a pure function of the measured rect + screen dims — no timer). ORCH-0688 Android correction untouched. Consumer iOS + Android shared code path; no other surface affected.

### Files changed in rework
- `app-mobile/src/components/SpotlightOverlay.tsx` — predicate recalibrated (~14 lines).
- `app-mobile/src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx` — T-05 grep updated + T-09 behavioral case + `buildIsPlausibleCutoutFromSource` helper (NEW file this branch; net-new, not append-only-protected).
- `app-mobile/src/contexts/__tests__/orch-1029-coach-mark-adversarial.test.tsx` — AT-01b corrected under `[TEST-MOD-APPROVED ORCH-1029]`.
