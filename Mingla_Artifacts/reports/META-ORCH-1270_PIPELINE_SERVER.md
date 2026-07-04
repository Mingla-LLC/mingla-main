# META-ORCH-1270 — Server-Side Cover-Video Pipeline Map + Cloudinary Dependency List

**Date:** 2026-07-03 · Read-only static trace (traced by orchestrator after the background agent failed twice with 0 tool calls).
**Files:** `event-cover-video-upload-intent`, `event-cover-video-source-uploaded`, `event-cover-video-webhook`, `event-cover-video-cancel`, `event-cover-video-apply`, `_shared/eventCoverVideo.ts`, migrations for `event_cover_video_jobs`.

---

## HEADLINE: a provider seam already exists

`providerConfigured()` (`_shared/eventCoverVideo.ts:249-256`) keys on **`EVENT_COVER_VIDEO_PROVIDER`
(default `"cloudinary"`)**, and every job row is stamped `provider: "cloudinary"`
(`upload-intent/index.ts:270`). The **job table, its state machine, the result validation, and the
status→UI mapping are all provider-agnostic.** Cloudinary-specific code is concentrated in ~6 small
functions. So swapping providers is **adding a branch behind an existing seam, not rewriting the
pipeline.** This is why the migration is far less risky than it feels.

## Numbered server pipeline

1. **UPLOAD-INTENT** (`event-cover-video-upload-intent/index.ts`) — auth (`requireUserId`) + role gate
   (`requireEventManager` ≥ event_manager / `requireBrandCoverManager` ≥ brand_admin); validates source
   bytes/duration/trim; **supersedes** prior active jobs (marks them `cancelled`); inserts a new
   `event_cover_video_jobs` row (`status: source_uploading`, `provider: cloudinary`); builds a
   **signed Cloudinary direct-upload** and returns to the client: `upload.url =
   https://api.cloudinary.com/v1_1/{cloud}/video/upload` + `upload.fields` (api_key, signature,
   timestamp, public_id, `resource_type:video`, context, **eager**, `eager_async:true`,
   `eager_notification_url`). **The client uploads straight to Cloudinary** with these fields.
2. **DIRECT UPLOAD** — happens client→Cloudinary (not through our server). The eager transform is the
   server-side transcode: `c_limit,w_1280,h_720, du_{sec}, vc_h264, ac_aac, br_{clamped}, f_mp4,
   q_auto:good` → a ≤720p H.264/AAC MP4, duration-capped, bitrate-clamped to land ~≤25 MB
   (`upload-intent/index.ts:313-321` + `clampBitrate:20-25`).
3. **SOURCE-UPLOADED** (`event-cover-video-source-uploaded`) — client acks; server records actual bytes,
   advances the job. (Vector C: the real byte count is known here but not enforced against a cap.)
4. **WEBHOOK** (`event-cover-video-webhook`) — Cloudinary calls the `eager_notification_url` when the
   async derivative is ready; server **verifies the notification signature** (`sha1(rawBody + timestamp
   + secret)`, `_shared:330-395`), validates the derivative (`assertProcessedDerivative`: https URL,
   `video/mp4`, ≤25 MB, ≤30 s, H.264/AAC — `_shared:421-465`), and transitions the job to `ready` with
   `processed_url`.
5. **APPLY** (`event-cover-video-apply`) — writes `cover_media_url` + `cover_media_type='video'` onto the
   event/brand.
6. **CANCEL / DESTROY** (`event-cover-video-cancel` → `cloudinaryDestroy`, `_shared:276-324`) — POST to
   `api.cloudinary.com/v1_1/{cloud}/video/destroy`. (Vector C: this is the ONLY destroy path — no reap on
   supersede/failure/replace/delete.)
7. **DB MODEL** — `event_cover_video_jobs` with states `source_uploading → source_uploaded →
   processing_queued → processing → ready → applied` (+ `failed`, `cancelled`); `cover_media_url/type`
   live on `events` / `brands` / `venue_listings`. Status→UI mapping in `mapEventCoverVideoStatus`
   (`_shared:597-643`) drives the client progress bar — **provider-agnostic.**

## Cloudinary capability dependency list

| # | Capability | Where | Load-bearing? | Replacement exists? |
|---|-----------|-------|---------------|---------------------|
| a | Signed **direct client→provider upload** | `cloudinarySignature` `_shared:266-274`; fields `upload-intent:365-387` | LOAD-BEARING | YES — Cloudflare "direct creator upload" (one-time URL), bunny direct upload, or upload via our own edge fn → Supabase Storage signed URL |
| b | **Async transcode** to bounded H.264/AAC MP4 | eager string `upload-intent:313-321` | LOAD-BEARING **unless the client already compresses** (see client trace) | YES — Cloudflare Stream & bunny Stream transcode natively; **eliminated** if client-side compression is sufficient → plain Supabase Storage |
| c | **Webhook on ready** | `verifyCloudinaryNotificationSignature` `_shared:330-395`; webhook fn | LOAD-BEARING (async model) | YES — CF Stream & bunny Stream fire webhooks; or poll; **not needed** if upload is synchronous (client compresses then uploads a final file) |
| d | **Poster/thumbnail** (first frame) | `deriveCoverPosterUrl` `so_0` `coverMediaPresentation.ts:63-79` | NICE-TO-HAVE | YES — CF Stream & bunny auto-thumbnail; Supabase needs a client-captured still or a frame-extract fn |
| e | **Destroy/delete** asset | `cloudinaryDestroy` `_shared:276-324` | LOAD-BEARING (cleanup) | YES — all providers have a delete API / Supabase Storage remove() |
| f | **CDN delivery** + immutable caching | delivery URLs | LOAD-BEARING | YES — CF CDN, bunny CDN, Supabase Storage CDN all provide it |

**Conclusion:** every Cloudinary capability here has a like-for-like replacement, and capabilities (b)
and (c) may disappear entirely if the client already produces a final web-ready MP4 (pending the client
trace). The provider-agnostic core (job table, states, result validation, status UI) is **reused
unchanged** on any path.
