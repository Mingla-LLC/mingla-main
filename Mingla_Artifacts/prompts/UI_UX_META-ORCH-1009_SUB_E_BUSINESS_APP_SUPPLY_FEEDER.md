# UI/UX HANDOFF: META-ORCH-1009 Sub-E Business-App Supply-Side Onboarding Feeder

Use skill: `$ui-ux-mingla`

Working tree: `/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`  
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`

## Goal

Produce Mingla-native UI/UX direction for META-ORCH-1009 Sub-E before implementation starts. This is Sarah's first-session business onboarding path: she creates or claims a venue, completes Tier 1 plus Tier 2, sees AI help generate the venue profile, and gets a plain-English Hub coaching loop when the venue is not deck-ready yet.

## Inputs

Read these first:

- `COMMS_LEDGER.md`
- `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/reports/REVIEW_SPEC_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`
- `Mingla_Artifacts/research/RESEARCH_BUSINESS_APP_TO_PIPELINE_FEEDER.md`
- `Mingla_Artifacts/research/RESEARCH_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md`
- Current business UI files for pattern reference:
  - `mingla-business/app/venue/create.tsx`
  - `mingla-business/src/components/venue/VenueCreatorWizard.tsx`
  - `mingla-business/src/components/brand/BrandCreationFlow.tsx`
  - `mingla-business/app/(tabs)/hub/experiences.tsx`
  - `mingla-business/src/components/experience/ExperienceReviewCards.tsx`
  - `mingla-business/src/components/ui/CoverPickerSheet.tsx`

## Hard Constraints

- Do not implement product code.
- Do not edit runtime app files.
- Do not reopen the product decisions already locked in the SPEC.
- Keep the business app quiet, efficient, premium, and operational; avoid marketing-page composition.
- The first screen must be usable onboarding, not a landing page.
- Use existing Mingla business design patterns and tokens.
- All hero media uploads route through shared CoverPicker/CoverPickerSheet.
- Create-new must remain frictionless.
- All Google/place-pool matches must be visible for the active query.
- Stage 4 AI generates the sales bio, then Sarah confirms/edits.
- Hub coaching loop is mandatory and must translate B-code failures to plain-English fixes.
- v1 remains single-brand/single-venue; no Sub-F deck card or checkout design here.

## Required Output

Write:

`Mingla_Artifacts/reports/DESIGN_META-ORCH-1009_SUB_E_BUSINESS_APP_SUPPLY_FEEDER.md`

Include:

1. Screen-flow map for Tier 1 and Tier 2.
2. Component-level guidance for claim-existing/create-new match selection.
3. Interaction states for all-match loading, no matches, manual create, and selected match.
4. AI sales bio confirm/edit UX.
5. Vibe quiz chip model and facet confirmation controls.
6. CoverPicker placement and hero video boost communication, without overpromising rank.
7. Hub "Why you're not in the deck yet" card hierarchy, copy tone, and one-tap fix paths.
8. Expired generated-experience proposal UX so Sarah never taps into a dead 410.
9. Loading/retry/partial-success states for the 8-stage Gemini background pipeline.
10. Accessibility, mobile responsiveness, and visual QA criteria.
11. Implementation acceptance criteria the implementor and tester must honor.

## Downstream Routing

Return to `orchestrator-mingla` for design review. After design approval, orchestrator will dispatch `implementor-mingla` with both the SPEC and the design artifact as binding inputs.
