# REVIEW ORCH-0764A: Stripe Accounts v2 Hosted Onboarding Runtime Fail

Date: 2026-05-08  
Mode: `$orchestrator`  
Reviewed tester report:

- `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING.md`

## Plain-English Impact

The organiser-side Stripe setup path is not closeable. Local code now appears to implement the Stripe blueprint shape, but the phone proved the deployed backend is still serving the old Mingla-hosted embedded onboarding flow. For the user, tapping into Stripe setup for the `Test Stripe` brand lands on `Mingla -- Set up payments` and shows `Something went wrong` / `There was an error during authentication`, instead of a usable Stripe-hosted onboarding flow.

This blocks real paid-ticket readiness. We cannot safely start treating a brand as Stripe-ready just because a local implementation exists or a `stripe_connect_accounts` row was created.

## Review Verdict

Verdict: FAIL accepted.

Next lifecycle: `$implementor` rework.

ORCH-0764A cannot close, and ORCH-0764B checkout/webhook work should stay paused except for planning. Checkout must not assume a connected account is payout/transfer-ready from row existence alone.

## Evidence Accepted

Local implementation evidence remains useful:

- Focused Accounts v2 helper tests passed.
- Focused `brand-stripe-onboard` Deno check passed.
- Focused business Jest tests passed.
- Local source no longer depends on `stripe.accounts.create`, `accountSessions.create`, `STRIPE_API_VERSION`, SDK `apiVersion`, or `Stripe-Version` for the ORCH-0764A path.

Runtime evidence overrides the close decision:

- Deployed `brand-stripe-onboard` returned HTTP 200 after ToS acceptance, but with the old response shape.
- Observed `client_secret_is_null = false`.
- Observed `onboarding_url_host = business.usemingla.com`.
- Observed `onboarding_url_path_prefix = /connect-onboarding`.
- Expected ORCH-0764A contract is `client_secret: null` plus a Stripe-hosted Account Link URL created through `/v2/core/account_links`.
- Opening the returned URL in iOS simulator produced an authentication error instead of Stripe onboarding.
- A `stripe_connect_accounts` row now exists for `Test Stripe`, but charges/payouts remain false and full hosted onboarding did not complete.

Adjacent runtime finding:

- Repeat `brand-mingla-tos-accept` after accepted state returned HTTP 500 with generic text while stored ToS remained accepted. This is an idempotency and observability flaw on the pre-Stripe gate.

## Required Rework

The rework must prove and repair the runtime boundary, not just restate local code:

- Reconcile local `brand-stripe-onboard` with the deployed function behavior.
- Prepare or perform the authorized sandbox edge-function deploy for `brand-stripe-onboard` and its shared helper dependencies.
- Verify the deployed function returns the ORCH-0764A contract: `client_secret: null`, `account_id`, and a Stripe-hosted `onboarding_url`.
- Keep the Accounts v2 rule: no guessed API version, no SDK `apiVersion`, no `Stripe-Version` header.
- Make repeat Mingla ToS acceptance idempotent or return a clear non-500 structured JSON response.
- Add regression tests for deployed-contract drift where practical, plus local tests for the ToS idempotency/error shape.
- Handle the existing `Test Stripe` connected-account row safely: reuse when valid, return a clear error when incompatible, and do not silently create duplicate Stripe accounts without an explicit policy.

## Next Dispatch

Dispatch `$implementor` with:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME_DEPLOY.md`

Expected implementation report:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME_DEPLOY.md`

After implementor returns, the next gate is `$tester` simulator retest against the deployed sandbox function and the `Test Stripe` brand.
