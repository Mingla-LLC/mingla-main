# Grade A evidence — Buyer checkout (#426 PR5)

**Domain:** Buyer anon checkout funnel (`/checkout/{eventId}` → buyer → payment → confirm)  
**Apps:** mingla-business (web + native buyer surfaces)  
**Status:** Engineering evidence baseline — runtime device proof remains operator smoke.

## Why checkout first

Checkout is on the **100k load profile** critical path (`ticket-checkout-create`, `ticket-checkout-status`) and directly affects revenue. This doc links code, tests, and load harness to Workstream E “all states everywhere.”

## Funnel routes

| Step | Route | File | States covered |
|------|-------|------|----------------|
| 1 — Tickets | `/checkout/{eventId}` | `app/checkout/[eventId]/index.tsx` | Loading, not found, past/cancelled, empty cart, populated |
| 2 — Buyer | `/checkout/{eventId}/buyer` | `app/checkout/[eventId]/buyer.tsx` | Validation errors, empty-cart guard, free vs paid branch |
| 3 — Payment | `/checkout/{eventId}/payment` | `app/checkout/[eventId]/payment.tsx` | Stripe/web payment errors, cart guards |
| 4 — Confirm | `/checkout/{eventId}/confirm` | `app/checkout/[eventId]/confirm.tsx` | Polling, realtime pending, confirm errors |

## Regression tests (repo-running)

| Test | What it proves |
|------|----------------|
| `orch_0911_confirm_loading_state.test.tsx` | Confirm screen loading / pending states |
| `isPastGate.test.ts` | Past-event gate blocks purchase (ORCH-0850) |
| `orch-0852-bulletproof-confirm.test.ts` | `ticket-checkout-confirm` client contract |
| `ticketCheckoutService` / `publicEventsService` tests | Server mapping + checkout create path |
| `npm run test:orch-430` | PR5 Grade A contract (routes + state markers) |

## Load harness (#426)

| Script | Path |
|--------|------|
| Checkout create | `scripts/load/ticket-checkout-create.js` |
| Checkout status | `scripts/load/ticket-checkout-status.js` |
| Combined smoke | `scripts/load/smoke.js` |

Fixtures: [load-test-fixtures.md](../load-test-fixtures.md)

## Backend hot paths

| Edge function | Observability | DB indexes |
|---------------|---------------|------------|
| `ticket-checkout-create` | Structured log (#428) | `idx_event_dates_event_id_end_at` (#430) |
| `ticket-checkout-status` | Structured log (#428) | `idx_tickets_order_id_created_at` (#430) |
| `ticket-checkout-confirm` | — | — |
| `stripe-webhook` | Structured log (#428) | — |

See [db-hot-queries.md](../db-hot-queries.md).

## Manual smoke gate (operator)

After deploy, on staging:

1. Open a published event → Get tickets → complete free checkout.
2. Repeat paid checkout (Stripe test card) on web.
3. Confirm page shows tickets / QR without silent spinner hang.
4. Optional: run `k6 run scripts/load/ticket-checkout-create.js` with `LOAD_TEST_EVENT_ID`.

Attach screenshots or load output to epic #426 when closing Workstream E checkout box.

## Related funnels

- Trip checkout: [grade-a-trip-checkout.md](./grade-a-trip-checkout.md)
- Hub organiser surfaces: [grade-a-hub.md](./grade-a-hub.md)

## Out of scope (follow-up)

- Full Maestro matrix expansion
