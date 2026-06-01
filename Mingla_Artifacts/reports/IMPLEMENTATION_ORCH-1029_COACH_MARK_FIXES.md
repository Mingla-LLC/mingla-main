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
