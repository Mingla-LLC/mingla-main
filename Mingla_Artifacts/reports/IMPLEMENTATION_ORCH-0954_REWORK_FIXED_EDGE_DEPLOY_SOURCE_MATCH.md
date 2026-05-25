# Implementation Report: ORCH-0954 Fixed Edge Deploy Source Match

> Date: 2026-05-25 06:30 UTC
> Mode: Rework / TEST-mode edge deploy
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/`
> Branch: `ORCH-0954-embedded-onboarding-cutover`
> Status: implemented and verified for the scoped edge-runtime contract

## 1. Summary

Tester proved the deployed edge runtime still behaved stale after the prior deploy refresh: `brand-stripe-onboard` still sent `fees_collector:"account"` and `brand-stripe-account-session` still sent `/v1/account_sessions` as JSON. I downloaded the active deployed source and proved the active bundle still contained the old `_shared/stripeBlueprintClient.ts`. I then redeployed only `brand-stripe-onboard` and `brand-stripe-account-session` from the ORCH worktree with the fixed shared helper, downloaded the active source again, and live-fired the deployed functions in Stripe/Supabase TEST mode.

The scoped deploy is now green: a fresh TEST brand receives an embedded onboarding session, the local row persists `controller_dashboard_type='none'`, and both `surface:"onboarding"` and `surface:"account_management"` return Account Session client secrets / target URLs.

## 2. Comms Ledger

- Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before work.
- Acknowledged `COMMS-0004` as `implementor+codex (ORCH-0954)` and committed that ack directly to anchor `main` at `15ca67e85`.
- Factored in `COMMS-0003`: Stripe provider docs and live TEST API behavior are the source of truth for payload shape.
- Factored in `COMMS-0002`: reran the backend strict-grep gate because this ORCH touches Supabase functions.

## 3. Scope / Hard Guards

In scope:

- Prove why deployed versions were stale.
- Fix/redeploy only `brand-stripe-onboard` and `brand-stripe-account-session`.
- Verify `brand-stripe-onboard` no longer sends `fees_collector:"account"`.
- Verify `brand-stripe-account-session` form-encodes both onboarding and account-management Account Sessions.

Hard guards honored:

- TEST mode only.
- No `brand-stripe-tax-dashboard-link/` read, edit, or deploy.
- No secret writes.
- No Stripe or Vercel Production key changes.
- No test weakening.

## 4. Root Cause Proof

The local ORCH worktree had the intended helper changes, but Supabase's active deployed source did not. I downloaded the active deployed functions before the fix using:

```bash
cd /tmp/orch0954-edge-download
/Users/sethogieva/bin/supabase functions download brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv --use-api
/Users/sethogieva/bin/supabase functions download brand-stripe-account-session --project-ref gqnoajqerqhnvulmnyvv --use-api
```

Pre-fix active source still contained:

```text
supabase/functions/_shared/stripeBlueprintClient.ts:18:      fees_collector: "account",
supabase/functions/_shared/stripeBlueprintClient.ts:119:    "Content-Type": "application/json",
supabase/functions/brand-stripe-account-session/index.ts:86:        collection_options: {
supabase/functions/brand-stripe-onboard/index.ts:689:              collection_options: {
```

That exactly matches tester's stale runtime failures. The root cause was not Stripe, database state, or the handler code path; the active edge bundle did not contain the ORCH worktree's corrected shared helper.

## 5. Stripe Docs Checked

- Accounts v2 create: https://docs.stripe.com/api/v2/core/accounts/create
- Account Sessions create: https://docs.stripe.com/api/account_sessions/create
- `stripe-best-practices` Connect reference read before deploy/verification.

Relevant docs shape confirmed:

- Accounts v2 create remains the JSON `/v2/core/accounts` path for account creation.
- Account Sessions create examples use form parameters (`-d account=...`, `-d components[...]...`) for `/v1/account_sessions`.

## 6. Code / Test Contract

Scoped code contract in `supabase/functions/_shared/stripeBlueprintClient.ts`:

- `STRIPE_MANAGED_RISK_CONTROLLER.defaults.responsibilities.fees_collector` is `"stripe"`.
- `createAccountSession()` sets `bodyFormat: "form"`.
- `stripeBlueprintRequest()` encodes form payloads as `application/x-www-form-urlencoded`.
- Server-side `collection_options` is absent from the scoped edge runtime.

Regression tests retained:

- `supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts`
- `supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts`

## 7. Verification Commands

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/stripeBlueprintClient.ts supabase/functions/brand-stripe-onboard/index.ts supabase/functions/brand-stripe-account-session/index.ts
```

Result: PASS.

```bash
/Users/sethogieva/.deno/bin/deno test --allow-env --allow-read supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts
```

Result: PASS, 6 passed / 0 failed.

```bash
node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs &&
node .github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs &&
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
```

Result: PASS.

## 8. Deploy Receipt

Deploy commands run from the ORCH-0954 worktree:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv --use-api
/Users/sethogieva/bin/supabase functions deploy brand-stripe-account-session --project-ref gqnoajqerqhnvulmnyvv --use-api
```

Deploy output showed the shared helper was uploaded for both scoped functions:

```text
Uploading asset (brand-stripe-onboard): supabase/functions/_shared/stripeBlueprintClient.ts
Uploading asset (brand-stripe-account-session): supabase/functions/_shared/stripeBlueprintClient.ts
```

Post-deploy function list:

```text
brand-stripe-onboard          ACTIVE  VERSION 102  UPDATED_AT 2026-05-25 06:21:43 UTC
brand-stripe-account-session  ACTIVE  VERSION 10   UPDATED_AT 2026-05-25 06:21:44 UTC
```

Post-deploy downloaded active source proof:

```text
/tmp/orch0954-edge-download-after/stripeBlueprintClient.onboard.ts:18:      fees_collector: "stripe",
/tmp/orch0954-edge-download-after/stripeBlueprintClient.onboard.ts:145:      contentType: "application/x-www-form-urlencoded",
/tmp/orch0954-edge-download-after/stripeBlueprintClient.onboard.ts:259:    bodyFormat: "form",
/tmp/orch0954-edge-download-after/stripeBlueprintClient.account-session.ts:18:      fees_collector: "stripe",
/tmp/orch0954-edge-download-after/stripeBlueprintClient.account-session.ts:145:      contentType: "application/x-www-form-urlencoded",
/tmp/orch0954-edge-download-after/stripeBlueprintClient.account-session.ts:259:    bodyFormat: "form",
```

Diff between downloaded active helper and local worktree helper after deploy: no output.

## 9. TEST-Mode Live-Fire

Evidence file:

- `Mingla_Artifacts/tests/evidence/orch-0954-live-fire-after-fixed-edge-deploy.json`

Live-fire setup:

- Supabase project: `gqnoajqerqhnvulmnyvv`
- Preview origin override: `https://mingla-business-9cd9mn2im-seth-ogievas-projects.vercel.app`
- Fresh TEST email: `sethogieva+orch0954-fixed-20260525062338@usemingla.com`
- Fresh TEST brand: `06ebc5bb-ed82-4e9d-8ee8-a6f2921d31b8`
- Stripe account created by deployed edge: `acct_1TarvNPjlZQpe8xe`

Results:

| Path | Expected | Actual | Status |
|---|---|---|---|
| Fresh `brand-stripe-onboard` | No `fees_collector:"account"` rejection; returns embedded onboarding session | HTTP 200 with redacted `client_secret`, `account_id`, and `onboarding_url` | PASS |
| DB persistence | `controller_dashboard_type='none'`, country/default currency persisted | Row persisted with `controller_dashboard_type:"none"`, `country:"US"`, `default_currency:"USD"`, `detached_at:null` | PASS |
| `brand-stripe-account-session` / onboarding | Form-encodes Account Session and returns target URL | HTTP 200 with redacted `client_secret` and `/connect-onboarding` target URL | PASS |
| `brand-stripe-account-session` / account management | Form-encodes Account Session and returns target URL | HTTP 200 with redacted `client_secret` and `/connect-account-management` target URL | PASS |

Secret scan:

```bash
rg -n "acs_test_|access_token|refresh_token|sk_live|rk_live|pk_live|sk_test|rk_test|client_secret\\\": \\\"acs|password" Mingla_Artifacts/tests/evidence/orch-0954-live-fire-after-fixed-edge-deploy.json || true
```

Result: no matches.

## 10. Remaining Tester Gates

This rework verifies the scoped edge runtime and Stripe payload contract. Tester still owns the full SPEC §6 browser/render gate:

- `<ConnectAccountOnboarding>` render on validation host.
- KYC completion.
- `onExit` deep link back to `mingla-business://onboarding-complete`.
- Status refresh.
- `<ConnectNotificationBanner>` and `<ConnectAccountManagement>` render.
- Bank edit, payout schedule, tax-registration inspection, and DB diff.

## 11. Handoff

Route back to Codex `tester-mingla` for live-fire retest using this report and the new evidence file. Do not route ORCH-0954 to CLOSE until tester records PASS.
