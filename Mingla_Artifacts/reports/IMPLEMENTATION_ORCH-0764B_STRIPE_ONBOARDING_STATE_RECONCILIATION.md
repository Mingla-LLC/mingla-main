# IMPLEMENTATION ORCH-0764B — Stripe Onboarding State Reconciliation

## Verdict

Implemented. Runtime deployment is intentionally gated pending `supabase db push` because this change adds a migration.

## Files Changed

- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
- `mingla-business/src/components/brand/BrandOnboardView.tsx`
- `mingla-business/src/utils/stripeOnboardingOutcome.ts`
- `mingla-business/src/utils/stripeStatusSettlement.ts`
- `mingla-business/src/utils/__tests__/stripeOnboardingOutcome.test.ts`
- `mingla-business/src/utils/__tests__/stripeStatusSettlement.test.ts`
- `supabase/migrations/20260515000007_orch_0764b_stripe_status_derivation_parity.sql`

## Behavior Before

- Payments could show cached `onboarding` in the main banner while live Stripe requirements showed restricted/past-due remediation below it.
- Restricted remediation opened bare `https://connect.stripe.com/express_login`.
- Returning from Stripe with actionable requirements could show terminal copy: `Stripe couldn't verify`.
- Browser return did one immediate refresh, so Stripe propagation lag could produce a false terminal/expired state.
- SQL derived `active` before checking `requirements.disabled_reason`, while TS already treated disabled requirements as `restricted`.

## Behavior After

- Payments now uses one effective status: live `useBrandStripeStatus().data.status` first, cached `brand.stripeStatus` only as fallback.
- Restricted, deadline, KYC remediation, and bank-section remediation CTAs route to Mingla onboarding shell, which creates a fresh Stripe Account Link via `brand-stripe-onboard`.
- Actionable restricted states map to `More information needed` with `Continue verification`.
- Terminal Stripe rejection reasons still map to failure/contact support.
- Browser return/dismiss invalidates and settles Stripe status with bounded polling: up to 15 attempts, 2 seconds apart.
- SQL helper now matches TS/product order: `detached -> restricted -> active -> onboarding`.

## Migration

Added:

- `supabase/migrations/20260515000007_orch_0764b_stripe_status_derivation_parity.sql`

Note: remote and local migration heads were already at `20260515000006`, so this implementation correctly used `20260515000007` rather than the older example prefix in the prompt.

## Verification

Passed:

```bash
cd mingla-business
npx tsc --noEmit --pretty false
```

Passed:

```bash
cd mingla-business
npx jest deriveBrandStripeStatus.test stripeOnboardingOutcome.test stripeStatusSettlement.test onboardReactivation.test --runInBand
```

Result:

```text
Test Suites: 4 passed, 4 total
Tests: 23 passed, 23 total
```

Passed:

```bash
cd mingla-business
npx eslint src/components/brand/BrandPaymentsView.tsx src/components/brand/BrandOnboardView.tsx src/utils/stripeOnboardingOutcome.ts src/utils/stripeStatusSettlement.ts src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts --max-warnings=0
```

Passed:

```bash
cd supabase/functions
~/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Result:

```text
ok | 6 passed | 0 failed
```

Passed:

```bash
cd supabase/functions
~/.deno/bin/deno check brand-stripe-onboard/index.ts brand-stripe-refresh-status/index.ts _shared/stripeBlueprintClient.ts
```

Passed:

```bash
cd mingla-business
npx expo export -p web
```

Evidence: export listed `/stripe-onboarding-return` as a static route.

Also passed:

```bash
git diff --check
```

## Known Gate

Full repo lint is not clean because of pre-existing unrelated lint errors across styleguide, account deletion, event creation, notifications, and other screens. The files touched for ORCH-0764B lint clean directly.

## Deployment Status

- Edge functions were not deployed.
- Database was not pushed.
- Required next operator step: run `supabase db push` for `20260515000007_orch_0764b_stripe_status_derivation_parity.sql`.
- After DB push succeeds, deploy/redeploy the relevant Supabase functions only if needed by the release train.
- Business web route `/stripe-onboarding-return` exists in the Expo export, but production Vercel deployment remains an external deploy gate.

## Tester QA Instructions

1. Use a brand with `requirements.disabled_reason=requirements.past_due`, such as the latest Stripe test brand.
2. Open Payments.
3. Confirm the screen does not show `Onboarding submitted — verifying` and `Verification overdue` as conflicting truths.
4. Tap `Continue verification`.
5. Confirm Mingla opens the app-controlled onboarding flow and creates a fresh `connect.stripe.com` Account Link.
6. Close or return from Stripe.
7. Confirm ordinary past-due requirements show `More information needed`, not `Stripe couldn't verify`.
8. Confirm terminal rejection reasons, if forced in test data, still show failure/contact support.
