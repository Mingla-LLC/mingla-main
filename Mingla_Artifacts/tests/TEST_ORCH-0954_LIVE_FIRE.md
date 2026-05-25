# TEST - ORCH-0954 [Embedded onboarding cutover + Stripe-managed risk]

**Tester:** Codex `tester-mingla` parity mirror  
**Date:** 2026-05-25  
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/`  
**Branch:** `ORCH-0954-embedded-onboarding-cutover`  
**Verdict:** **FAIL - production live-fire gate not met**

## Executive result

ORCH-0954 is not production-ready for CLOSE yet. The scoped code checks pass and the new adversarial regression test is green, but SPEC section 6 live-fire cannot pass because the production route required for Smoke B currently returns Vercel 404:

`https://business.usemingla.com/connect-account-management?session=...`

This is not evidence that Stripe's `<ConnectAccountManagement>` component itself failed in TEST mode. It is a route availability/deploy sequencing blocker: the route must exist on a preview deploy or production web deploy before the required TEST-mode brand smoke can be run.

## Inputs read

- `Mingla_Artifacts/specs/SPEC_ORCH-0954_EMBEDDED_ONBOARDING_CUTOVER.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0954_EMBEDDED_ONBOARDING_CUTOVER.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0954_EMBEDDED_ONBOARDING_CUTOVER.md`
- `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`

## Comms ledger

Read before work. No open entries targeted to `tester`, `ALL`, or ORCH-0954. COMMS-0001 remains targeted to ORCH-0955 and was honored as a scope guard: `supabase/functions/brand-stripe-tax-dashboard-link/` was not touched.

## Live deploy/readiness evidence

### Edge functions

Command:

```bash
/Users/sethogieva/bin/supabase functions list --project-ref gqnoajqerqhnvulmnyvv | rg 'brand-stripe-onboard|brand-stripe-account-session|stripe-webhook|NAME'
```

Result:

```text
brand-stripe-onboard          ACTIVE  VERSION 92   UPDATED_AT 2026-05-25 03:15:25 UTC
brand-stripe-account-session  ACTIVE  VERSION 1    UPDATED_AT 2026-05-25 03:15:31 UTC
stripe-webhook                ACTIVE  VERSION 131  UPDATED_AT 2026-05-25 03:15:36 UTC
```

### Business web routes

Command:

```bash
curl -sS -D - -o /tmp/orch0954_onboarding.html 'https://business.usemingla.com/connect-onboarding?session=acs_test_placeholder&brand_id=00000000-0000-0000-0000-000000000000&return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Result: HTTP 200, Vercel, `content-length: 49543`.

Command:

```bash
curl -sS -D - -o /tmp/orch0954_management.html 'https://business.usemingla.com/connect-account-management?session=acs_test_placeholder&brand_id=00000000-0000-0000-0000-000000000000&return_to=mingla-business%3A%2F%2Fonboarding-complete'
```

Result: HTTP 404, Vercel, `x-vercel-error: NOT_FOUND`, `content-length: 79`.

## SPEC section 6 live-fire smokes

| Smoke | Required outcome | Actual result | Verdict |
|---|---|---|---|
| Smoke A - onboarding | Fresh TEST brand opens `business.usemingla.com/connect-onboarding`, embedded onboarding renders, KYC completes, onExit deep-links back, status refresh updates. | Not executed end-to-end. The production `/connect-onboarding` route is reachable (HTTP 200), but I did not create a fresh TEST brand because Smoke B was already blocked by route 404. | UNVERIFIED |
| Smoke B - account management | Same TEST brand opens `business.usemingla.com/connect-account-management`, notification banner + account management render, bank-account edit + payout schedule + tax-registration view can be inspected in TEST mode. | Blocked before Stripe component load. Production `/connect-account-management` returns HTTP 404. No component screenshot or screen recording can be truthfully captured from this deployment state. | FAIL |

## Stripe component risk check

Official Stripe docs still make Smoke B important:

- Account management is intended to show and edit connected-account details, including payout bank accounts: <https://docs.stripe.com/connect/supported-embedded-components/account-management>
- Stripe documents the account-management demo as behaving differently from live-mode usage with real connected accounts: <https://docs.stripe.com/connect/supported-embedded-components/account-management>
- Notification banner renders required-action tasks and may show no visible UI when there are no items: <https://docs.stripe.com/connect/supported-embedded-components/notification-banner>

Because `/connect-account-management` is not reachable, I could not verify bank-account edits, payout schedule changes, or tax-registration/tax-form visibility in TEST mode. This remains the main unresolved operator-impact risk.

## Code and regression evidence

### Static/code evidence verified

- `brand-stripe-onboard` fail-closes without `BUSINESS_WEB_ORIGIN`: `supabase/functions/brand-stripe-onboard/index.ts:46`.
- `brand-stripe-onboard` mints Account Sessions and returns Mingla-hosted onboarding URLs: `supabase/functions/brand-stripe-onboard/index.ts:682` and `supabase/functions/brand-stripe-onboard/index.ts:713`.
- `brand-stripe-account-session` fail-closes without `BUSINESS_WEB_ORIGIN`: `supabase/functions/brand-stripe-account-session/index.ts:28`.
- `brand-stripe-account-session` builds `account_management` + `notification_banner` sessions and target URLs: `supabase/functions/brand-stripe-account-session/index.ts:63`, `supabase/functions/brand-stripe-account-session/index.ts:95`, and `supabase/functions/brand-stripe-account-session/index.ts:210`.
- `connect-account-management.tsx` mounts `<ConnectNotificationBanner>` and `<ConnectAccountManagement>` with `collectionOptions` and `onLoadError`: `mingla-business/app/connect-account-management.tsx:150`.
- `BrandPaymentsView` top CTA calls `brand-stripe-account-session` and opens `targetUrl` via `WebBrowser.openAuthSessionAsync`: `mingla-business/src/components/brand/BrandPaymentsView.tsx:184` and `mingla-business/src/components/brand/BrandPaymentsView.tsx:341`.

### New adversarial regression

Path:

`supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts`

Coverage:

- Deletes `BUSINESS_WEB_ORIGIN`.
- Imports `brand-stripe-onboard` in a subprocess and requires module-load failure before `serve()` starts.
- Imports `brand-stripe-account-session` in a subprocess and requires module-load failure before `serve()` starts.
- Asserts the error does not contain or use fallback `https://business.usemingla.com`.

Normal green command:

```bash
/Users/sethogieva/.deno/bin/deno test --allow-run --allow-env --allow-read --allow-net supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts
```

Result:

```text
1 passed / 0 failed
```

Fails-on-revert proof:

- Anchor: current ORCH branch HEAD `5517ca39` plus the new uncommitted adversarial test.
- Temporary regression: changed `brand-stripe-onboard/index.ts:46` to restore fallback origin behavior: `Deno.env.get("BUSINESS_WEB_ORIGIN") ?? "https://business.usemingla.com"`.
- Expected red result occurred:

```text
AssertionError: Values are not equal: brand-stripe-onboard import must not start serve()
Actual: true
Expected: false
```

- The product file was restored, and the same adversarial test passed green again.

## Local verification commands

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/stripeBlueprintClient.ts supabase/functions/brand-stripe-onboard/index.ts supabase/functions/brand-stripe-account-session/index.ts supabase/functions/_shared/stripeWebhookRouter.ts
```

Result: PASS.

```bash
/Users/sethogieva/.deno/bin/deno test --allow-run --allow-env --allow-net --allow-read supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts supabase/functions/_shared/__tests__/stripeCountryReplacement.test.ts supabase/functions/brand-stripe-onboard/index.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.happy.test.ts supabase/functions/brand-stripe-onboard/__tests__/embeddedOnboarding.adversarial.test.ts
```

Result: PASS, 14 passed / 0 failed.

```bash
node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs
node .github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs
node .github/scripts/strict-grep/orch-0802-stripe-embedded-components-routing.mjs
```

Result: PASS.

## What remains unverified

- Fresh TEST brand creation through mingla-business.
- Stripe TEST-mode KYC completion in `<ConnectAccountOnboarding>`.
- `onExit` deep-link back into the app from the live page.
- Status refresh showing `charges_enabled: true` or the correct pending state.
- `<ConnectNotificationBanner>` rendering on the account-management page.
- `<ConnectAccountManagement>` rendering in TEST mode.
- Bank-account edits in TEST mode.
- Payout schedule changes in TEST mode.
- Tax-registration/tax-form surface visibility inside account management.
- DB row dump/diff after Stripe account updates.
- Screen recording/screenshot evidence for component surfaces.

## Required next action

Do not CLOSE ORCH-0954 yet. Orchestrator must make `/connect-account-management` reachable via either a preview deploy or the intended `[deploy]` web build, then dispatch tester to rerun SPEC section 6 on a fresh TEST-mode brand. If that rerun reaches the page and `<ConnectAccountManagement>` itself fails in TEST mode, treat that as the Smoke B component failure described by SPEC section 6; this report's current failure is earlier than that, at route availability.

