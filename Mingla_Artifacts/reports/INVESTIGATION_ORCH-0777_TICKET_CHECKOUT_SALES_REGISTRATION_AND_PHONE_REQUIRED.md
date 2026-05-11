# ORCH-0777 Forensic Investigation - Ticket Checkout Sales Registration and Phone Required

Date: 2026-05-10
Skill: $forensics
Status: FAIL - launch blocker confirmed
Severity: S0

## Executive Verdict

The report is true. Buyer checkout is not registering free or paid tickets as durable event sales. The current flow creates stub order/ticket IDs, records paid/free orders only into `mingla-business.orderStore.v1` on the same client device, and never writes Supabase `orders`, `order_line_items`, or `tickets`. Paid checkout also does not process real Stripe buyer payment; it uses `PaymentElementStub` and mock success/3DS/decline state.

The phone requirement is also not enforced. The buyer form explicitly accepts a blank phone value, labels the field as optional, and enables both free and paid checkout with no phone number.

This means organizer sales/revenue/order/guest surfaces can appear updated only on the buyer's current device after the confirmation screen mounts. They are not backend truth, not cross-device, not recoverable, and not usable by production scanner validation. The product must not be treated as ready for live ticketing until checkout writes durable server-side order and ticket truth.

## Customer Pain

Organizers believe ticket sales are occurring, but the event has no reliable sales record. Buyers can receive QR codes that door staff cannot validate on a different device. Staff cannot trust revenue, guest lists, capacity protection, or scanner results. Missing buyer phone numbers also remove an expected operational contact channel for pre-event changes, door issues, and support.

## Confirmed Current Behavior

### Free ticket path

`mingla-business/app/checkout/[eventId]/buyer.tsx`:

- `PHONE_MIN_CHARS = 7`, but `phoneValid = phoneTrim.length === 0 || phoneTrim.length >= PHONE_MIN_CHARS` at lines 70-101.
- Blank phone therefore passes `validation.isValid`.
- The phone input is labelled and announced as optional at lines 366-374.
- `handleContinue` sends free orders straight to confirmation, generating stub IDs with `generateOrderId()` and `generateTicketId()` at lines 219-245.
- No Supabase call and no Stripe call exist in this route.

### Paid ticket path

`mingla-business/app/checkout/[eventId]/payment.tsx`:

- The file header states this is a "Stub Stripe Payment Element" and "generate stub OrderResult" flow.
- `buildResultFromCart()` generates stub order/ticket IDs at lines 69-97.
- `completePayment()` only calls `recordResult(result)` and routes to `/confirm` at lines 196-207.
- There is no `supabase.functions.invoke`, no `orders` insert, no `tickets` insert, no PaymentIntent creation, and no Stripe confirmation in this route.

`mingla-business/src/components/checkout/PaymentElementStub.tsx`:

- The file states "No real Stripe SDK import" and "Stub mode - no card data is sent or stored" at lines 15-19 and 205-207.
- It resolves locally after `PROCESSING_MS = 1200` with `"ok" | "requiresAction" | "declined"` at lines 76-119.

### Confirmation side effect

`mingla-business/app/checkout/[eventId]/confirm.tsx`:

- On mount, it builds an `OrderRecord` and calls `useOrderStore.getState().recordOrder(order)` at lines 149-188.
- The order is marked `status: "paid"` for both paid and free-result flows.
- Buyer phone is copied from `buyer.phone`, which may be an empty string.
- This effect depends on the confirmation screen mounting; if the app exits before mount, even the local order is not recorded.

### Local-only order truth

`mingla-business/src/store/orderStore.ts`:

- The store is a persisted Zustand store named `mingla-business.orderStore.v1`.
- It records orders client-side only via `recordOrder()` at lines 219-225.
- Organizer sales selectors (`getSoldCountForEvent`, `getSoldCountByTier`, `getRevenueForEvent`, `getRevenueSummaryForEvent`) read only this local `entries` array at lines 322-383.
- The file comments identify this as transitional and awaiting Supabase migration.

`mingla-business/src/utils/stubOrderId.ts`:

- The file explicitly says stub IDs are replaced in B3 by Supabase-issued IDs and signed JWT QR payloads.
- The exit condition says the Stripe webhook handler should create real order rows via `orders` and `order_line_items`.

## Surfaces Affected

`mingla-business/app/event/[id]/index.tsx`:

- "Orders" tile sold count uses `useOrderStore.getSoldCountForEvent()` at lines 313-316.
- Revenue and payout derive from local `allOrderEntries` at lines 317-354.
- Ticket-type sold counts derive from local `allOrderEntries` at lines 359-375.
- Recent activity purchase rows derive from local `allOrderEntries` at lines 388-428.

`mingla-business/src/components/event/EventListCard.tsx`:

- Event list sold count and revenue derive from local `useOrderStore` at lines 98-112.

`mingla-business/app/event/[id]/guests/index.tsx`:

- Guest list merges `useOrderStore.entries` with comp and door stores at lines 216-251.
- If the organizer is on a different device/account session from the buyer checkout device, buyer orders are absent.

`mingla-business/app/event/[id]/scanner/index.tsx`:

- Scanner validates QR payloads against `useOrderStore.getState().getOrderById(parsed.orderId)` at lines 340-348.
- The screen already carries a testing-mode banner at lines 564-576 stating it only validates orders made on this device.

## Backend Reality

Durable schema exists, but checkout is not wired to it.

`supabase/migrations/20260505000000_baseline_squash_orch_0729.sql`:

- `order_line_items` exists at lines 8506-8515.
- `orders` exists at lines 8525-8546, including buyer fields, totals, currency, payment status, Stripe IDs, and door-sale metadata.
- `tickets` exists at lines 9862-9883, including `order_id`, `ticket_type_id`, `event_id`, attendee fields, `qr_code`, and status.
- `scan_events` exists at lines 9473-9485.
- Ticket consistency triggers exist at lines 3354-3397.
- RLS policies allow authenticated buyer/brand-team order reads and finance-plus order mutations at lines 14200-14306.
- Scanner policies exist for ticket update/check-in and scan-event insert at lines 14468-14482.

But no current buyer checkout code writes these tables, and no edge function currently provides a buyer checkout transaction that:

- validates event and ticket availability,
- requires phone,
- reserves/creates order and line items,
- creates tickets,
- produces signed QR payloads,
- handles free checkout atomically,
- creates/returns Stripe PaymentIntents for paid checkout,
- finalizes paid orders on webhook success.

Stripe edge function inventory is Connect/onboarding-heavy (`brand-stripe-*`, `stripe-webhook`, balances, KYC). I found no buyer-payment function such as `create-checkout`, `create-payment-intent`, `checkout-complete`, or `scan-ticket`.

## Root Cause

Cycle 8 intentionally shipped a stub buyer checkout: optional phone, mock Stripe, no Supabase rows. Cycle 9c then wired the stub confirmation screen into a client-side `useOrderStore` so local organizer surfaces would show sales. Cycle 11 scanner later reused the same local store and documented the cross-device gap rather than solving it. The intended B-cycle backend migration has not landed for buyer checkout.

This is not a small UI bug. It is a missing backend commerce path plus a stale optional-phone contract.

## Required Product Contract

For both free and paid online tickets:

1. Buyer phone is required before checkout can continue.
2. A successful checkout creates durable Supabase `orders`, `order_line_items`, and one `tickets` row per seat.
3. Organizer sales, revenue, order list, guest list, capacity guards, and scanner validation derive from server truth, not local-only `useOrderStore`.
4. Paid checkout is not considered successful until Stripe confirms payment server-side.
5. Free checkout is atomically completed server-side with `total_cents = 0` and `payment_status = 'paid'`.
6. QR payloads must reference durable ticket/order IDs and be verifiable by the scanner backend.
7. Buyer-facing confirmation must be a projection of the server-created order/tickets, not the creator of order truth.

## Implementation Spec

### Phase 1 - Phone requirement

- Change buyer validation so `phoneTrim.length >= PHONE_MIN_CHARS` is required.
- Update placeholder/accessibility/copy from optional to required.
- Ensure paid payment screen defensive guard includes required phone so deep links cannot bypass buyer details.
- Normalize/validate phone in a shared helper if E.164 normalization is already available; otherwise use minimum validation as the immediate launch blocker fix and mark E.164 as follow-up.

### Phase 2 - Server checkout transaction

Create a Supabase Edge Function for free checkout and paid checkout initiation/finalization. Recommended split:

- `ticket-checkout-create`:
  - input: event_id, buyer_name, buyer_email, buyer_phone, cart lines, idempotency key.
  - validates published/live event, ticket visibility, availability, sale windows, capacity, currency consistency, and required phone.
  - for free total:
    - service-role transaction creates `orders`, `order_line_items`, and `tickets`;
    - returns order/ticket summary and QR payloads.
  - for paid total:
    - creates pending order/line items or a pending checkout intent record;
    - creates Stripe PaymentIntent for connected account/payment destination;
    - returns client secret and pending order reference.
- `stripe-webhook` buyer-payment branch:
  - on payment success, marks order paid, writes Stripe IDs, issues tickets if not already issued, and preserves idempotency.
  - on failure/cancel, marks failed/expired and does not issue valid tickets.
- `ticket-checkout-read` or standard query:
  - returns buyer confirmation projection after free success or paid webhook success.

If the repo prefers a single `checkout-complete-free` plus `create-payment-intent`, keep the same invariants. The important part is that checkout success is not a client-only Zustand write.

### Phase 3 - Replace local projections

- Replace organizer sales/revenue/order/guest scanner reads with server-backed order/ticket queries or React Query services.
- Keep `useOrderStore` only as a temporary offline/cache projection if needed, never as canonical sales truth.
- Update scanner to call a backend `scan-ticket` function against durable `tickets` and `scan_events`.
- Remove or update the testing-mode scanner banner once backend scan validation ships.

### Phase 4 - Capacity and concurrency

- Enforce capacity server-side at checkout, not just in client display.
- Use row locks or a database function/RPC transaction to prevent oversell.
- Add an idempotency key to prevent double order creation on retry.
- Do not trust client totals; recompute prices/currency server-side from ticket rows.

## Regression Tests Required

Implementation must include repo-running tests that fail against current behavior:

- Buyer phone validation:
  - blank phone keeps Continue/Reserve disabled or returns validation error;
  - short phone fails;
  - valid phone passes.
- Free checkout:
  - invokes backend checkout function;
  - creates durable order, line item, and ticket rows;
  - does not call `useOrderStore.recordOrder` as canonical truth.
- Paid checkout:
  - creates/uses a Stripe PaymentIntent path, not `PaymentElementStub`;
  - paid order is not marked paid/tickets valid until webhook success.
- Organizer sales projection:
  - event sold count/revenue/guest list derive from server order rows.
- Scanner:
  - scanner validates a ticket created on another device/session through backend truth.
- Strict-grep gate:
  - fail on `PaymentElementStub` import from production checkout route;
  - fail on `phoneTrim.length === 0 ||` in buyer checkout validation;
  - fail on checkout confirmation calling `useOrderStore.getState().recordOrder` as canonical write.

Suggested package script after implementation: `test:orch-0777`.

## Migration and Security Notes

- Existing `orders.currency` default was removed by ORCH-0769; checkout must explicitly provide currency from server-side event/ticket/brand/Stripe context.
- Existing RLS currently lets finance-plus users insert/update orders. Buyer checkout should use a service-role edge function, not direct anon/authenticated client table inserts.
- If guest checkout is anonymous, do not rely on `buyer_user_id` for readback. Use a signed order access token, magic-link style claim, or secure email flow for buyer order access.
- Phone numbers are PII; store minimally, validate access through buyer/order/brand-team policies, and avoid leaking phone on public surfaces.
- Stripe Connect status must be checked before paid ticket sales are enabled. If connected account is not active/charges-enabled, paid checkout should be blocked before PaymentIntent creation.

## Open Questions

- Should phone be stored as raw buyer input initially, or normalized to E.164 before `orders.buyer_phone` / `tickets.attendee_phone`?
- For guest checkout, what is the buyer order readback/auth model: signed URL token, email OTP, account claim, or buyer session token?
- Should free checkout immediately issue valid tickets, or support approval/pending ticket types where `tickets.approval_status` starts as `pending`?
- Which table should own checkout idempotency keys if an order is created before paid webhook success?

## Readiness

Not ready to ship. This is an S0 commerce integrity gap. Free and paid checkout must be backend-backed before Mingla can claim real ticket sales, reliable attendance, or production scanner validation.

