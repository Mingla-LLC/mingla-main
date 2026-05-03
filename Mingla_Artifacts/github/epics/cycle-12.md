# Cycle 12 — Door payments: cash, card-reader, NFC tap, manual entry, receipt

**Phase:** Phase 4 — Event Management
**Estimated effort:** ~48 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `mingla-business/`

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
