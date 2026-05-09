# REVIEW SPEC REWORK ORCH-0764A: Stripe API v2 Version Header

Date: 2026-05-08  
Mode: `$orchestrator` review  
Verdict: `APPROVED FOR IMPLEMENTOR`

## Plain-English Impact

Organisers are still blocked from starting Stripe payout onboarding. The live function reaches Stripe, but Stripe rejects the Accounts v2 request before Mingla can create a connected-account row or return a hosted onboarding URL.

The spec correctly resets the lifecycle from "quick rework" to an evidence-backed implementation contract. This is the right level of caution for money movement.

## Evidence Reviewed

- Spec: `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Tester fail: `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`
- Deploy evidence: `Mingla_Artifacts/reports/DEPLOY_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`
- Prior ORCH-0764 spec: `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`
- Current helper/test paths cited by the spec:
  - `supabase/functions/_shared/stripeBlueprintClient.ts`
  - `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
  - `supabase/functions/brand-stripe-onboard/index.ts`
  - `supabase/functions/brand-stripe-onboard/index.test.ts`

## Review Findings

### Approved: Root Cause Is Proven

The spec has sufficient six-field proof:

- Current helper sends raw `/v2/core/accounts` without `Stripe-Version`.
- Current helper tests assert the header is absent.
- Deployed runtime fails with Stripe's explicit missing-version-header error.
- No local `stripe_connect_accounts` row is created after the failure.

This is enough to proceed to implementation.

### Approved: Scope Is Correctly Bounded

The spec keeps the implementation narrow:

- add `Stripe-Version` to raw ORCH-0764A Accounts v2 helper calls;
- update tests that encoded the old contract;
- correct stale docs/invariants;
- redeploy only `brand-stripe-onboard` after review;
- keep ORCH-0764B paused.

It explicitly forbids switching to `stripe.accounts.create`, `accountSessions.create`, or `/connect-onboarding`.

### Accepted Caveat: Version Source Has A Workbench Override

The spec recommends `Stripe-Version: 2026-04-22.preview` because current official API reference preview URLs redirected to that value during forensics.

Accepted caveat: if the operator can expose Stripe Workbench blueprint metadata with a different exact version before implementation, that Workbench evidence should supersede the docs-preview value and return to orchestrator before code changes.

No operator action is required before implementation if no Workbench metadata is available.

## Decision

Approve implementation rework under the new prompt:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_FROM_SPEC.md`

Expected implementation report:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`

## Hard Guards

- Do not deploy during implementation unless orchestrator explicitly authorizes after reviewing the implementation report.
- Do not start ORCH-0764B checkout work.
- Do not add a DB migration.
- Do not touch business app UI unless implementation proves a test-only import/comment adjustment is needed.
- Do not mutate Stripe Dashboard or Supabase data from implementor mode.

## Next Gate

User dispatches `$implementor` with:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_FROM_SPEC.md`

After implementation returns, orchestrator reviews the report and decides whether to deploy `brand-stripe-onboard`.
