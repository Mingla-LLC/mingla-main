# IMPLEMENTATION ORCH-0777 — Production Ticket Checkout, Sales, and Buyer Notifications

Status: IMPLEMENTED FOR CODE REVIEW / NOT DEPLOYED
Date: 2026-05-10

## Summary

ORCH-0777 replaces the fake checkout path with a production backend contract:

- Buyer phone is now required and validated as E.164-compatible.
- Free checkout now creates durable Supabase checkout session, order, line items, tickets, and notification ledger rows before confirmation.
- Paid checkout now creates a Stripe PaymentIntent through an Edge Function and finalizes tickets only from the verified Stripe webhook.
- Confirmation renders server-issued ticket QR payloads instead of deterministic local stub IDs.
- Buyer email and SMS confirmations are queued after the real order exists and dispatched through Resend and Twilio.
- Organizer Orders now read Supabase `orders`/`order_line_items` instead of local `orderStore`.
- Scanner now calls the `scan-ticket` Edge Function and validates server-issued tickets against Supabase.

## Files Changed

### Database

- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql`
  - Extends `orders` for online checkout metadata, phone E.164, notification status, and checkout session linkage.
  - Adds `ticket_checkout_sessions`, `ticket_checkout_session_items`, `ticket_order_notifications`, and `twilio_message_status_events`.
  - Adds server RPCs:
    - `biz_ticket_checkout_create_session`
    - `biz_ticket_checkout_finalize`
    - `biz_ticket_scan`
  - Adds RLS policies for service-role writes and brand-team reads.

### Edge Functions

- `supabase/functions/ticket-checkout-create/index.ts`
- `supabase/functions/ticket-checkout-status/index.ts`
- `supabase/functions/ticket-confirmation-dispatch/index.ts`
- `supabase/functions/twilio-message-status/index.ts`
- `supabase/functions/scan-ticket/index.ts`
- `supabase/functions/_shared/ticketCheckout.ts`
- `supabase/functions/_shared/stripe.ts`
- `supabase/functions/_shared/stripeWebhookRouter.ts`

### Business App

- `mingla-business/app/_layout.tsx`
- `mingla-business/app/checkout/[eventId]/buyer.tsx`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/app/event/[id]/orders/index.tsx`
- `mingla-business/app/event/[id]/scanner/index.tsx`
- `mingla-business/src/components/checkout/CartContext.tsx`
- `mingla-business/src/components/checkout/TicketQrCarousel.tsx`
- `mingla-business/src/services/ticketCheckoutService.ts`
- `mingla-business/src/services/eventOrdersService.ts`
- `mingla-business/src/services/scanTicketService.ts`
- `mingla-business/src/hooks/useEventOrders.ts`
- `mingla-business/src/utils/phone.ts`
- `mingla-business/src/utils/__tests__/phone.test.ts`

### Guardrail

- `.github/scripts/strict-grep/orch-0777-ticket-checkout-production.mjs`
- `mingla-business/package.json` adds `test:orch-0777`.

## User Outcomes By Flow

### Free Ticket

Buyer selects free ticket, enters name, email, and phone, then taps reserve.

Outcome:

- Backend validates phone and inventory.
- Backend writes `orders`, `order_line_items`, and `tickets`.
- Buyer lands on confirmation only after the real ticket rows exist.
- Email and SMS confirmation jobs are queued.
- Organizer Orders sees the sale from Supabase.
- Scanner can scan the ticket from another device.

### Paid Ticket

Buyer selects paid ticket, enters name, email, and phone, then pays through Stripe PaymentSheet.

Outcome:

- Backend creates checkout session and Stripe PaymentIntent.
- Stripe collects payment.
- Verified `payment_intent.succeeded` webhook finalizes the order and tickets.
- Buyer confirmation polls status and displays server-issued QR payloads.
- Email and SMS confirmation jobs are queued after ticket issuance.
- Organizer sales surfaces read the same real order rows.

### Scanner

Operator scans a QR code.

Outcome:

- App calls `scan-ticket`.
- Backend verifies scanner permission, QR token hash, event match, payment status, and ticket status.
- Successful scans mark the ticket used server-side and append `scan_events`.
- Duplicate/wrong-event/void/not-found states come from server truth.

## Verification

Passed:

- `npm run test:orch-0777`
  - strict production checkout guard passed
  - `phone.test` passed
  - `npx tsc --noEmit` passed

Checked:

- `/Users/sethogieva/bin/supabase migration list --linked`
  - local migration `20260515000013` is present locally and not yet applied remotely.

Blocked / not fully runnable here:

- `/Users/sethogieva/bin/supabase db lint --local`
  - failed because local Postgres on `127.0.0.1:54322` was not running.

Non-blocking remote lint context:

- `/Users/sethogieva/bin/supabase db lint --linked` completed, but reports pre-existing remote schema errors in older functions/views. It does not lint this new local migration because `20260515000013` is not deployed remotely yet.

## Deployment Gates

Do not ship until an operator reviews and deploys in order:

1. Apply migration `20260515000013_orch_0777_ticket_checkout_core.sql`.
2. Deploy Edge Functions:
   - `ticket-checkout-create`
   - `ticket-checkout-status`
   - `ticket-confirmation-dispatch`
   - `twilio-message-status`
   - `scan-ticket`
   - `stripe-webhook`
3. Configure Edge secrets:
   - `STRIPE_RAK_TICKET_CHECKOUT`
   - `STRIPE_RAK_WEBHOOK`
   - `RESEND_API_KEY`
   - `RESEND_TICKET_FROM`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_MESSAGING_SERVICE_SID`
   - `TWILIO_STATUS_CALLBACK_SECRET`
   - `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` or `STRIPE_PUBLISHABLE_KEY`
4. Confirm Stripe webhook endpoint includes:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
5. Run a tester pass with:
   - free checkout
   - paid checkout
   - webhook replay/idempotency
   - Resend delivery
   - Twilio delivery/status callback
   - organizer Orders
   - cross-device scanner

## Known Follow-Up

- Payment confirmation currently reads order status immediately after PaymentSheet success. In production, webhook latency may require a short polling loop or “processing” screen if Stripe delivery is delayed.
- Twilio status callback uses a shared secret query parameter. A later hardening cycle should add full Twilio signature verification.
- Organizer detail/guest/revenue surfaces should be fully migrated from local `orderStore` to Supabase-backed hooks in a dedicated follow-up pass.
