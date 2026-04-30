# Cycle 2 — Brands inventory: list, profile, edit, team, finance

**Phase:** Phase 2 — Core Wedge
**Estimated effort:** ~72 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## Scope

A brand is more than a name. Cycle 2 builds out the full brand surface: brand list, brand profile (founder view), brand edit, team management UI, Stripe-onboard shell, payments shell, finance reports tile.

## What shipped

- Journeys J-A1 through J-A12: brand list, brand profile (founder view), brand edit, brand team UI, country picker, payments shell, finance reports
- Stripe Connect onboarding shell (UI only — backend lands B2)
- BrandEventStub for finance report tile counts
- Currency utility lift (Constitution #10) — `formatGbp`, `formatGbpRound`, `formatCount` consolidated
- DEC-079 (kit closure ratified) + DEC-084 (Sheet numeric snap carve-out)
- Invariant I-11 (format-agnostic ID resolver) established

## References

- BUSINESS_PRD §2.1, §2.2, §2.3
- Decision log: DEC-079, DEC-084
- Implementation reports: `IMPLEMENTATION_BIZ_CYCLE_2_*`

## Closing notes

This cycle shaped most of the kit primitives + invariants the rest of the build depends on. If you're adding new visual surfaces, study Cycle 2 brand profile for the canonical glass treatment.
