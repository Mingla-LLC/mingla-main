# Cycle 8 — Checkout flow (UI + payment stubs)

**Phase:** Phase 3 — Public Surfaces
**Estimated effort:** ~60 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `mingla-business/` (Expo Web variant)

## Scope

End-to-end checkout for buyers landing on a public event page. UI only this cycle — Stripe Payment Element stub, order confirmation page, ticket-issue mock. Real payments wire up in B3.

## Journeys (to refine)

- J-C1 — Cart / quantity selection (per-ticket-type qty pickers, min/max enforced)
- J-C2 — Buyer details (email + name + phone; account-optional)
- J-C3 — Approval-required path (submit → "you'll hear back" state)
- J-C4 — Password gate (re-enter password if event requires it)
- J-C5 — Free ticket path (no payment, instant issue)
- J-C6 — Paid ticket path (Stripe Payment Element STUB)
- J-C7 — Order confirmation page (QR + email-sent placeholder)
- J-C8 — Failed payment + retry UX
- J-C9 — Order summary in account (logged-in buyers)

## References

- BUSINESS_PRD §3.4, §4 (checkout expectations)
- Stripe Connect type unresolved (Q3) — defer to B2
- Tax: per-event organiser-configured rate (DEC-076 / Q10 resolution)

## Notes

This is one of the larger UI cycles. Decompose carefully — buyer-flow states are tricky (logged-in vs guest, free vs paid, approval vs instant, etc.).
