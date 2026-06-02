# Implementation: META-ORCH-1009 Sub-E - Business-App Supply-Side Onboarding Feeder

## Mission

Implement META-ORCH-1009 Sub-E so Sarah can create or claim a venue in Mingla Business, finish Tier 1 plus Tier 2 in the first session, and produce a canonical `place_pool` row with Gemini Q2-shaped `ai_signal_scores` from minute one.

Produce:

`Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

Working tree:

`/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`

Branch:

`META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Inputs

- SPEC: `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- SPEC review: `Mingla_Artifacts/reports/REVIEW_SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- DESIGN: `Mingla_Artifacts/reports/DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- DESIGN review: `Mingla_Artifacts/reports/REVIEW_DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Research: `Mingla_Artifacts/research/RESEARCH_BUSINESS_APP_TO_PIPELINE_FEEDER.md`
- Relevant prior specs:
  - `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md`
  - `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_B_CONSUMER_RANKER_BLEND.md`
  - `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md`

## Scope

IN:

- Business-app venue authoring flow: claim-existing and create-new.
- All-match Google/place-pool selection.
- Tier 1 and Tier 2 onboarding inputs.
- Shared `CoverPickerSheet` hero media path.
- New/extended edge-function pipeline for the 8 Gemini stages.
- `place_pool` + `brand_place_pipeline_state` schema/RLS migration.
- Hub deck-readiness coaching.
- Hub generated-experience proposal expiry repair.
- Parser universalization for restaurant/play/non-restaurant/non-play brands.
- `ai_signal_scores` writer allowlist expansion for the new business writer.
- Hero-video boost in scorer.
- Focused automated tests plus implementation report.

OUT:

- Consumer deck `cardType: brand_curated_single_venue`; that is Sub-F.
- Multi-stop or cross-brand curation.
- New checkout/payment surface.
- Stripe changes.
- New bouncer chain rules beyond coaching copy for existing B-codes.
- New consumer mobile surfaces.

## Hard Guards

- Gemini 2.5 Flash only for all new AI stages; cite official Google AI docs inline for introduced Gemini payloads/enums/endpoints.
- Do not use Claude in this pipeline.
- Show all active matches for the query; no silent top-N truncation.
- Create-new must not require `googlePlaceId`.
- Stage 4 generates the sales bio; Sarah confirms/edits before public/profile persistence.
- All hero media goes through ORCH-0989 `CoverPicker`/`CoverPickerSheet`.
- UI copy must not say or imply the x1.15 video boost guarantees rank, impressions, traffic, or revenue.
- `place_pool.claimed_by` remains an `auth.users(id)` FK.
- Business-brand linkage uses `brands.place_pool_id` plus `place_pool.business_author_brand_id` for business-created rows.
- Do not fabricate Google ratings, reviews, review counts, or Google verification for business-authored rows.
- Only `run-place-intelligence-trial/index.ts` and `run-business-place-authoring-pipeline/index.ts` may intentionally write `place_pool.ai_signal_scores`.
- Preserve ORCH-1006/COMMS-0016: Sub-F experiences must later route through `ticket-checkout-create`; do not create a parallel checkout path here.
- Preserve COMMS-0015: deployment notes must require merged source before durable edge deploy.

## Starting Files

Business app:

- `mingla-business/src/components/brand/BrandCreationFlow.tsx`
- `mingla-business/app/venue/create.tsx`
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
- `mingla-business/src/components/venue/VenueStep1Address.tsx`
- `mingla-business/src/components/venue/VenueStep2NameSlug.tsx`
- `mingla-business/src/components/venue/VenueStep3Photos.tsx`
- `mingla-business/src/components/venue/VenueStep4Hours.tsx`
- `mingla-business/src/components/venue/VenueStep5Contact.tsx`
- `mingla-business/src/components/venue/VenueStep6Description.tsx`
- `mingla-business/src/components/venue/VenueStep7Review.tsx`
- `mingla-business/src/components/brand/PoolMatchCard.tsx`
- `mingla-business/src/components/brand/VenueCategoryPicker.tsx`
- `mingla-business/src/hooks/usePoolMatchSearch.ts`
- `mingla-business/src/services/poolSearchService.ts`
- `mingla-business/src/components/ui/CoverPickerSheet.tsx`
- `mingla-business/app/(tabs)/hub/experiences.tsx`
- `mingla-business/src/components/experience/ExperienceReviewCards.tsx`
- `mingla-business/src/components/experience/ExperienceConfirmationCard.tsx`
- relevant services/stores/tests discovered by implementation.

Backend:

- `supabase/functions/run-business-place-authoring-pipeline/index.ts` (new)
- `supabase/functions/parse-restaurant-menu/index.ts`
- `supabase/functions/parse-play-activities/index.ts`
- `supabase/functions/_shared/agentTools.ts`
- `supabase/functions/_shared/signalScorer.ts`
- `supabase/functions/_shared/bouncer.ts`
- `supabase/functions/_shared/bouncerChainRules.ts`
- `.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs`
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- next monotonic migration under `supabase/migrations/`

## Required Implementation Notes

Before writing the migration, rerun the monotonicity checks in the SPEC and inspect sibling worktrees:

```bash
ls supabase/migrations | sort -V | tail -20
find /Users/sethogieva/Desktop/mingla-orchs -path '*/supabase/migrations/*.sql' -maxdepth 5 | sed 's#.*/supabase/migrations/##' | sort -V | tail -20
```

If `20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql` is no longer the next safe prefix, choose the next higher version and document why.

When the migration includes guards/backfills, run read-only remote probes for the exact assumptions before asking for `db push`. Include the probe SQL and results in the implementation report.

If a migration exists, the implementation report must include this exact command, adjusted only if `--include-all` is required after migration-list proof:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase db push --linked
```

If out-of-order application is intentional, use:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase db push --linked --include-all
```

## Regression Test Requirements

Every behavior fix must include repo-running tests that would fail before the change and pass after it. At minimum cover:

- Migration tests for business-authored `place_pool` rows, partial Google uniqueness, `brand_place_pipeline_state`, RLS, and pending-action expiry.
- Deno tests for universal parser eligibility, 7-day TTL, `expires_at`, `agentTools.create_experience`, Tier 1 create-new, generated-bio confirm, facet null semantics, Stage 6 Q2 shape, Stage 8 bouncer mapping, and unauthorized brand access.
- Signal scorer tests for hero-video boost, raw AI preservation, contribution fields, no-boost path, and inappropriate-for veto.
- Business app tests for create-new with no matches, all-match rendering, match prefill, no `googlePlaceId` requirement, CoverPickerSheet routing, Tier 1/Tier 2 action calls, Hub coaching B-code fixes, and expired proposal no-accept behavior.

Manual tester gate must remain in the implementation report for:

1. Create-new venue.
2. Tier 1 `place_pool` creation.
3. Tier 2 `ai_signal_scores`.
4. Video hero flag + scorer boost.
5. Stale proposal expiry.
6. Hub no-dead-accept-card behavior.
7. Bouncer failure coaching.

## Output Requirements

Implementation report must include:

- Summary of user-facing behavior before/after.
- Files changed.
- Migration name and monotonicity proof.
- Remote read-only guard/backfill probe results if migration has guards/backfills.
- Edge functions changed and deploy requirements.
- Exact tests run with commands and results.
- Any skipped test with reason and tester manual gate.
- Confirmation that no Sub-F consumer deck card or checkout work was included.
- DB push instructions if migration exists.
- Remaining risks and downstream tester focus.

## /goal

Sub-E implementation is complete only when code, migration, edge functions, business app UI, strict gates, focused tests, and the implementation report are all updated in this worktree, with no unrelated files staged. Return to orchestrator for implementation review before any migration apply, edge deploy, tester dispatch, PR, or close.
