# IMPLEMENTATION ORCH-0776A — Event Cover Upload Progress and Honest Processing

Date: 2026-05-10
Owner: implementor
Verdict: IMPLEMENTED

## Scope

Implemented the ORCH-0776A rework for event cover video upload visibility:

- show real client-side upload progress while the trimmed video is being sent to Cloudinary
- stop implying Cloudinary compression has a measurable percentage when Cloudinary does not expose one
- preserve provider error details for failed source uploads
- add a regression guard and service test for the new progress contract

Out of scope for this slice:

- Cloudinary server-side processing percentage, because Cloudinary does not expose granular eager transformation progress
- new edge functions or schema changes
- Giphy/Pexels, brand/profile/ticket media work

## Files Changed

- `mingla-business/src/services/eventCoverVideoProcessingService.ts`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
- `mingla-business/package.json`
- `.github/scripts/strict-grep/orch-0776a-video-upload-progress-honesty.mjs`

## What Changed

### Real Upload Progress

`uploadEventCoverVideoSource` now uses Expo FileSystem upload tasks for the Cloudinary source upload instead of plain `fetch(FormData)`.

That gives the app real byte progress from:

- `totalBytesSent`
- `totalBytesExpectedToSend`

The service emits:

- `phase: "source_upload"`
- `bytesSent`
- `bytesTotal`
- `percent`

The percent is clamped between 0 and 100.

### Fallback Upload Path

If Expo FileSystem upload task setup fails unexpectedly, the service falls back to XHR multipart upload, which also supports upload progress events.

Provider failures still surface as `source_upload_failed` with Cloudinary's returned error detail where available.

### Honest UI Copy

Step 4 now separates:

- `Uploading video... 37%` with a visible progress bar during source upload
- `Upload complete. Compressing browser-safe video...` while Cloudinary processes the uploaded video

There is no fake compression percentage.

### Regression Guard

Added `test:orch-0776a`, which runs:

1. strict grep guard for no fake processing percent and required upload progress primitives
2. focused Jest test for event cover video processing service

## Verification

Passed:

```bash
npm run test:orch-0776a
```

Result:

- strict guard passed
- `eventCoverVideoProcessingService.test.ts` passed
- 7 tests passed

Passed:

```bash
npx tsc --noEmit
```

Passed:

```bash
git diff --check
```

## User Impact

When a user uploads a video cover:

1. Native picker returns the trimmed video.
2. Mingla requests a Cloudinary upload intent.
3. The app shows actual upload progress while the file is sent.
4. Once upload reaches 100%, the app switches to honest processing copy.
5. If Cloudinary rejects the upload, the app keeps the provider error rather than hiding it behind a generic fake-processing state.

## Remaining Manual Gate

Tester should verify on simulator/device:

- select a valid under-15s video
- confirm progress bar moves during upload
- confirm copy switches to `Upload complete. Compressing browser-safe video...`
- confirm processed cover renders after Cloudinary completes
- confirm failed Cloudinary upload surfaces a useful error

