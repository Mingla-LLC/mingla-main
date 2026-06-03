# IMPLEMENTATION REWORK 2 - META-ORCH-1009 Sub-E Business-App Supply Feeder

Status: implemented, partially verified
Date: 2026-05-30
Implementor: implementor+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Source Inputs

- Rework prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_2_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Rework review: `Mingla_Artifacts/reports/REVIEW_REWORK_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Design: `Mingla_Artifacts/reports/DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Design review: `Mingla_Artifacts/reports/REVIEW_DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Spec: `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

## Rework Criteria

| Review blocker | Result |
|---|---|
| P1-1: Deck-readiness card only surfaced on Home, not Hub | Fixed. `DeckReadinessCard` is now a venue component and renders on Hub under `VenueClaimStatusBanner`, with the same hidden-on-draft guard as Home. |
| P1-2: One-tap fix CTAs ignored reason codes | Fixed. `deckReadinessRoutes.ts` maps each bouncer fix to a durable `/venue/deck-readiness` focus target and carries `brand_id`, `place_pool_id`, `fix`, and `focus`. |
| P1-3: Fix path could not resume Sarah's persisted context | Fixed. New `/venue/deck-readiness` route fetches persisted authoring context and hydrates Tier 2 answers, pending AI bio, inferred facets, coaching, and cover media into `VenueDeckReadinessSetup`. |
| P1-4: `refresh_deck_readiness` reused confirmation semantics | Fixed. Edge action now reruns bouncer/readiness only, does not write `generative_summary`, does not write confirmed AI outputs, and does not publish unless AI outputs were already confirmed. |

## What Changed

### Business UI

- Moved readiness coaching into `mingla-business/src/components/venue/DeckReadinessCard.tsx`.
- Wired Home and Hub to route each coaching CTA through `routeForPipelineStateFix`.
- Added `mingla-business/app/venue/deck-readiness.tsx` as the durable fix/resume route.
- Extended `VenueDeckReadinessSetup` so it can hydrate from persisted pipeline state instead of starting blank.
- Added focus behavior for basics, website, hours, cover, confirm, and review paths; cover focus opens the existing CoverPicker path.
- Removed stale Home `rung === 4` checks after TypeScript proved the current recommendation contract only returns rungs 1-3.

### Business Services and Hooks

- Added `refreshDeckReadiness` and `fetchBrandPlaceAuthoringContext` in `businessPlaceAuthoringService.ts`.
- Added `useBrandPlaceAuthoringContext` plus context query keys in `useBrandPlacePipelineState.ts`.
- Added `deckReadinessRoutes.ts` with a small, test-covered mapping from bouncer fix reasons to concrete route focus targets.

### Edge Function

- Added action `get_authoring_context` to `run-business-place-authoring-pipeline`.
- Split `refresh_deck_readiness` away from confirmation semantics.
- Persisted Tier 1 hours into `place_pool.opening_hours` for existing-place and create-new paths so bouncer B6 can pass from business-app input.
- Consolidated bouncer place construction so Tier 2 confirmation and refresh evaluate the same place shape.

### Tests

- Added route tests for all fix-target mappings.
- Added Home/Hub readiness-card tests so both surfaces stay wired.
- Added durable route source tests for context hydration.
- Updated `VenueCreatorWizard` tests for hydration and focused fix behavior.
- Added edge contract tests proving refresh does not write confirmation fields.

## Cross-Surface Matrix

| Surface | Impact |
|---|---|
| Business iOS / Android | Touched. Hub and Home now show deck-readiness coaching; fix CTAs resume venue authoring with persisted context. |
| Business Web preview | Touched through shared Expo route/component code. Not visually smoke-tested in runtime. |
| Admin Web | Not touched. |
| Consumer iOS / Android | Not touched in this rework. Existing ranker/deck contracts remain the downstream consumer surface. |
| Buyer / anonymous Web | Not touched. |
| Supabase edge/runtime | Touched. Business authoring pipeline has new refresh and context actions. |
| Supabase schema/RLS | Uses the existing Sub-E migration from the broader implementation; this rework did not add a new migration file. |

## Verification

### Passed

```bash
node .github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs
```

Result: `OK: I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` with 1294 files scanned and 0 unauthorized writers.

```bash
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: passed all C1-C7 checks.

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/run-business-place-authoring-pipeline/index.ts supabase/functions/claim-search-pool/index.ts supabase/functions/parse-restaurant-menu/index.ts supabase/functions/parse-play-activities/index.ts
```

Result: passed.

```bash
/Users/sethogieva/.deno/bin/deno test --allow-all supabase/functions/_shared/__tests__/signalScorer.blend.test.ts supabase/functions/run-business-place-authoring-pipeline/__tests__/stage_contract.test.ts
```

Result: 19 passed, 0 failed.

```bash
cd mingla-business && npx jest src/services/__tests__/poolSearchService.test.ts src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts src/utils/__tests__/deckReadinessRoutes.sub_e.test.ts app/venue/__tests__/create.ve2.test.ts --runInBand
```

Result: 5 suites passed, 12 tests passed.

After removing the stale Home rung-4 checks:

```bash
cd mingla-business && npx jest src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts src/utils/__tests__/deckReadinessRoutes.sub_e.test.ts app/venue/__tests__/create.ve2.test.ts --runInBand
```

Result: 3 suites passed, 7 tests passed.

### Partially Verified / Known Repo-Wide Failures

```bash
cd mingla-business && npm run typecheck -- --noEmit --pretty false
```

Result: failed, but the touched-file `home.tsx` `TS2367` errors are gone. Remaining failures are outside this rework: checkout buyer implicit `any`s, ComposerV2 rich-editor type drift, `IconChrome` web hover typing, `Sheet.web` cursor typing, missing `@mingla/payments-native`, stale `DraftEvent.category` tests, and missing React/Expo type context for shared packages under `../packages`.

### Remote Migration Safety Probe

Read-only Supabase SQL probe run against remote:

```sql
select
  (select count(*) from (
    select google_place_id
    from public.place_pool
    where google_place_id is not null
    group by google_place_id
    having count(*) > 1
  ) d) as duplicate_google_place_id_groups,
  (select count(*) from public.place_pool
   where fetched_via is null
      or fetched_via <> all (array['nearby_search','text_search','detail_refresh','business_authored'])) as fetched_via_values_outside_sub_e_check;
```

Result: `duplicate_google_place_id_groups = 0`, `fetched_via_values_outside_sub_e_check = 0`.

### Migration Chain

Local worktree migration tail:

```text
20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql
20260805000000_orch_1006_public_event_tier_allin.sql
20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql
20260807000000_orch_1017_pg_intelligence_coverage.sql
20260808000000_meta_orch_1009_sub_d_refresh_cron.sql
20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql
```

`/Users/sethogieva/bin/supabase migration list --linked` cannot run from the Sub-E worktree because the worktree is not linked: `Cannot find project ref. Have you run supabase link?`

The linked anchor checkout migration list shows remote/local aligned through `20260808000000`; Sub-E `20260809000000` is local-only and pending.

## Deploy Notes

Migration apply is blocked from direct worktree execution until the worktree is Supabase-linked, or until this branch is merged into a linked checkout. Once linked or merged into a linked checkout, apply the migration with:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase db push --linked
```

Edge functions that need deployment after orchestrator close/promotion:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy run-business-place-authoring-pipeline
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy claim-search-pool
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy parse-restaurant-menu
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase functions deploy parse-play-activities
```

## Manual Smoke Gate for Tester

1. Open Mingla Business with a selected physical venue brand that has Sub-E pipeline state.
2. Go to Hub and confirm the deck-readiness coaching card appears below the venue claim banner when status is not `draft`.
3. Tap each available fix CTA and confirm it opens `/venue/deck-readiness` with the matching persisted context instead of restarting `/venue/create?pool=1`.
4. For `edit_cover`, confirm CoverPicker opens; for `confirm_ai_outputs`, confirm pending AI bio/facets hydrate and can be confirmed.
5. Tap the refresh/deck-check action before confirming AI outputs and verify it updates coaching without writing confirmed AI outputs or publishing the place as deck eligible.

## Residual Risk

- Runtime visual smoke was not performed in simulator/browser during this implementor pass.
- Full `mingla-business` typecheck remains red for repo-wide unrelated issues, so this handoff is `implemented, partially verified` rather than `implemented and verified`.
- The Sub-E worktree is not Supabase-linked; orchestrator must either link before deploy gates or run apply/deploy from a linked checkout after promotion.
