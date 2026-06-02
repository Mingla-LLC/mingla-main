# REVIEW: META-ORCH-1009 Sub-E Business-App Supply-Side Onboarding Feeder DESIGN

Status: APPROVED FOR IMPLEMENTATION DISPATCH  
Reviewer: orchestrator+codex  
Date: 2026-05-30  
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`  
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Verdict

Approved.

The UI/UX artifact is implementation-ready after one orchestrator correction made during review: the Hub bouncer-coaching table now matches the SPEC's B-code meanings and one-tap fixes. Sub-E may advance to implementor dispatch.

Next lifecycle gate:

`SPEC APPROVED -> DESIGN APPROVED -> IMPLEMENTOR DISPATCH`

## Reviewed Inputs

- `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/reports/REVIEW_SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/reports/DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/research/RESEARCH_BUSINESS_APP_TO_PIPELINE_FEEDER.md`
- `COMMS_LEDGER.md` entries COMMS-0002, COMMS-0003, COMMS-0004, COMMS-0011, COMMS-0012, COMMS-0013, COMMS-0015, COMMS-0016

## What The Design Gets Right

1. It keeps Sarah's first screen usable and operational, not a landing page.
2. It makes create-new a first-class path instead of a lesser "skip" path.
3. It requires all active Google/place-pool matches to be visible and selectable.
4. It moves the old freeform story step into the required Stage 4 AI-generated sales-bio confirm/edit loop.
5. It routes hero media through ORCH-0989 `CoverPickerSheet` and forbids UI copy that promises rank.
6. It gives the 8-stage Gemini pipeline human-readable progress, retry, partial-success, and failed states.
7. It fixes the 26-attempt/0-completion Hub proposal trap at the UX layer by making expired proposals visibly expired before accept.
8. It treats the Hub `Why you're not in the deck yet` card as mandatory readiness coaching, not a nice-to-have status widget.
9. It includes mobile responsiveness, accessibility, long-text, and visual QA criteria that tester can verify.

## Review Correction Applied

Finding D-REVIEW-1: the first design draft mapped B4/B5/B6/B8 to generic UX meanings that did not match the SPEC's bouncer-code table.

Correction applied directly to the design artifact:

- B3 -> missing required venue detail -> `Open venue basics`
- B4 -> place type not strong Mingla destination -> `Review category`
- B5 -> missing trusted website/contact signal -> `Add website/contact`
- B6 -> missing hours -> `Add hours`
- B8 -> missing usable venue photo/video -> `Add photos`
- B9/B10/B11/B12 -> review-only chain/sub-location/category cases -> `Request review`

This is now resolved in `DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`.

## Implementation Guards

The implementor must treat both the SPEC and DESIGN as active contracts. If they conflict, the SPEC controls backend/source-of-truth semantics and the DESIGN controls Sarah-facing labels/layout/states, unless the implementor finds a proven impossibility and documents it before expanding scope.

Mandatory guards:

- No Sub-F consumer deck card type or checkout work.
- No multi-stop experience UX.
- No parallel experience checkout edge function.
- No alternate AI provider.
- No direct hero upload path from `VenueCreatorWizard`; use `CoverPickerSheet`.
- No rank-promise copy for hero-video boost.
- No fabricated Google ratings/reviews/counts for business-authored rows.
- No new database-driven bouncer-rule loader.
- No DB deploy request without migration drift check and read-only guard/backfill probes.
- No edge deploy as durable release from an unmerged worktree.

## Dispatch Decision

Approved to dispatch implementation.

Expected next artifact:

`Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

Expected downstream route:

`implementor -> orchestrator implementation review -> migration/deploy gates -> tester`
