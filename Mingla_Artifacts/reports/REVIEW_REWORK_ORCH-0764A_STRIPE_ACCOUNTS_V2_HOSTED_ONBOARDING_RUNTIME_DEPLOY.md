# REVIEW REWORK ORCH-0764A: Stripe Accounts v2 Hosted Onboarding Runtime Deploy

Date: 2026-05-08  
Mode: `$orchestrator`  
Reviewed implementation report:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME_DEPLOY.md`

## Plain-English Impact

The user-facing Stripe setup bug is not closed yet, but the rework moved it to the correct next gate. The local code now has a cleaner ToS gate and stronger regression coverage. The thing still missing is the real one: deploy the updated edge functions, then prove on the iOS simulator that `Test Stripe` opens a Stripe-hosted Account Link instead of the old Mingla-hosted `/connect-onboarding` page.

Until that runtime proof exists, Mingla must not claim Stripe Connect readiness or start checkout work that depends on account readiness.

## Review Verdict

Verdict: accepted for deploy/runtime retest.

Status: not closeable.

Next lifecycle:

1. Authorized edge-function deploy.
2. `$tester` runtime retest on iOS simulator for `Test Stripe`.

## Evidence Reviewed

Accepted implementation evidence:

- `brand-mingla-tos-accept` now checks existing ToS state before writing.
- Repeat same-version ToS acceptance returns existing `accepted_at`, `version`, and `already_accepted: true`.
- `brand-mingla-tos-accept` now calls `writeAudit` with the canonical `_shared/audit.ts` input shape.
- Audit write failure is logged but no longer turns a successful ToS write into a user-facing 500.
- `brand-stripe-onboard` source-contract tests now guard hosted onboarding and existing connected-account reuse.
- Stripe helper tests verify the returned Account Link URL and no version override header.
- Legacy Vercel runbook no longer says `/connect-onboarding?session=...` is the ORCH-0764A expected path.

Verification accepted:

- Focused Supabase Deno tests: PASS, 6 passed.
- Focused Supabase Deno check: PASS.
- Focused business Jest: PASS, 2 suites / 15 tests.
- Forbidden-string sweep: product path clean; matches only intentional negative test assertions.
- `git diff --check`: PASS.
- Broad Supabase Deno suite still fails on unrelated ambient type debt already known from prior ORCH-0764A testing.

## Remaining Blockers

- No edge-function deploy has happened for this rework.
- Runtime/deployed `brand-stripe-onboard` still has to be proven to return:
  - `client_secret: null`
  - an `account_id`
  - a Stripe-hosted `onboarding_url`
- Runtime/deployed `brand-mingla-tos-accept` still has to be proven not to return a repeat-accept 500.
- `STRIPE_RAK_ONBOARD` Accounts v2 scope remains unproven.
- Accounts v2 capability/status event handling remains unresolved for ORCH-0764 close.

## Deploy Gate

No DB migration is involved.

When the user authorizes deploy, deploy both changed edge functions:

```bash
/Users/sethogieva/bin/supabase functions deploy brand-stripe-onboard --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy brand-mingla-tos-accept --project-ref gqnoajqerqhnvulmnyvv
```

Then dispatch tester with:

- `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`

Expected tester report:

- `Mingla_Artifacts/reports/RETEST_ORCH-0764A_STRIPE_ACCOUNTS_V2_HOSTED_ONBOARDING_RUNTIME.md`

## ORCH-0764B Decision

Keep ORCH-0764B paused as implementation work.

Reason: checkout must not infer account readiness from local row existence alone. It needs deployed hosted onboarding proof and either Accounts v2 status/capability proof or an explicit safe checkout block until readiness is proven.
