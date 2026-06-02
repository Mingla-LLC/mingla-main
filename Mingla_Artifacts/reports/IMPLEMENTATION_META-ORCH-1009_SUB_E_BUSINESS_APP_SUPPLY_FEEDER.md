# IMPLEMENTATION — META-ORCH-1009 Sub-E Business App Supply Feeder

Status: implemented, partially verified

## Summary

This pass ships the core Sub-E supply-side foundation, but it does not complete the whole 4-6 day Sub-E product scope.

Implemented:

- Business-created `place_pool` schema support:
  - `google_place_id` nullable.
  - non-null Google uniqueness preserved through a partial unique index.
  - `fetched_via = 'business_authored'`.
  - `business_author_brand_id`, `business_authoring_status`, `business_hero_video_present`, `photo_analysis`, and `business_authoring_inputs`.
  - `brand_place_pipeline_state` with owner RLS.
- New `run-business-place-authoring-pipeline` edge function:
  - `upsert_tier1_place` creates or links canonical `place_pool` rows.
  - `run_tier2_pipeline` calls Gemini 2.5 Flash and writes Q2-shaped `place_pool.ai_signal_scores`.
  - `sync_hero_media` syncs the hero-video flag.
  - bouncer verdict maps into pipeline status/coaching payload.
- Business app create-new path:
  - renders all returned pool matches.
  - allows continuing without choosing a match.
  - no longer blocks submit solely on missing `googlePlaceId`.
  - calls Tier 1 pipeline after venue brand creation.
- Hub proposal repair:
  - menu/activity proposals now have 7-day TTL.
  - parser responses include `expires_at`.
  - pending-experience fetch excludes expired rows.
  - expired cards cannot be accepted if surfaced.
  - `expire_agent_pending_actions` exists for server-side expiry.
- Signal ranker:
  - `business_hero_video_present` applies `min(100, rawAiScore * 1.15)` before Sub-B blend.
  - raw/pre-boost score contribution is visible.
  - inappropriate-for veto still runs before boost.
- Strict-grep allowlist now permits exactly the trial writer and the new business pipeline writer for `place_pool.ai_signal_scores`.

Not complete in this pass:

- The full Tier 2 UI is not built: vibe quiz, facet confirmation toggles, price tier/range, and generated-bio confirm/edit still need a product/UI pass.
- The wizard no longer directly uploads with `uploadBrandCover`, but the full ORCH-0989 `CoverPickerSheet` first-session venue mount is not fully solved because the existing `CoverPickerSheet` requires a persisted `brandId`. Current local photo fallback warns that the cover still needs saving later.
- Hub "Why you're not in the deck yet" data is produced by the edge pipeline, but a dedicated Hub readiness card is not rendered yet.
- Full Gemini stage decomposition is implemented as one structured Gemini 2.5 Flash Tier 2 call rather than separate durable records for all 8 stages.
- No simulator/manual run was performed.

## Changed Files

Database:

- `supabase/migrations/20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql`
- `supabase/migrations/__tests__/sub_e_business_place_schema.test.sql`
- `supabase/migrations/__tests__/sub_e_pending_action_expiry.test.sql`

Supabase edge/shared:

- `supabase/functions/run-business-place-authoring-pipeline/index.ts`
- `supabase/functions/_shared/signalScorer.ts`
- `supabase/functions/_shared/__tests__/signalScorer.blend.test.ts`
- `supabase/functions/_shared/agentTools.ts`
- `supabase/functions/_shared/poolMatchResponse.ts`
- `supabase/functions/claim-search-pool/index.ts`
- `supabase/functions/parse-restaurant-menu/index.ts`
- `supabase/functions/parse-play-activities/index.ts`

Business app:

- `mingla-business/app/venue/create.tsx`
- `mingla-business/app/venue/__tests__/create.ve2.test.ts`
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
- `mingla-business/src/components/venue/VenueStep1Address.tsx`
- `mingla-business/src/components/venue/venueWizardValidation.ts`
- `mingla-business/src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts`
- `mingla-business/src/hooks/usePoolMatchSearch.ts`
- `mingla-business/src/services/businessPlaceAuthoringService.ts`
- `mingla-business/src/services/brandsService.ts`
- `mingla-business/src/services/experienceGenerationService.ts`
- `mingla-business/src/services/poolSearchService.ts`
- `mingla-business/src/services/__tests__/poolSearchService.test.ts`
- `mingla-business/src/types/poolMatch.ts`
- `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx`
- `mingla-business/src/components/experience/ExperienceReviewCards.tsx`

Invariant:

- `.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs`

## Verification

Passed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/.deno/bin/deno check supabase/functions/run-business-place-authoring-pipeline/index.ts supabase/functions/claim-search-pool/index.ts supabase/functions/parse-restaurant-menu/index.ts supabase/functions/parse-play-activities/index.ts
```

Passed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/.deno/bin/deno test --allow-all supabase/functions/_shared/__tests__/signalScorer.blend.test.ts
```

Result: 14 passed, 0 failed.

Passed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && node .github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs
```

Result: 1,291 files scanned, 0 unauthorized writers.

Passed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest src/services/__tests__/poolSearchService.test.ts app/venue/__tests__/create.ve2.test.ts src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts --runInBand
```

Result: 3 suites passed, 5 tests passed.

Passed rerun after the create-new button adjustment:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest app/venue/__tests__/create.ve2.test.ts src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts --runInBand
```

Result: 2 suites passed, 2 tests passed.

Failed, apparently for pre-existing unrelated repo issues:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npm run typecheck -- --noEmit
```

The failure list did not include files changed by this implementation. It reported existing errors in `app/(tabs)/home.tsx`, checkout buyer screens, marketing composer, shared rendering packages, and native payment module typings.

Migration chain:

- Worktree command failed because the per-ORCH worktree is not Supabase-linked:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase migration list --linked
```

Output: `Cannot find project ref. Have you run supabase link?`

- Anchor checkout command succeeded and showed local/remote aligned through `20260808000000`, with no remote-only versions:

```bash
cd "/Users/sethogieva/Desktop/mingla-main" && /Users/sethogieva/bin/supabase migration list --linked
```

Remote read-only probe via Supabase MCP:

```sql
select
  (select count(*) from public.agent_pending_actions where status = 'pending' and expires_at <= now()) as expired_pending_actions,
  (select count(*) from public.agent_pending_actions where status = 'pending' and source = 'hub_experience') as pending_hub_experience_actions,
  (select count(*) from public.place_pool where google_place_id is null) as existing_null_google_place_rows,
  (select count(*) from public.place_pool where fetched_via = 'business_authored') as existing_business_authored_rows;
```

Result:

- `expired_pending_actions`: 23
- `pending_hub_experience_actions`: 23
- `existing_null_google_place_rows`: 0
- `existing_business_authored_rows`: 0

## Deploy Notes

Migration apply command after this branch is ready and the worktree is Supabase-linked:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase db push --linked
```

If the worktree remains unlinked, run the command only after linking the worktree or after the scoped branch is merged into the linked anchor checkout.

Edge deploy notes after merge/promotion, preserving COMMS-0015:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy run-business-place-authoring-pipeline
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy claim-search-pool
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy parse-restaurant-menu
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy parse-play-activities
```

Required edge secrets:

- `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY`
- existing Supabase URL/anon/service role secrets

## Manual Tester Gate

Manual QA is still required before Sub-E can be considered shippable:

1. Create a venue without selecting a match.
2. Verify `brands`, `brand_hours`, `place_pool`, and `brand_place_pipeline_state` rows.
3. Run Tier 2 with a real Gemini key and verify `place_pool.ai_signal_scores` has all active signals in the 6-key Q2 shape.
4. Upload a brand hero video after brand creation and verify `business_hero_video_present` plus the scorer boost.
5. Force stale Hub proposals and verify they are expired/no longer accept-able.
6. Trigger B3/B4/B5/B6/B8 bouncer reasons and verify the data payload maps to plain-English fixes.
7. Confirm the full ORCH-0989 CoverPickerSheet first-session venue UX after a design/rework pass.

## Recommended Next Step

Route this back through orchestrator as a partial implementation review, then dispatch a focused follow-up implementor rework for the unfinished UI pieces:

- first-session CoverPickerSheet architecture for not-yet-created brands;
- Tier 2 generated-bio confirm/edit and vibe/facet UI;
- Hub readiness coaching card rendering;
- more granular tests for the new edge function and SQL migration apply in a linked/local Supabase stack.
