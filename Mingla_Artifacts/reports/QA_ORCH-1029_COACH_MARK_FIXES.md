# QA — ORCH-1029 [Coach-mark cross-device fixes]

**Skill:** Claude `mingla-tester` · **Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1029-[coach-mark-cross-device-qa]/` · **Branch:** `ORCH-1029-coach-mark-cross-device-qa`
**Commit under test:** `e96284f41` (impl `65f62efce` + tester adversarial test)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1029_COACH_MARK_FIXES.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1029_COACH_MARK_FIXES.md`
**Surfaces:** Consumer iOS + Consumer Android (`app-mobile/`).

---

## VERDICT: **FAIL**

- **P0: 0 · P1: 1 · P2: 0 · P3: 1 · P4: 1**
- Static tests: `test:orch-1029` (implementor, T-01..T-08) GREEN; `test:orch-1029-adv` (tester, AT-01..AT-04) GREEN with fails-on-revert proven on all four angles.
- Live-fire: **F-1 step-1 deck spotlight is a hard tour-blocker on device** — the plausibility clamp rejects the legitimate deck card on every device, so step 1 holds forever and the tour never starts/advances. Proven `proven`-level on iOS (Metro logs + screenshots + source math).
- Because step 1 never presents, **F-2 / F-3 / F-4 are unreachable through the UI** (the tour dies at step 1), so their device landings cannot be confirmed. They are not independently passable while F-1 bricks the tour.

---

## 0. Comms ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No OPEN `BLOCK` row targets ORCH-1029, `mingla-tester`, or `ALL` that bears on this coach-mark surface (COMMS-0006 BLOCK is ACKNOWLEDGED + scoped to ORCH-0980). COMMS-0017 (physical Samsung A72 `R58R54YV7JT` reserved for ORCH-1016) is **RESOLVED** as of 2026-05-31 — the device is released; I used the Android-15 emulator + iOS sims and did not drive the physical A72 destructively. Standing `ALL`/WARN rows (COMMS-0003 external-API-docs, COMMS-0004 ID-double-book, COMMS-0002 backend strict-grep, COMMS-0012/13/15 etc.) are N/A — this ORCH touches no external remote API, no backend file/migration, ID already registered. Nothing to ack; no cross-ORCH discovery requiring a new COMMS row.

---

## 1. Adversarial regression test (Step-0.5 gate — tester obligation)

- **Path:** `app-mobile/src/contexts/__tests__/orch-1029-coach-mark-adversarial.test.tsx`
- **Script:** `npm run test:orch-1029-adv` (registered in `app-mobile/package.json`)
- **Angle (distinct from implementor's happy-path step-COUNT surface):** measurement-gating MECHANICS + unmeasured/fullscreen / Android-inset / scroll-race / orphan-step edge cases.

| Test | Adversarial scenario | Passing run |
|------|----------------------|-------------|
| AT-01 | Unmeasured/fullscreen target must NOT present a misleading spotlight — `hasTarget` derives from the plausibility predicate (not bare `width>0&&height>0`); the predicate uses an UPPER-bound `<=` screen-ratio (a `>=` would accept the fullscreen rect); step 1 early-returns `null` before the cutout/bubble computation. | GREEN |
| AT-02 | Step-6 scroll gated on offset registration, not a delay — no `scrollToEnd` CALL in executable code; `performScrollAndMeasure` reachable ONLY inside the `if (scrollRef?.current && offset)` guard; single `scrollTo`; budget-exhausted miss branch shows the overlay WITHOUT scrolling (no footer dump). | GREEN |
| AT-03 | Android inset correction edge-to-edge-correct + legacy-safe + drift-free — both sites add a POSITIVE `insets.top` (android-gated), iOS is the identity branch, no `StatusBar.currentHeight`, `useSafeAreaInsets` imported + read; correction shape shared. | GREEN |
| AT-04 | No orphaned coach step — bijection recomputed against the LIVE `app/` + `src/` trees (not a hand-listed file set), so a stray registration ANYWHERE fails; deleted ids 8/9 must not be registered. | GREEN |

**Passing run:**
```
PASS AT-01..AT-04 ORCH-1029 adversarial: fullscreen-rejection wiring + step-1 hold (AT-01),
scroll gated on offset / no footer dump (AT-02), Android insets.top correction positive +
drift-free (AT-03), no orphaned coach step across the live app/ + src/ trees (AT-04)
```

**Fails-on-revert proven (each angle, distinct mutation):**
- AT-01a fails when `hasTarget` reverts to the bare raw-rect gate (`target && target.width > 0 && target.height > 0`).
- AT-02a fails when a `scrollToEnd` footer-dump CALL is reintroduced into the miss branch; AT-02b fails when `performScrollAndMeasure` is moved outside the offset guard (`if (scrollRef?.current)`).
- AT-03 fails when `useCoachMark.ts` reverts the Android term to `StatusBar.currentHeight`.
- AT-04 fails when any step is orphaned (injected `useCoachMark(99)`).

**Both regression tests are in the closing-PR diff** (`git diff origin/main...HEAD --name-only`):
`app-mobile/src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx` (implementor, fails-on-revert verified by implementor at `5cf059fe9`) + `app-mobile/src/contexts/__tests__/orch-1029-coach-mark-adversarial.test.tsx` (tester) + `app-mobile/package.json`.

---

## 2. Device matrix actually driven

| Device | OS / form factor | Role | Bundle | Outcome |
|--------|------------------|------|--------|---------|
| iPhone SE 3rd gen (`E07985BA…`) | iOS, 375×667 (small) | iOS small | anchor Metro :8086 (ORCH-1029 JS) | **F-1 FAIL reproduced (`proven`)** — deck rect `{0,2,375,589}` rejected by clamp, step 1 holds forever |
| iPhone 17 Pro (`17091E60…`) | iOS, 393pt (large-class) | iOS large | anchor Metro :8086 | App ran on ORCH-1029 bundle; deck empty (0 cards) this session + Apple system dialog; step-1 hold confirmed by the same Metro log stream + identical structural cause |
| Android 15 emulator (`emulator-5554`, Pixel 7 API 35) | Android 15 edge-to-edge | Android-15 | anchor Metro :8086 via `adb reverse` | ORCH-1029 bundle loaded cleanly (no resolution error); emulator **logged out** → tour/deck not reachable without a Seth-gated sim login |
| Physical Samsung A72 (`R58R54YV7JT`) | Android 14 / One UI (API 34, pre-Android-15-default-edge-to-edge) | legacy Android (SC-4-Android-legacy candidate) | not driven | NOT exercised — see "Coverage gaps" |

**Metro:** ran from the ANCHOR checkout (`/Users/sethogieva/Desktop/mingla-main/app-mobile`) on port 8086 with ORCH-1029's 8 source files applied non-destructively (per `feedback_testing_handoff_just_run_expo_start.md`). The per-ORCH worktree's own Metro threw a `expo-router/entry` module-resolution error from the symlinked `node_modules` + cleared cache (the known worktree hazard); resolved by running from the anchor with the changed files copied in, then restored.

---

## 3. P1 — F-1 step-1 deck spotlight bricks the tour (PROVEN, `proven`-level)

**Severity: P1 (HIGH) — tour-blocker. Also a constitutional concern (Rule 1 "no dead taps": with step 1 holding, the tour is a dead, non-advancing state).**

### Evidence (iOS SE 3, live ORCH-1029 bundle)
Metro console (captured from the device JS context, the F-1 `__DEV__` Spotlight log):
```
[Spotlight] Step 1 (v3): target={"x":0,"y":2,"width":375,"height":589,"radius":36}, hasPlausibleTarget=false, step1HoldingForDeck=true
[Spotlight] Step 1 (v4): target={"x":0,"y":2,"width":375,"height":589,"radius":36}, hasPlausibleTarget=false, step1HoldingForDeck=true
```
Screenshots: `orch_1029_qa_screenshots/se3_step1_cold.png`, `se3_step1_cold_b.png`, `se3_step1_hold_FAIL.png` — the deck renders with **no scrim and no bubble** (the overlay is holding via `return null`), and the tour never advances.

### Root cause (source-confirmed, device-independent)
- `SpotlightOverlay.tsx` plausibility clamp (F-1): `isPlausibleCutout(t) = t.width>0 && t.height>0 && t.width <= screenWidth*0.96 && t.height <= screenHeight*0.85`.
- The step-1 deck target ref `coachDeckRef` is attached to `SwipeableCards.tsx:2298` `<View ref={coachDeckRef} … style={styles.cardContainer}>`.
- `styles.cardContainer` (`SwipeableCards.tsx:2732`) is `{ width: SCREEN_WIDTH, flex: 1, paddingHorizontal: 0 }` — i.e. **full screen width, x=0, no horizontal inset**, filling the vertical deck area.
- Therefore the measured rect ALWAYS has `width === screenWidth`. The clamp condition `width <= screenWidth * 0.96` reduces to `screenWidth <= 0.96·screenWidth` → `1 <= 0.96` → **always FALSE**. (On SE: 375 > 360. The height arm also fails: 589 > 667·0.85=567.)
- Consequently `hasPlausibleTarget` is `false` for the deck on EVERY device, `step1HoldingForDeck` is `true`, and `SpotlightOverlay` returns `null` indefinitely. Step 1 never presents its cutout; the tour cannot advance (there is no "Got it" button to tap because the overlay never renders).

### Why this is universal (not SE-specific)
The width arm `width <= screenWidth*0.96` can never be satisfied by a target whose style is `width: SCREEN_WIDTH`. The deck card is full-bleed by design, so there is **no rect the deck can produce that passes a 96%-width clamp**. The same clamp that (correctly) rejects the Android whole-screen fallthrough rect `{0,2,448,879}` from the investigation ALSO rejects the legitimate full-width deck card — they are the same width=100% shape. The fix cannot distinguish "deck card" from "whole-screen fallback" because the deck card IS effectively whole-screen-wide.

### Spec criteria failed
- **SC-1.2 FAIL:** "step 1 holds until a plausible rect arrives" — a plausible rect NEVER arrives, so the hold is permanent (the spec intended a transient hold that resolves to a cutout).
- **SC-1.3 FAIL:** "the step-1 cutout resolves on that measurement" — it never resolves; the deck's measurement is always rejected.
- The investigation's LOCKED acceptance bar ("step 1's cutout lands on the actual deck card … never a centered no-cutout bubble, never a whole-screen cutout") trades the old "no-cutout centered bubble" failure for a NEW "no overlay at all + dead tour" failure.

### Suggested fix (for the implementor REWORK — not applied here)
The clamp thresholds are mis-calibrated for a full-width deck target. Options:
1. Attach `coachDeckRef` to an INSET card view (with real horizontal margins) rather than the full-bleed `cardContainer`, so the measured rect is genuinely smaller than the screen; OR
2. Relax/redefine the plausibility predicate to reject only TRUE whole-screen rects (e.g. `height <= screenHeight*0.95` AND a top-origin / bottom-extent check) while ACCEPTING a full-width-but-not-full-height deck card — i.e. detect the Android fallthrough by it covering the WHOLE screen (both near-100% width AND near-100% height starting at y≈0), not by width alone; OR
3. Special-case step 1 to accept a full-width rect provided its height is bounded away from the full screen (the deck card stops above the tab bar), distinguishing it from the `{0,2,448,879}` fully-covering rect.
Whichever path: re-run this device matrix (cold + warm deck, iOS small/large, Android 15, legacy Android) and confirm step 1 presents a cutout on the deck card.

---

## 4. Static / mechanical verification (all GREEN)

- `npm run test:orch-1029` → PASS T-01..T-08 (implementor happy-path; 7 contiguous steps, four call sites repointed, `SCROLL_STEPS=[6,7]`, plausibility clamp present, `insets.top` correction, onLayout offset registration, no orphan steps).
- `npm run test:orch-1029-adv` → PASS AT-01..AT-04 (tester adversarial; mechanics + fails-on-revert per §1).
- **tsc:** `npx tsc --noEmit` on `app-mobile` shows ZERO new errors on the 8 ORCH-1029-touched files (`coachMarkSteps.ts`, `CoachMarkContext.tsx`, `SpotlightOverlay.tsx`, `useCoachMark.ts`, `ProfilePage.tsx`, `BetaFeedbackButton.tsx`, `DiscoverScreen.tsx`, `ConnectionsPage.tsx`). The single `ConnectionsPage.tsx:193` `GroupEventMeta` error is **pre-existing on `origin/main`** (ORCH-1029's only ConnectionsPage edit is the `useCoachMark(7→5)` id; line 193 is untouched) — confirmed by `git diff origin/main...HEAD`. Total repo-wide tsc errors (260) are all pre-existing per the implementation report §8.

**Note:** the GREEN static tests prove the F-1 mechanism *exists in source* (a plausibility clamp + a step-1 hold). They CANNOT prove the clamp's thresholds are *correctly calibrated* for the real deck target — that requires the live measurement, which is exactly what the live-fire surfaced. This is the textbook case of "passing tests prove nothing" — the source-static gate is satisfied while the runtime behavior is broken.

---

## 5. Findings beyond F-1

- **P3 — normalize-to-complete blocks mid-tour DB seeding (pre-existing, not ORCH-1029):** `CoachMarkContext.tsx:127-145` forces any fetched `coach_mark_step >= 1` that isn't `TOUR_COMPLETED`/`TOUR_SKIPPED` to `TOUR_COMPLETED` and writes it back. Only `coach_mark_step=0` actually starts the tour (at step 1). This is the existing ORCH-0635 legacy-normalization and is correct for its purpose, but it means QA cannot jump to a mid-tour step via the DB — combined with the F-1 hold at step 1, the tour is unreachable past step 1 by any means on device. Informational; flag so a future tester forces step 0 + advances via the overlay (once F-1 is fixed).
- **P4 — F-4 / F-2 / F-3 mechanisms look sound in source** (insets.top both sites + iOS no-op; 7 contiguous steps + repointed call sites; onLayout-gated offset + poll). Credit to the implementor for clean, drift-free F-4 wiring and the orphan-step CI assertion. They simply could not be device-confirmed because F-1 bricks the tour before any of them is reachable. Re-verify them in the REWORK pass once step 1 presents.

---

## 6. Coverage gaps (stated explicitly)

- **iOS large cutout landing:** iPhone 17 Pro session had an empty deck (0 cards) + an Apple-account system dialog; step-1 hold confirmed via the shared Metro log + structural cause, but a populated-deck large-device capture was not obtained. Not material to the verdict (the FAIL is structural and device-independent), but noted.
- **Android-15 step-2 cutout on Preferences (SC-4-Android-15), Android-legacy ORCH-0688 (SC-4-Android-legacy), step-6 Account Settings (SC-3.1), 7-steps-end-to-end (F-2):** UNVERIFIED on device — all are downstream of step 1, which never presents, so the tour cannot reach them. The Android-15 emulator was logged out (sim login is Seth-gated per memory); the physical A72 was not driven. These must be verified in the REWORK retest after F-1 is fixed.

---

## 7. Verdict gate compliance

- PASS requires `proven` live-fire on every applicable platform with zero open P1. **Not met** — there is an open P1 (F-1) reproduced `proven`-level on iOS.
- This is a **FAIL** (reproduced failure on sim), not a CONDITIONAL PASS: the blocker is a code defect, not a sim/Metro infrastructure block (the Metro/worktree block WAS resolved — Metro ran from the anchor and the ORCH-1029 bundle loaded on both iOS and Android).

---

## 8. Routing — back to orchestrator for REWORK dispatch

NEEDS REWORK on F-1. The plausibility clamp must accept the real full-width deck card while still rejecting the Android whole-screen fallthrough rect (§3 suggested fixes). After rework, re-dispatch TEST to re-run this full device matrix (cold + warm deck; iOS small + large; Android 15 edge-to-edge; legacy One UI / API ≤ 33) and confirm: step 1 cutout on the deck card; step 2 cutout on Preferences (Android-15 not in the status bar); step 6 on Account Settings; legacy-Android ORCH-0688 not regressed; 7 steps end-to-end with no dead step.

---

## 9. Cleanup performed

- Test accounts restored to `coach_mark_step=8`: `sethogieva@gmail.com` (`b17e3e15…`), `sethogieva@icloud.com` (`c727d491…`). Verified via read-back.
- Anchor checkout (`/Users/sethogieva/Desktop/mingla-main`) restored to pristine `main` — the 8 temporarily-applied coach files rewritten from `main:HEAD` (`SCROLL_STEPS` back to `[8,9]`); `git status` clean. No git index operation on the shared anchor (per `feedback_shared_anchor_checkout_staging_hazard.md`).
- Port 8086 freed (scoped `kill`); Android emulator stopped (`emu kill`); `adb reverse tcp:8086` removed. iOS sims left booted.

---

## Screenshots

All under `Mingla_Artifacts/reports/orch_1029_qa_screenshots/`:
- `se3_launch.png` — initial worktree-Metro resolution error (the worktree node_modules hazard, then resolved).
- `se3_after_bundle.png` — SE3 on the ORCH-1029 anchor bundle, deck visible (National Gallery card).
- `se3_step1_cold.png`, `se3_step1_cold_b.png`, `se3_step1_hold_FAIL.png` — **F-1 FAIL**: step 1 holds, no overlay, bare deck.
- `17pro_launch.png` — iPhone 17 Pro on ORCH-1029 bundle (empty deck + Apple dialog).
- `android15_launch.png`, `android15_app.png`, `android15_app2.png` (dev-client launcher), `android15_connected.png` — Android 15 emulator: ORCH-1029 bundle loaded cleanly; logged-out auth screen (tour unreachable without sim login).
