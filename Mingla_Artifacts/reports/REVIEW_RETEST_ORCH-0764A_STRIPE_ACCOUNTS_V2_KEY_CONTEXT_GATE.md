# Orchestrator Review: ORCH-0764A Stripe Accounts v2 Key/Context Runtime Gate

> Date: 2026-05-08  
> Mode: REVIEW / DISPATCH  
> Verdict: APPROVED FOR FORENSICS SPEC, NOT CLOSE  
> Next prompt: `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`

## Plain-English Impact

Organisers can now accept Mingla's platform ToS, and the previous Stripe API v2 version-header error is no longer the active failure. But payout onboarding is still blocked: `Stripe Wise 2` cannot create a Stripe connected/recipient account or open Stripe-hosted onboarding.

This is launch-critical commerce plumbing. We should not proceed to ORCH-0764B checkout, ticket sales, or payout-readiness claims until ORCH-0764A produces a live Stripe-hosted onboarding URL and a persisted `stripe_connect_accounts` row.

## Evidence Reviewed

- Runtime tester report: `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_RUNTIME.md`
- Version-header deploy report: `Mingla_Artifacts/reports/DEPLOY_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Version-header implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Approved version-header spec: `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Prior runtime fail report: `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`
- Stripe hosted recipient docs checked during review: `https://docs.stripe.com/global-payouts/stripe-hosted-recipient-creation`

## Current Proven Runtime State

Fixture:

- User: `sethogieva@icloud.com`
- Brand: `Stripe Wise 2`
- Brand id: `81fd06bc-f31d-43e2-8189-b5a2a297cfee`
- Slug: `stripewise2`
- Simulator: `Mingla Stripe Retest ORCH-0764A` / `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330`

Verified pass:

- Valid Supabase session: `GET /auth/v1/user` returned HTTP `200`.
- Brand lookup returned `Stripe Wise 2`.
- Initial Mingla ToS acceptance returned HTTP `200`.
- Repeat Mingla ToS acceptance returned HTTP `200` with `already_accepted: true`.
- `stripe_connect_accounts` before onboarding was `[]`.

Current failing call:

```json
{
  "error": "stripe_api_error",
  "detail": "Permission denied. API Key does not have permission to access account. To make an authorized request, make sure that the API Key making the request has the correct permissions for the resource in the API call. In some cases, you may also need to supply an Account ID in the Stripe-Context header."
}
```

Observed after failure:

- HTTP status: `502` from `brand-stripe-onboard`.
- No `stripe_connect_accounts` row.
- No `account_id`.
- No `client_secret: null` success contract.
- No Stripe-hosted `onboarding_url`.

## Orchestrator Decision

Do **not** dispatch implementor yet. The exact fix is not proven.

The failure could be one of several different root causes with different blast radius:

- `STRIPE_RAK_ONBOARD` exists but lacks Accounts v2 create/account-link permissions.
- The helper is choosing `STRIPE_RAK_ONBOARD` when this operation currently needs the platform `STRIPE_SECRET_KEY`.
- The request may need `Stripe-Context` for one or more v2 operations in this specific platform/account setup.
- The Workbench blueprint used account-link `configurations: ["recipient", "merchant"]`, while current hosted-recipient docs commonly show recipient-only flows; the exact use case and platform enrollment need verification.
- The Stripe account may not have the required Accounts v2 / hosted recipient / marketplace preview capability enabled for the key/environment being used.

Because the runtime error is now Stripe authorization/context rather than app auth, ToS, or versioning, the next proper lifecycle gate is a forensics+spec pass.

## Required Next Action

Dispatch `$forensics` with:

`Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`

Required output:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`
- `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`

## Hard Guards

- Do not modify product code from orchestrator mode.
- Do not mutate Stripe Dashboard settings unless the prompt explicitly identifies an operator-only Dashboard action.
- Do not log or print Stripe secret/restricted key values.
- Do not start ORCH-0764B checkout implementation/testing.
- Do not close ORCH-0764A until tester proves HTTP `200`, `client_secret: null`, `account_id: acct_...`, Stripe-hosted `onboarding_url`, and a created/reused `stripe_connect_accounts` row.

