# Tester Retest: ORCH-0764B Stripe Onboarding Return Route + Cached Active Bypass

## Mission

Independently retest the ORCH-0764B rework after the business web app has been deployed.

This is a runtime gate, not a new implementation task.

## Required Inputs

Read first:

- `Mingla_Artifacts/reports/RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`
- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`
- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`

Expected output:

- `Mingla_Artifacts/reports/RETEST_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`

## Precondition

Before full runtime QA, confirm the business web deploy happened. If production still returns Vercel 404 for the Stripe return route, stop and mark the retest **FAIL / deploy blocker**.

Run:

```bash
curl -I https://business.usemingla.com/stripe-onboarding-return
curl -I 'https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Expected:

- no `x-vercel-error: NOT_FOUND`
- no `HTTP/2 404`
- querystring route also resolves

## Static Gates

Run from `mingla-business`:

```bash
npx jest deriveBrandStripeStatus.test stripeOnboardingOutcome.test stripeStatusSettlement.test onboardReactivation.test stripeOnboardingReturnRoute.test --runInBand
npx tsc --noEmit --pretty false
npx eslint src/components/brand/BrandPaymentsView.tsx src/components/brand/BrandOnboardView.tsx src/utils/stripeOnboardingOutcome.ts src/utils/stripeStatusSettlement.ts src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeOnboardingReturnRoute.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts --max-warnings=0
npx expo export -p web
```

Run from `supabase/functions`:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts brand-stripe-refresh-status/index.ts _shared/stripeBlueprintClient.ts
```

Run from repo root:

```bash
git diff --check
```

## Runtime Scope

Use a clean/separate iOS simulator or a real device that is not being used by another chat.

Retest the Stripe payments/onboarding flow for an authenticated business account and a safe test brand fixture. If a new brand fixture is needed, record the brand name, brand id, account email, simulator/device UDID, and app build source.

## Required Runtime Assertions

1. The app no longer shows **You're all set** from cached active alone while live Stripe status is unresolved.
2. A cached active brand with live `restricted`/past-due requirements resolves to **More information needed**, not success.
3. The **Continue verification** / **Finish onboarding** path opens a fresh Stripe-hosted Account Link, not bare `connect.stripe.com/express_login`.
4. Returning from Stripe no longer strands the user on `https://business.usemingla.com/stripe-onboarding-return` 404.
5. Cancelling/dismissing Stripe onboarding shows a truthful cancelled/resumable state.
6. Completed/submitted onboarding settles into either active or verifying state based on live Stripe status.
7. The Payments screen and onboarding shell agree on the same effective Stripe state after refresh.

## Evidence To Capture

Include:

- exact app build / simulator / device used
- production route `curl -I` output summary
- screenshots or precise descriptions of each user-visible state
- relevant Metro/device logs for `brand-stripe-onboard`, `brand-stripe-refresh-status`, and `useStartBrandStripeOnboarding`
- whether Stripe Dashboard shows a connected account and whether requirements are due/past_due
- PASS / CONDITIONAL PASS / FAIL verdict with P0/P1/P2 findings

## Hard Guards

- Do not mutate Stripe live mode.
- Do not use real personal/business verification data.
- Do not close ORCH-0764B from tester mode.
- If production route is still 404, do not spend time on deeper iOS runtime; report deploy blocker immediately.
