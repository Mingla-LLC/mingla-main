# Cycle 3 — Event creator wizard (the wedge cycle)

**Phase:** Phase 2 — Core Wedge
**Estimated effort:** ~48 hrs (actual ~3,700 LOC + ~600 reworks)
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## Scope

The 7-step event creator wizard: Basics / When / Where / Cover / Tickets / Settings / Preview. Drafts persisted in Zustand v2 schema. Publish gate handles 3 paths (success, Stripe-missing, validation-errors). Resume-draft flow from Events tab.

## What shipped

- Journeys J-E1 (build), J-E2 (publish-success), J-E3 (publish-Stripe-missing), J-E4 (resume-draft), J-E12 (publish-validation-errors)
- 7 step bodies (CreatorStep1Basics → CreatorStep7Preview)
- EventCreatorWizard root with chrome + Stepper + sticky dock
- DraftEvent schema v1 + v2 (with `hideAddressUntilTicket`, `isUnlimited`)
- PublishErrorsSheet (Fix-jump back to step)
- DEC-084 (Sheet numeric snap) + DEC-085 (Modal native portal) ratified
- Invariants I-11, I-12, I-13 promoted to global registry

## References

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-3-EVENT-CREATOR.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_3_EVENT_CREATOR.md`
- BUSINESS_PRD §3.1

## Closing notes

This is THE wedge cycle. Everything from Cycle 4 on builds on this 7-step shape. Design heuristics that emerged here (sleek dock, glass action card, dynamic Sheet snap) are the templates for all forward sheets.
