# IMPLEMENTATION_REWORK_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS

## Status

implemented and verified

## Summary

This rework closes the tester's P2 automated coverage gap for ORCH-1097 business web media picker controls. It adds focused repo-running tests for the browser picker adapter and source-level component contracts, and fixes one scoped issue revealed by the new tests: `pickBrowserFiles({ validate: false })` now truly defers validation so stop-photo multi-select can skip invalid files per-file instead of failing the whole browser selection.

## Inputs

- `Mingla_Artifacts/reports/QA_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS.md`
- Working tree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1097-[business-web-media-picker-controls]`
- Branch: `ORCH-1097-business-web-media-picker-controls`
- Rework base HEAD: `fd5da4018`

## Ledger

Applicable open WARN ledger entries were already acknowledged for `implementor+codex (ORCH-1097)`. Factored constraints: no backend/provider/schema/storage/edge/deploy/merge/OTA/reap work, preserve provider-neutral seller copy, preserve ORCH-1091/1093/1095/1096 guards, and keep native picker parity.

## Scope

In scope:

- Browser picker adapter test coverage for cancel, single image, multi image, PDF extension/MIME, read behavior, object URL cleanup, invalid/oversize/empty handling, and validation-deferred selection.
- Component contract coverage for cover picker web image/GIF/video preparation, phone-web video degradation, brand/creator avatar web branches, stop-photo remaining-slot and per-file invalid handling, and Activities/Menu snap image/PDF browser reading/callbacks.
- Scoped adapter fix for validation-deferred picker flows.

Out of scope and untouched:

- Backend, provider, schema, storage, RLS, migrations, edge functions.
- Deploy, merge, OTA, reap, or route promotion.
- Checkout intake uploads, group chat attachments, scanner/camera parity.
- Payout, Stripe, Paystack, Ari, Hub/detail changes.

## Cross-Surface Matrix

| Surface | Status | Notes |
|---|---|---|
| Business web preview | Touched | Adapter and tests protect in-scope media picker flows. |
| Business iOS | Preserved | Native picker files unchanged; no native behavior change. |
| Business Android | Preserved | Native picker files unchanged; no native behavior change. |
| Consumer iOS/Android | Not in scope | No app-mobile files touched. |
| Buyer/anonymous web | Not in scope | No buyer checkout or public web files touched. |
| Admin web | Not in scope | No admin files touched. |
| Backend/Supabase/providers | Not in scope | No Supabase/provider/schema files touched. |

## Changes

| File | Change |
|---|---|
| `mingla-business/src/utils/browserFilePicker.ts` | Added an internal no-validation conversion path so `validate: false` returns selected browser files without throwing on empty/unsupported/oversize files. |
| `mingla-business/src/utils/__tests__/browserFilePicker.test.ts` | Expanded adapter tests from 4 to 9 cases, including cancel/single/multi/PDF and validation-deferred selection. |
| `mingla-business/src/utils/__tests__/orch_1097_browser_picker_component_contracts.test.ts` | Added source-level component contract tests for cover/avatar/stop-photo/snap-input flows. This is the feasible component guard because the package does not install `@testing-library/react-native` or `react-test-renderer`. |
| `mingla-business/package.json` | Wired the new component contract test into `npm run test:orch-1097`. |

## Old-Failure Proof

Feasible and recorded.

Method: created temp worktree at old QA HEAD `fd5da4018`, applied only the new/expanded tests, symlinked the existing `node_modules`, and ran the focused Jest command.

Result: expected FAIL.

Key failure:

```text
FAIL src/utils/__tests__/browserFilePicker.test.ts
✕ pickBrowserFiles can defer validation so callers skip invalid files per-file
BrowserFilePickerError: Choose a non-empty file.
old-proof-exit=1
```

Why this matters: the previous implementation asked the adapter to defer validation for stop-photo multi-select, but the adapter still validated empty files when converting to `BrowserPickedFile`. The new test catches that exact contract regression.

## Verification

| Command | Result |
|---|---|
| `npm run test:orch-1097` | PASS before export: guard PASS, 2 Jest suites PASS, 14 tests PASS. |
| `npm run test:orch-1096` | PASS; chained ORCH-1085 through ORCH-1096 guards/tests all green. |
| `npm run web:export` | PASS; exported `web-build`; non-blocking Sentry config warning only. |
| `npm run test:orch-1097` after export | PASS; fresh export-bundle token scan plus 14 Jest tests green. |

Post-export `test:orch-1097` output:

```text
ORCH-1097 business web media picker controls guard PASS
PASS src/utils/__tests__/orch_1097_browser_picker_component_contracts.test.ts
PASS src/utils/__tests__/browserFilePicker.test.ts
Test Suites: 2 passed, 2 total
Tests: 14 passed, 14 total
```

## Risk / Residual Manual Gates

- Authenticated OS file chooser runtime and iPhone Safari physical picker proof remain tester/manual gates from the original QA report; this rework removes the automated coverage gap, not the physical-device availability gap.
- No deploy from this worktree. Business web deploy only after PR merge to `main` if orchestrator authorizes it.

## Deployment Notes

- Migrations: none.
- Edge functions: none.
- Backend/provider/schema/storage/RLS: none.
- Native OTA: not expected.
- Business web deploy: only from merged `main`, not this ORCH worktree.

## Suggested Retest Focus

Tester should rerun targeted QA against ORCH-1097 with special attention to:

1. `npm run test:orch-1097` now includes adapter and component-contract coverage for the P2 gap.
2. Stop-photo multi-select should preserve valid files when invalid/empty selections are present.
3. `npm run test:orch-1096` and `npm run web:export` remain green.
4. Original manual authenticated picker and iPhone Safari runtime gates remain explicitly manual unless tester has devices/session access.
