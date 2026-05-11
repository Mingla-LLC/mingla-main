# INVESTIGATION REWORK ORCH-0766C - Event Cover Media Runtime Root Cause

> Date: 2026-05-09
> Mode: Forensics / Runtime Probe
> Surface: `mingla-business` event creator Step 4 cover upload
> Verdict: FAIL - root cause proven in current code and installed Expo native picker source

## Executive Summary

The current custom cover flow fails because the app asks iOS/Expo for native media, then rejects the exact formats Expo returns.

This is not a storage mystery anymore.

1. **Images:** Expo ImagePicker defaults iOS library selection to the current/original asset representation. The simulator photo library contains `IMG_0006.HEIC`, and Expo's native fast path preserves original image files when `allowsEditing: false` and `quality: 1`. Our validator rejects HEIC/HEIF before upload, so the user sees `Choose a JPEG, PNG, WebP, or GIF.` and the cover stays as the hue fallback.
2. **Videos:** Our video path sets `allowsEditing: true`. Expo then uses the legacy iOS picker. Expo's installed native code copies the picked/edited video to a generated `.mov` file and reports MIME from that `.mov` extension. Our validator rejects MOV/QuickTime before upload, so even a short trimmed video can be rejected with the MP4/WebM/15-second toast.
3. **Trim:** `videoMaxDuration: 15` is not a reliable selected-video trim contract. Expo's own TypeScript docs define it as a recording maximum; on iOS with editing enabled the native picker limit is 10 minutes, not Mingla's 15 seconds. So the current code does not actually provide a guaranteed 15-second in-app trim flow.

## Runtime / Local Evidence

### Current Simulator State

- Booted simulator: `iPhone 17 Pro`, device id `17091E60-C3B6-4167-980D-60C348E177F6`.
- Installed app bundle id: `com.sethogieva.minglabusiness`.
- Active app screen verified by screenshot: Event creator Step 4, cover preview showing hue fallback and `Upload cover`.
- The simulator photo library contains an actual HEIC image:

```text
/Users/.../Media/DCIM/100APPLE/IMG_0006.HEIC
file: ISO Media, HEIF Image HEVC Main or Main Still Picture Profile
Photos.sqlite: ZFILENAME=IMG_0006.HEIC, ZUNIFORMTYPEIDENTIFIER=public.heic
```

### JS/System Log Probe

Apple unified logs for process `minglabusiness` showed taps/network activity but did not surface the React Native `console.info` payloads. That limits direct capture of the JS `picked cover asset` log without the Metro terminal stream, but the native picker source and simulator media database prove the format contract currently being violated.

## Confirmed Root Causes

### P0 Confirmed Bug - Image Picker Preserves HEIC, Validator Rejects HEIC

Classification: confirmed bug.

Six-field proof:

- **File/line:** `mingla-business/src/components/event/CreatorStep4Cover.tsx:192-196`.
- **Exact code:** image/GIF picker calls `launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 })` and does not set `preferredAssetRepresentationMode`.
- **Native source:** `mingla-business/node_modules/expo-image-picker/ios/ImagePickerOptions.swift:44` defaults `preferredAssetRepresentationMode` to `.current`.
- **Native source:** `mingla-business/node_modules/expo-image-picker/ios/MediaHandler.swift:123-150` has a fast path that copies the original image file when `!allowsEditing`, `quality >= 1`, and representation mode is `.current`.
- **Rejecting code:** `mingla-business/src/utils/eventCoverMediaRules.ts:75-78` marks `heic/heif` and `image/heic/image/heif` unsupported; `eventCoverMediaRules.ts:266-283` throws `unsupported_type` with `Choose a JPEG, PNG, WebP, or GIF.`.
- **Current behavior:** selecting the simulator HEIC photo reaches Mingla's unsupported-image branch before upload, so preview cannot update.
- **Expected behavior:** a normal phone photo should either be converted to JPEG by the picker/app or accepted through a supported media pipeline. It should not leave the organiser staring at the hue cover after picking a picture.
- **Causal chain:** Photos library HEIC -> Expo preserves current/original HEIC -> Mingla validates metadata/extension -> HEIC unsupported error -> toast -> no upload -> no preview update -> hue remains.
- **Verification step:** pick `IMG_0006.HEIC` from the current simulator library; the expected code path is `unsupported_type` with the JPEG/PNG/WebP/GIF copy.

### P0 Confirmed Bug - Video Picker/Edit Path Returns MOV, Validator Rejects MOV

Classification: confirmed bug.

Six-field proof:

- **File/line:** `mingla-business/src/components/event/CreatorStep4Cover.tsx:221-226`.
- **Exact code:** video picker calls `launchImageLibraryAsync({ mediaTypes: ["videos"], allowsEditing: true, quality: 1, videoMaxDuration: 15 })`.
- **Native source:** `mingla-business/node_modules/expo-image-picker/ios/ImagePickerModule.swift:94-98` routes `allowsEditing: true` to the legacy `UIImagePickerController`.
- **Native source:** `mingla-business/node_modules/expo-image-picker/ios/MediaHandler.swift:340-353` generates the video output URL with `.mov` and derives MIME type from that `.mov` extension.
- **Rejecting code:** `mingla-business/src/utils/eventCoverMediaRules.ts:77-78` marks `mov/qt` and `video/quicktime` unsupported; `eventCoverMediaRules.ts:285-292` throws `unsupported_type` with `Choose an MP4 or WebM video up to 15 seconds. MOV/QuickTime is not supported yet.`
- **Current behavior:** a short iOS edited video can still be rejected because the picker returns MOV/QuickTime, not because the user failed to trim correctly.
- **Expected behavior:** if Mingla asks the native picker to trim video in-app, the returned trimmed asset must be an accepted format or converted before validation/storage.
- **Causal chain:** user chooses Video -> Expo legacy picker/edit path -> Expo copies result to `.mov` -> Mingla validator sees MOV/QuickTime -> unsupported video toast -> no upload -> no preview.
- **Verification step:** choose any video through the current iOS video path; the generated `asset.uri`/`mimeType` path is expected to be MOV/QuickTime from Expo's native source.

### P0 Confirmed Bug - Current Trim UI Is Not A 15-Second Mingla Trim Contract

Classification: confirmed bug / UX contract failure.

Six-field proof:

- **File/line:** `mingla-business/src/components/event/CreatorStep4Cover.tsx:225` sets `videoMaxDuration: 15`.
- **Expo TypeScript source:** `mingla-business/node_modules/expo-image-picker/src/ImagePicker.types.ts:515-522` defines `videoMaxDuration` as maximum duration for video recording; on iOS with `allowsEditing` true, maximum duration is limited to 10 minutes.
- **Native source:** `mingla-business/node_modules/expo-image-picker/ios/ImagePickerModule.swift:131-143` sets `picker.videoMaximumDuration`, but only enforces a 600-second editing ceiling when editing is enabled.
- **Current behavior:** the user can go through a native edit/trim surface and still return an asset Mingla rejects as too long or unsupported.
- **Expected behavior:** when Mingla says 15 seconds max and offers in-app trim, the returned asset should be guaranteed or reprocessed into a <=15s supported cover, or the UI must accurately say native trimming is unavailable.
- **Causal chain:** Mingla relies on `videoMaxDuration: 15` -> Expo/iOS does not guarantee selected-library output is capped to 15s -> Mingla validator rejects after user effort -> product feels broken.
- **Verification step:** select a >15s library video and attempt native edit; current app must revalidate and may reject because no deterministic in-app 15s crop/export exists.

## What This Means In Plain Product Terms

The app currently says: "Pick a normal photo or video."

The phone replies: "Here is a normal iPhone photo/video."

Mingla replies: "I do not accept that format."

That is the core failure.

## Fix Contract

The implementation must do one of two honest things for each media type.

### Images

Required fix:

- Set iOS image picking to return a compatible representation when possible, for example `preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible`, or add an explicit HEIC-to-JPEG conversion path.
- Keep GIF preservation intact. Do not enable image editing for the Image/GIF picker because Expo documents that animated GIF preservation depends on `quality: 1` and `allowsEditing: false`.
- Add a regression test proving HEIC no longer produces the JPEG/PNG/WebP/GIF toast when the app can convert/request compatible output.
- If a HEIC still cannot be converted, the UI must say `iPhone HEIC photos are not supported yet. Choose a JPEG, PNG, WebP, or GIF.` But product expectation says this should be fixed, not merely messaged.

### Videos

Required fix:

- Stop relying on the current Expo ImagePicker edit output as an MP4/WebM source. It returns MOV on iOS.
- Either:
  - accept and render/store MOV/QuickTime for event covers, with Supabase verification and `EventCoverMedia` playback proof; or
  - add a real video conversion/trim/export path that outputs accepted MP4 and enforces <=15s.
- Do not call the current `allowsEditing: true` / `videoMaxDuration: 15` setup a fixed trimmer. It is not.
- If accepting MOV is chosen, update allowed MIME/extension lists, storage content type, copy, tests, and renderer QA.
- If MP4-only is chosen, a dependency/native rebuild decision is required because Expo ImagePicker alone does not provide the necessary deterministic MP4 trim/export contract in this codebase.

### Preview State

Required fix:

- The cover preview must update only after upload + URL verification succeeds.
- Rejected formats must not say "uploaded"; they should show exact cause.
- Render failures must keep a persistent inline error and leave Replace/Remove available.

## Required Tests

Add or update tests so these exact regressions fail:

- iOS HEIC/current-representation image asset does not produce generic unsupported image toast after the chosen fix.
- Image/GIF picker config uses compatible output or conversion while preserving GIF behavior.
- iOS video edit output with `.mov`/`video/quicktime` follows the chosen product strategy:
  - accepted and rendered, or
  - converted to accepted MP4, or
  - blocked before pretending in-app trim is available.
- `videoMaxDuration: 15` is not the only enforcement mechanism for the 15-second limit.
- An 8-second iOS MOV does not get rejected with a misleading "too long" mental model; it is either supported or receives exact MOV/QuickTime copy.

## Next Handoff

Send this report to `$implementor`.

The implementor should not patch around the toast copy only. The fix must change the format contract:

- image: compatible representation or conversion;
- video: accept MOV or real MP4 trim/export;
- tests: encode both iOS native return formats.

