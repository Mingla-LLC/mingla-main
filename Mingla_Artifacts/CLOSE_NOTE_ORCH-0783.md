# Close Note: ORCH-0783 Event Cover Image Provider Pivot

Date: 2026-05-11  
Owner: Codex `orchestrator-mingla`  
Verdict accepted for close: CONDITIONAL PASS  
Grade: A-  
Working tree: `.worktrees/orch-0783-event-cover-image-provider-pivot/`

## Close Decision

ORCH-0783 is closed with accepted CONDITIONAL PASS. The launch-critical direction is achieved: Mingla Business Step 4 is now image/provider-first for event covers, provider metadata persists through the relevant data paths, and legacy published video rendering plus `coverHue` fallback remain intact.

The accepted conditions are release operations, not implementor rework:
- Apply migration `20260515000018_orch_0783_event_cover_provider_metadata.sql` before deployed app code depends on provider metadata columns.
- Configure public GIPHY env names and Supabase Edge Function secret `PEXELS_API_KEY` outside Git without exposing secret values.
- Deploy `event-cover-pexels-search` after Deno gates.
- Run iOS, Android, and Web parity smoke for local image/GIF upload, GIPHY select, Pexels select, published cover replacement, public attribution, checkout/order/card surfaces, and legacy video/hue fallback.

## Evidence

- Investigation: `reports/INVESTIGATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- Spec: `specs/SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- Spec review: `reports/REVIEW_SPEC_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- Implementation: `reports/IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- Implementation review: `reports/REVIEW_IMPLEMENTATION_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- Rework approval: `reports/REVIEW_REWORK_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`
- QA: `reports/QA_ORCH-0783_EVENT_COVER_IMAGE_PROVIDER_PIVOT.md`

## Verification Summary

QA verified:
- Prior P1 blocker fixed: published cover-only edits now carry provider metadata through `liveEventAdapter` into `updatePublishedEventCoverMedia`.
- `mingla-business/src/utils/__tests__/liveEventAdapter.test.ts` covers selected Pexels metadata and stale provider metadata clearing for upload covers.
- `npm run test:orch-0783` passed: 8 suites, 68 tests.
- Focused `npx jest liveEventAdapter.test --runInBand` passed.
- `npm run test:orch-0770` passed.
- `npm run test:orch-0776` passed on standalone rerun.
- `npm run tsc -- --noEmit` passed.
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/event-cover-pexels-search/index.ts` passed.
- `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net supabase/functions/event-cover-pexels-search/index.test.ts` passed: 5 tests.
- ORCH-0783 strict grep, `git diff --check`, no-deletion check, and migration monotonic check passed.
- DIAG-marker reaping for `[ORCH-0783-DIAG]` returned zero matches in required code paths.

## Hard Guards Preserved

- No provider secret values were read, printed, or committed.
- No migrations or functions were deleted.
- `coverHue` was not removed.
- Legacy video rendering was not retired.
- TEST did not apply migrations or deploy functions.

## Deploy / Release Notes

Apply the Supabase migration first, then deploy `event-cover-pexels-search`, then publish the business app update through the normal Mingla Business release flow. This change includes a Supabase migration and Edge Function; do not treat an app-only OTA/deploy as complete release.

## Next Priority

ORCH-0782 remains the recommended next investigation: organizer "Resend ticket" CTA and notification rollup recompute. Prompt: `Mingla_Artifacts/prompts/FORENSICS_ORCH-0782_ORGANIZER_RESEND_TICKET_CTA_AND_NOTIFICATION_ROLLUP.md`.
