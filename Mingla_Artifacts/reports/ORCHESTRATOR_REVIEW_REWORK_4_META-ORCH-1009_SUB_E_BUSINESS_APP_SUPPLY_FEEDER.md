# Orchestrator Review: META-ORCH-1009 Sub-E Rework 4

Date: 2026-05-31
Reviewer: orchestrator+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Verdict

APPROVED for tester rerun, with the native-build runtime gate still required.

Rework 4 correctly fixes the newly exposed blocker class: a stale or missing `VideoTrim` native module no longer crashes the Business app at bundle import. The implementation now lazy-loads `react-native-video-trim` only when the trim action is invoked, so missing native support rejects the trim promise and lets CoverPicker's existing error path handle it.

## Evidence Reviewed

| Evidence | Result |
|---|---|
| `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_4_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md` | Scope matches the dispatch: trim editor, two tests, and report only. |
| `mingla-business/src/components/ui/coverPickerVideoTrimEditor.ts` | No top-level value import from `react-native-video-trim`; lazy `require` is wrapped and rejects with a clear native-build error. |
| `mingla-business/src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts` | Adds source and mocked-module coverage that would fail against the eager top-level import. |
| `mingla-business/src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts` | Updates the ORCH-1001 contract so the native base file is lazy-loaded and the web stub remains native-free. |

## Independent Verification

Command:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest CoverPicker.dedicatedTrimmer orch1001CoverPickerWebSplit --runInBand
```

Result:

```text
PASS src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts
PASS src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts

Test Suites: 2 passed, 2 total
Tests: 9 passed, 9 total
```

## Runtime Gate Status

The broader Sub-E runtime gate is not closed by this rework alone. A fresh native Mingla Business simulator build is being rebuilt from the anchor native iOS project because the Sub-E JS worktree does not contain an `ios/` directory, while the anchor native project has `VideoTrim (8.1.0)` in `Podfile.lock`.

The rebuild command in flight:

```bash
cd /Users/sethogieva/Desktop/mingla-main/mingla-business/ios
xcodebuild \
  -workspace minglabusiness.xcworkspace \
  -scheme minglabusiness \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=2C3312D9-EE52-4EBD-9704-15811D49A2EC" \
  build
```

Xcode's dependency graph confirms the rebuilt dev client links `VideoTrim`.

## Tester Routing

Tester should rerun two checks after the build/install/deep-link step completes:

1. Stale/missing-native guard: the app must load without the `TurboModuleRegistry.getEnforcing(...): 'VideoTrim' could not be found` import-time redbox.
2. Fresh-native happy path: upload/trim a hero video in the Sub-E CoverPicker flow, wait for processing, and verify exactly one `Video cover updated.` toast, no repeated `Maximum update depth exceeded`, selected video retained, and app remains responsive.

## Close Impact

This review does not close META-ORCH-1009 Sub-E. It clears Rework 4 for retest and keeps the final Sub-E close blocked on runtime QA plus the broader Sub-E deploy/migration gates already documented in earlier review and QA reports.
