# SPEC REWORK ORCH-0764A: Stripe API v2 Version Header

Date: 2026-05-08  
Mode: `$forensics` spec  
Verdict: `READY FOR IMPLEMENTOR REWORK`

## 1. Verdict

ORCH-0764A failed because Mingla encoded the wrong Stripe Accounts v2 versioning contract.

The current raw helper intentionally omits `Stripe-Version`, and its tests assert that omission. Stripe's live runtime rejected the deployed `/v2/core/accounts` request before account creation with: `You did not provide an API version. You need to provide an API version header.`

The implementation can proceed, but only as this bounded rework:

- Send `Stripe-Version: 2026-04-22.preview` on raw ORCH-0764A `/v2` HTTP calls.
- Centralize that value in `supabase/functions/_shared/stripeBlueprintClient.ts` as the raw Accounts v2 blueprint version contract.
- Update tests and docs that currently assert or teach "no `Stripe-Version`."
- Do not change the hosted onboarding architecture, v1/SDK Stripe clients, checkout work, schema, RLS, or business app UI.

The previous prompt `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md` is superseded by this spec. ORCH-0764B remains paused.

## 2. Runtime Failure Being Specified

Tester runtime fixture:

- User: `sethogieva@icloud.com`
- Brand: `Stripe Wise`
- Brand slug: `stripewise`
- Brand id: `e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd`
- Simulator: `Mingla Stripe Retest ORCH-0764A`
- Supabase project: `gqnoajqerqhnvulmnyvv`
- Deployed functions at failure time:
  - `brand-stripe-onboard` ACTIVE version `6`
  - `brand-mingla-tos-accept` ACTIVE version `4`

Proven from `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`:

- repeat `brand-mingla-tos-accept` passes with HTTP `200` and `already_accepted: true`;
- authenticated `brand-stripe-onboard` reaches Stripe;
- Stripe rejects before connected-account creation;
- HTTP response is `502` with `error: "stripe_api_error"`;
- no `stripe_connect_accounts` row exists after failure;
- no `account_id`, `client_secret: null`, or hosted Account Link URL is returned.

## 3. Authoritative Stripe Versioning Evidence

Primary Stripe sources checked:

- `https://docs.stripe.com/api-v2-overview`
- `https://docs.stripe.com/api/v2/core/accounts/create?api-version=preview`
- `https://docs.stripe.com/api/v2/core/account-links/create?api-version=preview`
- `https://docs.stripe.com/api/v2/core/accounts`
- `https://docs.stripe.com/connect/accounts-v2`
- `https://docs.stripe.com/changelog/clover/2025-12-15/accounts-v2`
- `https://docs.stripe.com/api/versioning`

Findings:

1. Stripe's API v2 overview says raw `/v2` namespace API requests must include `Stripe-Version`; SDKs and the Stripe CLI include this automatically, but Mingla is not using either for ORCH-0764A raw fetch calls.
2. Stripe's Accounts v2 API reference says Accounts v2 is broadly available to Connect platforms.
3. Stripe's Accounts v2 changelog entry for `2025-12-15.clover` says Accounts v2 became available for new Connect users and instructs non-SDK integrations to include `Stripe-Version: 2025-12-15.clover` for that upgrade.
4. Stripe's current Connect Accounts v2 guide shows a raw `POST /v2/core/accounts` example with a `Stripe-Version` header.
5. Stripe's current API reference `?api-version=preview` URLs for both create-account and create-account-link redirected during this investigation to `api-version=2026-04-22.preview`.

Resolution:

- The old "no `Stripe-Version`" contract is false for raw `/v2` calls.
- The safest implementation contract for the copied Workbench/preview-style ORCH-0764A raw Accounts v2 blueprint is:

```text
Stripe-Version: 2026-04-22.preview
```

This is intentionally separate from `_shared/stripe.ts`'s SDK-client `STRIPE_API_VERSION = "2026-04-22.dahlia"`. The SDK pin controls existing SDK-based v1 surfaces. The raw blueprint helper controls direct `/v2` HTTP calls.

Operator caveat:

- If Stripe Workbench for the copied blueprint exposes a different exact API version, that Workbench evidence should supersede this value before implementation. Without that additional Workbench evidence, use the current official `?api-version=preview` redirect result: `2026-04-22.preview`.

## 4. Current Mingla Contract Conflicts

Confirmed conflicts:

- `supabase/functions/_shared/stripeBlueprintClient.ts:4-6` says ORCH-0764 forbids guessing/pinning a Stripe API version, so the helper does not set the header.
- `supabase/functions/_shared/stripeBlueprintClient.ts:61-64` builds headers with only `Authorization` and `Content-Type`.
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts:48-62` asserts `Stripe-Version` is `null` for `/v2/core/accounts`.
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts:89-105` asserts `Stripe-Version` is `null` for `/v2/core/account_links`.
- `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md:55-63`, `:359`, and `:427` assert no `Stripe-Version`.
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md:53` says no `STRIPE_API_VERSION` secret is required and the path intentionally leaves Stripe API version unpinned.
- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md:151-154` says the raw helper does not set `Stripe-Version`.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md:2216-2224` is stale against current code and the new raw `/v2` helper contract; it still discusses a prior `2026-04-30.preview` SDK pin and single global version model.
- `.github/scripts/strict-grep/i-proposed-q-stripe-api-version.mjs:15-28` has stale comments about the old global preview pin, though the gate behavior only flags `apiVersion:` literals and does not block a `Stripe-Version` header constant.

Six-field root cause proof:

| Field | Evidence |
|---|---|
| File/line | `supabase/functions/_shared/stripeBlueprintClient.ts:61-64` |
| Exact code/schema | Headers include `Authorization` and `Content-Type`; no `Stripe-Version` header. |
| Current behavior | Deployed `brand-stripe-onboard` calls raw `/v2/core/accounts` without API version. |
| Expected behavior | Raw `/v2` request includes `Stripe-Version` specifying the underlying Stripe API version. |
| Causal chain | Tester action -> `brandStripeService.startBrandStripeOnboarding` -> `brand-stripe-onboard` -> `createRecipientAccount` -> `stripeBlueprintRequest` -> raw Stripe `/v2/core/accounts` fetch without `Stripe-Version` -> Stripe rejects request -> no account row/link created. |
| Verification step | After implementation/deploy, authenticated `Stripe Wise` onboarding returns HTTP `200`, `client_secret: null`, `account_id: acct_...`, Stripe-hosted `onboarding_url`, and creates or reuses a `stripe_connect_accounts` row. |

## 5. Implementation Spec

### 5.1 Stripe Blueprint Helper

File:

- `supabase/functions/_shared/stripeBlueprintClient.ts`

Required changes:

1. Replace the header comment so it no longer says ORCH-0764 forbids a `Stripe-Version` header.
2. Add and export a constant:

```ts
export const STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview" as const;
```

3. In `stripeBlueprintRequest`, set the header for all raw helper calls:

```ts
headers.set("Stripe-Version", STRIPE_BLUEPRINT_API_VERSION);
```

4. Keep existing headers:

- `Authorization: Bearer ${key}`
- `Content-Type: application/json`
- `Idempotency-Key` when provided

5. Do not initialize the Stripe SDK in this helper.
6. Do not import `_shared/stripe.ts` into this helper unless the implementor can prove the SDK constant is the exact same raw `/v2` version contract. Current evidence says it is not: SDK clients use `2026-04-22.dahlia`, raw preview docs resolve to `2026-04-22.preview`.

### 5.2 Account Creation

File:

- `supabase/functions/_shared/stripeBlueprintClient.ts`

Keep `createRecipientAccount` on:

```text
POST /v2/core/accounts
```

Keep the existing ORCH-0764 blueprint payload:

- `configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested: true`
- `display_name`
- `contact_email`
- `defaults.responsibilities.losses_collector: "application"`
- `defaults.responsibilities.fees_collector: "application"`
- `dashboard: "express"`
- `include` containing `configuration.merchant`, `configuration.recipient`, `identity`, `defaults`, `configuration.customer`
- `identity.country`

Do not switch to `stripe.accounts.create` v1.

### 5.3 Account Link Creation

File:

- `supabase/functions/_shared/stripeBlueprintClient.ts`

Keep `createRecipientAccountLink` on:

```text
POST /v2/core/account_links
```

Keep:

- `account`
- `use_case.type: "account_onboarding"`
- `use_case.account_onboarding.configurations: ["recipient", "merchant"]`
- `refresh_url`
- `return_url`

Apply the same `Stripe-Version: 2026-04-22.preview` header as account creation.

### 5.4 Brand Onboarding Edge Function

File:

- `supabase/functions/brand-stripe-onboard/index.ts`

Expected changes:

- Likely none, unless tests need import/source-contract adjustments.

Preserve:

- authenticated caller requirement;
- `biz_can_manage_payments_for_brand` check;
- Mingla ToS gate;
- country allowlist/normalization;
- existing row reuse;
- local soft-detach reactivation;
- `stripe_connect_accounts` upsert after account creation;
- hosted Account Link creation after account id exists;
- response shape:

```json
{
  "client_secret": null,
  "account_id": "acct_...",
  "onboarding_url": "https://..."
}
```

### 5.5 Business App

File:

- `mingla-business/src/services/brandStripeService.ts`

Expected changes:

- None.

The business app invokes the edge function and already expects:

- `client_secret: string | null`
- `account_id: string`
- `onboarding_url: string`

### 5.6 Database/RLS/Migrations

Expected changes:

- None.

This failure occurs before `stripe_connect_accounts` insert/upsert because Stripe rejects account creation. The existing DB/RLS path is not the root cause.

### 5.7 Security/Key Management

Expected changes:

- No new secrets.
- No change to `STRIPE_RAK_ONBOARD` or `STRIPE_SECRET_KEY` fallback order.

Notes:

- Adding `Stripe-Version` does not broaden key permissions.
- `STRIPE_RAK_ONBOARD` permissions for `POST /v2/core/account_links` remain unproven because account creation failed first. Tester must capture the next Stripe error if account creation succeeds but Account Link creation fails.
- Do not log Stripe secret or restricted key values.

## 6. Test Spec

### 6.1 Update Helper Tests

File:

- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`

Required changes:

1. Import or otherwise assert against `STRIPE_BLUEPRINT_API_VERSION`.
2. Rename tests so they no longer say "without version pin."
3. Replace:

```ts
assertEquals(headers.get("Stripe-Version"), null);
```

with:

```ts
assertEquals(headers.get("Stripe-Version"), STRIPE_BLUEPRINT_API_VERSION);
```

for both:

- `createRecipientAccount`
- `createRecipientAccountLink`

4. Preserve existing assertions for:

- URL path;
- method;
- `Idempotency-Key`;
- JSON body shape;
- account link `url` return.

### 6.2 Update Onboarding Source Contract Test

File:

- `supabase/functions/brand-stripe-onboard/index.test.ts`

Required changes:

- Keep assertions that the edge function uses `createRecipientAccount`, `createRecipientAccountLink`, `client_secret: null`, and hosted onboarding audit surface.
- Keep forbidden checks for:
  - `stripe.accounts.create`
  - `accountSessions.create`
  - `connect-onboarding?session`
  - `apiVersion:` in the edge function source
- Do not forbid `Stripe-Version` globally anymore. If the test currently only scans `brand-stripe-onboard/index.ts`, it may remain unchanged for `Stripe-Version` because the header belongs in the shared helper; however, implementor should update naming/comments so the test does not imply the whole ORCH-0764A path must be header-free.
- Keep `STRIPE_API_VERSION` forbidden in `brand-stripe-onboard/index.ts`; raw helper must use `STRIPE_BLUEPRINT_API_VERSION`, not the SDK constant.

### 6.3 Add Optional Source Contract Test For Helper

If implementor wants a stronger guard, add a helper-level source test asserting:

- `STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview"` exists;
- `headers.set("Stripe-Version", STRIPE_BLUEPRINT_API_VERSION)` exists;
- no Stripe SDK import exists in `stripeBlueprintClient.ts`;
- no `apiVersion:` object literal exists in `stripeBlueprintClient.ts`.

This can be folded into existing helper tests if cleaner.

### 6.4 Required Gates

Implementor must run and record exact output:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

```bash
cd mingla-business
npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand
```

```bash
rg -n "stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

```bash
git diff --check
```

Do not include `Stripe-Version` in the forbidden sweep. It is now required for raw `/v2` calls.

## 7. Documentation And Artifact Corrections

Implementor must update stale current docs/artifacts that would mislead the next tester/operator:

1. `docs/runbooks/B2_GO_LIVE_CHECKLIST.md:53`
   - Replace the claim that the ORCH-0764A path leaves Stripe API version unpinned.
   - State no `STRIPE_API_VERSION` secret is required, but raw `/v2` calls send the helper-owned `STRIPE_BLUEPRINT_API_VERSION`.

2. `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md:151-154`
   - Replace the claim that `_shared/stripeBlueprintClient.ts` does not set `Stripe-Version`.
   - Preserve the RAK scoping guidance.

3. `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`
   - Add a supersession note near the top or relevant versioning section.
   - Mark old lines requiring no `Stripe-Version` as superseded by this spec.
   - Do not rewrite unrelated checkout/webhook sections.

4. `Mingla_Artifacts/INVARIANT_REGISTRY.md:2216-2224`
   - Split or amend the invariant so it distinguishes:
     - SDK Stripe clients use `_shared/stripe.ts` and its `STRIPE_API_VERSION`;
     - raw ORCH-0764A Accounts v2 HTTP calls use `_shared/stripeBlueprintClient.ts` and `STRIPE_BLUEPRINT_API_VERSION`;
     - inline `apiVersion:` literals remain forbidden outside the canonical SDK client.

5. `.github/scripts/strict-grep/i-proposed-q-stripe-api-version.mjs`
   - Optional but recommended comment-only correction: update stale rationale that references `2026-04-30.preview` and "single global" versioning. Do not change gate behavior unless a separate review proves it is needed.

6. `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
   - Already marked superseded by orchestrator. Implementor should use the new implementor prompt that cites this spec, not the old prompt directly.

## 8. Deploy Plan

No DB migration is expected.

After orchestrator reviews the implementation report, deploy likely requires only:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

Rationale:

- `brand-stripe-onboard` imports `_shared/stripeBlueprintClient.ts`, so redeploying this function should bundle the helper change.
- `brand-mingla-tos-accept` does not need redeploy unless implementor changes it, which this spec does not require.

Post-deploy verification command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg "brand-stripe-onboard|brand-mingla-tos-accept"
```

Expected:

- `brand-stripe-onboard` has a version newer than `6`.
- `brand-mingla-tos-accept` can remain version `4` if unchanged.

## 9. Tester Retest Contract

After deployment, `$tester` must retest on the authenticated `Stripe Wise` fixture:

- User: `sethogieva@icloud.com`
- Brand: `Stripe Wise` / `stripewise`
- Brand id: `e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd`
- Prefer reusing or recreating a dedicated simulator separate from other chats.

Required checks:

1. Confirm deployed function version changed:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg "brand-stripe-onboard|brand-mingla-tos-accept"
```

2. Confirm repeat `brand-mingla-tos-accept` remains HTTP `200` with `already_accepted: true`.
3. Invoke onboarding through the app or authenticated edge call.
4. Expected `brand-stripe-onboard` result:

```json
{
  "client_secret": null,
  "account_id": "acct_...",
  "onboarding_url": "https://..."
}
```

5. Confirm `onboarding_url` host is Stripe-hosted and is not:

```text
business.usemingla.com/connect-onboarding
```

6. Open the URL in the simulator and verify it reaches usable Stripe-hosted onboarding.
7. Query `stripe_connect_accounts` for the brand and verify row creation or safe reuse.
8. If the next failure is `accounts_v2_access_blocked`, `configs_must_match_to_use_account_links`, restricted-key permission, or another Stripe error, capture the exact error body and classify it as the next ORCH-0764A blocker rather than closing.
9. Do not start or close ORCH-0764B checkout from this retest.

## 10. Risks, Assumptions, Open Questions

Facts:

- Raw `/v2` calls require `Stripe-Version`.
- Mingla's helper currently omits it.
- Tests currently encode the wrong header expectation.
- The runtime failure occurs before local account persistence.

Assumptions:

- `2026-04-22.preview` is the correct current Workbench/preview contract because both checked `?api-version=preview` API reference pages redirected to that version during this investigation.
- The Stripe platform has Accounts v2 enabled enough to reach the API version gate. It may still fail later on account-link permissions, platform enrollment, or RAK scope.

Risks:

- Stripe Workbench may pin the copied blueprint to a different version than the docs preview redirect. Operator should provide Workbench metadata if available.
- A successful account creation may expose the next issue: account-link configuration mismatch or restricted-key scope.
- Existing invariant docs are stale and can mislead future agents unless corrected with the code change.

Open questions:

- Does the current `STRIPE_RAK_ONBOARD` have write permissions for both `/v2/core/accounts` and `/v2/core/account_links` in the sandbox?
- Does Stripe's hosted onboarding accept `configurations: ["recipient", "merchant"]` for the created account shape in this exact platform state?
- Should a later ORCH normalize the older SDK-client `_shared/stripe.ts` comments now that the pin is `2026-04-22.dahlia` and not the historical preview value?

## 11. Non-Goals

Do not implement:

- `stripe.accounts.create` v1;
- `accountSessions.create`;
- Mingla-hosted `/connect-onboarding`;
- ORCH-0764B Checkout Session creation;
- webhook readiness;
- account readiness/capability polling;
- new migrations;
- business app UI changes;
- Stripe dashboard mutations.

## 12. Sources

Official Stripe sources:

- API v2 overview: `https://docs.stripe.com/api-v2-overview`
- Create Account v2 reference: `https://docs.stripe.com/api/v2/core/accounts/create?api-version=preview`
- Create Account Link v2 reference: `https://docs.stripe.com/api/v2/core/account-links/create?api-version=preview`
- Accounts v2 reference: `https://docs.stripe.com/api/v2/core/accounts`
- Connect Accounts v2 guide: `https://docs.stripe.com/connect/accounts-v2`
- Accounts v2 changelog: `https://docs.stripe.com/changelog/clover/2025-12-15/accounts-v2`
- API versioning: `https://docs.stripe.com/api/versioning`

Mingla evidence:

- `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`
- `supabase/functions/_shared/stripeBlueprintClient.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/functions/brand-stripe-onboard/index.test.ts`
- `mingla-business/src/services/brandStripeService.ts`
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`
- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`

## 13. Return To Orchestrator

Implementation can proceed after orchestrator review.

Recommended next handoff:

- Write a new `$implementor` prompt that cites this spec directly.
- Do not use the superseded implementor prompt except as history.
- Keep ORCH-0764B paused until ORCH-0764A passes deployed runtime retest and account readiness is separately proven.

No Stripe dashboard/operator action is required before implementation unless the operator can expose Workbench blueprint metadata with a different exact API version. If that metadata exists, orchestrator should review it before implementation starts.
