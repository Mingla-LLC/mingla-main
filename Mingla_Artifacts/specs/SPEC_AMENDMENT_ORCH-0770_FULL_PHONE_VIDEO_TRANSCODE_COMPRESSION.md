# SPEC AMENDMENT ORCH-0770 - Full Phone Video Transcode And Compression

> Date: 2026-05-09  
> Mode: Forensics SPEC AMENDMENT  
> Status: IMPLEMENTOR-READY after orchestrator review  
> Scope: Mingla Business event-cover video upload, trim, processing, compression, save/publish, and public event playback  
> Supersedes: the rejection-first implementation direction in `SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md`

## 1. Executive Decision

Mingla must implement a real video-processing pipeline for event covers.

The correct product contract is:

```text
phone-shot video source -> optional in-app trim selection -> private raw upload -> managed processing -> public browser-safe MP4 derivative <= 25 MB -> event cover URL
```

The 25 MB cap applies to the final processed public derivative, not to the original phone video selected by the organiser. A normal iPhone MOV/HEVC source may exceed 25 MB and may still be accepted into processing.

Primary recommendation: use **Cloudinary video** as the first managed processor, coordinated by Supabase Edge Functions and a new processing job table.

Fallback recommendation: Transloadit is the strongest backup if Cloudinary cannot meet Mingla's account, webhook, cost, or output verification needs. Mux is good for hosted video playback and static renditions, but it is less direct for Mingla's exact requirement of a small MP4 cover derivative with deterministic file-size enforcement.

Do not build ffmpeg transcoding inside Supabase Edge Functions. Supabase Edge Functions should coordinate auth, signatures, job state, and webhooks only. Official Supabase docs list 200 ms active CPU time and recommend offloading intensive processing to background jobs or external services, which makes Edge Functions the wrong runtime for video encoding.

## 2. Evidence This Spec Relies On

Accepted repo evidence:

- `INVESTIGATION_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md` proved the browser black hero is an asset-contract failure: stored public videos are `video/quicktime`, `.mov`, QuickTime/HEVC `hvc1`, no H.264 `avc1`, and sometimes non-fast-start.
- `REVIEW_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md` accepted the root cause: Mingla is publishing raw picker video without a browser-safe processing contract.
- `SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md` remains accepted for root-cause proof and public-page chrome requirements, but its rejection-first direction is superseded.
- `REVIEW_SPEC_ORCH-0770_BROWSER_SAFE_VIDEO_PIPELINE_FULL_FIX_AMENDMENT.md` requires raw phone video upload, in-app trim, server/provider/worker transcode, compressed browser-safe MP4 output, and processing status UX.
- ORCH-0766C/0766F history proves the current implementation was intentionally bounded: picker bytes go directly to Supabase Storage, MOV/QuickTime was allowed for real-device upload, and no provider/transcode dependency was introduced.

Current code/schema evidence:

- `mingla-business/src/services/eventCoverMediaService.ts:82-183` reads selected file bytes and uploads them directly to the public `event_covers` bucket.
- `mingla-business/src/services/eventCoverMediaService.ts:92-122` rejects selected files above `EVENT_COVER_MAX_BYTES`, which currently conflates source size with final cover size.
- `mingla-business/src/utils/eventCoverMediaRules.ts:3-6` defines 30 MB and 15 seconds as the visible upload rule.
- `mingla-business/src/utils/eventCoverMediaRules.ts:44-65` maps `mov`/`qt` to `video/quicktime` and `video/quicktime` to `.mov`.
- `mingla-business/src/utils/eventCoverMediaRules.ts:304-347` rejects videos over 15 seconds instead of offering a deterministic trim-and-process path.
- `mingla-business/src/components/event/CreatorStep4Cover.tsx:214-232` relies on native picker editing/export settings, but runtime evidence showed H.264 export settings did not guarantee browser-safe H.264 output.
- `mingla-business/src/components/event/PublicEventPage.tsx:407-420` places the public video sound control inside `EventCoverMedia` while page-level close/share chrome is separate, causing safe-area overlap.
- `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:34-54` creates `event_covers` as a public 30 MB bucket.
- `supabase/migrations/20260515000010_orch_0766f_event_cover_quicktime_mime.sql:6-28` explicitly permits `video/quicktime`, which helped uploads but enabled browser-hostile public video URLs.
- Current max local migration is `20260515000011_orch_0769_no_implicit_gbp_currency.sql`; the next migration in this spec must start at `20260515000012`.
- `mingla-business/package.json` has `expo-image-picker`, `expo-file-system`, and `expo-video`; there is no ffmpeg, Cloudinary, Mux, Transloadit, or video-processing dependency wired today.
- `supabase/functions/` has no event-cover video processor today.

Official provider/runtime evidence checked on 2026-05-09:

- Cloudinary supports local/remote/private uploads, video asset types, restricted delivery types, eager transformations, asynchronous eager generation, and webhook notifications. It also supports video transformations with MP4 output, H.264 codec selection, AAC audio codec selection, trim offsets/duration, and bitrate control. Sources: Cloudinary Upload Parameters, Eager Transformations, Video Transformations, Audio Transformations, and Video Optimization docs.
- Transloadit `/video/encode` supports ffmpeg-backed video encoding, video presets, libx264 MP4 output, and result metadata in assembly status. Source: Transloadit `/video/encode` and video preset docs.
- Mux supports direct uploads and static MP4 renditions, but its docs frame HLS as the default playback path and static renditions as a downloadable/secondary artifact. It does not cleanly own Mingla's "compress final cover to <=25 MB" contract by itself. Source: Mux Direct Uploads and Static MP4 Renditions docs.
- Supabase Edge Functions are Deno-compatible coordinator functions, not a video encoder runtime; Supabase docs state 200 ms active CPU execution time and explicitly recommend external services for heavy computation.

## 3. Product Promise

For organisers:

1. They can choose a normal phone-shot video, including iPhone `.MOV` / QuickTime / HEVC.
2. They are not rejected solely because the original source is over 25 MB.
3. If the source duration is longer than the cover limit, Mingla provides an in-app trim selection before processing.
4. After trim selection, Mingla uploads the raw source privately and processes the selected segment.
5. The final public cover is compressed to 25 MB or smaller.
6. If processing fails, the old cover remains unchanged and the organiser sees a clear retry/replace state.
7. A live event cover replacement has a visible save/apply action once processing is ready.

For public event visitors:

1. A video cover URL is always a browser-safe processed derivative.
2. Browser and app public pages play the cover, loop reliably, and recover after share-sheet or visibility return.
3. Sound is available by user action, and mute/sound controls are safe-area aware and tappable.

## 4. Non-Goals

- No Giphy integration.
- No Pexels integration.
- No brand media expansion.
- No profile media expansion.
- No ticket media expansion.
- No Stripe, currency, public-brand, or unrelated event-system work.
- No attempt to encode video inside Supabase Edge Functions.
- No automatic migration that destructively deletes historical covers without operator review.

## 5. Architecture

### 5.1 Primary Architecture: Cloudinary Managed Processing

Cloudinary is the recommended first implementation because it fits the exact shape Mingla needs with the least new operational machinery:

- signed client upload from Expo/business app;
- video asset ingest from phone MOV/HEVC;
- server-controlled eager asynchronous transformations;
- webhook notification on transformation completion/failure;
- trim via start offset and duration;
- output format/codec controls: MP4, H.264, AAC;
- bitrate control for deterministic final-size budget;
- CDN-hosted final derivative URL that can be stored in `events.cover_media_url`.

Required transformation intent:

```text
resource_type=video
format=mp4
video_codec=h264
audio_codec=aac when source has audio
start_offset=<trimStartSeconds>
duration<=15
width<=1280, height<=720, crop=limit
bit_rate max/constant profile that guarantees <=25 MB for <=15s
eager_async=true
eager_notification_url=<Supabase Edge webhook URL>
```

The implementor may express this through Cloudinary SDK params or signed REST params. Do not rely on `f_auto` for final event cover URLs because Cloudinary docs state it may choose VP9 WebM, HEVC MP4, or H.264 MP4 depending on browser/account. Mingla needs one deterministic artifact: `video/mp4` with H.264.

### 5.2 Secondary Architecture: Transloadit If Cloudinary Is Rejected

Transloadit is the best fallback because it exposes ffmpeg-backed `/video/encode` and presets with MP4/libx264 output. Use it if:

- Cloudinary account limits cannot support source sizes/operators need;
- Cloudinary webhooks or signed upload constraints are awkward for Expo;
- Mingla decides it wants provider-neutral assembly templates and explicit export jobs.

The same Mingla state machine, schema, final derivative contract, and UI contract apply. Only provider client functions change.

### 5.3 Not Recommended For This Fix

Mux:

- Good for video hosting/streaming.
- Static MP4 renditions are available, including during direct upload.
- Not the best first choice for a deterministic "single public cover MP4 <=25 MB" contract.

Dedicated ffmpeg worker:

- Technically correct.
- Higher operational burden: queue, worker hosting, storage ingress/egress, retries, monitoring, scaling, native ffmpeg security patches.
- Keep as future option only if managed provider cost/control becomes unacceptable.

Supabase Edge Function ffmpeg:

- Explicitly disallowed by this spec.
- Edge Functions may create signed upload intents, write jobs, validate webhooks, and apply ready derivatives.
- They must not decode/transcode/compress video bytes.

## 6. Media Contracts

### 6.1 Source Video Contract

Source videos:

- may be MOV, QuickTime, HEVC, MP4, WebM, or other provider-supported phone video formats;
- may exceed 25 MB;
- may exceed 15 seconds if the app can collect a trim selection before processing;
- must never be written directly to `events.cover_media_url`;
- must not be uploaded to the public `event_covers` bucket as the public cover.

Raw source operational ceiling:

- Remove the current 25/30 MB video source rejection from the video path.
- Add a separate operational source ceiling, default `EVENT_COVER_MAX_SOURCE_VIDEO_BYTES = 524288000` (500 MB), configurable by env/remote config.
- Add a separate operational source duration ceiling, default `EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS = 300000` (5 minutes), configurable by env/remote config.
- These are transport/device/provider safety ceilings only. The UI must not describe them as the cover size limit.
- If exceeded, copy must say: `This video is too large to upload from this device. Choose a shorter clip or record a new cover video.`

Reasoning: reading 500 MB into memory is unsafe, but direct signed upload to a provider is feasible. Current `readEventCoverFileBytes`/`Uint8Array` upload is acceptable for images/GIFs and small historical video tests, but it is not acceptable for large phone-video sources.

### 6.2 Trim Contract

The cover duration limit remains 15 seconds unless product explicitly changes it later.

If source duration is `<= 15000 ms`:

- trim UI is optional;
- default trim range is `0..sourceDuration`.

If source duration is `> 15000 ms`:

- the app must show an in-app trim selection before upload/process;
- the user chooses a 15-second-or-shorter segment;
- the provider receives `trim_start_ms` and `trim_end_ms`;
- the provider performs the actual trim during transcode.

Do not rely on `ImagePicker.videoMaxDuration` or `allowsEditing` as the only proof. Native picker trim can stay as a convenience, but Mingla must still own a visible deterministic trim selection/state and pass explicit trim offsets to the processing job.

MVP trim UI can be simple:

- show duration;
- show selected start time;
- show selected end time;
- provide a slider or stepper that moves a fixed 15-second window;
- preview the selected segment if practical;
- primary action: `Use this 15-second clip`.

No client-side ffmpeg/native trim dependency is required for this spec because trimming happens provider-side.

### 6.3 Final Public Derivative Contract

Only a processed derivative may become public event cover video.

Required final output:

| Requirement | Value |
| --- | --- |
| Max duration | `<= 15000 ms` |
| Max file size | `<= 25 MB` / `26214400 bytes` |
| Container | MP4 |
| MIME | `video/mp4` |
| Video codec | H.264 / AVC (`avc1`) |
| Disallowed video codecs | HEVC markers `hvc1` / `hev1` |
| Audio | AAC when source has audio; no audio is acceptable only when source has no audio or provider strips unusable audio with explicit metadata |
| Playback | progressive/browser-safe, fast-start or CDN behavior equivalent to immediate progressive playback |
| URL | HTTPS absolute URL |

Recommended encoding budget:

- output resolution cap: 1280x720;
- video bitrate: start at 2500 kbps max or constant;
- audio bitrate: 128 kbps;
- total at 15s is roughly 4.9 MB, leaving wide headroom below 25 MB;
- implementor may choose a higher bitrate only if automated verification still proves `<= 25 MB`.

The final 25 MB check is mandatory after provider processing. If a provider result is over 25 MB, Mingla must either request a lower-bitrate retry or mark the job failed. It must not apply the oversized derivative.

### 6.4 Images And GIFs

Images/GIFs can remain on the current direct Supabase Storage path in `event_covers`.

Do not route images/GIFs through the video provider in this spec unless the implementor proves it reduces complexity without changing behavior. This amendment is specifically for phone video covers.

## 7. Storage And URL Contracts

### 7.1 Raw Originals

Raw originals must be private or temporary.

Required:

- raw source URLs are never stored in `events.cover_media_url`;
- raw source URLs are never shown on public event pages;
- raw source provider IDs/URLs live only in the processing job row;
- raw source access is restricted by provider delivery type or deleted after processing;
- if the chosen provider cannot restrict raw source delivery, delete raw source immediately after the final derivative is verified.

### 7.2 Processed Derivatives

Processed derivatives may be stored as provider CDN URLs.

Required:

- `events.cover_media_url` may point at the Cloudinary secure URL for the processed derivative;
- `events.cover_media_type = 'video'`;
- URL must resolve as `video/mp4`;
- URL must be the transformed derivative URL, not the raw upload URL;
- derivative must be stable enough for public event pages and share traffic.

Optional future mirror:

- A later spec can mirror processed MP4 derivatives into a Supabase `event_cover_derivatives` bucket.
- Do not require mirroring in this implementation unless Cloudinary delivery policy or cost makes it necessary.

### 7.3 Existing `event_covers` Bucket

Keep `event_covers` for images/GIFs and historical assets.

Do not upload new public event-cover videos to `event_covers` unless they are already processed browser-safe MP4 derivatives and pass the final derivative validator. The primary video path should use provider processing rather than direct Supabase upload.

## 8. Database And RLS

Add a new migration:

```text
supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql
```

Do not use a prefix lower than `20260515000012`.

### 8.1 New Table

Create `public.event_cover_video_jobs`.

Required columns:

```sql
id uuid primary key default gen_random_uuid(),
event_id uuid not null references public.events(id) on delete cascade,
brand_id uuid not null references public.brands(id) on delete cascade,
requested_by uuid not null references auth.users(id) on delete cascade,
provider text not null check (provider in ('cloudinary','transloadit')),
status text not null check (
  status in (
    'created',
    'source_uploading',
    'source_uploaded',
    'processing_queued',
    'processing',
    'ready',
    'failed',
    'cancelled',
    'applied'
  )
),
apply_mode text not null check (apply_mode in ('draft_auto','published_manual')),
source_public_id text,
source_asset_id text,
source_mime_type text,
source_file_name text,
source_bytes bigint,
source_duration_ms integer,
trim_start_ms integer not null default 0,
trim_end_ms integer not null,
processed_public_id text,
processed_asset_id text,
processed_url text,
processed_mime_type text,
processed_bytes bigint,
processed_duration_ms integer,
processed_video_codec text,
processed_audio_codec text,
failure_code text,
failure_message text,
provider_payload jsonb not null default '{}'::jsonb,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
completed_at timestamptz,
applied_at timestamptz
```

Constraints:

- `trim_start_ms >= 0`.
- `trim_end_ms > trim_start_ms`.
- `trim_end_ms - trim_start_ms <= 15000`.
- when `status in ('ready','applied')`, `processed_url`, `processed_mime_type`, `processed_bytes`, and `processed_duration_ms` must be non-null.
- when `processed_bytes` is non-null, it must be `<= 26214400`.
- when `processed_duration_ms` is non-null, it must be `<= 15000`.
- when `processed_mime_type` is non-null, it must be `video/mp4`.

Indexes:

- `(event_id, created_at desc)`.
- `(brand_id, created_at desc)`.
- `(status, updated_at)`.
- unique partial index for active jobs per event:
  - one active job per event where status is not in `('failed','cancelled','applied')`.

### 8.2 RLS

Enable RLS.

Required policies:

- Event managers can select jobs for events whose brand role rank is `event_manager` or above.
- Event managers can insert jobs only through Edge Functions if possible. Preferred: deny direct client insert/update/delete and let Edge Functions use service role after verifying JWT and brand role.
- No public select.
- No direct client update/delete.

Reasoning: provider webhooks and apply actions need service-role writes. Public visitors do not need job metadata.

## 9. Edge Functions

Add these Supabase Edge Functions.

### 9.1 `event-cover-video-upload-intent`

Purpose:

- auth-required;
- verify current user has `event_manager` or above for the event brand;
- verify event exists and is not deleted;
- validate source metadata and trim range;
- create job row;
- return provider signed upload params or direct upload endpoint.

Input:

```json
{
  "eventId": "uuid",
  "brandId": "uuid",
  "applyMode": "draft_auto | published_manual",
  "sourceFileName": "IMG_0222.MOV",
  "sourceMimeType": "video/quicktime",
  "sourceBytes": 199472370,
  "sourceDurationMs": 33078,
  "trimStartMs": 12000,
  "trimEndMs": 27000
}
```

Output:

```json
{
  "jobId": "uuid",
  "provider": "cloudinary",
  "upload": {
    "url": "https://api.cloudinary.com/v1_1/<cloud>/video/upload",
    "fields": {}
  }
}
```

Rules:

- reject only operational raw-source limits, not the final 25 MB cover limit;
- never include provider API secret in the response;
- include `job_id`, `event_id`, `brand_id`, and `apply_mode` as signed metadata/context for the provider.

### 9.2 `event-cover-video-status`

Purpose:

- auth-required;
- verify user can manage the event;
- return the latest job status for an event or specific job.

Output:

```json
{
  "jobId": "uuid",
  "status": "processing",
  "processedUrl": null,
  "failureCode": null,
  "failureMessage": null
}
```

### 9.3 `event-cover-video-webhook`

Purpose:

- receive provider completion/failure notification;
- verify provider signature;
- map payload to job ID;
- verify transformed derivative metadata;
- update job status.

Required verification before marking `ready`:

- provider says transformation succeeded;
- derivative URL is HTTPS;
- MIME/content type is `video/mp4`;
- duration `<= 15000 ms`;
- bytes `<= 26214400`;
- codec metadata proves H.264 and AAC when audio exists, or a follow-up HTTP/byte probe proves `avc1` and absence of `hvc1`/`hev1`;
- public URL can be fetched/ranged;
- failed verification marks job `failed` with actionable `failure_code`.

For `apply_mode = 'draft_auto'`:

- after ready verification, the function may update the draft event row's `cover_media_url/type` if the event is still draft and the job is still the latest active job for that event.

For `apply_mode = 'published_manual'`:

- do not update `events.cover_media_url` automatically;
- leave job `ready` so UI can show preview and `Save cover`.

### 9.4 `event-cover-video-apply`

Purpose:

- auth-required;
- verify event-manager role;
- verify job is `ready`;
- verify job belongs to event/brand;
- atomically update `events.cover_media_url = processed_url`, `cover_media_type = 'video'`, `updated_at = now()`;
- mark job `applied`;
- cancel older active jobs for that event.

This is required for already-live event edits so the organiser has a clear save/apply action.

### 9.5 `event-cover-video-cancel`

Purpose:

- auth-required;
- verify role;
- mark a non-terminal job `cancelled`;
- optionally request provider raw/source cleanup.

## 10. Environment And Secrets

Required:

```text
EVENT_COVER_VIDEO_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
EVENT_COVER_VIDEO_WEBHOOK_SECRET=...
EVENT_COVER_FINAL_MAX_BYTES=26214400
EVENT_COVER_MAX_DURATION_MS=15000
EVENT_COVER_MAX_SOURCE_VIDEO_BYTES=524288000
EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS=300000
EVENT_COVER_VIDEO_TARGET_MAX_BITRATE=2500k
EVENT_COVER_VIDEO_TARGET_AUDIO_BITRATE=128k
```

Optional:

```text
CLOUDINARY_EVENT_COVER_UPLOAD_PRESET=...
EVENT_COVER_VIDEO_TARGET_WIDTH=1280
EVENT_COVER_VIDEO_TARGET_HEIGHT=720
TRANSLOADIT_AUTH_KEY=...
TRANSLOADIT_AUTH_SECRET=...
TRANSLOADIT_TEMPLATE_ID=...
```

If required provider env is missing:

- Step 4 video upload must be disabled with clear copy: `Video cover processing is not configured yet. Images and GIFs still work.`
- The app must not fall back to direct raw MOV upload.
- Images/GIFs remain available.

## 11. Business App Service And UI Contract

### 11.1 Split Image/GIF Direct Upload From Video Processing

`uploadEventCoverMedia` can continue owning images/GIFs.

Video needs a new service path, for example:

```ts
createEventCoverVideoJob(...)
uploadSourceVideoToProvider(...)
pollEventCoverVideoJob(...)
applyEventCoverVideoJob(...)
cancelEventCoverVideoJob(...)
```

Do not read large video source files into memory with `readEventCoverFileBytes`.

### 11.2 Step 4 States

Step 4 must show these states:

| State | User-visible behavior |
| --- | --- |
| No media | Hue preview plus upload actions |
| Selecting video | Picker opens |
| Trim required | In-app trim selector appears before upload |
| Uploading source | Progress/spinner: `Uploading video...` |
| Processing queued | `Preparing your cover video...` |
| Processing | `Compressing video for web playback...` |
| Ready draft | Preview processed cover; draft gets processed URL only after ready |
| Ready live edit | Preview processed cover and show `Save cover` |
| Failed | Old cover remains; show `We couldn't prepare this video. Try another clip.` |
| Cancelled | Return to prior cover/no cover |

Visible helper copy:

```text
Images and GIFs upload directly. Videos can be phone-shot clips; Mingla trims and compresses them into a web-ready cover up to 15 seconds.
```

Do not show `Covers must be 25 MB or smaller` for selected video sources. That message belongs only to final derivative verification failure, which should be rare and internal/retryable.

### 11.3 Draft Event Behavior

For draft events:

- Selecting a video starts a job.
- Existing cover remains until job ready.
- Draft `coverMediaUrl/type` is updated only with the processed derivative.
- Publish is blocked while a selected cover video job is uploading/processing:
  - copy: `Your cover video is still processing. Wait a moment or remove it before publishing.`
- If processing fails, publish can continue with the previous cover/hue after the user acknowledges or removes the failed job.

### 11.4 Published Event Edit Behavior

For live/published events:

- Selecting/replacing a cover video starts a `published_manual` job.
- The live event keeps the old cover throughout upload/processing.
- When ready, the edit screen shows the processed preview and an enabled `Save cover` action.
- Pressing `Save cover` calls `event-cover-video-apply`.
- If apply fails, the old live cover remains and the UI shows: `Couldn't save the new cover. Try again.`
- If processing fails, the old live cover remains and the UI shows: `We couldn't prepare this video. Try another clip.`

This directly fixes the operator-observed issue where an already-live event cover could be edited but not saved.

## 12. Public Event Playback And Chrome

### 12.1 Public Playback

`EventCoverMedia` / public page video must assume all new video URLs are processed MP4 derivatives.

Required behavior:

- web uses `<video playsInline loop preload="auto">`;
- native uses `expo-video`;
- video attempts to resume loop on app active, browser visibility return, browser focus return, and after share sheet closes;
- autoplay may initialize muted on web due to browser policy;
- user can turn sound on with a tap;
- sound state remains coherent after share sheet open/close.

### 12.2 Safe-Area Chrome

Public page must own a single safe-area-aware top media chrome layout.

Required:

- close/share/sound controls are in one coordinated row/zone;
- sound button is not positioned inside `EventCoverMedia` for public hero;
- sound button does not overlap close icon, share icon, Safari top chrome, or app safe area;
- minimum hit target 40x40;
- owner mode: close + sound + share;
- buyer mode: sound + share;
- controls remain reachable without scrolling.

Recommended layout:

- top row at `insets.top + spacing.sm`;
- left slot for close when present;
- right slot horizontal group for sound and share;
- if close/share density conflicts on small devices, put sound/share in a second row at `insets.top + spacing.sm + 48`.

## 13. Existing Bad MOV/HEVC Covers

Do not silently treat historical raw MOV/HEVC covers as fixed.

Required:

1. Add a public-page safety guard for known unsafe historical video URLs:
   - `.mov` paths;
   - `video/quicktime` headers when detectable;
   - Supabase `event_covers` video URLs that are not known processed derivatives.
2. If unsafe, render hue fallback instead of black video and log/report `legacy_unsafe_video_cover`.
3. Add an organiser-facing replace path: existing events with unsafe video cover should show `Replace video cover` guidance in edit mode.
4. Produce a one-time SQL/report query listing events where `cover_media_type='video'` and URL likely points to historical raw MOV/QuickTime.
5. No automatic destructive backfill in this spec. A later operator-approved backfill may clear or reprocess historical covers.

## 14. Tests And Gates

### 14.1 Unit/Service Tests

Add/update in `mingla-business`:

- video source validation no longer rejects over-25MB/over-30MB source solely because source is large;
- video source over operational ceiling rejects with operational copy;
- over-15s source enters trim-required state rather than direct rejection;
- trim range cannot exceed 15 seconds;
- final derivative validator accepts only `video/mp4`, H.264, AAC/no-audio, fast-start/progressive, `<=25MB`, `<=15s`;
- final derivative validator rejects QuickTime, HEVC, non-fast-start, oversized, over-duration.

Rewrite tests that currently encode raw MOV as a valid public cover success.

### 14.2 Edge Function Tests

Add Deno tests or repo-standard function tests for:

- upload intent requires auth;
- upload intent rejects wrong brand role;
- upload intent creates job with valid trim;
- webhook rejects missing/bad signature;
- webhook marks failed on provider failure;
- webhook marks failed on derivative over 25 MB;
- webhook marks failed on non-MP4 or HEVC metadata;
- webhook ready does not auto-apply for `published_manual`;
- apply requires manager role and ready job;
- apply updates event cover atomically and marks job applied.

### 14.3 Migration/RLS Guards

Add strict grep/static guard:

- migration prefix is `20260515000012`;
- table `event_cover_video_jobs` exists;
- RLS enabled;
- no public select;
- no direct client update/delete;
- active-job unique partial index exists;
- processed byte/duration/MIME constraints exist.

### 14.4 UI Tests

Add focused tests/source guards:

- Step 4 video path calls processing service, not direct `uploadEventCoverMedia`;
- Step 4 shows trim UI for over-15s videos;
- publish blocked while cover job processing;
- live edit shows `Save cover` only after processed ready;
- failure preserves previous cover;
- public page controls are page-owned, safe-area aware, and not nested under public `EventCoverMedia`.

### 14.5 Browser/App Runtime Gates

Tester must verify on real device and browser:

1. iPhone 8-second MOV larger than 25 MB source uploads, processes, and becomes a public MP4 cover.
2. iPhone 30-second MOV opens trim UI; selected 15-second segment processes.
3. Final derivative URL HEAD/GET proves `video/mp4`, positive bytes, and `<=25 MB`.
4. Browser public event page plays the video, not black.
5. Browser public event page loops after share sheet open/close and visibility return.
6. User can turn sound on and mute again.
7. App public preview sound button is reachable and not under close/share/safe area.
8. Processing failure leaves old cover unchanged.
9. Live event replacement has a working `Save cover`.

## 15. Deployment And Rollback

Deployment order:

1. Add provider account/config and secrets.
2. Push migration `20260515000012...`.
3. Deploy Edge Functions:
   - `event-cover-video-upload-intent`
   - `event-cover-video-status`
   - `event-cover-video-webhook`
   - `event-cover-video-apply`
   - `event-cover-video-cancel`
4. Configure provider webhook URL and secret.
5. Deploy business app changes.
6. Runtime-test with real iPhone MOV before enabling broadly.

Rollback:

- If provider processing fails in production, disable video processing through env/feature flag.
- Images/GIFs remain active.
- Do not revert migration unless no deployed code references the job table.
- Existing ready/applied processed URLs remain valid.
- Pending jobs can be marked `cancelled`.

Monitoring:

- log job status transitions;
- log provider failure codes;
- alert on webhook signature failures;
- alert when `failed / created` ratio exceeds an agreed threshold;
- alert when derivative verification fails for size/MIME/codec.

## 16. Success Criteria

This amendment is complete only when:

1. New video source selection does not reject merely because the source is over 25 MB.
2. Over-15s source videos get an in-app trim selection.
3. Raw source videos are private/temporary and never public cover URLs.
4. Final public video derivatives are MP4/H.264/AAC, `video/mp4`, `<=15s`, and `<=25MB`.
5. Draft events only receive processed video URLs.
6. Live event edits keep old cover until the processed replacement is saved.
7. Public browser event pages no longer show black heroes for new video covers.
8. Public page sound/share/close chrome is safe-area aware and tappable.
9. Historical unsafe video covers do not keep rendering as black; they fall back or are flagged for replacement.
10. Automated tests and runtime gates prove the above.

## 17. Open Questions For Orchestrator, Not Implementor Blockers

- Exact Cloudinary account limits and billing impact must be confirmed before broad rollout.
- Whether raw originals should be retained briefly for support/debugging or deleted immediately after derivative ready is a policy decision. Default should be delete after successful verification.
- Whether future Giphy/Pexels results should reuse the same processed derivative table or a broader `media_assets` table should be decided in the later media expansion spec.

## 18. Final Verdict

ORCH-0770 cannot be closed with another player-only or MIME-only patch.

The root cause is already proven: browser pages are receiving raw phone video artifacts. The full fix is to add a processing pipeline where large phone video sources are accepted, trimmed in-app, processed by a managed video provider, compressed to a `<=25 MB` browser-safe MP4 derivative, and only then applied as the public cover.
