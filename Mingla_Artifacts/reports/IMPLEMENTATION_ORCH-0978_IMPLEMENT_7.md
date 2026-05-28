# Implementation Report: ORCH-0978 IMPLEMENT-7 Full Trimmed-Clip Wiring

> Date: 2026-05-28
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0978_IMPLEMENT_7_FULL_WIRING.md` + `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` SPEC AMENDMENT 9
> Status: implemented, partially verified

## 1. Layman Summary

The video-cover picker now uploads the clip produced by the dedicated trimmer instead of silently falling back to the original long video. When a brand admin trims a long video to a sub-29s segment, the app builds the upload from the trimmer's returned `outputPath`, uses `endTime - startTime` as the duration, re-stats the trimmed file for bytes, and sends trim metadata as `0 -> trimmedDuration`. No edge function, database, or Cloudinary `so_` change was made.

## 2. Request And Context

- **Request:** Execute ORCH-0978 IMPLEMENT-7 full wiring after the PoC proved `react-native-video-trim` returns usable trimmed files.
- **Source:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0978_IMPLEMENT_7_FULL_WIRING.md`; root cause `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_PICKER_TRIM_NOT_APPLIED.md`.
- **Affected surfaces:** `mingla-business` native cover authoring, with web guarded to the existing selection plus source-ceiling fallback.
- **Related issues/artifacts:** COMMS-0008 acknowledged; PoC evidence from `[ORCH-0978-POC]` logs for 29s, 1s, and 8s trims.

## 3. Scope

- **In scope:** CoverPicker trimmer finish/cancel wiring, hook trim metadata pass-through, strict-grep C12, T-AMEND9-01/T-AMEND9-02 regression coverage.
- **Out of scope:** Edge functions, migrations, Cloudinary transformation changes, PR creation, app-store submission, web in-browser trimming.
- **Assumptions:** The installed dev build already contains the native `react-native-video-trim` module proven by the PoC at `145275898`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan | COMMS-0008 warned that ORCH-0978 owns the video-cap migration sources; acknowledged before code work. |
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0978_IMPLEMENT_7_FULL_WIRING.md` | Dispatch contract | Required Architecture B, two commits, C12, and no backend/DB changes. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` | Binding spec | AMENDMENT 9 requires picker selection only, native trimmer, cancel guard, web guard, and trimmed-file upload. |
| `mingla-business/src/components/ui/CoverPicker.tsx` | Primary UI flow | Scaffold opened/logged the trimmer but still kept fallback logic that could ignore the selected segment. |
| `mingla-business/src/hooks/useEventCoverVideoUpload.ts` | Upload contract | `start` always sent `trimStartMs: 0` and `trimEndMs: compressed.durationMs`; explicit caller bounds were missing. |
| `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | CI invariant | C1 still expected picker `videoMaxDuration: 29`; needed replacement plus new C12. |

## 5. Blast Radius

- **Direct changes:** CoverPicker video path, video upload hook input type, focused tests, ORCH-0978 strict-grep gate.
- **Cascade changes:** Retry now preserves the same trimmed file metadata through `lastVideoUploadFileRef`.
- **Parity surfaces:** Native gets dedicated trim; web keeps degraded fallback and cannot call native `showEditor`.
- **Cache impact:** No new query keys; existing invalidation after applied status is unchanged.
- **State boundaries:** Local picker state remains in CoverPicker; upload lifecycle remains in `useEventCoverVideoUpload`.
- **Auth/RLS/security:** No auth, RLS, edge, or storage changes.
- **Deploy path:** Native build required for the already-added trimmer module; not OTA-only.

## 6. Old To New Receipts

### `mingla-business/src/components/ui/CoverPicker.tsx`

- **Before:** Trimmer finish was logged with `[ORCH-0978-POC]`; upload duration could prefer the library `duration` field or original asset fallback.
- **After:** Native finish builds the upload via `buildTrimmedVideoUploadFile`, using `endTime - startTime`, re-statted bytes from `outputPath`, and explicit `trimStartMs: 0` / `trimEndMs: durationMs`.
- **Why:** The selected segment is the source file now; the original source must not control acceptance or upload.
- **Approx lines changed:** product commit `56f68184666edee560dcf6cce965ba8539e51b90`.

### `mingla-business/src/components/ui/coverPickerVideoTrimUpload.ts`

- **Before:** No pure helper existed for trimmed-file upload construction.
- **After:** New helper normalizes local file URIs, derives duration from `endTime - startTime`, re-stats bytes, and returns the exact hook upload file shape.
- **Why:** Keeps the high-risk trim contract executable in focused unit tests.
- **Approx lines changed:** new file in product commit `56f68184666edee560dcf6cce965ba8539e51b90`.

### `mingla-business/src/hooks/useEventCoverVideoUpload.ts`

- **Before:** `start` accepted only `{ uri, bytes, durationMs, fileName, mimeType }` and always sent trim bounds from compressed duration.
- **After:** `start` accepts optional `trimStartMs` / `trimEndMs` and forwards them to upload-intent, defaulting to the old behavior when omitted.
- **Why:** Architecture B requires the trimmer-built file to enter the pipeline as `0 -> trimmedDuration`.
- **Approx lines changed:** product commit `56f68184666edee560dcf6cce965ba8539e51b90`.

### Tests and Strict-Grep

- **Before:** C1 expected `videoMaxDuration: 29`; no C12 invariant; no T-AMEND9 regressions.
- **After:** C1 no longer allows picker `videoMaxDuration`; C12 enforces dedicated trimmer wiring and absent picker trim knobs; tests cover happy path and cancel guard.
- **Why:** Prevents reverting to unreliable `expo-image-picker` trim and catches the exact PoC gap.
- **Approx lines changed:** Commit 2, `ORCH-0978 IMPLEMENT-7 add trimmer regression gates`.

## 7. Implementation Details

- **Architecture decisions:** Architecture B only. The uploaded source is the trimmed local file, so no Cloudinary `so_` offset or backend schema change is needed.
- **Data flow:** picker selects video -> native `showEditor` opens -> `onFinishTrimming` returns `outputPath/startTime/endTime` -> helper re-stats file -> CoverPicker applies the 33s ceiling to the trimmed duration -> hook starts upload with `trimStartMs: 0`, `trimEndMs: trimmedDuration`.
- **Mutation/query behavior:** Existing upload-intent, source upload, acknowledge, poll, and event cache invalidation path is unchanged.
- **State handling:** Trimmer cancel resolves `null`; CoverPicker returns before `videoUpload.start`, leaving no local preview or phantom upload.
- **Error handling:** Missing duration and missing size still surface user toasts; trimmer errors still reject to the existing video upload error toast.
- **Copy/accessibility:** No visible UI copy changed except removal of PoC logging.
- **Analytics/notifications/realtime:** No change.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Remove picker `allowsEditing` and `videoMaxDuration` for videos | Yes | C12 + source ceiling test | PASS |
| Use trimmer `outputPath` as upload URI | Yes | T-AMEND9-01 helper test | PASS |
| Use `endTime - startTime` as duration | Yes | T-AMEND9-01 uses `duration: 59652` but expects `25000` from `29000 - 4000` | PASS |
| Re-stat bytes from trimmed file | Yes | T-AMEND9-01 asserts stat is called with trimmed URI | PASS |
| Send `trimStartMs:0`, `trimEndMs:trimmedDuration` | Yes | Hook test asserts upload-intent body | PASS |
| Cancel/early close starts no upload | Yes | T-AMEND9-02 source guard checks cancel resolves null before start | PASS |
| Web native guard | Yes | `Platform.OS !== "web"` gates trimmer call; web falls through to source ceiling | PASS by code inspection |
| No edge/DB changes | Yes | Git diff contains no `supabase/` changes | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-COMMS-LEDGER-ENTRY-STANZA | Yes | Yes | COMMS-0008 ack committed to anchor `main` as `ef612e420`. |
| I-PROPOSED-VIDEO-COVER-DEDICATED-TRIMMER | Yes | Yes | C12 now enforces trimmer import/use and absence of picker trim knobs. |
| AMENDMENT 8 caps | Yes | Yes | 33s source ceiling and 30s backend clamp untouched. |
| No silent failures | Yes | Yes | Cancel aborts before start; errors toast through existing handler. |
| One owner per truth | Yes | Yes | Hook remains upload lifecycle owner; parent remains cover state owner. |

## 10. Parity Check

- **Mobile:** Native iOS/Android path uses dedicated trimmer; sim/device live-fire still belongs to downstream tester.
- **Business app:** Implemented in `mingla-business` only as requested.
- **Admin:** Not touched.
- **Public/web:** Web authoring stays degraded and guarded; no read surface changes.
- **Solo/collab:** No data model change.
- **Gaps:** No live simulator trim/upload run was performed in this implementation turn.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None; existing invalidations after ready/applied remain.
- **Data shape changes:** Hook input shape is additive (`trimStartMs?`, `trimEndMs?`).
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** No change.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Focused Jest | `cd mingla-business && npx jest src/components/ui/__tests__/CoverPicker.dedicatedTrimmer.test.ts src/components/ui/__tests__/CoverPicker.videoSourceCeiling.test.ts src/hooks/__tests__/useEventCoverVideoUpload.test.ts --runInBand` | PASS | 3 suites, 5 tests. Watchman emitted a recrawl warning only. |
| Strict-grep C1-C12 | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | PASS | Includes new C12. |
| Broad typecheck attempt | `cd mingla-business && npx tsc --noEmit --pretty false` | FAIL unrelated | Existing errors in `home.tsx`, checkout buyer files, marketing rich editor, `@mingla/payments-native`, and shared package typings; no new CoverPicker/hook errors were isolated from that broad failure. |
| Git diff scope | `git status --short` / commit inspection | PASS scoped | Product/test commits contain only scoped app/gate files; report added separately. |

## 13. Regression Surface

1. Native long-video selection and trimming: verifies chosen segment uploads, not original source.
2. Video upload retry: now reuses the same trimmed file metadata from `lastVideoUploadFileRef`.
3. Web video selection: guarded from native `showEditor`, still source-ceiling checked.
4. Strict-grep legacy cap: C1 was intentionally updated because `videoMaxDuration` is now forbidden.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Native live-fire not run by implementor | Runtime behavior needs end-to-end proof after JS reload/dev build | Tester sim live-fire picks long video, trims arbitrary segment, confirms cover renders chosen segment | Downstream tester |
| Broad typecheck currently red | Repo-wide unrelated TS debt can mask new TS regressions in full gate | Separate owner resolves existing type errors or runs scoped type strategy | Existing app/shared-package files listed in verification |
| Native module release path | `react-native-video-trim` requires native build | Ship via dev/prod native build, not OTA-only | Release orchestration |

## 15. Discoveries For Orchestrator

- None requiring a new comms-ledger entry. COMMS-0008 was factored: ORCH-0978 did not touch or diverge migration sources.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** Native build required because `react-native-video-trim` is native; this wiring itself is JS but depends on the installed dev/prod native module.
- **Business/admin web:** No web deployment required for the native trimmer behavior; if the business web bundle ships this code, web is guarded and falls back to existing selection behavior.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
ORCH-0978 IMPLEMENT-7: upload dedicated-trimmer output

Resolves: ORCH-0978 IMPLEMENT-7
Evidence: focused Jest T-AMEND9 tests + strict-grep C12
Deploy: native build required for react-native-video-trim; no edge/DB deploy
```

## Ready-To-Test Checklist

1. Open the already-installed `mingla-business` dev build on iOS simulator `F7ECAC25-2A98-4002-AD17-85AED17AB752` with Metro on `localhost:8090`.
2. Open a published event cover picker and choose a video longer than 29s.
3. In the trimmer, drag to any arbitrary sub-29s segment, preferably not the first 29s.
4. Confirm upload starts without the "Please trim to 29 seconds first." toast.
5. Confirm the cover renders the chosen segment and the final cloud video replaces the local preview.
6. Repeat once and cancel/back out from the trimmer; confirm no upload starts and no phantom preview remains.
