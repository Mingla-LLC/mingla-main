# SPEC ORCH-0766C - Event Cover Media Pipeline Demolition Fix

> Date: 2026-05-09
> Mode: Forensics / Spec
> Input: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_AUDIT.md`
> Status: READY FOR IMPLEMENTOR

## Goal

Make Mingla Business event-cover custom media work in the real React Native runtime:

- images preview and persist;
- GIFs upload without being flattened where platform allows;
- short MP4/WebM videos upload and display;
- invalid media fails with precise, actionable copy;
- too-long videos have a simple in-app/native trim path where the platform supports it;
- no zero-byte or non-renderable URL can be saved as a successful cover.

## Non-Goals

- No Giphy/Pexels provider picker.
- No brand cover upload.
- No profile photo upload, except do not worsen it and record the shared Blob anti-pattern if touched.
- No ticket-tier media.
- No admin moderation.
- No public share/OG redesign.
- No Stripe, checkout, scanner, order, or consumer app work.

## Binding Product Contract

1. Uploaded media is canonical when present.
2. Hue is fallback only when no uploaded media exists, the user removes media, or a visible media-error state is being shown.
3. Upload success requires verified non-zero bytes in Supabase and a renderable/servable URL.
4. The event cover video limit is **15 seconds and 30 MB** for this release unless product explicitly changes it.
5. MOV/QuickTime is not launch-supported unless implementation adds a proven conversion/transcode path. Otherwise reject with clear MP4/WebM copy.
6. Over-15-second supported videos must not force organisers to leave Mingla as the primary recovery path. The implementation must provide a simple in-app/native trim route where the current platform/runtime can prove it.
7. Giphy/Pexels waits until this passes runtime QA.

## Implementation Contract

### 1. Introduce A React Native-Safe Media Byte Reader

Add a shared event-cover upload helper, for example:

- `mingla-business/src/services/eventCoverFileReader.ts`, or
- colocated helpers inside `eventCoverMediaService.ts` if kept small.

Required behavior:

- Use `expo-file-system` to read `asset.uri` bytes safely in React Native.
- Add `expo-file-system` as a direct `mingla-business` dependency if it is not already direct.
- Upload `ArrayBuffer` or `Uint8Array`, not `Blob`, to Supabase Storage.
- Add `base64-arraybuffer` or a small local decoder if needed. Prefer the simplest dependency-free path only if it is tested in React Native and Jest.
- Validate byte length before upload:
  - zero bytes -> `EventCoverMediaError("upload_failed", "We couldn't read that file. Try another cover.")`;
  - size over 30 MB -> `file_too_large`;
  - mismatch between picker `fileSize` and actual bytes should log in dev but actual bytes are authoritative.
- Preserve ORCH-0766B public URL verification after upload.

Implementation note:

The installed Supabase Storage client says React Native `Blob`, `File`, and `FormData` uploads do not work as intended and recommends ArrayBuffer from base64. The fix must follow that guidance.

### 2. Normalize Picker Assets Before Validation

Add a normalized asset model, for example:

```ts
interface NormalizedEventCoverAsset {
  uri: string;
  pickerType: "image" | "video" | "livePhoto" | "pairedVideo" | null;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  durationMs: number | null;
  inferredMimeType: string | null;
  mediaType: EventCoverMediaType;
}
```

Required inference order:

1. Supported MIME type.
2. Supported filename extension.
3. Supported URI extension.
4. Picker `asset.type` (`image` -> image, `video` -> video).
5. Byte sniff from the read file header:
   - JPEG;
   - PNG;
   - GIF;
   - WebP;
   - MP4/ISO BMFF enough to identify `video/mp4`;
   - WebM EBML header if practical.

Required rejection:

- HEIC/HEIF: clear unsupported image copy unless implementation converts to JPEG.
- MOV/QuickTime: clear unsupported video copy unless implementation converts/transcodes.
- Unknown bytes: `unsupported_type`.

Step 4 must pass `asset.type` into this normalization. Do not classify from `mimeType` and `fileName` alone.

### 3. Replace The Upload Body Contract

In `uploadEventCoverMedia`:

- Remove `fetch(input.uri).blob()` as the primary React Native path.
- Use the byte reader result as the upload body.
- Use normalized/inferred content type, not a generic fallback when the actual bytes prove a specific type.
- Storage path extension must match normalized content type.
- Upload to `event_covers/{brandId}/{eventId}/{randomId}.{ext}`.
- Use `upsert: true` only if keeping the random path; random path means collision risk is already negligible.
- Do not return `publicUrl` until:
  - storage upload succeeds;
  - public URL verifier proves non-zero bytes and expected media content type.

No Supabase migration is expected if output remains within:

- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`
- `video/mp4`
- `video/webm`

If the implementation chooses to allow a new stored MIME type, create a migration with prefix greater than local head `20260515000008`, so use `20260515000009...` or later unless the branch gains newer migrations before implementation.

### 4. Repair Step 4 UX And State

In `CreatorStep4Cover.tsx`:

- Keep inline copy visible before picker:
  - `Upload an image, GIF, or MP4/WebM video up to 15 seconds and 30 MB.`
- Add clearer unsupported image/video copy:
  - image unsupported: `Choose a JPEG, PNG, WebP, or GIF.`
  - video unsupported: `Choose an MP4 or WebM video up to 15 seconds. MOV/QuickTime is not supported yet.`
  - unreadable file: `We couldn't read that file. Try another cover.`
  - too long when native trim is unavailable: `Cover videos must be 15 seconds or shorter. Choose another video or trim this one.`
  - display failed: `Uploaded, but this cover could not be displayed. Try another image or video.`
- Do not show `Cover updated.` unless upload and public URL verification passed.
- If render fails after state update, show a persistent inline warning near the cover area, not only a transient toast.
- `Replace cover` and `Remove` must remain visible whenever `coverMediaUrl` exists, even if render failed.
- Selecting a hue must not clear media.
- Removing cover must clear `coverMediaUrl` and `coverMediaType`.

### 5. Simple Video Trim Contract

Implement a simple trim recovery path, not rejection-only copy.

Required behavior:

- Keep custom cover videos limited to 15 seconds and 30 MB.
- Split image/GIF and video picker handling, or route video assets through a distinct video-only picker flow. Do not enable editing for the GIF/image picker because animated GIF preservation requires `quality: 1` and `allowsEditing: false` on Android per installed Expo ImagePicker docs.
- For the iOS launch path, prove Expo ImagePicker's native video-edit route with a video-only picker using `allowsEditing: true` and `videoMaxDuration: 15`.
- When the organiser selects a supported video over 15 seconds, offer an in-app/native trim flow and a choose-another-video escape path. Do not make "leave Mingla and trim elsewhere" the primary happy-path recovery.
- After trim returns, revalidate the returned asset before upload: actual duration must be <=15 seconds, byte length must be >0 and <=30 MB, and the media type must still be supported.
- If the native picker returns an untrimmed/over-limit asset, reject before upload and keep the existing draft media unchanged.
- If the native trim UI cannot be invoked or proven on the current platform/runtime, fail closed and document the blocker in the implementation report. Do not silently ship an external-trim-only experience as "fixed."
- Probe Android/web behavior honestly. If parity is not possible without a new native video-processing dependency, document the exact platform limitation and leave it for orchestrator/tester acceptance rather than hiding it.

No heavy video-transcoding dependency is authorized by this spec. If a small targeted native trim dependency is truly required to satisfy this contract, stop before adding it and return to orchestrator with the dependency name, native rebuild impact, risk, and why Expo ImagePicker cannot satisfy the requirement.

### 6. Renderer Error State

In `EventCoverMedia` and callers:

- Keep `onMediaError`, but make failures observable in UI where the user can act.
- Step 4 must render a persistent error status when the current `coverMediaUrl` fails to render.
- Home/public cards may continue hue fallback, but creator/edit surfaces must not make it look like a normal hue choice.
- Video errors should include the player status payload in dev logs if available.
- Add test coverage that does not rely on source-string checks.

### 7. Draft And Published Event State

Preserve current draft/autosave architecture:

- local draft updates immediately only after upload verification passes;
- autosave carries `coverMediaUrl/type`;
- stale server draft responses do not overwrite dirty local uploaded cover state;
- server hydration carries `cover_media_url/type` back.

Published edit:

- Continue to use `updatePublishedEventCoverMedia` row-count proof.
- Do not show `Saved. Live now.` if media upload/verification failed.
- If render verification fails in the editor after a successful URL save, show actionable error and let the organiser replace/remove.

### 8. Tests Required

Add or update tests so current broken behavior fails before the fix.

Required service/rules tests:

- `asset.type: "image"` with missing `mimeType` and missing `fileName` classifies as image if URI/bytes support it.
- URI extension fallback classifies image/video when MIME/filename are absent.
- Byte sniff detects JPEG, PNG, GIF, WebP, and MP4 enough for upload content type.
- Zero-byte byte-reader output rejects before upload.
- Supabase upload is called with `ArrayBuffer` or `Uint8Array`, not `Blob`.
- Generic MIME values are ignored.
- Public URL verifier still rejects `content-length: 0`.
- MP4 <=15s passes.
- MP4 >15s routes to the trim flow when supported; if trim is unavailable, fails with `video_too_long` before upload.
- Trimmed MP4 result revalidates duration, bytes, and MIME before upload.
- Video-only picker config uses native editing/max-duration settings, while image/GIF picker keeps editing disabled.
- MOV/QuickTime follows the chosen unsupported/convert strategy with explicit code/copy.
- Missing duration is `video_duration_unknown`, not `video_too_long`.

Required component tests:

- Step 4 displays 15s/30MB guidance before opening picker.
- Unsupported image toast/copy is distinct from unsupported video copy.
- Render error produces persistent Step 4 warning and keeps Replace/Remove available.
- Hue selection does not clear `coverMediaUrl`.
- Remove clears `coverMediaUrl/type`.

Required draft tests:

- newly verified `coverMediaUrl/type` survives local update and autosave payload;
- stale server draft with null media cannot overwrite dirty local media;
- accepted server draft with media hydrates local state.

Recommended test command:

```bash
cd mingla-business
npm run test:orch-0758a -- --runInBand
npm run test:orch-0763 -- --runInBand
npx tsc --noEmit
npx eslint src/components/event/CreatorStep4Cover.tsx src/components/ui/EventCoverMedia.tsx src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/__tests__/eventCoverMedia.test.ts src/utils/__tests__/serverDraftAutosaveGuards.test.ts
git diff --check
```

If new files are added, include them in targeted ESLint.

### 9. Runtime QA Matrix

Tester must verify on the signed-in Mingla Business simulator/device:

| Case | Expected |
|---|---|
| JPEG image | Upload succeeds, Step 4 preview shows image, Home draft card shows image, URL downloads >0 bytes. |
| PNG image | Same as JPEG. |
| WebP image | Same as JPEG or clear unsupported copy if renderer cannot support it. |
| GIF | Upload succeeds and displays; animation behavior recorded. |
| MP4 <=15s and <=30MB | Upload succeeds, video displays/plays or shows still under reduced motion, URL downloads >0 bytes. |
| MP4 >15s | Opens/proves simple in-app/native trim flow where supported; trimmed <=15s result uploads and displays; cancel/unsupported trim keeps draft media URL unchanged with clear copy. |
| MOV/QuickTime | Rejects with MP4/WebM copy unless conversion is implemented and proven. |
| Missing MIME/filename image | Still accepted if type/URI/bytes prove supported image. |
| Remove cover | Clears media and intentionally returns to hue. |
| Hue selection with media present | Hue changes fallback color only; media URL remains. |
| Close/reopen draft | Media persists. |
| Publish path | Published/public/checkout/order surfaces render media or intentional fallback. |
| Render failure fixture | Creator surface shows persistent error and Replace/Remove. |

## Deployment Notes

- Adding `expo-file-system` as a direct dependency may require native rebuild depending on whether it is already included in the installed native runtime. Implementor must state OTA vs native-build implications honestly.
- The simple video trim path may depend on native picker behavior. Implementor must state whether it is OTA-safe in the current dev client, whether a native rebuild is required, and which platforms are actually proven.
- No Supabase DB push should be needed unless MIME policy changes.
- No edge function deploy expected.

## Acceptance Criteria

ORCH-0766C can move to tester only when:

- Blob upload has been removed from event cover storage upload;
- picker normalization handles missing MIME/fileName;
- image upload creates a non-zero public object and renders locally in runtime;
- invalid video/image paths fail with precise copy;
- over-15-second supported videos have a proven simple in-app/native trim path on the tested launch platform, or a documented blocker returned to orchestrator before claiming implementation complete;
- tests and TypeScript/ESLint pass;
- implementation report includes runtime limitations and native rebuild implications.

ORCH-0766C can close only after independent tester runtime QA passes or the orchestrator explicitly accepts a conditional deferral.
