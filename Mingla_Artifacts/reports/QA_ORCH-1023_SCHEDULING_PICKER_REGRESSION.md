# QA_ORCH-1023_SCHEDULING_PICKER_REGRESSION

## Verdict

PASS

## Scope

ORCH-1023 [Scheduling picker regression] verifies the hotfix for saved-card scheduling where choosing Today, This Weekend + a day, or Pick a Date did not reveal the picker UI. The QA scope covers `app-mobile` saved-card scheduling through `ProposeDateTimeModal`, its structural regression test, and preservation of ORCH-1021 decisive scheduling availability behavior.

Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1023-[scheduling-picker-regression]`  
Branch: `ORCH-1023-scheduling-picker-regression`  
Commit tested: `2273f42d5`

## Findings

| Severity | Count | Notes |
|---|---:|---|
| P0 | 0 | None. |
| P1 | 0 | None. |
| P2 | 0 | None. |
| P3 | 0 | None. |
| P4 | 1 | Broad app-mobile `tsc` still fails on unrelated existing repo-wide type/test/workspace issues; focused checks for this hotfix pass. |

## Claim Table

| Claim | Verdict | Evidence |
|---|---|---|
| Today opens a visible time picker. | Verified | `handleDateOptionSelect` sets `showTimePicker` for `today` at `app-mobile/src/components/activity/ProposeDateTimeModal.tsx:120-132`; iOS time picker panel renders inline at lines `612-638`. Seth manual smoke receipt on 2026-05-31: “works now, schedule is fixed.” |
| This Weekend + day opens a visible time picker. | Verified | `handleWeekendDaySelect` clears date picker and sets `showTimePicker(true)` at `ProposeDateTimeModal.tsx:134-142`; weekend day UI is wired at lines `573-579`; inline time picker renders at lines `612-638`. |
| Pick a Date opens a visible date picker. | Verified | `handleDateOptionSelect` sets `showDatePicker` for `custom` at `ProposeDateTimeModal.tsx:120-132`; iOS date picker panel renders inline at lines `581-609`. |
| The old nested iOS `RNModal` picker path was removed. | Verified | No `RNModal` import or `<RNModal>` call remains in `ProposeDateTimeModal`; regression test asserts this at `app-mobile/src/components/ui/__tests__/WaveBBatch4.test.mjs:197-207`. |
| Android native picker path remains intact. | Verified | Android date/time `DateTimePicker` branches still render with `display="default"` at `ProposeDateTimeModal.tsx:671-689`; the structural test also checks Android default picker preservation. |
| ORCH-1021 decisive single-card and curated-card scheduling behavior is preserved. | Verified | Deno suite passed 12/12 across scheduling source contract, single-card availability, and curated stops availability tests. |

## Platform Matrix

| Surface | Evidence | Result |
|---|---|---|
| iOS dev build | Seth manually smoke-tested the dev-build link and reported: “works now, schedule is fixed.” Source now renders iOS picker panels inline inside the scheduling sheet. | PASS |
| Android | The reported regression was the iOS nested-modal picker path; Android stayed on native `DateTimePicker` dialogs. Source and regression test confirm Android `display="default"` branches remain intact. | PASS by source/test, runtime N/A for this iOS-specific regression |
| Web/browser | `app-mobile` saved-card scheduling dev build only; no web surface for this native picker path. | N/A |

## Commands Run

```bash
node app-mobile/src/components/ui/__tests__/WaveBBatch4.test.mjs
```

Output:

```text
PASS META-ORCH-0991 Wave B Batch-4 regression suite (PairRequest + Incoming + PairingInfo + CustomHoliday + ProposeDateTime + TicketPdf + ActionButtons-picker → BaseBottomSheet)
```

```bash
/Users/sethogieva/.deno/bin/deno test --allow-read --sloppy-imports app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts app-mobile/src/utils/__tests__/singleCardAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts
```

Output summary:

```text
running 3 tests from ./app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts
... 3 passed
running 5 tests from ./app-mobile/src/utils/__tests__/singleCardAvailability.test.ts
... 5 passed
running 4 tests from ./app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts
... 4 passed

ok | 12 passed | 0 failed (2s)
```

```bash
npx expo lint src/components/activity/ProposeDateTimeModal.tsx
```

Output: no lint output, exit code `0`.

```bash
git diff --check
```

Output: no whitespace errors, exit code `0`.

```bash
set -o pipefail; npx tsc --noEmit --pretty false 2>&1 | sed -n '1,50p'
```

Output summary: exit code `2`, with unrelated existing repo-wide failures including Deno URL imports/test globals, `BoardDiscussion` typing, `TripCard` icon prop typing, native checkout PaymentSheet typing, and workspace package React resolution. None of the first 50 errors reference `ProposeDateTimeModal.tsx` or the ORCH-1023 hotfix test.

## Regression Coverage

Regression coverage is adequate. `WaveBBatch4.test.mjs` now asserts that `ProposeDateTimeModal` keeps `DateTimePicker`, does not use nested `RNModal` pickers, does not import React Native `Modal` for picker overlays, and includes both `propose-date-inline-picker` and `propose-time-inline-picker` panels.

Fail-on-revert proof: the pre-fix parent source contains `Modal as RNModal` and two `<RNModal>` picker overlays at old lines `625` and `674`, while lacking the new inline picker test IDs. The updated test would fail if that old picker shape returned.

## Release Readiness

The hotfix is ready for orchestrator PR/merge/close. No deploy or migration is required. The only residual note is broad `app-mobile` TypeScript debt outside this scoped fix; it should not block ORCH-1023 because focused lint, structural regression, scheduling availability tests, source inspection, and Seth’s runtime smoke all pass.

