# QA — ORCH-1122 [trip-edit cover dead-tap]

## 1. Verdict + P0–P4 count

**VERDICT: PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1 (praise).

Pure client-side, single-line React deps-array fix on the business-app
published-trip EDIT screen. Runtime open-behavior was operator device-proven
(Seth, physical iOS, dev-channel OTA, 2026-06-12). This QA independently re-ran
the implementor's fails-on-revert proof, authored a tester adversarial
regression test attacking the OPPOSITE (close) direction with its own
fails-on-revert, and ran the gates. Scope is exempt from a fresh sim drive
(operator already device-proved the dead tap; the fix is a single deps line;
the runtime open + close behavior is both covered by REAL RTL mounts of the
production screen). Regression gate satisfied (implementor happy-path test +
tester adversarial test, both on-branch, both in the closing diff, both
fails-on-revert proven).

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | Cover dead-tap fixed: tapping "Change cover"/"Add cover" opens the sheet on published-trip EDIT | PASS | Implementor RTL render test PASS (`jest.orch1122.render.cjs`, 1/1); operator device-confirmed 2026-06-12; tester adversarial test's open precondition also PASS |
| SC-2 | Fix is deps-array only (option A); no logic change / extract / refactor | PASS | `git show fe88e650f -- EditPublishedTripScreen.tsx` = +1 functional line (`coverPickerVisible,`) + 8-line comment; zero logic edits |
| SC-3 | No other reactive dep missing from the same callback | PASS | `eslint EditPublishedTripScreen.tsx` → the `renderSectionBody` callback (line ~1441) no longer warns; only the UNRELATED line-934 `trip.brandId` warning remains |
| SC-4 | `react-hooks/exhaustive-deps` warning for THIS callback resolved | PASS | origin/main lints with 2 warnings (934 + 1441-`coverPickerVisible`); fixed branch lints with 1 (only 934). The cover-callback warning is gone |
| SC-5 | Shared CoverPickerSheet/Sheet/CoverPicker, create path, eas.json, consumer/admin/buyer untouched | PASS | `git diff origin/main...HEAD --name-only`: only `EditPublishedTripScreen.tsx` (product) + tests/configs + report. No shared component, no create path, no buyer/consumer/admin |
| SC-6 | Fails-on-revert regression test committed in the same branch | PASS | Implementor test in diff + fails-on-revert independently re-run (§4); tester adversarial test committed `bd7b3217f`, fails-on-revert proven (§5) |

## 3. Findings (P-numbered)

**P4 (praise) — clean, minimal, correctly-scoped fix.** The root cause (stale
`useCallback` closure over `coverPickerVisible`) is exactly right, the fix is the
smallest correct change (one dep), and the lint delta independently corroborates
it: the `coverPickerVisible` exhaustive-deps warning that flagged the bug on
origin/main is GONE on the fixed branch, with no new warning introduced.
Retest: n/a (informational).

No P0/P1/P2/P3 findings.

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Checked out the worktree at fix commit `fe88e650f` (HEAD before my test commit).
- Ran the implementor's test: `npx jest --config jest.orch1122.render.cjs --runInBand` → **PASS (1/1)**.
- True LINE DELETION (perl, not comment-out) of the bare `coverPickerVisible,`
  dep line (source line 1452) → re-ran → **FAIL**, RED at the exact assertion
  `EditPublishedTripScreen.coverDeadTap.render.test.tsx:263` →
  `expect(screen.getByTestId("cover-picker-sheet-VISIBLE")).toBeTruthy()` (the
  dead tap reproduced).
- Restored the line (byte-clean, `git diff --stat` empty) → re-ran → **PASS**.
- Cycle confirmed independently: **PASS → FAIL@263 → PASS** at `fe88e650f`.

## 5. Adversarial test added

- **Path:** `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.coverClose.adversarial.render.test.tsx`
- **Config:** `mingla-business/jest.orch1122.adversarial.render.cjs` (tester-owned, mirrors the implementor's render config; default `jest.config.cjs` ignores the new render test).
- **Commit:** `bd7b3217f`.
- **Angle chosen — TWO-WAY BINDING (close re-mints), and why it's DISTINCT:**
  the implementor's happy-path test proves the ONE-WAY OPEN transition
  (`false → true`: button press → sheet appears). My test attacks the OPPOSITE
  direction: after opening, it fires the production sheet's real
  `onClose={() => setCoverPickerVisible(false)}` (EditPublishedTripScreen.tsx:1353)
  and asserts the memoized `renderSectionBody` body RE-MINTS in the CLOSE
  direction so the sheet **UNMOUNTS** (`true → false`). The assertion target is
  inverted — the implementor asserts the sheet APPEARS; I assert it DISAPPEARS
  after a close. A regression that left OPEN working but broke the CLOSE re-mint
  would pass the happy-path test yet trap the modal open forever (a different
  dead-tap failure mode). Secondary distinction: my fixture has a cover set
  (`coverMediaUrl` non-null → "Change cover" label, the screenshot/edit case),
  exercising the cover-EXISTS branch vs the implementor's empty-cover
  "Add cover" fixture.
- **Passing run:** `npx jest --config jest.orch1122.adversarial.render.cjs --runInBand` → **PASS (1/1)**.
- **fails-on-revert verified at `fe88e650f`** — true line-deletion of the
  `coverPickerVisible` dep → my test goes **FAIL**, RED at
  `EditPublishedTripScreen.coverClose.adversarial.render.test.tsx:268` (the open
  precondition: with the dep gone the body is frozen and cannot reflect EITHER
  flip, so the close round-trip is never reached). Restored → **PASS**. Cycle:
  **PASS → FAIL@268 → PASS**.
- **Append-only:** one NEW test file; `git diff --name-only HEAD -- '*.test.tsx'`
  shows zero existing test modified. Both the implementor's and the tester's
  tests appear in `git diff origin/main...HEAD --name-only`.

## 6. Constitution 14-rule matrix

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | This ORCH FIXES a dead tap; open + close both fire at runtime (RTL mounts + operator device proof) |
| 2 | One owner per truth | PASS | `coverPickerVisible` single `useState` owner; setter referentially stable |
| 3 | No silent failures | PASS | No catch/error path touched; fix is a render-reactivity dep only |
| 4 | One query key per entity | N/A | No query keys touched |
| 5 | Server state server-side | N/A | No Zustand/server-state change; local UI flag only |
| 6 | Logout clears everything | N/A | No auth/session state |
| 7 | Label `[TRANSITIONAL]` | N/A | Permanent fix, not transitional |
| 8 | Subtract before adding | PASS | Minimal: +1 dep, no new abstraction |
| 9 | No fabricated data | N/A | No data rendering changed |
| 10 | Currency-aware | N/A | No money/price logic touched |
| 11 | One auth instance | N/A | No auth |
| 12 | Validate at the right time | N/A | No datetime validation |
| 13 | Exclusion consistency | N/A | No exclusion logic |
| 14 | Persisted-state startup | N/A | No persisted hydrate gate |

No violations → no automatic P0.

## 7. Device / parity matrix

| Surface | Result | Notes |
|---------|--------|-------|
| Business iOS | PASS (proven) | Operator (Seth) device-confirmed "Change cover" opens the sheet on physical iOS via dev-channel OTA, 2026-06-12 — captured in the dispatch brief. Single shared RN path |
| Business Android | PASS (automatic parity) | Same shared `EditPublishedTripScreen.tsx`; no platform-specific code in the diff. Skip-reason: identical shared RN path, business-app dead-tap is platform-agnostic render reactivity |
| Business Web preview (adjacent) | PASS (automatic parity) | Same shared RN code renders on web; no web-specific branch touched |
| Consumer iOS | N/A (skip) | Screen is business-app only |
| Consumer Android | N/A (skip) | Business-app only |
| Buyer/anonymous Web | N/A (skip) | Not a buyer route |
| Admin Web (adjacent) | N/A (skip) | Separate Vite app; untouched |

Physical-iPhone HITL: already satisfied by Seth's 2026-06-12 device confirmation
(per dispatch) — not re-driven; runtime open AND close are additionally covered
by REAL RTL mounts of the production screen. No edge-function deploy (pure
client-side). Sim-drive exemption: operator device-proven + single deps line +
runtime behavior covered both directions by RTL render proofs.

## 8. Gate results

- **Typecheck (changed product file):** `tsc --noEmit` → `EditPublishedTripScreen.tsx`
  has **zero** TS errors. The only error on the new test file is
  `TS2307 Cannot find module '@testing-library/react-native'` — IDENTICAL on the
  implementor's `coverDeadTap.render.test.tsx` AND the pre-existing ORCH-1118
  `render.test.tsx`; a known tooling artifact (RTL lives in the gitignored
  `.orch1118-testdeps` overlay, outside the tsconfig tree), NOT a real type
  defect. The render tests are validated by their dedicated render configs
  (both PASS). Whole-app baseline = 262 pre-existing TS errors, unrelated.
- **Lint (changed product file):** `eslint EditPublishedTripScreen.tsx` →
  0 errors, 1 warning at line 934 (`trip.brandId` on a SEPARATE useCallback).
  Confirmed pre-existing: origin/main version lints with 2 warnings (934 +
  1441-`coverPickerVisible`); fixed branch lints with 1 (only 934). The line-934
  warning is identical with/without this change → unrelated, out of scope.
- **Jest — implementor render test:** `jest.orch1122.render.cjs` → PASS 1/1.
- **Jest — tester adversarial render test:** `jest.orch1122.adversarial.render.cjs` → PASS 1/1.
- **Jest — default trip suite:** `jest.config.cjs src/components/trip` →
  **29 failed / 290 passed** on the fixed branch, and **29 failed / 290 passed**
  IDENTICAL with the ORCH-1122 delta removed (product source reverted to
  origin/main + render tests moved aside + origin/main jest.config). Proven NOT
  introduced by ORCH-1122. (D-2 below.)

## 9. Discoveries for Orchestrator

- **D-1 (pre-existing, unrelated):** `EditPublishedTripScreen.tsx` line 934 carries
  a long-standing `react-hooks/exhaustive-deps` warning (`trip.brandId` missing
  from a SEPARATE `useCallback`). Present on origin/main; identical with/without
  this change. Could mask a stale-closure-class bug in that callback — worth a
  forensic look. Out of scope here (different control). Confirms the implementor's D-1.
- **D-2 (pre-existing, unrelated):** the default-config trip suite carries 29
  failures across 11 suites (TripPublishStripeBanner, TripVisualParity[_adversarial],
  PaymentPlanEditor[_adversarial], IntakeTypePickerSheet_orch_0884,
  InstallmentScheduleDisplay_wiring, EditPublishedTripScreen.save/refundGate,
  tr2RewordPolish, TripCreatorWizard.cover). Tester-verified IDENTICAL
  (29/290) with the ORCH-1122 delta removed → NOT introduced. Stale
  source-characterization tests asserting drifted source text. Recommend a
  cleanup ORCH. Confirms the implementor's D-2.
- **D-3 (COMMS-0028 cross-ref, FYI):** COMMS-0028 (WARN, re ORCH-1122/1119)
  reports the GIPHY key is unreachable in standalone/OTA builds — but that
  concerns the SEPARATE cover-picker-GIF / GIPHY_SERVER_SIDE workstream, NOT this
  trip-edit dead-tap deps fix. This dispatch is the dead-tap reactivity fix only;
  the GIF-key issue does not touch `EditPublishedTripScreen.tsx`'s deps array and
  has no bearing on this PASS. Flagged so the orchestrator does not conflate the
  two ORCH-1122 workstreams at CLOSE.

## 10. Scope confirmation

Fix scope stayed inside `mingla-business/src/components/trip/EditPublishedTripScreen.tsx`
(single product-code file, +1 functional line) plus test infra (2 test files,
2 render configs, 1 default-config ignore edit) plus the implementation report.
`git diff origin/main...HEAD --name-only` confirms NO shared CoverPickerSheet /
Sheet / CoverPicker edit, NO create path, NO consumer / admin / buyer code.

## 11. Verdict line

**PASS** — 0 P0 / 0 P1 / 0 P2 / 0 P3 / 1 P4. Regression gate satisfied
(implementor happy-path `fails-on-revert @ fe88e650f` re-run independently +
tester adversarial `EditPublishedTripScreen.coverClose.adversarial.render.test.tsx`,
`fails-on-revert @ fe88e650f`, different angle, on-branch, in-diff). Tester
commit `bd7b3217f`. → routes to CLOSE.
