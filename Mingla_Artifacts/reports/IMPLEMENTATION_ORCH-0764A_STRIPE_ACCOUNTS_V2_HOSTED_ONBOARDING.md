# IMPLEMENTATION ORCH-0764A: Stripe Accounts v2 Hosted Onboarding

Date: 2026-05-08  
Implementor: Codex `$implementor`  
Status: implemented, partially verified  

## Scope Implemented

Implemented the ORCH-0764A onboarding slice only:

- Accounts v2 account creation.
- Accounts v2 hosted Account Link creation.
- Existing brand auth/role/ToS/country gates preserved.
- Existing `stripe_connect_accounts` persistence preserved.
- Business app result type updated for hosted onboarding.
- Focused tests and Stripe runbook updates added.

Out of scope and not implemented:

- Buyer Checkout Sessions.
- Order/ticket migrations.
- `checkout.session.completed` fulfillment.
- Paid checkout UI replacement.
- Live Mingla application fee policy.

## Files Changed

- `supabase/functions/_shared/stripeBlueprintClient.ts`
- `supabase/functions/_shared/idempotency.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
- `supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts`
- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/functions/brand-stripe-onboard/index.test.ts`
- `mingla-business/src/services/brandStripeService.ts`
- `mingla-business/src/utils/__tests__/onboardReactivation.test.ts`
- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`

## Old-To-New Receipts

Before:

- `brand-stripe-onboard` imported `stripeOnboard` and `STRIPE_API_VERSION`.
- It called `stripe.accounts.create(...)`.
- It called `stripe.accountSessions.create(...)`.
- It returned a Mingla-hosted embedded onboarding URL with a `client_secret`.

After:

- `brand-stripe-onboard` imports `createRecipientAccount` and `createRecipientAccountLink`.
- It calls raw `POST /v2/core/accounts` through `_shared/stripeBlueprintClient.ts`.
- It calls raw `POST /v2/core/account_links` through `_shared/stripeBlueprintClient.ts`.
- It returns the Stripe-hosted Account Link URL as `onboarding_url`.
- It returns `client_secret: null` for backward-compatible response shape; ORCH-0764 hosted onboarding does not require embedded Connect client secrets.

## Stripe API Operations Implemented

`POST /v2/core/accounts`

- `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested = true`
- `display_name` from brand name, falling back to `"Mingla organiser"`
- `contact_email` from brand contact email, then auth user email, then `support@usemingla.com`
- `defaults.responsibilities.losses_collector = "application"`
- `defaults.responsibilities.fees_collector = "application"`
- `dashboard = "express"`
- `include = ["configuration.merchant", "configuration.recipient", "identity", "defaults", "configuration.customer"]`
- `identity.country` from the existing validated country picker/body

`POST /v2/core/account_links`

- `account` from persisted/reused `stripe_connect_accounts.stripe_account_id`
- `use_case.type = "account_onboarding"`
- `use_case.account_onboarding.configurations = ["recipient", "merchant"]`
- `return_url` from the existing validated app/web return URL
- `refresh_url` from the return URL plus `stripe_onboarding_refresh=1`

## API Version Handling

ORCH-0764A does not initialize a Stripe SDK client and does not pass an API version.

`_shared/stripeBlueprintClient.ts`:

- uses raw `fetch`
- sets `Authorization`
- sets `Content-Type`
- sets `Idempotency-Key`
- does not set `Stripe-Version`
- reads `STRIPE_RAK_ONBOARD`, falling back to `STRIPE_SECRET_KEY` only as a deliberate local/staging fallback

Existing legacy SDK clients in `_shared/stripe.ts` remain unchanged for non-ORCH-0764 functions.

## Verification

Passed:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts _shared/__tests__/stripeWebhookRouter.test.ts
```

Result:

- 6 passed
- 0 failed

Passed:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts _shared/stripeWebhookRouter.ts
```

Result:

- check passed

Passed:

```bash
cd mingla-business
npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand
```

Result:

- 2 suites passed
- 15 tests passed

Attempted but blocked by pre-existing unrelated suite errors:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write
```

Result:

- failed during type-check before running tests
- unrelated failures in:
  - `_shared/__tests__/bouncer.test.ts`
  - `_shared/__tests__/scorer.test.ts`
  - `get-person-hero-cards/mapper.test.ts`

These failures were not introduced by ORCH-0764A and are outside this implementation scope.

## Notes And Residual Risks

- Hosted onboarding now returns the Stripe Account Link directly. `BrandOnboardView` already opens `result.onboarding_url`, so no component-level behavior change was required.
- `connect-onboarding.tsx` remains in the app as legacy embedded onboarding surface, but ORCH-0764A no longer depends on it.
- `v2.core.account[configuration.recipient].capability_status_updated` was not fully implemented in this slice because the current webhook status system still uses v1 account/capability refresh paths. This must remain tracked before ORCH-0764 close or be handled in ORCH-0764B/review rework.
- No live Stripe or Supabase mutation was performed.
- No Supabase migration was added.
- No edge function deploy was performed.

## Operator Setup Required

Before deployed runtime testing:

- Configure `STRIPE_RAK_ONBOARD` with permissions for Accounts v2 account creation and Account Links.
- Keep `STRIPE_SECRET_KEY` only as non-production fallback until every Stripe path has a scoped RAK.
- Confirm the Stripe platform has access to Accounts v2 and `/v2/core/account_links`.
- Deploy `brand-stripe-onboard` only after orchestrator review/tester gate authorizes deploy.

## ORCH-0764B Readiness

ORCH-0764B can start after orchestrator review accepts this implementation, with one caveat:

- Account readiness/capability status from Accounts v2 still needs explicit review. Checkout creation must not assume a connected account can receive transfers unless status is proven from webhook/refresh state.

