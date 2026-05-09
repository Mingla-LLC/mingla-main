# QA Report: ORCH-0764A Stripe API v2 Version Header Runtime Retest

> Date: 2026-05-08  
> Mode: RETEST  
> Verdict: FAIL  
> Findings: P0:0 P1:1 P2:0 P3:0 P4:3

## 1. Layman Summary

The deployed code and local regression gates are in the expected state: `brand-stripe-onboard` is live at version `7`, `brand-mingla-tos-accept` remains live at version `4`, and the focused Deno/Jest suites pass.

After a fresh operator sign-out/sign-in, the dedicated iOS simulator produced a valid Supabase session for `sethogieva@icloud.com` and the new brand `Stripe Wise 2`. Runtime testing now reaches Stripe.

Result: the prior missing `Stripe-Version` error is no longer reproduced. However, Stripe onboarding still fails before connected-account creation with a new Stripe API permissions/context error: the deployed API key does not have permission to access the account/resource, and Stripe suggests the request may also need a `Stripe-Context` header in some cases. No `stripe_connect_accounts` row is created and no hosted Account Link URL is returned.

## 2. Inputs Reviewed

- Retest prompt: `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER_RUNTIME.md`
- Deploy report: `Mingla_Artifacts/reports/DEPLOY_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_API_V2_VERSION_HEADER.md`
- Tester skill: `.codex/skills/tester-mingla/SKILL.md`
- Runtime fixture:
  - User: `sethogieva@icloud.com`
  - Brand: `Stripe Wise`
  - Slug: `stripewise`
  - Brand id: `e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd`
  - Dedicated simulator: `Mingla Stripe Retest ORCH-0764A` / `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330`

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Edge | `brand-stripe-onboard`, `_shared/stripeBlueprintClient.ts`, `brand-mingla-tos-accept` | Deploy version, Deno tests, Deno type check, direct deployed function calls |
| Business app | `mingla-business` focused tests and simulator fixture | Jest regression suites, persisted brand state, simulator screenshot |
| Supabase data | `brands`, `stripe_connect_accounts` REST queries | Brand fixture lookup and connected-account row before/after blocked calls |
| Stripe | Deployed `brand-stripe-onboard` runtime path | Not reached because auth failed before Stripe calls |

## 4. Claim Verification

| Claim / criterion | Evidence checked | Status | Notes |
|---|---|---|---|
| `brand-stripe-onboard` deployment is current | Supabase functions list | Verified | ACTIVE version `7`, updated `2026-05-08 22:20:34` |
| `brand-mingla-tos-accept` deployment is current | Supabase functions list | Verified | ACTIVE version `4`, updated `2026-05-08 21:27:58` |
| Accounts v2 helper tests assert the preview version header | Deno focused suite | Verified | 6/6 tests passed |
| Business status/reactivation tests pass | Jest focused suite | Verified | 2 suites / 15 tests passed |
| Repeat ToS returns HTTP 200 with `already_accepted: true` | Deployed function call | Unverified | Call returned `401 unauthenticated` because the saved simulator session is invalid |
| `brand-stripe-onboard` returns HTTP 200 with hosted Account Link URL | Deployed function call | Unverified | Call returned `401 unauthenticated`; Stripe was not reached |
| `stripe_connect_accounts` row is created or reused | REST query | Unverified | Row remains `[]`; no onboarding mutation happened |

## 5. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| Deploy check | `/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv \| rg "brand-stripe-onboard\|brand-mingla-tos-accept"` | PASS | `brand-stripe-onboard` ACTIVE v7; `brand-mingla-tos-accept` ACTIVE v4 |
| Deno tests | `cd supabase/functions && /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read --allow-write _shared/__tests__/stripeBlueprintClient.test.ts brand-stripe-onboard/index.test.ts brand-mingla-tos-accept/index.test.ts` | PASS | `ok \| 6 passed \| 0 failed` |
| Deno check | `cd supabase/functions && /Users/sethogieva/.deno/bin/deno check brand-stripe-onboard/index.ts _shared/stripeBlueprintClient.ts brand-mingla-tos-accept/index.ts` | PASS | Exit code `0` |
| Business Jest | `cd mingla-business && npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand` | PASS | `2 passed`, `15 passed`; Watchman recrawl warning only |
| Legacy contract sweep | `rg -n 'stripe\.accounts\.create\|accountSessions\.create\|connect-onboarding\?session' ...` | PASS | Matches only negative assertions in `brand-stripe-onboard/index.test.ts` |
| Simulator fixture | Screenshot | PARTIAL | `/tmp/mingla-orch-0764a-version-header-retest/current-simulator.png` shows `Stripe Wise` selected |
| Auth validity | `GET /auth/v1/user` with simulator token | BLOCKED | HTTP `403`, `session_not_found` |
| Refresh saved session | `POST /auth/v1/token?grant_type=refresh_token` | BLOCKED | HTTP `400`, `refresh_token_not_found` |
| Repeat ToS function | `POST /functions/v1/brand-mingla-tos-accept` with simulator token | BLOCKED | HTTP `401`, `{"error":"unauthenticated"}` |
| Stripe onboard function | `POST /functions/v1/brand-stripe-onboard` with simulator token | BLOCKED | HTTP `401`, `{"error":"unauthenticated"}` |
| Connected-account row | REST query for fixture brand id | PASS for no accidental mutation | `[]` before and after blocked calls |

## 6. Findings

### P1 High

**P1-001: Stripe Accounts v2 onboarding now reaches Stripe but fails on API key permission/context**

- **Evidence:** Fresh authenticated call to `brand-stripe-onboard` for `Stripe Wise 2` returned HTTP `502` with `{"error":"stripe_api_error","detail":"Permission denied. API Key does not have permission to access account. To make an authorized request, make sure that the API Key making the request has the correct permissions for the resource in the API call. In some cases, you may also need to supply an Account ID in the Stripe-Context header."}`.
- **What is wrong:** The version-header blocker is cleared enough to reach Stripe's next authorization gate, but the deployed Stripe key/context is not authorized for the Accounts v2 `/v2/core/accounts` operation being attempted.
- **Impact:** Organisers can accept Mingla ToS but still cannot start Stripe payout onboarding. No connected account row, `account_id`, `client_secret: null`, or hosted onboarding URL is produced.
- **Required fix:** Forensics/implementor must determine whether the deployed `STRIPE_RAK_ONBOARD` is under-scoped for `/v2/core/accounts`, whether the platform must use `STRIPE_SECRET_KEY` for this operation, or whether Stripe requires a `Stripe-Context` account header for the current platform setup. Do not close ORCH-0764A until a live onboarding URL is returned.
- **Retest:** With `Stripe Wise 2`, call ToS repeat, invoke `brand-stripe-onboard`, require HTTP `200`, `client_secret: null`, `account_id: acct_...`, Stripe-hosted `onboarding_url`, and a created/reused `stripe_connect_accounts` row.

### P2 Medium

**P2-001: Runtime retest blocked by stale/revoked simulator auth session**

- **Evidence:** `GET /auth/v1/user` using the simulator's saved token returned HTTP `403` with `session_not_found`; refresh returned HTTP `400` with `refresh_token_not_found`.
- **What is wrong:** The dedicated simulator still visually shows the `Stripe Wise` dashboard, but its persisted Supabase session is no longer valid server-side.
- **Impact:** Tester cannot verify the deployed Stripe onboarding path. The function exits at auth with `401 unauthenticated`, before ToS logic, Stripe Accounts v2 account creation, Account Link creation, or `stripe_connect_accounts` persistence.
- **Required fix:** Re-authenticate the dedicated simulator as `sethogieva@icloud.com`, confirm `Stripe Wise` is selected, then rerun this retest.
- **Retest:** Before invoking functions, verify `GET /auth/v1/user` returns HTTP `200` for the simulator token. Then repeat ToS and Stripe onboarding runtime checks.

### P4 Notes

- **P4-001:** Static gates passed after deploy. This supports the implementation claim that the version header is present in the local code path, but it is not a substitute for live Stripe proof.
- **P4-002:** No `stripe_connect_accounts` row exists for `Stripe Wise` after the blocked calls, so this retest did not accidentally create or reuse a connected account.
- **P4-003:** The stale-auth fixture blocker was resolved by a fresh sign-out/sign-in on `2026-05-08`; it is retained in this report as history, not as the current blocker.

## 7. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| Deployed `brand-stripe-onboard` version includes ORCH-0764A rework | PASS | ACTIVE version `7` | None |
| Repeat ToS returns HTTP `200` and `already_accepted: true` | BLOCKED | Function returned `401 unauthenticated` | P2-001 |
| `brand-stripe-onboard` returns HTTP `200` | BLOCKED | Function returned `401 unauthenticated` | P2-001 |
| Response has `client_secret: null` | BLOCKED | No success response | P2-001 |
| Response has `account_id` beginning `acct_` | BLOCKED | No success response | P2-001 |
| Response has Stripe-hosted `onboarding_url` | BLOCKED | No success response | P2-001 |
| Hosted URL opens usable Stripe onboarding | BLOCKED | No URL produced | P2-001 |
| `stripe_connect_accounts` row created or reused | BLOCKED | Row remains `[]`; Stripe function did not pass auth | P2-001 |

## 8. Security

| Finding/check | Severity | Evidence | Result |
|---|---|---|---|
| Deployed edge functions reject invalid/revoked user sessions | P4 note | Both ToS and Stripe onboard returned `401 unauthenticated` | PASS |
| Secrets redaction | P4 note | Report excludes bearer token, refresh token, and API keys | PASS |

## 9. Production Verification

| Check | Method | Result | Remaining manual test |
|---|---|---|---|
| Dedicated simulator booted | `xcrun simctl list devices booted` | PASS | None |
| App displays correct brand | Screenshot | PASS | None |
| App session valid server-side | Supabase Auth user endpoint | FAIL/BLOCKED | Re-authenticate simulator |
| Live Stripe Accounts v2 account creation | Deployed function call | UNVERIFIED | Requires valid auth session |
| Live Stripe hosted Account Link creation | Deployed function call + open URL | UNVERIFIED | Requires valid auth session and successful function response |

## 10. Required Actions

1. Re-authenticate the dedicated simulator `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330` as `sethogieva@icloud.com`.
2. Confirm selected brand is `Stripe Wise` / `stripewise`.
3. Rerun this exact retest. Do not close ORCH-0764A until the live `brand-stripe-onboard` call returns a Stripe-hosted `onboarding_url` or a new Stripe/runtime failure is captured.

## 11. Retest Notes

| Previous finding | Fixed? | Evidence | Regression? |
|---|---|---|---|
| Missing Stripe API v2 version header caused Stripe HTTP 502 | UNVERIFIED | Runtime call did not pass auth, so Stripe was not reached | Unknown |
| Repeat Mingla ToS should be idempotent | UNVERIFIED | Function returned `401 unauthenticated` before ToS logic | Unknown |

Retest cycle: 2, blocked by invalid simulator auth fixture.

## 12. Retry After Operator Refresh

> Date: 2026-05-08  
> Result: Still BLOCKED/UNVERIFIED

After the operator reported that the simulator session was refreshed, tester retried the runtime path against the same dedicated simulator and fixture:

- Simulator: `Mingla Stripe Retest ORCH-0764A` / `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330`
- Current app data container: `C2195AC6-EB39-48F3-9029-7FF465C4AF2C`
- Persisted brand state still points at `e2d49bd8-b5ff-444b-99c6-4bbe3cb795fd`
- Screenshot: `/tmp/mingla-orch-0764a-version-header-retest/refreshed-simulator.png`

Server-side auth proof after refresh:

```text
GET /auth/v1/user
HTTP_STATUS:403
{"code":403,"error_code":"session_not_found","msg":"Session from session_id claim in JWT does not exist"}
```

Repeat ToS call after refresh:

```text
POST /functions/v1/brand-mingla-tos-accept
HTTP_STATUS:401
{"error":"unauthenticated"}
```

Stripe onboarding call after refresh:

```text
POST /functions/v1/brand-stripe-onboard
HTTP_STATUS:401
{"error":"unauthenticated"}
```

Tester conclusion is unchanged: the app can still show cached `Stripe Wise` state, but the deployed edge functions correctly reject the current saved session. Runtime Stripe validation remains blocked until the simulator writes a new valid Supabase session to app storage.

## 13. Retry With New Brand `Stripe Wise 2`

> Date: 2026-05-08  
> Result: Still BLOCKED/UNVERIFIED

The operator requested a retry with the new account/brand `stripen wise 2`. Tester used the same dedicated simulator and confirmed the visible app state:

- Simulator: `Mingla Stripe Retest ORCH-0764A` / `5D6FFB79-E1AE-40E2-82B8-66E1D87CA330`
- Screenshot: `/tmp/mingla-orch-0764a-version-header-retest/stripen-wise-2-simulator.png`
- Visible brand: `Stripe Wise 2`
- Persisted current brand id: `81fd06bc-f31d-43e2-8189-b5a2a297cfee`

However, the simulator's stored Supabase JWT is still the prior invalid session. Server-side auth remains rejected:

```text
GET /auth/v1/user
HTTP_STATUS:403
session_not_found
```

Tester also checked every Mingla Business app token found across local simulator containers. All returned `HTTP_403 session_not_found`.

Function calls for the new brand id:

```text
POST /functions/v1/brand-mingla-tos-accept
brand_id=81fd06bc-f31d-43e2-8189-b5a2a297cfee
HTTP_STATUS:401
{"error":"unauthenticated"}
```

```text
POST /functions/v1/brand-stripe-onboard
brand_id=81fd06bc-f31d-43e2-8189-b5a2a297cfee
HTTP_STATUS:401
{"error":"unauthenticated"}
```

Anonymous REST checks for `brands` and `stripe_connect_accounts` returned `[]`, so tester could not independently verify the new brand row or any connected-account row without a valid authenticated user session.

Conclusion remains unchanged: the Stripe version-header runtime path is still unverified because the deployed edge functions are not receiving a valid authenticated user. The app UI is displaying cached/new local brand selection, but the session written to `RCTAsyncLocalStorage_V1` is not server-valid.

## 14. Successful Auth Retry And Current Runtime Failure

> Date: 2026-05-08  
> Result: FAIL

After the operator signed out and signed back in, tester confirmed the simulator now has a valid server-side Supabase session:

```text
GET /auth/v1/user
HTTP_STATUS:200
email=sethogieva@icloud.com
last_sign_in_at=2026-05-08T22:46:41.561858Z
```

Current app fixture:

- Screenshot: `/tmp/mingla-orch-0764a-version-header-retest/fresh-signin-simulator.png`
- Visible brand: `Stripe Wise 2`
- Brand id: `81fd06bc-f31d-43e2-8189-b5a2a297cfee`
- Brand lookup:

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

Pre-onboarding connected-account row:

```json
[]
```

Initial ToS acceptance:

```text
HTTP_STATUS:200
{"accepted_at":"2026-05-08T22:47:50.163+00:00","version":"v3-pre-launch-placeholder"}
```

Repeat ToS acceptance:

```text
HTTP_STATUS:200
{"accepted_at":"2026-05-08T22:47:50.163+00:00","version":"v3-pre-launch-placeholder","already_accepted":true}
```

Authenticated `brand_team_members` evidence:

```json
[
  {
    "brand_id": "81fd06bc-f31d-43e2-8189-b5a2a297cfee",
    "user_id": "c727d491-4884-4e72-b467-d6c124b9a8b9",
    "role": "account_owner",
    "accepted_at": "2026-05-08T22:42:54.453915+00:00",
    "mingla_tos_accepted_at": "2026-05-08T22:47:50.163+00:00",
    "mingla_tos_version_accepted": "v3-pre-launch-placeholder"
  }
]
```

Stripe onboarding result:

```text
POST /functions/v1/brand-stripe-onboard
HTTP_STATUS:502
```

Body:

```json
{
  "error": "stripe_api_error",
  "detail": "Permission denied. API Key does not have permission to access account. To make an authorized request, make sure that the API Key making the request has the correct permissions for the resource in the API call. In some cases, you may also need to supply an Account ID in the Stripe-Context header."
}
```

Post-failure connected-account row:

```json
[]
```

Current tester conclusion: ORCH-0764A should remain open as `FAIL`. The missing `Stripe-Version` symptom is no longer the active failure, but the live Accounts v2 onboarding flow still does not produce an account or hosted onboarding URL.
