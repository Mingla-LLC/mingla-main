# Implementation Report: Stripe Live-Mode Cutover (ORCH-0953)

> Date: 2026-05-24
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0953_STRIPE_LIVE_CUTOVER.md`
> Status: implemented, partially verified

## 1. Layman Summary

Mingla now fails closed for live Stripe key mistakes, persists and routes Stripe dispute lifecycle events, blocks native paid checkout unless the operator explicitly allows the connected-account region, and has static guards for Android Stripe return URLs, Google Pay production mode, and live Connect reconciliation. No Stripe Dashboard state, Supabase secrets, Supabase remote DB state, or edge deployments were mutated.

## 2. Request And Context

- **Request:** Implement ORCH-0953 Stripe live-mode cutover SPEC, strictly within §3.1-§3.10 and §8 paths.
- **Source:** SPEC, investigation report, DEC-154, DEC-156.
- **Affected surfaces:** Supabase migrations/edge functions/shared Stripe handlers, app-mobile native checkout config, mingla-business build config/native checkout config, operator SQL runbook.
- **Related artifacts:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md`, `Mingla_Artifacts/DECISION_LOG.md`.

## 3. Scope

- **In scope:** 9 implement contracts, 1 migration, 10 regression-test path groups, reconciliation probe, deploy checklist.
- **Out of scope:** `supabase db push`, edge deploys, Supabase secret writes, Stripe Dashboard mutations, live-fire smoke.
- **Assumptions:** Connected-account country from `stripe_connect_accounts.country` is the correct region input for the native paid gate because the direct charge lives on that connected account.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/specs/SPEC_ORCH-0953_STRIPE_LIVE_CUTOVER.md` | Contract | 10 sections, 17 SCs, §11 order. |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0953_STRIPE_LIVE_CUTOVER_AUDIT.md` | Evidence | RAK fallback, webhook mismatch, native tax gap, URL-scheme risk. |
| `Mingla_Artifacts/DECISION_LOG.md` | DEC context | DEC-156 locks platform-liable direct-charge model after DEC-154 amendment. |
| `supabase/functions/_shared/stripeBlueprintClient.ts` | §3.1 | Two onboarding/account-link fallback arrays used `STRIPE_SECRET_KEY`. |
| `supabase/functions/_shared/stripeWebhookRouter.ts` | §3.3/§3.4 | No `charge.dispute.*` routing; noisy events absent. |
| `supabase/functions/ticket-checkout-create/index.ts` | §3.8 | Native PI path had no Stripe Tax and no region gate. |
| `supabase/functions/stripe-webhook/index.ts` | §3.10 | Invalid signatures returned 400 with no operator alert. |
| `app-mobile/app.json`, `mingla-business/app.json` | §3.5/§3.6 | Android custom schemes were not explicit intent filters. |
| `app-mobile/src/payments/nativeCheckoutFlow.ts`, `mingla-business/src/payments/nativeCheckoutFlow.native.ts` | §3.7/§3.8 | Google Pay used `__DEV__`; region-gate error had no web-fallback copy. |
| `mingla-business/app.config.ts` | §3.2 | Production builds could silently use `pk_test_` fallback. |

## 5. Blast Radius

- **Direct changes:** Stripe shared clients/router/handlers, webhook entrypoint, checkout edge function, app manifests/config, native checkout hooks, new migration/runbook/tests.
- **Cascade changes:** Orchestrator must redeploy touched edge functions after operator migration apply.
- **Parity surfaces:** Consumer and business native flows both use EAS profile for Google Pay and identical region-gate copy.
- **Cache impact:** None.
- **State boundaries:** DB owns persisted dispute rows; edge functions own Stripe webhook mutation; client hooks only surface server errors.
- **Auth/RLS/security:** New `stripe_disputes` has service-role full access and brand payment-manager read access via existing `brand_team_members` roles.
- **Deploy path:** Operator applies migration first; orchestrator deploys listed edge functions; operator completes Phase A-E Dashboard/secrets.

## 6. Old To New Receipts

### `supabase/functions/_shared/stripeBlueprintClient.ts`

- **Before:** Onboarding raw client tried `STRIPE_RAK_ONBOARD`, then `STRIPE_SECRET_KEY`.
- **After:** Both account-create and account-link require only `STRIPE_RAK_ONBOARD`.
- **Why:** SC-1 fail-close least-privilege posture.
- **Approx lines changed:** 2.

### `mingla-business/app.config.ts`

- **Before:** Any build profile could fall back to a hardcoded `pk_test_...`.
- **After:** `EAS_BUILD_PROFILE === "production"` requires env value beginning `pk_live_`; non-production keeps fallback.
- **Why:** SC-2 prevents sandbox publishable key in production builds.
- **Approx lines changed:** 20.

### `supabase/migrations/20260724000006_orch_0953_create_stripe_disputes.sql`

- **Before:** No dispute persistence table.
- **After:** Creates `public.stripe_disputes`, indexes, RLS, service-role policy, brand payment-manager read policy.
- **Why:** SC-3.
- **Approx lines changed:** new file.

### `supabase/functions/_shared/stripeDisputeHandlers.ts`

- **Before:** No dispute lifecycle handler.
- **After:** Upserts disputes by `stripe_dispute_id`, resolves brand/order, dispatches operator alerts, posts AppsFlyer `dispute_created` / `dispute_lost`.
- **Why:** SC-5/SC-6 and DEC-156 dispute observability.
- **Approx lines changed:** new file.

### `supabase/functions/_shared/stripeWebhookRouter.ts`

- **Before:** Dispute events were not routed; noisy events stayed absent but undocumented.
- **After:** Adds `charge.dispute.created/updated/closed` to `STRIPE_ROUTED_EVENT_TYPES`, routes to `handleChargeDispute`, documents non-routed noisy events.
- **Why:** SC-4/SC-7.
- **Approx lines changed:** 20.

### `mingla-business/app.json`, `app-mobile/app.json`

- **Before:** Android had HTTPS app links but no explicit custom Stripe return scheme filters.
- **After:** Adds `com.sethogieva.minglabusiness` and `com.mingla.app.v2` Android VIEW intent filters.
- **Why:** SC-8/SC-9.
- **Approx lines changed:** 24.

### `app-mobile/src/payments/nativeCheckoutFlow.ts`, `mingla-business/src/payments/nativeCheckoutFlow.native.ts`

- **Before:** `googlePay.testEnv` used `__DEV__`; native region-gate error surfaced raw server code.
- **After:** `testEnv` uses `process.env.EAS_BUILD_PROFILE !== "production"`; region gate maps to "Pay on the web" copy.
- **Why:** SC-10/SC-14.
- **Approx lines changed:** 28.

### `supabase/functions/_shared/stripeTax.ts`, `supabase/functions/ticket-checkout-create/index.ts`

- **Before:** Native PI path always proceeded for paid checkouts if Connect was ready.
- **After:** Reads `NATIVE_PAID_ALLOWED_REGIONS`; empty env blocks all native paid; non-allowed connected-account country returns 400 `{ error, retryWithSurface: "web" }` before PI creation.
- **Why:** SC-11/SC-12/SC-13.
- **Approx lines changed:** 30 plus new helper.

### `scripts/orch-0953/*`

- **Before:** No operator reconciliation probe.
- **After:** Adds read-only SQL and README runbook.
- **Why:** SC-15.
- **Approx lines changed:** new files.

### `supabase/functions/stripe-webhook/index.ts`

- **Before:** Invalid signature returned 400 only.
- **After:** If `STRIPE_WEBHOOK_FAILURE_ALERT_USERS` is set, dispatches operator notification on signature verification failure; missing env no-ops.
- **Why:** SC-16/SC-17.
- **Approx lines changed:** 30.

## 7. Implementation Details

- **Architecture decisions:** Dispute handler uses dependency-injected effects for repo-running unit tests without live notification/Appsflyer side effects.
- **Data flow:** Stripe webhook -> router -> dispute handler -> `stripe_disputes` upsert -> optional notification/Appsflyer.
- **Mutation/query behavior:** Disputes upsert on `stripe_dispute_id`; native gate reads `stripe_connect_accounts.country`.
- **State handling:** No React Query/Zustand/AsyncStorage changes.
- **Error handling:** Region gate returns explicit 400; signature alert failures log and do not alter webhook 400 behavior.
- **Copy/accessibility:** Native hooks return web-fallback payment copy through existing checkout error surface.
- **Analytics/notifications/realtime:** AppsFlyer S2S for dispute events; operator notifications for disputes and signature failures.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---:|---|---|
| SC-1 RAK onboarding fail-close | Yes | `stripeBlueprintClient_failclose.test.ts` | PASS |
| SC-2 pk_live production fail-close | Yes | `appConfig_pkLiveFailClose.test.ts` | PASS |
| SC-3 dispute table/RLS/policies | Yes | migration source assertion in `stripeDisputeHandlers.test.ts` | PASS locally; remote apply pending operator |
| SC-4 dispute event routing | Yes | `stripeWebhookRouter_eventList.test.ts` | PASS |
| SC-5 dispute.created row + alert | Yes | mocked unit test | PASS |
| SC-6 dispute idempotency | Yes | mocked replay unit test | PASS |
| SC-7 noisy events not routed/subscribed | Code doc/test done | endpoint subscription evidence pack pending operator | PARTIAL |
| SC-8 business Android return scheme | Yes | static manifest test | PASS locally; EAS smoke pending |
| SC-9 consumer Android return scheme | Yes | static manifest test | PASS locally; EAS smoke pending |
| SC-10 Google Pay production env | Yes | source tests both apps | PASS |
| SC-11 non-allowed native region 400 | Yes | helper/source gate test | PASS |
| SC-12 empty allowlist disables native paid | Yes | helper test | PASS |
| SC-13 allowed region proceeds | Gate helper passes; full PI live path not invoked | helper test | PARTIAL |
| SC-14 web-fallback copy | Yes | source tests both apps | PASS |
| SC-15 reconciliation probe | Yes | read-only SQL shape test | PASS locally; operator run pending |
| SC-16 invalid signature alert | Yes | source hook test | PASS |
| SC-17 missing alert env no-op | Yes | source hook test | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---:|---:|---|
| I-PROPOSED-STRIPE-RAK-ONBOARD-FAIL-CLOSE | Yes | Yes | Enforced by §3.1 test. |
| I-PROPOSED-MINGLA-BUSINESS-PK-LIVE-IN-PRODUCTION | Yes | Yes | Enforced by Jest config test. |
| I-PROPOSED-STRIPE-WEBHOOK-DISPUTE-ROUTED | Yes | Yes | Enforced by router event list test. |
| I-PROPOSED-STRIPE-DISPUTE-PERSISTED | Yes | Yes | Enforced by handler/migration tests. |
| I-PROPOSED-STRIPE-NATIVE-PAID-REGION-GATED | Yes | Yes | Enforced by helper/source tests. |

## 10. Parity Check

- **Mobile:** app-mobile Android scheme, Google Pay gate, native paid fallback copy implemented.
- **Business app:** mingla-business Android scheme, production pk_live fail-close, Google Pay gate, native paid fallback copy implemented.
- **Admin:** No code touched.
- **Public/web:** No buyer-web product code touched; web is fallback route for native blocked regions.
- **Solo/collab:** Not applicable.
- **Gaps:** EAS production deep-link and wallet runtime smokes remain TEST/operator-owned.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** New `stripe_disputes` table only after operator migration apply.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Production mingla-business config can now throw if `pk_live_` env is missing.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Deno check scoped touched edge/shared | `deno check supabase/functions/_shared/stripeDisputeHandlers.ts supabase/functions/_shared/stripeWebhookRouter.ts supabase/functions/ticket-checkout-create/index.ts supabase/functions/stripe-webhook/index.ts` | PASS | Used `/Users/sethogieva/.deno/bin/deno`. |
| Deno tests scoped | `deno test --allow-env --allow-read ...` for all Deno §8 paths | PASS, 16 tests | Includes app-mobile/source and script tests. |
| mingla-business Jest | `npx jest --runInBand src/__tests__/appConfig_pkLiveFailClose.test.ts __tests__/intentFilters_stripeReturnScheme.test.ts __tests__/googlePay_testEnvProductionGate.test.ts src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` | PASS, 6 tests | Ran from `mingla-business/`. |
| Edge deploy bundle except tax dashboard | `deno check ticket-checkout-create stripe-webhook brand-stripe-onboard refund-order cancel-trip-booking` | PASS | Checks deploy-impact functions importing touched shared files. |
| `brand-stripe-tax-dashboard-link` check | `deno check supabase/functions/brand-stripe-tax-dashboard-link/index.ts` | FAIL pre-existing | Type-only Supabase import mismatch at `index.ts:122` audit call; file not in implementation scope. |
| Diff hygiene | `git diff --check` | PASS | No whitespace errors. |

## 13. Regression Surface

1. Stripe onboarding RAK fallback: missing live restricted key now hard-fails instead of using full key.
2. Webhook routing: new dispute handlers add table writes and notification side effects.
3. Native paid checkout: regions not explicitly allowed now return a 400 and require web fallback.
4. Production build config: missing/non-live publishable key now blocks mingla-business production config evaluation.
5. Android return URLs: custom schemes now explicit in generated manifest inputs.

## 14. Regression Tests And Fails-On-Revert Receipts

| Contract | Test path | Fails-on-revert verified at |
|---|---|---|
| §3.1 | `supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts` | `bc5935fc` by reverting `stripeBlueprintClient.ts`; test failed with `fallback_fetch_called`. |
| §3.2 | `mingla-business/src/__tests__/appConfig_pkLiveFailClose.test.ts` | `bc5935fc` by reverting `mingla-business/app.config.ts`; Jest failed missing/non-live production cases. |
| §3.3 | `supabase/functions/_shared/__tests__/stripeDisputeHandlers.test.ts` | `bc5935fc` by removing handler file; Deno failed module import. Migration shape additionally verified at `222daa04` by removing migration file; migration assertion failed. |
| §3.4 | `supabase/functions/_shared/__tests__/stripeWebhookRouter_eventList.test.ts` | `bc5935fc` by injecting `charge.succeeded`; Deno failed noisy-event assertion. |
| §3.5 | `mingla-business/__tests__/intentFilters_stripeReturnScheme.test.ts` | `bc5935fc` by reverting `mingla-business/app.json`; Jest failed scheme assertion. |
| §3.6 | `app-mobile/__tests__/intentFilters_stripeReturnScheme.test.ts` | `bc5935fc` by reverting `app-mobile/app.json`; Deno failed scheme assertion. |
| §3.7 | `app-mobile/__tests__/googlePay_testEnvProductionGate.test.ts` + `mingla-business/__tests__/googlePay_testEnvProductionGate.test.ts` | `bc5935fc` by reverting both native checkout files; both tests failed on missing EAS profile gate. |
| §3.8 | `supabase/functions/ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts` + app-mobile/business region-gate tests | `bc5935fc` by reverting checkout/index and removing helper; backend test failed. Reverting both native hooks also failed both copy tests. |
| §3.9 | `scripts/orch-0953/__tests__/reconciliation_query_shape.test.ts` | `bc5935fc` by removing SQL file; Deno failed file-read. |
| §3.10 | `supabase/functions/stripe-webhook/__tests__/signatureFailureAlert.test.ts` | `bc5935fc` by reverting `stripe-webhook/index.ts`; Deno failed alert-hook assertions. |

## 15. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Migration not applied | `stripe_disputes` table unavailable remotely until operator runs DB push | Operator runs `supabase db push --linked` | `supabase/migrations/20260724000006_orch_0953_create_stripe_disputes.sql` |
| Edge functions not deployed | Code not live until orchestrator deploys after migration | Orchestrator deploy checklist completed | §16 |
| Dashboard/secrets not activated | Live cutover still blocked | Operator Phase A-E evidence pack | `EVIDENCE_PACK_ORCH-0953_LIVE_ACTIVATION.md` |
| `brand-stripe-tax-dashboard-link` type check | Pre-existing Deno type mismatch could fail a full deploy-bundle check | Separate scoped fix or accepted known type-only gate | `supabase/functions/brand-stripe-tax-dashboard-link/index.ts:122` |
| Native allowed-region helper only unit-tested | Full PI creation path not live-invoked locally | Tester T-10 live-fire after deploy | §6 TEST lane |

## 16. Discoveries For Orchestrator

- `brand-stripe-tax-dashboard-link/index.ts` has a pre-existing Supabase type import mismatch at the `writeAudit` call. I did not edit it because product code outside SPEC implementation files was forbidden.
- The SPEC migration policy named `brand_memberships`, but this repo uses `brand_team_members` for payment-manager access. The implemented RLS policy follows the live repo membership table and roles used by `stripeEdgeAuth.ts`.

## 17. Deploy Notes

- **Migrations:** Operator must run `supabase db push --linked` for `20260724000006_orch_0953_create_stripe_disputes.sql`. Codex did not run any DB push.
- **Edge functions:** Orchestrator deploys after operator confirms migration apply:
  - `ticket-checkout-create` — imports new native region gate helper.
  - `stripe-webhook` — signature-failure alert hook and dispute router path.
  - `brand-stripe-onboard` — imports touched `_shared/stripeBlueprintClient.ts`; picks up RAK fail-close.
  - `refund-order` — redeploy for touched Stripe shared bundle per SPEC.
  - `cancel-trip-booking` — redeploy for touched Stripe shared bundle per SPEC.
  - `brand-stripe-tax-dashboard-link` — redeploy per SPEC; note Deno type-check caveat above.
- **Mobile OTA/native:** `app-mobile/app.json` and `mingla-business/app.json` intent filters require native rebuild for Android scheme registration. JS Google Pay/region-gate copy can ride OTA only after compatible binary exists.
- **Business/admin web:** mingla-business config touched; close PR should carry `[deploy]` tag per dispatch.
- **Env vars/secrets:** Operator owns `NATIVE_PAID_ALLOWED_REGIONS`, `STRIPE_DISPUTE_ALERT_USERS`, `STRIPE_WEBHOOK_FAILURE_ALERT_USERS`, live `pk_live_`, RAKs, webhook secrets. No secret values were written or recorded.

## Suggested Commit Message

```text
ORCH-0953: implement Stripe live-mode cutover guards

Resolves: ORCH-0953
Evidence: implementation report + scoped Deno/Jest regression tests
Deploy: operator migration apply, then orchestrator edge deploys, then operator Dashboard/secrets activation
```

## Ready-To-Test Checklist

1. Operator applies `stripe_disputes` migration and confirms table/RLS exists.
2. Orchestrator deploys the six edge functions listed above.
3. Operator completes Phase A-E and writes `Mingla_Artifacts/reports/EVIDENCE_PACK_ORCH-0953_LIVE_ACTIVATION.md`.
4. Tester runs T-01 through T-11 live-fire matrix from the SPEC.
