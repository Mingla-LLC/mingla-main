# INVESTIGATION ORCH-0766C - Event Cover Media Pipeline Demolition Audit

> Date: 2026-05-09
> Mode: Forensics / Investigate
> Surface: `mingla-business` event cover media picker, upload, preview, storage, and render path
> Verdict: FAIL - base custom cover media is not runtime-ready

## Executive Summary

The repeated failures are not one bug. They are a cluster around a brittle media pipeline:

1. The app uploads React Native `Blob` objects to Supabase Storage even though the installed Supabase Storage client explicitly says React Native `Blob`, `File`, and `FormData` uploads do not work as intended and recommends `ArrayBuffer` from base64 instead.
2. The app validates picked media using only `mimeType` and `fileName`, while Expo ImagePicker assets can have missing `mimeType`/`fileName` and still provide `type` and `uri`. That explains the operator seeing the `Choose an image, GIF, or short MP4/WebM video.` toast after choosing an image.
3. The app stores/keeps a historical 0-byte public image object in draft state. The current Home card still falls back to hue because that URL downloads as 0 bytes.
4. The video UX promises too much and guides too little: code enforces 15 seconds, picker `videoMaxDuration` is not a reliable library-video trim path, and over-limit videos have no in-app recovery path.
5. Automated gates pass because they mock the browser-style happy path and do not encode the React Native Supabase upload contract, missing picker metadata, or mounted media-render behavior.

This is why narrow patches have felt circular. The code can pass tests while the device path still fails.

## User Promise

As an organiser, I should be able to choose an event cover image, GIF, or short video from my library, see it immediately in Step 4, keep it through autosave/reopen/publish, and receive a precise recovery path when Mingla cannot use the file.

## Current Runtime Symptoms

Operator tested the current build after the ORCH-0766B zero-byte guard rework:

- Image upload does not show the uploaded image in preview.
- Cover only visibly changes when a different hue is selected.
- Image upload path shows a toast to choose an image/GIF/short video.
- A video under roughly 30 seconds can reach `cover could not be displayed`.
- A longer video is rejected as too long.
- There is no way to trim or recover in-app.

Additional persisted evidence from the signed-in simulator:

- Draft `Party Like it’s 99` still has `coverMediaUrl` and `coverMediaType: "image"`.
- Home card renders the hue fallback.
- The saved URL returns:

```text
HTTP/2 200
content-type: image/png
content-length: 0
etag: "d41d8cd98f00b204e9800998ecf8427e"
downloaded size: 0 bytes
```

## Historical Context

Relevant prior chain:

- ORCH-0766 found custom event cover upload existed in code, but runtime proof remained missing.
- ORCH-0766B proved video/image runtime failures and asked for a reliability rework.
- The first rework improved picker options, copy, public URL verification, render-error callbacks, and tests.
- Tester then proved a stored uploaded image object was a 0-byte PNG.
- The second rework added empty local blob rejection and zero-byte public URL rejection.
- The operator's latest runtime evidence shows the flow still fails for fresh image and video attempts.

Important correction: ORCH-0766B's zero-byte guard remains valid, but it is not sufficient. It catches one symptom after local read/upload. It does not fix the native file-read/upload body strategy or the picker metadata classifier.

## Findings

### P0/S1 Confirmed Bug - React Native Blob Upload Is The Wrong Supabase Storage Body

Classification: confirmed bug / production-readiness blocker

Six-field proof:

- File/line: `mingla-business/src/services/eventCoverMediaService.ts:86-148`.
- Exact code: the service does `const response = await fetch(input.uri)`, `const blob = await response.blob()`, then `.upload(storagePath, blob, { contentType, upsert: true })`.
- Current behavior: runtime can create/retain a public object that is `HTTP 200 image/png` but `content-length: 0`, so the image cannot render and the UI falls back to hue.
- Expected behavior: the upload body sent to Supabase must contain the actual selected file bytes, and upload success must never produce or accept an empty public object.
- Causal chain: Expo picker local URI -> React Native `fetch(uri).blob()` -> Supabase `.upload(..., Blob)` -> Storage object can be empty/corrupt in RN -> public verifier/render path fails -> user sees hue or `display_failed`.
- Verification step: installed Supabase Storage client documents the exact constraint at `mingla-business/node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts:181-198`: upload examples use `ArrayBuffer` from base64 and the remark says React Native `Blob`, `File`, or `FormData` do not work as intended.

Impact:

- Explains the historical zero-byte PNG.
- Explains image upload appearing to succeed while the UI still renders hue.
- Can also explain under-limit video upload reaching `display_failed`.
- Also affects `mingla-business/app/account/edit-profile.tsx:163-171`, which uses the same Blob upload pattern for profile photos.

Fix direction:

- Stop uploading `Blob` in React Native.
- Read local file bytes through an Expo-safe file API and upload `ArrayBuffer`/`Uint8Array` to Supabase Storage with explicit content type.
- Keep zero-byte public URL checks as a second safety net.

### P1 Confirmed Bug - Picker Classification Ignores `asset.type` And URI

Classification: confirmed bug / UX-breaking validation bug

Six-field proof:

- File/line: `mingla-business/src/components/event/CreatorStep4Cover.tsx:137-145` passes only `uri`, `mimeType`, `fileName`, `fileSize`, and `durationMs`; it logs but does not pass `asset.type`.
- File/line: `mingla-business/src/utils/eventCoverMediaRules.ts:112-140` classifies only from MIME and filename extension.
- Current behavior: operator can choose an image and see the toast `Choose an image, GIF, or short MP4/WebM video.`
- Expected behavior: a picked Expo image asset should classify as image even if `mimeType` or `fileName` is missing, as long as the picker says `type: "image"` or the URI/bytes prove an image.
- Causal chain: ImagePicker may return `mimeType` or `fileName` as missing; installed types confirm `fileName?: string | null`, `mimeType?: string`, `type?: "image" | "video" | ... | null`; classifier ignores `asset.type` and URI; mediaType becomes `null`; `unsupported_type` is thrown; Step 4 maps it to the choose-media toast.
- Verification step: add a test where `assetType: "image"`, `mimeType: null`, `fileName: null`, and `uri: file:///.../cover` still classifies by asset type/byte sniff instead of throwing unsupported.

Impact:

- Explains the image-selection toast without requiring storage upload to happen.
- Makes the app brittle under limited permissions or platform-specific metadata gaps.

Fix direction:

- Introduce a normalized asset model that includes `asset.type`, URI extension, and byte sniffing.
- Treat picker MIME/filename as hints, not the sole truth.

### P1 Confirmed UX Gap - Video Limit Is 15 Seconds, But The UI Does Not Offer A Real Trim/Recovery Path

Classification: confirmed UX gap / product-contract ambiguity

Six-field proof:

- File/line: `mingla-business/src/utils/eventCoverMediaRules.ts:3-6` sets `EVENT_COVER_MAX_VIDEO_DURATION_MS = 15_000` and copy says 15 seconds.
- File/line: `mingla-business/src/components/event/CreatorStep4Cover.tsx:119-124` uses `mediaTypes: ["images", "videos"]`, `allowsEditing: false`, and `videoMaxDuration: 15`.
- Local Expo ImagePicker types at `mingla-business/node_modules/expo-image-picker/src/ImagePicker.types.ts:515-522` describe `videoMaxDuration` as maximum duration for video recording, with platform-dependent behavior. This is not a guaranteed library-video trim feature.
- Current behavior: operator sees over-limit video rejected but has no way to trim; under-30-second video can still fail as display failed.
- Expected behavior: the app should either provide a tested trim path or give precise pre-pick/post-failure recovery copy.
- Causal chain: library-selected video can exceed 15s; app does not edit/trim; validation rejects; no recovery UI beyond a toast; under-limit upload can still fail because the storage body is corrupt or the renderer cannot play it.
- Verification step: runtime matrix with MP4 <=15s, MP4 16-30s, MOV/QuickTime, and >30s fixtures.

Impact:

- Organisers cannot complete a common phone-video workflow.
- The user sees an arbitrary rejection, not a path forward.

Fix direction:

- Keep or explicitly change the product limit. Current code says 15 seconds; for launch, preserve 15 unless product decides otherwise.
- Split image/GIF and video picking if needed so video can use a video-specific trim/edit strategy without breaking GIF preservation.
- If native trimming is not implemented now, copy must say exactly: use MP4/WebM, 15 seconds max, 30 MB max, trim in Photos/your editor and try again.

### P1 Confirmed Bug - Uploaded Media Render Failure Still Looks Like Hue Success

Classification: confirmed bug / no-silent-failure violation

Six-field proof:

- File/line: `mingla-business/src/components/ui/EventCoverMedia.tsx:122-143` calls `onMediaError` and then sets `hasMediaError=true`.
- File/line: `mingla-business/src/components/ui/EventCoverMedia.tsx:145-158` renders hue fallback when `presentation === "fallback"`.
- Current behavior: Home card shows hue even though draft has `coverMediaUrl`; Step 4 may toast `Uploaded, but this cover could not be displayed.`
- Expected behavior: a failed media renderer should show a persistent, visible error state in the cover area, not a normal-looking hue tile.
- Causal chain: media URL exists -> renderer fails -> state flips to fallback -> UI looks like ordinary hue fallback -> organiser cannot tell whether they selected hue or media failed.
- Verification step: mounted component test should simulate image/video error and assert visible error affordance plus Replace/Remove remains available.

Impact:

- The current fallback is too visually quiet for a failed upload.
- It makes debugging and user recovery harder.

Fix direction:

- Add a cover media display-error state in Step 4 and card surfaces where editing is available.
- Keep fallback visual if needed, but overlay/inline the error and keep Replace/Remove available.

### P1 Confirmed Test Gap - Current Gates Pass While Runtime Fails

Classification: confirmed test gap

Evidence:

- `npm run test:orch-0758a -- --runInBand`: PASS, 6 suites / 45 tests.
- `npm run test:orch-0763 -- --runInBand`: PASS, 7 suites / 53 tests.
- Current tests mock `blob()` and storage upload success; they do not encode Supabase's React Native ArrayBuffer requirement.
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts:47-63` uses source-string checks for limit copy and render-error callback, not mounted runtime behavior.

Impact:

- Implementations can pass all existing media gates while remaining broken for real organisers.

Fix direction:

- Add tests for missing picker metadata, asset type/URI/byte sniff fallback, RN upload body type, zero-byte body rejection, and mounted render-error UI.
- Add a manual runtime QA gate that cannot be replaced by static tests.

## False Leads Eliminated Or Downgraded

- **Storage bucket absence:** downgraded. The `event_covers` bucket migration exists and is remote-applied in prior evidence. The persisted object is reachable publicly, just empty.
- **Draft state never updates:** downgraded for the existing broken object. AsyncStorage contains `coverMediaUrl` and `coverMediaType: "image"`.
- **Hue selection clears media:** not proven. Current hue handler only updates `coverHue` at `CreatorStep4Cover.tsx:47-50`; it does not clear media. The visible hue change is a fallback/render-state symptom, not intended media removal.
- **ORCH-0766B zero-byte guard was wrong:** false. The guard is valid but too late/narrow. It should remain.

## Blast Radius

| Surface | Risk |
|---|---|
| Event creator Step 4 | Primary failure: picker validation, upload, preview, and recovery are unreliable. |
| Home draft card | Currently renders hue because saved public object has zero bytes. |
| Preview / Step 7 | Uses shared `EventCoverMedia`; bad URLs or video failures carry forward. |
| Publish / public event page | `cover_media_url/type` can carry bad media unless upload path is fixed before state update. |
| Checkout/order/event list | Shared render component means failures show hue or quiet fallback. |
| Published event edit | Uses same Step 4 body; save path can preserve broken media semantics unless upload body is fixed. |
| Profile photo | Separate code path uses the same RN Blob upload anti-pattern and has no confirmed bucket migration in earlier ORCH-0766 evidence. |
| Brand/profile/ticket media expansion | Must not proceed until the shared upload primitive is robust. |
| Giphy/Pexels | Provider media should use URL-copy/import or external URL persistence, but should not build on the current custom upload path until this is fixed. |

## Production Readiness

Not ready.

Missing:

- React Native-safe byte upload.
- Robust picker asset normalization.
- Clear video trim/recovery behavior.
- Mounted render-error tests.
- Runtime QA across image, GIF, short video, over-limit video, MOV/QuickTime, remove cover, reopen draft, Home card, and publish/edit.

## Required Next Step

Use `Mingla_Artifacts/specs/SPEC_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md` as the implementation contract.

Do not resume Giphy/Pexels, brand media, profile media, or ticket media until event cover custom upload passes independent runtime QA.

