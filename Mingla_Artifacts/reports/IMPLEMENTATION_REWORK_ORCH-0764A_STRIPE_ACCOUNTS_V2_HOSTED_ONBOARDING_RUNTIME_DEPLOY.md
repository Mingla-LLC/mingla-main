# IMPLEMENTATION REWORK ORCH-0764A: Stripe Accounts v2 Hosted Onboarding Runtime Deploy

Date: 2026-05-08  
Implementor: Codex `$implementor`  
Status: implemented, partially verified  

## Scope Implemented

Reworked the ORCH-0764A runtime/deploy failure slice only:

- Kept `brand-stripe-onboard` on the local Accounts v2 hosted Account Link path.
- Hardened `brand-mingla-tos-accept` so repeat acceptance no longer returns a generic 500 after ToS is already accepted.
- Added focused regression tests for hosted onboarding source contract, existing connected-account reuse, Stripe v2 Account Link URL return, and ToS repeat/audit behavior.
- Updated the legacy Vercel runbook so it no longer teaches QA to expect `/connect-onboarding?session=...` as the current ORCH-0764A path.

Out of scope and not implemented:

- Buyer Checkout Sessions.
- Order/ticket schema changes.
- `checkout.session.completed` fulfillment.
- Paid checkout UI replacement.
- Stripe Tax, subscriptions, refunds, door payments.
- Edge-function deploy.
- ORCH-0764A close.

## Files Changed

- `supabase/functions/brand-mingla-tos-accept/index.ts`
- `supabase/functions/brand-mingla-tos-accept/index.test.ts`
- `supabase/functions/brand-stripe-onboard/index.test.ts`
- `supabase/functions/_shared/stripeBlueprintClient.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
- `docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME_DEPLOY.md`

Note: several ORCH-0764A files were already untracked/dirty before this rework. I did not revert unrelated dirty work.

## Root Cause Notes

### Deployed/local drift

The iOS runtime failure is still best explained as stale deployed edge-function code or deploy packaging that does not include the local ORCH-0764A helper. Local `brand-stripe-onboard/index.ts` already returns:

```json
{
  "client_secret": null,
  "account_id": "...",
  "onboarding_url": "..."
}
```

and uses:

- `createRecipientAccount`
- `createRecipientAccountLink`
- raw `POST /v2/core/accounts`
- raw `POST /v2/core/account_links`

No deployment was performed in this implementor turn because the rework prompt only authorized deploy after explicit user authorization during the turn.

### Repeat ToS 500

The repeat ToS 500 had a local code flaw:

- `brand-mingla-tos-accept` updated the accepted state first.
- It then called `writeAudit` with the wrong input shape (`actor_user_id`, `target_table`, `metadata`), which does not match `_shared/audit.ts`.
- Audit failure was not caught, so a non-critical audit problem could turn an already-written ToS acceptance into a user-facing 500.

Rework:

- The function now reads current membership ToS state before writing.
- If the same version is already accepted, it returns `200` with existing `accepted_at`, `version`, and `already_accepted: true`.
- If a new acceptance write succeeds but audit insert fails, the function logs the audit failure and still returns the successful acceptance payload.
- Audit input now uses the canonical shape: `user_id`, `brand_id`, `target_type`, `target_id`, `after`.

## Stripe API Operations Preserved

ORCH-0764A local onboarding still uses the blueprint calls:

- `POST /v2/core/accounts`
- `POST /v2/core/account_links`

The Accounts v2 helper still:

- uses raw `fetch`
- sets `Authorization`
- sets `Content-Type`
- sets `Idempotency-Key`
- reads `STRIPE_RAK_ONBOARD`, then `STRIPE_SECRET_KEY` as fallback
- does not initialize a Stripe SDK client
- does not set a Stripe API-version override header

## Existing Connected-Account Row Handling

Local `brand-stripe-onboard` already reused an existing `stripe_connect_accounts.stripe_account_id` before creating a new Accounts v2 account. I added a focused source-contract test proving:

- the existing-account branch runs before account creation,
- `stripeAccountId = existingSca.stripe_account_id` is preserved,
- `createRecipientAccountLink` uses `accountId: stripeAccountId`.

This protects the `Test Stripe` retest shape where the stale deployed function already created a connected-account row.

## Tests And Verification

Focused Supabase tests:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Result:

- PASS
- 6 passed
- 0 failed

Focused Supabase check:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

Result:

- PASS
- command exited 0

Focused business Jest:

```bash
cd mingla-business
npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand
```

Result:

- PASS
- 2 suites passed
- 15 tests passed
- Watchman recrawl warning emitted; non-blocking.

Forbidden-string sweep:

```bash
rg -n "STRIPE_API_VERSION|apiVersion:|Stripe-Version|stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Result:

- Product path is clean.
- Matches are only the intentional negative assertions in `supabase/functions/brand-stripe-onboard/index.test.ts`.

Diff check:

```bash
git diff --check
```

Result:

- PASS
- command exited 0

Broad Supabase Deno suite:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write
```

Result:

- FAIL before runtime on unrelated ambient type-check errors:
  - `_shared/__tests__/bouncer.test.ts:304`
  - `_shared/__tests__/scorer.test.ts:388`
  - `_shared/__tests__/scorer.test.ts:411`
  - `_shared/__tests__/scorer.test.ts:437`
  - `get-person-hero-cards/mapper.test.ts:38`
  - `get-person-hero-cards/mapper.test.ts:39`

Classification:

- Same unrelated ambient failures reported by prior ORCH-0764A tester.
- Not caused by this rework.

## Deploy Status

No deploy was performed.

Reason:

- The rework prompt allowed deploy only if the user explicitly authorized deploy during the implementor turn.
- No explicit deploy authorization was given.

Deploy checklist when authorized:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
```

Because `brand-mingla-tos-accept` changed, deploy it in the same authorized runtime batch:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-mingla-tos-accept --project-ref gqnoajqerqhnvulmnyvv
```

## Post-Deploy Runtime Probe Required

After authorized deploy, tester should rerun the iOS simulator flow for `Test Stripe` and verify:

- `brand-mingla-tos-accept` repeat call returns `200` or otherwise non-500 structured JSON.
- `brand-stripe-onboard` returns HTTP 200 only after auth + role + ToS gates pass.
- response has `client_secret: null`.
- response has `account_id`.
- `onboarding_url` host is Stripe-hosted, not `business.usemingla.com`.
- `onboarding_url` path is not `/connect-onboarding`.
- Stripe sandbox logs show `/v2/core/account_links`.
- Stripe sandbox logs show `/v2/core/accounts` only if a new account is needed.
- `STRIPE_RAK_ONBOARD` scope is sufficient, or the exact Stripe permission error is captured.
- no secret or restricted key value is printed in logs or artifacts.

## Remaining Risks

- Runtime/deployed behavior remains unverified until edge functions are deployed and tester repeats the simulator flow.
- Accounts v2 RAK scope is still unproven at runtime.
- Accounts v2 capability/status event handling remains unresolved for close.
- ORCH-0764B must not infer checkout readiness from `stripe_connect_accounts` row existence alone.

## ORCH-0764B Recommendation

ORCH-0764B remains paused as an implementation track.

It can proceed only after orchestrator explicitly accepts either:

- ORCH-0764A deployed runtime PASS, or
- a documented conditional proceed where checkout blocks paid transactions unless account readiness is proven by status refresh/webhook state.
