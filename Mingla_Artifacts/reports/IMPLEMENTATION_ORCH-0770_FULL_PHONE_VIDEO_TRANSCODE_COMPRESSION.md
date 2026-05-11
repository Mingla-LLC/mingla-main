# IMPLEMENTATION ORCH-0770 — Full Phone Video Transcode + Compression

## Verdict

Implemented the full browser-safe event-cover video processing path behind Supabase Edge Functions with Cloudinary as the media transformer.

Images and GIFs still use the existing direct Supabase Storage path. Videos no longer go live as raw phone MOV/QuickTime files; they are uploaded to the provider, trimmed, transcoded to MP4/H.264/AAC, constrained to 15 seconds and 25 MB, then applied to the draft/live event only after processing succeeds.

## User Impact

- Organizers can choose a phone-shot video larger than the final 25 MB cover budget.
- If the video is longer than 15 seconds, Mingla shows a simple in-app trim selector instead of forcing the organizer to leave the app.
- The final public cover is a browser-safe MP4 derivative, not the raw phone file.
- Published events keep their existing cover until the processed replacement is ready and the organizer presses `Save changes`.
- Create/publish is blocked while a selected cover video is still processing.
- Public event pages avoid rendering historical unsafe `.mov` / QuickTime cover URLs as a black browser video.
- Public cover audio control is safe-area offset below the close/share chrome and can keep autoplay muted on web while allowing user sound opt-in.

## Files Changed

- `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql`
- `supabase/functions/_shared/eventCoverVideo.ts`
- `supabase/functions/event-cover-video-upload-intent/index.ts`
- `supabase/functions/event-cover-video-status/index.ts`
- `supabase/functions/event-cover-video-webhook/index.ts`
- `supabase/functions/event-cover-video-apply/index.ts`
- `supabase/functions/event-cover-video-cancel/index.ts`
- `mingla-business/src/services/eventCoverVideoProcessingService.ts`
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/components/event/EditPublishedScreen.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/event/types.ts`
- `mingla-business/src/components/ui/EventCoverMedia.tsx`
- `mingla-business/src/utils/eventCoverMediaRules.ts`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs`
- `mingla-business/package.json`

## Required Runtime Configuration

Set these in Supabase Edge Function secrets before testing live video processing:

- `EVENT_COVER_VIDEO_PROVIDER=cloudinary`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Optional controls:

- `EVENT_COVER_FINAL_MAX_BYTES` defaults to `26214400`
- `EVENT_COVER_MAX_DURATION_MS` defaults to `15000`
- `EVENT_COVER_MAX_SOURCE_VIDEO_BYTES` defaults to `524288000`
- `EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS` defaults to `300000`
- `EVENT_COVER_VIDEO_WEBHOOK_SECRET` optional fallback webhook secret

If Cloudinary env is not configured, the app receives the honest message: `Video cover processing is not configured yet. Images and GIFs still work.`

## Deployment Steps

1. Run `supabase db push` for migration `20260515000012_orch_0770_event_cover_video_processing.sql`. **Done 2026-05-09.**
2. Deploy the five new Supabase Edge Functions. **Done 2026-05-09.**
3. Set the Cloudinary secrets above. **Done 2026-05-09; secret values intentionally not recorded here.**
4. Rebuild/reload `mingla-business`. **Pending operator runtime/tester gate.**

Deployment evidence:

- `event-cover-video-upload-intent` ACTIVE, version 1, updated 2026-05-09 16:54:45 UTC.
- `event-cover-video-status` ACTIVE, version 1, updated 2026-05-09 16:54:45 UTC.
- `event-cover-video-webhook` ACTIVE, version 1, updated 2026-05-09 16:54:46 UTC.
- `event-cover-video-apply` ACTIVE, version 1, updated 2026-05-09 16:54:46 UTC.
- `event-cover-video-cancel` ACTIVE, version 1, updated 2026-05-09 16:54:44 UTC.

## Verification

Passed:

- `npx tsc --noEmit`
- `npm run test:orch-0770`
- `npx jest eventCoverMediaService.test eventCoverMedia.test --runInBand`
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-video-upload-intent/index.ts supabase/functions/event-cover-video-status/index.ts supabase/functions/event-cover-video-webhook/index.ts supabase/functions/event-cover-video-apply/index.ts supabase/functions/event-cover-video-cancel/index.ts`

Note: Jest emitted the existing Watchman recrawl warning, but both cover-media test suites passed.

## Known Follow-Up

The final Cloudinary callback behavior must be validated in a deployed environment with real Cloudinary credentials. Local static checks prove the contract and TypeScript/Deno correctness, but the provider webhook cannot be end-to-end proven until the functions and secrets are live.
