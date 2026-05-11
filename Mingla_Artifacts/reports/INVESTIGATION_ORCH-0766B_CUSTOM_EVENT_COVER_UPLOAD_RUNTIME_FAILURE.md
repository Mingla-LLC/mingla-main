# INVESTIGATION ORCH-0766B - Custom Event Cover Upload Runtime Failure

Date: 2026-05-09  
Mode: FORENSICS / INVESTIGATE  
Surface: `mingla-business` event creator cover upload  
Runtime evidence source: operator manual test in latest build

## Verdict

FAIL - event cover upload is not production-ready.

The static wiring exists, the storage migration exists, and the ORCH-0758A tests pass, but the real device path is failing:

- Video upload fails.
- Image upload appears to pass, but the preview still renders the hue fallback instead of the uploaded image.

This is no longer a "needs tester fixture" situation. The operator supplied runtime evidence that the implemented path regresses in real use.

## User Promise

As a business organiser, I should be able to open event creator Step 4, upload a custom image, GIF, or short video as the event cover, immediately see that selected cover in the wizard, and carry it into preview/publish/public surfaces.

## Current Runtime Behavior

Operator-tested behavior:

1. Uploading a video fails.
2. Uploading an image reports success or appears to pass.
3. After image upload, the cover area still shows the generated hue/art fallback instead of the uploaded image.

## Evidence Chain

### Picker and upload entry point

`mingla-business/src/components/event/CreatorStep4Cover.tsx:79-141`

- Requests photo-library permission.
- Launches Expo ImagePicker with `mediaTypes: ImagePicker.MediaTypeOptions.All`.
- Uses the first selected asset.
- Calls `uploadEventCoverMedia(...)` with:
  - `asset.uri`
  - `asset.mimeType`
  - `asset.fileName`
  - `asset.fileSize`
  - `durationMs: typeof asset.duration === "number" ? asset.duration : null`
- On success, updates local draft:
  - `coverMediaUrl: upload.publicUrl`
  - `coverMediaType: upload.mediaType`

### Upload service

`mingla-business/src/services/eventCoverMediaService.ts:61-109`

- Validates before reading the asset.
- Fetches `asset.uri`.
- Converts it to a blob.
- Validates again using blob fallback metadata.
- Uploads to Supabase storage bucket `event_covers`.
- Returns `getPublicUrl(storagePath).data.publicUrl`.

### Media validation

`mingla-business/src/utils/eventCoverMediaRules.ts:33-105`

Accepted media:

- Images: JPEG, JPG, PNG, WebP
- GIFs: GIF
- Videos: MP4, WebM

Rejected media:

- MOV / QuickTime
- HEIC / HEIF
- Any video where `durationMs` is not a number

Important: the current code throws `"Cover videos must include duration and be 15 seconds or shorter."` when a video has no duration metadata.

### Preview rendering

`mingla-business/src/components/ui/EventCoverMedia.tsx:100-150`

- Resets `hasMediaError` when `mediaUrl` changes.
- If `mediaUrl` is missing or `hasMediaError` is true, renders hue fallback.
- For image/GIF, renders React Native `<Image source={{ uri: mediaUrl }} />`.
- On image load error, silently sets `hasMediaError` to true and reverts to hue.

This exactly matches the operator symptom: upload can "pass", but if the returned public URL cannot be loaded by `<Image>`, the UI silently shows hue again.

### Storage/RLS contract

`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:4-23`

- Creates public bucket `event_covers`.
- Allows MIME types:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `image/gif`
  - `video/mp4`
  - `video/webm`
- Caps file size at 30 MB.

`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:30-97`

- Public can read event covers.
- Event managers can insert/update/delete objects under `{brandId}/{eventId}/{file}` only when the caller has effective event-manager rank for that brand.

### Persistence path

`mingla-business/src/utils/serverDraftEventMapper.ts:272-322`

- Draft insert/update sends `cover_media_url` and `cover_media_type`.

`mingla-business/src/utils/serverDraftEventMapper.ts:331-388`

- Server draft hydration reads `cover_media_url` and `cover_media_type` back into local draft state.

So if the image URL is valid and the draft state updates, the wizard should be able to show the image. The fact that the hue remains means either:

1. The local draft never receives/keeps `coverMediaUrl`, or
2. The public URL is present but `<Image>` fails to load it and silently trips the fallback.

Given the upload "passes", the strongest current suspect is #2, but #1 still needs one runtime log to eliminate.

## Findings

### F1 - Confirmed bug: real videos can fail before upload

Severity: P1  
Classification: confirmed bug / production-readiness failure

Evidence:

- `CreatorStep4Cover.tsx:120-121` converts missing `asset.duration` to `null`.
- `eventCoverMediaRules.ts:85-93` rejects any video when `durationMs` is not a number.
- `eventCoverMediaRules.ts:52-59` accepts only MP4/WebM, not MOV/QuickTime.
- Existing test `eventCoverMediaService.test.ts:43-50` explicitly asserts that videos without duration metadata must be rejected.

Current behavior:

If the native picker returns a playable video with missing duration metadata, the app rejects it. If iOS returns a `.mov` / `video/quicktime` video, the app rejects it as unsupported.

Expected behavior:

A user-selected short video from the phone library should either upload successfully or fail with an accurate, actionable reason. Normal iOS video formats and metadata variability should not become unexplained upload failure.

Causal chain:

Picker asset -> `duration` missing or MIME/file extension not MP4/WebM -> validator throws before Supabase upload -> user sees upload failure.

Verification step:

Instrument one runtime selection and record `asset.mimeType`, `asset.fileName`, `asset.fileSize`, `asset.duration`, and thrown `EventCoverMediaError.code`. Then test:

- iOS camera roll `.mov` / `video/quicktime`
- MP4 with duration
- MP4 with missing duration
- Video over 15 seconds

### F2 - Likely bug: successful image upload falls back because rendered public URL fails to load

Severity: P1  
Classification: likely bug / user-visible regression

Evidence:

- `CreatorStep4Cover.tsx:123-127` updates the draft with `upload.publicUrl` after successful upload.
- `EventCoverMedia.tsx:145-150` renders images with `<Image source={{ uri: mediaUrl }} />` and switches to fallback on `onError`.
- `resolveEventCoverMediaPresentation` returns fallback when `hasMediaError` is true (`eventCoverMediaRules.ts:118-120`).
- The operator reports image upload "passes" but the hue remains.

Current behavior:

The app can show a successful upload state while hiding the real failure behind the hue fallback.

Expected behavior:

After an image upload succeeds:

- Step 4 cover preview should show the image.
- The button should switch from `Upload cover` to `Replace cover`.
- If the image URL fails to load, the user should see a clear error and the app should log the exact failed URL/content metadata.

Causal chain:

Upload returns public URL -> local state likely receives URL -> `<Image>` attempts load -> load fails -> `hasMediaError=true` -> hue fallback renders -> user thinks upload did not work.

Unproven branch:

If runtime logs show `draft.coverMediaUrl` remains `null` after upload, the cause moves to state/autosave overwrite instead of image loading.

Verification step:

During one image upload, log:

- selected `asset.uri`
- selected `asset.mimeType`
- selected `asset.fileName`
- returned `upload.publicUrl`
- returned `upload.storagePath`
- returned `upload.mediaType`
- `draft.coverMediaUrl` immediately after update
- `<Image onError>` native event
- HTTP status and content-type from the returned public URL

Then inspect Supabase:

- `storage.objects.name`
- `storage.objects.metadata->>'mimetype'`
- object size
- `events.cover_media_url`
- `events.cover_media_type`

### F3 - Confirmed production-hardening gap: image/video render failure is silent

Severity: P1/P2  
Classification: production-hardening gap / UX gap

Evidence:

- `EventCoverMedia.tsx:145-150` handles `<Image onError>` only by setting `hasMediaError`.
- `EventCoverMedia.tsx:136-143` handles video error the same way.
- There is no user-visible failure copy and no diagnostic logging.

Impact:

The UI can make a failed render look like a successful fallback choice. That is exactly the confusion the operator saw: "it passes, but I still see the hue."

Expected behavior:

Upload success and render success must be separate states. If render fails, show a clear inline error or toast and log the URL/asset metadata.

### F4 - Confirmed test gap: current tests pass while the runtime path fails

Severity: P1/P2  
Classification: test gap

Evidence:

- `npm run test:orch-0758a -- --runInBand` passes: 6 suites / 35 tests.
- `eventCoverMediaService.test.ts:43-50` proves the old missing-duration rejection behavior.
- `eventCoverMedia.test.ts:5-37` tests pure presentation resolution, not mounted image/video render behavior.
- There is no test covering Supabase public URL accessibility or React Native image load failure after upload.

Impact:

The regression is invisible to the current automated gate.

Expected tests:

- Validator tests for Expo/iOS metadata variants.
- Upload service tests for content type/path/returned public URL.
- Component tests proving uploaded image success renders media and image error shows diagnosable failure.
- Native/manual QA gate with real image, GIF, MP4, MOV/QuickTime, oversized file, over-duration video, and public-page reload.

### F5 - Confirmed API drift risk: picker call differs from current repo pattern and current Expo docs

Severity: P2  
Classification: production-hardening gap

Evidence:

- `mingla-business/package.json:37-47` uses Expo SDK 54 and `expo-image-picker ~17.0.11`.
- `CreatorStep4Cover.tsx:105-110` uses `ImagePicker.MediaTypeOptions.All`.
- Existing app-mobile camera service uses string media types: `mediaTypes: 'images'` and `mediaTypes: 'videos'` (`app-mobile/src/services/cameraService.ts:58-63`, `98-103`, `138-143`).
- Current Expo ImagePicker docs list `mediaTypes` as `MediaType | MediaType[] | MediaTypeOptions`, defaulting to `'images'`, and show asset fields like `fileName`, `fileSize`, `mimeType`, `type`, and `uri` can be nullable/optional depending on platform/provider.

Impact:

The business app cover picker is using an older/deprecated-looking pattern while another surface in the repo has already moved to literal media-type strings. This is not proven as the sole runtime failure, but it increases risk around video picker behavior.

## Root Cause Summary

Most likely there are two separate defects:

1. Video failure is caused by over-strict client validation against real native picker metadata and format output.
2. Image "success but hue remains" is caused by the returned URL failing render, with `EventCoverMedia` silently swallowing the load error and falling back to hue.

The image path still needs one runtime URL/asset log to choose between "bad/non-loadable public URL" and "draft state is overwritten back to null." The current evidence favors the non-loadable render path because upload passes and `EventCoverMedia` is explicitly designed to hide render errors behind hue.

## What Needs To Change

### Required implementation contract

1. Add temporary or permanent media-upload diagnostics in dev builds:
   - selected picker asset metadata,
   - upload result,
   - public URL status/content type,
   - image/video render error event.

2. Fix video acceptance rules:
   - Support the actual formats returned by iOS/Expo picker or transcode/copy them into supported storage format before upload.
   - Do not reject videos solely because duration metadata is absent unless the app can independently determine duration or gives a precise user-facing reason.
   - Keep the 15-second product limit, but enforce it with reliable metadata or a safe fallback flow.

3. Fix image render failure:
   - Confirm returned public URL is accessible immediately after upload.
   - Preserve accurate content type and file extension.
   - Surface an error when uploaded media cannot render.
   - Avoid presenting hue fallback as if upload succeeded.

4. Add tests that fail under the current runtime bugs:
   - video with missing duration metadata,
   - QuickTime/MOV or documented chosen strategy,
   - image upload returns URL but renderer errors,
   - successful upload immediately renders media instead of hue,
   - draft autosave/hydration does not clear `coverMediaUrl`.

5. Retest on native device/simulator after implementation:
   - image JPEG/PNG/WebP,
   - GIF,
   - MP4 <= 15s,
   - MOV/QuickTime or expected user-facing rejection,
   - public event page after publish,
   - cold app restart / draft reload.

## Production Readiness

Not ready.

Do not expand this feature into Giphy/Pexels/brand/profile media until event cover upload is proven stable. Provider search will reuse the same preview/render/persist path, so it will inherit the current failure unless this is fixed first.

## Recommended Next Lifecycle Step

Send this to `$orchestrator` to produce a focused implementor rework prompt for ORCH-0766B.

The rework should be narrow: fix event cover upload/render reliability first. Brand/profile/provider expansion should remain paused until this path passes runtime QA.
