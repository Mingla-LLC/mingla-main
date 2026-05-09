# INVESTIGATION ORCH-0764: Stripe Accounts v2 + Checkout Blueprint

Date: 2026-05-08  
Mode: `$forensics`  
Verdict: SPEC READY, WITH ONE PRICING CONFIGURATION DECISION REQUIRED BEFORE LIVE MODE  

## Executive Summary

The supplied Stripe blueprint is not implemented in Mingla today.

Mingla has a substantial Stripe Connect foundation, but it is the earlier embedded onboarding path: v1-style account creation through the Stripe SDK, Account Sessions for embedded onboarding, a pinned Stripe API version, and webhook handling focused on Connect account/payout/revenue events. The buyer checkout path remains a local/stub payment experience that writes orders to client-side Zustand persistence rather than creating Stripe Checkout Sessions, durable server orders, or tickets through webhook fulfillment.

The implementation path is feasible because the repo already has:

- `stripe_connect_accounts` persistence keyed to brands.
- service-role Supabase Edge Functions for Stripe-sensitive operations.
- webhook signature verification and an idempotent `payment_webhook_events` inbox.
- durable `orders`, `order_line_items`, `tickets`, `ticket_types`, and `mingla_revenue_log` tables.
- a current event/ticket server authority layer repaired in ORCH-0763.

The required work is a controlled replacement/extension of the existing payment chain, not a greenfield integration.

## Blueprint Requirements Checked

Authoritative operations from the user blueprint:

- Create connected seller account with `POST /v2/core/accounts`.
- Create hosted onboarding link with `POST /v2/core/account_links`.
- Wait for `v2.core.account[configuration.recipient].capability_status_updated`.
- Create Checkout Session with `POST /v1/checkout/sessions`.
- Include `payment_intent_data.application_fee_amount`.
- Include `payment_intent_data.transfer_data.destination` using the connected account id created earlier.
- Handle `checkout.session.completed`.
- Do not pin or guess a Stripe API version unless the blueprint specifies one.
- Persist and reuse Stripe resource identifiers.

## Official Stripe References Used

- Accounts v2 overview: https://docs.stripe.com/connect/accounts-v2
- Accounts v2 Account Links API: https://docs.stripe.com/api/v2/core/account-links/create?api-version=preview
- Accounts v2 create account API: https://docs.stripe.com/api/v2/core/accounts/create?api-version=development
- Checkout Session create API: https://docs.stripe.com/api/checkout/sessions/create
- Destination charges with Checkout: https://docs.stripe.com/connect/destination-charges?platform=react-native
- Webhook signature verification: https://docs.stripe.com/webhooks?lang=node

Notes:

- Stripe's v2 Account Links reference documents `POST /v2/core/account_links` with `account` and `use_case.account_onboarding` including `configurations`, `refresh_url`, and `return_url`.
- Stripe's Checkout Session reference documents `payment_intent_data.application_fee_amount` and `payment_intent_data.transfer_data.destination` for Connect payment-mode sessions.
- Stripe's webhook docs require signature verification using the raw payload and endpoint secret.

## Findings

### F1. Current seller onboarding does not call the blueprint Accounts v2 API

Evidence:

- `supabase/functions/brand-stripe-onboard/index.ts` claims in its header that it creates Stripe v2 `/v2/core/accounts`.
- The implementation actually calls `stripe.accounts.create(...)`, then passes v1/controller-style fields including `controller`, `capabilities.card_payments`, and `capabilities.transfers`.
- The implementation persists `stripe_account_id` into `stripe_connect_accounts`, which is useful, but the create request does not match the blueprint's `POST /v2/core/accounts` payload.

Blueprint gap:

- Missing `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested = true`.
- Missing `defaults.responsibilities.losses_collector = "application"`.
- Missing `defaults.responsibilities.fees_collector = "application"`.
- Missing `dashboard = "express"`.
- Missing `include = ["configuration.merchant", "configuration.recipient", "identity", "defaults", "configuration.customer"]`.
- Missing `identity.country` as the v2 field.

Root cause:

- The current implementation predates this blueprint and uses the prior embedded onboarding/SDK route.

### F2. Current onboarding uses Account Sessions, not the blueprint Account Links flow

Evidence:

- `supabase/functions/brand-stripe-onboard/index.ts` calls `stripe.accountSessions.create(...)`.
- `mingla-business/app/connect-onboarding.tsx` renders Stripe embedded onboarding through `@stripe/react-connect-js` and `@stripe/connect-js`.
- `mingla-business/src/components/brand/BrandOnboardView.tsx` opens Mingla's `/connect-onboarding` web surface.

Blueprint gap:

- No code path creates `POST /v2/core/account_links`.
- No code path returns a Stripe-hosted onboarding URL created by the Accounts v2 Account Links API.
- No current refresh/return URL regeneration contract exists for Account Link expiry.

Decision:

- The blueprint requires hosted Account Links. Keep embedded onboarding code only if product explicitly wants it as a separate future option; do not use it as the ORCH-0764 implementation path.

### F3. Current buyer checkout is a local stub, not Stripe Checkout

Evidence:

- `mingla-business/app/checkout/[eventId]/payment.tsx` imports and renders `PaymentElementStub`.
- The paid path creates local `ord_*` and `tkt_*` ids in memory and routes to confirmation.
- `mingla-business/app/checkout/[eventId]/confirm.tsx` writes the order to `useOrderStore.getState().recordOrder(order)`.
- `mingla-business/src/store/orderStore.ts` explicitly documents the store as transitional client-side persistence pending Supabase orders.

Blueprint gap:

- No server-side Checkout Session creation exists.
- No request currently sends `payment_intent_data.application_fee_amount`.
- No request currently sends `payment_intent_data.transfer_data.destination`.
- No durable server order is created before payment.
- No durable ticket issuance occurs after payment.

Business impact:

- The money chain is still not real GMV. This matches product docs stating that checkout/payout is a launch blocker for paid ticketing.

### F4. Webhook infrastructure exists, but checkout fulfillment is missing

Evidence:

- `supabase/functions/stripe-webhook/index.ts` verifies signatures, stores Stripe events in `payment_webhook_events`, and routes events idempotently.
- `supabase/functions/_shared/stripeWebhookRouter.ts` handles Connect account, payout, refund, person, and application fee events.
- `STRIPE_ROUTED_EVENT_TYPES` does not include `checkout.session.completed`.

Blueprint gap:

- No handler for `checkout.session.completed`.
- No order finalization from Stripe payment state.
- No ticket creation from a completed checkout session.
- No idempotent replay protection at the fulfillment level beyond the generic event inbox.

### F5. The shared Stripe client currently violates the operator API-version instruction for this blueprint

Evidence:

- `supabase/functions/_shared/stripe.ts` exports `STRIPE_API_VERSION = "2026-04-22.dahlia"`.
- The shared Stripe client passes `{ apiVersion: STRIPE_API_VERSION }`.
- Several function calls pass request-level `{ apiVersion: STRIPE_API_VERSION }`.
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md` still references `STRIPE_API_VERSION`.

Blueprint/operator conflict:

- The user explicitly instructed: do not guess the required Stripe API version; leave the API version argument empty unless the blueprint specifies otherwise.
- The blueprint does not specify a required API version.

Required correction:

- ORCH-0764 implementation must not initialize new Stripe calls with a guessed API version or send a guessed `Stripe-Version` header.
- Existing pinned-version usage should be removed or isolated so the new blueprint path cannot accidentally inherit it.

### F6. Durable schema is close but needs explicit Stripe Checkout identifiers and fulfillment state

Evidence:

- `orders` already includes `stripe_payment_intent_id`, `stripe_charge_id`, `total_cents`, `currency`, `payment_method`, and `payment_status`.
- `order_line_items` and `tickets` already support server-side ticket issuance.
- `mingla_revenue_log` already tracks application fees by `stripe_application_fee_id`.

Gaps:

- `orders` lacks `stripe_checkout_session_id`.
- `orders` lacks connected account / destination account audit fields.
- `orders` lacks application fee amount/id fields.
- Current order/ticket RLS is authenticated business-team oriented, so guest checkout must be mediated by service-role Edge Functions/RPCs, not anon direct writes.

### F7. Application fee calculation is the only live-mode business decision still required

The blueprint hard-codes an example `application_fee_amount: 123`, but Mingla must not ship a hard-coded platform fee. The implementation can be unblocked by making the value environment/config driven for test mode, but leadership/product must decide the live fee policy before live GMV.

Recommended engineering assumption:

- Implement `application_fee_amount` as a calculated integer in minor currency units.
- Source the calculation from explicit server-side configuration, for example fixed cents plus basis points.
- Reject paid Checkout Session creation if the configured value is missing/invalid in environments where paid checkout is enabled.

## Current Files Most Affected

- `supabase/functions/_shared/stripe.ts`
- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/functions/_shared/stripeWebhookRouter.ts`
- `supabase/functions/stripe-webhook/index.ts`
- new Supabase function for server-side Checkout Session creation
- new Supabase migration after `20260515000004_orch_0763_event_system_regression_repair.sql`
- `mingla-business/app/checkout/[eventId]/payment.tsx`
- `mingla-business/app/checkout/[eventId]/confirm.tsx`
- `mingla-business/src/components/checkout/PaymentElementStub.tsx`
- `mingla-business/src/store/orderStore.ts`
- Stripe runbooks under `docs/runbooks/`

## Risks

| Risk | Severity | Notes |
|---|---:|---|
| Accounts v2 access not enabled on Stripe platform | High | Stripe Account Links v2 API can return an access-blocked error. Implementation must surface this cleanly. |
| API-version drift | High | Current repo pins a version; blueprint says do not. Tests should explicitly guard this. |
| Duplicate ticket issuance on webhook retry | High | Fulfillment must be idempotent by `stripe_checkout_session_id` and order status. |
| Overselling ticket types | High | Checkout creation/finalization must lock or re-check capacity server-side. |
| Platform fee misconfiguration | Medium | Paid checkout should fail closed if fee config is invalid. |
| Account capability mismatch | Medium | Checkout must require a connected account that is onboarded/eligible to receive transfers. |
| Mobile redirect fragility | Medium | Checkout success/cancel URLs must work across Expo web/mobile surfaces. |

## Recommended Next Step

Proceed to implementation using the companion spec:

- `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`

