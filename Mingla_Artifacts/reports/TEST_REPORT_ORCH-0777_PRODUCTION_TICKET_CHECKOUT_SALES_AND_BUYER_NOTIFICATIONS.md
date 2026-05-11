# TEST REPORT ORCH-0777 - Production Ticket Checkout, Sales, and Buyer Notifications

Date: 2026-05-10  
Tester: Codex `$tester`  
Verdict: FAIL / NEEDS REWORK

## Executive Summary

ORCH-0777 is not production-ready.

The implementation adds meaningful pieces: phone is now required in the checkout UI, free checkout calls a Supabase Edge function instead of the old local confirm path, paid checkout creates a Stripe PaymentIntent, notification rows are queued, the Orders list has a new Supabase-backed query, scanner submission now goes through an authenticated Edge function, and the new Edge functions type-check under Deno.

However, the release still fails the core promise: "a buyer gets a ticket, the event records the sale, and the organizer sees the real sale." There is a P0 SQL bug that rejects every scheduled/live event from checkout, paid buyers can be stranded after a successful card payment while waiting for the Stripe webhook, multiple organizer sales/guest/revenue surfaces still read the old local `useOrderStore`, and production does not have the ORCH-0777 migration applied remotely.

## Blocking Findings

### P0 - Checkout RPC rejects scheduled and live events

Evidence:
- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:296`

The migration checks:

```sql
IF v_event.visibility <> 'public' OR v_event.status <> ANY (ARRAY['scheduled'::text, 'live'::text]) THEN
```

In PostgreSQL, `status <> ANY(array)` is true when the value differs from at least one item in the array. A `scheduled` event differs from `live`, and a `live` event differs from `scheduled`, so both valid selling states raise `event_not_selling`.

User outcome:
- Free checkout fails before creating the order.
- Paid checkout fails before PaymentSheet.
- No sale is registered.
- No ticket is issued.
- No buyer email/SMS confirmation is queued.

Required rework:
- Replace with `NOT (v_event.status = ANY (...))` or `v_event.status <> ALL (...)`.
- Add a SQL or Edge regression test proving `scheduled` and `live` public events can create sessions, while hidden/deleted/non-selling events cannot.

### P0 - Paid buyers can pay successfully and still see an error instead of tickets

Evidence:
- `mingla-business/app/checkout/[eventId]/payment.tsx:149-158`

After `presentPaymentSheet()` succeeds, the app calls `getTicketCheckoutStatus()` exactly once. If the Stripe webhook has not finalized the order yet, the app throws:

```ts
"Payment succeeded. Ticket issuance is still processing; refresh in a moment."
```

This violates the spec requirement for an awaiting-confirmation/polling/subscription state after a successful payment.

User outcome:
- Buyer may be charged.
- Buyer sees an error screen/toast instead of a processing state.
- Buyer may leave before receiving tickets.
- Support burden increases because the user experienced "paid but no ticket."

Required rework:
- Add a post-payment processing state that polls or subscribes until `order_id` exists, times out gracefully, and never frames a successful payment as a failure.
- Add regression coverage for webhook delay.

### P0 - ORCH-0777 migration is not applied remotely

Evidence:
- `/Users/sethogieva/bin/supabase migration list --linked` shows:

```text
20260515000013 |                | 2026-05-15 00:00:13
```

User outcome:
- The production/linked database does not have the ORCH-0777 schema/RPC layer.
- Deployed Edge/UI code that expects `ticket_checkout_sessions`, new order columns, and new RPCs will fail against the linked DB.

Required rework:
- Apply the migration through the approved deployment path after fixing the SQL blocker.
- Re-run linked migration verification.

### P1 - Organizer order detail, resend, refund, and cancel still use local orderStore

Evidence:
- `mingla-business/app/event/[id]/orders/index.tsx:85-117` lists server orders and links to `/event/[id]/orders/[orderId]`.
- `mingla-business/app/event/[id]/orders/[oid]/index.tsx:38-42` imports `useOrderStore`.
- `mingla-business/app/event/[id]/orders/[oid]/index.tsx:172-174` loads the detail row with `s.getOrderById(orderId)`.
- `mingla-business/app/event/[id]/orders/[oid]/index.tsx:536-545` keeps the "Resend ticket" action inside the local detail screen.
- `mingla-business/app/event/[id]/orders/[oid]/index.tsx:552-575` still wires local refund/cancel dialogs.

The Orders list now returns real Supabase order IDs, but the detail page looks them up in persisted local Zustand state. A real server order from checkout will not exist in that local store.

Organizer outcome:
- Orders list can show a real order.
- Tapping that real order can open a missing/stale detail screen.
- Resend ticket is not production-backed.
- Refund/cancel remain simulated/local for this flow.

Required rework:
- Add a server-backed order detail hook/service.
- Wire resend to the notification dispatcher or a dedicated server function.
- Either production-wire refund/cancel or hide/label them until real.

### P1 - Event sales, revenue, activity, guest list, reconciliation, and edit guards still read local orderStore

Evidence:
- Event detail sold/revenue/activity: `mingla-business/app/event/[id]/index.tsx:313-375` and `389-428`.
- Guest list: `mingla-business/app/event/[id]/guests/index.tsx:217-251`.
- Guest detail: `mingla-business/app/event/[id]/guests/[guestId].tsx:170-202` and `699-712`.
- Reconciliation: `mingla-business/app/event/[id]/reconciliation.tsx:101-149`.
- Event cards: `mingla-business/src/components/event/EventListCard.tsx:98-112`.
- Published-edit web-purchase guard: `mingla-business/src/components/event/EditPublishedScreen.tsx:745-759`.

These surfaces still derive paid sales from `useOrderStore`, while production checkout now writes to Supabase `orders`, `order_line_items`, and `tickets`.

Organizer outcome:
- Event detail may still show `0 sold` after real checkout.
- Revenue and activity can stay empty or stale.
- Guest list may omit real buyers.
- Reconciliation can omit real online sales.
- Published-event guard may fail to detect real web purchases.

Required rework:
- Define one server-backed event sales/orders/attendees source and migrate all organizer surfaces named above.
- Add regression tests that create a server order and assert the affected UI data adapters expose sold count, revenue, activity, guest rows, and guard state.

### P1 - QR bearer token is stored in plaintext and returned by an unauthenticated status endpoint

Evidence:
- Ticket issuance stores raw bearer payload: `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:525-535`.
- Scanner validation accepts the bearer token from that payload: `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:620-638`.
- Existing RLS lets buyer or brand team select tickets: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14204-14206`.
- Status endpoint uses service role and returns `qr_code` by `checkoutSessionId`: `supabase/functions/ticket-checkout-status/index.ts:17-61`.

The spec asked that raw QR bearer secrets not be stored in plaintext if the token itself is enough to validate entry. This implementation stores `mingla:ticket:<id>:token:<raw-token>` in `tickets.qr_code`, hashes the same token into `qr_token_hash`, and uses the plaintext token for scanning.

Security outcome:
- Anyone who can read the ticket row can read the scan credential.
- Anyone with a checkout session ID can call the status function and retrieve QR payloads because the endpoint does not authenticate the buyer.

Required rework:
- Store only a display-safe/signed public QR payload, or store the raw token only in a channel where it is not readable through RLS/API.
- Add buyer/auth/session ownership checks to checkout status, or use a separate one-time buyer access token.
- Use a stronger hash than `md5` for bearer-token matching.

### P1 - PaymentIntent session update error is ignored

Evidence:
- `supabase/functions/ticket-checkout-create/index.ts:139-148`

After Stripe creates the PaymentIntent, the function updates `ticket_checkout_sessions` with `stripe_payment_intent_id` and client secret metadata but does not inspect the Supabase update error.

User outcome:
- A buyer can receive a client secret and complete payment.
- If the DB update failed, the webhook cannot map the PaymentIntent back to the checkout session.
- Tickets may never be issued for a successful payment.

Required rework:
- Check the update result.
- If persisting the PaymentIntent mapping fails, cancel the PaymentIntent or return a hard failure before presenting payment.

### P2 - Schema contract does not match the spec

Evidence:
- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:18-65`
- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql:67-100`

Missing or mismatched items versus the approved spec:
- No `orders.stripe_payment_intent_status`.
- No `orders.failed_at`.
- `orders.source` defaults to `legacy`, not `online_checkout`.
- `orders.notification_status` defaults to `not_required`, not `pending`.
- `orders.stripe_application_fee_amount_cents` is nullable with no `DEFAULT 0`.
- No unique index on `tickets.qr_token_hash`.
- `ticket_checkout_sessions` lacks the fuller session contract from the spec, including cart fingerprint/subtotal/client-secret hash style fields.

Outcome:
- Some of this may be intentional compatibility work, but it is not documented as a spec amendment.
- The migration does not fully encode the production contract.

Required rework:
- Either align the schema with the spec or update the spec with explicit compatibility decisions and tests.

## Passing Evidence

- Phone is required in the buyer checkout UI and validated as E.164-compatible.
- `ticket-checkout-create`, `ticket-checkout-status`, `ticket-confirmation-dispatch`, `twilio-message-status`, `scan-ticket`, and `stripe-webhook` passed Deno type-check.
- The ORCH-0777 grep/Jest/TypeScript command passed.
- `mingla-business` TypeScript passed separately.
- `git diff --check` passed.

## Commands Run

```bash
npm run test:orch-0777
```

Result: PASS

```text
ORCH-0777 production checkout guard passed.
PASS src/utils/__tests__/phone.test.ts
Test Suites: 1 passed, 1 total
Tests: 1 passed, 1 total
```

```bash
npx tsc --noEmit
```

Result: PASS

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/ticket-checkout-create/index.ts \
  supabase/functions/ticket-checkout-status/index.ts \
  supabase/functions/ticket-confirmation-dispatch/index.ts \
  supabase/functions/twilio-message-status/index.ts \
  supabase/functions/scan-ticket/index.ts \
  supabase/functions/stripe-webhook/index.ts
```

Result: PASS

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Result: FAIL for production readiness because `20260515000013` exists locally but has no remote version.

```bash
/Users/sethogieva/bin/supabase db lint --local
```

Result: BLOCKED

```text
failed to connect to postgres: failed to connect to `host=127.0.0.1 user=postgres database=postgres`: dial error (dial tcp 127.0.0.1:54322: connect: connection refused)
```

```bash
git diff --check
```

Result: PASS

## Final Gate

Do not ship ORCH-0777 yet.

Minimum rework before retest:
- Fix the SQL selling-state predicate.
- Add delayed-webhook handling after successful PaymentSheet payment.
- Apply/re-verify migration deployment after SQL repair.
- Move order detail, guest/revenue/activity/reconciliation/event-card/edit-guard surfaces to server truth.
- Harden QR/status endpoint privacy.
- Add regression tests that fail on the current implementation and pass after repair.
