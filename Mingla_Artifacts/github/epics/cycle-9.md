# Cycle 9 — Event management: detail dashboard, orders, refunds, cancel-event

**Phase:** Phase 4 — Event Management
**Estimated effort:** ~56 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## What shipped

- Cycle 9a — Events tab pipeline view + Event Detail dashboard + Manage menu (Live/Upcoming/Past sections come alive)
- Cycle 9b-1 — Lifecycle actions (End sales / Cancel event / Delete draft + Toast app-wide redesign + UX polish)
- Cycle 9b-2 (renamed → ORCH-0704 v2) — Full edit-after-publish + buyer protection + 4-channel notification stack + reason audit (DEC-087 — operator overrode v1's 6 conservative defaults; whenMode unlocked; refund-first as unified pattern)
- Cycle 9c v3 — Orders ledger + RefundSheet (full + partial) + persisted Zustand orderStore + recordRefund mutation + activity feed integration
- 5 IMPL reports across versions: `_9a` + `_9b1` + `_9b2` + `_9c` (v1 + v2 + v3)
- DEC-087 ratified (full edit-after-publish architecture)
- I-19 (immutable order financials) + I-20 (orderStore SOLE order authority) + edit-log invariants established

## Closing notes

ORCH-0704 v2 was the largest single architectural decision in the BIZ pipeline — buyer protection via 4-channel notification stack + refund-first reject pattern + 8 reject reasons + permanent edit audit log. The orderStore selector pattern (Cycle 9c v2) became the canonical Zustand discipline reused by Cycle 10 + 11 + 12 + 13a brandTeamStore.

---

(Original `Status: ⬜ PLACEHOLDER` flipped to `✅ DONE` 2026-05-04 during epic-status backfill audit.)

## Scope

For each published event, a detail dashboard showing: ticket counts (sold / capacity / waitlist), revenue (gross / fees / net), order list (search/filter/refund/export), share + cancel actions. Orders inspector with full line-item drill-down. Refund flow (full/partial). Cancel-event flow with audience notification.

## Journeys (to refine)

- J-M1 — Event detail dashboard (Live/Upcoming/Past sections come alive)
- J-M2 — Orders list + filters + search
- J-M3 — Order detail + refund (full/partial)
- J-M4 — Cancel event (audience notification + refund-all option)
- J-M5 — Export orders (CSV) — UI affordance, real export wires B5

## References

- BUSINESS_PRD §5
- Cycle 3 events.tsx left Live / Upcoming / Past sections as Cycle 9 territory (TRANSITIONAL marker)

## Notes

This unblocks "what happens after publish?" — the missing piece organisers will probe first after Cycle 5. Decomposition should prioritize the dashboard-first user-story.
