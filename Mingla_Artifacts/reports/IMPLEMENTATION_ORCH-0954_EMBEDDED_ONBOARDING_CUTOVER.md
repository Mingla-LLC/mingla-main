# IMPLEMENTATION — ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk]

**Status:** implemented, partially verified  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/`  
**Branch:** `ORCH-0954-embedded-onboarding-cutover`  
**Implementation commit:** `316da32075c16c3544a0eee80355f2cfbbd08585`  
**Report commit:** this report is committed on the ORCH branch after the implementation commit.  
**Date:** 2026-05-24

## Summary

ORCH-0954 cut new Stripe connected-account creation from platform-liable Express hosted onboarding to Stripe-managed-risk embedded onboarding. New accounts now use `losses_collector="stripe"`, `fees_collector="account"`, `dashboard="none"`, onboarding returns a real Account Session `client_secret`, and Mingla Business opens Stripe embedded components on Mingla-hosted web pages. The Tax dashboard-link function was not touched; ORCH-0955 still owns that rewrite per COMMS-0001.

## Success Criteria Trace

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | `STRIPE_MANAGED_RISK_CONTROLLER` pins `losses_collector: "stripe"`, `fees_collector: "account"`, `dashboard: "none"` at `supabase/functions/_shared/stripeBlueprintClient.ts:14`; `createRecipientAccount` spreads it at `supabase/functions/_shared/stripeBlueprintClient.ts:189`. |
| 2 | PASS with ORCH-0953 override | `createAccountSession()` exists at `supabase/functions/_shared/stripeBlueprintClient.ts:204`, POSTs `/v1/account_sessions` at line 209, and uses `envVarNames: ["STRIPE_RAK_ONBOARD"]` at line 210. This intentionally preserves ORCH-0953 fail-close and does not reintroduce `STRIPE_SECRET_KEY` fallback. |
| 3 | PASS | `brand-stripe-onboard` calls `createAccountSession` at `supabase/functions/brand-stripe-onboard/index.ts:682`, requests `account_onboarding` with `collection_options.fields="eventually_due"` at lines 685-692, builds `${BUSINESS_WEB_ORIGIN}/connect-onboarding?...` at lines 713-716, and returns `client_secret` at line 739. |
| 4 | PASS | All three `controller_dashboard_type` writes now use `"none"`: `brand-stripe-onboard/index.ts:391`, `brand-stripe-onboard/index.ts:728`, `_shared/stripeWebhookRouter.ts:204`. |
| 5 | PASS | `connect-onboarding.tsx` mounts `ConnectNotificationBanner` at line 209 and `ConnectAccountOnboarding` with `onExit`, `onStepChange`, `onLoadError`, legal URL props, and `collectionOptions` at lines 215-226. |
| 6 | PASS | New `connect-account-management.tsx` mounts `ConnectNotificationBanner` at lines 151-158 and `ConnectAccountManagement` at lines 159-165, with a manual `Done` control at lines 144-145. |
| 7 | PASS | New `brand-stripe-account-session` function exists at `supabase/functions/brand-stripe-account-session/index.ts:2`, accepts `surface` at lines 35-40, supports `account_management` components at lines 63-80, and returns `target_url` at line 213. `BrandPaymentsView` invokes it through the new service/hook and opens `targetUrl` via `WebBrowser.openAuthSessionAsync` at `mingla-business/src/components/brand/BrandPaymentsView.tsx:190`. |
| 8 | PASS | `BrandOnboardView.tsx` was intentionally unchanged; it still opens `result.onboarding_url` via `expo-web-browser.openAuthSessionAsync(url, RETURN_DEEP_LINK)`. |
| 9 | DEFERRED TO CLOSE | DEC-159 text remains a CLOSE responsibility per SPEC §2. No code change needed before orchestrator CLOSE. |
| 10 | PASS | Strict-grep gates added at `.github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs:3` and `.github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs:3`; workflow registration at `.github/workflows/strict-grep-mingla-business.yml:1252` and line 1263. |
| 11 | PASS for implementor happy path | Happy-path regression added at `supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts:2`. Fail-close/account-session coverage added at `_shared/__tests__/stripeBlueprintClient_failclose.test.ts:54`. Tester still owns the adversarial tests per SPEC §5.b/§5.c. |
| 12 | PENDING TESTER | Live-fire TEST-mode smokes are not implementor-run. Tester must execute SPEC §6 and write `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`. |

## File-Level Changes

### Backend / Edge

- `supabase/functions/_shared/stripeBlueprintClient.ts`
  - Added exported `STRIPE_MANAGED_RISK_CONTROLLER`.
  - Added optional Stripe API version override to `stripeBlueprintRequest`.
  - Added `AccountSessionComponents`, `CreateAccountSessionInput`, `StripeAccountSession`, and `createAccountSession()`.
  - Preserved ORCH-0953 RAK-only fail-close: every helper uses `envVarNames: ["STRIPE_RAK_ONBOARD"]`.
- `supabase/functions/_shared/stripeCountryReplacement.ts`
  - Added `buildStripeAccountSessionOperation(country, stripeAccountId)`.
- `supabase/functions/brand-stripe-onboard/index.ts`
  - Replaced hosted Account Link creation with Account Session creation.
  - Changed `BUSINESS_WEB_ORIGIN` to a required fail-close secret.
  - Changed SCA/audit controller type to `"none"` and audit surface to `"mingla_hosted_embedded_components"`.
- `supabase/functions/brand-stripe-account-session/index.ts`
  - New function for existing connected accounts; mints onboarding or account-management Account Sessions and returns a Mingla-hosted URL.
- `supabase/functions/_shared/stripeWebhookRouter.ts`
  - Changed account-updated upsert mirror to `controller_dashboard_type: "none"`.

### Business UI

- `mingla-business/app/connect-onboarding.tsx`
  - Added `ConnectNotificationBanner`, legal URL props, `onStepChange`, `onLoadError`, and explicit collection options.
- `mingla-business/app/connect-account-management.tsx`
  - New Mingla-hosted Stripe account-management page with `ConnectNotificationBanner`, `ConnectAccountManagement`, error states, and `Done` redirect.
- `mingla-business/src/components/brand/BrandPaymentsView.tsx`
  - Added top CTA labeled **Manage payouts & tax** for active/restricted brands.
  - CTA mints an account-management session and opens the target URL in `expo-web-browser`.
- `mingla-business/src/services/brandStripeAccountSessionService.ts`
  - New frontend service wrapper for `brand-stripe-account-session`.
- `mingla-business/src/hooks/useBrandStripeAccountSession.ts`
  - New React Query mutation for embedded Account Sessions.
- `mingla-business/app/stripe-onboarding-return.tsx`
  - Marked `@deprecated` for hosted Account Link legacy/TEST paths.

## Verification

### Passed

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/stripeBlueprintClient.ts supabase/functions/brand-stripe-onboard/index.ts supabase/functions/brand-stripe-account-session/index.ts supabase/functions/_shared/stripeWebhookRouter.ts
```

Result: PASS.

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts supabase/functions/_shared/__tests__/stripeCountryReplacement.test.ts supabase/functions/brand-stripe-onboard/index.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts
```

Result: PASS, 13 passed / 0 failed.

```bash
node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs
node .github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs
node .github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs
```

Result: PASS. ORCH-0802 scanned 787 files and preserved Path B/no-WebView/no-native-preview routing.

### Fails-On-Revert Proof

After commit `316da32075c16c3544a0eee80355f2cfbbd08585`, I temporarily changed `STRIPE_MANAGED_RISK_CONTROLLER` back to the old controller values:

```ts
losses_collector: "application"
fees_collector: "application"
dashboard: "express"
```

Then I ran:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-net --allow-read supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts
```

Expected failure occurred:

```text
ORCH-0954 — managed-risk controller constant is pinned ... FAILED
Actual: application
Expected: stripe
```

The strict-grep gate also failed as expected:

```text
ORCH-0954 controller-props strict-grep FAILED:
Managed-risk controller constant is missing losses_collector: "stripe".
```

The source was restored and the same happy-path test passed again.

### Partial / Blocked Verification

```bash
cd mingla-business && npx tsc --noEmit
```

Result: FAIL due to pre-existing unrelated TypeScript errors in checkout buyer pages, ComposerV2, IconChrome, Sheet.web, native payment module resolution, shared packages, and old tests. A targeted filtered rerun showed no errors mentioning the new ORCH-0954 files: `connect-onboarding`, `connect-account-management`, `BrandPaymentsView`, `brandStripeAccountSession`, `brandStripeService`, or `useBrandStripeAccountSession`.

## Deploy Checklist

No Supabase migration is required. Do **not** run `supabase db push --linked` for ORCH-0954.

Operator secret step before deploy:

```bash
/Users/sethogieva/bin/supabase secrets set --project-ref gqnoajqerqhnvulmnyvv BUSINESS_WEB_ORIGIN="https://business.usemingla.com"
```

Required edge-function deploys after REVIEW approval and after the secret is written:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]" &&
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv &&
/Users/sethogieva/bin/supabase functions deploy brand-stripe-account-session --project-ref gqnoajqerqhnvulmnyvv &&
/Users/sethogieva/bin/supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv
```

`stripe-webhook` is included because `_shared/stripeWebhookRouter.ts` changed. Do **not** deploy `brand-stripe-tax-dashboard-link`; ORCH-0955 owns that function.

Business web deploy/hosting must include:

- `mingla-business/app/connect-onboarding.tsx`
- `mingla-business/app/connect-account-management.tsx`

## Tester Gates

Tester must run SPEC §6 live-fire validation on a fresh TEST brand and write:

`Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`

Required smokes:

1. Onboarding end-to-end: `Set up payments` opens `business.usemingla.com/connect-onboarding?session=...`, embedded onboarding renders, onExit deep-links back, and status refresh shows active or correct pending state.
2. Account management end-to-end: **Manage payouts & tax** opens `business.usemingla.com/connect-account-management?session=...`, both notification banner and account management render, and bank/account edits behave correctly in TEST mode.

## Scope Guard Receipts

- `supabase/functions/brand-stripe-tax-dashboard-link/` was not modified.
- No migrations were created or modified.
- No Supabase secrets were written.
- No edge functions were deployed.
- No Stripe Dashboard keys/settings were mutated.
- Consumer `app-mobile/` code was not modified.

## Known Follow-Ups / Risks

- DEC-159 still needs to land in `Mingla_Artifacts/DECISION_LOG.md` during orchestrator CLOSE, per SPEC §2.
- ORCH-0955 must rewrite the Tax dashboard link path before live brands rely on Stripe Tax settings under `dashboard:"none"`.
- `<ConnectAccountManagement>` still requires tester live-fire confirmation because Stripe docs warned that the component can differ from demo/preview behavior.
