# Implementation Report: ORCH-0764C Stripe Country Change Before Completion

> Date: 2026-05-09  
> Implementor: Codex `$implementor`  
> Source prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0764C_STRIPE_COUNTRY_CHANGE_BEFORE_COMPLETION.md`  
> Spec: `Mingla_Artifacts/specs/SPEC_AMENDMENT_ORCH-0764C_STRIPE_COUNTRY_CHANGE_BEFORE_COMPLETION.md`  
> Status: implemented, verified locally; not deployed

## Summary

Implemented the amended Option B contract:

- A fresh Stripe setup still uses the selected country.
- Existing same-country accounts are reused/reactivated.
- Existing incomplete/no-money accounts with a different requested country are replacement-eligible.
- Completed or money-risky accounts return typed `409 country_locked` and do not create a replacement.
- Stripe account creation/link idempotency now includes country/account context so a prior `GB` create cannot replay for a `US` request.
- Payments now renders a green/check `You're connected to Stripe` banner for active status.
- The country/currency locked UI tells organisers to create a new brand for a different country/currency.
- Status/detail/list cache invalidation now includes brand detail and brand lists.

## Files Changed

### Supabase / Stripe

- `supabase/functions/brand-stripe-onboard/index.ts`
  - Added existing-account country comparison.
  - Added fresh Stripe account retrieval before replacement.
  - Added local money movement checks across `payouts`, `mingla_revenue_log`, and `orders` for the brand's events.
  - Added fail-closed Stripe delete before replacement.
  - Added typed `country_locked` responses.
  - Added audit events:
    - `stripe_connect.country_change_replaced_before_completion`
    - `stripe_connect.country_change_locked`
  - Added country/account-aware idempotency for account creation and Account Link creation.

- `supabase/functions/brand-stripe-refresh-status/index.ts`
  - Widened response with `stripe_account_id`, `country`, `default_currency`, and `details_submitted`.

- `supabase/functions/_shared/idempotency.ts`
  - Allows scoped string operations so ORCH-0764C can include country/account replacement context.

- `supabase/functions/_shared/stripeCountryReplacement.ts`
  - New pure helper for replacement lock decisions and idempotency operation strings.

- `supabase/functions/_shared/__tests__/stripeCountryReplacement.test.ts`
  - New Deno tests for incomplete replacement eligibility, lock reasons, and idempotency context.

- `supabase/functions/brand-stripe-onboard/index.test.ts`
  - Added source guard for replacement branch, lock response, audit actions, and idempotency helper use.

### Mingla Business

- `mingla-business/src/services/brandStripeService.ts`
  - Added widened refresh response fields.
  - Added `BrandStripeCountryLockedError` mapping for `country_locked`.

- `mingla-business/src/hooks/useStartBrandStripeOnboarding.ts`
  - On success, invalidates Stripe status, brand detail, and all brand lists.

- `mingla-business/src/hooks/useBrandStripeStatus.ts`
  - Realtime invalidation now invalidates brand detail and all brand lists.

- `mingla-business/src/utils/brandStripeUiState.ts`
  - New pure helper for country picker lock state, required locked/replacement copy, and active banner title.

- `mingla-business/src/utils/__tests__/brandStripeUiState.test.ts`
  - New tests for editable incomplete state, locked active/completed state, copy, and active banner title.

- `mingla-business/src/utils/__tests__/onboardReactivation.test.ts`
  - Added `country_locked` service mapping test.

- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
  - Active status now renders green/check `You're connected to Stripe`.
  - Active status has no CTA and no verifying copy.

- `mingla-business/src/components/brand/BrandOnboardView.tsx`
  - Country picker initializes from live Stripe country when present.
  - Country picker stays editable before completion and shows replacement copy when changed.
  - Completed/money-risky country state locks picker and shows create-new-brand copy.
  - `country_locked` errors render as `Stripe is already connected`, not as generic verification failure.

- `mingla-business/src/components/brand/BrandStripeCountryPicker.tsx`
  - Added optional helper/warning text and disabled locked state support.

- `mingla-business/app/brand/[id]/payments/index.tsx`
- `mingla-business/app/brand/[id]/payments/onboard.tsx`
  - Routes now resolve brand detail through React Query rather than depending on the stale list cache.

## Verification

Passed:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-read \
  supabase/functions/_shared/__tests__/stripeCountryReplacement.test.ts \
  supabase/functions/brand-stripe-onboard/index.test.ts
```

Result: 6 passed, 0 failed.

```bash
/Users/sethogieva/.deno/bin/deno check \
  supabase/functions/brand-stripe-onboard/index.ts \
  supabase/functions/brand-stripe-refresh-status/index.ts \
  supabase/functions/_shared/stripeCountryReplacement.ts
```

Result: pass.

```bash
npx jest \
  src/utils/__tests__/stripeOnboardingOutcome.test.ts \
  src/utils/__tests__/brandStripeUiState.test.ts \
  src/utils/__tests__/onboardReactivation.test.ts
```

Result: 3 suites passed, 14 tests passed. Jest emitted a Watchman recrawl warning only.

```bash
npx tsc --noEmit
```

Result: pass.

```bash
npx eslint \
  'app/brand/[id]/payments/index.tsx' \
  'app/brand/[id]/payments/onboard.tsx' \
  src/components/brand/BrandPaymentsView.tsx \
  src/components/brand/BrandOnboardView.tsx \
  src/components/brand/BrandStripeCountryPicker.tsx \
  src/services/brandStripeService.ts \
  src/hooks/useBrandStripeStatus.ts \
  src/hooks/useStartBrandStripeOnboarding.ts \
  src/utils/brandStripeUiState.ts \
  src/utils/__tests__/brandStripeUiState.test.ts \
  src/utils/__tests__/onboardReactivation.test.ts
```

Result: pass.

```bash
git diff --check
```

Result: pass.

## Deploy / Migration

- DB migration: none.
- Edge functions to deploy after review:
  - `brand-stripe-onboard`
  - `brand-stripe-refresh-status`
- Business app/web deploy: required for Payments/onboarding UI/cache updates.
- No Supabase `db push` was run.
- No Stripe Dashboard mutation was performed.

## Notes / Residual Risk

- The implementation uses the spec's preferred minimal single-row `stripe_connect_accounts` path. Old account identity is preserved in `audit_log`; no multi-row account-history migration was added.
- Replacement fails closed if Stripe account retrieval, local money checks, or Stripe account deletion fail.
- `requirements.disabled_reason = "requirements.past_due"` alone does not lock country.
- Runtime tester still needs to verify:
  - incomplete UK setup can be changed to US and Stripe shows US,
  - active/completed setup refuses country change with create-new-brand copy,
  - active Payments shows `You're connected to Stripe`,
  - Payments no longer shows stale verifying after active.

## Supersession

The old prompt `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0764C_STRIPE_COUNTRY_AND_ACTIVE_STATUS_SYNC.md` remains superseded. This implementation follows `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0764C_STRIPE_COUNTRY_CHANGE_BEFORE_COMPLETION.md`.
