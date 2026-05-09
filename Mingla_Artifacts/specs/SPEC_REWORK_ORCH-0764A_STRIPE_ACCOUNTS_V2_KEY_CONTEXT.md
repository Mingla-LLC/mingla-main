# SPEC REWORK ORCH-0764A: Stripe Accounts v2 Key/Context Runtime Failure

Date: 2026-05-08  
Owner mode: `$orchestrator` dispatch after `$forensics`  
Status: `READY FOR IMPLEMENTOR + OPERATOR`

## Goal

Unblock Mingla Business Stripe payout onboarding for `Stripe Wise 2` by fixing both proven Stripe blockers:

1. Mingla's Accounts v2 payload must request `configuration.merchant.capabilities.card_payments` when requesting recipient `stripe_balance.stripe_transfers`.
2. `rak_mingla_onboard` must have permission to call `/v2/core/accounts` and `/v2/core/account_links`.

The fix is complete only when tester proves:

- valid auth for `sethogieva@icloud.com`;
- brand `Stripe Wise 2` / `stripewise2` selected;
- repeat Mingla ToS returns HTTP `200` with `already_accepted: true`;
- `brand-stripe-onboard` returns HTTP `200`;
- response has `client_secret: null`;
- response has `account_id` beginning `acct_`;
- response has a Stripe-hosted `onboarding_url`;
- opening the URL reaches usable Stripe-hosted onboarding;
- `stripe_connect_accounts` row exists or is safely reused for brand id `81fd06bc-f31d-43e2-8189-b5a2a297cfee`.

## Root-Cause Contract

The deployed app failure is at `POST /v2/core/accounts`.

Direct Stripe probes proved:

- `rak_mingla_onboard` returns `403 forbidden` for account create, even with `Stripe-Context`.
- full test secret with the current payload returns `400 capability_not_available_without_other_capability`.
- full test secret with corrected merchant+recipient payload returns `200`.
- full test secret can create `/v2/core/account_links` with `["recipient", "merchant"]`.
- `rak_mingla_onboard` returns `403 forbidden` for `/v2/core/account_links`.

Do not spend this rework on frontend auth, Mingla ToS, DB persistence, Account Link configuration, ORCH-0764B checkout, or embedded onboarding. Those are not the active failure boundary.

Current code path:

```text
mingla-business startBrandStripeOnboarding
  -> brand-stripe-onboard
  -> createRecipientAccount
  -> POST /v2/core/accounts
  -> Stripe permission/context error
  -> no stripe_connect_accounts row
  -> no POST /v2/core/account_links
```

## Required Code Action

File:

- `supabase/functions/_shared/stripeBlueprintClient.ts`

Update `createRecipientAccount(...)` body from recipient-only configuration to merchant+recipient configuration:

```ts
configuration: {
  recipient: {
    capabilities: {
      stripe_balance: {
        stripe_transfers: {
          requested: true,
        },
      },
    },
  },
  merchant: {
    capabilities: {
      card_payments: {
        requested: true,
      },
    },
  },
},
```

Keep:

- `dashboard: "express"`;
- `defaults.responsibilities.losses_collector = "application"`;
- `defaults.responsibilities.fees_collector = "application"`;
- existing `include` list;
- existing `identity.country`;
- existing `Stripe-Version: 2026-04-22.preview`;
- existing idempotency behavior.

Do not switch back to Stripe SDK `accounts.create`.

## Required Operator Actions

### 1. Inspect Stripe Workbench Logs

In Stripe Dashboard test mode:

1. Open Workbench request logs.
2. Filter around `2026-05-08T22:47:50Z` and the failed tester invocation.
3. Find the failed `brand-stripe-onboard` Stripe request.
4. Record, without exposing secrets:
   - request id;
   - endpoint;
   - HTTP status;
   - error type/code/message;
   - API key nickname;
   - whether key is restricted or full secret;
   - whether key is account-level or organization-level;
   - whether Stripe reports a specific missing permission.

Known failed probe request ids:

- `req_v2nzirvxkRTNpBsH3` - RAK account create, current payload, 403.
- `req_v2li5e6mHGuG4xzqm` - RAK account create, corrected payload, 403.
- `req_v28HEcg1uvi7Zg8ve` - RAK account link, 403.

### 2. Verify `STRIPE_RAK_ONBOARD`

In Supabase Edge Function secrets, verify whether `STRIPE_RAK_ONBOARD` is set. Do not print the value.

Expected:

- test/sandbox value is a restricted key;
- key belongs to the same Stripe account/platform intended to create Mingla connected accounts;
- key is not a stale key from a different Stripe account or organization.

Because `_shared/stripeBlueprintClient.ts` chooses `STRIPE_RAK_ONBOARD` before `STRIPE_SECRET_KEY`, a present but under-scoped RAK will block the request. The code must not silently fall through to the full secret on Stripe 403.

### 3. Correct RAK Permissions

1. Open Stripe Dashboard -> Developers -> Restricted keys.
2. Edit the key used by `STRIPE_RAK_ONBOARD`.
3. Add the exact write permissions Workbench says are missing for:
   - Accounts v2 account create: `POST /v2/core/accounts`;
   - Account Links v2 create: `POST /v2/core/account_links`;
   - any included Account v2 fields Stripe requires for the current payload.
4. Save.
5. Wait up to 60 seconds for propagation.
6. Retry `brand-stripe-onboard` with the same `Stripe Wise 2` fixture.

Minimum expected permission intent:

- Accounts / Core Accounts / Connect Accounts equivalent: Write.
- Account Links / Core Account Links equivalent: Write.
- Accounts read equivalent if Stripe requires read for included or reused state.

Use Stripe Dashboard's current resource names. The existing runbook labels (`Connect -> Accounts`, `Connect -> Account links`) are intent labels and may not exactly match the current Accounts v2 Dashboard UI.

### 4. Classify `Stripe-Context`

Use Stripe's official rule:

- API calls execute by default in the account that generated the API key.
- `Stripe-Context` is required when the request targets a related account other than the key owner.

If `STRIPE_RAK_ONBOARD` is an account-level key owned by the Mingla platform account:

- Do not add `Stripe-Context` for account creation.
- Fix permissions/product access.

If `STRIPE_RAK_ONBOARD` is organization-level or owned above/outside the target platform:

- Preferred fix: create/use an account-level restricted key owned by the Mingla platform account and set it as `STRIPE_RAK_ONBOARD`.
- Conditional code fix, only if the operator intentionally must keep an organization-level key: implement explicit `Stripe-Context` header support using a non-secret env var such as `STRIPE_CONTEXT_ACCOUNT_ID=acct_...`.

Do not use a connected account id as context for account creation. The connected account does not exist yet.

### 5. Verify Product/Preview Access

If RAK permissions and context are correct but the request still fails:

1. Confirm the Stripe account has access to Accounts v2 / marketplace connected accounts / hosted recipient creation needed by the Workbench blueprint.
2. Confirm test/sandbox mode is being used consistently.
3. Capture the new Workbench error without secrets and return to orchestrator.

## Diagnostics Hardening

Recommended even if permissions are the main fix, because it reduces future ambiguity.

Files:

- `supabase/functions/_shared/stripeBlueprintClient.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/functions/brand-stripe-onboard/index.test.ts` only if source-contract assertions need updates

Requirements:

1. Add a typed/non-secret error wrapper for failed Stripe blueprint requests:

```ts
class StripeBlueprintRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "StripeBlueprintRequestError";
  }
}
```

2. Throw that error when `response.ok` is false.
3. In `brand-stripe-onboard`, return non-secret operation metadata:

For account create failure:

```json
{
  "error": "stripe_api_error",
  "operation": "create_account",
  "path": "/v2/core/accounts",
  "detail": "..."
}
```

For account link failure:

```json
{
  "error": "stripe_api_error",
  "operation": "create_account_link",
  "path": "/v2/core/account_links",
  "detail": "..."
}
```

4. Do not include API keys, Authorization headers, Stripe account ids beyond the normal response contract, request bodies containing emails, or full raw Stripe payloads in client responses.
5. Logs may include operation/path/status and safe error message. Do not log secrets.

Tests:

- Mock fetch returning `403` for account create and assert the thrown error has `status` and `path`.
- Add source/unit assertion that account-create catch emits/returns `operation: "create_account"`.
- Add source/unit assertion that account-link catch emits/returns `operation: "create_account_link"`.

## Deferred: `Stripe-Context` Support

Do not implement `Stripe-Context` in this rework. Direct probe with `Stripe-Context: acct_1TTnt1PjlZyAYA40` still returned `403`, while full-secret probes proved the platform context/product access works. This is not the active blocker.

Files:

- `supabase/functions/_shared/stripeBlueprintClient.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md` if live rollout instructions mention Stripe secrets

Requirements:

1. Add optional env var:

```text
STRIPE_CONTEXT_ACCOUNT_ID=acct_...
```

2. In `stripeBlueprintRequest`, if `STRIPE_CONTEXT_ACCOUNT_ID` is set and non-empty:

```ts
headers.set("Stripe-Context", stripeContextAccountId);
```

3. Validate shape before use:

- Must start with `acct_`.
- If invalid, throw a local config error before calling Stripe.

4. Use the same context for both:

- `POST /v2/core/accounts`
- `POST /v2/core/account_links`

5. Do not infer context from `accountId` passed to Account Link creation.
6. Do not use `Stripe-Account`; v2 context should use `Stripe-Context` per current Stripe docs.
7. Do not add context by default. Account-level platform RAKs should operate without it.

Tests:

- With `STRIPE_CONTEXT_ACCOUNT_ID` unset, assert no `Stripe-Context` header.
- With `STRIPE_CONTEXT_ACCOUNT_ID=acct_platform123`, assert both account create and account link requests include that header.
- With invalid env value, assert the helper throws before fetch.

## Prohibited Code Changes

- Do not switch back to `stripe.accounts.create`.
- Do not switch back to `accountSessions.create`.
- Do not create a Mingla-hosted `/connect-onboarding` session URL.
- Do not remove `Stripe-Version: 2026-04-22.preview`.
- Do not add automatic runtime fallback from a present RAK to `STRIPE_SECRET_KEY` after Stripe returns 403.
- Do not print or persist Stripe secret/restricted key values.
- Do not implement ORCH-0764B checkout.
- Do not change Account Link configurations from `["recipient", "merchant"]` unless account creation succeeds and Stripe returns a specific Account Link payload/configuration error.

## Test Gates

Run from `supabase/functions` after any code change:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Expected: all pass.

Run:

```bash
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

Expected: exit `0`.

Run static sweep from repo root:

```bash
rg -n "stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Expected:

- no runtime/product matches;
- test-only negative assertions are allowed.

If implementing optional `Stripe-Context`, also run:

```bash
rg -n "Stripe-Account" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts -S
```

Expected: no matches.

## Deployment Instructions

If no code changes are made and only Stripe Dashboard/Supabase secret settings change:

- Do not deploy.
- Proceed directly to tester retest after operator confirms key changes.

If code changes are made:

1. Orchestrator reviews implementor report.
2. Deploy only after orchestrator approval:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

3. Verify active function version:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg "brand-stripe-onboard"
```

## Tester Retest Instructions

Use the existing fixture:

- User: `sethogieva@icloud.com`
- Brand: `Stripe Wise 2`
- Slug: `stripewise2`
- Brand id: `81fd06bc-f31d-43e2-8189-b5a2a297cfee`
- Simulator: `Mingla Stripe Retest ORCH-0764A` / `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330`

Retest steps:

1. Confirm server-valid auth:

```text
GET /auth/v1/user -> HTTP 200, email=sethogieva@icloud.com
```

2. Confirm selected brand is `Stripe Wise 2`.
3. Query pre-onboarding `stripe_connect_accounts` row for the brand.
4. Invoke `brand-mingla-tos-accept`.
5. Invoke `brand-mingla-tos-accept` again and require:

```json
{ "already_accepted": true }
```

6. Invoke `brand-stripe-onboard` with:

```json
{
  "brand_id": "81fd06bc-f31d-43e2-8189-b5a2a297cfee",
  "return_url": "mingla-business://onboarding-complete",
  "country": "GB"
}
```

7. Expected success:

```json
{
  "client_secret": null,
  "account_id": "acct_...",
  "onboarding_url": "https://..."
}
```

8. Open `onboarding_url`; require a Stripe-hosted onboarding surface, not `business.usemingla.com/connect-onboarding`.
9. Query post-onboarding `stripe_connect_accounts`; require row exists or reused for brand id.
10. If Account Link creation fails after account creation, capture:
   - HTTP body;
   - `operation`;
   - `path`;
   - post-failure `stripe_connect_accounts` row;
   - Stripe Workbench request id, without secrets.

## Documentation Updates

If operator confirms the RAK permission names differed from the current runbook, update:

- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`

Required wording:

- `STRIPE_RAK_ONBOARD` must be verified in Stripe Workbench against successful `POST /v2/core/accounts` and `POST /v2/core/account_links`.
- Dashboard permission labels may differ from old generic Connect scope names; use Workbench's failed request/missing permission guidance as source of truth.
- Production should keep least-privilege RAKs; full `STRIPE_SECRET_KEY` fallback is local/staging or temporary operator rollback only.

If `STRIPE_CONTEXT_ACCOUNT_ID` is introduced, also update:

- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`
- any relevant deploy/secret checklist

## Security Guardrails

- Never print `STRIPE_RAK_ONBOARD`, `STRIPE_SECRET_KEY`, or bearer tokens.
- Capture Stripe request ids and key nicknames only.
- Prefer account-level restricted keys over organization-level keys plus context.
- Keep least privilege: do not broaden the onboarding RAK beyond account creation/link creation unless Workbench proves a specific additional permission is needed.
- Do not store Stripe Dashboard screenshots containing key material in repo artifacts.

## Handoff Decision Tree

| Operator finding | Next action |
|---|---|
| Account-level RAK missing Accounts v2 permission | Operator edits RAK, no code change, tester retests. |
| Account-level RAK fixed and onboarding succeeds | Orchestrator can move to tester close gate; ORCH-0764B remains paused until close. |
| Organization-level key requires platform context | Prefer replacing with account-level RAK. If not possible, dispatch implementor for Option B. |
| Workbench shows Account Link failure after account row created | Return to forensics or implementor with new evidence; current spec only clears account-create gate. |
| Workbench shows preview/product access denied | Operator enables/access-requests the required Stripe product/preview, then tester retests. |
| Error persists but Workbench provides no missing permission | Capture request id and exact Stripe error; escalate to Stripe support or return to forensics. |

## Close Criteria

ORCH-0764A is not closed until tester records:

- HTTP `200` from `brand-stripe-onboard`;
- `client_secret: null`;
- `account_id: acct_...`;
- Stripe-hosted onboarding URL opens;
- `stripe_connect_accounts` row exists/reused;
- no legacy `accountSessions.create` or Mingla-hosted onboarding regression;
- no secrets leaked in reports.
