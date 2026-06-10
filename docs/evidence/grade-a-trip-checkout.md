# Grade A evidence — Trip buyer checkout (#426 PR7 bundle)

**Domain:** Buyer trip checkout funnel (`/checkout-trip/{tripEventId}` → intake? → buyer → payment → confirm)  
**Apps:** mingla-business (web + native buyer surfaces)  
**Status:** Engineering evidence baseline — runtime device proof remains operator gate.

## Why trip checkout

Trip checkout mirrors event ticket checkout on the **same** `biz_ticket_checkout_create_session` RPC (Tr3 branches on `event_type='trip'`). It is a separate public funnel with installment + intake steps and must not regress independently of event checkout ([#431](https://github.com/Mingla-LLC/mingla-main/pull/431)).

## Funnel routes

| Step | Route | File | States covered |
|------|-------|------|----------------|
| 1 — Spots | `/checkout-trip/{tripEventId}` | `app/checkout-trip/[tripEventId]/index.tsx` | Loading, not found, past/cancelled, empty cart, populated |
| 1b — Intake | `/checkout-trip/{tripEventId}/intake` | `app/checkout-trip/[tripEventId]/intake.tsx` | Schema loading, validation errors, empty-cart guard |
| 2 — Buyer | `/checkout-trip/{tripEventId}/buyer` | `app/checkout-trip/[tripEventId]/buyer.tsx` | Field validation, empty-cart guard, free vs paid branch |
| 3 — Payment | `/checkout-trip/{tripEventId}/payment` | `app/checkout-trip/[tripEventId]/payment.tsx` | Stripe/web payment errors, cart guards |
| 4 — Confirm | `/checkout-trip/{tripEventId}/confirm` | `app/checkout-trip/[tripEventId]/confirm.tsx` | Polling, realtime pending, URL fragment recovery |

## Regression tests (repo-running)

| Test | What it proves |
|------|----------------|
| `orch_0911_trip_confirm_loading_state.test.tsx` | Trip confirm loading / pending states |
| `orch_0928_url_fragment_recovery.test.tsx` | `#csi` / `#bst` fragment recovery on confirm |
| `orch_0915_pay_in_full_choice.test.ts` | Pay-in-full vs installment choice |
| `ticketCheckoutService` tests | Shared create/confirm client contract |
| `npm run test:orch-433` | PR7 trip checkout Grade A contract |

## Load harness (#426)

| Script | Path |
|--------|------|
| Checkout create (shared RPC) | `scripts/load/ticket-checkout-create.js` |
| Checkout status | `scripts/load/ticket-checkout-status.js` |

Trip-specific load IDs (`LOAD_TEST_TRIP_EVENT_ID`) are a follow-up fixture doc row — event checkout fixtures exercise the same RPC path today.

## Manual smoke gate (operator)

1. Open a published trip → Reserve my spot → complete free checkout.
2. Repeat paid checkout (Stripe test card) on web.
3. If intake tiers exist, complete intake step before buyer.
4. Confirm page shows tickets / QR without silent spinner hang.
5. Attach screenshots to epic #426 when closing trip checkout Workstream E box.

## Out of scope (Tier 2 / follow-up)

- Staging load proof at scale
- Full Maestro matrix for trip funnel
