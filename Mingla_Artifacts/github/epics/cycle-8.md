# Cycle 8 — Checkout flow (UI + payment stubs)

**Phase:** Phase 3 — Public Surfaces
**Estimated effort:** ~60 hrs
**Status:** ✅ DONE
**Codebase:** `mingla-business/` (Expo Web variant)

## What shipped

- Cycle 8a (cart + buyer details): J-C1 cart with per-tier qty pickers + min/max enforcement, J-C2 buyer details (email/name/phone account-optional), J-C5 free-ticket path, anon-tolerant routes (`/checkout/{eventId}` + `/e/{brandSlug}/{eventSlug}` + `/o/{orderId}` — NO useAuth, NO sign-in redirect; codified as memory rule `feedback_anon_buyer_routes`)
- Cycle 8b (payment + 3DS confirm): J-C6 Stripe Payment Element STUB + J-C7 order confirmation + J-C8 failed-payment retry + back-listener disarm pattern (memory rule `feedback_back_listener_disarm_pattern`)
- Cycle 9c-2 / orderStore selector pattern v2 established (orderStoreHelpers — getById safe-subscribe / fresh-array .getState() only)
- 2 IMPL reports: `IMPLEMENTATION_BIZ_CYCLE_8a_CART_AND_TICKETS_BUYER.md` + `IMPLEMENTATION_BIZ_CYCLE_8b_PAYMENT_3DS_CONFIRM.md`
- 2 NEW invariants: I-21 (anon-tolerant buyer routes) + I-22 (orderStore selector discipline)

## Closing notes

Cycle 8 established the anon-buyer surface contract that every subsequent cycle (9 / 10 / 12) preserved. The Toast-needs-absolute-wrap memory rule (`feedback_toast_needs_absolute_wrap`) was codified during 8a's invisible-toast bug. Real Stripe payments wire in B3.

---

(Original `Status: ⬜ PLACEHOLDER` flipped to `✅ DONE` 2026-05-04 during epic-status backfill audit.)

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
