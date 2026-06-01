# IMPLEMENTATION_ORCH-1023_SCHEDULING_PICKER_REGRESSION

## Status

implemented, partially verified

## User Impact

The saved-card scheduling sheet now shows the iOS date/time picker controls inside the sheet itself. Selecting Today opens the time picker, selecting This Weekend then a day opens the time picker, and selecting Pick a Date opens the date picker. This preserves the ORCH-1021 decisive open/closed scheduling checks for both single cards and curated cards.

## Root Cause

`ProposeDateTimeModal` rendered the scheduling sheet inside `BaseBottomSheet` with `wrapInRNModal`, then tried to render iOS picker controls in separate nested `RNModal` windows. On iOS dev builds this can leave picker state true while no picker is visible above the already-modal scheduling sheet.

## Changes

- Replaced the nested iOS `RNModal` date/time picker overlays with inline picker panels inside `ProposeDateTimeModal`.
- Normalized date-option state transitions so switching options clears stale picker panels.
- Kept Android on the native `DateTimePicker` dialog path.
- Updated `WaveBBatch4.test.mjs` so the regression guard fails if `ProposeDateTimeModal` reintroduces nested RN modal pickers.

## Verification

- PASS: `node app-mobile/src/components/ui/__tests__/WaveBBatch4.test.mjs`
- PASS: `/Users/sethogieva/.deno/bin/deno test --allow-read --sloppy-imports app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts app-mobile/src/utils/__tests__/singleCardAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts`
- PASS: `npx expo lint src/components/activity/ProposeDateTimeModal.tsx`
- PARTIAL: `npx tsc --noEmit --pretty false` still fails on unrelated existing whole-app issues, including Deno test globals, package workspace React resolution, and pre-existing component typing errors outside this hotfix.

## Manual Smoke Gate

Use the dev-build link from the ORCH-1023 Metro server:

`exp+mingla://expo-development-client/?url=http%3A%2F%2F172.20.9.90%3A8083`

1. Open a saved single card, tap Schedule, then tap Today. The time picker should appear inline.
2. Tap This Weekend, then Saturday or Sunday. The time picker should appear inline.
3. Tap Pick a Date. The date picker should appear inline, and Done should advance to time.
4. Repeat with a curated card. Scheduling should remain decisive: safe only when all stops are confirmed open.

