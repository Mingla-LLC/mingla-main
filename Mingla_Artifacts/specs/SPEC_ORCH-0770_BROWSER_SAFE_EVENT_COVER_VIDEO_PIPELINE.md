# SPEC ORCH-0770 - Browser-Safe Event Cover Video Pipeline

> **Date:** 2026-05-09  
> **Mode:** Forensics SPEC  
> **Input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md` and `Mingla_Artifacts/reports/REVIEW_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md`  
> **Status:** IMPLEMENTOR-READY after orchestrator review  
> **Scope:** `mingla-business` event cover video upload, public event page render, public-page video controls, and tests

## 1. Executive Decision

The first implementation must **stop publishing raw iPhone/QuickTime/HEVC video as public event cover media**.

The smallest production-safe repair is a **browser-safe video gate**:

- Accept only video assets that are proven browser-safe.
- Store accepted public cover videos as `.mp4` / `video/mp4`.
- Reject raw MOV/QuickTime/HEVC/non-fast-start assets with clear in-app copy and no draft mutation.
- Fix public page video controls so sound/mute does not overlap close/share.

Full "upload any iPhone MOV and Mingla converts it" requires a managed media processor or server worker. This repo currently has no ffmpeg/Mux/Cloudinary/Transloadit-style pipeline, and Supabase Edge Functions are not a good fit for heavy video transcoding. Therefore transcoding is a follow-on provider/worker decision unless the operator supplies an approved provider and credentials before implementation.

## 2. Root Cause Recap

Forensics proved the browser black hero is not primarily a React player bug.

Direct public Supabase object probes showed failing event-cover videos are:

- served as `content-type: video/quicktime`;
- stored as `.mov` paths;
- QuickTime/MOV or MP4-like containers with HEVC `hvc1`;
- missing browser-safe H.264 `avc1`;
- sometimes non-fast-start, with `moov` after `mdat`.

Current code makes that possible:

- `mingla-business/src/utils/eventCoverMediaRules.ts:44-65` maps `mov`/`qt` to `video/quicktime` and `video/quicktime` to `.mov`.
- `mingla-business/src/utils/eventCoverMediaRules.ts:87-105` trusts picker MIME/extension before byte-level browser-safe validation.
- `mingla-business/src/services/eventCoverMediaService.ts:124-172` uploads picker bytes directly to `event_covers` and verifies only that the public URL has bytes and a broad `video/*` content type.
- `mingla-business/src/components/event/CreatorStep4Cover.tsx:223-230` requests `VideoExportPreset.H264_1280x720`, but runtime evidence proves this is not a reliable H.264 guarantee.
- `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts:465-500` currently asserts the wrong public contract: short iOS MOV uploads succeed as `.mov` / `video/quicktime`.
- `mingla-business/src/components/event/PublicEventPage.tsx:314-334` owns close/share chrome while `PublicEventPage.tsx:407-420` asks `EventCoverMedia` to render sound control at `insets.top + 12`, creating overlap.

## 3. User Promise

For organisers:

1. They can upload/select a cover.
2. If it is an image/GIF, existing image/GIF behavior continues.
3. If it is a video, Mingla accepts it only when it can actually work on public browser pages.
4. If their selected video is an iPhone-only/browser-unsafe format, the app tells them why and does not save a broken public cover.
5. The limit is still 15 seconds and 30 MB for this release.

For public event visitors:

1. A video cover either plays reliably or falls back before publish/save.
2. The page does not show a black empty hero because of unsupported video format.
3. Sound/mute is reachable and does not sit under close/share or browser/app safe-area chrome.
4. The video keeps looping and attempts to resume after share-sheet/app visibility return.

## 4. Non-Goals

- No Giphy integration.
- No Pexels integration.
- No brand cover media expansion.
- No profile media expansion.
- No ticket-tier media expansion.
- No Stripe/currency/public-brand changes.
- No heavy video transcoding in Supabase Edge Functions.
- No promise that all iPhone-shot MOV/HEVC videos can be accepted until a real transcoding provider/worker is chosen.

## 5. Browser-Safe Video Contract

For a video to become `events.cover_media_url` / `cover_media_type = 'video'`, the saved public artifact must satisfy:

| Requirement | Contract |
| --- | --- |
| Container | MP4 / ISO Base Media |
| File extension | `.mp4` |
| MIME type | `video/mp4` |
| Video codec | H.264 / AVC marker `avc1` present |
| Disallowed codecs | HEVC markers `hvc1` and `hev1` absent |
| Audio | AAC preferred; audio may be absent, but if present it must not require an unsupported browser codec |
| Fast start | `moov` atom must appear before `mdat` for progressive browser playback |
| Duration | `<= EVENT_COVER_MAX_VIDEO_DURATION_MS` / 15 seconds |
| Size | `<= EVENT_COVER_MAX_BYTES` / 30 MB |
| Public URL verification | Must prove object exists, has positive bytes, has `video/mp4`, and byte validation still passes after upload |

## 6. Required Implementation

### 6.1 Add Browser-Safe MP4 Byte Validation

In `mingla-business/src/utils/eventCoverMediaRules.ts`, add a parser/validator that inspects enough bytes to classify MP4 atoms and codec markers.

Required exported helper shape, exact naming at implementor discretion:

```ts
type BrowserSafeVideoValidation =
  | { ok: true; contentType: "video/mp4"; extension: "mp4" }
  | {
      ok: false;
      reason:
        | "quicktime_container"
        | "hevc_codec"
        | "missing_h264"
        | "not_fast_start"
        | "unsupported_video";
    };
```

The helper must:

- detect `ftyp`;
- reject QuickTime brand `qt  `;
- accept MP4-compatible brands only when compatible with the rest of this contract;
- scan for `avc1`;
- reject when `hvc1` or `hev1` appears;
- inspect top-level atom order enough to require `moov` before `mdat`;
- reject when it cannot prove the contract from the available bytes.

Implementation note: if the current file reader only returns the whole asset as `Uint8Array`, using the full bytes is acceptable for 30 MB max. If a future optimization reads only a prefix/tail, tests must still prove all required fixtures.

### 6.2 Reject Browser-Unsafe Videos Before Upload

In `uploadEventCoverMedia` / associated rule helpers:

- Keep image/GIF behavior unchanged.
- For `mediaType === "video"`, run browser-safe validation after bytes are read and before Storage upload.
- If validation fails, throw `EventCoverMediaError("unsupported_type", ...)` with a browser-specific video message.
- Do not call Supabase Storage upload.
- Do not update draft cover fields.

Required copy:

```text
This video uses a format browsers can't play. Choose a web-ready MP4/H.264 video up to 15 seconds.
```

Step 4 inline helper copy must change from:

```text
Upload an image, GIF, or MP4, MOV, or WebM video up to 15 seconds and 30 MB.
```

to:

```text
Upload an image, GIF, or web-ready MP4 video up to 15 seconds and 30 MB.
```

The picker may still use `mediaTypes: ["videos"]` and `allowsEditing: true`, but the app must no longer claim MOV/WebM as accepted public cover formats unless a later browser-safe contract proves them.

### 6.3 Force Accepted Video Storage To MP4

For accepted video covers:

- `eventCoverContentType(...)` must return `video/mp4`.
- `eventCoverExtension(...)` must return `mp4`.
- Storage path must end in `.mp4`.
- Supabase upload must use `{ contentType: "video/mp4" }`.
- Public URL verification must reject any video response that is not `video/mp4`.

`video/quicktime` may remain in the storage bucket temporarily for historical/backfill reads, but new uploads must not write public event cover videos as `video/quicktime`.

### 6.4 Public URL Verification Must Validate Video Bytes

Update `verifyEventCoverPublicUrl` so `mediaType === "video"` does more than `content-type startsWith("video/")`.

Required:

- HEAD or range GET must prove positive bytes as today.
- `content-type` for video must be exactly `video/mp4` or a `video/mp4;...` variant.
- A GET/range/full-object read must run the browser-safe MP4 validation. For the current 30 MB limit, a full-object read is acceptable if needed.
- If validation fails, throw `EventCoverMediaError("display_failed", "Uploaded cover could not be displayed.")`.

### 6.5 Public Page Chrome Owns Sound/Mute

In `PublicEventPage.tsx` and `EventCoverMedia.tsx`, remove the public hero's sound/mute layout from the media component's independent top offset.

Required behavior:

- Public event page owns one safe-area-aware top chrome zone.
- Close/share/sound controls must be positioned together or in coordinated rows.
- No sound/mute control may overlap close/share.
- Sound/mute must be reachable on iPhone Safari and app public preview.
- Buyer mode and owner mode both get valid layout:
  - owner mode: close + sound + share
  - buyer mode: sound + share
- Minimum hit target: 40 x 40.

Recommended implementation:

- Add controlled audio props to `EventCoverMedia`:
  - `muted`
  - `onMutedChange`
  - `showAudioControl={false}` for public hero.
- Keep the actual audio toggle button in `PublicEventPage` next to share/close.
- If keeping media-level audio controls for non-public surfaces, make public hero explicitly opt out.

Browser policy note:

- Web browsers generally block autoplay with sound. Public page video may initialize muted for autoplay, but the visible control must let users turn sound on with a tap.
- Native app public preview may use `muted={false}` only if playback behavior remains stable. The spec does not require impossible browser autoplay-with-sound.

### 6.6 Resume Looping After Share Sheet / Visibility Return

Keep and harden the existing `AppState` resume path in `EventCoverMedia.tsx:126-139`.

Required:

- Native: on `AppState` active, if public hero is still in autoplay video mode, call play/replay safely.
- Web: add browser visibility/focus resume handling for the web `<video>` path where possible.
- Resume failures must be swallowed only after leaving the video visible and the sound/mute control usable.

## 7. Upload And Save State Machine

### Pick

- User taps **Upload cover**.
- For image/GIF, existing image path remains.
- For video, picker may offer trim/edit, but trim is not the browser-safe proof.

### Validate Local Bytes

- Read local asset bytes.
- Enforce 30 MB max using actual bytes.
- Enforce duration <= 15 seconds from picker metadata.
- If video, run browser-safe validation.

### Reject

If video fails browser-safe validation:

- show the required copy;
- keep existing cover unchanged;
- do not upload;
- do not save draft mutation;
- leave user on Step 4.

### Upload

For accepted video:

- upload bytes to `event_covers/{brandId}/{eventId}/{random}.mp4`;
- use content type `video/mp4`;
- verify public URL bytes and browser-safe contract.

### Update Draft

- Only after verification succeeds:
  - `coverMediaUrl = publicUrl`
  - `coverMediaType = "video"`
- Autosave/publish can persist as before.

### Publish

- Existing publish paths may keep `cover_media_url` and `cover_media_type`.
- Do not add new local-only media truth.

### Render

- Public event page renders only already-validated browser-safe public MP4 video.
- If historical bad video remains, render fallback or error state rather than black hero.

## 8. Historical Bad Covers / Backfill Stance

This implementation must not silently keep broken historical MOV/HEVC covers as if they are valid.

Required minimum:

- Runtime public page must detect obvious historical raw MOV/QuickTime video URLs by extension/content type where available and fall back to hue rather than black.
- Step 4/edit-published replacement should allow organisers to replace the bad cover.

Optional follow-on:

- A later media-processing/backfill ORCH can transcode existing historical raw cover videos into MP4 derivatives.

## 9. Database / Storage / RLS

### Database

No new DB column is required for the minimum browser-safe gate.

If implementor chooses to add processing state, that is out of this minimum spec and requires a separate orchestrator-approved DB spec.

### Storage

No required migration if `event_covers` already allows `video/mp4`.

If the implementor tightens `event_covers.allowed_mime_types` to remove `video/quicktime`, migration prefix must be greater than current max local migration:

```text
20260515000011_orch_0769_no_implicit_gbp_currency.sql
```

So any new migration must use `20260515000012...` or later, unless orchestrator explicitly approves an out-of-order migration.

Do not break historical object reads. Public read policy for `event_covers` remains.

### RLS

No RLS policy change is required for the minimum browser-safe gate.

## 10. Transcoding Follow-On Contract

To accept arbitrary iPhone MOV/HEVC videos in the future, Mingla needs a media-processing architecture:

1. Client uploads original video to a raw/private path.
2. Server/provider transcodes to MP4/H.264/AAC fast-start.
3. Server verifies derivative.
4. Only derivative URL is saved to `events.cover_media_url`.
5. UI shows `Uploading -> Processing -> Ready` and fails safely if processing fails.

Acceptable future processors include a managed media provider or a dedicated worker with ffmpeg. Supabase Edge Functions alone should not be specced as the heavy transcoding runtime.

This future work should be registered separately if the operator wants full "iPhone MOV accepted and converted" behavior.

## 11. Tests To Add Or Rewrite

### 11.1 `eventCoverMediaRules` Tests

Add byte-fixture tests for:

- reject QuickTime `ftyp qt  `;
- reject MP4-like `ftyp mp42` containing `hvc1`;
- reject HEVC marker `hev1`;
- reject missing `avc1`;
- reject H.264 MP4 when `moov` comes after `mdat`;
- accept H.264 MP4 with `moov` before `mdat`;
- accepted video normalizes to `video/mp4` and `.mp4`.

### 11.2 `eventCoverMediaService` Tests

Rewrite the current wrong test:

- `uploads short iOS MOV videos with QuickTime content type`

It must become a rejection test proving:

- short QuickTime/MOV/HEVC videos do not upload;
- Storage `upload` is not called;
- error copy/code is precise.

Add accepted MP4 test proving:

- upload path ends `.mp4`;
- content type is `video/mp4`;
- public verification reads bytes and validates browser-safe MP4.

### 11.3 `EventCoverMedia` / Public Page Tests

Rewrite current source guard in `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts:79-101`.

It currently expects:

- `showAudioControl` on public page;
- `audioControlPosition="topLeft"`;
- `audioControlTopOffset={insets.top + 12}`.

New guard must expect:

- public hero uses `showAudioControl={false}` or omits it;
- sound/mute control exists in `PublicEventPage` chrome, not inside `EventCoverMedia`;
- no `audioControlTopOffset={insets.top + 12}` on public hero;
- chrome includes close/share/sound in non-overlapping layout.

### 11.4 Runtime / Browser Smoke

Add or document a small smoke fixture:

- Valid MP4/H.264/AAC fast-start URL renders and reaches `canplay` in browser.
- HEVC/MOV fixture is rejected before upload or falls back if already historical.
- Open share modal/sheet and close it; video remains visible and attempts to resume loop.

If this cannot be automated in repo CI, tester prompt must require manual browser + iPhone Safari/app proof.

## 12. Commands For Implementor Verification

At minimum:

```bash
cd mingla-business
npm test -- --runInBand src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/__tests__/eventCoverMedia.test.ts
npm test -- --runInBand src/utils/__tests__/serverDraftLifecycleGuards.test.ts
npx tsc --noEmit
npx eslint src/utils/eventCoverMediaRules.ts src/services/eventCoverMediaService.ts src/components/event/CreatorStep4Cover.tsx src/components/ui/EventCoverMedia.tsx src/components/event/PublicEventPage.tsx src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/__tests__/eventCoverMedia.test.ts
```

If a migration is added:

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Do not run `supabase db push` from implementor unless the orchestrator/user explicitly authorizes deployment.

## 13. Tester Runtime Gate

Tester must verify:

1. Fresh browser-safe MP4 upload:
   - Step 4 preview renders.
   - Draft saves.
   - Published public page plays in browser.
   - Public page plays in app preview.
2. Fresh iPhone MOV/HEVC upload:
   - App rejects with browser-specific copy, or transcode path is explicitly enabled and returns MP4.
   - No broken `coverMediaUrl` is saved.
3. Existing historical MOV cover:
   - Browser public page does not show a black empty hero as the only outcome; it falls back or marks unavailable.
4. Sound/mute:
   - button is visible, safe-area aware, and tappable in owner and buyer modes.
   - not under close/share.
5. Share return:
   - open share modal/sheet, close it, return to public event page.
   - video remains visible and resumes/continues looping where platform permits.

## 14. Success Criteria

ORCH-0770 implementation can move to tester only when:

- raw `video/quicktime`/MOV/HEVC can no longer become a saved public event cover URL;
- accepted videos save as `.mp4` / `video/mp4`;
- accepted videos pass byte-level browser-safe validation;
- current tests that expected `.mov` success are rewritten;
- public page sound/mute is owned by coordinated safe-area chrome;
- historical bad-video behavior does not leave users staring at a black hero;
- focused tests, typecheck, and targeted lint pass or unrelated failures are documented.

ORCH-0770 can close only after independent tester runtime proof on browser and app.
