# RETEST ORCH-0764A: Stripe Accounts v2 Hosted Onboarding Runtime

Date: 2026-05-08  
Mode: `$tester` retest  
Verdict: `FAIL`

## Summary

The deployed functions are current and the local/static regression gates pass. After the operator authenticated the dedicated simulator as `sethogieva@icloud.com` and selected brand `Stripe Wise`, runtime testing reached the deployed Stripe onboarding function.

Result: repeat Mingla ToS acceptance is fixed, but Stripe onboarding fails before Account Link creation. The deployed `brand-stripe-onboard` returns HTTP `502` with Stripe's API v2 error: the request did not provide an API version header. No `stripe_connect_accounts` row was created for `Stripe Wise`, and no Stripe-hosted onboarding URL was returned.

This is a runtime blocker for ORCH-0764A. Do not close.

## Simulator Isolation Evidence

Already booted before retest:

- `iPhone 17 Pro` / UDID `17091E60-C3B6-4167-980D-60C348E177F6` / iOS `26.4`

Dedicated retest simulator created:

- Name: `Mingla Stripe Retest ORCH-0764A`
- UDID: `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330`
- Device type: `iPhone 16 Pro`
- Runtime: `iOS 26.4`
- Status: booted
- Existing booted simulator was left running.

Command evidence:

```bash
xcrun simctl create "Mingla Stripe Retest ORCH-0764A" "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro" "com.apple.CoreSimulator.SimRuntime.iOS-26-4"
# 5D6FFB79-E1AE-40E2-82B8-66E1D87CA330

xcrun simctl boot 5D6FFB79-E1AE-40E2-82B8-66E1D87CA330
xcrun simctl list devices booted
```

Observed booted devices:

```text
iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6) (Booted)
Mingla Stripe Retest ORCH-0764A (5D6FFB79-E1AE-40E2-82B8-66E1D87CA330) (Booted)
```

Screenshots:

- `/tmp/mingla-orch-0764a-retest/01-launch.png`
- `/tmp/mingla-orch-0764a-retest/02-after-bundle.png`
- `/tmp/mingla-orch-0764a-retest/03-after-continue-attempt.png`

## Deploy Verification

Command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg "brand-stripe-onboard|brand-mingla-tos-accept"
```

Observed:

```text
brand-stripe-onboard    ACTIVE  version 6  updated 2026-05-08 21:27:51
brand-mingla-tos-accept ACTIVE  version 4  updated 2026-05-08 21:27:58
```

Deploy precondition is satisfied.

## Static Regression Gates

### Supabase Deno Tests

Command:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts
```

Result:

```text
ok | 6 passed | 0 failed
```

### Supabase Deno Check

Command:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts
```

Result:

```text
PASS; command exited 0 with no diagnostics.
```

### Business Jest

Command:

```bash
cd mingla-business
npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand
```

Result:

```text
PASS src/utils/__tests__/onboardReactivation.test.ts
PASS src/utils/__tests__/deriveBrandStripeStatus.test.ts
Test Suites: 2 passed, 2 total
Tests: 15 passed, 15 total
```

Note: Watchman emitted a pre-existing recrawl warning; tests still passed.

### Forbidden-String Sweep

Command:

```bash
rg -n "STRIPE_API_VERSION|apiVersion:|Stripe-Version|stripe\\.accounts\\.create|accountSessions\\.create|connect-onboarding\\?session" supabase/functions/brand-stripe-onboard supabase/functions/_shared/stripeBlueprintClient.ts mingla-business/src/services/brandStripeService.ts -S
```

Result:

```text
supabase/functions/brand-stripe-onboard/index.test.ts:18-22
```

Classification:

- Product path: clean.
- Matches are intentional negative assertions in `brand-stripe-onboard/index.test.ts`.

## Runtime Attempt

Target:

- App: `mingla-business`
- Bundle: `com.sethogieva.minglabusiness`
- Initial brand target from original prompt: `Test Stripe` / `teststripe`
- Updated authenticated target from operator: `Stripe Wise` / `stripewise`
- Runtime brand id: `e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd`
- Authenticated user: `sethogieva@icloud.com`

Actions:

```bash
npx expo start --dev-client --port 8082
```

Port `8082` was already used by another local process, so Expo selected `8085`.

```bash
xcrun simctl install 5D6FFB79-E1AE-40E2-82B8-66E1D87CA330 ios/build/DerivedData/Build/Products/Debug-iphonesimulator/minglabusiness.app
xcrun simctl launch --terminate-running-process 5D6FFB79-E1AE-40E2-82B8-66E1D87CA330 com.sethogieva.minglabusiness --initialUrl 'http://172.20.9.90:8085'
```

Observed:

- App installed and launched on the dedicated simulator.
- Metro bundled successfully.
- Initial fresh simulator was not authenticated into Mingla Business.
- Operator then authenticated as `sethogieva@icloud.com`.
- Screenshot `/tmp/mingla-orch-0764a-retest/04-after-operator-login-stripe-wise.png` shows the app on brand `Stripe Wise`.
- Authenticated REST lookup confirmed:

```json
[
  {
    "id": "e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd",
    "name": "Stripe Wise",
    "slug": "stripewise",
    "deleted_at": null
  }
]
```

## Authenticated Runtime Results

### Mingla ToS Acceptance

Initial ToS acceptance call:

```text
HTTP/2 200
```

Body:

```json
{
  "accepted_at": "2026-05-08T21:41:08.846+00:00",
  "version": "v3-pre-launch-placeholder"
}
```

Repeat ToS acceptance call:

```text
HTTP/2 200
```

Body:

```json
{
  "accepted_at": "2026-05-08T21:41:08.846+00:00",
  "version": "v3-pre-launch-placeholder",
  "already_accepted": true
}
```

Authenticated `brand_team_members` evidence:

```json
[
  {
    "brand_id": "e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd",
    "user_id": "c727d491-4884-4e72-b467-d6c124b9a8b9",
    "role": "account_owner",
    "accepted_at": "2026-05-08T21:39:19.293953+00:00",
    "mingla_tos_accepted_at": "2026-05-08T21:41:08.846+00:00",
    "mingla_tos_version_accepted": "v3-pre-launch-placeholder"
  }
]
```

Verdict for ToS repeat bug: `PASS`.

### Hosted Account Link Response

Deployed `brand-stripe-onboard` call for `Stripe Wise`:

```text
HTTP/2 502
sb-error-code: EDGE_FUNCTION_ERROR
```

Body:

```json
{
  "error": "stripe_api_error",
  "detail": "You did not provide an API version. You need to provide an API version header. Learn more at https://stripe.com/docs/api-v2-overview#sdk-and-api-versioning. For the list of valid versions, see https://docs.stripe.com/changelog"
}
```

Observed `stripe_connect_accounts` after failure:

```json
[]
```

No `account_id`, no `client_secret: null` contract, and no Stripe-hosted `onboarding_url` were returned.

Verdict for hosted Account Link runtime: `FAIL`.

Because Account Link creation failed upstream at Stripe's API v2 version gate, no Stripe-hosted onboarding page could be opened in the simulator.

## Direct Edge Sanity Checks Without User JWT

These are not substitutes for the required authenticated runtime proof. They only confirm the deployed functions return structured unauthenticated responses instead of generic text.

### `brand-mingla-tos-accept`

Command:

```bash
curl -i 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/brand-mingla-tos-accept' \
  -H 'apikey: [anon]' \
  -H 'Authorization: Bearer [anon]' \
  -H 'Content-Type: application/json' \
  --data '{"brand_id":"8f989994-1e6c-42c1-8754-78e1085a960d","version":"v3-pre-launch-placeholder"}'
```

Result:

```json
{"error":"unauthenticated"}
```

HTTP status: `401`.

### `brand-stripe-onboard`

Command:

```bash
curl -i 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/brand-stripe-onboard' \
  -H 'apikey: [anon]' \
  -H 'Authorization: Bearer [anon]' \
  -H 'Content-Type: application/json' \
  --data '{"brand_id":"8f989994-1e6c-42c1-8754-78e1085a960d","return_url":"mingla-business://onboarding-complete","country":"GB"}'
```

Result:

```json
{"error":"unauthenticated"}
```

HTTP status: `401`.

## Findings

### P1: Deployed Accounts v2 onboarding fails at Stripe API version gate

The deployed `brand-stripe-onboard` implementation reaches Stripe, but Stripe rejects the Accounts v2 request because no API version header is supplied.

Evidence:

- Authenticated caller is a payment-managing `account_owner`.
- Mingla ToS is accepted.
- Deployed function returns structured `stripe_api_error`.
- HTTP status is `502`.
- Stripe error states: `You did not provide an API version. You need to provide an API version header.`
- No local `stripe_connect_accounts` row was created.

Impact:

- Organisers cannot start Stripe hosted onboarding.
- ORCH-0764A Account Link contract is not proven.
- `STRIPE_RAK_ONBOARD` scope for `/v2/core/account_links` remains unproven because account creation failed first.

Required rework:

- Reconcile the blueprint instruction "do not guess API version" with Stripe's runtime requirement for Accounts v2.
- Add the exact Stripe API version required for Accounts v2 only from authoritative Stripe guidance or the Stripe Workbench blueprint/runtime context.
- Preserve the no-SDK/no-`accountSessions.create`/no-Mingla-hosted-`/connect-onboarding` contract.
- Add tests that assert the required version header behavior for Accounts v2 once the authoritative version is identified.

### P2: Stripe-hosted onboarding could not be opened

No `onboarding_url` was returned because Stripe rejected account creation. This blocks simulator proof that the user reaches Stripe-hosted onboarding instead of Mingla-hosted `/connect-onboarding`.

### P4: ToS repeat acceptance is fixed

Repeat `brand-mingla-tos-accept` returns HTTP `200` with `already_accepted: true`; the prior generic repeat-accept 500 is no longer reproduced for `Stripe Wise`.

## Unverified Required Checks

- Hosted Account Link response:
  - `client_secret: null`
  - `account_id: acct_...`
  - Stripe-hosted `onboarding_url`
- Opening Stripe-hosted onboarding in iOS.
- Completing synthetic Stripe test onboarding.
- Stripe sandbox logs for `/v2/core/account_links`.
- `stripe_connect_accounts` row state after hosted onboarding.

## Recommendation

Do not close ORCH-0764A yet.

Send back to `$implementor` for the Stripe API v2 version-header blocker. Once fixed and redeployed, retest on the same dedicated simulator and authenticated `Stripe Wise` fixture:

1. repeat ToS acceptance,
2. deployed `brand-stripe-onboard`,
3. open returned `onboarding_url`,
4. verify Stripe-hosted Account Link behavior and Stripe/Supabase state.

The static/deploy side is green and ToS repeat is fixed. The release-blocking gap is now specifically Stripe Accounts v2 runtime versioning.
