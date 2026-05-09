# Implementation Rework: ORCH-0764B Stripe Onboarding Return Route + Cached Active Bypass

**Date:** 2026-05-09  
**Status:** implemented, partially verified  
**Prompt:** `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`  
**Tester fail source:** `Mingla_Artifacts/reports/RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`

## Summary

This rework fixes the two tester-proven P1 blockers in code/config:

1. `mingla-business/vercel.json` now explicitly rewrites `/stripe-onboarding-return` to the exported static file `/stripe-onboarding-return.html`.
2. `BrandOnboardView` no longer renders **You're all set** from cached `brand.stripeStatus === "active"` alone. Cached active now enters a `checking-status` state until `useBrandStripeStatus` returns live Stripe status. Live `restricted` requirements can override cached active and render `needs-information`.

Production is **not verified fixed yet** because the web app was not deployed from Codex. The current production route still returns Vercel `404_NOT_FOUND` until a safe web deploy publishes this config.

## Files Changed

- `mingla-business/vercel.json`
  - Added explicit Stripe return rewrite:
    - source: `/stripe-onboarding-return`
    - destination: `/stripe-onboarding-return.html`
- `mingla-business/src/components/brand/BrandOnboardView.tsx`
  - Changed cached active mount behavior from terminal `already-active` to `checking-status`.
  - Added live-status settlement for cached active brands.
  - Added UI copy for the transient `checking-status` state.
  - Keeps live `active` as success and live actionable `restricted` as `needs-information`.
- `mingla-business/src/utils/stripeOnboardingOutcome.ts`
  - Added `deriveStripeOnboardingEntryState` helper to encode cached/live onboarding entry behavior.
- `mingla-business/src/utils/__tests__/stripeOnboardingOutcome.test.ts`
  - Added coverage for cached active + live restricted and cached active + live active.
- `mingla-business/src/utils/__tests__/stripeOnboardingReturnRoute.test.ts`
  - Added coverage that Vercel config includes the Stripe return-route rewrite.

## Behavior Before / After

Before:

- Production `/stripe-onboarding-return` returned Vercel `404_NOT_FOUND`.
- A brand with cached `stripeStatus: "active"` could render **You're all set** immediately in `BrandOnboardView`.
- Live Stripe requirements could be hidden by the cached active shortcut.

After:

- Local Vercel config contains an explicit rewrite to the exported route file.
- Local Expo export still emits `/stripe-onboarding-return`.
- Cached active shows **Checking Stripe status...** until live status is loaded.
- cached `active` + live `restricted` + `requirements.past_due` resolves to `needs-information`.
- cached `active` + live `active` resolves to success/active.

## Verification

Run from `mingla-business` unless noted.

```bash
npx jest deriveBrandStripeStatus.test stripeOnboardingOutcome.test stripeStatusSettlement.test onboardReactivation.test stripeOnboardingReturnRoute.test --runInBand
```

Result: PASS — 5 suites, 26 tests.

```bash
npx tsc --noEmit --pretty false
```

Result: PASS — exit 0.

```bash
npx eslint src/components/brand/BrandPaymentsView.tsx src/components/brand/BrandOnboardView.tsx src/utils/stripeOnboardingOutcome.ts src/utils/stripeStatusSettlement.ts src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeOnboardingReturnRoute.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts --max-warnings=0
```

Result: PASS — exit 0.

```bash
npx expo export -p web
```

Result: PASS — exported `dist`; static routes include `/stripe-onboarding-return`.

Run from `supabase/functions`:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Result: PASS — 6 passed, 0 failed.

```bash
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts brand-stripe-refresh-status/index.ts _shared/stripeBlueprintClient.ts
```

Result: PASS — exit 0.

Run from repo root:

```bash
git diff --check
```

Result: PASS — exit 0.

Production probes after local implementation but before web deploy:

```bash
curl -I --max-time 15 https://business.usemingla.com/stripe-onboarding-return
curl -I --max-time 15 'https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Result: still `HTTP/2 404`, `x-vercel-error: NOT_FOUND`. This is expected until the business web app is deployed.

## Deployment

No Vercel deployment was performed from Codex.

Reason: the worktree contains many unrelated dirty `mingla-business` product files from other active ORCH work. A direct `vercel deploy --prod` from this directory would risk publishing unrelated local changes, not just this focused ORCH-0764B route/state rework.

Required operator/deploy gate:

1. Review/stage only the intended current business web changes for the release bundle.
2. Deploy the `mingla-business` Vercel project.
3. Re-run:

```bash
curl -I https://business.usemingla.com/stripe-onboarding-return
curl -I 'https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Expected: no Vercel `404_NOT_FOUND`.

No Supabase edge functions were changed or deployed in this rework.

## Residual Tester Gate

After Vercel deploy, dispatch `$tester` to verify:

- Production `/stripe-onboarding-return` is reachable with and without query params.
- Stripe hosted onboarding return no longer strands the user on Vercel 404.
- A brand with cached `active` but live `restricted` requirements does not show **You're all set**.
- Live actionable KYC still shows **More information needed** and opens fresh Account Link continuation.
- Existing ORCH-0764B status settlement behavior still passes on iOS/device runtime.

## Notes

- Watchman emitted its existing recrawl warning during Jest. It did not fail tests.
- Expo export emitted the existing Sentry config warning and the existing Stripe ConnectJS SSR warning. Export completed successfully.
