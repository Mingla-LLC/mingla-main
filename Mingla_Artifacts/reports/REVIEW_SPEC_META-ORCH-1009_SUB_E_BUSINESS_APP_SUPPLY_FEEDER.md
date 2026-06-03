# REVIEW: META-ORCH-1009 Sub-E Business-App Supply-Side Onboarding Feeder SPEC

Status: APPROVED WITH MANDATORY DESIGN GATE  
Reviewer: orchestrator+codex  
Date: 2026-05-30  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`  
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Verdict

The forensics SPEC is approved as the implementation architecture for META-ORCH-1009 Sub-E, but implementation is blocked until UI/UX direction is completed because the scope changes business onboarding, venue authoring, Google-match selection, AI bio confirmation, media upload, and Hub coaching.

Next lifecycle gate:

`SPEC REVIEW APPROVED -> UI/UX DESIGN DIRECTION -> IMPLEMENTOR DISPATCH`

## Reviewed Inputs

- `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/research/RESEARCH_BUSINESS_APP_TO_PIPELINE_FEEDER.md`
- `Mingla_Artifacts/research/RESEARCH_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md`
- `COMMS_LEDGER.md` entries COMMS-0002, COMMS-0003, COMMS-0004, COMMS-0011, COMMS-0012, COMMS-0013, COMMS-0015, COMMS-0016
- Active worktree registry row for META-ORCH-1009 Sub-E

## What The SPEC Gets Right

1. It corrects the highest-risk schema mistake before implementation: `place_pool.claimed_by` remains an `auth.users(id)` FK, and business-brand linkage is added separately via `business_author_brand_id` plus `brands.place_pool_id`.
2. It keeps Sarah's create-new path frictionless while preserving a clean claim-existing path and cross-validation.
3. It folds the 26-attempt/0-completion Hub parse funnel bug into Sub-E instead of leaving Sarah with suggested cards that expire and fail at accept time.
4. It keeps Sub-E out of Sub-F scope: no `brand_curated_single_venue`, no checkout, no multi-stop cards, no cross-brand curation.
5. It protects Sub-A/Sub-B/Sub-D invariants by requiring the new business writer to be explicitly added to the `ai_signal_scores` writer gate and by preserving Sub-D's rescore path.
6. It cites official Gemini docs inline for the new external AI contract, satisfying COMMS-0003 for the SPEC layer.
7. It carries the backend allowlist, migration monotonicity, RLS, bouncer-code-constant, CoverPicker, and manual tester gates that this feature needs.

## Required Design Gate Before Implementation

Sub-E is not just backend plumbing. It changes first-run business activation and the way a venue owner understands why they are not in the consumer deck yet.

Before implementation, route to `ui-ux-mingla` for a design-direction artifact covering:

- First-session Tier 1/Tier 2 flow structure.
- Claim-existing vs create-new Google match decision UI.
- "Show all matches" list behavior and empty/no-match state.
- AI-generated sales bio confirm/edit interaction.
- Vibe quiz chip model.
- Facet confirmation toggles.
- CoverPicker hero image/video placement.
- Hub readiness/coaching card and per-reason fix paths.
- Pending/expired generated-experience suggestion states.
- Loading, retry, partial-success, and failure states for the 8-stage Gemini pipeline.

Expected output:

`Mingla_Artifacts/reports/DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

The design artifact must be treated as part of the implementor contract.

## Implementation Guards To Preserve

- No product code work may start until the UI/UX artifact returns and orchestrator reviews it.
- Implementor must rerun migration monotonicity checks immediately before writing the migration.
- If a migration is produced, the implementation report must include:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase migration list --linked
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]" && /Users/sethogieva/bin/supabase db push --linked
```

If the migration is intentionally out-of-order versus remote, the command must use `--include-all` and state the reason.

- Before any DB push request, orchestrator must verify there are no remote-only migration versions and must run/read the remote data probes for any migration guard/backfill predicate.
- Edge functions must deploy only after PR merge to `main` or after an explicit operator-approved deploy exception; COMMS-0015 forbids treating a worktree deploy as durable.
- Sub-F checkout constraint from COMMS-0016 remains out of Sub-E, but must be carried into Sub-F when Sub-F specs.

## Approval

Approved to advance to UI/UX design direction.

Not approved to advance directly to implementation.
