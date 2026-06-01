# REVIEW: META-ORCH-1009 Sub-E Business App Supply Feeder Implementation

Status: REWORK REQUIRED
Date: 2026-05-30
Reviewer: orchestrator+codex
Input reviewed:
- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/reports/DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/reports/REVIEW_DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- Current worktree diff on branch `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Verdict

Do not send this to tester yet.

The implementation contains useful backend and wizard groundwork, especially the business-authored `place_pool` schema, the first pipeline edge function, claim-search loosenings, proposal expiry work, hero-video score boost, and the `ai_signal_scores` sole-owner allowlist update. It is still below the accepted Sub-E contract because several operator-locked and design-reviewed launch gates are not implemented or not proven.

## Accepted Progress

| Area | Evidence | Review result |
| --- | --- | --- |
| Business-authored place schema | New nullable-Google-place migration fields, authoring metadata, `brand_place_pipeline_state`, RLS coverage. | Useful partial foundation. |
| Business writer for `ai_signal_scores` | `i-ai-signal-scores-column-sole-owner` strict grep passed with the new edge function allowlisted. | Accepted for this invariant only. |
| Create-new wizard path | `VenueCreatorWizard` no longer blocks solely on missing `googlePlaceId`; claim search cap was raised and wizard can continue without a match. | Partial; all-match contract is not met yet. |
| Background pipeline | New `run-business-place-authoring-pipeline` function with Tier 1 place upsert, Tier 2 Gemini call, bouncer payload, and hero sync action. | Useful partial foundation; stage contract incomplete. |
| Hub proposal expiry repair | 7-day TTL, `expires_at`, expired rows excluded from Hub, expired cards cannot be accepted. | Accepted pending SQL/local stack proof. |
| Consumer ranker video boost | Hero video multiplier capped at score 100 and covered by existing Deno scorer tests. | Accepted pending end-to-end hero media persistence. |

## Blocking Findings

### P0-1: ORCH-0989 CoverPicker hard guard is still missed

Sub-E requires all uploads to route through the unified CoverPicker/CoverPickerSheet path. The implementation report acknowledges this is not complete, and the code confirms it:

- `mingla-business/src/components/venue/VenueStep3Photos.tsx` still imports `expo-image-picker` and calls `ImagePicker.launchImageLibraryAsync`.
- `mingla-business/src/components/venue/VenueCreatorWizard.tsx` only warns that local cover media still needs saving later.
- There is no proven first-session path that persists Sarah's hero video through the existing ORCH-0989 cover pipeline before the venue is deck-eligible.

This blocks the operator-locked hero-video boost and the universal media-source contract. The fix needs a real architecture: early brand/place draft creation, a draft target accepted by CoverPickerSheet, or another extension that still uses the existing cover services rather than a direct picker path.

### P0-2: Tier 2 UI and Stage 4 confirmation are not implemented

The accepted design requires a first-session Tier 2 path with vibe chips, facet confirmation, price/range capture, and a generated sales bio that Sarah confirms or edits before it becomes public pipeline truth. Current implementation writes the Gemini summary during `run_tier2_pipeline` without the required confirm/edit loop.

This violates the operator-locked decision that Stage 4 AI generates the sales bio for operator confirmation, not silently normalizing or publishing it.

### P0-3: Bouncer coaching loop is data-only, not user-visible

The edge function can produce deck-readiness/coaching payloads, but the business Hub does not render the required "Why you're not in the deck yet" readiness card with one-tap fix paths. The approved design review explicitly corrected the mapping so B3/B5/B6/B8 route to actionable business fixes. That card is mandatory, not a nice-to-have.

### P0-4: ORCH-0863 backend allowlist was not updated

This branch touches `supabase/functions` and `supabase/migrations`, but `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` does not include a Sub-E backend allowlist. COMMS-0002 and the orchestrator close protocol require this whenever backend paths are intentionally touched outside existing allowlists.

Add a `META_ORCH_1009_SUB_E_BACKEND_ALLOWLIST` and spread it into `allowedBackendPaths`, then run the ORCH-0863 strict-grep gate.

### P0-5: "Show all Google matches" is still capped

The implementation raises claim-search result limits, but the product contract says Sarah sees all active Google matches, not a higher top-N. A silent `limit 50` is still a top-N implementation unless the code proves that the active result set is complete for the query.

Fix with pagination/fetch-to-exhaustion, an explicitly complete RPC/search contract, or a documented hard proof that the backend query cannot omit active matches.

### P0-6: The 8 Gemini stages are collapsed and not durably stage-addressable

The spec asks for eight stages with operator-visible and testable state transitions. The implementation reports that full stage decomposition is not complete and current code handles multiple stages as one structured Gemini call. That may be a reasonable internal optimization only if the accepted spec is amended; otherwise it must be implemented as stage-addressable durable state.

Do not treat this as ready without either:
- stage-specific durable state/results/errors/retry semantics, or
- a forensics/spec amendment that explicitly accepts the collapsed execution model and preserves every user-facing and ranker contract.

### P0-7: Test gates are below the risk of the change

Accepted passing gates:
- `deno check supabase/functions/run-business-place-authoring-pipeline/index.ts supabase/functions/claim-search-pool/index.ts supabase/functions/parse-restaurant-menu/index.ts supabase/functions/parse-play-activities/index.ts`
- `deno test --allow-all supabase/functions/_shared/__tests__/signalScorer.blend.test.ts`
- `node .github/scripts/strict-grep/i-ai-signal-scores-column-sole-owner.mjs`
- Targeted Jest for claim search and wizard create-new path

Missing or insufficient gates:
- SQL tests were added but not run against a local or linked Supabase stack.
- No Deno tests prove universal parser eligibility, 7-day TTL expiry, non-restaurant/play agentTools behavior, Tier 1 create-new upsert, generated-bio confirmation semantics, facet null semantics, Stage 6 Q2 shape, Stage 8 bouncer reason mapping, or unauthorized brand access.
- No RN/Jest coverage for CoverPickerSheet integration, Tier 2 task rail, generated-bio confirm/edit, Hub coaching card, all-match pagination, or video sync.
- `npm run typecheck -- --noEmit` failed on unrelated existing repo errors. This is not a Sub-E blocker by itself, but the report must preserve the failure details and avoid claiming a broad typecheck pass.

## Additional Risks To Resolve

| Risk | Why it matters | Required disposition |
| --- | --- | --- |
| Sub-D rescore enqueue after business-authored scores | Sarah's place must be rankable from minute one and must not sit stale outside the rescore pipeline. | Prove the existing trigger covers business-authored `ai_signal_scores`, or explicitly enqueue the same refresh path used by Sub-D. |
| Existing Story step remains in venue wizard | The design moved old story-writing into Tier 2 because AI generates the sales bio. | Remove/repurpose legacy story flow or explain why it is no longer the public sales bio source. |
| Worktree is not Supabase-linked | Migration verification and safe deployment are not yet proven. | Re-run `supabase migration list --linked`; if still blocked, document exact anchor/merge/operator DB-push handoff. |
| Report status is "implemented, partially verified" | That can be misread as tester-ready. | Update the report after rework with explicit "ready for orchestrator re-review" or "blocked". |

## Rework Exit Criteria

Before tester receives Sub-E:

1. Hero media in the venue-authoring path uses the ORCH-0989 CoverPicker/CoverPickerSheet pipeline or a reviewed extension of that pipeline.
2. Tier 2 first-session UI exists and covers vibe, facets, price/range, and generated-bio confirm/edit.
3. Final public bio/facets are not written before Sarah confirms them.
4. Business Hub renders the bouncer coaching loop with plain-English reasons and one-tap fix paths.
5. Claim search proves all active matches, not a silent capped top-N.
6. Backend touches are allowlisted under ORCH-0863 and the strict-grep gate passes.
7. The Gemini stage contract is either implemented as durable stage state or explicitly amended by forensics/spec.
8. SQL, Deno, and targeted RN/Jest gates cover the contracts above, or every impossible gate is converted into a tester manual gate with a precise reason.

## Routing

Send this back to `$implementor` for rework. Do not dispatch `$tester` until the rework report addresses every P0 above and reruns the relevant gates.
