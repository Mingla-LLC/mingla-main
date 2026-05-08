# IMPLEMENTATION ORCH-0758A — Event/Public Ticket Cover Media

Date: 2026-05-08
Agent: implementor
Verdict: IMPLEMENTED

## Scope Implemented

- Added event cover media fields to business draft/local live event models:
  - `DraftEvent.coverMediaUrl`
  - `DraftEvent.coverMediaType`
  - `LiveEvent.serverEventId`
  - `LiveEvent.coverMediaUrl`
  - `LiveEvent.coverMediaType`
- Preserved publish ownership ordering and wired `serverEventId: draft.id` in `liveEventConverter`.
- Persisted cover media through canonical `events.cover_media_url` / `events.cover_media_type` in server draft insert/update/select/hydration.
- Added `event_covers` Supabase storage bucket migration and event-manager RLS policies scoped to `{brandId}/{eventId}/{file}` paths.
- Added upload/validation service for image/GIF/short-video event covers:
  - allowed: jpeg/png/webp/gif/mp4/webm
  - max file size: 30 MB
  - max video duration: 15 seconds
  - mapped UI errors for permission denied, unsupported type, oversize, overduration, missing server id, and upload failure
- Reworked Creator Step 4 to upload/replace/remove cover media while keeping hue fallback.
- Added `EventCoverMedia` renderer with image/GIF/video rendering and hue fallback on missing/error media.
- Rendered event cover media across draft preview, public event, home event rows, event list cards, event detail, checkout, order page, and public brand event cards.
- Added `expo-video` dependency and app config plugin entry.

## Scope Excluded

- Brand cover media upload.
- Profile media upload.
- GIPHY/Pexels provider UI/API calls.
- Admin moderation.
- Per-ticket-tier imagery.
- Dynamic OpenGraph image generation.

Those are intentionally outside ORCH-0758A and remain follow-on work.

## Files Added

- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `mingla-business/src/services/eventCoverMediaService.ts`
- `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts`
- `mingla-business/src/utils/eventCoverMediaRules.ts`
- `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql`

## Verification

- PASS: `npm run test:orch-0758a`
- PASS: `npm run test:orch-0756b`
- PASS: `npx tsc --noEmit`
- PASS with warnings: targeted ESLint excluding known pre-existing hook-order file:
  - `npx eslint app.config.ts src/store/draftEventStore.ts src/store/liveEventStore.ts src/utils/liveEventConverter.ts src/utils/liveEventAdapter.ts src/utils/serverDraftEventMapper.ts src/services/eventDrafts.ts src/services/eventCoverMediaService.ts src/utils/eventCoverMediaRules.ts src/components/ui/EventCoverMedia.tsx src/components/event/CreatorStep4Cover.tsx src/components/event/EventCreatorWizard.tsx src/components/event/EditPublishedScreen.tsx src/components/event/EventListCard.tsx src/components/event/CreatorStep7Preview.tsx src/components/event/PreviewEventView.tsx src/components/event/PublicEventPage.tsx 'app/(tabs)/home.tsx' 'app/checkout/[eventId]/index.tsx' 'app/o/[orderId].tsx' src/components/brand/PublicBrandPage.tsx src/utils/__tests__/serverDraftEventMapper.test.ts src/utils/__tests__/serverDraftLifecycleGuards.test.ts src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/__tests__/eventCoverMedia.test.ts`
- FAIL, pre-existing blocker: same targeted ESLint including `app/event/[id]/index.tsx` fails on existing conditional hook-order violations at lines 312, 319, 327, 328, 339, 351, 352, 371, 373, 377. This file already had early returns before hook calls; ORCH-0758A only swapped the cover renderer in the hero.
- STATIC SQL CHECK: confirmed `events.cover_media_url/type` exist in baseline schema and new migration creates `event_covers` bucket plus public read/event-manager write policies.

## Notes

- The `events` table already had `cover_media_url` and `cover_media_type` in the squashed schema; ORCH-0758A adds storage/RLS and app wiring.
- Published edit cover saves update the canonical `events` row only when `LiveEvent.serverEventId` is present. Older persisted local live events migrate to `serverEventId: null`, so cover uploads are visibly blocked instead of pretending to save against `le_*`.
- Jest emitted the existing Watchman recrawl warning; tests still passed.

