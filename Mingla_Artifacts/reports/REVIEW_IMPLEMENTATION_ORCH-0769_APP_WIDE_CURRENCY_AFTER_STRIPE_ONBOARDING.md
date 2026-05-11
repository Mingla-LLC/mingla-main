# Review: ORCH-0769 app-wide currency after Stripe onboarding

**Date:** 2026-05-09
**Reviewer:** Orchestrator
**Verdict:** APPROVED FOR INDEPENDENT TESTER
**Close status:** NOT CLOSE-READY

## Plain-English Impact

The implementation appears to address the right commercial trust problem: when a Stripe-connected organiser has a non-GBP default currency, Mingla should not keep showing or storing GBP across Home, Events, checkout, orders, door sales, reconciliation, finance, and exports. The returned evidence is strong enough to leave the implementor gate, but the item cannot close until an independent tester verifies the static contract and the post-deploy runtime path.

## Accepted Evidence

- Implementation report returned at `reports/IMPLEMENTATION_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`.
- Migration `supabase/migrations/20260515000009_orch_0769_app_wide_currency.sql` is monotonic relative to the reported local and linked remote max migration prefix `20260515000008`.
- Database contract was implemented per report: `events.currency`, event/ticket currency enforcement, safe backfills, SCA-to-brand default currency sync, publish RPC currency derivation, and view exposure.
- Stripe edge contract was implemented per report: `brand-stripe-refresh-status` now persists Stripe `country/default_currency`; `brand-stripe-balances` uses brand default currency as fallback.
- Business app contract was implemented per report: brand/default currency mapping, draft/live event currency, checkout/cart/order/door/refund/reconciliation/export display, neutral aliases, legacy GBP compatibility, and currency-aware formatting.
- Regression gate added: `.github/scripts/strict-grep/orch-0769-app-wide-currency.mjs` plus `mingla-business` `test:orch-0769`.

## Verification Reported By Implementor

- `cd mingla-business && npm run test:orch-0769` passed: strict-grep plus 4 Jest suites / 25 tests.
- `cd mingla-business && npm run test:orch-0763` passed: 7 suites / 54 tests.
- `cd mingla-business && npm run test:orch-0759` passed: strict-grep self-test/live scan plus 4 suites / 30 tests. The synthetic self-test violation before PASS is expected.
- `cd mingla-business && npx tsc --noEmit` passed.
- Deno check passed for `supabase/functions/brand-stripe-refresh-status/index.ts`.
- Deno check passed for `supabase/functions/brand-stripe-balances/index.ts`.
- `git diff --check` passed.

## Remaining Gates

- Operator has not yet run `/Users/sethogieva/bin/supabase db push` for `20260515000009_orch_0769_app_wide_currency.sql`.
- Edge functions have not yet been deployed after DB push:
  - `/Users/sethogieva/bin/supabase functions deploy brand-stripe-refresh-status --project-ref gqnoajqerqhnvulmnyvv`
  - `/Users/sethogieva/bin/supabase functions deploy brand-stripe-balances --project-ref gqnoajqerqhnvulmnyvv`
- Business app deploy/OTA/runtime proof is still required.
- No independent tester report exists yet.
- Runtime Stripe path is still unproven for non-GBP fixtures such as USD/EUR/CAD after the implementation.

## Tester Dispatch Decision

Dispatch `$tester` with `prompts/TESTER_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`.

Tester must return `reports/TEST_REPORT_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md` with PASS / CONDITIONAL PASS / FAIL. A full PASS requires static, automated, deployment, and runtime evidence. If DB push, edge deploy, or business app deploy is not complete, tester may return CONDITIONAL PASS for static/automated verification only, with explicit runtime blockers.

## Scope Guard

This review does not authorize product-code edits, DB push, live Stripe mutation, close, commit, or push. The unrelated ORCH-0766/event-cover and package drift in the worktree should be ignored unless it directly affects tester setup.
