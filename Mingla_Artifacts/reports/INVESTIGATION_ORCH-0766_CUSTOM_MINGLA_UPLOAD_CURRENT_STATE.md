# INVESTIGATION ORCH-0766 - Custom Mingla Upload Current State

Date: 2026-05-09  
Mode: Forensics  
Verdict: PARTIAL PASS - event cover custom upload is implemented and DB-deployed; brand cover/photo, ticket-tier media, Giphy/Pexels, and production runtime proof remain open.

## Executive Summary

We can safely return to the custom Mingla upload track, but the scope needs to be precise.

The old reason for pausing media work, the event-system source-of-truth repair, has moved forward in this workspace. ORCH-0763 migrations are present locally and remotely through `20260515000007`, and the focused event-source tests pass. That means event cover upload is no longer blocked by the earlier local-only publish architecture in the same way it was on May 8.

Current reality:

- Event cover upload for drafts supports image, GIF, and short video files.
- Uploaded event cover media is stored in Supabase Storage bucket `event_covers`.
- Event metadata persists through `events.cover_media_url` and `events.cover_media_type`.
- Public/event/card renderers use `EventCoverMedia` to render image/GIF/video or hue fallback.
- Brand cover upload is not implemented yet; Brand Edit still says "Photo and video uploads coming soon."
- Brand photo upload is not implemented yet; the brand photo edit button still shows a transitional toast.
- Business profile photo upload exists in code, but I found no migration creating the `creator_avatars` storage bucket/policies.
- Giphy/Pexels integration is not implemented.
- Native/runtime proof for real upload/playback remains missing from the latest tester artifact.

## Scope Framing

Feature slice audited:

`custom user-supplied media upload for Mingla Business event covers, brand pages, brand/profile photos, tickets, and provider picker readiness`

Surfaces checked:

- `mingla-business` event creator cover step
- `mingla-business` event preview/public/card/order rendering
- `mingla-business` published edit media behavior
- `mingla-business` brand edit/public brand media fields
- `mingla-business` account profile photo upload
- Supabase migrations/storage/RLS
- focused test scripts

## Historical Context

Relevant prior artifacts:

- `reports/RETEST_ORCH-0758A_EVENT_PUBLIC_TICKET_COVER_MEDIA.md`
- `reports/RUNTIME_ORCH-0758A_EVENT_COVER_MEDIA_NATIVE_QA.md`
- `specs/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`

Prior ORCH-0758A result was a code-level conditional pass with runtime/native proof blocked. Prior ORCH-0763 warned that richer media should wait until event publication/source-of-truth was repaired. Current code now includes ORCH-0763 server-backed publish/read work and migrations through `20260515000007`.

## Findings

### F1 - Event cover custom upload is implemented in code

Classification: confirmed implemented, runtime proof still required.

Evidence:

- `mingla-business/src/components/event/CreatorStep4Cover.tsx:79-127` requests photo library permission, launches `expo-image-picker`, accepts all media types, uploads the chosen asset, and stores `coverMediaUrl/coverMediaType` on the draft.
- `mingla-business/src/services/eventCoverMediaService.ts:61-109` fetches the local URI, validates asset type/size/duration, uploads to `event_covers`, and returns a public URL.
- `mingla-business/src/utils/eventCoverMediaRules.ts:33-60` classifies JPEG/JPG/PNG/WebP as image, GIF as gif, and MP4/WebM as video.
- `mingla-business/src/utils/eventCoverMediaRules.ts:63-105` enforces 30 MB max and 15 second max for videos; videos with missing duration are rejected.

Expected user behavior:

- In the event wizard Cover step, users can tap "Upload cover", choose an image/GIF/short video, preview it, remove it, or fall back to hue.

Limit:

- This is verified by source and automated tests, not by a fresh authenticated runtime upload in this pass.

### F2 - Event cover storage/RLS is defined and now remote-applied

Classification: confirmed deployed by migration list, still needs runtime RLS smoke.

Evidence:

- `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:4-23` creates public bucket `event_covers`, 30 MB limit, allowed MIME types for JPEG/PNG/WebP/GIF/MP4/WebM.
- Same migration lines `30-97` create public read and event-manager upload/update/delete policies scoped to path `{brandId}/{eventId}/{filename}`.
- `/Users/sethogieva/bin/supabase migration list --linked` on 2026-05-09 shows local and remote both contain `20260515000002`, plus later migrations through `20260515000007`.

Expected user behavior:

- Event managers should be able to upload covers for events in their brand.
- Public surfaces can read the uploaded media URL.

Limit:

- The latest runtime tester report was blocked at unauthenticated sign-in, so real upload/RLS proof remains open.

### F3 - Event publish/source-of-truth blocker is materially improved

Classification: confirmed improvement.

Evidence:

- `supabase/migrations/20260515000004_orch_0763_event_system_regression_repair.sql` adds `business_management_events_view` and `business_publish_event_draft`.
- `mingla-business/src/services/businessEvents.ts:313-402` reads organiser events from `business_management_events_view` and publishes via `business_publish_event_draft`.
- `mingla-business/src/hooks/useBusinessEvents.ts:91-165` adds server-backed organiser event queries and publish mutation.
- `mingla-business/app/event/[id]/edit.tsx:86-90` hydrates Edit Published from `useBusinessEventById`.
- `mingla-business/app/event/[id]/edit.tsx:320-326` publishes through `usePublishBusinessEventDraft`, not the old direct local publish path.
- `npm run test:orch-0763` passed: 7 suites / 47 tests.

Impact for custom uploads:

- Event cover media now has a more credible path from draft upload to server publish and public rendering than it did before ORCH-0763.

Remaining caveat:

- Published edit for server-loaded events is intentionally limited. `app/event/[id]/edit.tsx:276-282` passes `disableLocalSaveReason` when the event came from the server rather than legacy local store. So full server-backed published edit media changes are not yet broadly enabled.

### F4 - Event media rendering exists across key event/public surfaces

Classification: confirmed implemented.

Evidence:

- `mingla-business/src/components/ui/EventCoverMedia.tsx:111-153` renders hue fallback, image/GIF through React Native `Image`, and video through `expo-video`.
- `mingla-business/app/(tabs)/home.tsx` renders `EventCoverMedia` for draft and event cards.
- `mingla-business/app/event/[id]/index.tsx` renders event cover media.
- `mingla-business/app/checkout/[eventId]/index.tsx`, `app/o/[orderId].tsx`, `src/components/event/PublicEventPage.tsx`, `src/components/event/EventListCard.tsx`, `src/components/brand/PublicBrandPage.tsx`, and preview components reference `coverMediaUrl/coverMediaType`.
- `npm run test:orch-0758a` passed: 6 suites / 35 tests.

Limit:

- Reduced-motion/no-autoplay video behavior still needs native runtime proof. `EventCoverMedia` starts `reduceMotion` as `false` and updates asynchronously from `AccessibilityInfo.isReduceMotionEnabled()` at lines `83-98`; prior runtime QA explicitly left this unverified.

### F5 - Brand cover upload is not implemented

Classification: confirmed gap.

Evidence:

- `mingla-business/src/components/brand/BrandEditView.tsx:437-479` shows brand cover hue selection only and copy "Photo and video uploads coming soon."
- `BrandEditView.tsx:303-307` has a transitional brand photo handler that only toasts "Photo upload lands in a later cycle."
- `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql` preloads brand `cover_media_url`, `cover_media_type`, and `profile_photo_type`, but there is no brand media storage bucket/policy or upload service found.

Expected behavior for requested feature:

- Brand pages should allow custom pictures/videos/GIFs. Current UI does not.

Fix direction:

- Add a brand media storage bucket/policies or reuse a generalized media bucket with path-scoped RLS.
- Add upload/replace/remove UI to Brand Edit for brand cover and brand photo.
- Render brand cover media on public brand hero instead of hue-only fallback.

### F6 - Business profile photo upload exists in code but appears storage-incomplete

Classification: likely bug / production-hardening gap.

Evidence:

- `mingla-business/app/account/edit-profile.tsx:133-183` uses `expo-image-picker`, uploads an image to Supabase Storage bucket `creator_avatars`, and cache-busts the public URL.
- Repository search found no migration creating `creator_avatars` bucket or storage policies. The only storage bucket migration found for this feature area is `event_covers`.

Expected behavior:

- Business users can upload a profile picture from Account/Edit profile.

Current risk:

- If `creator_avatars` was not manually created out-of-band, this upload will fail at runtime with a storage bucket/policy error.

Fix direction:

- Forensics or implementor should either confirm `creator_avatars` exists remotely through read-only Supabase inspection, or add a monotonic migration creating the bucket and RLS policies. Do not rely on manual dashboard state.

### F7 - Ticket-tier media is not implemented

Classification: confirmed gap.

Evidence:

- `ticket_types` mapping and ticket editor searches show no ticket media fields or upload UI.
- ORCH-0758A retest explicitly said no per-ticket-tier imagery was included.

Expected behavior for requested feature:

- If "tickets" means individual ticket/tier cards can have custom images/GIF/video, that is not present.
- If "tickets" means event tickets/public ticket pages inherit the event cover, that is partially present through event cover rendering.

Recommendation:

- Clarify product intent before implementation: event cover displayed on ticket purchase pages is already partly done; per-ticket-tier media is a separate schema/UI/RLS feature.

### F8 - Giphy/Pexels is not implemented

Classification: confirmed not started.

Evidence:

- Current code search found no provider UI, provider services, provider env keys, or API calls for Giphy/Pexels in `mingla-business`.
- Existing mentions are comments/types stating future Giphy/Pexels support.

Expected behavior for requested feature:

- Users can search/select from Giphy/Pexels.

Current behavior:

- Users can only upload custom event cover media from their device in the event wizard.

## Test / Verification Evidence

Commands run on 2026-05-09 from `mingla-business/`:

```bash
npm run test:orch-0758a
```

Result:

- PASS
- 6 suites / 35 tests
- Includes event cover rules/service/component, draft mapper, published edit guards, pristine draft behavior.

```bash
npm run test:orch-0763
```

Result:

- PASS
- 7 suites / 47 tests
- Includes business publish, public events, share URL, server draft autosave/source-of-truth guards.

Command run from repo root:

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Result:

- PASS read-only inspection.
- Remote includes `20260515000002` event cover storage, `20260515000004` ORCH-0763 publish/read repair, `20260515000005`, `20260515000006`, and `20260515000007`.

Watchman emitted a recrawl warning during Jest, but both commands exited successfully.

## Surface Matrix

| Surface | Custom upload now? | Media types | Storage/schema | Rendering | Status |
|---|---:|---|---|---|---|
| Event draft cover | Yes | image, gif, mp4/webm video <=15s | `event_covers`, `events.cover_media_url/type` | Yes | Code pass; runtime still needed |
| Published event cover edit | Limited | Same if reachable | direct `events` update | Yes | Server-loaded edit saves disabled; needs follow-up |
| Public event page | N/A read-only | event media | `business_public_events_view` includes cover fields | Yes | Implemented |
| Checkout/order event cards | N/A read-only | event media | public event service | Yes | Implemented |
| Brand cover | No | schema allows image/video/gif | brand columns only; no upload bucket/service | hue fallback only | Gap |
| Brand photo | No | schema type exists | no upload service in Brand Edit | avatar only | Gap |
| Business profile avatar | Yes in code | image only | uses `creator_avatars`, migration not found | Yes after save | Storage proof gap |
| Ticket-tier media | No | none | no fields found | event cover may appear around ticket surfaces | Gap |
| Giphy/Pexels picker | No | none | no provider integration | none | Gap |

## Recommended Next Move

Proceed, but do it in slices:

1. **Runtime verify event cover custom upload first.**
   - Use authenticated business fixture.
   - Upload image, GIF, MP4/WebM <=15s.
   - Publish.
   - Verify Home, Events, Detail, Public Event, Checkout, Order, Brand event list.
   - Verify reduced-motion video behavior.

2. **Fix/profile-proof business profile avatar storage.**
   - Confirm whether `creator_avatars` exists remotely.
   - If not, add migration for bucket/RLS.

3. **Spec brand media upload.**
   - Brand cover image/GIF/video.
   - Brand profile/photo image first; decide whether animated avatars are really desired for brand profile photos.
   - Public brand hero rendering.

4. **Only after custom upload is stable, spec Giphy/Pexels.**
   - Provider search has API keys, rate limits, attribution, moderation, external URL persistence, and cache/fallback concerns.

## Bottom Line

Yes, we can go back to custom Mingla upload now, but the honest current state is:

- **Event cover custom upload:** implemented, deployed schema, test-pass, runtime QA still needed.
- **Brand/profile/ticket custom upload:** not fully implemented; profile has code but likely missing bucket migration.
- **Giphy/Pexels:** not implemented.

Forensics Verdict: CUSTOM EVENT COVER UPLOAD CAN MOVE TO RUNTIME TESTING; BRAND/PROFILE/TICKET/PROVIDER MEDIA NEED NEW SPEC WORK.
