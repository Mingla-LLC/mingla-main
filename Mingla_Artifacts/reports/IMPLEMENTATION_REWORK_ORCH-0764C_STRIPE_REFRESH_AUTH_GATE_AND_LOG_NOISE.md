# Implementation Rework: ORCH-0764C Stripe Refresh Auth Gate And Log Noise

> Date: 2026-05-09
> Implementor: Codex `$implementor`
> Source prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764C_STRIPE_REFRESH_AUTH_GATE_AND_LOG_NOISE.md`
> Status: implemented and verified locally; not deployed

## Summary

Fixed the Stripe refresh auth race that could produce repeated Metro errors:

```text
[brand-stripe-refresh-status] edge function failed {"payload":{"error":"unauthenticated"},"status":401}
```

`useBrandStripeStatus` now waits for auth restoration to finish and requires both an authenticated user and session before enabling the React Query refresh, Realtime subscription, or 30s poll fallback.

## Files Changed

- `mingla-business/src/hooks/useBrandStripeStatus.ts`
  - Imports `useAuth()`.
  - Enables the Stripe status query only when `brandId !== null`, auth is not loading, `user !== null`, and `session !== null`.
  - Preserves the existing disabled query key for no-brand/no-auth states.
  - Preserves Realtime invalidation of:
    - `brandStripeStatusKeys.detail(brandId)`
    - `brandKeys.detail(brandId)`
    - `brandKeys.lists()`
  - Preserves the authenticated 30s poll fallback.

- `mingla-business/src/hooks/brandStripeStatusAuthGate.ts`
  - Adds the pure auth-gate predicate used by the hook.

- `mingla-business/src/hooks/__tests__/brandStripeStatusAuthGate.test.ts`
  - Adds focused regression coverage for loading auth, missing user, missing session, ready authenticated session, and missing brand id.

## Before / After

Before:

- A mounted brand surface with a non-null `brandId` immediately enabled `useBrandStripeStatus`.
- During startup/auth restore, `supabase.functions.invoke("brand-stripe-refresh-status")` could run before a valid JWT existed.
- The edge function correctly returned `401 unauthenticated`, and dev diagnostics logged it as a repeated red error.

After:

- No Stripe status refresh call is enabled while auth is loading.
- No Stripe status refresh call is enabled for signed-out/no-user states.
- No Stripe status refresh call is enabled without a session.
- Once auth is ready and a user session exists, live Stripe truth still works exactly as before: the query key, refresh call, Realtime invalidation, and 30s authenticated poll fallback remain active.

## Service Logging

No service-level logging change was needed.

The primary fix prevents the expected unauthenticated/auth-settling call instead of hiding edge-function failures. Real authenticated permission, server, or Stripe failures still flow through the existing `brandStripeService` error path and dev diagnostic logging.

## Verification

Passed:

```bash
cd mingla-business
PATH="/opt/homebrew/bin:$PATH" npx jest src/hooks/__tests__/brandStripeStatusAuthGate.test.ts
```

Result: 1 suite passed, 5 tests passed. Watchman emitted a recrawl warning only.

Passed:

```bash
cd mingla-business
PATH="/opt/homebrew/bin:$PATH" npx jest src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts src/utils/__tests__/brandStripeUiState.test.ts src/utils/__tests__/onboardReactivation.test.ts
```

Result: 4 suites passed, 21 tests passed. Watchman emitted a recrawl warning only.

Passed:

```bash
cd mingla-business
PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit
```

Result: pass.

Passed:

```bash
cd mingla-business
PATH="/opt/homebrew/bin:$PATH" npx eslint \
  'app/brand/[id]/index.tsx' \
  src/hooks/useBrandStripeStatus.ts \
  src/hooks/brandStripeStatusAuthGate.ts \
  src/services/brandStripeService.ts \
  src/components/brand/BrandProfileView.tsx \
  src/components/brand/BrandOnboardView.tsx \
  src/components/brand/BrandPaymentsView.tsx \
  src/utils/stripeOnboardingOutcome.ts \
  src/utils/stripeStatusSettlement.ts \
  src/utils/brandStripeUiState.ts
```

Result: pass.

Passed:

```bash
git diff --check
```

Result: pass.

## Residual Runtime Risk

Runtime tester should still confirm on simulator/device that:

- fresh app start/auth restore no longer emits repeated `brand-stripe-refresh-status` `401 unauthenticated` red errors;
- Account -> `Your brands` -> brand profile does not refresh Stripe until authenticated;
- authenticated brand profile still promotes stale cached onboarding to live active;
- Payments page and onboarding return still show correct live Stripe status.

## Deploy Notes

- No Supabase migration.
- No edge-function change.
- No Stripe API/deploy action.
- Business app bundle deploy required for the hook change.
