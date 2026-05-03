# Cycle 4 — Recurring + multi-date + per-date overrides

**Phase:** Phase 2 — Core Wedge
**Estimated effort:** ~40 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## Scope

Step 2 of the wizard expands from single-mode to a 3-mode segmented control: Single | Recurring | Multi-date. Recurring uses 5 presets (daily / weekly / every 2 weeks / monthly-by-day / monthly-by-weekday) with count-or-until termination. Multi-date supports 2–24 dates with per-date title/description/location overrides editable from BOTH Step 2 row pencil AND Preview accordion.

## What shipped

- Journeys J-E5 (recurring picker), J-E6 (multi-date list builder), J-E7 (per-date override editor), J-E8 (publish flow handling N dates)
- DraftEvent schema v3 (additive: `whenMode`, `recurrenceRule`, `multiDates`)
- New helpers: `recurrenceRule.ts` (preset → label, expand to dates, RFC 5545 emitter), `eventDateDisplay.ts` (3-formatter consolidation = Constitution #2 lift)
- New invariant **I-14** (date-display single source) established
- MultiDateOverrideSheet with chip-based inheritance UX + glass-docked time picker
- Day-of-week mismatch is a blocking validation error (no auto-snap, per founder steering)
- Memory rule established: keyboard never blocks an input field

## References

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-4-RECURRING-MULTIDATE.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_4_RECURRING_MULTIDATE.md`
- Closing commit: `7d3d61ba`
- BUSINESS_PRD §3.1 (recurring + multi-date)

## Closing notes

The chip-based inheritance pattern + glass-docked picker (anchored at Sheet-body bottom, NOT inside ScrollView) are reusable patterns. Apply both to AddDateSheet polish whenever Cycle 5+ touches that surface.
