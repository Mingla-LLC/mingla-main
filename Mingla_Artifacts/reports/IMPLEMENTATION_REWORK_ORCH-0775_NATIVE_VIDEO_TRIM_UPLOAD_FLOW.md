# IMPLEMENTATION REWORK ORCH-0775 - Native Video Trim Upload Flow

Date: 2026-05-10  
Status: implemented, partially verified  
Source prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0775_NATIVE_VIDEO_TRIM_UPLOAD_FLOW.md`  
Source investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0775_NATIVE_VIDEO_TRIM_UPLOAD_FLOW.md`

## Summary

The Step 4 event-cover video path now follows the native-trim-first contract:

```text
Tap Video
-> native picker is asked to edit/trim
-> Mingla receives the returned clip
-> Mingla validates duration/file/size
-> upload-intent receives trimStartMs=0 and trimEndMs=returnedDuration
-> Cloudinary remains responsible for browser-safe MP4 output
```

The old normal-path custom trim panel (`Trim video cover`, `-5s`, `+5s`, `Use this clip`) was removed from `CreatorStep4Cover`.

## Files Changed

- `.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs`
- `mingla-business/package.json`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `mingla-business/src/services/eventCoverVideoProcessingService.ts`
- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.test.ts`
- `mingla-business/src/utils/eventCoverNativeVideo.ts`
- `mingla-business/src/utils/__tests__/eventCoverNativeVideo.test.ts`

## Behavior Before

- Video picker used `allowsEditing: false`.
- Mingla received the original selected video.
- Videos over 15 seconds showed Mingla's custom trim UI.
- The app sent custom `trimStartMs` / `trimEndMs` offsets to upload-intent.
- Existing guard tests protected that old app-owned trim behavior.

## Behavior After

- Video picker uses `allowsEditing: true` and `videoMaxDuration: 15`.
- Image/GIF picker remains `allowsEditing: false`.
- Returned video assets are validated before upload-intent:
  - URI must be readable.
  - Duration must be known and `<= 15000 ms`.
  - File size must be known and positive because the Edge upload-intent validates positive `sourceBytes`.
  - Source bytes must be `<= 500 MB`.
- A valid returned 8-second clip sends:
  - `sourceDurationMs = 8000`
  - `trimStartMs = 0`
  - `trimEndMs = 8000`
- Returned clips still over 15 seconds do not call upload-intent and show persistent inline recovery copy.
- Cloudinary remains the only public-video normalization path; raw picker video still does not become the public cover URL.

## Diagnostics / Error Handling

- Step 4 still logs returned picker asset metadata in dev builds.
- Step 4 now logs native-trim validation rejection details.
- Upload-intent service still emits request IDs and stage-specific dev logs.
- Validation errors from upload-intent now map common Edge `detail` values to organizer-readable messages instead of only surfacing generic "Could not prepare video upload."
- Source upload failure now emits a dev warning with status and provider detail.

## Tests Added / Updated

- Added `mingla-business/src/utils/eventCoverNativeVideo.ts`.
- Added `mingla-business/src/utils/__tests__/eventCoverNativeVideo.test.ts`.
- Updated `eventCoverMedia.test.ts` to assert native-trim-first picker config and absence of the retired custom trim UI.
- Updated `eventCoverVideoProcessingService.test.ts` to verify a returned 8-second native-trimmed clip maps to upload-intent fields `0..duration`.
- Updated ORCH-0770 strict grep guard to enforce native editing and validation before upload-intent.
- Updated `test:orch-0770` to run the new focused Jest tests before TypeScript.

## Verification

Passed:

```text
npm run test:orch-0770
```

Output summary:

```text
[orch-0770] event cover video processing guard passed
PASS src/components/ui/__tests__/eventCoverMedia.test.ts
PASS src/utils/__tests__/eventCoverNativeVideo.test.ts
PASS src/services/__tests__/eventCoverVideoProcessingService.test.ts
Test Suites: 3 passed, 3 total
Tests: 17 passed, 17 total
```

Passed:

```text
npm run test:orch-0774a
```

Output summary:

```text
PASS src/components/ui/__tests__/eventCoverMedia.test.ts
PASS src/services/__tests__/eventCoverVideoProcessingService.test.ts
PASS src/hooks/__tests__/brandListState.test.ts
PASS src/utils/__tests__/serverDraftLifecycleGuards.test.ts
PASS src/utils/__tests__/authReadiness.test.ts
Test Suites: 5 passed, 5 total
Tests: 42 passed, 42 total
```

Passed:

```text
npx tsc --noEmit
```

Passed:

```text
git diff --check
```

Note: Jest emitted a Watchman recrawl warning. It did not fail tests.

## Edge / Deploy Notes

No Supabase Edge Function code was changed in this ORCH-0775 pass, so no Deno gate or function deploy was required for these changes.

Important runtime caveat: the ORCH-0774A upload-intent diagnostics are still required to pinpoint any remaining 8-second "could not prepare video upload" failure. If the deployed `event-cover-video-upload-intent` function does not yet include the diagnostic stages from `supabase/functions/event-cover-video-upload-intent/index.ts`, deploy that function before tester runtime QA so the client `requestId` can be matched to Edge logs.

## Manual Tester Gates

These still require real app/runtime verification:

1. Step 4 -> Video with a real 8-second phone video.
   - Expected: no Mingla custom trim panel.
   - Expected: upload-intent logs show `trimStartMs=0`, `trimEndMs=<returned duration>`.
   - Expected: processing succeeds or the exact failure stage is visible.

2. Step 4 -> Video with a 30+ second phone video.
   - Expected: native iOS/Android trim UI appears.
   - Expected: after trimming to <=15 seconds, Mingla receives the returned clip and uploads `0..duration`.

3. Return a clip that is still over 15 seconds, if the platform allows it.
   - Expected: upload-intent is not called.
   - Expected: persistent inline error says to trim to 15 seconds or shorter.

4. Save/publish the event cover and open public event page in browser.
   - Expected: public cover uses processed Cloudinary MP4, not raw MOV/HEVC.

5. Failed upload attempt.
   - Expected: logs include request ID and a specific failure stage, not only the generic toast.

## Residual Risk

Expo ImagePicker's native trim behavior still needs runtime proof on real iOS and Android. The implementation validates the returned asset rather than trusting native trim blindly, but only device QA can prove whether the native edit UI appears consistently on the target builds.

