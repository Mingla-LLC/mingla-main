# REVIEW ORCH-0764A: Stripe Accounts v2 Hosted Onboarding

Date: 2026-05-08  
Mode: `$orchestrator`  
Reviewed implementation report:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING.md`

## Plain-English Impact

For organisers, this changes the payment setup path. Instead of Mingla creating an embedded Stripe onboarding session inside a Mingla-hosted `/connect-onboarding` page, Mingla now creates a Stripe Accounts v2 connected account and sends the organiser to Stripe's hosted onboarding link.

The buyer does not see a change yet. This does not implement ticket checkout, payment capture, QR ticket issuance, or payouts from ticket sales. It only changes the organiser-side payment onboarding foundation needed before real marketplace checkout can safely happen.

## Review Verdict

Accepted for tester verification.

Status remains: not closeable.

Reason:

- ORCH-0764A implementation is scoped correctly.
- Focused static and unit evidence is good.
- No live Stripe/Supabase mutation occurred.
- The implementation report honestly labels full Supabase Deno suite failure as unrelated ambient type debt.
- Runtime and independent verification are still missing.

## What Changed

Accepted implementation evidence says:

- `brand-stripe-onboard` no longer imports `stripeOnboard` or `STRIPE_API_VERSION`.
- `brand-stripe-onboard` no longer calls `stripe.accounts.create(...)`.
- `brand-stripe-onboard` no longer calls `stripe.accountSessions.create(...)`.
- New raw helper `supabase/functions/_shared/stripeBlueprintClient.ts` calls:
  - `POST /v2/core/accounts`
  - `POST /v2/core/account_links`
- The helper does not set `Stripe-Version`.
- The helper does not initialize a Stripe SDK client.
- The business app onboarding service type now allows `client_secret: null`.
- Existing UI can still open `result.onboarding_url`, now expected to be Stripe-hosted.

## Verification Evidence Reviewed

Passed:

- `deno test` focused ORCH-0764A/Stripe tests: 6 passed.
- `deno check` touched edge-function files: passed.
- `npx jest onboardReactivation.test deriveBrandStripeStatus.test --runInBand`: 2 suites, 15 tests passed.

Attempted but not green:

- Full `supabase/functions` Deno suite failed on unrelated pre-existing type-check errors in bouncer/scorer/person-hero tests.

## Remaining Risks

- Stripe Accounts v2 and Account Links access must be verified against Mingla's Stripe sandbox before deployment confidence.
- `STRIPE_RAK_ONBOARD` must have correct permissions for the Accounts v2/account-link calls.
- `v2.core.account[configuration.recipient].capability_status_updated` is not fully implemented yet.
- The legacy embedded onboarding page still exists but is no longer the ORCH-0764A path.
- ORCH-0764B must not trust account readiness until status/capability proof is solved.

## Next Gate

Dispatch tester with:

- `Mingla_Artifacts/prompts/TESTER_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING.md`

Do not dispatch ORCH-0764B until either:

- tester passes ORCH-0764A, or
- orchestrator explicitly accepts a conditional proceed with documented risk.

Do not close ORCH-0764A until:

- tester verification returns PASS or accepted CONDITIONAL PASS,
- required deploy/runtime gates are recorded,
- scoped files are committed and pushed under close protocol,
- Stripe sandbox setup requirements are either verified or explicitly deferred.

