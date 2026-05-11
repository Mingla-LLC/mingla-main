# INVESTIGATION ORCH-0783: Event Cover Image Provider Pivot

Date: 2026-05-11  
Mode: INVESTIGATE  
Skill: Codex `forensics` parity mirror  
Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot`  
Output: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`

## Executive Verdict

Proceed to SPEC.

The safest launch pivot is to make event Step 4 image-first and provider-backed while preserving all existing published-cover rendering contracts:

1. Remove the user-facing hue chooser from event create/edit Step 4.
2. Remove new user-facing event-cover video upload, processing, timeout, retry, and cancel controls from Step 4.
3. Keep local image/GIF upload.
4. Add separate GIPHY GIF and Pexels photo selection surfaces.
5. Keep `coverHue` as an internal fallback/backcompat field for now.
6. Keep existing video schema, migrations, Edge Functions, service files, and public rendering guards dormant until a later SPEC explicitly defines legacy handling.

This is a product pivot away from a fragile launch path, not permission to delete the video architecture. Existing rows can still contain `cover_media_type = 'video'`; public, checkout, order, and organiser surfaces already know how to render or safely fall back from those rows. The first implementation should disable new video entry points, not rewrite history.

## Customer Pain And Business Impact

Organisers need a cover workflow that feels instant, expressive, and reliable. The current active flow lets them choose hue, image/GIF, or phone video. The video path has required repeated work across native picker behavior, raw MOV/QuickTime acceptance, Cloudinary processing, source-upload acknowledgement, webhook status, progress UI, public browser playback, native playback, and provider configuration.

The launch benefit of pivoting is high:

| Lens | Impact |
| --- | --- |
| Customer value | Organisers get attractive covers without waiting on video processing or deciphering upload failures. |
| Activation/adoption | Event creation Step 4 becomes simpler and harder to get stuck in. |
| Retention/trust | Public pages avoid black video heroes and stale processing states as a first impression. |
| Revenue | Better public event covers support ticket conversion without blocking checkout readiness on Cloudinary/video runtime proof. |
| Operational complexity | GIPHY/Pexels/image flows are materially smaller than phone-video transcode and webhook operations. |
| Strategic urgency | This unblocks launch by deferring the riskiest media pipeline to a senior dedicated pass. |

## Phase 0 Historical Context

Artifacts read before conclusion:

| Artifact | Proven relevance |
| --- | --- |
| `ROOT_CAUSE_REGISTER.md` RC-0770 | Public event cover videos accepted native-only QuickTime/HEVC assets as web-public media; Cloudinary processing remains a still-sensitive architecture. |
| `ROOT_CAUSE_REGISTER.md` RC-0774A/0774B | Auth readiness and brand-list honesty can affect Step 4 and auth-required video handoff. GIPHY/Pexels remain separate follow-ups. |
| `INVESTIGATION_ORCH-0770_PUBLIC_EVENT_VIDEO_BROWSER_BLACK_HERO.md` | Runtime probes showed public cover video assets served as `video/quicktime`, using HEVC markers and sometimes non-fast-start ordering. |
| `SPEC_ORCH-0770_BROWSER_SAFE_EVENT_COVER_VIDEO_PIPELINE.md` | First browser-safe spec explicitly excluded Pexels and GIPHY. |
| `SPEC_AMENDMENT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md` | Cloudinary video was chosen for a full phone-video pipeline; Supabase Edge Functions coordinate only, not transcode. |
| `IMPLEMENTATION_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION.md` | Implemented Cloudinary-backed upload intent/status/webhook/apply/cancel plus public unsafe-video fallback. |
| `TEST_REPORT_ORCH-0770_FULL_PHONE_VIDEO_TRANSCODE_COMPRESSION_RUNTIME.md` | Static/deploy checks passed, but real phone-video -> processed MP4 -> public playback still required operator-assisted runtime evidence. |
| `INVESTIGATION_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_PROGRESS_STALL.md` and `QA_ORCH-0776_EVENT_COVER_VIDEO_PROCESSING_SPEED_AND_STATUS_RETEST.md` | Video status/progress bridge was later repaired and conditionally accepted, but this confirms how much launch surface video owns. |
| `SPEC_ORCH-0758A_EVENT_PUBLIC_TICKET_COVER_MEDIA.md` | Original event cover media scope added image/GIF/video upload and rendering, explicitly deferred GIPHY/Pexels, and kept `coverHue` as fallback. |
| `INVESTIGATION_BIZ_CYCLE_17D_PERF_PASS.md` | Older provider concept recommended event-cover provider picker first, with GIPHY/Pexels via an edge proxy concept; current official docs require splitting GIPHY/Pexels implementation shape. |

Memory read: project memory, forensic thoroughness, and strict-grep registry rules. Relevant active memory: new invariant gates must register as one script plus one job in `.github/workflows/strict-grep-mingla-business.yml`, not a parallel workflow.

## Current Behavior Map

### Event create/edit Step 4

Entry point: organiser opens Step 4 in the event creator or cover-only published edit flow.

Current happy path:

`Step 4 preview -> Upload/Replace cover -> native alert -> Image or GIF OR Video -> local upload OR Cloudinary video processing -> draft/live event cover fields update -> EventCoverMedia preview -> later surfaces render coverMediaUrl/type or hue fallback`

Evidence:

| File | Current behavior |
| --- | --- |
| `mingla-business/src/components/event/CreatorStep4Cover.tsx:5-6` | File comment says uploaded image/GIF/video is canonical and hue grid is fallback. |
| `CreatorStep4Cover.tsx:24-43` | Imports local media service and full video processing service. |
| `CreatorStep4Cover.tsx:59-68` | Defines visible hue tile values and video processing state machine. |
| `CreatorStep4Cover.tsx:128-133` | `handleSelectHue` writes `coverHue`. |
| `CreatorStep4Cover.tsx:350-489` | Implements video upload intent, provider source upload, source-upload acknowledgement, status polling, processed URL apply, and `coverMediaType: "video"`. |
| `CreatorStep4Cover.tsx:506-545` | Implements local image picker with `mediaTypes: ["images"]`. |
| `CreatorStep4Cover.tsx:547-637` | Implements video picker with `mediaTypes: ["videos"]`, native trim settings, validation, and Cloudinary processing handoff. |
| `CreatorStep4Cover.tsx:639-655` | User-facing alert offers `Image or GIF` and `Video`. |
| `CreatorStep4Cover.tsx:798-865` | Renders video processing text, progress bar, timeout recovery, `Replace video`, and `Cancel processing`. |
| `CreatorStep4Cover.tsx:873-898` | Renders user-facing `Cover style` hue grid. |

### Shared rendering and published/public surfaces

Current render path:

`coverMediaUrl/type present -> EventCoverMedia chooses image/gif/video -> video uses web video or expo-video native player -> render error falls back to EventCover hue -> public page additionally blocks legacy unsafe MOV/QuickTime`

Evidence:

| File | Current behavior |
| --- | --- |
| `mingla-business/src/components/ui/EventCoverMedia.tsx:79-216` | Implements web and native video playback through HTML `<video>` and `expo-video`. |
| `EventCoverMedia.tsx:268-273` | Resolves media presentation from URL/type/error/reduce-motion. |
| `EventCoverMedia.tsx:298-310` | Falls back to `EventCover` hue when media is missing or errors. |
| `EventCoverMedia.tsx:319-340` | Renders video/video-still or image/GIF and conditionally shows audio control for video. |
| `mingla-business/src/components/event/PublicEventPage.tsx:413-418` | Uses `isLegacyUnsafeEventCoverVideoUrl` to null out unsafe legacy MOV/QuickTime before render. |
| `PublicEventPage.tsx:445-456` | Public hero renders `EventCoverMedia` and video audio control only when safe type is video. |
| `mingla-business/app/checkout/[eventId]/index.tsx:240-243` | Checkout uses `EventCoverMedia` with event `coverHue`, `coverMediaUrl`, and `coverMediaType`. |
| `mingla-business/app/o/[orderId].tsx:321-324` | Order view uses `EventCoverMedia` with the same cover fields. |
| `mingla-business/src/components/event/EventListCard.tsx:148-151` | Organiser event cards render cover media/fallback. |
| `mingla-business/src/components/event/CreatorStep7Preview.tsx:115-118` | Preview step renders cover media/fallback. |

### Validation and services

Evidence:

| File | Current behavior |
| --- | --- |
| `mingla-business/src/utils/eventCoverMediaRules.ts:3-6` | Upload copy still promises videos are trimmed and compressed. |
| `eventCoverMediaRules.ts:44-65` | Maps GIF/image and video MIME/extension, including MOV/QuickTime. |
| `eventCoverMediaRules.ts:176-195` | Classifies MP4/MOV/QuickTime/WebM/picker video as `video`. |
| `eventCoverMediaRules.ts:304-347` | Validates video duration and accepts video when duration is valid. |
| `eventCoverMediaRules.ts:378-398` | Presentation resolver supports `video` and `video_still`. |
| `eventCoverMediaRules.ts:400-411` | Identifies legacy unsafe `.mov`, `.qt`, and QuickTime URLs. |
| `mingla-business/src/services/eventCoverMediaService.ts:82-184` | Local upload path reads bytes, validates media, uploads to public `event_covers`, verifies URL, and returns URL/type. |
| `eventCoverMediaService.ts:186-218` | Published cover-only update writes `events.cover_media_url/type`. |
| `mingla-business/src/services/eventCoverVideoProcessingService.ts:5-12` | Video constants and copy define final 25 MB processed video, 500 MB source budget, 15s duration, and "Images and GIFs still work" fallback. |

### Schema and migrations

Latest local migration prefix: `20260515000017`.

Current durable DB/storage truth:

| Migration | Evidence |
| --- | --- |
| `20260505000000_baseline_squash_orch_0729.sql:7806-7819` | `events.cover_media_url` and `cover_media_type` exist; check allows `image`, `video`, and `gif`. |
| `20260515000002_orch_0758a_event_cover_storage.sql:37-47` | Public `event_covers` bucket allows image and video MIME types. |
| `20260515000010_orch_0766f_event_cover_quicktime_mime.sql:60-74` | Later migration keeps/adds QuickTime/MOV MIME support for event covers. |
| `20260515000012_orch_0770_event_cover_video_processing.sql:6-124` | Adds `event_cover_video_jobs`; comments processed URL as browser-safe MP4 derivative and says raw source URLs must not be written to `events.cover_media_url`. |
| `20260515000014_orch_0776d_event_cover_video_cancelled_at.sql:4-12` | Adds `cancelled_at` and backfills stuck job rows. |

Conclusion: video is part of persisted historical state. A launch pivot should not drop `cover_media_type = 'video'`, `event_cover_video_jobs`, `event_covers` video MIME allowances, or Edge Functions in this pass.

## Desired Behavior Map

Recommended launch path:

`Step 4 preview -> choose Upload Image/GIF, GIPHY, or Pexels -> select valid media -> write cover URL/type/provider metadata -> preview updates -> publish/save -> public/checkout/order/card surfaces render image/GIF/provider media and attribution where required -> no video upload or hue chooser is exposed`

Negative expectations:

| Case | Expected behavior |
| --- | --- |
| No cover selected | Internal fallback still renders without exposing hue picker. Recommended fallback is existing warm `coverHue = 25` until UI/UX defines a replacement. |
| Existing published video cover | Continue to render through current safe path or fall back for legacy unsafe MOV/QuickTime. Do not break existing events. |
| User tries local video through OS picker | Active Step 4 should not open a video picker; service-level validation should reject video for the active local-upload path after SPEC defines the exact adapter split. |
| GIPHY provider unavailable | Show visible provider-specific error; local image/GIF and Pexels remain usable. |
| Pexels key/rate limit/network failure | Show visible provider-specific error; local image/GIF and GIPHY remain usable. |
| Missing attribution metadata | Selection should be blocked or treated as invalid; do not publish provider media without required source/credit metadata. |

## Provider/API Contract Findings

Official docs checked on 2026-05-11.

### GIPHY

Sources:

- GIPHY API docs, Quickstart/Attribution/Best Practices: `https://developers.giphy.com/docs/api/`
- GIPHY Search endpoint: `https://developers.giphy.com/docs/api/endpoint#search`
- GIPHY schema/renditions: `https://developers.giphy.com/docs/api/schema#image-object`

Findings:

| Topic | Official-doc evidence | Launch recommendation |
| --- | --- | --- |
| Endpoint | Search uses `api.giphy.com/v1/gifs/search`; required params include `api_key` and `q` (`docs/api` lines 203-221). | Use GIF Search only for ORCH-0783; do not add stickers/clips. |
| Client-side rule | GIPHY says Search must be called from the client side and the exact user query should be sent (`docs/api` lines 203-205). | Do not put GIPHY behind the same Supabase proxy as Pexels unless legal/provider approval explicitly supersedes docs. |
| Rating/content safety | Search supports `rating` with values including `g`, `pg`, `pg-13`, `r` (`docs/api` lines 207, 221). | Default to `pg` or `pg-13` pending product/legal choice; SPEC must pick one. |
| Attribution | GIPHY requires conspicuous `Powered By GIPHY` where the API is used (`docs/api` lines 133-135). | Show GIPHY attribution in the GIPHY picker and any selected-cover attribution surface required by legal/product. |
| Renditions | Docs recommend smaller fixed-height/fixed-width renditions for preview grids and higher resolution once selected (`docs/api` lines 141-148). Schema includes `downsized`, `downsized_medium`, `downsized_small`, and `original` media fields (`schema` lines 267-317). | Use smaller rendition in grid. For stored selected URL, prefer `images.downsized_medium.url` or a SPEC-chosen higher-quality GIF rendition; do not store MP4 as `gif` unless the renderer/data contract changes. |
| No cache/proxy/mixing | GIPHY says not to strip URLs, cache API/media/copies, proxy API/media requests, reorder/filter, or mix GIPHY content with other providers in the same grid (`docs/api` lines 149-154). | Store returned URL and metadata only; do not download/copy to Supabase. Keep GIPHY in its own tab/grid. |
| Analytics | GIPHY recommends Action Register analytics for views/clicks/sends (`docs/api` lines 124-128; schema lines 917-955). | SPEC must decide whether to implement analytics pingbacks now or document it as a launch/legal condition. |
| Keys | GIPHY requires separate keys per platform/section (`docs/api` lines 110-115). | Env setup should use platform/section-scoped public keys if GIPHY approves the app for production. Do not introduce secrets in code/artifacts. |

Recommended stored type: `cover_media_type = 'gif'` when the stored URL is a `.gif` rendition. If using GIPHY MP4 renditions for performance, SPEC must either add a provider-specific render contract or store it as `video` only if legacy video rendering remains intentionally supported for provider MP4s. For the safest launch pivot, store/select GIF URL and type `gif`.

### Pexels

Source:

- Pexels API docs: `https://www.pexels.com/api/documentation/`

Findings:

| Topic | Official-doc evidence | Launch recommendation |
| --- | --- | --- |
| Endpoint | Photo search is `GET https://api.pexels.com/v1/search`; `query` is required; `orientation`, `size`, `color`, `locale`, `page`, and `per_page` are optional (`documentation` lines 313-342). | Use photo search only; default `orientation=landscape`; do not add Pexels video in this pivot. |
| API key | Requests require an `Authorization` header with the API key (`documentation` lines 94-106). | Proxy Pexels through a Supabase Edge Function or other server-owned boundary. Do not expose the key in `EXPO_PUBLIC_*` unless security/product explicitly accepts that risk. |
| Rate limits | Default limit is 200/hour and 20,000/month; abuse can terminate access (`documentation` lines 39-40). Successful responses include `X-Ratelimit-*` headers and docs say to track remaining/reset (`documentation` lines 137-156). | Server proxy should rate-limit/debounce and surface friendly 429/limit errors. |
| Attribution | Pexels asks apps to show a prominent Pexels link for API requests and credit photographers when possible (`documentation` lines 34-37). | Persist and render credit/source metadata. Safer launch stance: public selected-cover surface should show `Photo by {photographer} on Pexels` or an equivalent compact credit/link. |
| Photo fields | Photo resource includes `url`, `photographer`, `photographer_url`, `src`, `avg_color`, and `alt` (`documentation` lines 190-264). | Normalize all of these fields; at minimum persist URL, photographer, photographer URL, selected src URL, and alt. |
| 16:9-ish cover URL | `src.landscape` is cropped to 1200 x 627 (`documentation` lines 250-257 and 300-308). | Store/render `src.landscape` by default for event covers. |

Recommended stored type: `cover_media_type = 'image'`; store `src.landscape` as the selected cover URL and persist source/credit/alt metadata.

## Security, Privacy, And API-Key Recommendation

| Provider | Key handling recommendation | Reason |
| --- | --- | --- |
| GIPHY | Client-side platform/section public keys, if approved and production-upgraded by GIPHY. Do not proxy/cache GIPHY API/media. | GIPHY docs require client-side API calls and prohibit proxying API/media requests. |
| Pexels | Server-side Supabase Edge Function proxy with `PEXELS_API_KEY` stored as an Edge Function secret. | Pexels uses an `Authorization` header key and rate-limit headers that the server should track. |

No provider keys, secrets, tokens, local secret files, or env contents were read or written in this investigation. Later implementation must not commit provider secrets.

## File-By-File Blast Radius

### Must change in SPEC/implementation

| File | Required direction |
| --- | --- |
| `mingla-business/src/components/event/CreatorStep4Cover.tsx` | Remove active video picker, video processing imports/state/copy/recovery UI, and hue picker UI. Add local image/GIF, GIPHY, and Pexels entry points. Keep preview fallback. |
| `mingla-business/src/utils/eventCoverMediaRules.ts` | Update active upload copy and active local-upload validation so Step 4 no longer promises or accepts new video upload. Preserve legacy presentation helpers until SPEC defines video retirement. |
| `mingla-business/src/services/eventCoverMediaService.ts` | Keep image/GIF Supabase upload. Decide whether video rejection belongs here globally or in a new Step 4 local-upload adapter so legacy code/tests can remain explicit. |
| `mingla-business/src/store/draftEventStore.ts` | Add provider metadata fields if not stored elsewhere: provider, source URL, credit, credit URL, alt. Preserve `coverHue`. |
| `mingla-business/src/store/liveEventStore.ts` | Mirror provider metadata for published/live event state if public/order/checkout need it. Preserve `coverMediaType` union unless schema changes. |
| `mingla-business/src/utils/serverDraftEventMapper.ts` | Map provider metadata into publish/autosave payload and hydration if DB columns or theme JSON are added. |
| `mingla-business/src/services/businessEvents.ts` and `publicEventsService.ts` | Hydrate provider metadata for organiser/public render surfaces. |
| `mingla-business/src/components/ui/EventCoverMedia.tsx` | May need attribution overlay/slot for selected provider media; must preserve legacy video fallback until SPEC says otherwise. |
| `mingla-business/src/components/event/PublicEventPage.tsx` | Render provider attribution/link if required; preserve `isLegacyUnsafeEventCoverVideoUrl`. |
| `mingla-business/app/checkout/[eventId]/index.tsx` | Verify provider cover renders and attribution requirement is satisfied or intentionally scoped out with legal/product approval. |
| `mingla-business/app/o/[orderId].tsx` | Verify provider cover renders in order/ticket surface. |
| `mingla-business/src/components/event/EventListCard.tsx`, `CreatorStep7Preview.tsx`, `PreviewEventView.tsx`, Home event cards | Ensure provider media renders without adding provider search UI outside Step 4. |
| New provider modules | Add GIPHY adapter and Pexels adapter/proxy client with tests. |
| `supabase/functions/*` | Add Pexels proxy only if SPEC chooses server proxy. Do not delete existing event-cover video functions. |
| `.github/scripts/strict-grep/*` and `.github/workflows/strict-grep-mingla-business.yml` | Add ORCH-0783 gate and rewrite/narrow ORCH-0770/0776 gates so CI no longer requires active Step 4 video upload. |
| `mingla-business/package.json` | Add `test:orch-0783`; update old media scripts only as required by test contract. |

### Must not change in first pass

| File/area | Reason |
| --- | --- |
| `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql` | Historical video job table and constraints must remain for existing jobs/rows and rollback safety. |
| `supabase/migrations/20260515000014_orch_0776d_event_cover_video_cancelled_at.sql` | Keeps latest video job state shape. |
| Existing `supabase/functions/event-cover-video-*` | Keep dormant; deleting functions raises rollback/deploy risk and can break pending/historical jobs. |
| `supabase/functions/_shared/eventCoverVideo.ts` | Shared legacy video processing helpers must remain until legacy policy is specified. |
| `EventCoverMedia` video render support | Existing published rows can still be `video`; remove only after a legacy migration/rendering SPEC. |
| `coverHue` field in stores/schema/mappers | Existing fallback and pristine/edit logic depend on it; remove visible picker only. |

### Adjacent hue surfaces

`mingla-business/src/components/brand/BrandEditView.tsx` still exposes brand cover hue. ORCH-0783 is event-cover Step 4, not brand cover. Do not remove brand hue unless a separate brand-cover provider/hue decision is dispatched.

## Findings

### F1 - Confirmed UX gap: Step 4 exposes video upload despite the launch pivot

Evidence:

- `CreatorStep4Cover.tsx:547-637` launches video picker and validates/processes video.
- `CreatorStep4Cover.tsx:639-655` exposes a `Video` option in the user-facing alert.
- `CreatorStep4Cover.tsx:798-865` renders video status, progress, timeout, replace, and cancel controls.
- `eventCoverMediaRules.ts:5-6` still tells users videos are trimmed/compressed before they go live.

Current behavior: organisers can still start a Cloudinary-backed video cover workflow.

Expected behavior: no active event-cover video entry point in Step 4 for launch.

Impact: keeps the highest-complexity and least launch-proven cover path in the critical event-creation journey.

Fix direction: remove active video controls/imports/copy/state from Step 4 and replace tests/gates that currently require them.

### F2 - Confirmed UX gap: Step 4 exposes hue as a manual cover flow

Evidence:

- `CreatorStep4Cover.tsx:59` defines six hue tiles.
- `CreatorStep4Cover.tsx:128-133` writes selected hue.
- `CreatorStep4Cover.tsx:873-898` renders `Cover style` and the visible hue grid.

Current behavior: organisers can manually choose a striped placeholder hue.

Expected behavior: no visible event Step 4 hue chooser. Internal fallback remains.

Impact: the flow feels outdated and competes with the richer provider/image workflow.

Fix direction: remove/hide the event Step 4 hue grid and handler. Preserve `coverHue` default/backcompat until a design/spec defines a replacement fallback.

### F3 - Production-hardening gap: provider metadata is missing from the current event cover contract

Evidence:

- `DraftEvent` currently has `coverHue`, `coverMediaUrl`, and `coverMediaType`, but no provider/source/credit/alt metadata (`draftEventStore.ts:258-262`).
- `events` currently has `cover_media_url/type` and type only allows `image/video/gif` (`baseline_squash_orch_0729.sql:7806-7819`).
- Pexels docs expose `url`, `photographer`, `photographer_url`, `src`, and `alt`; GIPHY docs require attribution and include analytics URLs.

Current behavior: uploaded media works because Mingla owns the storage object.

Expected behavior: third-party selected media must preserve provider/source/credit/alt/attribution metadata.

Impact: without metadata, Mingla can display third-party media without required attribution, cannot distinguish uploaded vs provider media, and cannot moderate/audit provider sources later.

Fix direction: SPEC should add explicit nullable metadata fields to event state and persistence. Strongest recommendation: DB columns, not only theme JSON.

### F4 - Integration constraint: GIPHY and Pexels need different key/proxy patterns

Evidence:

- GIPHY docs require client-side Search calls and prohibit proxying API/media requests.
- Pexels docs require an `Authorization` header API key and provide rate-limit headers to track.

Current assumption in older artifacts: one generic `media-search` edge function could proxy both.

Expected behavior: split adapters. GIPHY client adapter; Pexels server proxy.

Impact: a single proxy path risks violating GIPHY docs, while a client-only Pexels path risks exposing a provider key and losing server-side rate-limit control.

Fix direction: SPEC must define separate adapters and env setup.

### F5 - Regression risk: existing tests and strict-grep gates encode the old video contract

Evidence:

- `eventCoverMedia.test.ts:67-86` requires `mediaTypes: ["videos"]`, `validateNativeTrimmedEventCoverVideo`, `createEventCoverVideoUploadIntent`, and video processing copy.
- `eventCoverMediaService.test.ts:97-106`, `120-153`, `254-260`, and `465-500` classify/validate/upload video as active cover media.
- `.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs:30-39` fails if Step 4 stops using upload-intent/native video validation.
- `.github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs:16-24` requires `CreatorStep4Cover.tsx`, and lines 47-52 fail if Step 4 no longer shows video recovery/acknowledgement.
- `mingla-business/package.json` scripts `test:orch-0770` and `test:orch-0776` run these old guards.

Current behavior: CI protects the active video workflow.

Expected behavior: CI should protect no-active-video Step 4, provider metadata, image/GIF upload, and legacy video rendering fallback.

Impact: implementation will either fail CI or be tempted to keep dead video UI unless tests/gates are rewritten in the same scoped commit.

Fix direction: ORCH-0783 implementation must update tests, npm script, and workflow job(s) in the same scoped commit/push.

## Backward Compatibility Recommendation

| Existing thing | Recommendation |
| --- | --- |
| `coverHue` | Keep as internal fallback/backcompat. Remove only visible event Step 4 hue selection. Do not remove from stores/schema/mappers now. |
| Existing image/GIF covers | Preserve unchanged. |
| Existing video covers | Preserve public rendering and fallback behavior. Do not delete video renderer or job schema. |
| Unsafe MOV/QuickTime legacy rows | Continue `isLegacyUnsafeEventCoverVideoUrl` public fallback to prevent black browser heroes. |
| Cloudinary/video Edge Functions | Leave dormant. Do not delete or undeploy in this pivot. |
| `cover_media_type = 'video'` DB check | Keep. Removing it is a data migration/legacy-rendering decision outside this launch pivot. |
| Storage video MIME allowances | Keep for historical compatibility until a later cleanup/backfill spec. |

## Schema Recommendation

Smallest safe launch option:

Add provider metadata columns to `events` in a monotonic migration greater than `20260515000017`, for example:

| Column | Purpose |
| --- | --- |
| `cover_media_provider text null` | `upload`, `giphy`, `pexels`, or null for legacy rows. |
| `cover_media_source_url text null` | GIPHY page/source URL or Pexels photo URL. |
| `cover_media_credit text null` | Photographer/provider/display credit. |
| `cover_media_credit_url text null` | Credit/profile/source link. |
| `cover_media_alt text null` | Pexels alt or GIPHY title/alt equivalent. |

Recommended constraints:

- Provider check: null or `upload/giphy/pexels`.
- If provider is `pexels`, require at least source URL and credit/credit URL where practical.
- If provider is `giphy`, preserve returned media URL and source/attribution metadata.

Avoid:

- Dropping `cover_media_type = 'video'`.
- Replacing `cover_media_type` enum/check in a way that breaks historical video rows.
- Moving provider metadata only into opaque theme JSON unless SPEC explicitly accepts public-rendering/search/moderation tradeoffs.
- Any destructive cleanup/backfill of video jobs or cover rows.

## Recommended Implementation Scope

In scope for the next SPEC:

1. Step 4 image/GIF upload remains.
2. Step 4 GIPHY picker:
   - separate tab/section/grid;
   - exact user query;
   - safe rating chosen in SPEC;
   - GIPHY attribution visible;
   - no Supabase copy/cache/proxy;
   - selected GIF URL and metadata persisted.
3. Step 4 Pexels picker:
   - separate tab/section/grid;
   - Pexels photo search only;
   - server proxy with Authorization secret;
   - default `orientation=landscape`;
   - use `src.landscape`;
   - persist photo URL, photographer, photographer URL, alt, and selected image URL;
   - visible credit/link where required.
4. Remove active Step 4 video entry point and video processing UI.
5. Remove active Step 4 hue chooser.
6. Preserve fallback and legacy render behavior.
7. Add provider metadata persistence/hydration/rendering.
8. Rewrite tests and strict-grep gates.

## Explicit Non-Scope

- No Cloudinary rework.
- No video transcode/process architecture changes.
- No deletion of video Edge Functions.
- No deletion of migrations.
- No event-cover job table cleanup.
- No video-row migration/backfill.
- No removal of public legacy video renderer/fallback until a SPEC defines exact legacy behavior.
- No removal of `coverHue` schema/store fields.
- No brand cover hue/provider work.
- No Pexels video.
- No provider API keys or secrets in code, chat, or artifacts.

## Regression Test Requirements

All automated tests must ship in the same scoped GitHub commit/push as the later implementation. Any exception must be explicit, justified, and converted into a tester manual gate.

### Repo-running tests to add or rewrite

| Test/gate | Required contract |
| --- | --- |
| `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` | Rewrite old Step 4 video assertions. Assert `CreatorStep4Cover` no longer contains `mediaTypes: ["videos"]`, `createEventCoverVideoUploadIntent`, `validateNativeTrimmedEventCoverVideo`, `EVENT_COVER_VIDEO_PROCESSING_COPY`, `Replace video`, or `Cancel processing`. Assert GIPHY and Pexels entry points exist. Assert no visible `Cover style` hue grid. Preserve separate legacy public video rendering/fallback tests. |
| `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts` | Keep image/JPEG/PNG/WebP/GIF coverage. Rewrite active-upload tests so video is rejected or no longer reachable through the Step 4 upload adapter. Keep any legacy video classification tests only if clearly named legacy-rendering tests. |
| New GIPHY adapter test | Assert exact query param, rating param, result normalization, selected rendition, no proxy/cache/copy behavior in implementation surface, attribution metadata, empty/error states. |
| New Pexels proxy/client test | Assert Authorization handled server-side, default `orientation=landscape`, selected `src.landscape`, credit/source/alt preservation, 429/rate-limit behavior. |
| `serverDraftEventMapper.test` / publish tests | Assert provider metadata persists through draft autosave, hydration, publish, and public event mapping. |
| Public/checkout/order render tests | Assert provider media appears in public event page, checkout card, and order/ticket view with required attribution or explicitly scoped attribution handling. |
| New strict-grep `orch-0783-event-cover-image-provider-pivot.mjs` | Forbid active Step 4 video upload controls/imports and visible event Step 4 hue grid. Require provider adapters/tests. Include allowlist comments only for legacy render/service files. |
| `.github/workflows/strict-grep-mingla-business.yml` | Register ORCH-0783 as one new job in the existing workflow. Do not create a parallel workflow. |
| `mingla-business/package.json` | Add `test:orch-0783` and run it in implementation verification. |
| Old ORCH-0770/0776 gates | Retire or narrow requirements that currently force Step 4 active video upload. Preserve checks that protect legacy public unsafe-video fallback and dormant Edge Function schema where still relevant. |

Minimum verification commands for implementor SPEC:

```bash
cd mingla-business
npm run test:orch-0758a
npm run test:orch-0783
npm run test:orch-0770
npm run test:orch-0776
npm run tsc -- --noEmit
cd ..
node .github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs
git diff --check
```

If `test:orch-0770` or `test:orch-0776` is intentionally redefined/narrowed, the SPEC must name exactly which old assertions were retired and why.

## Manual QA Plan

Tester must verify iOS Simulator, Android Emulator, and Web Browser parity for the affected Mingla Business flow.

| Gate | Platforms | Expected result |
| --- | --- | --- |
| Local image upload | iOS, Android, Web | Upload image, preview updates, draft autosaves/hydrates, publish/save preserves cover. |
| Local GIF upload | iOS, Android, Web | GIF can be selected and rendered as animated media where supported; no video UI appears. |
| GIPHY search/select | iOS, Android, Web | Search returns results, attribution visible, selecting GIF updates preview and persists metadata. |
| Pexels search/select | iOS, Android, Web | Search returns landscape photos through server/proxy, selecting photo updates preview and persists credit/source/alt. |
| Remove cover | iOS, Android, Web | Removes media and returns to fallback without exposing hue chooser. |
| No video entry point | iOS, Android, Web | Step 4 has no `Video`, trim, processing, timeout, replace-video, or cancel-processing path. |
| No hue chooser | iOS, Android, Web | Event Step 4 has no visible `Cover style` hue grid. |
| Public page | iOS, Android, Web | Provider image/GIF renders; credit/attribution appears where SPEC requires. |
| Checkout and order | iOS, Android, Web | Selected provider/local cover appears without layout overlap or missing image state. |
| Pexels missing key | Web plus one native | Clear inline/provider error; local upload and GIPHY remain usable. |
| GIPHY rate/key failure | Web plus one native | Clear inline/provider error; local upload and Pexels remain usable. |
| Network/rate-limit failure | Web plus one native | No dead taps; no draft corruption; retry works. |
| Existing legacy video row | Web plus one native | Existing safe video still renders or unsafe MOV/QuickTime falls back; no crash/black hero. |

## Deployment And Env Setup

GIPHY:

- Obtain production-ready GIPHY API keys per platform/section.
- Treat them as public client integration keys only if GIPHY/provider approval and Mingla security posture accept this.
- No proxy/cache/copy layer unless provider/legal approval explicitly supersedes docs.
- Configure per platform without committing values.

Pexels:

- Add `PEXELS_API_KEY` as a Supabase Edge Function secret or equivalent server secret.
- Deploy the Pexels search proxy only after tests pass.
- Server should track/rate-limit `X-Ratelimit-*` headers and handle 429.

Mobile/web:

- If provider picker uses only existing dependencies, OTA may be enough. If new native modules are added, require EAS build impact callout in SPEC.

## Open Questions And Risks

| Item | Status | Recommendation |
| --- | --- | --- |
| GIPHY rating | Open product/legal choice | Choose `pg` for conservative launch, or `pg-13` if organiser event vibe needs broader results. |
| GIPHY analytics | Open implementation/legal choice | SPEC should either implement view/click analytics or explicitly defer with approval. |
| GIPHY direct URL persistence | Risk | Docs prohibit caching/copying, not storing selected returned URLs as event metadata. Legal/product should approve exact persistence wording if needed. |
| Pexels attribution placement | Open UX/legal choice | Safer launch: show compact public credit on public event page and maybe edit preview; avoid hiding all credit in picker only. |
| Provider metadata storage | Open architecture choice | Recommend DB columns for public rendering/moderation/search clarity. |
| Fallback replacement for hue | Open design question | Keep internal warm hue fallback now; later UI/UX can replace striped fallback. |
| Old ORCH-0770/0776 gates | Confirmed implementation risk | Must be rewritten/narrowed in the same commit or implementation will either fail CI or keep dead video UI. |
| Existing report draft | Resolved | This file supersedes the initial untracked draft in the ORCH-0783 worktree. |

## Downstream SPEC Boundary

Next lifecycle step should be SPEC, not more investigation.

The SPEC should be narrow: event Step 4 only, provider metadata/persistence/rendering needed for event/public/checkout/order cover parity, one Pexels proxy, one GIPHY client adapter, and the required regression gates. It should not reopen ORCH-0770 or ORCH-0776 except to rewrite old gates that currently require active Step 4 video UI.

## Next Handoff

NEXT HANDOFF - paste into Claude `mingla-forensics` SPEC:

Use Claude `mingla-forensics` in SPEC mode to write the implementation contract for ORCH-0783. Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`. Inputs are `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` plus the original prompt `Mingla_Artifacts/prompts/FORENSICS_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`; the goal is the safest launch pivot from hue/video covers to local image/GIF plus GIPHY/Pexels event covers while preserving existing published cover rendering. Hard guards: no implementation, no provider keys/secrets, no migration/function deletion, no Cloudinary/video rework, keep `coverHue` and legacy video rendering until SPEC defines legacy handling, and require repo-running regression tests in the same scoped commit/push for every behavior change. Expected output is `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, then route to Codex `implementor-mingla` only after operator/orchestrator review.
