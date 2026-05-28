# INVESTIGATION_ORCH-0978_SAVE_BUTTON_GREYED

Generated: 2026-05-27
Owner: mingla-forensics+codex
ORCH: ORCH-0978 [Video upload polish + sub-30s perfect cross-surface render]
Mode: INVESTIGATION ONLY - no product code or SPEC changes retained
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`

## 1. Executive conclusion

The grey Save button is a real client/runtime bug, but not because the final Save RPC is broken. On the reproduced iOS simulator path, choosing a 12-second video immediately swaps the cover preview to the local video, then the upload-intent edge call returns `401`, no `event_cover_video_jobs` row is created, the hook enters `phase: "error"`, and `localPreviewUri` remains set. The screen therefore looks like the new video is selected, but `CoverPicker` never emits a cover-media patch, so `EditPublishedScreen` has no server-editable change and keeps Save disabled under the live-event gate.

There are two release-blocking truths to fold into SPEC AMENDMENT 2:

1. The Save-greyed symptom is caused by a failed upload-intent/auth path leaving a stale local preview with no patch and no retry-safe state reset.
2. The remote database still enforces 15-second `event_cover_video_jobs` constraints, so the operator-selected 29-second cap from the approved trim investigation will still fail until schema constraints are raised above 29 seconds.

## 2. Scope and hard guards

Investigated only:

- Business app live-event edit cover-video path.
- iOS simulator live-fire with Maestro against `com.sethogieva.minglabusiness`.
- Client state, save gate, edge functions, migration/schema truth, and persisted data.

Not done:

- No product fix was retained.
- No SPEC was written.
- No Supabase/Cloudinary/GitHub mutation was performed.

Temporary instrumentation was added locally to prove state, then removed before this report. It logged only the cover-video hook and picker state.

## 3. Live-fire proof

Environment:

- Simulator: iPhone 17, iOS 26.4, UDID `F7ECAC25-2A98-4002-AD17-85AED17AB752`.
- App bundle: `com.sethogieva.minglabusiness`.
- Metro: ORCH-0978 worktree on port `8090`.
- Test event: `Vibes and Stuff`, server event id `09b4ece6-eabc-4734-8ce3-3a25d90417e4`.
- Test asset: generated 12-second MP4, 289,420 bytes, `video/mp4`.
- Driver: Maestro coordinate/text flow, no `osascript`.

Evidence files:

- `Mingla_Artifacts/reports/qa-orch-0978-runtime/save-button-greyed/after-choose-return.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/save-button-greyed/after-rebuild-launch.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/save-button-greyed/event-detail-rebuilt.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/save-button-greyed/cover-section-before-upload.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/save-button-greyed/local-preview-save-grey-after-choose.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/save-button-greyed/local-preview-save-grey-65s.png`
- `Mingla_Artifacts/reports/qa-orch-0978-runtime/save-button-greyed/instrumented-error-toast.png`

Screen recording note: `xcrun simctl io ... recordVideo` initially started, but the host recorder became stuck as "recording in progress" and produced a corrupt 0-byte `.mov` plus an unfinished sidecar. I removed those unusable files rather than preserving a 586 MB corrupt artifact. Live-fire is still proven by Maestro screenshots, Metro logs, DB probes, and code trace.

Observed flow:

1. Opened `Vibes and Stuff`.
2. Opened menu -> Edit details.
3. Collapsed Basics, opened Cover.
4. Tapped Upload video.
5. Picked the 12-second test video from iOS Photos.
6. Tapped native `Choose Video`.
7. The cover preview changed to the local video immediately.
8. Save stayed grey after 12 seconds and after 65 seconds.
9. DB query showed zero jobs for the event and zero jobs created in the last 10 minutes.

Runtime log excerpt from temporary instrumentation:

```text
[ORCH-0978-video-upload] start {
  applyMode: "published_manual",
  bytes: 289420,
  durationMs: 12000,
  eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
  mimeType: "video/mp4"
}

[ORCH-0978-video-upload] compressed {
  bytes: 289420,
  durationMs: 12000,
  wasCompressed: false
}

[eventCoverVideoProcessingService] upload-intent-request {
  applyMode: "published_manual",
  brandId: "22a18413-bfbf-4087-9ba7-45f70deba0f3",
  eventId: "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
  sourceDurationMs: 12000
}

[eventCoverVideoProcessingService] upload-intent-edge-error {...}
[eventCoverVideoProcessingService] edge-error-auth {
  fallback: "Could not prepare video upload.",
  message: "Edge Function returned a non-2xx status code",
  status: 401
}

[ORCH-0978-cover-picker] stage {
  error: "Finishing sign-in. Try again in a moment.",
  localPreviewUri: "file:///.../ImagePicker/...mp4",
  phase: "error",
  processedUrl: null,
  status: null
}
```

DB probe after repro:

```sql
SELECT id, event_id, status, apply_mode, created_at
FROM public.event_cover_video_jobs
WHERE event_id = '09b4ece6-eabc-4734-8ce3-3a25d90417e4'
   OR created_at > now() - interval '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
```

Result: `[]`.

## 4. Five-truth-layer matrix

| Layer | Current truth | Verdict | Evidence |
|---|---|---|---|
| Product/docs intent | ORCH-0978 expects a fast local preview, final Cloudinary-rendered MP4, then a saveable live-event cover patch. Companion trim report is approved with a 29-second cap path. | Contradicted by runtime and schema. | `SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`; `INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` approved at `1f39b63af`. |
| Schema/migration | Remote `event_cover_video_jobs` exists, but constraints still cap trim and processed duration at 15,000 ms. | Launch blocker for the 29-second decision. | Management API query of `pg_constraint`: `event_cover_video_jobs_trim_max_duration CHECK ((trim_end_ms - trim_start_ms) <= 15000)` and `event_cover_video_jobs_processed_max_duration CHECK (... <= 15000)`. |
| Code path | `CoverPicker` shows `localPreviewUri` before upload success; parent patch is emitted only when hook stage becomes `ready` with `processedUrl`. Save gate only enables when `currentPatch` is non-empty and server-editable. | Root cause path confirmed. | `CoverPicker.tsx:241-248`, `266-280`; `EditPublishedScreen.tsx:224-231`, `380-382`, `385-421`, `1161-1166`. |
| Runtime/test evidence | iOS sim and Maestro reproduce: local video preview appears, Save remains grey, upload intent returns 401, hook phase becomes `error`, local preview remains, no DB job appears. | Confirmed bug. | Screenshots listed above; Metro instrumentation excerpt; DB query result `[]`. |
| Persisted data | `events` row remains original GIF; no job row is inserted for the repro event because auth fails before edge function insert. | Confirms failure occurs before Cloudinary/upload/webhook/save. | `events` probe: `Vibes and Stuff` still `cover_media_type = gif`; `event_cover_video_jobs` probe empty for repro event. |

## 5. Findings

### F-1 - Confirmed bug - Local preview can look selected while Save remains disabled forever

Symptom: After choosing a video, the cover preview changes to the local MP4, but Save remains grey.

Root cause proof:

- File/line: `mingla-business/src/components/ui/CoverPicker.tsx:241-248`.
- Exact behavior: active media is `videoUpload.localPreviewUri ?? videoUpload.processedUrl ?? localCover.coverMediaUrl`; any selected local URI becomes the displayed cover.
- File/line: `mingla-business/src/components/ui/CoverPicker.tsx:266-280`.
- Exact behavior: `emitChange(...)` runs only when `videoUpload.stage.phase === "ready"` and `processedUrl !== null`.
- Runtime proof: hook ended with `phase: "error"`, `localPreviewUri` still set, `processedUrl: null`.
- Causal chain: picker displays local preview -> upload intent fails -> ready never fires -> parent gets no cover patch -> Save gate sees no server-editable patch -> Save stays disabled.

Expected behavior: if the selected video cannot become a persisted processed cover, the UI must not keep showing it as if it is saveable.

Fix direction: clear `localPreviewUri` on upload-intent/upload/poll errors, or move the preview into an explicit failed/retry state that cannot be mistaken for a selected cover.

Regression guard: component/hook test where `createEventCoverVideoUploadIntent` returns 401 and asserts local preview is cleared or visibly failed, `onCoverChange` is not called, and Save UX offers retry rather than a phantom selected video.

### F-2 - Confirmed bug - 401 upload-intent error is mapped to "Finishing sign-in" after the user is visibly inside the signed-in app

Symptom: The app is signed in and can navigate/edit the event, but the upload-intent edge call returns 401 and the user sees a transient auth-ish toast.

Root cause proof:

- File/line: `supabase/functions/event-cover-video-upload-intent/index.ts:48-52`.
- Exact behavior: the edge function calls `requireUserId(req)` before validation or job insert, and immediately returns a 401 response on auth failure.
- File/line: `mingla-business/src/services/eventCoverVideoProcessingService.ts:548-563`.
- Exact behavior: any 401 from the edge function is mapped to `BusinessAuthNotReadyError("unauthenticated", "Finishing sign-in. Try again in a moment.")`.
- Runtime proof: Metro logged `upload-intent-edge-error`, `edge-error-auth`, `status: 401`, followed by `BusinessAuthNotReadyError`.

Expected behavior: a signed-in organizer should either have a valid token before opening the upload picker, or the upload should block before selecting a file with clear session-expired/retry action.

Fix direction: add auth-readiness preflight before launching image picker and before setting local preview; on 401, refresh/reload session or show a stable session-expired retry message. Do not leave the picker in a selected-video visual state.

Regression guard: service/hook integration test where `supabase.functions.invoke` returns 401 after file pick and asserts the hook reaches a retryable auth error state with `localPreviewUri === null`.

### F-3 - Confirmed bug - No `event_cover_video_jobs` row is created on the reproduced Save-greyed path

Symptom: The UI looks like it has selected a new video, but there is no server-side job for the event.

Evidence:

- Runtime log stops at upload intent 401.
- DB probe for `event_id = '09b4ece6-eabc-4734-8ce3-3a25d90417e4'` returns no rows.
- DB probe for any rows created in the last 10 minutes returns no rows.
- Edge function inserts the job only after auth, validation, permission pass, and active-job cancellation (`event-cover-video-upload-intent/index.ts:155-217`).

Expected behavior: a local preview should only be treated as a pending cover if there is a durable job id or a clearly pending client state.

Fix direction: make job creation the first state that can produce a durable "pending video" UI. Before intent success, use "preparing upload" UI rather than swapping the cover permanently.

Regression guard: assert no-job failures roll back the preview and leave the old provider label/image intact.

### F-4 - Confirmed bug - The live-event Save gate is working as coded, but its inputs are wrong after upload failure

Symptom: Save is grey after video pick.

Root cause proof:

- File/line: `EditPublishedScreen.tsx:224-231`.
- Exact behavior: `isServerEditableOnlyPatch` requires at least one patch key and every key must be server-editable.
- File/line: `EditPublishedScreen.tsx:380-382`.
- Exact behavior: `canSaveServerCoverMediaOnly = disableLocalSaveReason !== undefined && isServerEditableOnlyPatch(currentPatch)`.
- File/line: `EditPublishedScreen.tsx:1161-1166`.
- Exact behavior: Save is disabled when `coverVideoProcessing` is true or when the live-event disable gate is present and `canSaveServerCoverMediaOnly` is false.
- Runtime proof: after the 401, hook is `phase: "error"`, so `coverVideoProcessing` is false, but no `emitChange` ran and `currentPatch` remains empty. Empty patch means `isServerEditableOnlyPatch` is false.

Expected behavior: the Save button should not be the only user-facing signal. If the upload failed before a patch exists, the preview should roll back or show retry/error state.

Fix direction: do not widen the Save gate to allow empty patches. The gate correctly prevents saving nothing. Fix the picker/hook state instead.

Regression guard: existing `EditPublishedScreen_when_save_gate` tests should be extended with "local preview without processed patch keeps Save disabled and shows explicit retry/rollback state."

### F-5 - Confirmed bug - Hook catch path does not clear stale preview state

Symptom: The old GIF provider label (`GIPHY`) remains, the local video preview remains, and the button remains disabled after error.

Root cause proof:

- File/line: `useEventCoverVideoUpload.ts:70-75`.
- Exact behavior: `setLocalPreviewUri(file.uri)` happens before compression and upload-intent success.
- File/line: `useEventCoverVideoUpload.ts:142-152`.
- Exact behavior: catch sets `error` and `stage: { phase: "error" }`, but never clears `localPreviewUri`, `processedUrl`, `status`, or job id beyond the earlier reset.
- Runtime proof: instrumentation logged `phase: "error"` with `localPreviewUri` still set.

Expected behavior: failed uploads should not leave stale local-only media in the primary cover slot.

Fix direction: in catch, clear `localPreviewUri` unless the UX explicitly supports a failed preview card with retry/remove controls. Prefer explicit `failedLocalPreviewUri` if the design wants to preserve the failed file for one-tap retry.

Regression guard: hook test for all pre-ready failures: compressor error, upload-intent 401, upload provider failure, acknowledge failure, status timeout.

### F-6 - Confirmed launch blocker - Remote DB still enforces 15-second constraints

Symptom: ORCH-0978 has moved product/code toward sub-30-second covers, and the companion investigation chose 29 seconds, but the remote database still rejects values above 15 seconds.

Evidence:

```text
event_cover_video_jobs_trim_max_duration:
CHECK (((trim_end_ms - trim_start_ms) <= 15000))

event_cover_video_jobs_processed_max_duration:
CHECK (((processed_duration_ms IS NULL) OR (processed_duration_ms <= 15000)))
```

Local migration truth matches remote: `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql` defines the 15-second checks; the later `20260515000014...cancelled_at` migration does not raise them.

Expected behavior: if SPEC AMENDMENT 2 sets a 29-second cap, DB constraints must allow at least 29,000 ms plus any rounding tolerance chosen by the spec.

Fix direction: SPEC AMENDMENT 2 must include a migration that drops/recreates both constraints with the final 29-second contract. This is required even if the client cap changes from 30 to 29.

Regression guard: migration self-verify query that fails if either constraint still contains `15000`, plus an edge-function validation test for 29,000 ms accepted and 29,001/30,000 ms rejected according to the chosen contract.

### F-7 - Confirmed behavior - The Cloudinary/upload/webhook lifecycle is not reached on this repro

Symptom: It is tempting to diagnose the grey Save button as a webhook, Realtime, or cache invalidation issue, but this repro never reaches those layers.

Evidence:

- No job row is inserted.
- No Cloudinary upload fields are produced.
- No provider upload starts.
- No status polling starts.
- No webhook can fire without a job/source asset.

Code trace:

- `createEventCoverVideoUploadIntent` must return a job id before `uploadEventCoverVideoSource` is called (`useEventCoverVideoUpload.ts:91-114`).
- `waitForEventCoverVideoReady` only runs after upload and acknowledge (`useEventCoverVideoUpload.ts:117-136`).
- `emitChange` only runs after `ready` (`CoverPicker.tsx:266-280`).

Expected behavior: debugging and telemetry should make this boundary obvious.

Fix direction: add structured telemetry for `video_cover_upload_intent_failed`, `video_cover_upload_ready`, and `video_cover_upload_preview_rolled_back` with event id, apply mode, phase, and non-sensitive error code.

Regression guard: assert upload-intent failure does not call Cloudinary upload mocks or status polling mocks.

### F-8 - Production-hardening gap - Native dev-client freshness is a real test gate for this feature

Symptom: The first live-fire run redboxed immediately after `Choose Video`.

Evidence:

- Screenshot: `after-choose-return.png`.
- Error: `The package 'react-native-compressor' doesn't seem to be linked. Make sure: You have run 'pod install'; You rebuilt the app after installing the package; You are not using Expo Go`.
- Source: `eventCoverVideoProcessingService.ts:361-371` requires `react-native-compressor`.
- Rebuild path: `pod install` linked `react-native-compressor (1.18.2)`; `xcodebuild` succeeded only after `SENTRY_DISABLE_AUTO_UPLOAD=true`.
- Official Expo docs note that local development builds must be rebuilt after native/config changes: https://docs.expo.dev/workflow/overview/

Expected behavior: ORCH-0978 tester/implementor prompts should require a rebuilt dev client before declaring video upload runtime status.

Fix direction: add this to IMPLEMENT-2/tester gates: install/rebuild dev client, verify native compressor is linked, and disable Sentry auto-upload for local Debug builds unless Sentry org/project env vars exist.

Regression guard: runtime smoke must include an actual `Choose Video` return from iOS picker on a rebuilt dev client.

### F-9 - Test gap - Existing automated tests encode pieces, not the failed user journey

Symptom: The bug survived because current tests validate service mappings and save-gate logic independently, but not the joined runtime state where a failed upload leaves a local preview and no patch.

Evidence:

- `eventCoverVideoProcessingService.test.ts:60-83` asserts 401 maps to `BusinessAuthNotReadyError`.
- `EditPublishedScreen_when_save_gate.test.ts` asserts server-editable patch gate strings.
- No test asserts `localPreviewUri` cleanup on upload-intent 401.
- No test asserts that `CoverPicker` does not leave a phantom selected video when `processedUrl` is null and stage is error.

Expected behavior: behavior fixes must ship with a repo-running regression test that fails before the fix and passes after it.

Fix direction: IMPLEMENT-2 should add a focused hook/component regression and a live-fire manual tester gate. If full native picker automation is not feasible in Jest, make the automated test cover the state machine and keep Maestro as the manual runtime gate.

Regression guard:

- Unit: `useEventCoverVideoUpload` 401 path clears/marks failed preview.
- Component: `CoverPicker` displays old cover plus retry/error affordance after intent failure.
- Screen: `EditPublishedScreen` Save remains disabled for no patch, but user sees explicit failure rather than phantom selected cover.
- Live-fire: iOS sim + Maestro pick a <=29s MP4, observe either final processed cover enables Save or a clear rollback/error state on forced 401.

## 6. Fix-shape recommendations

### Recommended fix shape

1. Add an auth-readiness preflight before opening the video picker and before setting local preview. If business auth is not ready, block the picker and show a stable auth/session message.
2. Move local-preview ownership from "selected file is now the cover" to "selected file is preparing/uploading." The primary cover should roll back on any pre-ready failure unless a distinct failed-preview UI is designed.
3. On hook catch before `ready`, clear `localPreviewUri` and set a retryable error object with phase/code. Do not call `emitChange`.
4. Keep `EditPublishedScreen` Save gate strict. Do not let empty patches pass.
5. Add telemetry and tests for every pre-ready failure phase.
6. Add a migration to align remote DB constraints with the final 29-second cap.

### Do not choose

- Do not enable Save for a local file URI. The live event must persist a processed Cloudinary URL, not a simulator/device cache URI.
- Do not bypass `disableLocalSaveReason` for empty patches. That would save nothing and mask the actual failure.
- Do not treat this as a Cloudinary webhook/cache bug for this repro. No job row exists.

## 7. SPEC AMENDMENT 2 inputs

Required amendment items:

1. Cap contract: 29 seconds everywhere, including client picker copy, client guard, edge validation, Cloudinary transformation assumptions, and DB constraints.
2. Migration: drop/recreate `event_cover_video_jobs_trim_max_duration` and `event_cover_video_jobs_processed_max_duration` to the chosen cap.
3. Upload failure UX: pre-ready failures must not leave local video as the apparent selected cover.
4. Auth preflight: if auth/session is not ready, block video pick or immediately roll back before preview.
5. Save-gate contract: Save enables only after `emitChange` has produced a processed remote cover-media patch.
6. Runtime verification: rebuilt iOS dev client, Maestro live-fire, DB probe for job lifecycle, and public/business render smoke after successful processed URL.
7. Test contract: hook/component/screen regression tests in the same implementation commit; manual tester gate only for native picker interaction.

## 8. Commands and verification

Key commands run:

```bash
pod install
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild \
  -workspace Business.xcworkspace \
  -scheme Business \
  -configuration Debug \
  -destination 'id=F7ECAC25-2A98-4002-AD17-85AED17AB752' \
  -quiet build
xcrun simctl install F7ECAC25-2A98-4002-AD17-85AED17AB752 <Business.app>
~/.maestro/bin/maestro --device F7ECAC25-2A98-4002-AD17-85AED17AB752 test <flows>
```

Read-only DB probes used Supabase Management API:

- Official docs: https://supabase.com/docs/reference/api/introduction
- Project ref: `gqnoajqerqhnvulmnyvv`
- No mutations performed.

Provider docs touched for external-API context:

- Expo local development builds: https://docs.expo.dev/workflow/overview/
- Cloudinary upload API: https://cloudinary.com/documentation/image_upload_api_reference
- Cloudinary authentication signatures: https://cloudinary.com/documentation/authentication_signatures

## 9. Confidence

Confidence: proven for the reproduced Save-greyed symptom on iOS simulator.

Limits:

- The screen recorder was unavailable after it became stuck in a host "recording in progress" state, so evidence is screenshot/log/DB based rather than video based.
- The successful Cloudinary/webhook/save path was not reached because the confirmed repro fails at upload intent auth. That path still needs a separate successful live-fire after the auth/preview fix and schema migration land.

