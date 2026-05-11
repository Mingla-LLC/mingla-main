# SPEC ORCH-0777: Production Ticket Checkout, Sales Registration, and Buyer Notifications

Date: 2026-05-10  
Mode: Forensics SPEC  
Status: READY FOR IMPLEMENTOR, with explicit preflight decisions below  
Priority: S0 launch blocker

## 1. Plain-English Goal

When a buyer gets a free ticket or buys a paid ticket, Mingla must treat that as a real sale:

- the buyer's phone number is required;
- the order is written to Supabase;
- the purchased ticket rows are written to Supabase;
- event sales, revenue, guests, orders, and scanner validation read server truth;
- paid checkout charges the buyer through Stripe;
- free checkout completes without Stripe but still writes the same durable order/ticket truth;
- the buyer receives a ticket confirmation by email and by message;
- notification sending is retryable and idempotent, so refreshes, webhook retries, and resend actions do not duplicate tickets or spam buyers.

This spec replaces the current local-only checkout stub with a production flow.

## 2. Evidence Summary

Current behavior is not production:

- `mingla-business/app/checkout/[eventId]/buyer.tsx` allows blank phone numbers and validates phone as `phoneTrim.length === 0 || phoneTrim.length >= PHONE_MIN_CHARS`.
- Free checkout in `buyer.tsx` generates fake order/ticket IDs using `generateOrderId` / `generateTicketId` and routes directly to confirmation.
- Paid checkout in `mingla-business/app/checkout/[eventId]/payment.tsx` uses `PaymentElementStub`, `runCardPaymentStub`, and fake IDs. It does not create a Stripe payment.
- Confirmation in `mingla-business/app/checkout/[eventId]/confirm.tsx` writes to `useOrderStore.getState().recordOrder(order)`.
- `mingla-business/src/store/orderStore.ts` is persisted local Zustand storage named `mingla-business.orderStore.v1`. Its own header says Supabase migration is deferred.
- Organizer orders, order detail, event revenue/sales, guest surfaces, and scanner rely on local `useOrderStore`.
- Scanner validation in `mingla-business/app/event/[id]/scanner/index.tsx` reads the local order store and records local scan events with `offlineQueued: true`.
- Supabase already has core tables: `orders`, `order_line_items`, `tickets`, `scan_events`, `ticket_types`, `stripe_connect_accounts`, and `payment_webhook_events`.
- Current `stripe-webhook` verifies Stripe signatures and idempotently records events, but `stripeWebhookRouter.ts` handles Connect account/payout/application-fee events only. It does not finalize ticket purchases from `payment_intent.succeeded`.
- Current `notify-dispatch` can send Resend email, but its idempotency check only runs when `idempotencyKey && userId`. Buyer checkout can be guest/email-only, so ORCH-0777 buyer ticket messages need a separate notification ledger or an explicit dispatcher hardening.
- Existing Twilio OTP functions use Twilio Verify (`TWILIO_VERIFY_SERVICE_SID`). Buyer purchase notification must use Programmable Messaging / Messaging Service, not the Verify service.

Provider references used:

- Stripe destination charges with PaymentIntents, `transfer_data[destination]`, and `application_fee_amount`: https://docs.stripe.com/connect/destination-charges
- Stripe PaymentIntent creation API: https://docs.stripe.com/api/payment_intents/create
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Stripe webhook handling and signature requirement: https://docs.stripe.com/webhooks
- Twilio Messaging Services and status callbacks: https://www.twilio.com/docs/messaging/services
- Twilio outbound status callbacks: https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks
- Twilio RCS with automatic SMS/MMS fallback through Messaging Services: https://www.twilio.com/docs/rcs/send-an-rcs-message

## 3. Product Contract

### 3.1 Buyer Checkout

A buyer cannot continue past buyer details unless these fields are valid:

- full name: required, minimum 2 trimmed characters;
- email: required, valid email format;
- phone: required, normalized to E.164 before server submission;
- marketing opt-in: optional, default false.

For the first implementation, phone verification is not required at checkout unless the implementor can add it without delaying the S0 fix. The hard launch contract is "required valid phone captured and stored," not "OTP-verified buyer phone."

### 3.2 Free Tickets

Free ticket checkout must:

- call a Supabase Edge Function;
- validate event visibility/status and ticket availability on the server;
- create one `orders` row with `payment_method = 'free'`, `payment_status = 'paid'`, `total_cents = 0`;
- create matching `order_line_items`;
- create one `tickets` row per issued ticket;
- decrement or reserve inventory atomically;
- dispatch buyer email and message after the order/tickets commit;
- return the durable `order_id`, `ticket_ids`, and QR payload data to the client.

The client must never generate production order IDs, ticket IDs, or QR secrets.

### 3.3 Paid Tickets

Paid ticket checkout must:

- call a Supabase Edge Function to create a server-side checkout session and Stripe PaymentIntent;
- use Stripe Connect destination charges for event organizer payouts;
- use the existing connected account source of truth in `stripe_connect_accounts`;
- require `charges_enabled = true` before selling paid tickets for that brand;
- create or reserve a checkout session before payment;
- finalize `orders`, `order_line_items`, and `tickets` only after Stripe confirms payment success through a verified webhook;
- handle client success as "payment submitted, awaiting confirmation" until the server order is finalized;
- poll or subscribe for order finalization so webhook delays do not strand the user.

The buyer confirmation screen must not show valid QR tickets until durable server tickets exist.

### 3.4 Notifications

After durable ticket issuance, the buyer must receive:

- email confirmation with event details, order summary, and ticket access/QR link;
- message confirmation by Twilio Programmable Messaging using a Messaging Service. If the Messaging Service has an approved RCS sender and SMS/MMS fallback sender, Twilio can attempt RCS and fall back to SMS/MMS.

Notification failures must not roll back a completed purchase. They must be stored for retry and visible to operators.

### 3.5 Organizer Truth

Organizer surfaces must read server orders/tickets for server-backed events:

- event sales count;
- event revenue;
- event activity;
- orders list;
- order detail;
- guest list;
- ticket scan validation;
- resend ticket action.

The local Zustand order store can remain only as a legacy/offline cache for transitional local events. It cannot be the source of truth for production ticket checkout.

## 4. Required Preflight Decisions

These must be answered before paid checkout implementation is merged:

| Decision | Required answer | Why it matters |
| --- | --- | --- |
| Mingla application fee | Exact percent/fixed fee or `0` for first release | Stripe `application_fee_amount` must be deterministic and auditable. Existing UI copy implying ~4% is not enough. |
| Merchant of record / region | Whether to set `on_behalf_of` for connected accounts | Stripe requires this in some cross-region destination-charge cases. |
| RCS production status | Approved RCS sender and fallback SMS/MMS sender for the Messaging Service | RCS cannot be promised unless carrier approval and sender pool are complete. SMS fallback is required. |
| Refund/cancel launch scope | Whether refunds/cancellations are included in ORCH-0777 or a follow-up | Scanner and order status must know how refunded/voided tickets behave. |

Default implementation stance if no fee decision is provided: set Mingla application fee to `0` for paid checkout, record `application_fee_amount_cents = 0`, and leave platform-fee pricing as a follow-up PM/finance decision. Do not invent a fee.

## 5. Database Contract

Create additive migration after the current tail migration:

`supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql`

Exact names can change if the tail moves, but the migration must be additive and reversible by a clear follow-up migration, not by editing baseline squash.

### 5.1 Existing Tables To Use

Use and harden these tables:

- `orders`
- `order_line_items`
- `tickets`
- `ticket_types`
- `scan_events`
- `stripe_connect_accounts`
- `payment_webhook_events`
- `mingla_revenue_log` for application fee reconciliation, if an application fee is configured

### 5.2 Required New Columns

Add to `orders`:

- `checkout_session_id uuid`
- `buyer_phone_e164 text not null` for production checkout-created orders
- `stripe_payment_intent_status text`
- `stripe_application_fee_amount_cents integer not null default 0`
- `stripe_transfer_destination text`
- `confirmed_at timestamptz`
- `failed_at timestamptz`
- `notification_status text not null default 'pending'`
- `source text not null default 'online_checkout'`

Add constraints/checks:

- `buyer_phone_e164` must match E.164 for `source = 'online_checkout'`;
- `stripe_application_fee_amount_cents >= 0`;
- `source in ('online_checkout', 'door_sale', 'manual_import')`;
- `payment_status = 'paid'` requires `confirmed_at is not null` for `online_checkout`.

Add to `tickets`:

- `qr_token_hash text`
- `qr_version integer not null default 1`
- `issued_at timestamptz not null default now()`

Add uniqueness:

- unique `tickets.qr_token_hash` where not null;
- unique `orders.stripe_payment_intent_id` where not null;
- unique `orders.checkout_session_id` where not null.

Do not store raw QR bearer secrets in plaintext if a hashed-token flow is implemented. `tickets.qr_code` may store a signed public payload only if it is not sufficient by itself to bypass server validation.

### 5.3 Required New Tables

#### `ticket_checkout_sessions`

Purpose: server-owned pre-order checkout state and idempotency.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `event_id uuid not null references events(id)`
- `brand_id uuid not null references brands(id)`
- `buyer_user_id uuid null`
- `buyer_name text not null`
- `buyer_email text not null`
- `buyer_phone_e164 text not null`
- `currency char(3) not null`
- `subtotal_cents integer not null`
- `application_fee_amount_cents integer not null default 0`
- `total_cents integer not null`
- `status text not null`
- `stripe_payment_intent_id text null`
- `stripe_payment_intent_client_secret_hash text null`
- `stripe_account_id text null`
- `order_id uuid null references orders(id)`
- `idempotency_key text not null`
- `cart_fingerprint text not null`
- `expires_at timestamptz not null`
- `completed_at timestamptz null`
- `failed_at timestamptz null`
- `failure_reason text null`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Status values:

- `pending_free`
- `free_completed`
- `requires_payment`
- `processing_payment`
- `paid_completed`
- `failed`
- `expired`

Required uniqueness:

- unique `(idempotency_key)`;
- unique `(stripe_payment_intent_id)` where not null;
- unique `(order_id)` where not null.

#### `ticket_checkout_session_items`

Purpose: immutable server copy of requested cart lines.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `checkout_session_id uuid not null references ticket_checkout_sessions(id) on delete cascade`
- `ticket_type_id uuid not null references ticket_types(id)`
- `ticket_name_at_purchase text not null`
- `quantity integer not null`
- `unit_price_cents integer not null`
- `total_cents integer not null`
- `currency char(3) not null`
- `created_at timestamptz not null default now()`

Constraints:

- `quantity > 0`
- `unit_price_cents >= 0`
- `total_cents = quantity * unit_price_cents`

#### `ticket_order_notifications`

Purpose: idempotent buyer notification ledger for email and message delivery.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `order_id uuid not null references orders(id) on delete cascade`
- `channel text not null`
- `recipient text not null`
- `status text not null default 'pending'`
- `provider text not null`
- `provider_message_id text null`
- `provider_status text null`
- `attempt_count integer not null default 0`
- `next_retry_at timestamptz null`
- `last_attempt_at timestamptz null`
- `sent_at timestamptz null`
- `delivered_at timestamptz null`
- `failed_at timestamptz null`
- `last_error text null`
- `idempotency_key text not null`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Channel values:

- `email`
- `sms`
- `rcs`
- `message`

Provider values:

- `resend`
- `twilio`

Status values:

- `pending`
- `sending`
- `sent`
- `delivered`
- `failed_retryable`
- `failed_terminal`
- `suppressed`

Required uniqueness:

- unique `(idempotency_key)`;
- unique `(order_id, channel, recipient)` for currently active notification attempts unless the resend action explicitly creates a new versioned idempotency key.

#### `twilio_message_status_events`

Purpose: append-only Twilio status callback audit.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `twilio_message_sid text not null`
- `order_notification_id uuid null references ticket_order_notifications(id)`
- `message_status text not null`
- `error_code text null`
- `error_message text null`
- `raw_payload jsonb not null`
- `created_at timestamptz not null default now()`

Required indexes:

- index on `twilio_message_sid`;
- index on `order_notification_id`;
- index on `created_at desc`.

### 5.4 Inventory Integrity

Implement server-side inventory checks in one transaction:

- lock selected `ticket_types` rows with `for update`;
- reject hidden/disabled/deleted/off-sale ticket types;
- reject quantities outside min/max purchase rules;
- reject mixed-currency carts;
- for limited inventory, compute sold/reserved quantity from durable paid/free-completed checkout state;
- reject oversell with HTTP 409 and an error payload the client can render.

If reservation hold support is not implemented in the first pass, free orders complete immediately and paid checkout must treat the PaymentIntent creation transaction as a short-lived reservation via `ticket_checkout_sessions.expires_at`. Expired unpaid sessions must not count as sold.

### 5.5 RLS/Security

Required policies:

- public/anon buyers cannot directly insert/update `orders`, `order_line_items`, `tickets`, checkout sessions, notification rows, or scan events;
- checkout Edge Functions use service role after validating the public event and cart contract;
- authenticated buyer can read their own order when `buyer_user_id = auth.uid()`;
- guest buyer order read must be via a signed access token or Edge Function, not a broad RLS policy on email/phone;
- brand team members can read orders/tickets for their brand using existing brand member helpers;
- finance/event-manager roles can manage refunds/cancellations only through dedicated server functions;
- scanners can validate/scan only through a server function or a tightly constrained RPC that enforces event-scanner membership.

Do not expose buyer phone numbers to scanner UI unless there is a specific operational reason. Scanner result should show buyer name and ticket tier only.

## 6. Edge Function Contract

### 6.1 `ticket-checkout-create`

Path: `supabase/functions/ticket-checkout-create/index.ts`

Auth:

- accepts anon and authenticated buyers;
- uses anon JWT if present to associate `buyer_user_id`;
- uses service role internally after validation.

Request:

```json
{
  "eventId": "uuid",
  "buyer": {
    "name": "Jane Buyer",
    "email": "jane@example.com",
    "phone": "+15551234567",
    "marketingOptIn": false
  },
  "lines": [
    { "ticketTypeId": "uuid", "quantity": 2 }
  ],
  "idempotencyKey": "client-generated-uuid"
}
```

Response for free checkout:

```json
{
  "status": "completed",
  "checkoutSessionId": "uuid",
  "orderId": "uuid",
  "tickets": [
    { "ticketId": "uuid", "qrPayload": "signed-or-public-payload" }
  ],
  "notificationStatus": "queued"
}
```

Response for paid checkout:

```json
{
  "status": "requires_payment",
  "checkoutSessionId": "uuid",
  "paymentIntentId": "pi_...",
  "clientSecret": "pi_..._secret_...",
  "publishableKey": "pk_...",
  "amountCents": 1234,
  "currency": "USD"
}
```

Server requirements:

- normalize and validate phone to E.164;
- validate buyer email server-side;
- compute all prices from `ticket_types`, never trust client prices;
- create `ticket_checkout_sessions` and session items;
- if total is zero, atomically create order/line items/tickets and queue notifications;
- if total is greater than zero, create Stripe PaymentIntent with a stable Stripe idempotency key tied to the checkout session;
- include metadata: `mingla_checkout_session_id`, `mingla_event_id`, `mingla_brand_id`;
- set `transfer_data[destination]` to the connected Stripe account;
- set `application_fee_amount` from the approved fee decision;
- set `on_behalf_of` when required by the Connect/region decision.

### 6.2 `stripe-webhook`

Extend existing `stripe-webhook` and `stripeWebhookRouter.ts`.

Add routed event types:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- optionally `charge.refunded` / `charge.refund.updated` if refunds are included in this cycle.

For `payment_intent.succeeded`:

- verify event through the existing signature path;
- use `payment_webhook_events` idempotency as the first line of defense;
- read `mingla_checkout_session_id` from PaymentIntent metadata;
- lock the checkout session row;
- if an order already exists for the session, return success;
- verify amount/currency/metadata match the session;
- create order/line items/tickets in one transaction;
- mark checkout session `paid_completed`;
- mark order `payment_status = 'paid'`, `confirmed_at = now()`, `stripe_payment_intent_status = 'succeeded'`;
- queue buyer notifications after DB commit;
- write audit where existing audit patterns allow.

For failures/cancellations:

- mark checkout session `failed`;
- store failure reason;
- do not create tickets;
- make client polling show an actionable failed-payment state.

### 6.3 `ticket-checkout-status`

Purpose: client polls after Stripe returns.

Request:

```json
{ "checkoutSessionId": "uuid" }
```

Response:

```json
{
  "status": "processing_payment | paid_completed | failed | expired",
  "orderId": "uuid-or-null",
  "tickets": [],
  "failureReason": null
}
```

Guest access must require a signed checkout access token or a server-issued opaque token, not merely a UUID if UUID leakage would expose buyer info.

### 6.4 `ticket-confirmation-dispatch`

Purpose: send or resend buyer confirmation email/message using `ticket_order_notifications`.

Invocation modes:

- internal call from free checkout completion;
- internal call from Stripe payment webhook finalization;
- authenticated organizer resend action from order detail;
- scheduled retry for retryable failures.

Rules:

- insert ledger rows before provider calls;
- claim pending rows using a status transition (`pending` -> `sending`) to avoid double sends;
- send Resend email for email row;
- send Twilio Message resource for message row using `MessagingServiceSid`;
- record provider IDs and status;
- never throw in a way that rolls back an already-completed order;
- cap retries and mark `failed_terminal` after the configured max attempts.

Do not use current `notify-dispatch` as-is for buyer ticket notifications because email-only idempotency is insufficient. Either harden `notify-dispatch` to dedupe email-only idempotency keys and preserve a buyer delivery ledger, or create this dedicated function.

### 6.5 `twilio-message-status`

Purpose: receive Twilio delivery callbacks.

Requirements:

- validate that requests are from Twilio. Use Twilio signature validation where feasible in Supabase Edge Functions;
- record every callback in `twilio_message_status_events`;
- update the matching `ticket_order_notifications` row by `provider_message_id`;
- map delivered statuses to `delivered`;
- map permanent provider failures to `failed_terminal`;
- map temporary failures to `failed_retryable` with `next_retry_at`.

### 6.6 `scan-ticket`

Purpose: server truth for ticket validation and check-in.

Request:

```json
{
  "eventId": "uuid",
  "qrPayload": "scanner-read-payload"
}
```

Response:

```json
{
  "result": "success | duplicate | wrong_event | not_found | void | cancelled_order",
  "ticketId": "uuid-or-null",
  "orderId": "uuid-or-null",
  "buyerName": "Jane Buyer",
  "ticketName": "General Admission",
  "scannedAt": "iso"
}
```

Rules:

- require authenticated scanner;
- verify event scanner permission;
- validate QR signature/hash;
- lock the ticket row;
- reject wrong event, missing, refunded, void, transferred-invalid, canceled/refunded order;
- record `scan_events`;
- ensure only one success scan per valid ticket, server-side;
- return duplicate if already used;
- update `tickets.status = 'used'`, `used_at`, `used_by_scanner_id`.

## 7. Frontend Contract

### 7.1 Buyer Flow

Replace stub behavior in:

- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/src/components/checkout/PaymentElementStub.tsx`
- `mingla-business/src/components/checkout/CartContext.tsx` where it stores final result

Required behavior:

- phone label becomes `Phone` or `Phone number`, not optional;
- validation error says phone is required and must be valid;
- submit calls `ticket-checkout-create`;
- free checkout routes to confirmation only after server response includes durable `orderId` and tickets;
- paid checkout uses Stripe React Native supported payment UI (`@stripe/stripe-react-native` PaymentSheet or equivalent established repo wrapper) with the server-created PaymentIntent client secret;
- after payment confirmation, route to an awaiting/finalizing state and poll `ticket-checkout-status`;
- confirmation renders only server tickets;
- all fake order/ticket generation is removed from production paths;
- developer/test stubs may remain only behind explicit test fixtures, not importable by production checkout.

### 7.2 Organizer Flow

Replace local store reads for server-backed events in:

- event detail metrics and activity;
- `EventListCard` sales/revenue;
- orders list;
- order detail;
- guests list;
- scanner.

Implement hooks/services such as:

- `useEventOrders(eventId)`
- `useEventOrder(orderId)`
- `useEventSalesSummary(eventId)`
- `useEventGuests(eventId)`
- `useScanTicketMutation(eventId)`
- `useResendTicketMutation(orderId)`

For transitional local-only events, legacy local store may still work, but every server-backed event must prefer Supabase/API data.

### 7.3 Buyer Notification UX

Confirmation should communicate:

- order is confirmed;
- email sent or queued;
- message sent or queued;
- resend option when a notification failed or buyer asks organizer to resend.

Do not claim "message delivered" unless Twilio status callback has confirmed delivery.

## 8. Notification Content Contract

### 8.1 Email

Subject:

`Your ticket for {event_name}`

Body must include:

- buyer name;
- event name;
- brand/organizer name;
- date/time;
- venue/address if available;
- order number;
- ticket names and quantities;
- link/deep link to ticket confirmation;
- support/resend contact copy;
- privacy-conscious footer.

QR payload can be embedded if existing email system can safely include it. Otherwise include a secure ticket-access link.

### 8.2 Message

Use concise SMS-safe copy:

`Mingla: You're confirmed for {event_name}. Order {short_order}. View tickets: {short_link}`

Rules:

- do not include sensitive buyer data;
- do not include all ticket details if it causes segmentation explosion;
- include STOP/HELP compliance copy when required by Twilio/compliance setup;
- send through `MessagingServiceSid`, not a hardcoded `From` number;
- if RCS sender is approved and in the Messaging Service, allow Twilio native RCS attempt/fallback.

## 9. Security and Compliance

Payment:

- never put Stripe secret keys or RAKs in the mobile app;
- use existing restricted-key pattern; create a dedicated payment-intent RAK if needed;
- verify Stripe signatures before processing webhooks;
- preserve existing webhook IP soft-fail/audit behavior;
- use Stripe idempotency keys for PaymentIntent creation;
- do not process client-provided amounts.

Notifications:

- do not commit or echo Twilio/Auth/Resend secrets;
- use Supabase secrets for `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, optional `TWILIO_FALLBACK_FROM`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`;
- never log full phone numbers, email addresses in avoidable logs, provider auth tokens, or message body if it contains ticket links.

Buyer privacy:

- scanner sees only what is needed to validate entry;
- organizer views can show buyer phone only to roles allowed to manage orders, not scanner-only role;
- guest buyer access to tickets uses signed/opaque tokens.

## 10. Testing Contract

Add repo-running regression tests that fail before implementation and pass after.

### 10.1 New Script

Add to `mingla-business/package.json`:

`test:orch-0777`

It must run all ORCH-0777 unit tests that do not require live provider credentials.

### 10.2 Required Test Coverage

Frontend/unit:

- buyer phone blank blocks continue;
- buyer invalid phone blocks continue;
- buyer valid E.164 phone allows submit;
- free checkout calls server mutation and does not call fake ID generation;
- paid checkout does not import/use `PaymentElementStub` in production path;
- confirmation cannot create local `useOrderStore.recordOrder` as source of truth;
- server-backed orders list renders fetched server order;
- scanner calls `scan-ticket` service instead of local order store for server-backed event.

Edge function/Deno tests:

- `ticket-checkout-create` rejects missing phone;
- rejects client price tampering;
- rejects oversell;
- free checkout creates order, line items, tickets atomically;
- duplicate idempotency key returns same order/session without duplicate tickets;
- paid checkout creates PaymentIntent with correct amount, currency, metadata, destination account, application fee;
- `payment_intent.succeeded` webhook finalizes exactly once across replayed events;
- payment failure creates no tickets;
- notification dispatch creates email/message ledger rows and dedupes retries;
- Twilio status callback updates the notification ledger;
- `scan-ticket` returns success once and duplicate on repeat.

Strict grep/regression:

- fail if production checkout imports `PaymentElementStub`;
- fail if production checkout imports `generateOrderId` or `generateTicketId`;
- fail if confirmation calls `useOrderStore.getState().recordOrder`;
- fail if buyer phone label/copy contains `optional`;
- fail if scanner server-backed path uses `useOrderStore.getState().getOrderById`.

Provider integration gates:

- Stripe CLI local webhook replay against `stripe-webhook`;
- Stripe test PaymentIntent success/failure for a connected account in test mode;
- Resend sandbox/test email dispatch with ledger proof;
- Twilio test/sandbox message dispatch with status callback proof;
- manual RCS proof only if production RCS sender is approved. Otherwise SMS fallback proof is required.

### 10.3 Minimum Commands For Implementor Report

Implementor must report actual outputs for:

```bash
cd mingla-business && npm run lint
cd mingla-business && npm run typecheck
cd mingla-business && npm run test:orch-0777
supabase functions serve ticket-checkout-create --no-verify-jwt
supabase functions serve stripe-webhook --no-verify-jwt
supabase functions serve ticket-confirmation-dispatch --no-verify-jwt
supabase functions serve scan-ticket --no-verify-jwt
git diff --check
```

If a command cannot run locally because provider credentials are unavailable, the implementor must document the exact missing secret and convert it into a tester manual gate.

## 11. Deployment Order

1. Add DB migration and local tests.
2. Add/extend shared checkout, Stripe, notification, phone, and QR helpers.
3. Add Edge Functions with local Deno tests.
4. Extend `stripe-webhook` router for payment events.
5. Add Twilio status callback function.
6. Wire buyer checkout frontend.
7. Wire server-backed organizer orders/guests/sales/scanner.
8. Add strict-grep regression gates.
9. Run local full verification.
10. Deploy migrations/functions to staging.
11. Configure Supabase secrets.
12. Configure Stripe webhook events and endpoint secret.
13. Configure Twilio Messaging Service status callback.
14. Run provider test-mode purchase: free, paid success, paid failure, duplicate webhook, resend, scan.
15. Only then mark ORCH-0777 ready for tester.

## 12. Done Criteria

ORCH-0777 is done only when all are true:

- Free checkout creates durable Supabase orders/line items/tickets.
- Paid checkout creates Stripe PaymentIntent and finalizes through webhook.
- Buyer phone is mandatory and stored normalized.
- Organizer sales/revenue/orders/guests reflect server truth after purchase.
- Scanner validates tickets against server truth and prevents duplicate use.
- Buyer receives email confirmation or a retryable failure is recorded.
- Buyer receives Twilio message confirmation or a retryable failure is recorded.
- Notifications are idempotent across checkout retries and webhook replays.
- No production checkout path uses fake ID generation, `PaymentElementStub`, or local order store as truth.
- `test:orch-0777` exists and covers the regression.
- Tester can prove free, paid, notification, and scanner flows end to end.

## 13. Non-Goals

These are not required for ORCH-0777 unless explicitly pulled in by product:

- full refund UX and refund automation beyond status compatibility;
- ticket transfer;
- waitlist promotion;
- seat maps;
- tax calculation;
- promo codes;
- full buyer account creation;
- guaranteed RCS delivery before Twilio/carrier approval.

## 14. Handoff Instruction

Send this spec to `$implementor`.

Implementor must not reinterpret the current checkout as "mostly wired." The current buyer confirmation is local-only and fake for production purposes. The implementation must make Supabase, Stripe, and provider notification ledgers the source of truth.
