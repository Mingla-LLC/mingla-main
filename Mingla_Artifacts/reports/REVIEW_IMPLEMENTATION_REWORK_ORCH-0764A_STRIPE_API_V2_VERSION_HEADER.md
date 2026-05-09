# REVIEW IMPLEMENTATION REWORK ORCH-0764A: Stripe API v2 Version Header

Date: 2026-05-08  
Mode: `$orchestrator` review  
Verdict: `APPROVED FOR DEPLOY`

## Plain-English Impact

The implementation addresses the proven blocker that kept organisers from starting Stripe payout onboarding. The raw Accounts v2 helper now sends the required `Stripe-Version` header, and the tests that previously encoded the wrong no-header contract now assert the corrected behavior.

This does not prove Stripe onboarding is runtime-ready yet. It only clears the local code/test gate and authorizes deploying `brand-stripe-onboard` for a real `Stripe Wise` retest.

## Evidence Reviewed

- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Approved spec: `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Spec review: `Mingla_Artifacts/reports/REVIEW_SPEC_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Runtime fail: `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`
- Changed implementation surfaces:
  - `supabase/functions/_shared/stripeBlueprintClient.ts`
  - `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
  - `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`
  - `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
  - `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`
  - `Mingla_Artifacts/INVARIANT_REGISTRY.md`
  - `.github/scripts/strict-grep/i-proposed-q-stripe-api-version.mjs`

## Findings

### Accepted: Helper Contract Matches Spec

`supabase/functions/_shared/stripeBlueprintClient.ts` now exports:

```ts
export const STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview" as const;
```

and sets:

```ts
headers.set("Stripe-Version", STRIPE_BLUEPRINT_API_VERSION);
```

This matches the approved spec and preserves raw fetch calls to `/v2/core/accounts` and `/v2/core/account_links`.

### Accepted: Regression Tests Encode Corrected Contract

`supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts` now asserts the `Stripe-Version` header for both:

- `createRecipientAccount`
- `createRecipientAccountLink`

The old no-header assertions are gone.

### Accepted: Forbidden Runtime Paths Remain Guarded

The contract sweep matched only intentional negative assertions in `brand-stripe-onboard/index.test.ts`. No runtime/product path reintroduced:

- `stripe.accounts.create`
- `accountSessions.create`
- `connect-onboarding?session`

### Accepted: Docs/Invariants Corrected

The implementation corrected stale operator guidance so future agents do not revive the wrong no-version-header contract.

## Independent Review Gates

### Deno Tests

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Result:

```text
ok | 6 passed | 0 failed (95ms)
```

### Deno Check

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

Result: exit code `0`.

### Business Jest

```bash
cd mingla-business
npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand
```

Result:

```text
Test Suites: 2 passed, 2 total
Tests:       15 passed, 15 total
```

Note: Watchman emitted the known local recrawl warning; tests still passed.

### Contract Sweep

```bash
rg -n "stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Result:

```text
supabase/functions/brand-stripe-onboard/index.test.ts:19:  assertEquals(source.includes("stripe.accounts.create"), false);
supabase/functions/brand-stripe-onboard/index.test.ts:20:  assertEquals(source.includes("accountSessions.create"), false);
supabase/functions/brand-stripe-onboard/index.test.ts:22:  assertEquals(source.includes("connect-onboarding?session"), false);
```

Classification: intentional negative assertions only.

### Diff Check

```bash
git diff --check
```

Result: exit code `0`.

## Decision

Approved for sandbox edge-function deploy:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

No DB push is required. Do not deploy `brand-mingla-tos-accept`; it was not changed by this rework.

## Remaining Gates

After deploy, dispatch `$tester` for runtime retest on `Stripe Wise`:

- repeat Mingla ToS acceptance remains HTTP `200` with `already_accepted: true`;
- `brand-stripe-onboard` returns HTTP `200`;
- response has `client_secret: null`;
- response has `account_id` beginning `acct_`;
- response has a Stripe-hosted `onboarding_url`;
- URL is not `business.usemingla.com/connect-onboarding`;
- opening URL reaches usable Stripe-hosted onboarding;
- `stripe_connect_accounts` row is created or safely reused.

ORCH-0764B remains paused until ORCH-0764A deployed runtime and account-readiness handling are proven.
