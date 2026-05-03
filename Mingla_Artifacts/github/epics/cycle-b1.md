# Cycle B1 — Backend: schema + RLS for accounts, brands, events, tickets, orders, guests, scanners, audit-log

**Phase:** Phase 6 — Backend MVP
**Estimated effort:** ~60 hrs
**Status:** ⬜ PLACEHOLDER (backend cycle — gated by Cycle 17 sign-off per DEC-071)
**Codebase:** `supabase/`

## Scope

The first backend cycle. Light up the database for every UI surface built in cycles 0a–17. Every table in BUSINESS_PROJECT_PLAN §B.1–§B.7 gets a migration with RLS enabled deny-by-default. Audit log (append-only) starts capturing rows from day one.

## Journeys (to refine)

- J-B1.1 — Accounts + identity tables + delete-cascade edge fn
- J-B1.2 — Brands + team members + invitations + RLS
- J-B1.3 — Events + event_dates + recurrence storage + RLS
- J-B1.4 — Ticket types + tickets + waitlist entries + RLS
- J-B1.5 — Orders + order_line_items + RLS (buyer-self read, brand-team read/write)
- J-B1.6 — Scanners + event_scanners + scan_events (append-only) + RLS
- J-B1.7 — Audit log (append-only, write from edge fns only) + RLS

## References

- BUSINESS_PROJECT_PLAN §B.1–§B.7
- Strategic Plan R5, R8 (RLS coverage 100%, migration backwards-compat)
- Memory: cross-domain check on every DB change

## Notes

This is the LARGEST backend cycle by far. Cross-domain check is critical — every migration must be reviewed against consumer app (`app-mobile/`) AND admin (`mingla-admin/`) AND business app reads. Idempotency keys on every Stripe-touching destructive action.
