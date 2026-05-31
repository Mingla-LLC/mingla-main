# SPEC: META-ORCH-1009 Sub-E - Business-App Supply-Side Onboarding Feeder

Status: READY FOR ORCHESTRATOR REVIEW  
Mode: Forensics SPEC  
Date: 2026-05-30  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`  
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`  
Depends on: META-ORCH-1009 Sub-A, Sub-B, Sub-D; META-ORCH-0972; ORCH-0989  
Primary investigation: `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

## 1. Outcome

Sarah can open the Mingla Business app, create or claim her wine bar, finish Tier 1 plus Tier 2 in the first session, and have the venue enter the consumer deck pipeline as a `place_pool` row with the same shape as a Google-ingested place.

The first-session result is:

- A canonical `brands` row owned by Sarah.
- A canonical `place_pool` row linked to that brand.
- Menu/activity suggestions that can actually be accepted from Hub.
- Gemini 2.5 Flash outputs for the 8 business-app stages.
- `place_pool.ai_signal_scores` populated in Sub-A/Sub-B's exact Q2 shape.
- Sub-D cron auto-rescoring the new AI slices within 15 minutes.
- A Hub coaching loop that tells Sarah why the venue is not in the deck yet and gives one-tap fix paths.

This sub does not put brand-authored experience cards into the consumer deck. That is Sub-F.

## 2. Locked Decisions

These are constraints, not options.

| Decision | Contract |
|---|---|
| Create-new path | Must be frictionless. If no Google match is selected, Sarah can continue and create a new business-authored place. |
| Google matches | Show all Google/place-pool matches for the query, not a top-N truncation. If pagination exists, the UI must fetch to exhaustion for the active query before showing the choice set. |
| Sales bio | Stage 4 AI generates the sales bio from Sarah's inputs. It is not just a cleanup pass over her writing. Sarah can confirm or edit. |
| AI provider | Gemini 2.5 Flash only for all 8 stages. No Claude path. Use official Gemini structured-output/function-calling contracts. |
| Bouncer loop | Mandatory "Why you're not in the deck yet" coaching in Sarah's Hub, mapping bouncer reasons to plain-English fixes. |
| Hero video | Hero video upload via the unified ORCH-0989 `CoverPicker` earns an effective x1.15 AI/ranker boost, capped at 100 before the Sub-B blend. |
| Experience scope | Multi-stop and cross-brand curation are deferred. v1 after Sub-F is single-brand, single-venue only. |
| Checkout | No new payment surface in Sub-E. Sub-F routes to existing ticket checkout and all-in pricing. |

## 3. Evidence Summary

### 3.1 Current Business-App Authoring

The existing physical venue flow is Ve1 claim-first:

- `mingla-business/app/venue/create.tsx` has phases `gate | category | wizard | success`.
- The gate searches one pool match via `usePoolMatchSearch`; it does not render all matches.
- `VenueCreatorWizard` is the 7-step venue wizard.
- Submit currently requires `googlePlaceId`, `lat`, `lng`, and `venueCategory`.
- Submit creates a brand and links `brands.place_pool_id`, but it does not create a shape-complete `place_pool` row for create-new venues.
- The wizard uses `uploadBrandCover` directly; Sub-E must route all hero media through ORCH-0989's shared `CoverPicker`.

### 3.2 Current Hub Experience Funnel Bug

The existing menu/activity parsers create pending suggestions, but the return loop collapses:

- `parse-restaurant-menu` and `parse-play-activities` use `HUB_EXPIRY_HOURS = 24`.
- `fetchPendingExperiencesForBrand` filters only `source = hub_experience` and `status = pending`; it does not filter expired rows.
- `agent-confirm-action` lazily marks expired rows only when Sarah taps accept, then returns 410 `EXPIRED`.
- Live probe found 26 `hub_experience` rows from 2 brands in one 56-minute session: 23 stale pending past expiry, 3 failed, 0 executed/expired/completed.
- The result is a visible card that looks actionable but fails after tap.

### 3.3 Current Category Gates Conflict With Universal Authoring

The code comments say no `brand.kind` gate, but two category gates still block universal authoring:

- `parse-restaurant-menu` rejects non-restaurant brands.
- `parse-play-activities` rejects non-play brands.
- `agentTools.create_experience` rejects brands whose `venue_category` is not `restaurant` or `play`.

META-ORCH-0972 says every brand can author events, trips, and experiences. Venue category can guide prompts and metadata, but it cannot be a permission wall.

### 3.4 Current `place_pool` Constraints

Baseline `place_pool.google_place_id` is `NOT NULL`, and `fetched_via` is checked against only `nearby_search`, `text_search`, and `detail_refresh`. Sub-E needs a business-authored path, so the migration must:

- Allow non-Google create-new rows.
- Add `business_authored` to `place_pool.fetched_via`.
- Preserve Google-ingested rows unchanged.
- Preserve `place_pool.claimed_by` as an `auth.users(id)` FK. Do not put `brands.id` into `claimed_by`.

The correct brand linkage is:

- `brands.place_pool_id` points to the canonical place.
- `place_pool.claimed_by` stores the auth user who claimed/authored the place when available.
- New `place_pool.business_author_brand_id` stores the authoring brand for business-created place rows only.

## 4. Non-Goals

Do not implement any of the following in Sub-E:

- Consumer deck `cardType: brand_curated_single_venue`. That is Sub-F.
- Multi-stop brand experiences.
- Cross-brand curation.
- New checkout or payment UX.
- Stripe/payment changes.
- New bouncer chain rules beyond coaching copy for existing B-codes.
- New mobile consumer surfaces.

## 5. Data Model Contract

Create the next monotonic migration after the live/local maximum. As of this investigation, local and sibling worktrees top out at:

`20260808000000_meta_orch_1009_sub_d_refresh_cron.sql`

Use:

`20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql`

Before writing the migration, rerun:

```bash
ls supabase/migrations | sort -V | tail -20
find /Users/sethogieva/Desktop/mingla-orchs -path '*/supabase/migrations/*.sql' -maxdepth 5 | sed 's#.*/supabase/migrations/##' | sort -V | tail -20
```

If a newer migration exists, pick the next higher timestamp.

### 5.1 `place_pool` Changes

Migration must add or alter:

- `google_place_id` must become nullable for business-created rows.
- `place_pool_google_place_id_key` or equivalent unique constraint must remain valid for Google rows. If the existing unique index cannot tolerate NULL correctly, replace with a partial unique index:
  - unique on `google_place_id` where `google_place_id IS NOT NULL`.
- `fetched_via` check must include `business_authored`.
- Add `business_author_brand_id uuid null references public.brands(id) on delete set null`.
- Add `business_authoring_status text not null default 'none' check in ('none','draft','processing','needs_fix','deck_eligible','failed')`.
- Add `business_hero_video_present boolean not null default false`.
- Add `photo_analysis jsonb null`.
- Add `business_authoring_inputs jsonb null`.
- Add comments for every new column.

Rules:

- For a create-new place, set `fetched_via = 'business_authored'`, `google_place_id = NULL`, `business_author_brand_id = brand.id`, `is_claimed = true`, and `claimed_by = auth.uid()`.
- For a claim-existing place, keep the existing Google row, set `brands.place_pool_id = place_pool.id`, set `is_claimed = true`, set `claimed_by = auth.uid()` if null or if the claim is accepted for this owner, and do not set `business_author_brand_id`.
- Do not fabricate `rating`, `review_count`, `reviews`, or Google-only fields for business-authored rows. `review_count` currently defaults to `0`; the writer must explicitly preserve "not Google-reviewed" in `raw_google_data` and must not present 0 as a real Google count in UI.
- `business_status` for create-new rows should be `OPERATIONAL`.
- `last_detail_refresh` for create-new rows should be `now()` to satisfy existing non-null/default expectations, with `raw_google_data.source = 'business_authored'`.

### 5.2 Brand Pipeline State

Add a compact state table for the Hub readiness card and retries:

`public.brand_place_pipeline_state`

Columns:

- `id uuid primary key default gen_random_uuid()`
- `brand_id uuid not null references public.brands(id) on delete cascade`
- `place_pool_id uuid null references public.place_pool(id) on delete set null`
- `status text not null default 'draft' check in ('draft','processing','needs_fix','deck_eligible','failed')`
- `tier1_completed_at timestamptz null`
- `tier2_completed_at timestamptz null`
- `stage_status jsonb not null default '{}'`
- `bouncer_reasons text[] not null default '{}'`
- `last_error_code text null`
- `last_error_message text null`
- `updated_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `coaching jsonb not null default '[]'` — **rework-5 addendum (additive, non-contract):** an extra convenience column that caches the plain-English Hub coaching cards derived from `bouncer_reasons`, so the client `get_authoring_context` / `fetchBrandPlacePipelineState` path renders the readiness card without re-deriving the B-code→copy map. It is NOT part of the contract surface (the contract columns are the set above); it is a denormalized cache the pipeline writes alongside `bouncer_reasons`. Recorded here so code (`brand_place_pipeline_state.coaching`) and contract agree per the rework-5 "no silent divergence" directive.

Indexes:

- unique `(brand_id)`
- index `(place_pool_id)` where not null
- index `(status, updated_at)`

RLS:

- authenticated brand owner can select own row.
- authenticated brand owner can insert/update own row only where `brands.account_id = auth.uid()`.
- service role bypasses via normal service role behavior.
- no anon access.

### 5.3 Pending Action Expiry Repair

Add a DB function:

`public.expire_agent_pending_actions(p_now timestamptz default now()) returns integer`

Contract:

- Updates `agent_pending_actions`
- `status = 'expired'`
- only where `status = 'pending'` and `expires_at < p_now`
- returns affected row count
- preserves the existing allowed status set.

Schedule with pg_cron every 15 minutes if pg_cron is already available in this project. If pg_cron is not available in local tests, migration must still define the function and skip schedule with a notice instead of failing.

Backfill:

- Run the function once in the migration to flip existing stale pending rows.
- Expected live effect from investigation: about 23 stale `hub_experience` rows become `expired`.

## 6. Edge Function Contract

### 6.1 New Edge Function

Create:

`supabase/functions/run-business-place-authoring-pipeline/index.ts`

This is the only new runtime writer allowed to set `place_pool.ai_signal_scores`.

Security:

- Require user JWT.
- Verify `auth.getUser`.
- Use a user-scoped client for ownership checks.
- Use service role only for writes that RLS intentionally does not expose to business users (`place_pool`, pipeline state, scoring internals).
- Never trust `brand_id` from body without verifying `brands.account_id = auth.uid()` and `deleted_at IS NULL`.
- Rate-limit per user and per brand for expensive Gemini stages.

Actions:

| Action | Purpose |
|---|---|
| `upsert_tier1_place` | Create or link canonical `place_pool` row after Tier 1. |
| `run_tier2_pipeline` | Run stages 1-8 after Tier 2 completion. |
| `regenerate_sales_bio` | Re-run Stage 4 only, preserving Sarah edits until confirmed. |
| `confirm_ai_outputs` | Persist Sarah-confirmed bio/facets/vibe outputs. |
| `refresh_deck_readiness` | Re-run Stage 8 and return coaching reasons. |
| `sync_hero_media` | Update `business_hero_video_present` after CoverPicker changes. |

Do not add `ai_signal_scores:` object literals to helper files unless the strict-grep gate is amended to allow that exact helper as an intentional writer. Preferred pattern: helpers return `signal_scores`, and only `run-business-place-authoring-pipeline/index.ts` maps to `ai_signal_scores`.

### 6.2 Existing Parse Functions

Modify:

- `supabase/functions/parse-restaurant-menu/index.ts`
- `supabase/functions/parse-play-activities/index.ts`

Required changes:

- Increase Hub proposal TTL from 24 hours to 7 days.
- Remove hard `venue_category === restaurant` / `venue_category === play` eligibility gates.
- Keep ownership checks.
- Treat `venue_category` as a prompt hint and metadata input only.
- Include `parser_source` in `tool_args`: `menu_snap` or `activities_snap`.
- Return `expires_at` in each pending action response so the client can show expiry state.
- Add tests proving non-restaurant and non-play brands can parse when owned by caller.

### 6.3 Agent Tool Executor

Modify:

`supabase/functions/_shared/agentTools.ts`

Required changes:

- Remove the `restaurant`/`play` permission gate from `create_experience`.
- Keep ownership validation.
- Validate that the brand has or can create a canonical venue link when Sub-F needs deck cards; for Sub-E, do not block the Hub suggestion accept solely on `venue_category`.
- Set `theme.experience_meta.ai_source` from `parser_source` when provided; otherwise derive from category as a fallback.
- Preserve existing live/public behavior for accepted generated experiences unless a separate product decision changes it.

## 7. Eight Gemini Stage Contract

All stages use Gemini 2.5 Flash. Use official structured output/function-calling APIs from Google AI docs:

- `https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash`
- `https://ai.google.dev/gemini-api/docs/structured-output`
- `https://ai.google.dev/api/generate-content#function_calling`

### Stage 1 - Menu OCR

Existing `parse-restaurant-menu` remains the source for menu photo/PDF extraction. Sub-E must make it universal and wire its output into the Tier 2 pipeline.

Output:

- menu items / packages / price cues
- cuisine and service hints
- source confidence
- no direct consumer deck write

### Stage 2 - Activity Extraction

Existing `parse-play-activities` remains the source for activity-list extraction. Sub-E must make it universal and wire its output into the Tier 2 pipeline.

Output:

- activities / packages / group-size cues
- vibe and time-of-day hints
- source confidence
- no direct consumer deck write

### Stage 3 - Photo Analysis

New Gemini vision stage.

Input:

- hero image/video thumbnail
- 3-5 gallery images when available
- Sarah-provided venue category and vibe quiz

Output goes to `place_pool.photo_analysis`:

```json
{
  "model": "gemini-2.5-flash",
  "evaluated_at": "ISO-8601",
  "aesthetic": {
    "lighting": "string",
    "ambience": "string",
    "composition_score_0_to_100": 0
  },
  "dedupe": {
    "near_duplicate_groups": []
  },
  "facet_hints": {
    "outdoor_seating": true,
    "live_music": false
  },
  "reasoning": "short plain-English summary"
}
```

Do not use the deprecated `photo_aesthetic_data` column for new output.

### Stage 4 - AI Sales Bio

Gemini generates the bio from Sarah's Tier 1/2 inputs, menu/activity parse, photo analysis, and vibe quiz.

Writes after Sarah confirms/edits:

- `place_pool.editorial_summary`
- `place_pool.generative_summary`
- brand description/tagline fields already used by public brand rendering

Contract:

- The first generated bio is an AI-authored sales bio.
- Sarah can edit before confirm.
- The confirmed copy is what lands in `place_pool`.
- Tests must prove the stage is generative, not only normalizing an existing free-text field.

### Stage 5 - Structured Facet Inference

Gemini infers Google-like structured facets from Tier 2 inputs and Stage 1-4 outputs.

Write to existing `place_pool` columns when confidence is high enough:

- `serves_brunch`
- `serves_lunch`
- `serves_dinner`
- `serves_breakfast`
- `serves_beer`
- `serves_wine`
- `serves_cocktails`
- `serves_coffee`
- `serves_dessert`
- `serves_vegetarian_food`
- `outdoor_seating`
- `live_music`
- `good_for_groups`
- `good_for_children`
- `good_for_watching_sports`
- `allows_dogs`
- `has_restroom`
- `reservable`
- `menu_for_children`
- `dine_in`
- `takeout`
- `delivery`
- `curbside_pickup`
- `accessibility_options`
- `parking_options`
- `payment_options`
- `price_level`
- `price_range_currency`
- `price_range_start_cents`
- `price_range_end_cents`

Null means unknown. Do not write false unless the evidence supports false.

### Stage 6 - Signal Pre-Evaluation

Gemini evaluates every active Q2 signal for the place and writes Sub-A's exact `place_pool.ai_signal_scores` shape.

Required shape for each signal id:

```json
{
  "score_0_to_100": 0,
  "inappropriate_for": false,
  "reasoning": "string",
  "evaluated_at": "ISO-8601",
  "prompt_version": "v4",
  "model": "gemini-2.5-flash"
}
```

Rules:

- Use active signal definitions and the same Q2 semantics consumed by Sub-B.
- `prompt_version` must be `v4` unless the signal definition explicitly expects a newer prompt version.
- `model` must be `gemini-2.5-flash`.
- Include all active consumer deck signals, not just restaurant/play.
- Do not fabricate Google reviews. Use Sarah inputs, menu/activity parse, photos, and bio.
- If Gemini marks `inappropriate_for=true`, Sub-B's existing veto path must still delete/exclude the `(place, signal)` score row.
- After writing `ai_signal_scores`, Sub-D's drift trigger and 15-minute cron should pick up stale pairs. If the new writer bypasses a trigger path, explicitly call the same rescore enqueue/RPC used by Sub-D.

Hero video boost:

- Stored Gemini `score_0_to_100` remains the raw AI evaluation.
- `signalScorer.computeScore` applies the boost as `effectiveAiScore = min(100, rawAiScore * 1.15)` only when `place.business_hero_video_present === true`.
- Contributions must include `_business_hero_video_boost: 1` and `_ai_score_pre_business_boost`.
- The final blended score remains clamped by existing Sub-B rules.

### Stage 7 - Google Cross-Validation

For claim-existing path:

- Compare Sarah inputs against the Google/place-pool row.
- Store a deterministic diff in `place_pool.raw_google_data.business_claim_diff`.
- Do not overwrite authoritative Google-only fields without a specific confirm path.
- Surface conflicts in Hub if they block deck readiness.

For create-new path:

- Record `raw_google_data.source = 'business_authored'`.
- Record `raw_google_data.business_authored_inputs_hash`.
- Do not call the row Google-verified.

### Stage 8 - Bouncer Servability

Reuse:

- `supabase/functions/_shared/bouncer.ts`
- `supabase/functions/_shared/bouncerChainRules.ts`

Writes:

- `place_pool.is_servable`
- `place_pool.bouncer_reason`
- `place_pool.bouncer_validated_at`
- `brand_place_pipeline_state.bouncer_reasons`
- `brand_place_pipeline_state.status`

Do not add database-driven chain-rule loaders. Chain rules are code constants.

## 8. Business App UI Contract

### 8.1 Unified Brand Creation

Modify:

- `mingla-business/src/components/brand/BrandCreationFlow.tsx`
- `mingla-business/app/venue/create.tsx`
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
- `mingla-business/src/store/draftVenueStore.ts`
- relevant venue step components and hooks

Required behavior:

- `BrandCreationFlow` remains universal post-META-ORCH-0972.
- Venue creation becomes a first-class branch, not a claim-only afterthought.
- The 7-step `VenueCreatorWizard` is the universal venue-authoring flow for claim and create-new.
- Claim/create choice happens before the wizard, but Sarah can always continue without selecting a Google match.
- The wizard stores enough Tier 1 and Tier 2 inputs to run the pipeline.

### 8.2 Tier 1 Fields

Tier 1 must support a 4-minute publish/create path:

- venue name
- venue category
- address
- lat/lng
- at least 1 hero image or video
- hours
- contact
- claim-existing or create-new choice

Tier 1 completion must create/link:

- `brands`
- `brand_hours`
- `place_pool`
- `brand_place_pipeline_state`

### 8.3 Tier 2 Fields

Tier 2 must support a 5-minute deck-eligible path:

- 3-5 photos or media assets
- menu/activity photo/PDF when relevant
- 6-question vibe quiz using chips for v1
- facet confirmation toggles
- price tier/range
- generated sales bio confirm/edit

Tier 2 completion must trigger `run_tier2_pipeline`.

### 8.4 CoverPicker

All hero media uploads must route through ORCH-0989's shared `CoverPicker` / `CoverPickerSheet`.

Rules:

- Do not use `uploadBrandCover` directly from `VenueCreatorWizard`.
- Brand hero image/video/gif must persist through the existing cover media fields.
- When the selected cover media type is `video`, call `sync_hero_media` so `place_pool.business_hero_video_present` becomes true for the linked place.
- Preserve the native-build/OTA caution from ORCH-0989. If the deployed native binary predates the relevant media module, gate release until Seth's fresh native build is available.

### 8.5 Hub Coaching Loop

Add a Hub readiness card:

"Why you're not in the deck yet"

It must read from `brand_place_pipeline_state`, `place_pool.is_servable`, and `place_pool.bouncer_reason`.

Plain-English mapping:

| Code | User-facing meaning | One-tap fix |
|---|---|---|
| B3 | We are missing a required venue detail like name, address, or map pin. | Open venue basics |
| B4 | This place type is not a strong Mingla destination yet. | Review category |
| B5 | We need a real website or trusted contact signal. | Add website/contact |
| B6 | We need hours before we can recommend it. | Add hours |
| B8 | We need at least one usable venue photo. | Add photos |
| B9 | This looks like a sub-location inside another business. | Request review |
| B10 | This looks like a fast-food/snack category we do not serve in the deck. | Request review |
| B11 | This looks like a fast-food/coffee chain. | Request review |
| B12 | This looks like a casual chain. | Request review |

If multiple reasons exist, show the highest-priority fix first and keep the rest visible in a compact list.

## 9. Google Match Contract

Current `usePoolMatchSearch` returns a single `match`. Replace or extend with an all-matches hook:

- `usePoolMatchSearchAll`
- backing service/RPC can paginate internally, but UI must render the complete active result set.
- no silent top-N cap.
- each result must show enough context to choose safely: name, address, city, category/type, distance/confidence when available, photo if available.
- provide "None of these" / "Create new" as a persistent action.

Claim path:

- selecting a match prefills the wizard.
- Tier 1 submit links `brands.place_pool_id` to the selected row.
- Stage 7 cross-validation runs after Tier 2.

Create-new path:

- no Google match required.
- Sarah enters address/map pin and continues.
- Tier 1 submit creates a business-authored `place_pool` row.

## 10. Invariants And Strict Gates

### 10.1 AI Signal Scores Writer Gate

Modify:

`.github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs`

Allowed writers become exactly:

- `supabase/functions/run-place-intelligence-trial/index.ts`
- `supabase/functions/run-business-place-authoring-pipeline/index.ts`

Update the header comment to state that Sub-E intentionally amends DEC-099/DEC-181 for the business-app authoring writer.

Add/verify a strict-grep test or CI run proving an unauthorized `ai_signal_scores:` write fails.

### 10.2 Backend Allowlist Gate

Modify:

`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

Add a `META_ORCH_1009_SUB_E_BACKEND_ALLOWLIST` containing only the new/modified backend paths needed by this spec. Add it to the combined allowlist spread.

### 10.3 Bouncer Chain Rules

No runtime DB loader. If chain logic changes, code constants plus tests only. This spec should not require chain-list edits.

## 11. Testing Contract

Every behavior fix or delivered feature needs a regression test that would fail before and pass after.

### 11.1 Migration Tests

Add SQL tests under `supabase/migrations/__tests__/`:

- `sub_e_business_place_schema.test.sql`
  - `google_place_id` nullable or partial uniqueness supports business rows.
  - `fetched_via` accepts `business_authored`.
  - `business_author_brand_id`, `business_authoring_status`, `business_hero_video_present`, `photo_analysis`, `business_authoring_inputs` exist.
  - `brand_place_pipeline_state` exists with RLS enabled.
  - `place_pool.claimed_by` still references `auth.users(id)`.
- `sub_e_pending_action_expiry.test.sql`
  - stale pending rows flip to `expired`.
  - non-stale pending rows remain pending.
  - executed/failed/cancelled rows are untouched.

### 11.2 Deno Edge Tests

Add tests for:

- `parse-restaurant-menu` accepts an owned non-restaurant brand.
- `parse-play-activities` accepts an owned non-play brand.
- proposal TTL is 7 days and `expires_at` is returned.
- `agentTools.create_experience` no longer rejects non-restaurant/non-play brands solely by category.
- `run-business-place-authoring-pipeline` create-new Tier 1 inserts shape-valid `place_pool` row without fabricated Google fields.
- Stage 4 generated-bio output is written only after confirm.
- Stage 5 leaves unsupported facets null.
- Stage 6 writes exactly the 6-key Q2 shape with `prompt_version = v4` and `model = gemini-2.5-flash`.
- Stage 8 maps bouncer verdict to pipeline state.
- unauthorized brand access returns 403.

### 11.3 Signal Scorer Tests

Extend `_shared/__tests__/scorer.test.ts`:

- raw AI score stays unchanged in `place_pool.ai_signal_scores`.
- when `business_hero_video_present` is true, effective AI score is `min(100, raw * 1.15)`.
- contribution fields include `_business_hero_video_boost` and `_ai_score_pre_business_boost`.
- no boost is applied without the place flag.
- `inappropriate_for=true` still vetoes before boost/blend.

### 11.4 Business App Tests

Add React Native/Jest tests:

- create-new path works when Google matches are empty.
- all returned matches render, not just one.
- selecting a match prefills wizard state.
- `VenueCreatorWizard` no longer requires `googlePlaceId` for create-new.
- all hero media routes through `CoverPickerSheet`; no direct `uploadBrandCover` call from the wizard.
- Tier 1 submit calls `upsert_tier1_place`.
- Tier 2 complete calls `run_tier2_pipeline`.
- Hub readiness card maps B3/B5/B6/B8 to the correct fix actions.
- expired proposal rows render regenerate/fix CTA instead of an accept button that 410s.

### 11.5 Manual Tester Gate

Tester must run a simulator/manual pass because the original investigation could not capture the full Maestro 410 flow before the previous Claude session ran out of credits.

Manual gate:

1. Create a business brand/venue through the new create-new path.
2. Complete Tier 1 and verify a `place_pool` row exists.
3. Complete Tier 2 and verify `ai_signal_scores` populates.
4. Upload a video hero via CoverPicker and verify the place flag plus scorer boost.
5. Force a stale Hub proposal and run the expiry function.
6. Reopen Hub and verify Sarah does not see a dead accept card.
7. Trigger a bouncer failure and verify the coaching loop shows a plain-English fix.

## 12. Deployment Contract

Seth-owned DB step:

```bash
supabase db push --include-all
```

Orchestrator-owned edge deploy:

```bash
supabase functions deploy run-business-place-authoring-pipeline
supabase functions deploy parse-restaurant-menu
supabase functions deploy parse-play-activities
supabase functions deploy agent-confirm-action
```

Only deploy `agent-confirm-action` if it changes. Deploy any changed shared dependencies with all affected functions.

Business app release:

- EAS update is gated on the ORCH-0989 native build caution if CoverPicker video dependencies are newer than the installed binary.
- If native build is stale, hold production OTA and provide tester build instructions instead.

## 13. Acceptance Criteria

Sub-E is complete when all of these are true:

- Sarah can create a venue without selecting a Google match.
- Sarah can select from all Google/place-pool matches when they exist.
- Tier 1 creates/links `brands`, `brand_hours`, `place_pool`, and pipeline state.
- Tier 2 runs stages 1-8 with Gemini 2.5 Flash.
- Stage 6 writes Q2-shaped `place_pool.ai_signal_scores`.
- Strict-grep allows only the trial writer and business authoring writer.
- Sub-D cron/drift path rescoring works for business-authored places.
- Bouncer coaching appears in Hub with one-tap fix paths.
- Expired Hub proposals no longer produce the dead 410 card loop.
- Hero video boosts effective AI score by x1.15, capped at 100, with tests.
- No checkout/cardType work is included.
- All tests in Section 11 pass or are explicitly converted into a tester manual gate with rationale.

## 14. Implementor Handoff

Implement Sub-E in this worktree after orchestrator approval:

`/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`

Expected implementation report:

`Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

The implementation report must include:

- files changed
- migration name
- edge functions deployed/needed
- tests run with exact commands
- any skipped test with reason
- confirmation that no Sub-F consumer deck card work was included
- DB push instructions for Seth if migration exists
