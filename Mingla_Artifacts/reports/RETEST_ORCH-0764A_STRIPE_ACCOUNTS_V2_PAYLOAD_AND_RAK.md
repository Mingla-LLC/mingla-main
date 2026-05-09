# RETEST ORCH-0764A — Stripe Accounts v2 Payload + RAK

**Date:** 2026-05-08  
**Role:** `$tester`  
**Verdict:** BLOCKED

## Summary

The local regression gates pass and the isolated iOS simulator requirement was satisfied: a fresh simulator was created, booted, built against, installed, and launched without touching the already-booted simulator used by another chat.

Runtime Stripe verification is still blocked because the fresh simulator does not yet have a server-valid Supabase session for the required user `sethogieva@icloud.com`. The previous dedicated simulator's saved token is no longer valid (`/auth/v1/user` HTTP 403, refresh token not found), and the only currently server-valid Mingla Business token found locally belongs to `sethogieva@gmail.com`, so it was not used for the `Stripe Wise 2` fixture.

This is not evidence that the Stripe payload or restricted API key fix failed. It means tester could not reach the authenticated `brand-mingla-tos-accept` → `brand-stripe-onboard` path for the required account.

## Fixture

| Item | Value |
|---|---|
| Required user | `sethogieva@icloud.com` |
| Required brand | `Stripe Wise 2` |
| Brand slug | `stripewise2` |
| Brand id | `81fd06bc-f31d-43e2-8189-b5a2a297cfee` |
| Edge function under test | `brand-stripe-onboard` deployed ACTIVE v8 |
| ToS function | `brand-mingla-tos-accept` deployed ACTIVE v4 |

## Fresh Simulator Evidence

| Item | Evidence |
|---|---|
| New simulator name | `Mingla Stripe Payload RAK Retest ORCH-0764A` |
| New simulator UDID | `CAE0499F-BB4F-4832-82AC-6B45C369084F` |
| Runtime | iOS 26.4 |
| Device type used | iPhone 15, closest available installed type |
| Existing other simulator preserved | `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)` remained booted and was not shut down/erased |
| Bundle id | `com.sethogieva.minglabusiness` |
| Data container | `.../Devices/CAE0499F-BB4F-4832-82AC-6B45C369084F/.../Data/Application/8681DFFB-C0F3-4123-8AC0-5900EB5C9F03` |

Screenshots captured:

- `/tmp/mingla-orch-0764a-payload-rak/isolated-sim-before-launch.png`
- `/tmp/mingla-orch-0764a-payload-rak/isolated-sim-after-launch.png`
- `/tmp/mingla-orch-0764a-payload-rak/isolated-sim-devclient-8084.png`
- `/tmp/mingla-orch-0764a-payload-rak/isolated-sim-app-login.png`

## Build And Install

Initial Expo run attempt was not usable for this isolated simulator because Expo treated the target as a device and failed on signing:

```text
CommandError: No code signing certificates are available to use.
```

Tester switched to direct simulator build:

```bash
xcodebuild -workspace ios/minglabusiness.xcworkspace \
  -scheme minglabusiness \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'id=CAE0499F-BB4F-4832-82AC-6B45C369084F' \
  -derivedDataPath ios/build/ORCH0764A \
  clean build CODE_SIGNING_ALLOWED=NO
```

First native build failed late in the bundle phase due Sentry debug upload configuration, not app or Stripe code:

```text
error: sentry-cli - To disable source maps auto upload, set SENTRY_DISABLE_AUTO_UPLOAD=true
error: An organization ID or slug is required (provide with --org)
** BUILD FAILED **
```

Incremental rebuild succeeded with the Sentry upload disabled:

```bash
SENTRY_DISABLE_AUTO_UPLOAD=true xcodebuild ... build CODE_SIGNING_ALLOWED=NO
```

Result:

```text
** BUILD SUCCEEDED **
```

Install succeeded:

```bash
xcrun simctl install CAE0499F-BB4F-4832-82AC-6B45C369084F \
  ios/build/ORCH0764A/Build/Products/Debug-iphonesimulator/minglabusiness.app
```

## Local Verification Gates

Passed:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write \
  _shared/__tests__/stripeBlueprintClient.test.ts \
  brand-stripe-onboard/index.test.ts \
  brand-mingla-tos-accept/index.test.ts
```

Result:

```text
ok | 6 passed | 0 failed
```

Passed:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno check \
  brand-stripe-onboard/index.ts \
  _shared/stripeBlueprintClient.ts \
  brand-mingla-tos-accept/index.ts
```

Static sweep passed. Matches were only intentional negative assertions in tests:

```text
supabase/functions/brand-stripe-onboard/index.test.ts:19
supabase/functions/brand-stripe-onboard/index.test.ts:20
supabase/functions/brand-stripe-onboard/index.test.ts:22
```

## Auth Findings

The prior dedicated ORCH-0764A simulator still had a cached `Stripe Wise 2` brand id, but its Supabase session is no longer valid:

```text
GET /auth/v1/user
HTTP_STATUS:403
```

Refresh also failed:

```text
POST /auth/v1/token?grant_type=refresh_token
HTTP_STATUS:400
refresh_token_not_found
```

Using that stale token:

```text
POST /functions/v1/brand-mingla-tos-accept
HTTP_STATUS:401
{"error":"unauthenticated"}
```

```text
POST /functions/v1/brand-stripe-onboard
HTTP_STATUS:401
{"error":"unauthenticated"}
```

Anonymous/read-side brand lookup could see `Stripe Wise 2`, but the authenticated edge-function path could not be tested without a valid user bearer token:

```json
[
  {
    "id": "81fd06bc-f31d-43e2-8189-b5a2a297cfee",
    "name": "Stripe Wise 2",
    "slug": "stripewise2",
    "deleted_at": null
  }
]
```

Pre/post `stripe_connect_accounts` remained empty in the unauthenticated blocked run:

```json
[]
```

## Runtime Blocker

The new simulator reached the dev-client launch flow and showed the iOS system sheet:

```text
Open in "mingla-business"?
```

The test session could not synthesize a trusted click on the iOS system sheet. Manual action is required:

1. On simulator `CAE0499F-BB4F-4832-82AC-6B45C369084F`, tap **Open**.
2. Sign in as `sethogieva@icloud.com`.
3. Select/confirm brand `Stripe Wise 2`.
4. Rerun the authenticated checks:
   - `GET /auth/v1/user` must return HTTP 200 with `sethogieva@icloud.com`.
   - `brand-mingla-tos-accept` twice; repeat must return `already_accepted: true`.
   - `brand-stripe-onboard` with country `GB`.
   - Open the returned `onboarding_url` and verify official Stripe-hosted Connect onboarding.
   - Query `stripe_connect_accounts` and verify the row matches returned `account_id`.

## Tester Verdict

**BLOCKED**, because auth/simulator interaction prevented reaching the Stripe path on the fresh isolated simulator.

Do not mark ORCH-0764A as failed from this retest alone. The latest verified backend state before this tester pass remains:

- Direct RAK probe for corrected `/v2/core/accounts`: HTTP 200.
- Direct RAK probe for `/v2/core/account_links`: HTTP 200.
- `brand-stripe-onboard` deployed ACTIVE v8.
- Local payload/unit/static gates pass.

The next retest should start from the already-created simulator `CAE0499F-BB4F-4832-82AC-6B45C369084F` after manual sign-in as `sethogieva@icloud.com`.

## 2026-05-09 Phone Build Follow-Up

The user's physical iPhone run loaded the Mingla Business bundle correctly and reached the Stripe onboarding mutation for brand `81fd06bc-f31d-43e2-8189-b5a2a297cfee`.

Observed Metro/device output:

```text
ERROR [useStartBrandStripeOnboarding] failed {
  "brandId": "81fd06bc-f31d-43e2-8189-b5a2a297cfee",
  "message": "Edge Function returned a non-2xx status code"
}
```

Additional warnings were observed:

```text
WARN Require cycle: AuthContext.tsx -> ...
WARN [ReferenceError: Property 'document' doesn't exist]
```

Tester classification:

- The require-cycle warnings are pre-existing app architecture warnings and are not the direct Stripe onboarding blocker.
- The `document` warning is likely from `mingla-business/app/connect-onboarding.tsx`, which imports Stripe's web Connect SDK at module scope. Expo Router can evaluate web routes during native bundling; that web-only route should be isolated or converted to dynamic web-only imports. This is a separate cleanup item from the edge-function non-2xx.
- The real Stripe blocker is now the edge function returning non-2xx, but the client only surfaced Supabase's generic wrapper error.

Database probe before Supabase CLI pooler throttling found a `stripe_connect_accounts` row for the brand:

```text
brand_id: 81fd06bc-f31d-43e2-8189-b5a2a297cfee
stripe_account_id: acct_1TUzsvPjlZplCVEZ
country: US
default_currency: USD
detached_at: NULL
created_at: 2026-05-09 01:40:58.087676+00
updated_at: 2026-05-09 01:49:15.225753+00
```

Interpretation:

- The phone run did not die before Stripe account creation/reuse.
- The remaining failure is likely after account creation, especially hosted account-link creation, a server-side permission/ToS mismatch, or a Stripe API rejection surfaced by the function.
- This requires the exact edge-function JSON response body to classify.

Diagnostic client patch added:

- `mingla-business/src/services/brandStripeService.ts` now unwraps Supabase function-error response bodies and logs `status + payload` in dev.
- `mingla-business/src/utils/__tests__/onboardReactivation.test.ts` now covers surfacing a function response body such as `forbidden: mingla_tos_not_accepted`.

Verification:

```bash
cd mingla-business
npx jest onboardReactivation.test
npx tsc --noEmit --pretty false
```

Result:

```text
PASS src/utils/__tests__/onboardReactivation.test.ts
3 passed, 0 failed
tsc: passed
```

Next retest instruction:

1. Reload the dev build so the patched JS bundle is active.
2. Sign in by email OTP if Apple Sign-In is unreliable in the current build.
3. Open brand `Stripe Wise 2` / brand id `81fd06bc-f31d-43e2-8189-b5a2a297cfee`.
4. Accept Mingla ToS if shown.
5. Tap **Set up payments** again.
6. Capture the new Metro log line beginning:

```text
[brand-stripe-onboard] edge function failed
```

That payload should determine the next action without guessing.

## 2026-05-09 Runtime Fix — Stripe Account Link HTTPS Return URL

Phone retest surfaced the exact Stripe Accounts v2 rejection:

```text
stripe_api_error: Some fields in the request were invalid: 'use_case: return_url must be a valid URL and start with https:// or, during testing, http://. localhost is only allowed in testmode.'
```

Root cause:

- `brand-stripe-onboard` accepted `mingla-business://onboarding-complete` as the app return URL.
- The function then passed that custom scheme directly into `/v2/core/account_links` as `use_case.account_onboarding.return_url` and `refresh_url`.
- Stripe Accounts v2 account links require `https://` return/refresh URLs, so Stripe rejected the request after account creation/reuse.

Fix implemented:

- `supabase/functions/brand-stripe-onboard/index.ts` now converts the app deep link into Stripe-compliant HTTPS relay URLs:
  - `https://business.usemingla.com/stripe-onboarding-return?return_to=mingla-business%3A%2F%2Fonboarding-complete`
  - refresh variant adds `stripe_onboarding_refresh=1`
- `mingla-business/app/stripe-onboarding-return.tsx` was added as the HTTPS relay page. It validates `return_to` and redirects the browser back to the native app deep link.
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts` and `supabase/functions/brand-stripe-onboard/index.test.ts` were updated to pin the hosted Account Link path and HTTPS relay expectation.

Verification passed:

```bash
cd supabase/functions
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write \
  _shared/__tests__/stripeBlueprintClient.test.ts \
  brand-stripe-onboard/index.test.ts \
  brand-mingla-tos-accept/index.test.ts
/Users/sethogieva/.deno/bin/deno check \
  brand-stripe-onboard/index.ts \
  _shared/stripeBlueprintClient.ts \
  brand-mingla-tos-accept/index.ts

cd mingla-business
npx jest onboardReactivation.test
npx tsc --noEmit --pretty false
npx expo export -p web
```

Results:

```text
Deno tests: ok | 6 passed | 0 failed
Deno check: passed
Jest: PASS src/utils/__tests__/onboardReactivation.test.ts, 3 passed
TypeScript: passed
Expo web export: passed; /stripe-onboarding-return exported
```

Deploy:

```text
brand-stripe-onboard deployed ACTIVE v9 at 2026-05-09 01:59:01 UTC
```

Remaining deploy note:

- The edge function fix is live.
- The new web relay route exists locally and exports to `mingla-business/dist/stripe-onboarding-return.html`.
- Vercel production deploy was attempted, but local Vercel metadata is currently split: repo root points to `mingla-marketing`, while `mingla-business/.vercel` points to `mingla-business` with a project root-directory setting that makes the CLI look for `mingla-business/mingla-business` when run from the package directory. A root deploy attempted against the marketing project and failed with Vercel's 10 MB request-body limit.
- Next operator/deploy step: fix Vercel project/root invocation or let GitHub auto-deploy the committed `mingla-business` changes so `https://business.usemingla.com/stripe-onboarding-return` is live.

Next retest:

1. Reload the Mingla Business phone build.
2. Tap **Set up payments** on the test brand again.
3. Expected immediate result: Stripe should no longer reject account-link creation for invalid `return_url`; the browser should open a Stripe-hosted `connect.stripe.com` onboarding URL.
4. Completion redirect back into the app requires the new `/stripe-onboarding-return` route to be live on `business.usemingla.com`.
