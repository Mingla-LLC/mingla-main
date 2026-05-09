# Implementation Rework: ORCH-0764C Stripe Status Truth On Profile And Return

> Date: 2026-05-09  
> Implementor: Codex `$implementor`  
> Source prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764C_STRIPE_STATUS_TRUTH_ON_PROFILE_AND_RETURN.md`  
> Status: implemented and verified locally; not deployed

## Summary

Fixed the remaining stale Stripe status surfaces from the operator runtime evidence:

- Brand profile now receives an effective Stripe status where live Stripe status wins over cached `brand.stripeStatus`.
- If cached status is `onboarding` but live status is `active`, the profile Stripe banner is suppressed and the `Payments & Stripe` row shows `Active`.
- The profile route now resolves brand detail through `useBrand(...)` instead of the list shim, matching the Payments/onboarding route pattern and reducing stale list-cache exposure.
- The onboarding return flow now switches to neutral `Checking Stripe status...` copy while status settlement is running.
- If a screen is already showing `complete-verifying` and the live status later flips to `active`, it promotes to `complete-active`.
- Stripe `requirements.pending_verification` without due fields is now treated as Stripe review/waiting, not as user-action-required.
- Status settlement now keeps polling through pending verification instead of immediately showing `Continue verification`.
- The onboarding start handler now guards against repeated taps opening stacked Account Link sessions.
- Added regression tests for the stale profile-copy contract.

## Files Changed

- `mingla-business/app/brand/[id]/index.tsx`
  - Replaced `useBrandList()` lookup with `useBrand(brandId)`.
  - Added `useBrandStripeStatus(brandId)`.
  - Passes `effectiveStripeStatus` to `BrandProfileView` using `getEffectiveBrandStripeStatus(...)`.

- `mingla-business/src/components/brand/BrandProfileView.tsx`
  - Added `effectiveStripeStatus` prop.
  - Uses effective status for the Stripe banner and `Payments & Stripe` operations row.
  - Moved profile Stripe banner/row copy to shared tested helpers.
  - Cleaned touched-file ESLint array-type warning.

- `mingla-business/src/components/brand/BrandOnboardView.tsx`
  - Sets `checking-status` while post-browser Stripe settlement is in progress.
  - Adds `complete-verifying` -> `complete-active` promotion when live status becomes active.
  - Guards `handleStart` with an in-flight ref and disables the needs-information CTA while the mutation is pending.

- `mingla-business/src/utils/stripeOnboardingOutcome.ts`
  - Removes `requirements.pending_verification` from the user-action-required bucket.
  - Adds `isStripePendingVerification(...)`.
  - Classifies pending verification without due fields as `complete-verifying`.

- `mingla-business/src/utils/stripeStatusSettlement.ts`
  - Continues polling through pending verification so Stripe has time to become active before Mingla shows a final state.

- `mingla-business/src/utils/brandStripeUiState.ts`
  - Added `getBrandProfileStripeBannerCopy(...)`.
  - Added `getBrandProfileStripeOperationsSub(...)`.

- `mingla-business/src/utils/__tests__/brandStripeUiState.test.ts`
  - Added regression coverage for cached onboarding + live active.
  - Ensures profile verifying copy remains only when effective status is actually `onboarding`.

## User-Visible Before / After

Before:

- Payments page could show `You're connected to Stripe`.
- Brand profile could still show `Onboarding submitted — verifying`.
- Brand profile `Payments & Stripe` row could still show `Onboarding...`.
- Returning from Stripe could briefly or temporarily show final verifying copy while status was still settling.

After:

- Live `active` status suppresses the stale profile verifying banner.
- Live `active` status makes the profile `Payments & Stripe` row show `Active`.
- Post-Stripe return uses neutral checking copy while settlement is running.
- A later active status refresh promotes the onboarding shell from verifying to success.
- Pending Stripe review no longer shows `Continue verification` unless Stripe also reports due/missing fields.
- Fast repeated taps cannot stack multiple onboarding launches from the same screen instance.

## Verification

Passed:

```bash
cd mingla-business
npx jest src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts src/utils/__tests__/brandStripeUiState.test.ts src/utils/__tests__/onboardReactivation.test.ts
```

Result: 4 suites passed, 21 tests passed. Watchman emitted a recrawl warning only.

```bash
cd mingla-business
npx eslint \
  'app/brand/[id]/index.tsx' \
  src/components/brand/BrandProfileView.tsx \
  src/components/brand/BrandOnboardView.tsx \
  src/components/brand/BrandPaymentsView.tsx \
  src/utils/stripeOnboardingOutcome.ts \
  src/utils/stripeStatusSettlement.ts \
  src/utils/brandStripeUiState.ts
```

Result: pass.

```bash
cd mingla-business
npx tsc --noEmit
```

Result: pass.

```bash
git diff --check
```

Result: pass.

## Deploy Notes

- No DB migration.
- No edge-function change in this rework.
- Business app/web bundle deploy required for the profile/onboarding UI behavior.

## Residual Risk

- Runtime retest is still required on device/simulator after deployment to prove the profile page, Payments page, and onboarding return shell agree in the real Stripe webhook/refetch timing window.
- App-wide multi-currency remains out of scope and still needs a separate ORCH item.
