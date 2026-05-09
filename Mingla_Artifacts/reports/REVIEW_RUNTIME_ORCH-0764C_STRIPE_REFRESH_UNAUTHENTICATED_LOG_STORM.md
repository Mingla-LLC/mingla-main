# Review — ORCH-0764C — Stripe Refresh Unauthenticated Log Storm

## Verdict

Rework required.

Plain-English impact: the restored Account `Your brands` section is unrelated to this error. The visible Metro error is coming from the Stripe status refresh path. It creates a noisy red error loop and may mask real Stripe issues during normal app startup/auth settling.

## Runtime Evidence

Operator reported repeated iOS Metro logs:

```text
ERROR [brand-stripe-refresh-status] edge function failed {"payload": {"error": "unauthenticated"}, "status": 401}

Code: brandStripeService.ts
  116 |     const payload = response.json ? await response.json() : null;
  117 |     if (shouldLogDiagnostics()) {
> 118 |       console.error(`[${functionName}] edge function failed`, {
```

The same error repeated four times.

## Code Evidence

### Edge function behavior is expected when no JWT arrives

`supabase/functions/brand-stripe-refresh-status/index.ts` returns:

- `401 { error: "unauthenticated" }` when no `Authorization: Bearer ...` header is present.
- `401 { error: "unauthenticated" }` when Supabase cannot verify the token.

That means the edge function is not necessarily broken; it is reporting that the caller was unauthenticated.

### Frontend logs every edge-function error in dev

`mingla-business/src/services/brandStripeService.ts` unwraps Supabase function errors and logs status/payload in dev:

- `unwrapFunctionError(...)`
- `console.error("[brand-stripe-refresh-status] edge function failed", { status, payload })`

So a transient unauthenticated call becomes a red Metro error.

### ORCH-0764C profile truth rework introduced an always-on profile refresh call

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764C_STRIPE_STATUS_TRUTH_ON_PROFILE_AND_RETURN.md` says the profile route added `useBrandStripeStatus(brandId)`.

Current code confirms:

- `mingla-business/app/brand/[id]/index.tsx` calls `useBrandStripeStatus(brandId)` directly.
- `mingla-business/src/hooks/useBrandStripeStatus.ts` sets `enabled = brandId !== null`.
- The hook does not inspect `useAuth().loading`, `user`, or Supabase session readiness before invoking `refreshBrandStripeStatus(brandId)`.
- The hook has a 30s `refetchInterval` and inherits React Query default retry behavior from `src/config/queryClient.ts` (`queries.retry: 1`), so one bad auth-timing call can repeat.

## Likely Root Cause

High-confidence causal chain:

1. Brand profile or another Stripe-aware brand surface mounts with a non-null `brandId`.
2. `useBrandStripeStatus(brandId)` enables immediately because `brandId !== null`.
3. Supabase auth session is absent, expired, or still being restored.
4. `supabase.functions.invoke("brand-stripe-refresh-status", ...)` sends no valid JWT.
5. Edge function returns `401 { error: "unauthenticated" }`.
6. `brandStripeService.unwrapFunctionError` logs it with `console.error` in dev.
7. React Query retry and/or multiple mounted Stripe surfaces repeat the same red error.

## Relationship To ORCH-0768

This is not caused by restoring Account `Your brands`.

It may be easier to notice now because `Your brands` routes you back into brand profile, and the brand profile route now refreshes Stripe status live as part of the ORCH-0764C stale-status fix.

## Rework Decision

Do not reopen broad Stripe forensics. Root cause is sufficiently code-proven for a bounded implementor rework.

Next lifecycle gate:

`$implementor` with:

`Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764C_STRIPE_REFRESH_AUTH_GATE_AND_LOG_NOISE.md`

Expected output:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764C_STRIPE_REFRESH_AUTH_GATE_AND_LOG_NOISE.md`

## Corrected Contract

- `useBrandStripeStatus` must not call `brand-stripe-refresh-status` while auth is loading or no authenticated user/session exists.
- The hook must preserve live Stripe status truth once the user is authenticated.
- The hook must preserve realtime invalidation and the 30s authenticated poll fallback.
- Expected unauthenticated/auth-settling states must not create repeated red dev errors.
- Real authenticated failures, permission failures, and Stripe/server failures must still surface through the existing error path.
- Existing ORCH-0764C profile/payments/onboarding status truth tests must continue to pass.

## Status

ORCH-0764C remains open. This runtime issue should be fixed before declaring the Stripe status/profile work tester-ready or close-ready.
