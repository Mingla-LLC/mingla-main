# Implementor Rework: ORCH-0764B Stripe Onboarding Return Route + Cached Active Bypass

## Mission

Fix the two P1 blockers from:

- `Mingla_Artifacts/reports/RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`

Expected output:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`

This is a focused rework. Do not reopen the broader Stripe architecture unless the exact files below prove a blocker.

## Plain-English Problem

Stripe onboarding is almost repaired, but two things still break trust:

1. Stripe is told to send users back to `https://business.usemingla.com/stripe-onboarding-return`, but production currently returns a Vercel 404. That is like giving Stripe a return address that does not exist.
2. The onboarding screen can still say **You're all set** using old cached brand status before the app checks live Stripe requirements. That can mislead a seller who still owes Stripe more verification details.

## Evidence

Read first:

- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`
- Deploy: `Mingla_Artifacts/reports/DEPLOY_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`
- Tester fail: `Mingla_Artifacts/reports/RETEST_ORCH-0764B_STRIPE_ONBOARDING_STATE_RECONCILIATION.md`

Tester-proven blockers:

- `curl -I https://business.usemingla.com/stripe-onboarding-return` returns `HTTP/2 404`, `x-vercel-error: NOT_FOUND`.
- Local export includes `/stripe-onboarding-return`, but production does not serve it.
- `mingla-business/vercel.json` has rewrites for `/e`, `/b`, and `/checkout`, but not `/stripe-onboarding-return`.
- `BrandOnboardView` still uses cached `brand.stripeStatus === "active"` to enter `already-active`.
- `brandMapping.ts` explicitly documents that cached brand status does not carry `requirements` or `detached_at`.

## Scope

IN:

- Fix production routing/config so `/stripe-onboarding-return` can be served by Vercel/business web.
- Fix `BrandOnboardView` so cached `active` cannot immediately render terminal success before live Stripe status confirms it.
- Add focused regression tests for the cached-active/live-restricted onboarding-shell contract.
- Keep existing ORCH-0764B helper tests passing.
- Update implementation report with exact commands and remaining deploy gates.

OUT:

- Do not change Stripe Accounts v2 payloads.
- Do not change API keys, restricted key permissions, Stripe account ownership, or Stripe Dashboard configuration.
- Do not implement checkout/destination charges.
- Do not rewrite onboarding architecture.
- Do not touch unrelated event/share/draft work in the dirty worktree.

## Required Fix 1 — HTTPS Return Route

Files likely involved:

- `mingla-business/vercel.json`
- `mingla-business/app/stripe-onboarding-return.tsx`
- possibly docs/runbook notes if needed

Goal:

```bash
curl -I https://business.usemingla.com/stripe-onboarding-return
```

must return `200` or an app-shell equivalent after web deployment, not `404`.

Local acceptance:

- `npx expo export -p web` still lists `/stripe-onboarding-return`.
- If Vercel clean URLs require a rewrite, add the minimal explicit rewrite.
- Do not break existing `/e/:brandSlug/:eventSlug`, `/b/:brandSlug`, or `/checkout/:eventId` routes.

Suggested direction:

- Add an explicit Vercel rewrite/source for `/stripe-onboarding-return` to the generated static page/app-shell route, if that is how current Vercel clean URL behavior requires it.
- Preserve query params, especially `return_to` and `stripe_onboarding_refresh`.

## Required Fix 2 — Cached Active Bypass

File:

- `mingla-business/src/components/brand/BrandOnboardView.tsx`

Current unsafe pattern:

```ts
if (brand.stripeStatus === "active") return "already-active";
```

Problem:

- Cached brand status does not carry live Stripe `requirements`.
- The SQL/TS parity fix specifically says `requirements.disabled_reason` must win over `charges_enabled`.
- Therefore cached `active` cannot safely be used as immediate final success in the onboarding shell.

Required behavior:

- Do not render **You're all set** from cached `brand.stripeStatus` alone.
- Live `useBrandStripeStatus` status must be able to override cached active before terminal success.
- Actionable restricted live state must render `needs-information`.

Acceptable implementations:

- Remove `already-active` mount bypass and classify through live status/query flow.
- Or add a temporary `checking` state until live Stripe status is known, then show `already-active` only when live status is `active`.
- Or use an effective-status helper, but only if it cannot terminally trust cached active before live status loads.

## Required Tests

Add or update focused tests. If component harness is heavy, add pure helper coverage that encodes the same contract and wire `BrandOnboardView` through that helper.

Tests must cover:

1. cached `active` + live `restricted` => `needs-information`, not `already-active`.
2. cached `active` + live `active` => success/active is allowed.
3. `requirements.past_due` remains `needs-information`.
4. terminal rejection remains `failed-stripe`.
5. Vercel routing config includes `/stripe-onboarding-return` or equivalent route proof.

Keep existing tests passing:

```bash
cd mingla-business
npx tsc --noEmit --pretty false
npx jest deriveBrandStripeStatus.test stripeOnboardingOutcome.test stripeStatusSettlement.test onboardReactivation.test --runInBand
npx eslint src/components/brand/BrandPaymentsView.tsx src/components/brand/BrandOnboardView.tsx src/utils/stripeOnboardingOutcome.ts src/utils/stripeStatusSettlement.ts src/utils/__tests__/stripeOnboardingOutcome.test.ts src/utils/__tests__/stripeStatusSettlement.test.ts --max-warnings=0
npx expo export -p web
```

Supabase gates should still pass:

```bash
cd supabase/functions
~/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
~/.deno/bin/deno check brand-stripe-onboard/index.ts brand-stripe-refresh-status/index.ts _shared/stripeBlueprintClient.ts
```

Also run:

```bash
git diff --check
```

## Deployment / Runtime Gate

If you can deploy the business web app safely from this environment, do so only if the current repo/deploy flow authorizes it and report exact command/output.

If you cannot deploy Vercel from Codex, document the exact operator step and leave runtime as a deploy gate.

Post-deploy proof required:

```bash
curl -I https://business.usemingla.com/stripe-onboarding-return
curl -I 'https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Expected: no Vercel 404.

## Report Requirements

Create:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764B_STRIPE_ONBOARDING_RETURN_AND_ACTIVE_BYPASS.md`

Include:

- Files changed.
- Exact behavior before/after.
- Test commands and exact results.
- Whether Vercel/web deployment was performed.
- Whether production `/stripe-onboarding-return` is now reachable.
- Any residual runtime/manual gate for `$tester`.

## Hard Guards

- Do not patch unrelated dirty files.
- Do not edit secrets or print Stripe secret values.
- Do not remove the ORCH-0764B status-settlement helpers.
- Do not mark this close-ready; tester must retest after rework.
