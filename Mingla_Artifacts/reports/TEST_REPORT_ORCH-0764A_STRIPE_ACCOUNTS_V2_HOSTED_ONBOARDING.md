# TEST REPORT ORCH-0764A: Stripe Accounts v2 Hosted Onboarding

Date: 2026-05-08  
Mode: `$tester`  
Verdict: FAIL  

## Verdict Summary

ORCH-0764A passes focused static, unit, and type-check verification for the local hosted Accounts v2 onboarding slice, but the runtime/deployed onboarding path fails the close gate.

No P0/P1 release blockers were found in the local implemented code path. However, simulator runtime against the deployed Supabase project proves the currently deployed onboarding function is not serving the ORCH-0764A Accounts v2 hosted Account Link contract and the user-facing returned onboarding page errors during authentication.

It is not closeable or production-ready because:

- Deployed runtime does not match the ORCH-0764A local implementation.
- Deployed onboarding returned a non-null client secret and a Mingla-hosted `/connect-onboarding` URL instead of a Stripe-hosted Account Link URL.
- Opening the returned onboarding URL in the iOS simulator showed an authentication error.
- `STRIPE_RAK_ONBOARD` Accounts v2/account-link permissions are still not proven against Stripe.
- Accounts v2 capability/status event handling remains unresolved.
- The full `supabase/functions` Deno suite still fails on unrelated ambient type debt before runtime.

## Sources Reviewed

- `Mingla_Artifacts/prompts/TESTER_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING.md`
- `supabase/functions/_shared/stripeBlueprintClient.ts`
- `supabase/functions/brand-stripe-onboard/index.ts`
- `supabase/functions/_shared/idempotency.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
- `supabase/functions/brand-stripe-onboard/index.test.ts`
- `supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts`
- `mingla-business/src/services/brandStripeService.ts`
- `mingla-business/src/components/brand/BrandOnboardView.tsx`
- `docs/runbooks/B2_RAK_MIGRATION_RUNBOOK.md`
- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md`

External reference checked:

- Stripe Accounts v2 Account Links API: https://docs.stripe.com/api/v2/core/account-links/create?api-version=2026-04-22.preview

## Claim Verification

| Claim | Result | Evidence |
|---|---|---|
| Uses `POST /v2/core/accounts` | Verified | `stripeBlueprintClient.ts:103-106` |
| Uses `POST /v2/core/account_links` | Verified | `stripeBlueprintClient.ts:153-156` |
| Account payload requests recipient Stripe transfers | Verified | `stripeBlueprintClient.ts:109-118` |
| Account payload sets application fee/loss responsibilities | Verified | `stripeBlueprintClient.ts:122-127` |
| Account payload sets `dashboard = "express"` | Verified | `stripeBlueprintClient.ts:128` |
| Account payload includes required include array | Verified | `stripeBlueprintClient.ts:129-135` |
| Account payload sets `identity.country` | Verified | `stripeBlueprintClient.ts:136-138` |
| Account Link payload sets account onboarding use case | Verified | `stripeBlueprintClient.ts:158-167` |
| No `Stripe-Version` header in helper | Verified | helper headers at `stripeBlueprintClient.ts:61-67`; focused tests assert absent |
| No SDK `apiVersion` in onboarding path | Verified | `brand-stripe-onboard/index.ts` imports helper only; focused source test passes |
| Old `stripe.accounts.create` removed from `brand-stripe-onboard` | Verified | source grep + `brand-stripe-onboard/index.test.ts:13-16` |
| Old `accountSessions.create` removed from `brand-stripe-onboard` | Verified | source grep + `brand-stripe-onboard/index.test.ts:13-16` |
| Existing auth/permission/ToS gates remain | Verified | auth `index.ts:174-184`; permission `189-203`; ToS `205-222` |
| Existing persistence remains | Verified | `stripe_connect_accounts` read/reuse `224-269`; upsert `315-346` |
| Business app can tolerate `client_secret: null` | Verified | service type `brandStripeService.ts:21-25`; UI opens `result.onboarding_url` at `BrandOnboardView.tsx:202-205` |
| Runbooks avoid hard-coded real keys | Verified | placeholders only, e.g. `B2_RAK_MIGRATION_RUNBOOK.md:125-141` |
| Runbooks avoid ORCH-0764 API-version pin | Verified | `B2_GO_LIVE_CHECKLIST.md:53`; `B2_RAK_MIGRATION_RUNBOOK.md:151-157` |

## Commands Run

Focused Supabase Deno tests:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts _shared/__tests__/stripeWebhookRouter.test.ts
```

Result:

- PASS
- 6 passed
- 0 failed

Focused Supabase Deno check:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts _shared/stripeWebhookRouter.ts
```

Result:

- PASS
- command exited 0

Business app focused Jest:

```bash
cd mingla-business
npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand
```

Result:

- PASS
- 2 suites passed
- 15 tests passed
- Watchman recrawl warning emitted; non-test-blocking.

Forbidden-string sweep:

```bash
rg -n "STRIPE_API_VERSION|apiVersion:|Stripe-Version|stripe\.accounts\.create|accountSessions\.create|connect-onboarding\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Result:

- PASS for product path.
- Only expected comments/test assertions matched.

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

- Not caused by ORCH-0764A.
- Blocks using the full Supabase Deno suite as a green close gate until ambient type debt is repaired or explicitly accepted.

## Findings

### P2: Accounts v2 runtime and RAK scope are still unverified

Static tests prove the request shapes, but no sandbox Stripe call was executed. This means the team has not yet proven:

- the Stripe platform has Accounts v2 access,
- `STRIPE_RAK_ONBOARD` has the right scopes,
- `/v2/core/accounts` accepts the account payload in Mingla's sandbox,
- `/v2/core/account_links` returns a usable hosted onboarding URL.

Required before close:

- Deploy to sandbox/staging only after orchestrator authorizes deploy.
- Use a safe test brand and test-mode Stripe key/RAK.
- Confirm returned `onboarding_url` is Stripe-hosted.

### P2: Accounts v2 capability/status event handling remains unresolved

ORCH-0764A did not implement full handling for:

- `v2.core.account[configuration.recipient].capability_status_updated`

The current status refresh/router system still depends on legacy account/capability paths. This is acceptable for this onboarding slice only if ORCH-0764B does not trust checkout readiness until account status is proven.

Required before ORCH-0764 close:

- Either implement and test Accounts v2 status/capability event handling, or record an explicit accepted deferral with a safe checkout gate that blocks paid checkout unless account readiness is proven.

### P2: Production must not silently depend on `STRIPE_SECRET_KEY` fallback

`stripeBlueprintClient.ts` intentionally falls back from `STRIPE_RAK_ONBOARD` to `STRIPE_SECRET_KEY`. This is tolerable for local/staging continuity, but production least-privilege depends on setting `STRIPE_RAK_ONBOARD`.

Required before production:

- Verify `STRIPE_RAK_ONBOARD` is set in deployed Supabase secrets.
- Confirm Stripe logs show the onboarding function using the restricted key, not the full secret.

### P3: Account Link refresh URL is present but not a seamless regeneration endpoint

The implementation sends a refresh URL derived from the app return URL plus `stripe_onboarding_refresh=1`. Stripe's Account Link docs say refresh URLs should attempt to generate a new Account Link and redirect the user back to the Stripe-hosted flow.

Observed:

- The required `refresh_url` field exists.
- A seamless server-side regeneration endpoint is not implemented in ORCH-0764A.
- The existing UI appears able to show retry/session-expired states and let the user start again.

Recommendation:

- Treat this as acceptable for sandbox testing.
- Before production polish, consider a web refresh endpoint that regenerates an Account Link and redirects automatically.

## Security And Privacy Notes

- No Stripe secret or restricted key values are committed.
- Secret-bearing calls remain server-side in Supabase Edge Functions.
- No client-side Stripe secret use was introduced.
- `brand-stripe-onboard` still verifies Supabase auth and enforces payment-management permission before Stripe calls.
- `brand-stripe-onboard` still enforces Mingla ToS acceptance before Stripe calls.
- Stripe error messages are returned as `stripe_api_error.detail`; this matches the existing function pattern, but production observability should monitor for overly detailed upstream messages.

## Deployment / Runtime Recommendation

Safe to deploy to sandbox for controlled runtime verification only after orchestrator approves deploy.

Do not deploy to production or close ORCH-0764A until:

- tester/orchestrator accepts sandbox runtime evidence or explicit runtime deferral,
- `STRIPE_RAK_ONBOARD` scope is confirmed,
- Accounts v2 platform access is confirmed,
- ORCH-0764A files are committed/pushed under orchestrator close protocol.

## Runtime Addendum: iOS Simulator Test Brand Attempt

Date: 2026-05-08  
Device: iPhone 17 Pro simulator, iOS 26.4  
Target app: `mingla-business` development build, bundle `com.sethogieva.minglabusiness`  
Brand observed in simulator: `Test Stripe` (`teststripe`)  
Runtime verdict: BLOCKED/UNVERIFIED for full Stripe onboarding completion

### What was verified

- iOS simulator booted successfully.
- Native debug build initially failed because Sentry source-map upload was enabled without Sentry org/project config.
- Re-running the simulator build with `SENTRY_DISABLE_AUTO_UPLOAD=true` succeeded.
- The app installed and launched on the simulator.
- Expo Dev Launcher was bypassed with `--initialUrl http://localhost:8081`.
- The authenticated app opened to the business home screen for the Stripe test brand.
- The simulator's current brand state points to brand id `8f989994-1e6c-42c1-8754-78e1085a960d`.
- Remote Supabase contained one accessible Stripe-named brand for this user: `Test Stripe`, slug `teststripe`.
- Before onboarding invoke, no `stripe_connect_accounts` row existed for that brand.
- Calling the deployed `brand-stripe-onboard` edge function with the simulator's authenticated session returned HTTP 403:

```json
{
  "error": "forbidden",
  "detail": "mingla_tos_not_accepted"
}
```

- After the failed invoke, no `stripe_connect_accounts` row existed for the brand.

### Runtime findings

#### P2: Full Stripe onboarding is blocked by Mingla ToS acceptance, not by Stripe yet

The deployed function correctly enforced the pre-Stripe Mingla ToS gate and stopped before creating a Stripe account or Account Link.

Evidence:

- `brand-stripe-onboard` returned `403 forbidden` with `detail = mingla_tos_not_accepted`.
- No connected-account row existed before or after the call.
- No `onboarding_url` was returned, so Stripe-hosted onboarding could not be opened or completed.

Required to continue runtime QA:

- The actual operator must accept Mingla ToS for `Test Stripe` in the app.
- Then re-run the simulator onboarding flow and verify the function returns:
  - `client_secret: null`
  - a connected `account_id`
  - a Stripe-hosted `onboarding_url`

#### P2: Accounts v2 / Stripe RAK runtime remains unproven

Because the ToS gate blocked before the Stripe calls, this runtime attempt still did not prove:

- deployed `STRIPE_RAK_ONBOARD` presence,
- RAK scope for `/v2/core/accounts`,
- RAK scope for `/v2/core/account_links`,
- Stripe Accounts v2 platform enablement,
- successful creation of a hosted Stripe Account Link.

This preserves the earlier `CONDITIONAL PASS` condition; it does not close the runtime gap.

#### P3: Test brand naming mismatch

The user referenced `tets stripe`, but the simulator and remote brand list show `Test Stripe` / `teststripe`. I treated `Test Stripe` as the intended test brand because it is the only accessible Stripe-named brand.

### Commands / artifacts from runtime attempt

Representative commands:

```bash
xcrun simctl boot 17091E60-C3B6-4167-980D-60C348E177F6
xcodebuild -workspace ios/minglabusiness.xcworkspace -scheme minglabusiness -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath ios/build/DerivedData build
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild -workspace ios/minglabusiness.xcworkspace -scheme minglabusiness -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath ios/build/DerivedData build
xcrun simctl install booted ios/build/DerivedData/Build/Products/Debug-iphonesimulator/minglabusiness.app
xcrun simctl launch --terminate-running-process booted com.sethogieva.minglabusiness --initialUrl 'http://localhost:8081'
```

Screenshots captured locally:

- `/tmp/mingla-business-stripe-04-initial-url.png` — app launched to `Test Stripe` home.
- `/tmp/mingla-business-stripe-06-initial-route.png` — Expo Dev Launcher confirmation behavior when attempting external deep-link navigation.

### Next retest path

1. Accept Mingla ToS for `Test Stripe` as the real operator in the app.
2. Re-run the simulator onboarding route.
3. Confirm Account Link creation succeeds and opens a Stripe-hosted onboarding URL.
4. Complete Stripe test onboarding manually in the hosted flow.
5. Verify Supabase row persistence and status transitions:
   - `stripe_connect_accounts.account_id` set
   - `dashboard_type = express`
   - `charges_enabled` / `payouts_enabled` reflect Stripe state
   - brand cache derives `onboarding`, `restricted`, or `active` correctly
6. Only then upgrade runtime verdict from `BLOCKED/UNVERIFIED`.

## Runtime Addendum 2: ToS Accepted / Onboarding Retest

Date: 2026-05-08  
Device: iPhone 17 Pro simulator, iOS 26.4  
Target brand: `Test Stripe` (`teststripe`)  
Runtime verdict: FAIL

### What changed since the first attempt

- The brand's Mingla ToS state is now accepted:
  - `mingla_tos_accepted_at` present
  - `mingla_tos_version_accepted = v3-pre-launch-placeholder`
  - role = `account_owner`
  - membership accepted
- A repeat call to `brand-mingla-tos-accept` returned HTTP 500 `"Internal Server Error"`, even though the stored ToS state remained accepted.
- Calling `brand-stripe-onboard` after ToS acceptance returned HTTP 200.
- A `stripe_connect_accounts` row was created for `Test Stripe`.

### Critical runtime result

The deployed onboarding function did **not** return the ORCH-0764A Accounts v2 hosted Account Link contract.

Expected ORCH-0764A runtime contract:

```json
{
  "client_secret": null,
  "account_id": "acct_...",
  "onboarding_url": "https://connect.stripe.com/..."
}
```

Observed deployed runtime contract:

```json
{
  "client_secret_is_null": false,
  "onboarding_url_host": "business.usemingla.com",
  "onboarding_url_path_prefix": "/connect-onboarding"
}
```

This means the simulator is hitting an older deployed onboarding implementation, not the local ORCH-0764A implementation in `supabase/functions/brand-stripe-onboard/index.ts`.

### User-facing result

Opening the returned onboarding URL in the iOS simulator did not reach a usable Stripe onboarding flow.

Observed screen:

- Header: `Mingla — Set up payments`
- Error: `Something went wrong.`
- Detail: `There was an error during authentication.`

Screenshot:

- `/tmp/mingla-business-stripe-07-returned-onboarding-url.png`

### New findings

#### P1: Deployed onboarding backend is stale relative to ORCH-0764A

The deployed `brand-stripe-onboard` behavior returns the old embedded/Mingla-hosted Connect onboarding shape:

- `client_secret` is non-null
- `onboarding_url` points to `business.usemingla.com/connect-onboarding`

This directly contradicts the ORCH-0764A hosted Account Link contract and the Stripe blueprint requirement to create a hosted account link via `/v2/core/account_links`.

Required rework/ops action:

- Deploy the ORCH-0764A `brand-stripe-onboard` and `_shared/stripeBlueprintClient.ts` implementation to the sandbox Supabase project.
- Re-run the simulator flow and confirm the returned URL is Stripe-hosted.
- Do not close ORCH-0764A until deployed runtime matches local code.

#### P1: Returned onboarding page errors during authentication

Even the old deployed flow is not usable: the Mingla-hosted onboarding page returned an authentication error in Safari.

Required rework/ops action:

- If the team intentionally keeps any Mingla-hosted onboarding page, investigate why the simulator-authenticated deep link cannot authenticate the web page.
- For ORCH-0764A specifically, this page should be bypassed by returning the Stripe-hosted Account Link URL directly.

#### P2: ToS acceptance endpoint is not idempotent/cleanly observable

After ToS was already accepted, a repeat call to `brand-mingla-tos-accept` returned HTTP 500 `"Internal Server Error"` while the stored ToS row remained accepted.

Required rework:

- Make repeat ToS acceptance idempotent or return a clear non-500 response.
- Ensure failures return structured JSON, not a generic text body.

### State after retest

- `Test Stripe` has a connected-account row.
- The row remains not charge-enabled and not payout-enabled.
- Full Stripe hosted onboarding completion was not reached.
- Accounts v2 RAK scope remains unproven because the deployed function did not call the new Accounts v2 hosted Account Link path.

## ORCH-0764B Recommendation

ORCH-0764B may start after orchestrator review, but with a hard dependency:

- Checkout creation must not assume the connected account is payout/transfer-ready from local row existence alone.
- It must require proven readiness from status refresh/webhook state or block paid checkout.
