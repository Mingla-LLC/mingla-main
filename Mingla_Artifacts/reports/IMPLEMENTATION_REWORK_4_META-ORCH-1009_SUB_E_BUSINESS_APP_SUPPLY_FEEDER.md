# Implementation Report: META-ORCH-1009 Sub-E Business-App Supply Feeder Rework 4

> Date: 2026-05-31
> Mode: Rework
> Spec: User-directed hardening prompt for Sub-E CoverPicker video-trim editor
> Status: implemented and verified

## 1. Layman Summary

The Business app no longer crashes while loading the bundle when the installed native dev build is missing `VideoTrim`. CoverPicker still requires a fresh native build for full video trimming, but a stale build now fails only when the user invokes trim, letting the app stay open and route through the normal upload-error path.

## 2. Request And Context

- **Request:** Remove the top-level value import of `react-native-video-trim` from the CoverPicker native trim editor and add regression coverage that proves missing native trim rejects from invocation rather than crashing module import.
- **Source:** Seth rework prompt for `META-ORCH-1009 Sub-E`.
- **Affected surfaces:** Mingla Business iOS/Android CoverPicker video upload path.
- **Related artifacts:** Prior rework report `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_3_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`.
- **Comms ledger factored:** COMMS-0002, COMMS-0003, COMMS-0004, COMMS-0011, COMMS-0013, COMMS-0015, and COMMS-0016. No backend, provider API, intake, deploy, checkout, or Sub-F scope was touched.

## 3. Scope

- **In scope:** `mingla-business/src/components/ui/coverPickerVideoTrimEditor.ts`, CoverPicker trim regression tests, and this report.
- **Out of scope:** Product changes, web trim behavior, Supabase migrations/edge functions, Sub-F checkout routing, unrelated dirty Sub-E files.
- **Assumptions:** The native `react-native-video-trim` package export shape remains `default` for the event emitter plus named `showEditor`, matching the previous implementation.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan | Matching OPEN WARN rows were process/scope guardrails; none blocked this frontend-only rework. |
| `mingla-business/src/components/ui/coverPickerVideoTrimEditor.ts` | Crash source | Top-level value import could evaluate `TurboModuleRegistry.getEnforcing('VideoTrim')` during bundle load. |
| `mingla-business/src/components/ui/coverPickerVideoTrimEditor.web.ts` | Web split parity | Web stub already avoids the native package and resolves `null`; preserved unchanged. |
| `mingla-business/src/components/ui/CoverPicker.tsx` | Invocation/error path | `pickVideoCover` awaits trim and catches errors through `showUploadError`; no caller change needed. |
| `mingla-business/src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts` | Existing trim coverage | Best home for native invocation contract coverage. |
| `mingla-business/src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts` | Existing split coverage | Old expectation allowed an eager import in the native base file and needed tightening. |
| `.github/scripts/strict-grep/orch-1001-no-native-turbomodule-in-web-bundle.mjs` | Import gate | Gate targets eager imports and permits lazy `require`, so the hardening stays compatible. |

## 5. Blast Radius

- **Direct changes:** CoverPicker native trim editor lazy-loads `react-native-video-trim` only inside `trimVideoWithDedicatedEditor`.
- **Cascade changes:** A missing/stale native `VideoTrim` module now rejects the trim promise; CoverPicker's existing catch path shows the generic cover-upload failure toast.
- **Parity surfaces:** Business iOS/Android touched. Business web preview preserved through `.web.ts`. Consumer, buyer web, and admin surfaces not touched.
- **Cache impact:** None.
- **State boundaries:** No React Query, Zustand, AsyncStorage, persisted state, or auth boundary changes.
- **Auth/RLS/security:** None.
- **Deploy path:** No migration, edge function, or web deploy change.

## 6. Old To New Receipts

### `mingla-business/src/components/ui/coverPickerVideoTrimEditor.ts`

- **Before:** The module value-imported `react-native-video-trim` at top level, so a stale native build could crash Business app bundle load before React mounted.
- **After:** The file has no top-level value import from `react-native-video-trim`; it lazy `require`s the package inside trim invocation, validates the expected API, and throws a controlled error when unavailable.
- **Why:** Missing native trim should block only the trim action, not the entire app.
- **Approx lines changed:** 80.

### `mingla-business/src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts`

- **Before:** Covered upload-file construction and cancel/no-upload source contract, but not missing-native-module import safety.
- **After:** Adds source coverage that forbids top-level value imports and a Jest mock proving the editor module imports cleanly while trim invocation rejects when `react-native-video-trim` throws.
- **Why:** This fails on the old eager import and passes on lazy safe load.
- **Approx lines changed:** 34.

### `mingla-business/src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts`

- **Before:** Expected the native base file to hold an eager import.
- **After:** Expects lazy `require` and no top-level value import.
- **Why:** The native base file must now be safe against stale native dev builds too.
- **Approx lines changed:** 5.

## 7. Implementation Details

- **Architecture decisions:** Kept the existing Metro web split. Added a native-side lazy loader instead of changing CoverPicker call sites.
- **Data flow:** `pickVideoCover` still calls `trimVideoWithDedicatedEditor`; only the editor's dependency acquisition moved from module eval to function invocation.
- **Error handling:** Missing package/native API throws a clear `Video trimming requires an updated Mingla Business native build...` error, which CoverPicker catches through its existing upload-error path.
- **Copy/accessibility:** No visible UI copy or layout changes.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Business app must not crash on bundle load when `VideoTrim` is absent | Removed top-level value import; module imports before mocked native throw is triggered | `T-SUBE-TRIM-02` | Met |
| Missing native trim should reject from trim invocation | Lazy loader catches native load failure and rejects the promise | `T-SUBE-TRIM-02` | Met |
| Preserve web platform split behavior | `.web.ts` unchanged; ORCH-1001 web split test still passes | `orch1001CoverPickerWebSplit` | Met |
| Add regression coverage that fails on old eager import | Source contract forbids top-level value import and mock-import test would fail if import executed at module load | `CoverPicker.dedicatedTrimmer` | Met |
| Do not touch unrelated Sub-E product scope | Only trim editor, two tests, and this report changed | Git diff inspection | Met |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-COMMS-LEDGER-ENTRY-STANZA | Yes | Yes | Matching warnings read and factored. |
| ORCH-1001 native TurboModule web-bundle gate | Yes | Yes | Gate self-test and live scan pass. |
| Regression-test habit | Yes | Yes | Added failing-on-old-behavior tests in the same scoped change. |
| Worktree-per-ORCH | Yes | Yes | All edits made in the assigned Sub-E worktree. |

## 10. Parity Check

- **Mobile:** Business iOS/Android cover video trim path hardened.
- **Business app:** Shared CoverPicker behavior preserved except stale native trim now degrades gracefully.
- **Admin:** Not touched.
- **Public/web:** Web split unchanged and verified.
- **Solo/collab:** Not applicable.
- **Gaps:** Full video trimming still requires a fresh native dev build with `react-native-video-trim` linked; tester should run that native smoke after rebuild.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Improved for stale native builds because the bundle can load without evaluating `react-native-video-trim`.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Changed CoverPicker tests | `cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest CoverPicker.dedicatedTrimmer orch1001CoverPickerWebSplit --runInBand` | PASS | 2 suites, 9 tests, 40.834s. |
| ORCH-1001 gate and adversarial tests | `cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npm run test:orch-1001` | PASS | Gate self-test PASS, live gate PASS, 2 Jest suites PASS. The adversarial test intentionally prints child-process "FAILED" fixture output while the overall command exits 0. |
| Whitespace check | `git diff --check -- mingla-business/src/components/ui/coverPickerVideoTrimEditor.ts mingla-business/src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts mingla-business/src/components/ui/__tests__/orch1001CoverPickerWebSplit.test.ts` | PASS | No output. |

## 13. Regression Surface

1. CoverPicker native video upload: missing `VideoTrim` now follows a caught rejection path instead of bundle-load crash.
2. CoverPicker web preview: `.web.ts` stub remains native-free and resolves `null`.
3. ORCH-1001 gate: still prevents eager native-only TurboModule imports from web-reachable Business code.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Fresh native build still required | This hardening does not make trimming work in stale native binaries; it only prevents app-wide load crash. | Tester reruns QA on a rebuilt native dev build with `VideoTrim` linked. | Business iOS/Android CoverPicker video trim flow |

## 15. Discoveries For Orchestrator

- None requiring a new comms-ledger entry.

## 16. Deploy Notes

- **Migrations:** None introduced or modified by this rework.
- **Edge functions:** None introduced or modified by this rework.
- **Mobile OTA/native:** JavaScript can ship via the normal app update path, but full video-trim QA still requires a fresh native dev build containing `react-native-video-trim`.
- **Business/admin web:** No web behavior change beyond preserving existing split.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
business: lazy-load native cover video trim module

Resolves: META-ORCH-1009 Sub-E rework
Evidence: npx jest CoverPicker.dedicatedTrimmer orch1001CoverPickerWebSplit --runInBand; npm run test:orch-1001
Deploy: no migration or edge deploy
```

## Ready-To-Test Checklist

1. Launch the existing stale/missing-native-module dev build and open Mingla Business.
2. Expected: the app bundle loads and the Sub-E flow can be reached; no redbox occurs from `TurboModuleRegistry.getEnforcing('VideoTrim')` during bundle load.
3. Invoke CoverPicker video trim on that stale build.
4. Expected: trim fails through the controlled upload-error path instead of crashing the whole app.
5. Rebuild the native dev app with `react-native-video-trim` linked and rerun the full video trim happy path.
