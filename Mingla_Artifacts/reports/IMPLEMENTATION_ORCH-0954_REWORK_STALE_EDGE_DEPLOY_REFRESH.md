# Implementation Report: Stale Edge Deploy Refresh (ORCH-0954)

> Date: 2026-05-25 06:06 UTC
> Mode: Rework / deploy refresh
> Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0954-[embedded-onboarding-cutover]/`
> Branch: `ORCH-0954-embedded-onboarding-cutover`
> Source: `Mingla_Artifacts/tests/TEST_ORCH-0954_LIVE_FIRE.md`
> Status: implemented, partially verified

## 1. Layman Summary

The deployed edge functions were still behaving like older code even though the ORCH branch had the Stripe fixes locally. I verified the local branch still has the corrected Stripe controller and Account Session form encoding, then redeployed only the two scoped edge functions so tester can rerun SPEC §6 against the fresh runtime.

## 2. Comms Ledger

- Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` before work.
- Factored in `COMMS-0003`: Stripe docs and provider payload shape were treated as mandatory.
- Factored in `COMMS-0002`: backend strict-grep gate was rerun because this ORCH touches Supabase functions.
- No open BLOCK entries applied to implementor / ORCH-0954 / ALL.

## 3. Scope

- **In scope:** Verify the current local ORCH-0954 Stripe edge code, deploy `brand-stripe-onboard`, deploy `brand-stripe-account-session`, record deploy evidence for tester.
- **Out of scope:** `brand-stripe-tax-dashboard-link/`, secret writes, Stripe live-mode calls, Vercel Production key changes, browser live-fire PASS/FAIL adjudication.
- **Authorization basis:** The user dispatch named stale deployed function versions and requested implementation/deploy evidence under `Mingla_Artifacts/reports/`; only the two named scoped functions were deployed.

## 4. Stripe Docs Checked

- Account Sessions create: https://docs.stripe.com/api/account_sessions/create
- Accounts v2 create: https://docs.stripe.com/api/v2/core/accounts/create
- `stripe-best-practices` Connect reference was also read before acting.

## 5. Local Code Verification

| Check | Evidence | Status |
|---|---|---|
| Controller no longer uses stale `fees_collector: "account"` | `rg` over scoped Stripe files found no `fees_collector: "account"` hits; `STRIPE_MANAGED_RISK_CONTROLLER` uses `fees_collector: "stripe"`. | PASS |
| `/v1/account_sessions` uses form encoding | `createAccountSession()` sets `bodyFormat: "form"` and tests assert `application/x-www-form-urlencoded`. | PASS |
| Server-side onboarding payload does not send unsupported `collection_options` | `rg` found `collection_options` only in tests that reject/assert absence, not in runtime edge payloads. | PASS |
| `brand-stripe-tax-dashboard-link/` untouched | No read/write/deploy was performed for that function. | PASS |

## 6. Verification Commands

| Check | Command | Result |
|---|---|---|
| Deno check | `/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/stripeBlueprintClient.ts supabase/functions/brand-stripe-onboard/index.ts supabase/functions/brand-stripe-account-session/index.ts` | PASS |
| Scoped Stripe helper tests | `/Users/sethogieva/.deno/bin/deno test --allow-env --allow-read supabase/functions/_shared/__tests__/stripeBlueprintClient.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient.contract.test.ts supabase/functions/_shared/__tests__/stripeBlueprintClient_failclose.test.ts` | PASS, 6 passed / 0 failed |
| Strict-grep guards | `node .github/scripts/strict-grep/orch-0954-controller-props-pinned.mjs && node .github/scripts/strict-grep/orch-0954-rak-scope-pinned.mjs && node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS |

## 7. Deploy Evidence

Deploy commands run from the ORCH-0954 worktree:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy brand-stripe-account-session --project-ref gqnoajqerqhnvulmnyvv
```

Deploy results:

```text
Deployed Functions on project gqnoajqerqhnvulmnyvv: brand-stripe-onboard
Deployed Functions on project gqnoajqerqhnvulmnyvv: brand-stripe-account-session
```

Post-deploy function list:

```text
brand-stripe-onboard          ACTIVE  VERSION 100  UPDATED_AT 2026-05-25 06:06:22 UTC
brand-stripe-account-session  ACTIVE  VERSION 8    UPDATED_AT 2026-05-25 06:06:34 UTC
```

## 8. Risk / Remaining Gates

| Item | Status | Owner |
|---|---|---|
| Fresh TEST brand onboarding returns embedded Account Session client secret / target URL | Unverified after deploy | Tester |
| Account-management Account Session returns client secret / target URL for the same brand | Unverified after deploy | Tester |
| Browser render of `<ConnectAccountOnboarding>`, `<ConnectNotificationBanner>`, and `<ConnectAccountManagement>` on the validation host | Unverified after deploy | Tester |
| KYC completion, `onExit`, bank edit, payout schedule, tax-registration view, DB diff | Unverified after deploy | Tester |

## 9. Handoff

Route to tester for SPEC §6 live-fire retest. Do not route ORCH-0954 to orchestrator CLOSE until tester records PASS.
