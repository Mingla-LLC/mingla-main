# RETEST ORCH-0764B — Stripe Onboarding State Reconciliation

## Verdict

**FAIL**

The core static/test gates mostly pass, the migration is remote-applied, and the Stripe edge functions are deployed. However, two release-blocking issues remain:

1. **P1:** Production HTTPS relay route `https://business.usemingla.com/stripe-onboarding-return` returns Vercel `404 NOT_FOUND`, so Stripe Account Link return/refresh URLs cannot be trusted in production.
2. **P1:** `BrandOnboardView` still has an `already-active` mount bypass based only on cached `brand.stripeStatus`. Because that cached brand status does not carry Stripe `requirements`, an account with `charges_enabled=true + requirements.disabled_reason` can still enter the onboarding shell as **You're all set** before live restricted state is applied.

## Scope Tested

- Prompt: `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`
- Deploy evidence: `Mingla_Artifacts/reports/DEPLOY_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`

Runtime iOS onboarding was not completed because the production HTTPS return relay is currently 404 and would invalidate the Account Link return/refresh path. A separate simulator exists and can be used after the deploy/config blocker is fixed.

## Findings

### P1 — Production Stripe onboarding return relay is 404

**Evidence**

Command:

```bash
curl -I https://business.usemingla.com/stripe-onboarding-return
```

Result:

```text
HTTP/2 404
x-vercel-error: NOT_FOUND
server: Vercel
```

Command with expected Stripe-style return parameter:

```bash
curl -I 'https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Result:

```text
HTTP/2 404
x-vercel-error: NOT_FOUND
```

Root cause evidence:

- Local export does contain the route:
  - `npx expo export -p web` lists `/stripe-onboarding-return`.
  - `mingla-business/dist/stripe-onboarding-return.html` exists.
- Production root works:

```text
curl -I https://business.usemingla.com/
HTTP/2 200
```

- But `mingla-business/vercel.json` only rewrites `/e`, `/b`, and `/checkout` paths. It does not include `/stripe-onboarding-return`.
- `curl -I https://business.usemingla.com/stripe-onboarding-return.html` returns `308` to `/stripe-onboarding-return`, which then 404s.

Relevant files:

- `supabase/functions/brand-stripe-onboard/index.ts:107-116` builds Stripe Account Link return/refresh URLs at `/stripe-onboarding-return`.
- `mingla-business/app/stripe-onboarding-return.tsx` implements the web relay.
- `mingla-business/vercel.json:9-14` lacks a rewrite or serving rule for `/stripe-onboarding-return`.

**Impact**

Stripe can open hosted onboarding, but return/refresh through the HTTPS relay is not production-safe. This blocks a full runtime PASS for ORCH-0764B and violates the spec acceptance criterion requiring `curl -I https://business.usemingla.com/stripe-onboarding-return` to return 200/app shell equivalent.

**Required rework**

Add production routing support for `/stripe-onboarding-return` in the business web deployment config, deploy the business web app, and prove:

```bash
curl -I https://business.usemingla.com/stripe-onboarding-return
```

returns `200` or an app-shell equivalent, not Vercel 404.

### P1 — Onboarding shell can still trust stale cached `active`

**Evidence**

`BrandPaymentsView` correctly prefers live status:

- `mingla-business/src/components/brand/BrandPaymentsView.tsx:148-153`

```ts
const stripeStatus = getEffectiveBrandStripeStatus({
  liveStatus: stripeStatusQuery.data?.status,
  cachedStatus: brand?.stripeStatus,
});
```

But `BrandOnboardView` still does this on mount:

- `mingla-business/src/components/brand/BrandOnboardView.tsx:157-164`

```ts
if (brand.stripeStatus === "active") return "already-active";
```

The brand cache is known not to include requirements:

- `mingla-business/src/services/brandMapping.ts:195-207`

```ts
// Cache does NOT carry requirements JSONB or detached_at
```

The ORCH-0764B migration and tests explicitly care about this edge case:

- `supabase/migrations/20260515000007_orch_0764b_stripe_status_derivation_parity.sql:19-22` makes `requirements.disabled_reason` beat `charges_enabled`.
- `mingla-business/src/utils/__tests__/deriveBrandStripeStatus.test.ts` covers restricted overriding `charges_enabled`.

**Impact**

If cached brand status is `active` but live Stripe account state is `restricted` because `requirements.disabled_reason` is present, the Payments screen can correctly route the user into onboarding, but the onboarding shell can render **You're all set** before the user can continue verification. That leaves a duplicate-truth hole in the exact payment-state family ORCH-0764B was meant to close.

**Required rework**

`BrandOnboardView` should not use cached `brand.stripeStatus === "active"` as a terminal bypass without live confirmation. Safer options:

- remove the `already-active` bypass entirely and let the live status query/settlement classify the state; or
- show a loading/checking state when cache says active, then render `already-active` only when live status is also `active`; or
- derive onboarding initial state from the same effective-status helper, with live status preferred and no terminal active success while live status is still unknown.

Add regression coverage for cached `active` + live `restricted` so the onboarding shell cannot show `already-active`.

## Verified Pass Items

### Remote migration applied

Command:

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Relevant output:

```text
20260515000007 | 20260515000007 | 2026-05-15 00:00:07
```

### Edge functions deployed

Command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg 'brand-stripe-onboard|brand-stripe-refresh-status|brand-mingla-tos-accept'
```

Output:

```text
brand-stripe-onboard              ACTIVE | 9
brand-stripe-refresh-status       ACTIVE | 5
brand-mingla-tos-accept           ACTIVE | 4
```

### Static/code contract mostly present

Verified:

- `BrandPaymentsView` prefers live status over cached status.
- User-facing `express_login` dependency is removed from active code.
- Restricted/banner/KYC/deadline/bank remediation CTAs route to `onOpenOnboard`.
- `needs-information` exists in `BrandOnboardView`.
- Actionable restricted requirements map to `needs-information`; terminal rejection maps to `failed-stripe`.
- Bounded settlement helper polls up to 15 attempts at 2 seconds each.
- SQL helper checks `requirements.disabled_reason` before `charges_enabled`.

### TypeScript

Command:

```bash
cd mingla-business
npx tsc --noEmit --pretty false
```

Result: exit `0`.

### Jest

Command:

```bash
cd mingla-business
npx jest deriveBrandStripeStatus.test stripeOnboardingOutcome.test stripeStatusSettlement.test onboardReactivation.test --runInBand
```

Output:

```text
PASS src/utils/__tests__/stripeOnboardingOutcome.test.ts
PASS src/utils/__tests__/onboardReactivation.test.ts
PASS src/utils/__tests__/deriveBrandStripeStatus.test.ts
PASS src/utils/__tests__/stripeStatusSettlement.test.ts

Test Suites: 4 passed, 4 total
Tests: 23 passed, 23 total
```

### Targeted ESLint

Command:

```bash
cd mingla-business
npx eslint src/components/brand/BrandPaymentsView.tsx src/components/brand/BrandOnboardView.tsx src/utils/stripeOnboardingOutcome.ts src/utils/stripeStatusSettlement.ts src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts --max-warnings=0
```

Result: exit `0`.

### Deno tests

Command:

```bash
cd supabase/functions
~/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Output:

```text
ok | 6 passed | 0 failed
```

### Deno check

Command:

```bash
cd supabase/functions
~/.deno/bin/deno check brand-stripe-onboard/index.ts brand-stripe-refresh-status/index.ts _shared/stripeBlueprintClient.ts
```

Result: exit `0`.

### Web export

Command:

```bash
cd mingla-business
npx expo export -p web
```

Relevant output:

```text
› Static routes (44):
/stripe-onboarding-return (37.2 kB)
Exported: dist
```

Local export route exists, but production Vercel does not currently serve it.

### Diff hygiene

Command:

```bash
git diff --check
```

Result: exit `0`.

## Runtime QA Status

Runtime device/simulator QA is **blocked for full PASS** until the production HTTPS relay is fixed and redeployed.

Available simulator evidence:

```text
iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6) (Booted)
Mingla Stripe Payload RAK Retest ORCH-0764A (CAE0499F-BB4F-4832-82AC-6B45C369084F) (Shutdown)
```

No full Stripe browser return test was executed in this retest because the return URL currently 404s in production.

## Retest Instructions After Rework

1. Fix and deploy `/stripe-onboarding-return` on `business.usemingla.com`.
2. Fix `BrandOnboardView` cached-active bypass so live restricted can override cached active before showing success.
3. Add a regression test for cached `active` + live `restricted` in onboarding-shell classification.
4. Re-run:

```bash
cd mingla-business
npx tsc --noEmit --pretty false
npx jest deriveBrandStripeStatus.test stripeOnboardingOutcome.test stripeStatusSettlement.test onboardReactivation.test --runInBand
npx eslint src/components/brand/BrandPaymentsView.tsx src/components/brand/BrandOnboardView.tsx src/utils/stripeOnboardingOutcome.ts src/utils/stripeStatusSettlement.ts src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts --max-warnings=0
npx expo export -p web
curl -I https://business.usemingla.com/stripe-onboarding-return
```

5. Then complete the iOS simulator/device runtime flow:
   - open Payments for the Stripe test brand;
   - confirm one coherent Stripe state;
   - tap Continue verification;
   - confirm fresh Account Link;
   - cancel/return and verify **More information needed** for `requirements.past_due`;
   - confirm no actionable KYC path opens bare Express login.
