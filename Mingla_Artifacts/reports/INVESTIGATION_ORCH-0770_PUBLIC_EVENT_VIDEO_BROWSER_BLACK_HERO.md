# INVESTIGATION ORCH-0770 - Public Event Video Cover Browser Black Hero

> Date: 2026-05-09  
> Mode: Forensics / Runtime + Code Probe  
> Surface: `mingla-business` public event page video covers on browser and app  
> Verdict: FAIL - browser playback is blocked by the uploaded video asset contract, not by the public page UI alone.

## Executive Summary

The public event page is black in browser because Mingla is allowing event-cover videos that are valid for native playback but not guaranteed browser-playable.

The probed public Supabase cover objects prove the issue:

- Objects are served as `content-type: video/quicktime`.
- The failing examples are QuickTime `.MOV` containers.
- The failing examples use `hvc1` / HEVC video, not browser-safe `avc1` / H.264.
- Two examples place the `moov` metadata atom after the huge `mdat` payload, so the browser cannot start playback until it has enough of the file/end metadata.

UI changes such as using `expo-video`, using an HTML `<video>`, changing mute defaults, or moving the sound button cannot make a HEVC/QuickTime/non-fast-start object browser-compatible.

## User Symptoms

1. Browser public event page hero is black and does not play.
2. Sometimes a still snapshot appears.
3. In the app, the mute button overlaps or sits under top chrome / close affordance.
4. Share/open-return can pause video, and the user expects it to loop.

## Evidence

### Runtime Object Probe - Current Public URL Is QuickTime

Probed URL:

```text
https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event_covers/22a18413-bfbf-4087-9ba7-45f70deba0f3/b1ab659e-358d-41f3-a56d-76f7b273bddd/moyhiykt-7rb9nmg6.mov
```

HEAD:

```text
HTTP/2 200
content-type: video/quicktime
content-length: 26448972
accept-ranges: bytes
access-control-allow-origin: *
```

First bytes:

```text
00000000: 0000 0014 6674 7970 7174 2020 0000 0000  ....ftypqt  ....
00000010: 7174 2020 0000 0008 7769 6465 0193 4dc1  qt  ....wide..M.
00000020: 6d64 6174                                      mdat
```

Local `file` result:

```text
ISO Media, Apple QuickTime movie, Apple QuickTime (.MOV/QT)
```

Top-level atom parse:

```text
0        ftyp       size 20
20       wide       size 8
28       mdat       size 26430913
26430941 moov       size 18031
```

Codec marker scan:

```text
hvc1 present
avc1 absent
qt   present
isom absent
mp42 absent
```

Interpretation: this is an HEVC QuickTime file with `moov` after `mdat`. It is not a launch-safe browser video-cover artifact.

### Second Uploaded Object - MP4 Brand But Still HEVC And Served QuickTime

Probed URL:

```text
.../moyhjuj6-pgiuxnan.mov
```

HEAD:

```text
content-type: video/quicktime
content-length: 8954435
```

First bytes:

```text
ftypmp42 ... isom mp41 mp42 ... moov
```

Local `file`:

```text
ISO Media, MP4 v2 [ISO 14496-14]
```

Atom/codec scan:

```text
moov at byte 32
hvc1 present
avc1 absent
```

Interpretation: even a more MP4-like exported object is still HEVC and is still served as `video/quicktime` because the app/storage path preserves the picker MIME/extension. This still does not satisfy the browser-safe cover contract.

### Third Uploaded Object - QuickTime, HEVC, Non-Fast-Start

Probed URL:

```text
.../moyhkifa-gcxnmg5n.mov
```

HEAD:

```text
content-type: video/quicktime
content-length: 11562409
```

Local `file`:

```text
ISO Media, Apple QuickTime movie, Apple QuickTime (.MOV/QT)
```

Atom/codec scan:

```text
0        ftyp
20       wide
28       mdat
11552712 moov
hvc1 present
avc1 absent
```

Interpretation: same failure class as the first object.

## Code Evidence

### Upload Rules Preserve QuickTime As QuickTime

File: `mingla-business/src/utils/eventCoverMediaRules.ts`

Evidence:

```text
mov -> video/quicktime
video/quicktime -> mov
eventCoverContentType prefers supported picker MIME before byte sniffing
eventCoverExtension returns mov when MIME is video/quicktime
```

Relevant locations:

- `eventCoverMediaRules.ts:44-65`
- `eventCoverMediaRules.ts:87-105`
- `eventCoverMediaRules.ts:108-132`

Impact:

If iOS returns `mimeType: "video/quicktime"`, Mingla stores and serves the cover as QuickTime even if bytes are closer to MP4. The storage contract therefore optimizes for accepting native videos, not for browser playback.

### Current Test Encodes The Wrong Browser Contract

File: `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`

Evidence:

```text
uploads short iOS MOV videos with QuickTime content type
publicUrl: https://cdn.example.com/cover.mov
contentType: video/quicktime
storage path matches /\.mov$/
```

Relevant locations:

- `eventCoverMediaService.test.ts:470-499`

Impact:

The test locks in the exact behavior that causes browser black hero failures. It proves upload acceptance, not browser-safe playback.

### Picker H.264 Export Is Not Proving H.264 Runtime Output

File: `mingla-business/src/components/event/CreatorStep4Cover.tsx`

Evidence:

```text
videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720
videoQuality: ImagePicker.UIImagePickerControllerQualityType.High
```

Relevant location:

- `CreatorStep4Cover.tsx:223-230`

Runtime contradiction:

The probed object with `ftypmp42` still contains `hvc1`, not `avc1`.

Impact:

The client-side picker option is not a reliable transcode guarantee. It may produce a browser-hostile HEVC file even when the code asks for H.264.

### Public Page Audio Control Collides With Top Chrome

File: `mingla-business/src/components/event/PublicEventPage.tsx`

Evidence:

```text
floatingChrome top = insets.top + spacing.sm
close IconChrome size = 40
EventCoverMedia audioControlTopOffset = insets.top + 12
```

Relevant locations:

- `PublicEventPage.tsx:314-334`
- `PublicEventPage.tsx:407-420`

Causal chain:

The top chrome begins at roughly `insets.top + spacing.sm`, and the audio control begins at `insets.top + 12`. With a 40px close button, these two controls occupy the same vertical band. Because the audio button is rendered inside the media hero and the close/share chrome is page-level, the audio button can appear under or near the close affordance instead of being part of a deliberate top control bar.

Impact:

The user cannot reliably tap sound/mute, especially in mobile browser/native public preview.

## Root Cause Findings

### S1 Confirmed Bug - Event Cover Upload Accepts Native-Playable Videos That Are Not Browser-Playable

Classification: confirmed bug / production-readiness blocker.

Six-field proof:

- File/schema: `eventCoverMediaRules.ts:44-65`, `eventCoverMediaRules.ts:87-132`, `eventCoverMediaService.test.ts:470-499`.
- Exact code: `video/quicktime` maps to `.mov`; upload tests expect `contentType: "video/quicktime"` and `.mov`.
- Current behavior: public browser page receives `video/quicktime` HEVC/QuickTime media and renders a black hero.
- Expected behavior: public event covers must be browser-playable. For video, that means H.264/AAC MP4 with fast-start metadata (`moov` before `mdat`) or HLS/DASH output.
- Causal chain: iPhone picker returns MOV/QuickTime and/or HEVC -> Mingla accepts it as `video` -> Mingla uploads it as QuickTime `.mov` -> public event page renders a browser video element/expo-video over `video/quicktime`/HEVC -> browser cannot decode/start reliably -> black hero.
- Verification step: upload a known H.264/AAC MP4 fast-start file with `content-type: video/mp4`, `ftyp isom/mp42`, `avc1` present, `hvc1` absent, and `moov` before `mdat`; browser hero should render/play. Upload the current HEVC MOV fixture; app must reject or transcode it before publish.

### S1 Confirmed Product/Architecture Gap - There Is No Transcoding Or Browser-Safe Validation Layer

Classification: confirmed production-hardening gap.

Six-field proof:

- File/line: no media transcode edge function/service found; upload path is direct picker bytes -> Supabase Storage.
- Exact code: `CreatorStep4Cover.tsx` calls `uploadEventCoverMedia`; `eventCoverMediaService.ts` uploads the chosen bytes directly.
- Current behavior: the app trusts picker output and public URL reachability. It verifies `content-type` starts with `video/`, but does not verify codec, fast-start layout, or browser decode compatibility.
- Expected behavior: public web media should pass either a transcode step or a strict browser-compatible validation step before the event stores the cover URL.
- Causal chain: public URL verifier proves "object exists and has bytes", not "browser can decode and start it"; incompatible videos reach public page.
- Verification step: add validation fixtures for HEVC QuickTime, HEVC MP4, H.264 MP4 non-fast-start, and H.264 MP4 fast-start.

### S2 Confirmed UX Bug - Audio Control Is Not Owned By The Public Page Top Chrome

Classification: confirmed UX bug.

Six-field proof:

- File/line: `PublicEventPage.tsx:314-334` renders close/share chrome; `PublicEventPage.tsx:407-420` renders audio control inside `EventCoverMedia`.
- Exact code: top chrome and audio control use independent absolute positioning with overlapping offsets.
- Current behavior: audio control appears under/near the close icon instead of a safe, reachable top bar position.
- Expected behavior: the public page should own a single safe-area-aware media control row, with close/share/sound laid out without overlap.
- Causal chain: page-level chrome and media-level control do not coordinate layout -> offsets overlap -> mute button lands under close/top chrome.
- Verification step: render public page on iPhone-size viewport with owner chrome and assert the sound button has a distinct hitbox below or inside the top chrome row, not overlapping close/share.

## False Leads Eliminated

- **React Native web component alone:** The web path was changed to real `<video>`, but black remains. The probed object itself is not browser-safe.
- **Autoplay-with-sound alone:** Web autoplay must be muted, and the code changed that. The asset still fails because it is HEVC/QuickTime/non-fast-start.
- **CORS/range support:** Supabase returns `access-control-allow-origin: *`, `accept-ranges: bytes`, and successful `206` range responses.
- **Missing object/zero-byte:** The probed objects return 200 and positive content length. This is no longer the zero-byte failure class.
- **Upload failure:** The objects exist. The failure is decode/start compatibility.

## Required Fix Contract

### Option A - Production Correct Fix: Transcode

Implement a media processing pipeline:

1. Client uploads the original video to a private/raw bucket path.
2. Server-side processor transcodes to:
   - MP4 container
   - H.264 video (`avc1`)
   - AAC audio
   - max 15 seconds
   - fast-start metadata (`moov` before `mdat`)
   - sane cover resolution/bitrate
3. Store only processed public URL in `events.cover_media_url`.
4. Store processing state/error separately so Step 4 can show:
   - Uploading
   - Processing
   - Ready
   - Could not process; choose another video
5. Public page renders processed MP4 only.
6. Existing MOV/HEVC public URLs need migration/replacement or must fall back with a clear "video unavailable" state.

This can use a managed media provider (Mux, Cloudinary, Transloadit, etc.) or a dedicated server job. Supabase Edge Functions alone are not a good fit for heavy ffmpeg transcoding.

### Option B - Short-Term Launch Gate: Reject Browser-Unsafe Videos

If transcode is too large for this pass:

1. Stop accepting `video/quicktime` as a publishable event cover.
2. Read enough bytes to validate:
   - `ftyp` brand is MP4-compatible (`isom`, `mp42`, compatible brands)
   - `avc1` exists
   - `hvc1` / `hev1` do not exist
   - `moov` appears before `mdat`
3. Upload as `video/mp4` with `.mp4` only when this passes.
4. Show precise error copy:
   - `This video uses an iPhone format browsers cannot play. Choose an MP4/H.264 video or export it as Most Compatible.`
5. Rewrite tests that currently expect `.mov` / `video/quicktime`.

This is less magical but honest. It prevents black public pages.

### UI Fix For Audio Control

Do not render the public-page audio control inside `EventCoverMedia` for the public hero.

The public page should own a single safe-area-aware chrome row:

- Left: close only when owner is viewing.
- Right: sound/mute + share.
- Or a second row just beneath close/share: `top = insets.top + spacing.sm + 48`.
- Sound control must not overlap close/share in owner or buyer mode.
- The control must remain tappable after share sheet open/close.

## Tests Required

Automated:

1. `eventCoverMediaRules` fixture tests:
   - Reject `ftyp qt` + `hvc1`.
   - Reject MP4-ish `ftyp mp42` + `hvc1`.
   - Reject H.264 MP4 with `moov` after `mdat` if no transcode exists.
   - Accept H.264 MP4 with `moov` before `mdat`.
2. `eventCoverMediaService` tests:
   - No longer expect QuickTime `.mov` upload as success for public event covers.
   - Expect `video/mp4` and `.mp4` for accepted video covers.
3. Public page layout test/source guard:
   - Sound/mute is page-chrome-owned, not nested in `EventCoverMedia` for public hero.
   - Top offsets do not overlap close/share.
4. Browser render smoke test:
   - Public page with valid MP4 fixture shows non-black video frame or at minimum browser `<video>` reaches canplay/play.

Manual:

1. Upload current iPhone HEVC MOV: app rejects or transcodes; public page must not go black.
2. Upload browser-safe H.264 MP4: public page plays in Safari and Chrome.
3. Open share sheet and return: video resumes looping.
4. Owner view and buyer view: sound/mute does not overlap close/share and is tappable.

## Production Readiness Verdict

Not ready.

Do not ship Giphy/Pexels or expand to brand/profile/ticket custom video until the event cover video contract is browser-safe.

The next implementation should not spend more time patching `EventCoverMedia` playback until upload validation/transcoding is fixed. The public player can only play what the browser can decode.

