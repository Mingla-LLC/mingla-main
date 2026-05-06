# Cycle 12 — Door payments: cash, card-reader, NFC tap, manual entry, receipt

**Phase:** Phase 4 — Event Management
**Estimated effort:** ~48 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/`

## What shipped

- J-D1..J-D6 + J-G1/J-G2 extension + chip ecosystem: door-sales tile gated on per-event toggle · multi-line cart at the door · refund flow with OBS-1 lock (money-only — buyer stays CHECKED IN) · J-D5 reconciliation summary (cash + card + nfc + manual + refunded + NET, by-scanner expandable, Export CSV)
- DoorSaleNewSheet (4 payment methods — cash + manual enabled; card-reader + NFC TRANSITIONAL stubs until B-cycle Stripe Terminal SDK)
- DoorRefundSheet with OBS-1 hard lock (refund touches MONEY ONLY — never useScanStore; buyer stays CHECKED IN)
- 6 chip categories on `formatTicketBadges` (Door only / Online only / Sale window scheduled / Min N per buyer / Max N per buyer / Transfers disabled) — propagating across wizard Step 5 + EditPublishedScreen + previews + public page
- Per-tier `availableAt` 3-state picker (online / door / both) via AvailableAtSheet sub-sheet pattern
- Cycle 11 InviteScannerSheet `canAcceptPayments` toggle FLIP per Decision #4
- Activity feed `event_door_refund` stream — refunds surface as warm-orange Recent Activity rows
- 4 commits: Phase 1 (`668bf968`) + Phase 2 (`3420a3d0`) + EditPublished rework (`977d0ad1`) + bundle 3-fix rework (`8d457528`)
- 2 NEW invariants ratified: I-29 (door sales NEVER as phantom OrderRecord rows) + I-30 (door-tier vs online-tier separation via `TicketStub.availableAt` — 4-surface filter chain enforcement)
- Implementation reports: `_PHASE_1_REPORT.md` + `_DOOR_SALES_REPORT.md` + `_REWORK_EDITPUBLISHED_REPORT.md` + `_REWORK_BUNDLE_3FIX_REPORT.md`

## Closing notes

The OBS-1 hard lock (refund affects MONEY ONLY, NOT check-in) was the right semantic call: buyer was physically there, that's a separate event from "did they keep the money." The `dt_<ts36>_<rand4>` ID prefix avoids parseTicketId collision per HIDDEN-2. Note: J-D5's reconciliation summary is DOOR-side only — the canonical Cycle 13 (End-of-night reconciliation report) is the cross-source post-event-end summary across ONLINE + DOOR + scans + discrepancy alerts.

---

(Original `Status: ⬜ PLACEHOLDER` flipped to `✅ DONE` 2026-05-04 during epic-status backfill audit.)

## Scope

In-person ticket sales at the door — cash, card-reader (Stripe Terminal STUB), NFC tap-to-pay (iOS Tap to Pay STUB), manual entry. Print/SMS receipt. Separate door-revenue ledger from online sales.

## Journeys (to refine)

- J-D1 — Cash sale flow + receipt
- J-D2 — Card-reader sale flow (Stripe Terminal STUB)
- J-D3 — NFC tap-to-pay (iOS Tap to Pay STUB)
- J-D4 — Manual entry (write-in ticket, no payment)
- J-D5 — Door-revenue summary on event detail

## References

- BUSINESS_PRD §6.2, §7
- NFC platform support is feature-flagged (R11 — iOS approval, Android Wallet integration)
- Stripe Terminal goes live in B4

## Notes

UI shells only this cycle. Payments wire live in B4. Mobile-only scope (web can't do NFC or attached readers; document fallback).
