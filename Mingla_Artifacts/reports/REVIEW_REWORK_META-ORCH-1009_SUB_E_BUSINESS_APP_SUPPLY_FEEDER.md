# REVIEW_REWORK_META-ORCH-1009 Sub-E — Business-App Supply Feeder

Date: 2026-05-30
Reviewer: orchestrator+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`
Reviewed report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

## Verdict

REWORK REQUIRED before tester.

The rework fixed meaningful parts of Sub-E: CoverPicker is now the upload path, Tier 2 output is pending until confirmation, the column-owner allowlist was extended, all-match claim search removed the SQL limit, and targeted Deno/Jest checks passed. The remaining blockers are narrower than the first review, but they are user-path blockers: Sarah can still get stuck outside the mandatory bouncer coaching loop, and one backend action can publish unconfirmed content.

## Blocking Findings

### R1 — Coaching loop is on Home, not Sarah's Hub

Requirement: the bouncer coaching loop must live in Sarah's Hub as "Why you're not in the deck yet" with one-tap fix paths.

Observed:

- `DeckReadinessCard` is imported and rendered only from `mingla-business/app/(tabs)/home.tsx`.
- No Hub route or Hub layout imports/renders `DeckReadinessCard`.
- `git diff -- mingla-business/app/(tabs)/hub/...` is empty, and `rg DeckReadiness mingla-business/app/(tabs)/hub mingla-business/src` finds only Home plus the component file.

Evidence:

- `mingla-business/app/(tabs)/home.tsx:39`
- `mingla-business/app/(tabs)/home.tsx:502`
- `mingla-business/app/(tabs)/home.tsx:505`
- `mingla-business/src/components/home/DeckReadinessCard.tsx:2`

Why it matters:

The operator-locked requirement names Sarah's Hub. Home-only visibility means the required business operating surface is still missing, and a business owner working from Hub can remain blocked without seeing the reason or the repair action.

Required fix:

Render the deck-readiness coaching module in the Hub chrome or the canonical Hub landing surface for the selected brand. Prefer a shared component path/name that does not imply Home ownership.

### R2 — One-tap fix paths ignore the reason code

Requirement: B3/B4/B5/B6/B8/CONFIRM reason codes must map to plain-English coaching and one-tap fix paths.

Observed:

- `DeckReadinessCard` passes the specific `fix` value to `onFix`.
- `home.tsx` receives `_fix` and discards it.
- Every fix routes to `/venue/create?pool=1`, regardless of whether the missing task is address, website, hours, hero media, AI confirmation, or generic review.

Evidence:

- `mingla-business/src/components/home/DeckReadinessCard.tsx:50`
- `mingla-business/src/components/home/DeckReadinessCard.tsx:62`
- `mingla-business/src/components/home/DeckReadinessCard.tsx:67`
- `mingla-business/app/(tabs)/home.tsx:385`
- `mingla-business/app/(tabs)/home.tsx:386`
- `mingla-business/app/(tabs)/home.tsx:387`

Why it matters:

The card text is good, but the promised one-tap repair loop is not implemented. Sarah taps "Add website" and lands in the generic venue creation wizard with no guarantee she is editing the already-created place, no targeted website focus, and no way to resume the pending AI confirmation state.

Required fix:

Implement explicit fix routing or a resumable deck-readiness route:

- `edit_address` opens the existing authored/claimed venue's basics/location step.
- `edit_website` opens Tier 2 with website focused.
- `edit_hours` opens the hours step for the same brand/place.
- `edit_cover` opens the CoverPicker-backed hero media task for the same brand/place.
- `confirm_ai_outputs` opens the generated-bio confirmation panel for the existing pending outputs.
- `review_pipeline` opens the resumable deck-readiness task list.

Add regression tests proving each fix value routes to the intended target and carries the existing `brand_id` / `place_pool_id` context.

### R3 — Recovery after leaving the first session is still brittle

Requirement: Tier 1 + Tier 2 can be completed in the first session, and the bouncer loop can coach fixes later.

Observed:

- `VenueDeckReadinessSetup` is only mounted from local `createdVenue` state immediately after `handleSubmit` succeeds.
- `/venue/create?pool=1` starts from `useDraftVenueStore`; it does not load `brand_place_pipeline_state`, `brand_id`, `place_pool_id`, pending generated bio, pending facets, or existing Tier 2 inputs.
- The Hub/Home readiness card routes back to the generic venue create path, which can start a new draft or stale draft instead of repairing the existing authored place.

Evidence:

- `mingla-business/src/components/venue/VenueCreatorWizard.tsx:197`
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx:199`
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx:326`
- `mingla-business/app/venue/create.tsx:40`
- `mingla-business/app/venue/create.tsx:43`
- `mingla-business/app/venue/create.tsx:80`
- `mingla-business/app/venue/create.tsx:140`

Why it matters:

This is the product loop Sub-E exists to create. If Sarah closes the app after Tier 1/Tier 2, or if bouncer returns B5/B6/B8 after confirmation, the app has to resume the same place and show the same pending outputs. The current flow is mostly an in-memory continuation.

Required fix:

Create a durable resume route or teach `VenueCreatorWizard` / a dedicated deck-readiness screen to load by `brand_id` and `place_pool_id` from `brand_place_pipeline_state`. It must hydrate pending AI outputs from `place_pool.business_authoring_inputs.pending_ai_outputs` and route fixes against the existing row.

### R4 — `refresh_deck_readiness` publishes through confirmation semantics

Requirement: confirmation is the only action that publishes the generated sales bio and facets.

Observed:

- `refresh_deck_readiness` dispatches to `handleConfirmAiOutputs`.
- It passes `sales_bio` from `body.sales_bio` or falls back to `brand.description`.
- `handleConfirmAiOutputs` writes `generative_summary`, confirmed facets, `confirmed_ai_outputs`, `business_authoring_status`, and `is_servable`.

Evidence:

- `supabase/functions/run-business-place-authoring-pipeline/index.ts:646`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts:705`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts:710`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts:720`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts:799`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts:800`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts:802`

Why it matters:

A "refresh readiness" action can publish existing brand copy as the deck summary without Sarah confirming the AI output. It also lets a refresh path mutate confirmation state and servability, which breaks the contract the rework was meant to enforce.

Required fix:

Split `refresh_deck_readiness` into its own handler. It may rerun bouncer/readiness and update `brand_place_pipeline_state`, but it must not write `generative_summary`, `confirmed_ai_outputs`, confirmed facets, or publish `is_servable=true` unless confirmed outputs already exist and the action is explicitly scoped to rechecking the confirmed state.

Add a Deno regression test that fails if `refresh_deck_readiness` calls `handleConfirmAiOutputs` or writes `generative_summary`.

## Acceptance Notes

The compact `stage_status` JSON shape can be accepted for this sub if the second rework makes it durable enough for Sarah's resume/fix paths and keeps all 8 named stage keys visible. A separate per-stage table is not required for v1 unless tester finds retry/audit gaps after the recovery route exists.

Claim search's all-match direction is acceptable in code shape: the client sends `fetch_all: true`, the edge normalizes to `limit: null`, and the SQL function ignores legacy `p_limit`. Tester should still validate a query with more than the old top-N count after the migration is applied.

## Verification Reviewed

Passed by implementor:

- `node .github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs`
- `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- `/Users/sethogieva/.deno/bin/deno check supabase/functions/run-business-place-authoring-pipeline/index.ts supabase/functions/claim-search-pool/index.ts supabase/functions/parse-restaurant-menu/index.ts supabase/functions/parse-play-activities/index.ts`
- `/Users/sethogieva/.deno/bin/deno test --allow-all supabase/functions/_shared/__tests__/signalScorer.blend.test.ts supabase/functions/run-business-place-authoring-pipeline/__tests__/stage_contract.test.ts`
- `npx jest src/services/__tests__/poolSearchService.test.ts src/components/venue/__tests__/VenueCreatorWizard.ve2.test.ts src/components/home/__tests__/DeckReadinessCard.sub_e.test.ts --runInBand`

Still needs later gate:

- Migration tests did not run locally because this worktree was not linked/applied.
- A full app typecheck still has unrelated repo errors; implementor reported touched-file filtering clear after the one Sub-E service error was fixed.
- No sim/browser visual smoke was run.

## Decision

Do not send to tester yet. Send a second, narrow rework to implementor focused on:

1. Hub placement.
2. Reason-specific one-tap fix routing.
3. Durable resume of the existing brand/place/pending AI outputs.
4. A true read/check-only `refresh_deck_readiness`.
5. Regression tests for the four items above.
