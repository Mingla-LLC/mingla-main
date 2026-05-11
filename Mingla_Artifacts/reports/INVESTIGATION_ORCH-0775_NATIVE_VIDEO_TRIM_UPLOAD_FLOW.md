# INVESTIGATION ORCH-0775 - Native Video Trim Upload Flow Audit

Date: 2026-05-10  
Mode: Forensics / Investigate  
Scope: Mingla Business event-cover video selection, trim, upload-intent, Cloudinary processing handoff.

## User-Promised Flow Under Audit

```
Tap Video
-> native picker opens
-> native iOS/Android edit/trim UI handles trimming
-> app receives already-trimmed exported video
-> app validates: duration <= 15s
-> app sends that trimmed file to upload-intent with trimStart=0 and trimEnd=duration
-> Cloudinary only compresses/transcodes to browser-safe MP4
```

## Verdict

The current code does **not** implement this flow.

The current implementation opens the video picker with native editing disabled, receives the original selected video, and either:

- sends short videos directly to Cloudinary with `trimStartMs=0`;
- or shows Mingla's custom trim panel and sends the original full source plus trim offsets to Cloudinary.

That means the blocker is not "native trim returned a bad file." Native trim is not currently in the execution path.

## Evidence Chain

### 1. Current Tap Video path disables native editing

File: `mingla-business/src/components/event/CreatorStep4Cover.tsx`

- `pickVideoCover()` calls `ImagePicker.launchImageLibraryAsync`.
- It passes `mediaTypes: ["videos"]`.
- It passes `allowsEditing: false`.
- It passes `videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720`.
- It does **not** pass `videoMaxDuration`.

Evidence lines: `CreatorStep4Cover.tsx:394-400`.

Impact: tapping Video does not ask iOS/Android to trim. The app is asking the picker for a selected/exported video, then doing app-owned trim decisions after the picker returns.

### 2. The current app-owned trim path is explicit

File: `mingla-business/src/components/event/CreatorStep4Cover.tsx`

- `processPickedVideo()` computes `endMs = Math.min(startMs + 15000, durationMs)`.
- It sends `sourceDurationMs`, `trimStartMs`, and `trimEndMs` to `createEventCoverVideoUploadIntent()`.
- For videos over 15 seconds, `pickVideoCover()` sets `pendingVideo`, `trimStartMs=0`, and shows "Choose the 15-second section to use as the cover."
- `handleConfirmTrim()` calls `processPickedVideo(pendingVideo, ..., trimStartMs)`.
- The UI renders "Trim video cover", `-5s`, `+5s`, and `Use this clip`.

Evidence lines:

- `CreatorStep4Cover.tsx:227-272`
- `CreatorStep4Cover.tsx:437-442`
- `CreatorStep4Cover.tsx:470-489`
- `CreatorStep4Cover.tsx:614-660`

Impact: the product currently depends on Cloudinary/provider-side trimming, not native picker trimming.

### 3. Tests currently lock in the opposite behavior from the requested flow

File: `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`

The current guard test expects:

- image and video pickers are separate;
- source contains `allowsEditing: false`;
- source does **not** contain `videoMaxDuration`;
- source contains `Use this clip`;
- source contains `VideoExportPreset.H264_1280x720`.

Evidence lines: `eventCoverMedia.test.ts:67-83`.

Impact: implementing the requested native-trim flow requires rewriting these tests. If an implementor only toggles picker flags, the current ORCH-0770 source guard should fail.

### 4. Expo ImagePicker does not give Mingla a strong 15-second selected-library trim contract

Installed package evidence: `mingla-business/node_modules/expo-image-picker`.

Type definitions say:

- `allowsEditing` is documented primarily as image crop/rotate UI.
- `videoMaxDuration` is documented as maximum duration for video recording.
- On iOS, when `allowsEditing` is true, maximum duration is limited to 10 minutes, not 15 seconds.

Evidence lines:

- `ImagePicker.types.ts:403-417`
- `ImagePicker.types.ts:515-522`

iOS native implementation says:

- If `allowsEditing` is false and source is not camera, Expo uses `PHPicker`.
- If `allowsEditing` is true, Expo uses legacy `UIImagePickerController`.
- With editing enabled, Expo only rejects `videoMaxDuration > 600` and defaults editing max to 600 seconds.

Evidence lines:

- `ImagePickerModule.swift:94-98`
- `ImagePickerModule.swift:131-143`

Impact: "set `allowsEditing: true` and `videoMaxDuration: 15`" is not a proven deterministic guarantee that every selected library video comes back clipped to 15 seconds. Mingla must still validate the returned duration before upload.

### 5. Native editing may regress the output format path

Installed Expo iOS implementation:

- The current `allowsEditing:false` PHPicker path can transcode selected video to `.mp4` when `videoExportPreset` is not passthrough.
- The legacy `allowsEditing:true` path copies the selected/edited video to a generated `.mov` target and returns MIME based on that target.

Evidence lines:

- `MediaHandler.swift:340-366`
- `MediaHandler.swift:415-441`

Impact: native trim might return a MOV/QuickTime file even after editing. That is acceptable only if Mingla still sends it through Cloudinary and publishes only the processed MP4 derivative. It must not reintroduce raw MOV publication.

### 6. The 8-second "could not prepare video upload" failure is concentrated before source upload/Cloudinary processing

Current short-video path:

- For duration `<= 15000 ms`, the app calls `processPickedVideo(asset, eventId, coverMediaApplyMode, 0)`.
- `processPickedVideo()` sends upload-intent with `trimStartMs=0`, `trimEndMs=duration`.
- Only after upload-intent succeeds does the app call `uploadEventCoverVideoSource()`.

Evidence lines:

- `CreatorStep4Cover.tsx:423-447`
- `CreatorStep4Cover.tsx:262-289`
- `eventCoverVideoProcessingService.ts:175-250`

Edge upload-intent can reject before any Cloudinary source upload for:

- missing/invalid auth;
- provider not configured;
- invalid event ID UUID;
- invalid brand ID UUID;
- `sourceBytes <= 0` or `sourceBytes > 500 MB`;
- `sourceDurationMs <= 0` or `sourceDurationMs > 5 min`;
- invalid/out-of-range trim;
- permission failure;
- job insert failure.

Evidence lines:

- `event-cover-video-upload-intent/index.ts:48-53`
- `event-cover-video-upload-intent/index.ts:89-118`
- `event-cover-video-upload-intent/index.ts:120-146`
- `event-cover-video-upload-intent/index.ts:155-229`

Impact: an 8-second video failing with "could not prepare video upload" is not explained by length. It means the failure is in the upload-intent preflight/auth/permission/payload/job setup stage unless the new diagnostic logs prove otherwise.

### 7. Current diagnostic logging can now identify the exact failing stage, but only if the Edge Function version is deployed

Current client diagnostics:

- `upload-intent-start`
- `upload-intent-request`
- `upload-intent-edge-error`
- `upload-intent-rejected`
- `upload-intent-ready`
- `source-upload-start`
- `source-upload-success`
- `status-poll-start`

Current Edge diagnostics:

- `received`
- `provider_not_configured`
- `event_id_invalid_uuid`
- `brand_id_invalid_uuid`
- `source_size_out_of_range`
- `source_duration_out_of_range`
- `trim_range_rejected`
- `validation_pass`
- `permission_rejected`
- `permission_pass`
- `job_insert_failed`
- `job_insert_pass`
- `cloudinary_signature_generated`
- `returned`

Evidence lines:

- `eventCoverVideoProcessingService.ts:120-172`
- `eventCoverVideoProcessingService.ts:189-242`
- `event-cover-video-upload-intent/index.ts:24-38`
- `event-cover-video-upload-intent/index.ts:77-87`
- `event-cover-video-upload-intent/index.ts:113-153`
- `event-cover-video-upload-intent/index.ts:167-231`
- `event-cover-video-upload-intent/index.ts:259-278`

Impact: the next runtime attempt should not be interpreted from the toast alone. The decisive artifact is the shared `requestId` / `clientRequestId` in client logs and Supabase Edge logs.

## Root Cause Findings

### Finding 1 - UX gap: requested native-trim flow is not implemented

Classification: confirmed UX gap  
Severity: P1 for this requested flow

Six-field proof:

- File/line: `CreatorStep4Cover.tsx:394-400`, `CreatorStep4Cover.tsx:437-442`, `CreatorStep4Cover.tsx:614-660`.
- Exact code: video picker uses `allowsEditing: false`; over-15-second videos go into `pendingVideo` and render Mingla's `Trim video cover` panel.
- Current behavior: app-owned trim offsets are used; native picker trim is not invoked.
- Expected behavior: native iOS/Android edit UI trims first, and app receives an already-trimmed clip.
- Causal chain: Tap Video -> picker opens without editing -> selected source returned -> app validates source duration -> custom trim panel or upload-intent -> Cloudinary receives original source + trim offsets.
- Verification step: run the video path and confirm logs show no native trim UI; source guard also asserts `allowsEditing: false`.

Fix direction:

- Rewrite `pickVideoCover()` to open a native-editing video picker where platform/runtime supports it.
- Remove or demote the custom trim panel only after runtime proof on iOS and Android.
- Rewrite the ORCH-0770 source guard test to assert the new contract.

### Finding 2 - Production-hardening gap: native picker trim is not a sufficient sole source of truth

Classification: production-hardening gap  
Severity: P1 if native trim becomes the primary flow

Six-field proof:

- File/line: `ImagePicker.types.ts:515-522`; `ImagePickerModule.swift:131-143`.
- Exact code/docs: `videoMaxDuration` is documented as a recording limit; iOS editing caps at 600 seconds and defaults to 600 seconds.
- Current behavior: current code avoids this ambiguity by not using native trim and sending explicit trim offsets to the provider.
- Expected behavior: after native edit returns, Mingla still validates actual `duration <= 15000 ms` and rejects/falls back if not.
- Causal chain: native picker behavior varies by platform and source type -> returned asset might still be over 15 seconds or have missing duration -> upload-intent may reject or process the wrong segment if app assumes trim happened.
- Verification step: instrument returned asset metadata on real iOS and Android with a known 30+ second video and prove returned `duration`, `uri`, `mimeType`, and `fileSize`.

Fix direction:

- Native trim can be a convenience, not the only guard.
- Required post-picker validation: duration known, duration `>0`, duration `<=15000`, file size known/positive where available, event and brand IDs valid, auth ready.
- If native trim returns over 15 seconds, show a precise inline error or use the existing provider-trim fallback intentionally.

### Finding 3 - Confirmed failure concentration: short-video "prepare upload" failures are upload-intent stage, not trimming stage

Classification: confirmed bug-localization / open runtime root cause  
Severity: P1 until exact runtime stage is captured

Six-field proof:

- File/line: `CreatorStep4Cover.tsx:262-289`; `eventCoverVideoProcessingService.ts:201-212`; `event-cover-video-upload-intent/index.ts:48-229`.
- Exact code: source upload starts only after `createEventCoverVideoUploadIntent()` returns `jobId` and upload fields.
- Current behavior: user saw "could not prepare video upload" for a short video.
- Expected behavior: a valid logged-in organiser selecting an 8-second video should receive upload intent, upload to Cloudinary, poll processing, and apply a processed MP4 cover.
- Causal chain: short video bypasses custom trim -> upload-intent called with `trimStart=0`, `trimEnd=duration` -> error before `source-upload-start` means auth/provider/validation/permission/job creation failed.
- Verification step: deploy current upload-intent diagnostics, reproduce once, match client `requestId` to Edge Function log `stage`; if no Edge `received` exists, the failure is Supabase client/session/network before function body.

Fix direction:

- Do not chase trimming for the 8-second failure until the diagnostic stage is captured.
- The runtime proof must include the exact `upload-intent-request` payload and the Edge stage for the same `requestId`.

### Finding 4 - Regression-test gap: tests do not encode the requested native-trim contract

Classification: production-hardening gap  
Severity: P2

Evidence:

- `eventCoverMedia.test.ts:67-83` asserts the current app-owned processing path.
- `eventCoverVideoProcessingService.test.ts:27-108` tests error mapping but not the exact short-video happy payload contract.

Impact:

- A future implementation could claim native trim but still send Cloudinary trim offsets for untrimmed sources.
- Or it could flip native editing but leave tests passing because no runtime-returned asset contract is asserted.

Required regression tests:

- Video picker source guard updated to assert native editing config if that becomes the product decision.
- Short already-trimmed clip test: `duration=8000` sends `trimStartMs=0`, `trimEndMs=8000`, no custom trim UI.
- Overlong native-return test: if returned asset is still `>15000`, upload-intent is not called and user sees clear inline recovery.
- Upload-intent request-body test includes `clientRequestId`, `sourceBytes`, `sourceDurationMs`, `trimStartMs=0`, `trimEndMs=duration`.
- Edge validation tests for `source_size_out_of_range`, `source_duration_out_of_range`, `trim_over_duration`, permission rejection, and successful intent.

## Implementation Contract If Mingla Chooses The Proposed Native-Trim Flow

This is the smallest safe contract consistent with the user's desired flow:

1. Tap Video opens a video-only picker with native editing enabled where supported.
2. The picker may use `videoMaxDuration: 15` as a hint, but the app must not trust it blindly.
3. After picker returns, the app logs and validates the returned exported asset:
   - `duration` is finite and `0 < duration <= 15000`;
   - `fileSize` is positive if provided;
   - `uri` exists;
   - MIME/file extension may be MOV or MP4 because Cloudinary normalizes the public derivative.
4. If the returned asset is valid, call upload-intent with:
   - `sourceDurationMs = returnedDuration`;
   - `trimStartMs = 0`;
   - `trimEndMs = returnedDuration`;
   - no custom trim offset from Mingla UI.
5. Cloudinary receives the already-trimmed source and only compresses/transcodes to browser-safe MP4.
6. If native editing returns an over-15-second asset, upload-intent is not called. The user sees a precise inline failure, or the app explicitly offers the old provider-trim fallback as a separate path.
7. The implementation report must include real-device proof for iOS and Android, because Expo's local implementation does not prove a universal 15-second library trim guarantee.

## What To Probe Next At Runtime

For the next failed video attempt, capture these exact logs:

1. `[CreatorStep4Cover] picked cover asset`
2. `[CreatorStep4Cover] upload-intent-start`
3. `[eventCoverVideoProcessingService] upload-intent-request`
4. Either:
   - `[eventCoverVideoProcessingService] upload-intent-ready`, or
   - `[eventCoverVideoProcessingService] upload-intent-edge-error`, or
   - `[eventCoverVideoProcessingService] upload-intent-rejected`
5. Supabase Edge Function logs for the same `requestId`.

Interpretation:

| Last observed stage | Root-cause zone |
| --- | --- |
| No `upload-intent-start` | Picker/validation/auth-ready guard before Edge |
| `upload-intent-request`, no Edge `received` | Supabase invoke/session/network before function body |
| Edge `auth_failed` | Supabase JWT/session token missing or invalid |
| Edge `provider_not_configured` | Cloudinary env/secrets not visible to deployed function |
| Edge `event_id_invalid_uuid` / `brand_id_invalid_uuid` | Client passed local/stale ID instead of server UUID |
| Edge `source_size_out_of_range` | Returned asset size missing/zero or exceeds 500 MB |
| Edge `source_duration_out_of_range` | Returned asset duration missing/zero or exceeds 5 minutes |
| Edge `trim_range_rejected` | Client sent bad trim offsets |
| Edge `permission_rejected` | User lacks event-manager role for event/brand |
| Edge `job_insert_failed` | DB/schema/RLS/service-role/job-table issue |
| `upload-intent-ready`, then source upload fails | Cloudinary upload/signature/form-data/file URI issue |
| Source upload succeeds, status fails | Cloudinary webhook/processing/status/apply issue |

## Verification Run

Attempted:

- `npm run test -- --runInBand ...` in `mingla-business` failed because the app has no generic `test` script.
- `npm run test:orch-0770` passed. This proves current ORCH-0770 static guard and TypeScript are clean, but it also preserves the current app-owned processing contract rather than the proposed native-trim flow.

## Bottom Line

The proposed UX flow is a product-direction change, not the current implementation. The current code intentionally avoids native trim and uses Cloudinary/provider-side trim with a custom Mingla trim panel.

For the specific blocker where even an 8-second video shows "could not prepare video upload", the failure is concentrated before source upload and before Cloudinary processing. The next decisive step is not more guessing about trim; it is one runtime attempt with deployed upload-intent diagnostics and a matched `requestId`.

