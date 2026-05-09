# INVESTIGATION_ORCH-0758_RICH_MEDIA_COVERS_AND_PICKERS

Date: 2026-05-08  
Mode: $forensics  
Verdict: READY FOR DECOMPOSED SPECS, NOT ONE MEGA-IMPLEMENTATION

## Executive Summary

ORCH-0758 is a real feature gap with several partially prepared layers. Mingla can support richer event/brand covers, uploads, and provider pickers, but the safe path is not a single media-picker sweep.

Confirmed current state:

- Event/ticket/public event cover UX is hue-only. The database already has `events.cover_media_url` and `events.cover_media_type`, and `events_public_view` exposes them, but the business app draft/live models, server-draft mapper, event services, preview/public renderers, and publish converter do not use those columns.
- Brand media is halfway wired. The `brands` table was preloaded with `cover_media_url`, `cover_media_type`, and `profile_photo_type`; `brandMapping.ts` can map those fields; `BrandEditView` and public/founder brand renderers still use hue/avatar placeholders and transitional upload copy.
- Business and consumer profile upload paths are image-only. Business uploads to `creator_avatars` and explicitly rejects GIF/video extensions; consumer profile uses image picker paths and writes only `profiles.avatar_url`.
- No GIPHY/Pexels integration exists in product code. Official docs impose attribution, rating/safety, rate-limit, and API-key handling requirements that need to be first-class product contracts, not just UI tabs.
- There is no active first-class event/brand cover storage bucket/RLS path in current migrations. Archived avatar bucket patterns are public-read and avatar-shaped, not suitable as-is for brand/event/team-owned media.

Recommended lifecycle:

1. ORCH-0758A: event/public ticket cover media using existing `events.cover_media_url/type`.
2. ORCH-0758B: brand cover/profile media using existing brand columns.
3. ORCH-0758C: profile media-type hardening for business and consumer profiles.
4. ORCH-0758D: shared provider picker/proxy with GIPHY + Pexels contracts.
5. ORCH-0758E: storage, moderation, takedown, and admin operations hardening.

## Current Behavior By Surface

### Event / Ticket / Public Event Covers

Finding: confirmed feature gap.

Evidence:

- `CreatorStep4Cover.tsx` documents the current state as a Cycle 3 hue-only stub and says real upload/storage and GIF library work are later-cycle work. The UI only maps `HUE_TILES` and updates `draft.coverHue`.
- `DraftEvent` stores `coverHue` only; `TicketStub` has no media fields.
- `LiveEvent` stores `coverHue` only.
- `EventCover.tsx` is explicitly a hue-driven striped placeholder. It has no `url`, `type`, poster, video, GIF, or attribution props.
- `PublicEventPage.tsx` still renders `<EventCover hue={event.coverHue}>`; its OG image helper is a transitional static placeholder.
- `PreviewEventView.tsx`, `CreatorStep7Preview.tsx`, and `EventListCard.tsx` all render `EventCover` using `coverHue`.
- `liveEventConverter.ts` copies only `draft.coverHue` into `LiveEvent`; cover media could not survive publish even if manually attached elsewhere.

Root cause:

The canonical event columns exist, but the client-owned event domain model was never expanded past `coverHue`. ORCH-0756B's server-backed draft work preserved `theme.business_draft` and `coverHue`, but `EVENT_DRAFT_SELECT`, insert/update payloads, and row hydration still omit `cover_media_url/type`.

Classification: FEATURE GAP + DATA CONTRACT GAP.  
Confidence: HIGH.

### Brand Covers And Brand Profile Media

Finding: confirmed feature gap with schema/mapping already prepared.

Evidence:

- `20260506000000_brand_kind_address_cover_hue_media.sql` adds `cover_hue`, `cover_media_url`, `cover_media_type`, and `profile_photo_type`. Comments explicitly say this preloads future GIPHY/Pexels/upload picker UI.
- `Brand` type includes `coverMediaUrl`, `coverMediaType`, and `profilePhotoType`.
- `brandMapping.ts` reads and writes the new fields.
- `brandPatch.ts` detects dirty changes for the new fields.
- `BrandEditView.tsx` still has a transitional `handlePhotoEdit` toast and renders only `draft.coverHue`; the cover section says photo/video uploads are coming soon.
- `PublicBrandPage.tsx` renders a hue gradient from `brand.coverHue` and does not render `brand.coverMediaUrl`.
- `BrandProfileView.tsx` uses `Avatar` and `EventCover` primitives, not media-aware image/video/GIF rendering.

Root cause:

Cycle 17e-A deliberately preloaded brand schema and mappers, but the 17e-B picker/rendering layer was never implemented.

Classification: FEATURE GAP.  
Confidence: HIGH.

### Business Profile

Finding: image-only, single-avatar path.

Evidence:

- `mingla-business/app/account/edit-profile.tsx` uses `ImagePicker.MediaTypeOptions.Images`, `allowsEditing: true`, square crop, and limits accepted extensions to `jpg`, `jpeg`, `png`, and `webp`.
- It uploads to `creator_avatars` at `${user.id}.${ext}` and writes `creator_accounts.avatar_url`.
- `creator_accounts` schema has `avatar_url` only; no `avatar_media_type`, provider metadata, animation flag, or video poster field.
- Archived `creator_avatars` bucket allows only JPEG, PNG, and WEBP and uses public read.

Root cause:

Business profile is intentionally avatar-photo shaped. Supporting video/GIF profile media requires a schema/storage contract, not just toggling the picker media type.

Classification: FEATURE GAP + SCHEMA GAP for GIF/video profile media.  
Confidence: HIGH.

### Consumer Profile

Finding: image picker service has video helpers, but profile avatar flow is image-only and URL-only.

Evidence:

- `ProfilePage.tsx` calls `cameraService.takePhoto` and `cameraService.pickFromLibrary` for avatar updates.
- `cameraService.takePhoto` and `pickFromLibrary` both use `mediaTypes: 'images'`; `takeVideo` exists separately but is not used by profile avatar upload.
- `authService.uploadProfilePhoto` builds image MIME from the URI extension, uploads to `avatars`, and updates `profiles.avatar_url`.
- `profiles` schema has `avatar_url` and `photos text[]`; the comment says `photos` are additional profile photo URLs. There is no media-type metadata for avatar or photos.
- Archived `avatars` bucket allows GIF as an image MIME, but RLS is broad: authenticated users can upload/delete avatar files in the public bucket without user-path ownership enforcement after the fix migration.

Root cause:

Consumer profile data model is photo URL oriented and has no media metadata. GIFs might pass the archived bucket MIME allowlist, but the app-level picker/compression/display/update contract treats avatars as images.

Classification: FEATURE GAP + SECURITY HARDENING RISK.  
Confidence: HIGH.

## Schema And Storage Evidence

### Current Schema

- `events` has `cover_media_url text` and `cover_media_type text`, constrained to `image`, `video`, or `gif`.
- `events_public_view` includes `cover_media_url` and `cover_media_type`.
- `brands` baseline has `profile_photo_url`; migration `20260506000000` adds `cover_media_url`, `cover_media_type`, and `profile_photo_type`.
- `ticket_types` has no media columns. If "tickets" means per-ticket-tier imagery rather than the public event/ticket cover, that is a separate schema decision.
- `creator_accounts` has `avatar_url` only.
- `profiles` has `avatar_url` and `photos text[]`; no media-type fields.

### Current Storage / RLS

Current active migrations do not create an event-cover, brand-cover, or shared business-media bucket. Archived migrations show useful prior patterns:

- `creator_avatars` is public, 10MB, JPEG/PNG/WEBP only, path-scoped to `{userId}.{ext}` for insert/update/delete, and public-read.
- `avatars` is public, 10MB, JPEG/PNG/GIF/WEBP, and after its fix migration allows any authenticated user to upload/delete within the `avatars` bucket without path ownership constraints.

These avatar buckets should not be reused blindly for brand/event covers. Event and brand media are team-owned resources, not user-avatar resources; RLS must tie writes to brand-role rank and event ownership.

Latest local migration prefix observed: `20260515000001_orch_0756b_event_draft_persistence.sql`. Any new migration must use a later timestamp prefix.

## Provider Requirements

Official GIPHY docs:

- API keys start as beta keys with 100 searches/API calls per hour.
- Separate keys are required per platform and section when using the service in different sections.
- GIPHY requires "Powered By GIPHY" attribution wherever the API is used.
- Search/trending expose `rating`, `random_id`, `country_code`, `region`, and rendition controls.
- GIPHY recommends analytics action registration for view/click/send actions and smaller renditions for preview grids.

Official Pexels docs:

- Pexels API requests require an `Authorization` header.
- Video endpoints use `https://api.pexels.com/v1/videos/`; old `/videos/` paths are marked for future deprecation.
- Pexels requires a prominent link to Pexels and photographer credit when possible.
- Default rate limits are 200 requests/hour and 20,000 requests/month.
- Successful responses include request-limit headers that should be tracked.

Provider conclusion:

The picker needs provider metadata in Mingla state: provider name, provider asset ID, source page URL, selected rendition URL, media type, width/height, attribution text/link, photographer/creator when available, and any required analytics URLs. Storing only a bare URL would violate attribution and make takedown/revalidation brittle.

Sources:

- GIPHY Developers API docs: https://developers.giphy.com/docs/api/
- Pexels API documentation: https://www.pexels.com/api/documentation/

## Root Causes / Feature Gaps

1. Dormant event media columns.
   - Symptom: event pages are hue-only even though DB has media columns.
   - Proof: `EVENT_DRAFT_SELECT`, server draft mapper types, `DraftEvent`, `LiveEvent`, and renderers omit `cover_media_url/type`.
   - Fix class: model/service/UI implementation, probably no event-column migration needed.

2. Brand media schema without render/upload UI.
   - Symptom: brand columns and mapper exist, but edit/public/founder surfaces ignore them.
   - Proof: brand migration + mapper are present; `BrandEditView` remains transitional.
   - Fix class: UI/service tests, likely no brand-column migration needed.

3. Profile media requires schema decisions.
   - Symptom: user asks for pictures/videos/GIFs on profile, but existing profile models are avatar-photo URL only.
   - Proof: `creator_accounts.avatar_url`, `profiles.avatar_url`, `profiles.photos text[]`.
   - Fix class: product decision + additive schema/storage migration if GIF/video profiles are in scope.

4. No provider abstraction.
   - Symptom: no GIPHY/Pexels code, env keys, edge functions, attribution UI, or provider metadata fields.
   - Proof: repo-wide provider search only found artifacts/spec history, no product integration.
   - Fix class: edge function or approved client-side provider integration plus shared picker UI.

5. No event/brand media storage contract.
   - Symptom: custom uploads need a trusted bucket/path/RLS contract, thumbnails/posters, size/MIME limits, cleanup, and cache-busting.
   - Proof: current active migrations do not define event/brand cover storage; archived avatar buckets do not match team-owned media.
   - Fix class: storage/RLS/admin/moderation spec.

## Blast Radius

Likely touched areas:

- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/store/liveEventStore.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/services/eventDrafts.ts`
- `mingla-business/src/utils/liveEventConverter.ts`
- `mingla-business/src/components/event/*`
- `mingla-business/src/components/ui/EventCover.tsx` or a new media-renderer primitive
- `mingla-business/src/components/brand/*`
- `mingla-business/src/services/brandMapping.ts`
- `mingla-business/src/hooks/useBrands.ts`
- `mingla-business/app/account/edit-profile.tsx`
- `app-mobile/src/components/ProfilePage.tsx`
- `app-mobile/src/services/authService.ts`
- `app-mobile/src/services/cameraService.ts`
- Supabase migrations, storage policies, and possibly edge functions
- Public-page SEO/OG image generation and cache invalidation
- Admin moderation/takedown surfaces

## Security, Moderation, Privacy, Attribution, Performance Risks

- Public buckets expose uploaded content immediately; moderation/takedown flow must exist before broad video/GIF/profile media support is declared production-ready.
- Provider API keys must not be casually exposed unless docs require client-side calls and the key model is accepted. GIPHY docs explicitly say Search/Trending API calls are required client-side; if Mingla proxies them anyway, it must preserve `country_code`/`region`, `random_id`, attribution, and analytics contracts.
- Direct URL storage can become an attribution bug. Provider assets need metadata.
- GIF/video covers can degrade app performance without rendition choice, video duration limits, poster frames, autoplay rules, reduced-motion behavior, and file-size caps.
- Profile GIF/video has privacy implications because `profiles.visibility_mode` and public avatar rendering are separate concerns; public buckets can bypass row-level profile visibility if URLs leak.
- Avatar-bucket RLS history shows consumer avatars allow broad authenticated writes/deletes. Do not extend that pattern to team-owned brand/event media.

## Recommended Decomposition

### ORCH-0758A — Event/Public Ticket Cover Media

Scope:

- Treat "ticket cover" as event/public ticket-page cover unless product explicitly asks for per-ticket-tier imagery.
- Add `coverMediaUrl` and `coverMediaType` to `DraftEvent` and `LiveEvent`.
- Update server draft select/insert/update/hydration to use canonical `events.cover_media_url/type`, not only JSON theme.
- Render image/GIF/video covers in creator preview, public event page, event list cards, and published edit flow.
- Preserve `coverHue` as fallback.

Tests:

- Mapper round-trip for `cover_media_url/type`.
- Draft autosave persists media columns.
- Publish preserves media from draft to live/public event.
- Public page falls back to hue when URL/type are null.
- Video/GIF render tests include reduced-motion/poster/fallback behavior.

### ORCH-0758B — Brand Cover + Brand Profile Media

Scope:

- Use existing `brands.cover_media_url/type` and `brands.profile_photo_type`.
- Replace `BrandEditView` transitional photo/cover paths with real upload/provider picker affordances.
- Render brand cover media in `PublicBrandPage` and founder profile views.
- Preserve `coverHue` fallback and current avatar fallback.

Tests:

- Brand update patch includes media fields only when changed.
- Optimistic brand cache mirrors media updates in list/detail queries.
- Public brand page renders media/fallback correctly.
- Profile media type controls avatar/image/video/GIF renderer.

### ORCH-0758C — Profile Media Hardening

Scope:

- Decide whether personal profiles truly support video, GIF, both, or only animated images.
- Add media-type metadata if needed: e.g. `creator_accounts.avatar_media_type`, `profiles.avatar_media_type`, and/or a normalized profile media table.
- Rework mobile/business upload services around MIME/type validation, file-size caps, and storage path ownership.

Tests:

- Upload rejects unsupported MIME/extensions.
- Profile visibility does not leak private media via app queries.
- Cache-busting does not persist query-string noise as canonical URLs unless intentionally designed.

### ORCH-0758D — Shared GIPHY/Pexels Picker

Scope:

- Shared picker with tabs: Upload, GIPHY, Pexels.
- Provider API key/env strategy.
- Provider metadata contract.
- Attribution UI in picker and saved media displays.
- Rating/safe-search defaults and country/locale behavior.
- Rate-limit handling and request throttling.

Tests:

- Provider adapters normalize assets to one internal media result shape.
- Missing API keys degrade visibly without dead taps.
- Attribution is rendered for provider results.
- Pexels limit headers are captured/logged or otherwise tracked.
- GIPHY rating/random-id behavior is covered at adapter level.

### ORCH-0758E — Storage, Moderation, Cleanup

Scope:

- Dedicated media bucket(s) or one shared bucket with strict path prefixes:
  - `brands/{brandId}/cover/...`
  - `brands/{brandId}/profile/...`
  - `events/{eventId}/cover/...`
  - `profiles/{userId}/...` only if profile media scope ships.
- RLS based on brand role for brand/event media and user ownership for profile media.
- Cleanup/orphan handling when media is replaced or brand/event/profile is deleted.
- Admin takedown/moderation queue.

Tests:

- RLS positive/negative tests for owner, team member rank, unrelated authenticated user, anon, and service role.
- Replacing media does not orphan unbounded storage without telemetry/cleanup.
- Public read works only for intended public media.

## Open Questions

1. Does "tickets" mean the public event/ticket purchase page cover, or per-ticket-type imagery inside `ticket_types`?
2. Should profile videos be allowed, or should profiles support only pictures and GIFs?
3. Should uploaded event/brand media be public immediately, or should there be a review/takedown layer before public exposure?
4. What is the default provider safety level? Recommended default: GIPHY rating `g` or `pg`, with no unrestricted results in production.
5. Should provider-selected assets be hotlinked from providers or copied into Mingla storage? Hotlinking is simpler for attribution/source freshness; copying requires license/provider review and takedown handling.
6. Should animated covers autoplay on mobile, and what is the reduced-motion behavior?

## Verdict

ORCH-0758 is ready for spec work only if decomposed. Event and brand media can start first because their database columns already exist. Profile video/GIF support needs product and schema decisions. GIPHY/Pexels needs a provider contract before UI work so attribution, rating, rate limits, API keys, and metadata do not become retroactive cleanup.

Ship order recommendation:

1. ORCH-0758A event/public ticket cover media.
2. ORCH-0758B brand cover/profile media.
3. ORCH-0758D shared provider picker.
4. ORCH-0758C profile media hardening.
5. ORCH-0758E moderation/storage cleanup can run alongside A-D but must gate broad custom uploads before launch.
