# Implementation: ORCH-0783 Event Cover Image Provider Pivot

Date: 2026-05-11  
Status: implemented and verified  
Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`

## Summary

Implemented the launch pivot from active hue/video cover creation to image/provider-first event covers in Mingla Business. Step 4 now supports local image/GIF upload, direct-client GIPHY GIF search, and authenticated Pexels photo search through a Supabase Edge Function. Existing published cover rendering remains compatible with image/GIF/video/hue fallback; legacy video processing files/functions were preserved.

Rework update: addressed orchestrator review `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` by adding repo-running regression coverage for GIPHY adapter behavior, Pexels client adapter behavior, and Pexels Edge success/error paths. The ORCH-0783 strict-grep guard now fails if either provider adapter test file is missing.

QA rework update: addressed tester FAIL in `Mingla_Artifacts/reports/QA_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`. Published cover-only edits now carry `coverMediaProvider`, `coverMediaSourceUrl`, `coverMediaCredit`, `coverMediaCreditUrl`, and `coverMediaAlt` through `editableDraftToPatch`, so `EditPublishedScreen` passes the selected provider metadata to `updatePublishedEventCoverMedia` instead of falling back to stale/null live-event metadata.

## Behavior Before / After

Before:
- Step 4 exposed local image/GIF plus active phone-video upload/processing/recovery and a visible hue grid.
- Event cover persistence only carried `cover_media_url` and `cover_media_type`.
- Provider attribution/source/alt metadata had no durable contract.

After:
- Step 4 exposes local image/GIF upload, GIPHY, and Pexels cover selection only.
- Active Step 4 video upload, video processing copy, timeout recovery, replace-video, cancel-processing, and visible hue picker are removed.
- `coverHue` remains in stores/renderers as fallback.
- `EventCoverMedia` and public event video safety logic still preserve legacy video rendering/fallback.
- Provider metadata persists through draft insert/update, hydration, publish RPC response mapping, public event mapping, business event mapping, and published cover-only update.
- Public event hero renders compact provider credit for GIPHY/Pexels covers.

## Files Changed By Layer

Database / Supabase:
- `supabase/migrations/20260515000018_orch_0783_event_cover_provider_metadata.sql`
- `supabase/functions/event-cover-pexels-search/index.ts`
- `supabase/functions/event-cover-pexels-search/index.test.ts`
- `supabase/config.toml`

Business app services/types/state:
- `mingla-business/src/types/eventCoverProvider.ts`
- `mingla-business/src/services/eventCoverProviderError.ts`
- `mingla-business/src/services/giphyEventCoverService.ts`
- `mingla-business/src/services/pexelsEventCoverService.ts`
- `mingla-business/src/services/eventCoverMediaService.ts`
- `mingla-business/src/services/businessEvents.ts`
- `mingla-business/src/services/publicEventsService.ts`
- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/store/liveEventStore.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/utils/liveEventConverter.ts`
- `mingla-business/src/utils/liveEventAdapter.ts`

UI:
- `mingla-business/src/components/event/CreatorStep4Cover.tsx`
- `mingla-business/src/components/event/EditPublishedScreen.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/ui/IconChrome.tsx`
- `mingla-business/src/utils/eventCoverMediaRules.ts`

Tests / gates:
- `.github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs`
- `.github/scripts/strict-grep/orch-0770-event-cover-video-processing.mjs`
- `.github/scripts/strict-grep/orch-0776-video-processing-status-bridge.mjs`
- `.github/scripts/strict-grep/README.md`
- `.github/workflows/strict-grep-mingla-business.yml`
- `mingla-business/package.json`
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts`
- `mingla-business/src/services/__tests__/giphyEventCoverService.test.ts`
- `mingla-business/src/services/__tests__/pexelsEventCoverService.test.ts`
- `mingla-business/src/services/__tests__/businessEventsPublish.test.ts`
- `mingla-business/src/services/__tests__/publicEventsService.test.ts`
- `mingla-business/src/utils/__tests__/serverDraftEventMapper.test.ts`
- `mingla-business/src/utils/__tests__/liveEventAdapter.test.ts`

## Migration Details

Created monotonic migration `20260515000018_orch_0783_event_cover_provider_metadata.sql`. Local and `origin/main` max migration before implementation was `20260515000017_orch_0777_scan_wrong_event_result.sql`, so the new prefix is greater than current local/remote head.

The migration:
- Adds nullable `events.cover_media_provider`, `cover_media_source_url`, `cover_media_credit`, `cover_media_credit_url`, and `cover_media_alt`.
- Adds `events_cover_media_provider_check` allowing only `upload`, `giphy`, `pexels`, or null.
- Replaces `business_management_events_view` and `business_public_events_view` with the provider metadata columns added.
- Replaces `public.business_publish_event_draft` from the latest ORCH-0769 function body and adds only provider metadata reads/writes while preserving ORCH-0769 currency behavior.
- Includes `NOTIFY pgrst, 'reload schema';`.

No migration/function deletion was performed.

## Provider Key Handling

No provider key values were read, printed, committed, logged, or written to artifacts. GIPHY uses public Expo env names only. Pexels uses server-side `PEXELS_API_KEY` inside `event-cover-pexels-search`; the client calls only the Supabase Edge Function.

## Old Gate Changes

ORCH-0770 and ORCH-0776 strict-grep gates were narrowed where they required active Step 4 video UI. They still protect dormant video processing files/functions, Cloudinary webhook safety, browser-safe processed MP4 constraints, enriched status mapping, cancellation support, and public legacy unsafe-video fallback.

Retired active Step 4 assertions:
- Step 4 must import/use `createEventCoverVideoUploadIntent`.
- Step 4 must request native video editing.
- Step 4 must validate native-trimmed video output.
- Step 4 must render timeout recovery actions.

Replacement guard:
- New ORCH-0783 gate forbids active Step 4 video/hue creation tokens, requires GIPHY/Pexels provider selection, requires provider metadata persistence, verifies the provider adapter test files exist, and verifies legacy `EventCoverMedia` video support plus public unsafe-video fallback remain.

## Verification

Passed:
- `cd mingla-business && npm run test:orch-0758a`  
  6 suites, 64 tests passed.
- `cd mingla-business && npm run test:orch-0783`  
  ORCH-0783 strict grep passed; 8 suites, 68 tests passed.
- `cd mingla-business && npm run test:orch-0770`  
  ORCH-0770 strict grep passed; 3 suites, 26 tests passed; TypeScript passed.
- `cd mingla-business && npm run test:orch-0776`  
  ORCH-0776 strict grep passed; 1 suite, 13 tests passed.
- `cd mingla-business && npm run tsc -- --noEmit`  
  Passed.
- `cd mingla-business && npx jest liveEventAdapter.test --runInBand`  
  1 suite, 2 tests passed.
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-pexels-search/index.ts`  
  Passed.
- `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/event-cover-pexels-search/index.test.ts`  
  5 tests passed.
- `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/_shared/eventCoverVideo.test.ts`  
  8 tests passed. Live column-shape subcheck skipped because Supabase env is missing.
- `node .github/scripts/strict-grep/orch-0783-event-cover-image-provider-pivot.mjs`  
  Passed.
- `git diff --check`  
  Passed.

Note: `deno` was not on PATH, so gates were run with `/Users/sethogieva/.deno/bin/deno` per implementor instructions.

Rework-specific regression coverage added:
- `giphyEventCoverService.test.ts` proves direct GIPHY search URL/params, exact trimmed query, `rating=pg`, limit/offset clamping, selected GIF fallback order, metadata normalization, missing public key handling, rate-limit handling, provider unavailable handling, invalid response handling, and short-query rejection before provider calls.
- `pexelsEventCoverService.test.ts` proves the client invokes only `event-cover-pexels-search`, trims query, passes page/perPage, rejects short queries before Edge invocation, maps Edge error codes, and rejects malformed Edge responses.
- `event-cover-pexels-search/index.test.ts` now proves authenticated success proxying with server-side Authorization, `orientation=landscape`, clamped page/perPage, normalized `src.landscape` output, rate-limit header passthrough, missing-key `pexels_not_configured`, and provider 429 `pexels_rate_limited`.
- `liveEventAdapter.test.ts` proves published cover edit patches carry selected Pexels provider metadata and clear stale provider/source/credit/alt metadata when switching back to an uploaded cover. This is the regression that would fail before the QA rework because `editableDraftToPatch` only emitted `coverMediaUrl` and `coverMediaType`.

## Residual Risks / Operator Notes

- Operator must configure provider env/secrets outside Git: public GIPHY env for the business app and Supabase Edge Function secret `PEXELS_API_KEY`.
- Migration must be applied before deployed app code depends on provider metadata columns.
- Deploy `event-cover-pexels-search` after migration/app review; no Edge Function deploy was run from this worktree.
- Business app deploy/OTA is JS-only unless the release process chooses a native rebuild for unrelated reasons.
- No live provider API search was performed because key values are intentionally out of scope.

## Next Handoff

NEXT HANDOFF — paste into Codex `tester`:

Retest ORCH-0783 in Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/` after the published cover-only provider metadata rework. Inputs are QA FAIL report `Mingla_Artifacts/reports/QA_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, updated implementation report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, spec `Mingla_Artifacts/specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, rework approval `Mingla_Artifacts/reports/REVIEW_REWORK_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`, and the new regression `mingla-business/src/utils/__tests__/liveEventAdapter.test.ts`. Hard guards remain: do not apply migrations, deploy functions, read or print provider secret values, weaken tests, delete migrations/functions, remove `coverHue`, or retire legacy video rendering. Expected output is an updated QA report at `Mingla_Artifacts/reports/QA_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md` with PASS / CONDITIONAL PASS / FAIL, severity counts, verification commands, and any manual parity gates; after PASS or accepted CONDITIONAL PASS route to Codex `orchestrator-mingla` for CLOSE, and after FAIL route back to Codex `implementor-mingla` for bounded rework.
