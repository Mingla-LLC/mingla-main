# INVESTIGATION ORCH-0764A: Stripe Accounts v2 Key/Context Runtime Failure

Date: 2026-05-08  
Mode: `$forensics`  
Verdict: `ROOT CAUSE PROVEN - PAYLOAD GAP + RAK PERMISSION GAP`

## Executive Summary

`Stripe Wise 2` reaches the live Stripe call path, but payout onboarding still fails before Mingla creates a connected-account row or returns a Stripe-hosted onboarding URL.

The exact failing boundary is `POST /v2/core/accounts`, not `POST /v2/core/account_links`. The code creates the Stripe Accounts v2 account first, writes `stripe_connect_accounts` only after that succeeds, then creates the Account Link. Tester proved the row remains `[]` after the 502, so the failure happens before persistence and before Account Link creation.

Direct Stripe probes on 2026-05-08 proved two active blockers:

1. `rak_mingla_onboard` cannot call `POST /v2/core/accounts` or `POST /v2/core/account_links`; both return Stripe `403 forbidden`.
2. The current account-create payload is also incomplete for Stripe's current Accounts v2 contract: requesting `configuration.recipient.capabilities.stripe_balance.stripe_transfers` requires also requesting `configuration.merchant.capabilities.card_payments`.

The full test secret from the same Stripe account succeeds with the corrected payload and can create a hosted Account Link. Therefore the Stripe account/product access is valid; the RAK permissions and Mingla payload must be fixed.

Do not start ORCH-0764B checkout until ORCH-0764A produces HTTP `200`, `client_secret: null`, `account_id: acct_...`, a Stripe-hosted `onboarding_url`, and a persisted/reused `stripe_connect_accounts` row for brand `81fd06bc-f31d-43e2-8189-b5a2a297cfee`.

## Current Behavior

Runtime fixture from tester:

| Field | Value |
|---|---|
| User | `sethogieva@icloud.com` |
| User id | `c727d491-4884-4e72-b467-d6c124b9a8b9` |
| Brand | `Stripe Wise 2` |
| Slug | `stripewise2` |
| Brand id | `81fd06bc-f31d-43e2-8189-b5a2a297cfee` |
| Simulator | `Mingla Stripe Retest ORCH-0764A` / `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330` |

Tester proved:

- `GET /auth/v1/user` returned HTTP `200`.
- Brand lookup returned `Stripe Wise 2`.
- Initial Mingla ToS acceptance returned HTTP `200`.
- Repeat Mingla ToS acceptance returned HTTP `200` with `already_accepted: true`.
- Pre-onboarding `stripe_connect_accounts` row was `[]`.
- `brand-stripe-onboard` returned HTTP `502`.

Observed Stripe error:

```json
{
  "error": "stripe_api_error",
  "detail": "Permission denied. API Key does not have permission to access account. To make an authorized request, make sure that the API Key making the request has the correct permissions for the resource in the API call. In some cases, you may also need to supply an Account ID in the Stripe-Context header."
}
```

Post-failure:

- `stripe_connect_accounts` row remains `[]`.
- No `account_id`.
- No hosted onboarding URL.

Evidence: `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_RUNTIME.md:219-308`.

## Intended Behavior

ORCH-0764A should:

1. Accept/verify Mingla platform ToS.
2. Create a Stripe Accounts v2 connected/recipient account through `POST /v2/core/accounts`.
3. Persist or reuse `stripe_connect_accounts` for the brand.
4. Create a hosted Stripe Account Link through `POST /v2/core/account_links`.
5. Return:

```json
{
  "client_secret": null,
  "account_id": "acct_...",
  "onboarding_url": "https://..."
}
```

## Exact Failing Request Boundary

### Proven: failure is `POST /v2/core/accounts`

`brand-stripe-onboard` sequence:

- Reads existing `stripe_connect_accounts` row at `supabase/functions/brand-stripe-onboard/index.ts:224-229`.
- If no row exists, creates the Stripe account through `createRecipientAccount(...)` at `index.ts:293-301`.
- If account creation throws, returns `stripe_api_error` at `index.ts:302-311`.
- Only after successful account creation does it upsert `stripe_connect_accounts` at `index.ts:315-346`.
- Only after persistence does it call `createRecipientAccountLink(...)` at `index.ts:349-366`.

The helper maps `createRecipientAccount(...)` to:

- `POST /v2/core/accounts`
- env selection `["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]`
- `Stripe-Version: 2026-04-22.preview`
- idempotency key

Evidence: `supabase/functions/_shared/stripeBlueprintClient.ts:60-77`, `:104-145`.

Tester observed no `stripe_connect_accounts` row after the failure. Since the row is written between account creation and Account Link creation, the Account Link request was not reached.

## Key/Env Selection Path

Mingla code resolves Stripe credentials in `resolveStripeKey(...)`:

- Iterate env var names in order.
- Return the first non-empty value.
- Throw only if none are set.

Evidence: `supabase/functions/_shared/stripeBlueprintClient.ts:31-43`.

For both Accounts v2 account creation and Account Link creation, the env order is:

```ts
envVarNames: ["STRIPE_RAK_ONBOARD", "STRIPE_SECRET_KEY"]
```

Evidence:

- Account create: `supabase/functions/_shared/stripeBlueprintClient.ts:107-111`
- Account link create: `supabase/functions/_shared/stripeBlueprintClient.ts:157-161`

The runtime error proves some Stripe key is present, because Stripe receives the request and returns an authorization/context error rather than Mingla returning "environment variable is not set."

What cannot be proven from local code alone:

- Whether deployed Supabase currently has `STRIPE_RAK_ONBOARD` set.
- Whether that value is an `rk_test_...` restricted key, an accidental full key, or a stale key.
- Which exact Stripe Dashboard resource permission is missing.

Given the runbook's production-like instruction, the expected deployed path is `STRIPE_RAK_ONBOARD`.

Evidence: `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md:35-45`, `:136-143`, `:208-209`.

## Stripe Docs Findings

Official Stripe docs reviewed:

- API v2 overview: `https://docs.stripe.com/api-v2-overview`
- Accounts v2 create: `https://docs.stripe.com/api/v2/core/accounts/create`
- Account Links v2 create: `https://docs.stripe.com/api/v2/core/account-links/create`
- Stripe Context: `https://docs.stripe.com/context`
- Restricted API keys: `https://docs.stripe.com/keys/restricted-api-keys`
- Stripe-hosted recipient creation: `https://docs.stripe.com/global-payouts/stripe-hosted-recipient-creation`

### API v2 versioning

Stripe says all raw requests to `/v2` must include `Stripe-Version`. Mingla now does this through `STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview"` and tests assert the header.

Evidence:

- Stripe API v2 overview.
- `supabase/functions/_shared/stripeBlueprintClient.ts:10`, `:68`.
- Test: `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts:49-88`, `:90-128`.

Conclusion: the previous version-header blocker is cleared in local code and runtime reached the next Stripe authorization gate.

### Accounts v2 account creation

Stripe's Accounts v2 create API creates an Account representing a company, individual, or other entity. The API supports `configuration.customer`, `configuration.merchant`, and `configuration.recipient`. The `merchant` configuration enables a connected account to collect payments facilitated by a Connect platform; `recipient` supports payout/recipient flows.

Mingla currently creates a recipient-configured account with:

- `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested = true`
- `dashboard = "express"`
- application responsibilities for fees/losses
- `identity.country`
- includes for recipient, merchant, identity, defaults, customer

Evidence:

- Stripe Accounts v2 create docs.
- `supabase/functions/_shared/stripeBlueprintClient.ts:112-143`.

### Account Link creation

Stripe's Account Links v2 create API requires:

- `account`: account id to create link for
- `use_case`
- `use_case.account_onboarding.configurations`
- `refresh_url`
- optional `return_url`

The API docs list valid configurations: `customer`, `merchant`, `recipient`.

Evidence:

- Stripe Account Links create docs.
- `supabase/functions/_shared/stripeBlueprintClient.ts:162-171`.

Stripe-hosted recipient creation docs show recipient-only account-link onboarding for global-payout recipient collection. The Workbench marketplace blueprint copied into ORCH-0764A uses `["recipient", "merchant"]`. Because runtime fails before Account Link creation, there is no evidence yet that `["recipient", "merchant"]` is wrong for Mingla's marketplace goal. Do not change this payload until account creation succeeds and Account Link creation is tested.

### Restricted API keys

Stripe says restricted API keys are drop-in replacements for secret keys but only for permissions explicitly assigned. If a restricted key lacks permissions for a request, Stripe returns an invalid request error. Stripe recommends reviewing Workbench/request logs and adding permissions based on failed API calls.

Evidence: Stripe restricted API key docs.

Mingla's runbook maps `brand-stripe-onboard` to:

- `POST /v2/core/accounts`
- `POST /v2/core/account_links`
- Connect -> Accounts Write
- Connect -> Account links Write
- Connect -> Accounts Read

Evidence: `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md:35-45`.

The live error says the key lacks permission or context. This means the operator must inspect Stripe Workbench/request logs for the exact failed request and missing permission. The local runbook scope names might not map exactly to the current Dashboard's Accounts v2 resource naming, or the key might be organization-scoped/account-scoped differently than assumed.

### Stripe-Context

Stripe says API requests execute by default on the Stripe account that generated the API key. `Stripe-Context` is used to perform an API request in the context of a related account. If a request targets an account other than the key owner, the intended account must be identified with `Stripe-Context`.

Evidence: Stripe Context docs.

Implications for Mingla:

- For an account-level platform key creating a new connected/recipient account, no connected-account context can exist yet. Adding the would-be connected account id is impossible.
- For an organization-level key, `Stripe-Context` may be required to select the platform account context even for platform-level create calls.
- For Account Link creation, the body already includes the connected account id, but `Stripe-Context` may still be required if the API key is owned above the platform account or outside the target account context.

Conclusion: Do not blindly add `Stripe-Context` because the generic Stripe error mentions it. First classify the deployed key owner/scope in Stripe Dashboard. If the key is account-level for the platform account, fix RAK permissions. If the key is organization-level, either replace it with an account-level platform RAK or implement an explicit, non-secret `STRIPE_CONTEXT_ACCOUNT_ID` env header path.

## Payload/Architecture Findings

### Mobile/business app

The frontend invokes `brand-stripe-onboard` with:

```ts
{ brand_id: brandId, return_url: returnUrl, country }
```

Evidence: `mingla-business/src/services/brandStripeService.ts:43-57`.

No frontend issue is implicated by the current failure.

### Edge function

The edge function gates correctly before Stripe:

- Auth with Supabase JWT.
- Payment-management role check via `biz_can_manage_payments_for_brand`.
- Mingla ToS check.
- Existing connected-account reuse.
- Brand lookup.
- Stripe account creation.

Evidence: `supabase/functions/brand-stripe-onboard/index.ts:174-312`.

### Schema/RLS

`biz_can_manage_payments_for_brand` allows brand admin-plus or `finance_manager`.

Evidence: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:3059-3073`.

`stripe_connect_accounts` exists with `brand_id`, `stripe_account_id`, status booleans, requirements, and later additive fields.

Evidence: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:9745-9757`.

Authenticated RLS allows brand payment managers to manage `stripe_connect_accounts`.

Evidence: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:14110`.

The trigger mirrors canonical `stripe_connect_accounts` into `brands.stripe_*`.

Evidence: `supabase/migrations/20260508000000_b2a_stripe_connect_onboarding.sql:101-126`.

No schema/RLS blocker is implicated by this runtime failure.

### Tests

Current local gates pass:

```text
deno test _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
ok | 6 passed | 0 failed
```

`deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts` exited `0`.

Current test gaps:

- No test proves `STRIPE_RAK_ONBOARD` is preferred over `STRIPE_SECRET_KEY`.
- No test proves behavior when a present RAK fails with Stripe permission errors.
- No test captures a non-secret operation/path code in returned/logged errors.
- No test covers optional `Stripe-Context` behavior if the deployed key is organization-level.

## Root-Cause Classification

| Candidate | Status | Evidence |
|---|---|---|
| Missing/invalid Mingla auth | Ruled out | Tester proved HTTP `200` auth after re-login. |
| Missing Mingla ToS acceptance | Ruled out | Initial and repeat ToS both returned HTTP `200`; DB member evidence includes `mingla_tos_accepted_at`. |
| Missing Stripe API v2 version header | Ruled out as current blocker | Runtime no longer returns the version-header error; helper sets `Stripe-Version`. |
| Wrong frontend request shape | Ruled out | Frontend invokes correct edge function body; edge reaches Stripe. |
| DB/RLS persistence failure | Ruled out for current failure | No row is attempted until account creation succeeds. |
| Account Link payload/config failure | Not reached | Row remains `[]`; account creation fails first. |
| `STRIPE_RAK_ONBOARD` under-scoped | Proven | Direct probe with `rak_mingla_onboard` returned `403 forbidden` for account create and Account Link. |
| Organization-level key requiring `Stripe-Context` | Ruled out as primary | Same RAK with `Stripe-Context: acct_1TTnt1PjlZyAYA40` still returned `403 forbidden`. |
| Account-create payload missing merchant card-payments capability | Proven | Full secret with current payload returned `capability_not_available_without_other_capability`; corrected payload returned HTTP `200`. |

## Direct Stripe Probe Evidence

All probes were run against test mode account `MINGLA LLC sandbox` / `acct_1TTnt1PjlZyAYA40`. No secrets were printed.

| Probe | Key | Payload | Result | Request id |
|---|---|---|---|---|
| Account create | `rak_mingla_onboard` | current Mingla payload | `403 forbidden` | `req_v2nzirvxkRTNpBsH3` |
| Account create + `Stripe-Context` | `rak_mingla_onboard` | current Mingla payload | `403 forbidden` | `req_v2iex2LikNEZROQ8r` |
| Account create | full test secret | current Mingla payload | `400 capability_not_available_without_other_capability` | `req_v2t6vWkJlKjZfZZwZ` |
| Account create | `rak_mingla_onboard` | corrected merchant+recipient payload | `403 forbidden` | `req_v2li5e6mHGuG4xzqm` |
| Account create | full test secret | corrected merchant+recipient payload | `200`, created disposable test account `acct_1TUxzxPjlZOkdbdZ` | `req_v2dxwCf6Vyru9Y8fe` |
| Account Link create | `rak_mingla_onboard` | `["recipient", "merchant"]` for disposable account | `403 forbidden` | `req_v28HEcg1uvi7Zg8ve` |
| Account Link create | full test secret | `["recipient", "merchant"]` for disposable account | `200`, host `connect.stripe.com` | `req_v2TJCmaHbxdllEaTX` |

Conclusion: the platform and Account Link configuration work with sufficient permissions and corrected account-create payload. `rak_mingla_onboard` lacks the permissions required for both ORCH-0764A Stripe v2 operations.
| Stripe platform lacks Accounts v2/hosted recipient access | Plausible secondary | Accounts v2/global-payout recipient APIs may require preview/product access. Workbench logs/Dashboard can confirm after key scope is checked. |

## Blast Radius

| Area | Impact |
|---|---|
| Mingla Business app | User remains blocked at "Connect Stripe"; no hosted onboarding page opens. |
| Edge functions | `brand-stripe-onboard` fails at Stripe account creation. Other Stripe functions are not implicated by this investigation. |
| Supabase data | No accidental `stripe_connect_accounts` row is created for `Stripe Wise 2`. |
| Stripe Dashboard/key config | Primary fix surface: restricted key permissions/account context/product access. |
| Runbooks | RAK runbook likely needs a clarification: for Accounts v2, operator must verify exact Dashboard permission names via Workbench logs, not rely only on old generic Connect scope labels. |
| Tests | Need a small test hardening pass for key preference, error diagnostics, and conditional context if implemented. |
| ORCH-0764B checkout | Must remain paused; checkout depends on a connected seller account. |

## Non-Goals

- Do not implement ORCH-0764B checkout.
- Do not replace the Accounts v2 blueprint with legacy `stripe.accounts.create`.
- Do not return to embedded `accountSessions.create`.
- Do not change `["recipient", "merchant"]` based only on hosted-recipient docs; the Account Link call has not been reached.
- Do not print or persist Stripe key values.
- Do not add automatic fallback from an under-scoped RAK to a full secret key in product code.

## Recommended Next Move

Proceed with `SPEC_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_KEY_CONTEXT.md`.

The fastest safe path is now:

1. Implementor updates account-create payload to include `configuration.merchant.capabilities.card_payments.requested = true`.
2. Operator updates `rak_mingla_onboard` permissions so it can call both `/v2/core/accounts` and `/v2/core/account_links`.
3. Tester retests `Stripe Wise 2`.
