# Review: ORCH-0764B Stripe Onboarding Return Route + Cached Active Bypass Rework

**Date:** 2026-05-09  
**Reviewed report:** `reports/IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`  
**Verdict:** Conditional approval for deploy gate, not close-ready

## Plain-English Decision

The rework fixes the two tester-proven problems in the local codebase, but users will not feel the first fix until the business web app is deployed. Production still returns Vercel `404_NOT_FOUND` for `/stripe-onboarding-return`, so runtime tester should not be dispatched as a final pass until that deploy happens.

## What Is Accepted

- `BrandOnboardView` no longer treats cached `brand.stripeStatus === "active"` as immediate terminal success.
- Cached active now waits in a `checking-status` state until live Stripe status confirms.
- Live `restricted` requirements can now override cached active and render `needs-information`.
- `vercel.json` contains a dedicated `/stripe-onboarding-return` rewrite to `/stripe-onboarding-return.html`.
- Regression coverage was added for cached-active/live-restricted behavior and Vercel route config.
- Reported gates passed:
  - targeted Jest: 5 suites / 26 tests
  - TypeScript
  - targeted ESLint
  - Expo web export with `/stripe-onboarding-return`
  - Deno tests: 6 passed
  - Deno check
  - `git diff --check`

## Remaining Blocker

Production is still not serving the return route:

- `https://business.usemingla.com/stripe-onboarding-return` still returns `HTTP/2 404`, `x-vercel-error: NOT_FOUND`.
- The reason is deployment, not local code: the implementor did not deploy Vercel because the worktree contains unrelated dirty business-web changes.

## Deployment Caution

The current dirty worktree includes other `mingla-business` changes, including additional `vercel.json` changes from adjacent ORCH work. A direct production Vercel deploy from this checkout may publish more than ORCH-0764B. Treat the deploy as a coordinated business-web deploy, not a tiny isolated Stripe-only deploy, unless the release branch/staging area is scoped first.

## Next Lifecycle Gate

1. Deploy the intended `mingla-business` web bundle to Vercel.
2. Verify:

```bash
curl -I https://business.usemingla.com/stripe-onboarding-return
curl -I 'https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Expected: no Vercel `404_NOT_FOUND`.

3. Then dispatch `$tester` with:

`prompts/TESTER_RETEST_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`

## Close Status

ORCH-0764B remains open. Do not close until production route reachability and iOS/device Stripe onboarding return behavior are independently verified.
