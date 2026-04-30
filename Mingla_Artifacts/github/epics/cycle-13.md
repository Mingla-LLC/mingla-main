# Cycle 13 — End-of-night reconciliation report

**Phase:** Phase 4 — Event Management
**Estimated effort:** ~24 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `mingla-business/`

## Scope

After an event ends, organisers need a single screen showing: total tickets sold (online vs door), total revenue (split by payment method), refund total, scanner activity (scans / dupes / no-shows), settlement status. Designed for finance + ops audit at end-of-night.

## Journeys (to refine)

- J-R1 — Reconciliation summary (auto-rendered post-event-end)
- J-R2 — Discrepancy flag (e.g. tickets sold ≠ scans + no-shows)
- J-R3 — Export report (PDF / CSV)

## References

- BUSINESS_PRD §6.2, §7 (reconciliation expectations)
- North Star metric (GMV) feeds from this report

## Notes

Reconciliation is critical for trust. Discrepancy alerts should be loud (e.g. "12 tickets sold, only 9 scanned, 1 no-show, 2 unaccounted").
