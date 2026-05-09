# IMPLEMENTATION REWORK ORCH-0764A: Stripe API v2 Version Header

Date: 2026-05-08  
Mode: `$implementor`  
Status: `implemented and verified`

## Summary

Implemented the approved ORCH-0764A version-header rework for raw Stripe Accounts v2 calls.

The runtime blocker was that `_shared/stripeBlueprintClient.ts` called Stripe `/v2/core/accounts` and `/v2/core/account_links` without `Stripe-Version`. Stripe rejected the deployed onboarding request before account creation. The helper now sends the approved raw `/v2` version header:

```text
Stripe-Version: 2026-04-22.preview
```

No deploy was performed.

## Source Of Version Contract

Approved source:

- `Mingla_Artifacts/specs/SPEC_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- `Mingla_Artifacts/reports/REVIEW_SPEC_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`

The spec selected `2026-04-22.preview` from current official Stripe API reference preview redirects for Accounts v2 create-account and account-link calls, with the Workbench override caveat recorded in the spec.

## Files Changed

Code/tests:

- `supabase/functions/_shared/stripeBlueprintClient.ts`
  - Added `STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview"`.
  - Sends `Stripe-Version` on every raw blueprint request.
  - Updated helper comment to distinguish raw `/v2` versioning from SDK client versioning.
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
  - Imports `STRIPE_BLUEPRINT_API_VERSION`.
  - Rewrites both old no-header assertions to require the header.
  - Renames tests away from "without version pin."

Docs/artifacts:

- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`
  - Clarifies no `STRIPE_API_VERSION` secret is required, but the raw helper sends `STRIPE_BLUEPRINT_API_VERSION`.
- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
  - Clarifies raw Accounts v2 helper sends `Stripe-Version` and does not initialize an SDK client.
- `Mingla_Artifacts/specs/SPEC_ORCH-0764_STRIPE_ACCOUNTS_V2_CHECKOUT_BLUEPRINT.md`
  - Adds supersession note and updates stale no-header acceptance/test language.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
  - Splits SDK `apiVersion` invariant from raw `/v2` `Stripe-Version` contract.
- `.github/scripts/strict-grep/i-proposed-q-stripe-api-version.mjs`
  - Comment-only rationale update so the gate describes SDK `apiVersion` drift rather than raw `/v2` version headers.

Report:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`

## Explicit Non-Changes

Did not:

- deploy edge functions;
- add or alter migrations;
- change RLS;
- change business app UI;
- start ORCH-0764B checkout;
- use `stripe.accounts.create`;
- use `accountSessions.create`;
- return `business.usemingla.com/connect-onboarding`;
- mutate Stripe Dashboard or Supabase data.

## Verification

### Supabase Deno Tests

Command:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Output:

```text
Check brand-mingla-tos-accept/index.test.ts
Check brand-stripe-onboard/index.test.ts
Check _shared/__tests__/stripeBlueprintClient.test.ts
running 2 tests from ./brand-mingla-tos-accept/index.test.ts
brand-mingla-tos-accept is repeat-safe after accepted state ... ok (1ms)
brand-mingla-tos-accept audit failure does not make accepted ToS fail ... ok (0ms)
running 2 tests from ./brand-stripe-onboard/index.test.ts
brand-stripe-onboard uses Accounts v2 hosted onboarding path ... ok (0ms)
brand-stripe-onboard reuses an existing connected account before creating account link ... ok (0ms)
running 2 tests from ./_shared/__tests__/stripeBlueprintClient.test.ts
createRecipientAccount posts required Accounts v2 payload with blueprint version header ... ok (1ms)
createRecipientAccountLink posts hosted account onboarding payload with blueprint version header ... ok (0ms)

ok | 6 passed | 0 failed (81ms)
```

### Supabase Deno Check

Command:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

Output:

```text
Check brand-stripe-onboard/index.ts
Check _shared/stripeBlueprintClient.ts
Check brand-mingla-tos-accept/index.ts
```

Exit code: `0`.

### Business Jest

Command:

```bash
cd mingla-business
npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand
```

Output:

```text
watchman warning:  Recrawled this watch 5 times, most recently because:
MustScanSubDirs UserDroppedTo resolve, please review the information on
https://facebook.github.io/watchman/docs/troubleshooting.html#recrawl
To clear this warning, run:
`watchman watch-del '/Users/sethogieva/Desktop/mingla-main' ; watchman watch-project '/Users/sethogieva/Desktop/mingla-main'`

PASS src/utils/__tests__/onboardReactivation.test.ts
PASS src/utils/__tests__/deriveBrandStripeStatus.test.ts

Test Suites: 2 passed, 2 total
Tests:       15 passed, 15 total
Snapshots:   0 total
Time:        1.952 s, estimated 2 s
Ran all test suites matching /onboardReactivation.test|deriveBrandStripeStatus.test/i.
```

Classification: pass. Watchman warning is ambient local watcher state, not a test failure.

### Contract Sweep

Command:

```bash
rg -n "stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Output:

```text
supabase/functions/brand-stripe-onboard/index.test.ts:19:  assertEquals(source.includes("stripe.accounts.create"), false);
supabase/functions/brand-stripe-onboard/index.test.ts:20:  assertEquals(source.includes("accountSessions.create"), false);
supabase/functions/brand-stripe-onboard/index.test.ts:22:  assertEquals(source.includes("connect-onboarding?session"), false);
```

Classification:

- Product/runtime path: clean.
- Matches are intentional negative source-contract assertions in `brand-stripe-onboard/index.test.ts`.

### Diff Check

Command:

```bash
git diff --check
```

Output:

```text

```

Exit code: `0`.

### Formatting

Command:

```bash
/Users/sethogieva/.deno/bin/deno fmt supabase/functions/_shared/stripeBlueprintClient.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/brand-stripe-onboard/index.test.ts
```

Output:

```text
Checked 3 files
```

## Deployment

Deployment is required before runtime retest because the deployed `brand-stripe-onboard` function still runs the old helper behavior.

Recommended deploy after orchestrator review:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

No DB push is required. `brand-mingla-tos-accept` does not need redeploy from this rework.

## Tester Retest Instructions

After deploy, tester should retest the authenticated fixture:

- User: `sethogieva@icloud.com`
- Brand: `Stripe Wise`
- Brand slug: `stripewise`
- Brand id: `e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd`

Required runtime proof:

1. `brand-mingla-tos-accept` repeat acceptance remains HTTP `200` with `already_accepted: true`.
2. `brand-stripe-onboard` returns HTTP `200`.
3. Response has `client_secret: null`.
4. Response has `account_id` beginning `acct_`.
5. Response has a Stripe-hosted `onboarding_url`.
6. `onboarding_url` is not `business.usemingla.com/connect-onboarding`.
7. Opening the URL reaches usable Stripe-hosted onboarding.
8. `stripe_connect_accounts` row is created or safely reused.

If the next failure is Accounts v2 access, Account Link configuration, or RAK permission scope, capture the exact Stripe error as the next blocker instead of closing.

## Risks And Notes

- This rework fixes the missing version-header gate. It does not prove Stripe will accept the platform/account-link configuration until deployed runtime retest.
- `STRIPE_RAK_ONBOARD` scope for `/v2/core/account_links` remains unproven because the previous runtime failed at account creation first.
- The worktree already contained unrelated dirty/untracked files before this rework; they were not reverted.

## Return To Orchestrator

Ready for orchestrator review. If accepted, deploy `brand-stripe-onboard`, then dispatch tester retest.
