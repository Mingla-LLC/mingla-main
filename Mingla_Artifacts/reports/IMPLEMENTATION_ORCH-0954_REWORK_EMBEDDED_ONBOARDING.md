# IMPLEMENTATION — ORCH-0954 REWORK [Embedded onboarding cutover + Stripe-managed risk]

**Implementor:** Codex `implementor-mingla`  
**Date:** 2026-05-25  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/`  
**Branch:** `ORCH-0954-embedded-onboarding-cutover`  
**Implementation commit:** `97844fd6`  
**Status:** implemented, partially verified

## Section A — Contract inputs read

- `COMMS-0003` and `COMMS-0002` were acknowledged from `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before code work. `COMMS-0001` was honored as a scope guard; `supabase/functions/brand-stripe-tax-dashboard-link/` was not touched.
- `stripe-best-practices` was invoked before code work; relevant Connect reference read: `/Users/sethogieva/.agents/skills/stripe-best-practices/references/connect.md`.
- Amendment contract: `Mingla_Artifacts/specs/SPEC_ORCH-0954_AMENDMENT_EMBEDDED_ONBOARDING.md`.
- Orchestrator review: `Mingla_Artifacts/reports/REVIEW_ORCH-0954_AMENDMENT.md`; §A3 locked Option α + α-1 explicit origin override.
- Tester live-fire report: `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`.

## Section B — What changed

1. Stripe controller payload now encodes seller-pays-processing with Stripe's API enum:
   - `supabase/functions/_shared/stripeBlueprintClient.ts:14` pins `STRIPE_MANAGED_RISK_CONTROLLER`.
   - `supabase/functions/_shared/stripeBlueprintClient.ts:17` keeps `losses_collector: "stripe"`.
   - `supabase/functions/_shared/stripeBlueprintClient.ts:18` changes `fees_collector` to `"stripe"`.
   - `supabase/functions/_shared/stripeBlueprintClient.ts:21` keeps `dashboard: "none"`.
   - `supabase/functions/_shared/stripeBlueprintClient.ts:186` spreads the pinned controller into Accounts v2 create.

2. Server-side Account Session payloads no longer send unsupported `collection_options`:
   - `supabase/functions/_shared/stripeBlueprintClient.ts:44` narrows `AccountSessionComponents.account_onboarding.features` to Stripe's server-supported feature keys.
   - `supabase/functions/brand-stripe-onboard/index.ts:696` creates the onboarding Account Session; `supabase/functions/brand-stripe-onboard/index.ts:701` keeps only `external_account_collection`.
   - `supabase/functions/brand-stripe-account-session/index.ts:83` creates the optional onboarding surface; `supabase/functions/brand-stripe-account-session/index.ts:86` keeps only `external_account_collection`.
   - `mingla-business/app/connect-onboarding.tsx` was intentionally not changed; component-side `collectionOptions` remains the supported Stripe surface.

3. Option α + α-1 preview validation is wired:
   - `mingla-business/app.config.ts:85` now keys publishable-key fail-close from `process.env.VERCEL_ENV`.
   - `mingla-business/app.config.ts:90` requires `pk_live_` for Vercel production.
   - `mingla-business/app.config.ts:98` requires `pk_test_` for Vercel preview/development.
   - `mingla-business/app.config.ts:111` requires local dev to use a `pk_test_` value.
   - `mingla-business/src/services/businessWebOriginOverride.ts:1` detects allowed preview origins on the client.
   - `mingla-business/src/services/brandStripeService.ts:161` sends `business_web_origin_override` to `brand-stripe-onboard` when present.
   - `mingla-business/src/services/brandStripeAccountSessionService.ts:29` sends the same override to `brand-stripe-account-session`.
   - `supabase/functions/_shared/businessWebOrigin.ts:1` allowlists `https://business.usemingla.com`.
   - `supabase/functions/_shared/businessWebOrigin.ts:4` allowlists `https://mingla-business-[a-z0-9-]+.vercel.app`.
   - `supabase/functions/_shared/businessWebOrigin.ts:18` fail-closes non-string overrides.
   - `supabase/functions/_shared/businessWebOrigin.ts:30` fail-closes unrecognized override origins.
   - `supabase/functions/brand-stripe-onboard/index.ts:251` validates the override before URL construction.
   - `supabase/functions/brand-stripe-account-session/index.ts:133` validates the override before target URL construction.

4. Strict guards and allowlists were updated:
   - `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs:31` now asserts `losses_collector: "stripe"`.
   - `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs:32` now asserts `fees_collector: "stripe"`.
   - `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs:33` still asserts `dashboard: "none"`.
   - `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:750` keeps the ORCH-0954 backend allowlist.
   - `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:752` adds `_shared/businessWebOrigin.ts`.
   - `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:756` adds the new contract test.

## Section C — §A10 success criteria coverage

| Criterion | Implementation evidence | Verification status |
|---|---|---|
| SC-A1 Stripe TEST Accounts v2 accepts corrected controller | Payload source at `supabase/functions/_shared/stripeBlueprintClient.ts:14` and spread at `supabase/functions/_shared/stripeBlueprintClient.ts:186`; contract mock asserts `fees_collector: "stripe"` at `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts:138`. | Local contract test passed. Live Stripe TEST API proof remains for tester after deploy. |
| SC-A2 Stripe TEST Account Sessions accept corrected onboarding payload | Onboard edge payload at `supabase/functions/brand-stripe-onboard/index.ts:696`; account-session edge payload at `supabase/functions/brand-stripe-account-session/index.ts:83`; contract test rejects `collection_options` at `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts:66`. | Local contract test passed. Live Stripe TEST API proof remains for tester after deploy. |
| SC-A3 Embedded components render against TEST session on chosen host | Vercel preview key gate at `mingla-business/app.config.ts:98`; preview origin override client helper at `mingla-business/src/services/businessWebOriginOverride.ts:4`; edge validation at `supabase/functions/_shared/businessWebOrigin.ts:11`. | Requires Vercel Preview deployment with `pk_test_...`; tester owns Playwright screenshot/recording. |
| SC-A4 Regression tests exist and are green | New implementor contract test at `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts:110`; frontend override tests at `mingla-business/src/utils/__tests__/onboardReactivation.test.ts:34` and `mingla-business/src/services/__tests__/brandStripeAccountSessionService.test.ts:31`. | Green locally. Tester adversarial test is still downstream scope per amendment §A4. |
| SC-A5 Amendment artifacts landed | Amendment committed at `Mingla_Artifacts/specs/SPEC_ORCH-0954_AMENDMENT_EMBEDDED_ONBOARDING.md`; review committed at `Mingla_Artifacts/reports/REVIEW_ORCH-0954_AMENDMENT.md`; tester report/evidence committed at `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`. | Complete for implementor. DEC-159 remains CLOSE scope. |
| SC-A6 Strict-grep controller gate updated | Gate asserts new enum at `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs:32`; workflow comment updated; ORCH-0863 backend allowlist extended at `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs:752`. | Green locally. |
| SC-A7 Option α preview key + origin override | `mingla-business/app.config.ts:90` production requires `pk_live_`; `mingla-business/app.config.ts:98` preview/development require `pk_test_`; client passes override at `mingla-business/src/services/brandStripeService.ts:167` and `mingla-business/src/services/brandStripeAccountSessionService.ts:35`; edge uses override for onboarding URL at `supabase/functions/brand-stripe-onboard/index.ts:723` and account session target URL at `supabase/functions/brand-stripe-account-session/index.ts:202`. | Code complete. Operator must set Vercel per-env variables before tester retest. |

## Section D — Fails-on-revert proof

Anchor commit: `97844fd6`.

1. Combined temporary revert:
   - Temporarily changed `supabase/functions/_shared/stripeBlueprintClient.ts:18` back to `fees_collector: "account"`.
   - Temporarily re-added `collection_options` under both server onboarding Account Session payloads.
   - Command:
     ```bash
     /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts
     ```
   - Expected red result occurred:
     ```text
     Error: Unrecognized enum value 'account', valid values are: application, stripe
     FAILED | 0 passed | 1 failed
     ```

2. Collection-options-only temporary revert:
   - Restored `fees_collector: "stripe"` but kept `collection_options` re-added under server onboarding payloads.
   - Same command failed with:
     ```text
     AssertionError: /Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/supabase/functions/brand-stripe-onboard/index.ts must not send server-side collection_options
     FAILED | 0 passed | 1 failed
     ```

3. Restoration proof:
   - Temporary changes were removed.
   - Same contract test passed green:
     ```text
     ok | 1 passed | 0 failed
     ```

## Section E — Verification run

Passed:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-onboard/index.ts
/Users/sethogieva/.deno/bin/deno check supabase/functions/brand-stripe-account-session/index.ts
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts
/Users/sethogieva/.deno/bin/deno test --allow-read supabase/functions/brand-stripe-onboard/index.test.ts
node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
cd mingla-business && npx jest src/__tests__/appConfig_pkLiveFailClose.test.ts src/utils/__tests__/onboardReactivation.test.ts src/services/__tests__/brandStripeAccountSessionService.test.ts --runInBand
```

Results:

- Deno checks: PASS.
- Deno scoped tests: PASS, 9 total tests across the executed files.
- Strict-grep gates: PASS.
- Jest scoped tests: PASS, 13 tests.

Partial / known unrelated failure:

```bash
cd mingla-business && npx tsc --noEmit
```

Result: FAIL on pre-existing repo-wide errors outside this ORCH surface, including checkout buyer implicit-`any` errors, ComposerV2/RichEditor typing errors, missing `@mingla/payments-native`, and package-level missing React/React Native types. No ORCH-0954 touched file was identified in the emitted errors.

## Section F — Deploy checklist

No database migration was created or modified. Do not run `supabase db push --linked`.

Do not deploy from implementor. Orchestrator deploy step should redeploy exactly:

```bash
supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy brand-stripe-account-session --project-ref gqnoajqerqhnvulmnyvv
```

Do not deploy:

- `stripe-webhook`
- `brand-stripe-tax-dashboard-link`

Vercel/operator env checklist:

- Production: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...`
- Preview: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- Development: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- No Supabase secret write is needed for `BUSINESS_WEB_ORIGIN`; it is already set and preview routing now uses the validated per-request override.
- Do not rotate, edit, or write any Stripe secret key.

## Section G — Downstream routing

Return to Claude `mingla-orchestrator` for REVIEW against this report and the amendment. After REVIEW, orchestrator deploys the two edge functions above and triggers/uses the Vercel Preview build with test publishable key. Then route to Claude `mingla-tester` for SPEC §6 retest against the Vercel Preview URL with Playwright plus Stripe TEST API contract proof. CLOSE remains orchestrator-owned: land amended DEC-159, standard artifact updates, and reap the worktree.
