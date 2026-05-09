# DEPLOY ORCH-0764A: Stripe API v2 Version Header

Date: 2026-05-08  
Mode: `$orchestrator` deploy  
Status: `deployed`

## Summary

Deployed the approved ORCH-0764A version-header rework to the linked Supabase project.

Function deployed:

- `brand-stripe-onboard`

Function not deployed:

- `brand-mingla-tos-accept` remained unchanged at version `4`.

No DB migration or `supabase db push` was required.

## Pre-Deploy Review

Approved by:

- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`

Implementation report:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`

Key change bundled in deploy:

- `_shared/stripeBlueprintClient.ts` now sends `Stripe-Version: 2026-04-22.preview` for raw `/v2/core/accounts` and `/v2/core/account_links`.

## Deploy Command

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

Output:

```text
Bundling Function: brand-stripe-onboard
Deploying Function: brand-stripe-onboard (script size: 85.64kB)
Deployed Functions on project gqnoajqerqhnvulmnyvv: brand-stripe-onboard
You can inspect your deployment in the Dashboard: https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/functions
```

## Post-Deploy Verification

Command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg "brand-stripe-onboard|brand-mingla-tos-accept"
```

Output:

```text
2610ca5a-be36-4015-a278-6bf26920cb0b | brand-stripe-onboard    | brand-stripe-onboard    | ACTIVE | 7 | 2026-05-08 22:20:34
ca6bfa84-1205-4177-b114-fbdd0bfd1ae0 | brand-mingla-tos-accept | brand-mingla-tos-accept | ACTIVE | 4 | 2026-05-08 21:27:58
```

## Next Gate

Dispatch `$tester` with:

- `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_RUNTIME.md`

Expected output:

- `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_RUNTIME.md`

Tester must retest on authenticated `Stripe Wise` and verify:

- repeat Mingla ToS acceptance remains HTTP `200` with `already_accepted: true`;
- `brand-stripe-onboard` returns HTTP `200`;
- response has `client_secret: null`;
- response has `account_id` beginning `acct_`;
- response has a Stripe-hosted `onboarding_url`;
- `onboarding_url` is not `business.usemingla.com/connect-onboarding`;
- opening the URL reaches usable Stripe-hosted onboarding;
- `stripe_connect_accounts` row is created or safely reused.

If the next Stripe error is Accounts v2 access, Account Link configuration, or restricted-key scope, tester should capture the exact error and classify it as the next blocker rather than closing ORCH-0764A.

ORCH-0764B remains paused.
