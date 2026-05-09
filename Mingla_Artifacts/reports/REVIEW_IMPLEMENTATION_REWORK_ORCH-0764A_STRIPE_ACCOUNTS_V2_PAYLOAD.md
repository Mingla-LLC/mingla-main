# REVIEW IMPLEMENTATION REWORK ORCH-0764A: Stripe Accounts v2 Payload

Date: 2026-05-08  
Mode: `$orchestrator` review  
Verdict: `CODE APPROVED, RAK VERIFIED, DEPLOYED FOR TESTER RETEST`

## Plain-English Impact

The code-side Stripe payload fix is correct, but organisers still cannot be expected to complete Stripe onboarding until the restricted Stripe key is actually authorized for the Accounts v2 calls.

The code-side fix is approved and the operator-side RAK permission blocker is now cleared by direct probes. `brand-stripe-onboard` has been deployed for tester retest.

## Evidence Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_PAYLOAD.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`
- Spec: `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`
- Code:
  - `supabase/functions/_shared/stripeBlueprintClient.ts`
  - `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`

## Review Decision

### Approved: Payload Delta

`createRecipientAccount(...)` now requests both required capabilities:

- `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested = true`
- `configuration.merchant.capabilities.card_payments.requested = true`

This matches the direct Stripe probe result where the full test secret succeeded only after adding merchant `card_payments`.

### Approved: Local Verification

Implementor ran and passed:

- Deno tests: `6 passed`, `0 failed`
- Deno check: exit `0`
- legacy path sweep: only intentional negative assertions
- Deno fmt: checked two files

### Previously Blocked: RAK Still Fails

After the operator reported granting write permissions for all core items, orchestrator re-probed `rak_mingla_onboard` using the corrected payload.

Probe 1:

- Endpoint: `POST /v2/core/accounts`
- Key: `rak_mingla_onboard`
- Payload: corrected merchant+recipient payload
- Result: HTTP `403`
- Request id: `req_v22efW2UF05dZxCj4`

Probe 2 after a propagation wait:

- Endpoint: `POST /v2/core/accounts`
- Key: `rak_mingla_onboard`
- Payload: corrected merchant+recipient payload
- Result: HTTP `403`
- Request id: `req_v2st7HENOen2ntb3W`

Error:

```text
Permission denied. API Key does not have permission to access account.
```

### Cleared: RAK Verified After Permission Update

After the operator adjusted the restricted key permissions again, orchestrator re-ran both required RAK probes.

Account create probe:

- Endpoint: `POST /v2/core/accounts`
- Key: `rak_mingla_onboard`
- Payload: corrected merchant+recipient payload
- Result: HTTP `200`
- Request id: `req_v22r7Ixj142XOsl6x`
- Created disposable sandbox account: `acct_1TUyN4PjlZR6ZGGd`

Account Link probe:

- Endpoint: `POST /v2/core/account_links`
- Key: `rak_mingla_onboard`
- Account: `acct_1TUyN4PjlZR6ZGGd`
- Configurations: `["recipient", "merchant"]`
- Result: HTTP `200`
- Request id: `req_v2BuP3TY5OdHdtnCl`
- URL host: `connect.stripe.com`

## Deployment

Command:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

Result:

```text
Bundling Function: brand-stripe-onboard
Deploying Function: brand-stripe-onboard (script size: 85.7kB)
Deployed Functions on project gqnoajqerqhnvulmnyvv: brand-stripe-onboard
```

Post-deploy function list:

```text
brand-stripe-onboard | ACTIVE | 8 | 2026-05-09 00:04:23
brand-mingla-tos-accept | ACTIVE | 4 | 2026-05-08 21:27:58
```

## Required Tester Action

Dispatch `$tester` for the `Stripe Wise 2` runtime retest.

Fixture:

```text
User: sethogieva@icloud.com
Brand: Stripe Wise 2
Brand id: 81fd06bc-f31d-43e2-8189-b5a2a297cfee
Simulator: Mingla Stripe Retest ORCH-0764A / 5D6FFB79-E1AE-40E2-82B8-66E1D87CA330
```

Tester must verify:

- valid auth session;
- repeat ToS returns HTTP `200` with `already_accepted: true`;
- `brand-stripe-onboard` returns HTTP `200`;
- response has `client_secret: null`;
- response has `account_id: acct_...`;
- response has Stripe-hosted `onboarding_url`;
- opening the URL reaches usable Stripe-hosted onboarding;
- `stripe_connect_accounts` row exists or is safely reused.

## Historical Operator Action

Open Stripe Workbench for:

```text
MINGLA LLC sandbox
acct_1TTnt1PjlZyAYA40
```

Inspect these request ids:

- `req_v22efW2UF05dZxCj4`
- `req_v2st7HENOen2ntb3W`

The permission change must apply to the exact key value used by `rak_mingla_onboard` in `stripe-values.md`, not a different restricted key or the other Stripe account.

If Dashboard says all "Core" resources are already write-enabled, also inspect non-Core/Connect/Accounts v2 permission groups. The successful full-secret probes proved the platform can perform these calls; only the restricted key is blocked.

## Next Gate

User dispatches `$tester` for `Stripe Wise 2` runtime retest.

Do not close ORCH-0764A until tester proves:

- HTTP `200` from `brand-stripe-onboard`;
- `client_secret: null`;
- `account_id: acct_...`;
- Stripe-hosted `onboarding_url`;
- `stripe_connect_accounts` row exists or is safely reused.
