# IMPLEMENTATION REWORK: META-ORCH-1009 Sub-E Business App Supply Feeder

Status: implemented, partially verified; ready for orchestrator re-review before tester
Date: 2026-05-30
Implementor: implementor+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Outcome

This rework resolves the highest-risk implementation-review blockers without starting Sub-F.

Sarah's create-new/claim venue flow now saves Tier 1 first, then stays in the same first-session setup flow for:

- ORCH-0989 `CoverPickerSheet` hero media.
- Tier 2 website, price tier, and vibe-chip inputs.
- Gemini-backed generated bio/scores.
- Sarah confirmation/editing before the generated public bio and inferred facets are published.
- Hub/Home-visible deck-readiness coaching.

The work remains partially verified because the per-ORCH worktree is not Supabase-linked, and the SQL migration tests were run against a local DB that did not have the new migration applied.

## Files Changed In This Rework

New files:

- `mingla-business/src/components/home/DeckReadinessCard.tsx`
- `mingla-business/src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts`
- `mingla-business/src/hooks/useBrandPlacePipelineState.ts`
- `supabase/functions/run-business-place-authoring-pipeline/__tests__/stage_contract.test.ts`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

Modified high-signal files:

- `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
- `mingla-business/src/components/venue/VenueStep3Photos.tsx`
- `mingla-business/src/components/venue/venueWizardValidation.ts`
- `mingla-business/src/services/businessPlaceAuthoringService.ts`
- `mingla-business/src/services/poolSearchService.ts`
- `mingla-business/src/types/poolMatch.ts`
- `mingla-business/app/(tabs)/home.tsx`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts`
- `supabase/functions/claim-search-pool/index.ts`
- `supabase/migrations/20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql`
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

Pre-existing Sub-E implementation files remain in the branch and are not relisted exhaustively here.

## P0 Rework Resolution

| Review blocker | Resolution | Verification |
| --- | --- | --- |
| CoverPicker hard guard missed | Removed the venue wizard's direct `ImagePicker` step. Step 3 now explains the first-session CoverPicker handoff, and after Tier 1 is saved the wizard mounts `CoverPickerSheet` with a brand target. `sync_hero_media` now persists `business_hero_video_present` and `stored_photo_urls` for B8. | Source grep found no direct `ImagePicker`/`launchImageLibraryAsync` in venue components except protective test text. Jest source contract passed. Deno stage-contract test passed. |
| Tier 2 UI + generated-bio confirmation missing | Added first-session Tier 2 panel inside `VenueCreatorWizard`: website, price tier, vibe chips, generated-bio preview/edit, and confirm action. | Jest source contract passed. Manual simulator not run. |
| Generated bio written before confirmation | `run_tier2_pipeline` now writes Gemini bio/facets under `business_authoring_inputs.pending_ai_outputs` and keeps `is_servable=false`. `confirm_ai_outputs` is the action that writes `generative_summary` and confirmed facets. | Deno stage-contract test passed and asserts `handleTier2` does not write `generative_summary`. |
| Hub bouncer coaching missing | Added `DeckReadinessCard` and `useBrandPlacePipelineState`; Home now shows pipeline coaching for the selected brand and routes fixes back to venue setup. | Jest source contract passed. Manual UI smoke not run. |
| ORCH-0863 backend allowlist missing | Added `META_ORCH_1009_SUB_E_BACKEND_ALLOWLIST` and included Sub-E backend files/tests. | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` passed. |
| Google matches still top-N capped | Client now invokes claim search with `{ fetch_all: true, limit: null }`; edge returns `exhausted: true`; migration RPC ignores the legacy `p_limit` and removes the SQL `LIMIT`. | Jest source/service test passed. |
| 8 Gemini stages collapsed without durable state | `stage_status` now stores all eight stage keys with explicit pending/complete/confirmation states. This is durable per-brand state, though still a compact state object rather than eight separate rows. | Deno stage-contract test passed. Orchestrator should decide if this satisfies the spec or needs forensics amendment. |
| Tests below risk | Added focused Jest and Deno tests; reran prior Deno/Jest/strict-grep gates. | See verification matrix. SQL tests attempted but blocked by local DB state. |

## Cross-Surface Matrix

| Surface | Touched? | Notes |
| --- | --- | --- |
| Business iOS / Android | Yes | Venue creator now has first-session post-Tier-1 deck setup with CoverPickerSheet + Tier 2 confirm/edit. |
| Business Web preview | Yes | Same React Native web route/components. No browser visual smoke was run. |
| Admin Web | No | Sub-D/admin intelligence paths not touched. |
| Consumer iOS / Android | Indirect backend only | Ranker video boost was existing partial implementation; no consumer UI touched in rework. |
| Buyer / anonymous Web | No | Checkout and public buyer surfaces out of scope. |
| Supabase Edge/DB | Yes | Business authoring pipeline, claim search, migration, parser/agent work from original implementation remain in scope. |

## Verification Matrix

Passed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && node .github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs
```

Result: `OK: I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER — 1293 files scanned, 0 unauthorized writers`

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: all checks PASS, including C7.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/.deno/bin/deno check supabase/functions/run-business-place-authoring-pipeline/index.ts supabase/functions/claim-search-pool/index.ts supabase/functions/parse-restaurant-menu/index.ts supabase/functions/parse-play-activities/index.ts
```

Result: pass.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/.deno/bin/deno test --allow-all supabase/functions/_shared/__tests__/signalScorer.blend.test.ts supabase/functions/run-business-place-authoring-pipeline/__tests__/stage_contract.test.ts
```

Result: 18 passed, 0 failed.

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npx jest src/services/__tests__/poolSearchService.test.ts src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts --runInBand
```

Result: 3 suites passed, 7 tests passed.

Partially passed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]/mingla-business" && npm run typecheck -- --noEmit --pretty false
```

Result: failed on known unrelated repo errors plus one new Sub-E service error. The Sub-E error in `src/services/businessPlaceAuthoringService.ts` was fixed, and a filtered rerun showed no remaining errors from `businessPlaceAuthoringService`, `VenueCreatorWizard`, `DeckReadinessCard`, `useBrandPlacePipelineState`, `poolSearchService`, or `run-business`.

Blocked / not accepted as pass:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase migration list --linked
```

Result: failed because this worktree is not linked: `Cannot find project ref. Have you run supabase link?`

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase test db supabase/migrations/__tests__/sub_e_business_place_schema.test.sql supabase/migrations/__tests__/sub_e_pending_action_expiry.test.sql
```

Result: failed because the local DB did not have the Sub-E migration applied; checks reported nullable Google ID and expiry function missing. This is a local migration-state failure, not proof the migration SQL is wrong. These SQL tests must be rerun after local reset/apply or after the branch is merged into a linked checkout.

## Remote Read-Only Probe

Read-only remote probe via Supabase MCP before migration handoff:

| Probe | Result |
| --- | ---: |
| Existing `place_pool.google_place_id IS NULL` rows | 0 |
| Duplicate non-null Google Place IDs | 0 |
| Unexpected `fetched_via` rows outside current check | 0 |
| Expired pending actions | 23 |
| Pending Hub experience actions | 23 |
| Existing business-authored rows | 0 |

Interpretation: the partial unique index should not fail on duplicate Google IDs, and the migration's one-shot expiry will intentionally expire 23 stale pending rows.

## Migration State And Handoff

The per-ORCH worktree is not Supabase-linked, so `migration list --linked` cannot be proven there. The linked anchor checkout was checked instead:

```bash
cd "/Users/sethogieva/Desktop/mingla-main" && /Users/sethogieva/bin/supabase migration list --linked
```

Result: local/remote are aligned through `20260808000000`; no remote-only versions appeared in the tail output. The Sub-E migration is `20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql`, so it is monotonic and should not require `--include-all`.

Do not run this until the branch is merged into a linked checkout or the Sub-E worktree is linked:

```bash
cd "/Users/sethogieva/Desktop/mingla-main" && /Users/sethogieva/bin/supabase db push --linked
```

## Edge Deploy Notes

After PR merge and DB push, orchestrator should deploy these edge functions from the merged source:

- `run-business-place-authoring-pipeline`
- `claim-search-pool`
- `parse-restaurant-menu`
- `parse-play-activities`

No deploy was performed by implementor.

## Remaining Manual Gates

Before tester PASS:

1. Run the business app and smoke-test create-new Sarah flow on native or web: no match -> category -> wizard -> submit Tier 1 -> CoverPickerSheet hero media -> generate AI -> edit/confirm bio.
2. Confirm Hub/Home displays the deck-readiness card and that fix CTA returns Sarah to venue setup.
3. Apply/reset a local DB with the Sub-E migration and rerun the two SQL tests.
4. After DB push, verify remote `brand_place_pipeline_state` RLS with an owned brand and a non-owned brand.
5. Verify a hero video sets `business_hero_video_present=true` and `stored_photo_urls` on the linked `place_pool` row.

## Not Implemented / Deferred

- Sub-F deck card type and checkout are not implemented.
- Multi-stop/cross-brand curation is not implemented.
- No simulator/browser visual smoke was run.
- The 8-stage contract is durable in one `stage_status` object, not eight separate stage rows. Orchestrator should accept this compact implementation or route back for a spec amendment.
