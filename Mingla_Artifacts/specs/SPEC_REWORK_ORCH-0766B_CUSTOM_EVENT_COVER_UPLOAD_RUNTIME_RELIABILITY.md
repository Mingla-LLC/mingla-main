# SPEC REWORK ORCH-0766B - Custom Event Cover Upload Runtime Reliability

Date: 2026-05-09  
Mode: FORENSICS / SPEC  
Input reports:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_FAILURE.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0766B_CUSTOM_EVENT_COVER_UPLOAD_RUNTIME_FAILURE.md`

## Verdict

Implement a focused event-cover upload reliability rework before any Giphy/Pexels, brand cover, profile photo, or ticket-media expansion.

The current feature is wired but not production-ready:

- Videos can fail before upload because validation assumes metadata and formats that real native pickers do not always provide.
- Images can appear to upload but still show the hue fallback because render failures are swallowed inside `EventCoverMedia`.
- Current automated tests still pass because they encode the old brittle contract and do not exercise native upload/render failure.

## User Promise

As a business organiser, I can add a custom event cover image, GIF, or short video from my device, immediately see it in Step 4, carry it through preview/publish/public surfaces, and receive clear feedback if the chosen media cannot be used.

## Non-Goals

- Do not implement Giphy/Pexels provider search.
- Do not implement brand cover upload.
- Do not implement profile photo upload.
- Do not implement ticket-tier media.
- Do not redesign the event creator wizard.
- Do not change Stripe, public share/OG, checkout, admin, or consumer explorer flows.

## Evidence Summary

### Proven Video Root Cause

`mingla-business/src/components/event/CreatorStep4Cover.tsx:105-122`

- The picker passes `asset.mimeType`, `asset.fileName`, `asset.fileSize`, and `durationMs`.
- Missing `asset.duration` is converted to `null`.

`mingla-business/src/utils/eventCoverMediaRules.ts:33-105`

- Only MP4/WebM videos are accepted.
- MOV/QuickTime is rejected.
- Any video without numeric duration metadata is rejected.

`mingla-business/src/services/__tests__/eventCoverMediaService.test.ts:43-50`

- Current tests explicitly assert that missing-duration videos must be rejected.

This is a confirmed bug against real device behavior.

### Image Branch Resolution

Static evidence makes "draft state never receives the uploaded URL" less likely than render/public-URL failure:

- `CreatorStep4Cover.tsx:123-127` calls `updateDraft({ coverMediaUrl: upload.publicUrl, coverMediaType: upload.mediaType })` after upload success.
- `EventCreatorWizard.tsx:376-392` wraps this in `handleUpdate`, increments `clientRevision`, marks the draft dirty, updates the Zustand draft immediately, and queues autosave.
- `draftEventStore.ts:693-699` merges the patch into the stored draft.
- `serverDraftAutosaveGuards.ts:18-33` rejects stale server draft responses behind local/client revision.
- `serverDraftEventMapper.ts:272-322` writes cover media to `events.cover_media_url/type`, and `serverDraftEventMapper.ts:331-388` hydrates those fields back.

However, the exact operator-uploaded URL was not available to fetch. Therefore, the spec must treat the final image branch as:

- **Likely root cause:** returned public URL exists but image/video render fails, causing hue fallback.
- **Required diagnostic check:** implementation must log and/or expose enough detail to distinguish render/public URL failure from any future state/autosave wipe.

`mingla-business/src/components/ui/EventCoverMedia.tsx:100-150`

- Resets media error on URL change.
- Renders `<Image source={{ uri: mediaUrl }} />` for image/GIF.
- On `<Image onError>`, sets `hasMediaError=true`.
- `resolveEventCoverMediaPresentation` then returns fallback.

This is enough to explain the operator symptom: upload can look successful while the UI returns to hue.

## Product Invariants

1. Uploaded media is canonical when present; hue is fallback only when no uploaded media exists or the user deliberately removes it.
2. Upload success and render success are separate states.
3. The app must not silently turn a failed media render into an apparently successful hue selection.
4. The 15-second cover-video product limit remains unless explicitly changed by product.
5. `events.cover_media_url` and `events.cover_media_type` remain canonical for server drafts and published events.
6. No provider-media expansion may build on top of this path until it passes runtime QA.

## Implementation Contract

### 1. Picker Metadata Handling

Update the Step 4 picker path in `CreatorStep4Cover.tsx`.

Requirements:

- Replace deprecated/legacy `ImagePicker.MediaTypeOptions.All` with the current Expo-compatible media type array form, e.g. `mediaTypes: ["images", "videos"]`, unless implementation proves a better SDK-54-safe option.
- Preserve GIF animation as much as Expo allows. For Android, the implementor must account for Expo's documented GIF behavior: animated GIF preservation requires `quality: 1.0` and `allowsEditing: false`; if the existing `quality: 0.92` downgrades GIFs, adjust the picker or branch behavior for GIFs.
- Capture the selected asset's normalized metadata:
  - `uri`
  - `mimeType`
  - `fileName`
  - `fileSize`
  - `duration`
  - asset media type if available
- Do not collapse missing duration into a false "too long" user message.

### 2. Validation Rules

Rework `eventCoverMediaRules.ts`.

Requirements:

- Split error meanings so the user can tell:
  - unsupported format,
  - file too large,
  - video too long,
  - video duration unknown,
  - local file unreadable,
  - storage upload failed,
  - uploaded media cannot be displayed.
- Existing `video_too_long` must not be reused for missing duration metadata.
- MP4/WebM <= 15 seconds must pass.
- Over-duration videos must fail with the current clear limit.
- MOV/QuickTime must have an explicit strategy:
  - preferred: normalize/copy/transcode to an allowed upload/playback format before storage, or
  - accepted narrow fallback: reject MOV/QuickTime with clear copy naming supported formats and test coverage.
- Missing-duration video must have an explicit strategy:
  - preferred: derive duration with a reliable native/media mechanism before rejecting, or
  - accepted fallback: reject with "We couldn't read this video's duration. Choose a 15-second MP4/WebM or try another video.", not "too long."

### 3. Storage And Content-Type Contract

Rework `eventCoverMediaService.ts`.

Requirements:

- Preserve file extension/content type alignment. Do not store every image as `.jpg` and every video as `.mp4` when the content remains PNG/WebP/WebM/etc.
- The storage path extension must match the media actually uploaded.
- The upload `contentType` must match the blob or normalized output.
- After upload, verify the returned public URL is usable enough for the app path:
  - perform a lightweight `fetch(publicUrl, { method: "HEAD" })` if supported, else a bounded `GET`/fallback check,
  - accept only 2xx responses,
  - verify content type starts with `image/` for image/GIF or `video/` for video,
  - convert failure into a typed upload/display error.
- Keep using `event_covers` bucket and `{brandId}/{eventId}/{file}` path.

Database/migration:

- Prefer no migration by normalizing to the already allowed MIME set:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `image/gif`
  - `video/mp4`
  - `video/webm`
- If implementation chooses to allow new stored MIME types such as `video/quicktime`, it must add a Supabase migration with a filename prefix greater than current local head `20260515000007`, i.e. `20260515000008...` or later, and it must update bucket `allowed_mime_types` plus tests/docs accordingly.

### 4. Preview Render And Error State

Rework `EventCoverMedia.tsx` and Step 4 caller behavior.

Requirements:

- Step 4 must communicate upload limits inline before the user opens the picker.
  - Required helper copy, or equivalent product-approved copy: `Upload an image, GIF, or MP4/WebM video up to 15 seconds and 30 MB.`
  - If MOV/QuickTime remains unsupported after the rework, the helper or failure copy must say so clearly enough that iPhone users understand what happened.
  - The helper text must sit near the upload/replace control, not only appear after a failed upload.
- Do not silently present hue fallback as a successful uploaded-cover state.
- `EventCoverMedia` must expose render failure to its parent via a typed `onMediaError` prop or equivalent.
- Step 4 must show a clear toast or inline status when uploaded media cannot render:
  - Example: `Uploaded, but this cover could not be displayed. Try another image or video.`
- The media area may still visually fall back to hue after error, but the user must know the uploaded media failed.
- Include enough debug context in development logs:
  - media URL,
  - media type,
  - native image/video error event,
  - public URL check result if available.
- The `Upload cover` / `Replace cover` / `Remove` buttons must reflect actual media state:
  - If `coverMediaUrl` exists but render failed, the user should be able to Replace or Remove.
  - Do not hide Remove just because render failed.

### 5. Draft Autosave And Hydration Guard

Keep the existing revision guard, but add tests around cover media.

Requirements:

- `coverMediaUrl` and `coverMediaType` must survive:
  - immediate local update,
  - debounced autosave,
  - stale server draft response,
  - accepted current server response,
  - draft detail/list hydration.
- A stale server draft with `cover_media_url = null` must not overwrite a dirty local draft that has a newly uploaded `coverMediaUrl`.
- An accepted server response at the current/newer revision must carry the uploaded cover media back into the local draft.

### 6. Published Edit Parity

Audit `EditPublishedScreen.tsx` because it uses the same renderer/helper path.

Requirements:

- If published cover editing uses `EventCoverMedia`, the render-error reporting behavior must apply there too.
- `updatePublishedEventCoverMedia` must retain row-count proof. Current code already selects `id` and errors on `data === null`; preserve this guard.
- Published edit save must not claim "Saved. Live now." if media update failed or render verification failed before canonical update.

### 7. Dev Diagnostics

Add dev-only diagnostics or structured logging, not noisy production logs.

Minimum diagnostics:

- picker asset metadata summary,
- normalized media metadata,
- storage path,
- content type,
- public URL,
- public URL verification result,
- draft `coverMediaUrl` after update,
- image/video render error event.

Do not log secrets, auth tokens, signed URLs, or file contents. Public storage URLs are acceptable in dev logs but should not be sent to analytics without an explicit privacy decision.

## Tests Required

The implementation must update or add tests so current behavior would fail before the fix.

### Unit Tests

Update `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`.

Required cases:

- Classifies JPEG/PNG/WebP/GIF correctly.
- Storage path extension matches actual media type/extension.
- Missing-duration video no longer throws the misleading `video_too_long` path.
- MP4 <= 15 seconds passes.
- MP4 > 15 seconds fails with `video_too_long`.
- MOV/QuickTime follows the chosen strategy:
  - either normalized/accepted, or
  - rejected with a distinct unsupported/needs-conversion error and user copy.
- Oversized media fails.
- Public URL verification failure becomes a typed error.

### Component/Presentation Tests

Update or expand `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`.

Required cases:

- Step 4 renders inline upload-limit guidance before the picker opens, including the 15-second and 30 MB limits.
- `mediaUrl` + `mediaType=image` starts in media presentation, not fallback.
- Simulated image render error calls parent error handler or returns a display-error state.
- Fallback after render error is not silent.
- Video render error uses the same error-reporting path.
- Remove/Replace affordances remain available when `coverMediaUrl` exists even if render failed.

### Draft State Tests

Add or expand draft autosave/store tests.

Required cases:

- Applying `coverMediaUrl`/`coverMediaType` increments local revision through wizard update path or covered helper.
- Stale server draft with null cover does not overwrite local dirty uploaded cover.
- Accepted server draft with cover hydrates cover fields.
- Draft mapper insert/update/hydration preserves `cover_media_url/type`.

### Existing Gates

Must remain green:

- From `mingla-business`: `npm run test:orch-0758a -- --runInBand`
- From `mingla-business`: `npm run test:orch-0763 -- --runInBand`
- TypeScript: `npx tsc --noEmit`
- Targeted ESLint on touched files, with unrelated repo-wide lint debt classified if present.
- `git diff --check`

Current baseline note: `npm run test:orch-0758a -- --runInBand` passes today, 6 suites / 35 tests, which proves current tests are insufficient. The implementation must update the tests so the old behavior is no longer accepted.

## Runtime / Manual QA Gate

Tester must verify on a real native build or simulator/device with authenticated business account, brand, and server-backed event draft:

1. JPEG image upload shows immediately in Step 4.
2. PNG image upload shows immediately in Step 4.
3. WebP image upload either shows or fails with precise unsupported copy, per chosen support contract.
4. GIF upload preserves animation where platform supports it; otherwise failure/degradation is explicit and tested.
5. MP4 <= 15 seconds uploads and plays/renders.
6. MP4 > 15 seconds fails with clear copy.
7. MOV/QuickTime follows the chosen strategy and does not produce generic failure.
8. Oversized media fails with clear copy.
9. Replacing media updates preview.
10. Removing media returns to hue fallback.
11. Draft close/reopen preserves uploaded cover.
12. Cold app restart / draft reload preserves uploaded cover.
13. Preview step shows uploaded cover.
14. Publish carries uploaded cover into:
    - organiser event detail,
    - public event page,
    - checkout/order surfaces where event cover is shown.
15. If public URL/render verification fails, user sees an actionable error and app does not imply success.

## Success Criteria

This rework is complete only when:

- Organisers can see the upload length/size/format limits before selecting media.
- Image uploads no longer silently fall back to hue after "success."
- Video failures are format/duration-specific, not generic.
- Supported short video path works or the unsupported path is explicitly narrowed and tested.
- Uploaded cover media survives local state, autosave, hydration, preview, publish, and public rendering.
- Current tests are updated so the old brittle behavior cannot pass.
- Independent tester runtime QA passes or explicitly documents a remaining product-approved limitation.

## Rollback And Deployment Notes

- Most changes should be OTA/native-JS safe if no new native dependency is added.
- If adding a native media-inspection/transcoding dependency, require a fresh dev-client/native build and tester proof on iOS and Android.
- If changing Supabase storage allowed MIME types, require migration prefix `20260515000008` or later, operator `supabase db push`, and post-push storage runtime verification before close.
- No edge-function deploy is expected unless implementation introduces server-side media normalization, which is out of preferred scope for this rework.

## Hold

Do not proceed to Giphy/Pexels, brand cover upload, profile photo upload, or ticket media upload until this event-cover upload path receives independent runtime PASS.
