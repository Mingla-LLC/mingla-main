# Cycle B3 — Backend: checkout wired live (Stripe Payment Element)

**Phase:** Phase 6 — Backend MVP
**Estimated effort:** ~40 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `supabase/` + `mingla-business/` (Expo Web)

## Scope

Replace the checkout STUB from Cycle 8 with live Stripe Payment Element. Webhooks for charge.succeeded / failed / refunded. Order finalization edge fn. Ticket QR issuance (signed + secure). Email receipts via Resend.

## Journeys (to refine)

- J-B3.1 — Stripe Payment Element wired + 3DS + idempotency
- J-B3.2 — Charge webhooks → order finalize → ticket issue → email receipt
- J-B3.3 — Failed-payment webhook + retry surface
- J-B3.4 — Refund webhook + UI sync

## References

- BUSINESS_PROJECT_PLAN §B.4 (`orders`, `tickets`)
- R3 (financial discrepancy — idempotency keys + reconciliation job)
- DEC-076 (auth model — buyers can be guest or logged-in)

## Notes

Reconciliation job (Stripe ledger ↔ Mingla ledger) must run hourly from day one of B3. Strategic Plan §6 R3.
