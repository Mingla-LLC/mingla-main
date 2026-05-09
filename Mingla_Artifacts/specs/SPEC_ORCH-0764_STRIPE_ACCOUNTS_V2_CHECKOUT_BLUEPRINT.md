# SPEC ORCH-0764: Stripe Accounts v2 + Checkout Blueprint

Date: 2026-05-08  
Owner mode: `$implementor` after this forensic handoff  
Source of truth: User-provided Stripe blueprint  
Status: Ready for implementation  

> **Supersession note 2026-05-08 / ORCH-0764A:** The original no-`Stripe-Version`
> contract in this spec is superseded for raw Accounts v2 HTTP calls by
> `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`.
> Raw `/v2/core/accounts` and `/v2/core/account_links` calls must send the
> helper-owned `STRIPE_BLUEPRINT_API_VERSION` header. The no-`apiVersion:` SDK
> object-literal guard remains valid for the edge-function path.

## Objective

Implement Mingla's paid ticketing money chain using the supplied Stripe blueprint:

1. Create one Stripe Accounts v2 connected account per seller/brand.
2. Generate a Stripe-hosted Accounts v2 onboarding link.
3. Persist and reuse the connected account id.
4. Create Stripe Checkout Sessions for paid buyer checkout.
5. Use destination-charge parameters with a Mingla application fee.
6. Fulfill paid orders only from verified Stripe webhooks.

Do not use chapter/step names in code, routes, functions, variables, commands, or files.

## Non-Negotiable Blueprint Constraints

- Account creation must call `POST /v2/core/accounts`.
- Account link creation must call `POST /v2/core/account_links`.
- Checkout creation must call Stripe Checkout Sessions, equivalent to `POST /v1/checkout/sessions`.
- Checkout Session request must include:
  - `mode = "payment"`
  - `line_items[].price_data.currency`
  - `line_items[].price_data.product_data.name`
  - `line_items[].price_data.unit_amount`
  - `payment_intent_data.application_fee_amount`
  - `payment_intent_data.transfer_data.destination`
- `payment_intent_data.transfer_data.destination` must use the persisted connected account id for the seller/brand.
- Webhook handling must process `checkout.session.completed`.
- Do not pin or guess a Stripe SDK `apiVersion` unless the blueprint is updated to specify one. Superseded for raw `/v2` HTTP calls: `Stripe-Version` is required and owned by `_shared/stripeBlueprintClient.ts`.
- Use environment variable placeholders for keys in docs/commands. Do not commit real keys.

## Implementation Plan

### 1. Stripe API client boundary

Create a small Stripe HTTP helper for blueprint-required raw endpoint calls.

Recommended file:

- `supabase/functions/_shared/stripeBlueprintClient.ts`

Required behavior:

- Reads secret key from function-specific restricted key first, then fallback only if deliberately configured:
  - onboarding/account calls: `STRIPE_RAK_ONBOARD`, fallback `STRIPE_SECRET_KEY`
  - checkout calls: `STRIPE_RAK_CHECKOUT`, fallback `STRIPE_SECRET_KEY`
- Sends `Authorization: Bearer ${key}`.
- Sends `Idempotency-Key` for create operations.
- Sends the helper-owned `Stripe-Version` header required for raw `/v2` calls.
- Does not initialize the Stripe SDK with `apiVersion`.
- Serializes v2 JSON payloads as JSON.
- Serializes Checkout Session payloads in a Stripe-compatible way if using raw `/v1/checkout/sessions`; alternatively the implementor may use the Stripe SDK for Checkout Sessions only, provided no `apiVersion` is supplied and tests prove the required nested params.

Acceptance tests:

- Source or unit tests fail if the ORCH-0764 account/link/checkout path imports `STRIPE_API_VERSION`.
- Source or unit tests fail if ORCH-0764 account/link/checkout path passes an SDK `apiVersion:` object literal. Raw `/v2` helper tests must assert the required `Stripe-Version` header.

### 2. Connected account creation and hosted onboarding

Refactor `supabase/functions/brand-stripe-onboard/index.ts` or split a same-domain helper without changing the public business app contract unnecessarily.

Required request to `POST /v2/core/accounts`:

```json
{
  "configuration": {
    "recipient": {
      "capabilities": {
        "stripe_balance": {
          "stripe_transfers": {
            "requested": true
          }
        }
      }
    }
  },
  "display_name": "<brand display name>",
  "contact_email": "<brand/operator email>",
  "defaults": {
    "responsibilities": {
      "losses_collector": "application",
      "fees_collector": "application"
    }
  },
  "dashboard": "express",
  "include": [
    "configuration.merchant",
    "configuration.recipient",
    "identity",
    "defaults",
    "configuration.customer"
  ],
  "identity": {
    "country": "<selected country>"
  }
}
```

Implementation notes:

- Use the existing auth, role, brand membership, country allowlist, and Mingla ToS gates from `brand-stripe-onboard`.
- Replace the hard-coded blueprint sample values with brand/operator data:
  - `display_name`: brand name.
  - `contact_email`: authenticated operator email or verified brand billing email.
  - `identity.country`: selected country from the existing country picker.
- Persist the returned account id in `stripe_connect_accounts.stripe_account_id`.
- Preserve reactivation handling for detached rows where applicable.
- Store raw v2 response details in `requirements` or a new structured metadata column only if needed for status UI.

Required request to `POST /v2/core/account_links`:

```json
{
  "account": "<connected_account_id>",
  "use_case": {
    "type": "account_onboarding",
    "account_onboarding": {
      "configurations": ["recipient", "merchant"],
      "refresh_url": "<Mingla refresh URL>",
      "return_url": "<Mingla return URL>"
    }
  }
}
```

Return contract:

- Return the connected account id.
- Return the Stripe-hosted account link URL as `onboarding_url`.
- Keep `client_secret` nullable/absent for the hosted-link path.

Business app changes:

- `BrandOnboardView` should open the returned Stripe-hosted `onboarding_url`.
- `connect-onboarding.tsx` embedded onboarding should not be used by ORCH-0764. It can remain only if clearly isolated as legacy/future optional code.

### 3. Account status webhook support

Extend the Stripe webhook router to recognize the blueprint event:

- `v2.core.account[configuration.recipient].capability_status_updated`

Required behavior:

- Verify signature through the existing `stripe-webhook` entrypoint.
- Idempotently store the event in `payment_webhook_events`.
- Update the associated `stripe_connect_accounts` row when the event proves recipient/transfer capability readiness.
- Continue supporting existing account/payout/application-fee events.

If Stripe sends a thin event that requires retrieval:

- Retrieve the account/status server-side with an unpinned request.
- Do not trust client-provided status.

### 4. Checkout Session creation

Add a server-only Supabase Edge Function.

Recommended function name:

- `supabase/functions/ticket-checkout-create/index.ts`

Request body:

```json
{
  "event_id": "uuid",
  "buyer": {
    "name": "string",
    "email": "string",
    "phone": "string optional"
  },
  "lines": [
    {
      "ticket_type_id": "uuid",
      "quantity": 1
    }
  ],
  "success_url": "https://...",
  "cancel_url": "https://..."
}
```

Required server behavior:

- Validate event is public/published and eligible for online paid checkout.
- Validate ticket types belong to the event, are active/saleable, and share one currency.
- Validate requested quantities are positive and within capacity.
- Resolve the event's brand.
- Load the brand's `stripe_connect_accounts` row.
- Require a non-detached connected account that is ready to receive transfers.
- Calculate totals from server-side `ticket_types.price_cents`; never trust client totals.
- Calculate `application_fee_amount` from server-side config.
- Create a pending `orders` row and `order_line_items` rows through service-role DB code or an RPC.
- Create a Stripe Checkout Session.
- Persist `stripe_checkout_session_id` and destination/account metadata back onto the order.
- Return `{ checkout_session_id, checkout_url, order_id }`.

Required Stripe Checkout Session params:

```json
{
  "success_url": "<success_url>",
  "cancel_url": "<cancel_url>",
  "mode": "payment",
  "line_items": [
    {
      "price_data": {
        "currency": "<lowercase currency>",
        "product_data": {
          "name": "<ticket/event display name>"
        },
        "unit_amount": 100000
      },
      "quantity": 1
    }
  ],
  "payment_intent_data": {
    "application_fee_amount": 123,
    "transfer_data": {
      "destination": "<stripe_connected_account_id>"
    }
  },
  "metadata": {
    "mingla_order_id": "<order uuid>",
    "mingla_event_id": "<event uuid>",
    "mingla_brand_id": "<brand uuid>"
  }
}
```

Notes:

- Replace `100000` and `123` with server-calculated values.
- Currency must be lower-case when sent to Stripe.
- `application_fee_amount` must be integer minor units.
- Do not create tickets before payment completion.

### 5. Application fee configuration

Add server-side config parsing for the application fee.

Recommended env vars:

- `MINGLA_STRIPE_APPLICATION_FEE_FIXED_CENTS`
- `MINGLA_STRIPE_APPLICATION_FEE_BPS`

Rules:

- Fee amount = fixed cents + floor(order total cents * bps / 10000).
- Fee must be >= 0.
- Fee must be <= order total.
- Paid checkout must reject if required fee config is absent or invalid in paid-checkout-enabled environments.
- Do not hard-code the blueprint sample value `123` as Mingla's fee policy.

Live-mode product decision:

- Product/leadership must select live fee policy before live GMV. Engineering can proceed with test/staging config.

### 6. Webhook fulfillment

Extend `supabase/functions/_shared/stripeWebhookRouter.ts` to route:

- `checkout.session.completed`
- Recommended: `checkout.session.expired`
- Recommended: `payment_intent.payment_failed`

Required `checkout.session.completed` behavior:

- Read `session.id`, `session.payment_status`, `session.payment_intent`, and `session.metadata.mingla_order_id`.
- Accept only paid sessions for fulfillment.
- Locate the order by `stripe_checkout_session_id` or metadata order id.
- Verify the order is still pending and the session id matches.
- Verify totals/currency when available.
- Update order:
  - `payment_status = "paid"`
  - `stripe_payment_intent_id`
  - `stripe_charge_id` if available from expanded/retrieved PaymentIntent/Charge
  - `stripe_application_fee_amount_cents`
  - `paid_at` if a column is added, or equivalent metadata if not
- Insert one durable `tickets` row per purchased ticket quantity.
- Generate unique QR payloads server-side.
- Be idempotent: replaying the same webhook must not create duplicate tickets.

Required `checkout.session.expired` behavior:

- Mark still-pending order as `expired` or `failed`.
- Do not issue tickets.

### 7. Database migration

Create a migration with a filename greater than:

- `20260515000004_orch_0763_event_system_regression_repair.sql`

Recommended migration:

- `20260516000001_orch_0764_stripe_checkout_blueprint.sql`

Required schema changes:

- Add to `orders`:
  - `stripe_checkout_session_id text`
  - `stripe_connected_account_id text`
  - `stripe_application_fee_amount_cents integer`
  - `stripe_application_fee_id text`
  - `stripe_checkout_expires_at timestamptz`
  - `paid_at timestamptz`
- Add unique index on `orders.stripe_checkout_session_id` where not null.
- Add index on `orders.stripe_payment_intent_id` where not null.
- Extend `orders.payment_status` check to include `expired` if using that state.
- Add check that application fee amount is non-negative and not greater than `total_cents` when both are known.

Recommended RPCs:

- `business_create_checkout_order(...)`
- `business_finalize_checkout_order(...)`
- `business_expire_checkout_order(...)`

RPC requirements:

- Run with service-role or `SECURITY DEFINER` following existing repo policy style.
- Lock relevant order/ticket rows during finalization.
- Re-check capacity before issuing tickets.
- Return structured errors suitable for Edge Function responses.
- Preserve existing RLS posture: anon clients must not write orders/tickets directly.

### 8. Buyer checkout UI

Replace paid checkout stub behavior for online paid tickets.

Required behavior:

- Paid checkout calls `ticket-checkout-create`.
- Open returned `checkout_url` using the existing web/mobile browser pattern.
- Confirmation screen should verify/reload the server order state by order id/session id instead of trusting local payment success.
- Free checkout can remain separate, but must not pretend to be Stripe-paid.
- Door payment methods must remain out of the online Stripe Checkout path unless a later spec covers them.

Remove or isolate:

- Do not use `runCardPaymentStub` for paid online tickets.
- Do not write paid Stripe orders only to Zustand.

### 9. Tests and gates

Add/extend tests:

- Deno test for account onboarding:
  - asserts `POST /v2/core/accounts` payload includes required blueprint fields.
  - asserts `POST /v2/core/account_links` payload includes account id, configurations, refresh URL, and return URL.
  - asserts no SDK `apiVersion:` object literal in the ORCH-0764A edge-function path and asserts the required raw `/v2` `Stripe-Version` header in the helper.
- Deno test for checkout creation:
  - asserts Stripe Checkout Session params include `mode`, `line_items`, `payment_intent_data.application_fee_amount`, and `payment_intent_data.transfer_data.destination`.
  - asserts server-side totals come from DB fixtures, not client body.
  - asserts missing connected account blocks paid checkout.
- Deno test for webhook router:
  - includes `checkout.session.completed` in routed events.
  - finalizes pending order.
  - creates durable tickets.
  - replay does not create duplicate tickets.
  - expired session does not create tickets.
- Business app tests:
  - paid checkout no longer calls `PaymentElementStub`.
  - paid checkout invokes server function and opens `checkout_url`.
  - confirmation reads server order state.

Recommended commands:

```bash
cd supabase/functions
deno test --allow-env --allow-net --allow-read --allow-write
```

```bash
cd mingla-business
npm run test:orch-0764
```

Add `test:orch-0764` to `mingla-business/package.json`.

### 10. Runbooks and secrets

Update runbooks:

- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`

Required secret placeholders:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_RAK_ONBOARD=rk_test_...
STRIPE_RAK_CHECKOUT=rk_test_...
STRIPE_RAK_WEBHOOK=rk_test_...
MINGLA_STRIPE_APPLICATION_FEE_FIXED_CENTS=...
MINGLA_STRIPE_APPLICATION_FEE_BPS=...
```

Instructions:

- Obtain keys from the Stripe Dashboard.
- Prefer restricted API keys for deployed functions.
- Never commit real keys.
- Stripe Dashboard webhook endpoint must subscribe at minimum to:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `application_fee.created`
  - `application_fee.refunded`
  - relevant Accounts v2 capability/account events

## Acceptance Criteria

Implementation is complete only when:

- A brand onboarding call creates or reuses a persisted Accounts v2 connected account.
- A brand onboarding call returns a Stripe-hosted Account Link URL.
- No ORCH-0764 Stripe call pins or guesses an SDK `apiVersion`; raw `/v2` calls send the approved helper-owned `Stripe-Version` contract.
- Paid buyer checkout creates a server order and Stripe Checkout Session.
- Checkout Session includes `application_fee_amount` and `transfer_data.destination`.
- `checkout.session.completed` marks the order paid and creates durable tickets.
- Webhook replay is idempotent.
- Guest clients cannot write orders/tickets directly.
- Tests pass for Supabase functions and business app checkout.
- Runbooks document required Stripe Dashboard setup and env placeholders.

## Explicit Out of Scope

- Subscriptions.
- Door-sale payment capture.
- Refund automation beyond preserving existing revenue-log hooks.
- Stripe Tax.
- Embedded onboarding replacement polish beyond isolating it from the hosted Account Link flow.
- Live application fee business policy selection.
