# Cycle 10 — Guests: pending approvals, manual add, manual check-in, attendee detail

**Phase:** Phase 4 — Event Management
**Estimated effort:** ~28 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## What shipped

- J-G1 guest list view (pending / accepted / cancelled sections) + J-G2 guest detail (`app/event/[id]/guests/`)
- AddCompGuestSheet (manual comp ticket — no payment; persisted Zustand `guestStore`)
- 6 chip categories on guest rows mirroring formatTicketBadges from Cycle 5 (extended in Cycle 12)
- I-25 (comp guests in `useGuestStore.entries` only — NEVER as phantom OrderRecord rows) + I-26 (guest list filter rules)
- DEC-082 (Icon set additive expansion for guest icons) + DEC-083 (Avatar primitive carve-out promoted post 4-uses)
- Implementation report: `IMPLEMENTATION_BIZ_CYCLE_10_GUEST_LIST_REPORT.md`

## Closing notes

The guestStore separate-from-orderStore pattern + I-25/I-26 anchored the architectural separation between "money" (orders) + "people" (guests) that Cycle 12's I-29/I-30 (door sales NEVER as phantom orders) extended. The ID-prefix convention `cg_<base36>` for comp guests (vs `dt_<...>` for door sales tickets later) avoided parseTicketId collision per Cycle 12 HIDDEN-2.

---

(Original `Status: ⬜ PLACEHOLDER` flipped to `✅ DONE` 2026-05-04 during epic-status backfill audit.)

## Scope

For each event, a Guests tab/screen: pending approvals queue (approve/reject), manual guest add (comp tickets), manual check-in (door staff without scanner), attendee detail (name, email, phone, ticket type, scan history).

## Journeys (to refine)

- J-G1 — Pending approvals queue (approve/reject batch + individual)
- J-G2 — Manual add (comp ticket without payment)
- J-G3 — Manual check-in (search by name/email/order)
- J-G4 — Attendee detail (history + actions)
- J-G5 — Export guest list

## References

- BUSINESS_PRD §5 (guest management), §6.1 (manual lookup overlap with scanners)

## Notes

Manual check-in overlaps with scanner mode (Cycle 11) — share the search-by-name component if possible.
