# Cycle 9 — Event management: detail dashboard, orders, refunds, cancel-event

**Phase:** Phase 4 — Event Management
**Estimated effort:** ~56 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `mingla-business/`

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
