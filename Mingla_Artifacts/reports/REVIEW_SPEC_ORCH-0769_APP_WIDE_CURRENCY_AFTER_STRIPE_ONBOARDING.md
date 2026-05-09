# REVIEW: ORCH-0769 App-wide currency spec

Date: 2026-05-09
Role: Orchestrator
Reviewed artifact: `Mingla_Artifacts/specs/SPEC_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`
Verdict: APPROVED FOR IMPLEMENTATION

## Plain-English impact

The spec is strong enough to send to implementor. It fixes the real business risk: Mingla can currently onboard a non-GBP Stripe account while still showing and storing GBP across pricing, checkout, orders, door sales, reconciliation, and exports.

## Findings

### Approved - Source-of-truth decision is explicit

The spec correctly makes `brands.default_currency` the canonical brand commerce default and keeps `stripe_connect_accounts.default_currency` as Stripe account metadata. That prevents UI components from guessing between two currency owners.

### Approved - Historical GBP records are protected

The spec explicitly forbids relabeling old GBP orders, door sales, and refunds. Legacy `*Gbp` fields must normalize as GBP-only, while future records carry currency-neutral amounts plus ISO currency.

### Approved - Scope is broad enough for the actual bug

The spec covers the full proven blast radius:

- SCA-to-brand propagation and backfill.
- Event and ticket currency.
- Checkout/cart/order/door/refund snapshots.
- Home/Event/public/checkout/order/guest/door/reconciliation/finance/export displays.
- Strict-grep regression prevention.
- Migration/deploy sequencing.

This avoids the unsafe formatter-only fix.

### Approved - Migration and deploy gates are clear

The spec records current local and linked remote migration max as `20260515000008`, then requires implementor to re-check before writing a migration and choose a strictly higher prefix. It also keeps the operator/Codex deploy split intact: operator runs `supabase db push`; Codex runs Deno gates and deploys edge functions after DB confirmation.

## Implementation dispatch

Use:

- `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`

Expected output:

- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`

## Hard guards for implementor

- Do not implement a symbol-only currency formatter swap.
- Do not relabel historical GBP records to the new brand currency.
- Do not skip migration head re-checks.
- Do not ask the operator to run Deno gates as a substitute for Codex attempting them.
- Do not run `supabase db push`; operator owns DB push.
- Do not expand into real paid Checkout/PaymentIntent/destination-charge implementation.
