# IMPLEMENTATION REWORK ORCH-0766C - Event Cover Media Runtime Root Cause Fix

> Date: 2026-05-09
> Mode: Implementor
> Status: implemented and verified by automated gates
> Source: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0766C_EVENT_COVER_MEDIA_RUNTIME_ROOT_CAUSE_FIX.md`

## Summary

Fixed the proven iOS format mismatch in the Mingla Business event-cover flow.

- Image/GIF picker now requests iOS compatible asset representation while keeping `allowsEditing: false` and `quality: 1` for GIF-safe picking.
- Event-cover videos now accept iOS MOV/QuickTime as supported video media.
- 15-second video enforcement remains independent of file type: MP4, MOV, and WebM all fail before upload when returned duration is over 15 seconds.
- User-facing copy now truthfully lists `MP4, MOV, or WebM` where video formats are described.
- Regression tests now encode HEIC-compatible picker configuration and iOS MOV/QuickTime acceptance.

## Files Changed

- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
  - Added `preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible` to the image/GIF picker.
  - Updated unsupported-video and unknown-duration copy to include MOV.

- `mingla-business/src/utils/eventCoverMediaRules.ts`
  - Added `.mov`, `.qt`, and `video/quicktime` as supported video types.
  - Added QuickTime byte sniffing for `ftypqt  `.
  - Removed MOV/QuickTime from unsupported video rejection.
  - Updated cover-upload guidance and validation copy to include MOV.

- `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`
  - Added MOV/QuickTime classification, extension, sniffing, upload, and duration-limit regression coverage.
  - Replaced the old "reject MOV" expectation with "accept <=15s MOV and reject >15s MOV before upload."

- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
  - Added source-level guard for iOS compatible image picker representation.
  - Updated copy assertions for MOV support.

## Video Strategy Chosen

Chosen strategy: **accept MOV/QuickTime for event cover videos**.

Reason:

- The forensic proof showed Expo ImagePicker's iOS edit path returns `.mov`.
- The alternative, deterministic MP4 trim/export, would require a native processing/export dependency that was not authorized.
- Existing `EventCoverMedia` renders video URLs through the shared video renderer and public URL verification already accepts `video/*` content types.

No new dependency was introduced.

## User Impact

After this fix:

- Normal iPhone photos should no longer fail simply because iOS provided HEIC/current representation; the picker asks for a compatible representation.
- Short iPhone videos returned as MOV/QuickTime are valid cover videos.
- Over-15-second videos still fail before upload, including MOV.
- The UI copy no longer tells users MOV is unsupported.
- Existing successful media upload, verification, persistent render-error, replace, and remove behavior remains intact from the prior ORCH-0766C work.

## Verification

Automated gates run from `mingla-business/`:

```text
/opt/homebrew/bin/npm run test:orch-0758a -- --runInBand
PASS - 6 suites, 53 tests
```

```text
/opt/homebrew/bin/npm run test:orch-0763 -- --runInBand
PASS - 7 suites, 53 tests
```

```text
/opt/homebrew/bin/npx tsc --noEmit
PASS
```

```text
/opt/homebrew/bin/npx eslint src/components/event/CreatorStep4Cover.tsx src/utils/eventCoverMediaRules.ts src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/__tests__/eventCoverMedia.test.ts
PASS
```

```text
git diff --check
PASS
```

Note: Jest emitted the existing Watchman recrawl warning. Tests still passed.

## Manual Runtime QA Required

Run on the current iOS simulator at event creator Step 4:

1. Pick the simulator HEIC photo `IMG_0006.HEIC`.
   - Expected: no JPEG/PNG/WebP/GIF rejection toast.
   - Expected: upload verifies, cover preview updates, hue fallback no longer remains.

2. Pick a JPEG/PNG image.
   - Expected: cover preview updates.

3. Pick a GIF.
   - Expected: picker path remains GIF-safe; preview/upload succeeds if platform returns GIF.

4. Pick or trim an iOS video that returns MOV and is <=15 seconds.
   - Expected: no MOV/QuickTime rejection toast.
   - Expected: cover preview renders as video after upload verification.

5. Pick or trim a MOV/MP4/WebM video that returns >15 seconds.
   - Expected: `Cover videos must be 15 seconds or shorter...`
   - Expected: no storage upload occurs and previous cover remains unchanged.

6. Reopen the draft.
   - Expected: uploaded `coverMediaUrl`/`coverMediaType` still hydrate and render.

## Residual Risk

- The compatible-image picker path is validated by code contract/tests, but still needs live simulator confirmation with `IMG_0006.HEIC`.
- MOV rendering is accepted by the app contract and public URL verifier, but the tester must confirm `expo-video` playback in the simulator with a real uploaded MOV.
- The current native picker UI is still not a deterministic custom 15-second trimming editor. The app enforces 15 seconds after return. A true frame-accurate in-app trimmer/exporter remains a future dependency/product decision.

