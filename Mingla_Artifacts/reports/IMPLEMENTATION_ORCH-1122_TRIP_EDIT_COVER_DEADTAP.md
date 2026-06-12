# IMPLEMENTATION — ORCH-1122 [trip-edit cover dead-tap]

## 1. Summary

On the business app's **published-trip EDIT** screen, tapping "Change cover" / "Add
cover" gave press feedback but never opened the cover picker (a dead tap). Root
cause (proven upstream, INVESTIGATE_ORCH-1122): the "Change cover" button and the
`<CoverPickerSheet visible={coverPickerVisible}>` both live inside the memoized
`renderSectionBody` `useCallback`, whose dependency array OMITTED
`coverPickerVisible`. So when the button flipped the flag
(`setCoverPickerVisible(true)`), React re-rendered the screen but served the
CACHED body still closed over `coverPickerVisible === false` → the sheet stayed
`visible={false}` forever.

Fix (minimal, low-risk — option A): added `coverPickerVisible` to the
`renderSectionBody` `useCallback` dependency array so the memoized body re-mints
when the flag flips. No logic changed, no refactor, no shared-component edits.

A genuine runtime-mount regression test (RTL mount of the real screen) proves the
sheet now opens on tap and FAILS on true line-deletion of the fix.

## 2. SPEC success-criteria coverage

(Bug-fix dispatch, not a formal SPEC — criteria are the dispatch brief's.)

| Criterion | Status | Commit |
|---|---|---|
| SC-1 Cover dead-tap fixed: tapping "Change cover" opens the sheet on published-trip EDIT | ✓ | `db7d8217e` |
| SC-2 Fix is deps-array only (option A); no logic change, no extract/refactor | ✓ | `db7d8217e` |
| SC-3 No other reactive dep missing from the same callback (verified) | ✓ | `db7d8217e` |
| SC-4 `react-hooks/exhaustive-deps` warning for this callback resolved | ✓ | `db7d8217e` |
| SC-5 Shared CoverPickerSheet/Sheet/CoverPicker, create path, eas.json, consumer/admin/buyer untouched | ✓ | `db7d8217e` |
| SC-6 Fails-on-revert regression test committed in the same branch | ✓ | `db7d8217e` |

## 3. Files changed

| File | Δ |
|---|---|
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | +9 (deps array: +`coverPickerVisible` + an explanatory comment block) |
| `mingla-business/jest.config.cjs` | +3 / −2 (add the new render test to `testPathIgnorePatterns` so the default node/ts-jest suite skips it, mirroring the ORCH-1118 render-proof) |
| `mingla-business/jest.orch1122.render.cjs` | NEW (committed render config — RN preset + RTL overlay; mirrors `jest.orch1118.render.cjs`, resolves the matcher path build/ or dist/) |
| `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.coverDeadTap.render.test.tsx` | NEW (runtime-mount regression test, +~280 lines) |

Worktree-local **uncommitted** infra (gitignored, provisioned for this run):
`.orch1118-testdeps/node_modules` (`react-test-renderer@19.1.0` +
`@testing-library/react-native@13.3.3`). Same overlay the ORCH-1118 render-proof
uses.

## 4. Data-model changes applied

None. Pure client-side React fix.

## 5. Edge functions touched

None.

## 6. Regression tests added

- **Path:** `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.coverDeadTap.render.test.tsx`
- **Harness:** REAL `@testing-library/react-native` mount of the production
  `EditPublishedTripScreen` (boundary-only mocks: supabase invoke, expo-router,
  safe-area, heavy accordion bodies/modals, native chrome). `CoverPickerSheet`
  is stubbed to a thin view that emits `testID="cover-picker-sheet-VISIBLE"` ONLY
  when `visible===true`, so the assertion reads the exact prop the real memoized
  body passes. The screen's state + `renderSectionBody`'s real `useCallback`
  memoization are NOT mocked.
- **Flow:** expand the Cover accordion (real `handleToggleSection`) → assert sheet
  hidden → press the real "Add cover…" Button (`setCoverPickerVisible(true)`) →
  assert `CoverPickerSheet` now mounts with `visible={true}`.
- **Run config:** `npx jest --config jest.orch1122.render.cjs --runInBand` → PASS
  (1/1).
- **fails-on-revert verified at `db7d8217e`** — proven by TRUE LINE DELETION (not
  comment-out) of the `coverPickerVisible` dep line: test went RED at the
  `getByTestId("cover-picker-sheet-VISIBLE")` assertion (the dead tap reproduced).
  Restoring the line returned it to PASS. Cycle: PASS → FAIL → PASS.

Append-only: a single NEW test file. No existing test modified or deleted
(`tests-append-only.yml` safe).

## 7. Old → New receipt

### `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`
**What it did before:** `renderSectionBody` `useCallback` deps omitted
`coverPickerVisible`; the cover body was memoized closed over a stale `false`, so
the "Change cover" button's `setCoverPickerVisible(true)` never reached the
sheet's `visible` prop → dead tap.
**What it does now:** `coverPickerVisible` is in the deps array; flipping the flag
re-mints the memoized body and the sheet receives `visible={true}` → it opens.
**Why:** the dispatch root cause (stale `useCallback` closure over the open-state).
**Lines changed:** +9 (1 functional dep line + an 8-line explanatory comment).

### `mingla-business/jest.config.cjs`
**What it did before:** ignored only the ORCH-1118 render test from the default
node/ts-jest suite.
**What it does now:** also ignores the ORCH-1122 cover-dead-tap render test (it has
its own RN-preset render config; cannot run under node/ts-jest).
**Why:** keep the default suite green; the render test runs via its dedicated
config (ORCH-1118 precedent).
**Lines changed:** +3 / −2.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Business iOS | YES — published-trip EDIT "Change cover" now opens the picker | automatic (shared RN code) |
| Business Android | YES — same | automatic (shared RN code) |
| Business Web preview (adjacent) | YES — same screen renders on web | automatic (shared RN code) |
| Consumer iOS | NO — screen is business-app only | — |
| Consumer Android | NO — business-app only | — |
| Buyer/anonymous Web | NO — not a buyer route | — |
| Admin Web (adjacent) | NO — separate Vite app | — |

Single shared code path (one `EditPublishedTripScreen.tsx` rendered on all three
business surfaces) → parity is automatic, no manual mirroring.

## 9. Smoke result

No device/sim drive this turn (operator already device-proved the dead tap on
2026-06-12; the fix is a single deps line). Runtime proof is the RTL render test:
a REAL mount of the production screen that presses the real button and asserts the
real sheet opens — and FAILS on fix deletion. This is genuine runtime evidence of
the open behavior, not source wiring. Recommend the tester confirm on a physical
device per the interactive-elements-must-fire rule before CLOSE.

## 10. Known issues / deferred

- **Pre-existing `react-hooks/exhaustive-deps` WARNING at EditPublishedTripScreen.tsx
  line ~934** (`trip.brandId` on a DIFFERENT `useCallback`, unrelated to the cover
  bug). Left untouched — out of scope (different control, would change unrelated
  logic). Flagged below for the orchestrator.
- **`exhaustive-deps` NOT flipped to "error" for this file** (recurrence-guard
  option): SKIPPED per the brief, because the file still carries the pre-existing
  line-934 warning — flipping to "error" would fail lint on unrelated code. Noted
  for follow-up (fix line-934 first, then the rule can be hardened).
- The render-test overlay (`.orch1118-testdeps/`) is gitignored worktree-local
  infra; the tester/CI must provision it (`npm i react-test-renderer@19.1.0
  @testing-library/react-native@^13` inside `.orch1118-testdeps/`) to run the
  render configs. Same as ORCH-1118.

## 11. Operator action required

- **No migration. No edge-function deploy.** Pure client-side RN change.
- For OTA/merge (orchestrator-owned): this is a pure-JS business-app change →
  eligible for `eas update` (no native rebuild needed) once merged.

## 12. Discoveries for Orchestrator

- **D-1 (pre-existing, unrelated):** `EditPublishedTripScreen.tsx` line ~934 has a
  long-standing `exhaustive-deps` warning (`trip.brandId` missing from a separate
  `useCallback`). Present on origin/main. Could mask another stale-closure-class
  bug in that callback — worth a forensic look. Not fixed here (scope).
- **D-2 (pre-existing, unrelated):** the default-config trip test suite carries
  **29 pre-existing failures** across 11 suites (`TripPublishStripeBanner`,
  `TripVisualParity[_adversarial]`, `PaymentPlanEditor[_adversarial]`,
  `IntakeTypePickerSheet_orch_0884`, `InstallmentScheduleDisplay_wiring`,
  `EditPublishedTripScreen.save/refundGate`, `tr2RewordPolish`,
  `TripCreatorWizard.cover`). Verified IDENTICAL (29 failed / 290 passed) with my
  code stashed → NOT introduced by ORCH-1122. These are stale
  source-characterization tests asserting source text that has since drifted.
  Recommend registering a cleanup ORCH.
- **D-3 (pre-existing, unrelated):** strict-grep gates
  `orch-0756a-active-brand-recovery` (BrandSwitcherSheet) and `orch-0770`
  (event-cover video budget) are non-green on this branch; neither references
  `EditPublishedTripScreen` nor trips. Pre-existing.
