# REVIEW: ORCH-0769 App-wide currency after Stripe onboarding

Date: 2026-05-09
Role: Orchestrator
Reviewed artifact: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`
Verdict: APPROVED FOR SPEC

## Plain-English impact

Mingla currently lets an organiser choose or complete Stripe onboarding for a non-GBP country, then continues to show and persist GBP across core commercial surfaces. This can make event prices, revenue, refunds, buyer checkout totals, reconciliation, and exports look wrong or legally/financially untrustworthy.

## Findings

### Approved - Root cause is proven, not merely plausible

The investigation proves five connected root causes with file-backed causal chains:

- Stripe-selected/default currency is written to `stripe_connect_accounts.default_currency`, but no trusted path updates `brands.default_currency`.
- Business app brand reads derive `Brand.defaultCurrency` from `brands.default_currency`, so cache invalidation refreshes a still-GBP value.
- Event publishing and ticket mappers still force `ticket_types.currency = 'GBP'`.
- Checkout, order, refund, and door-sale snapshots freeze `currency: "GBP"` and `*Gbp` amount fields.
- Home, Events, checkout, public pages, orders, guests, door, reconciliation, finance reports, and CSV/export surfaces still use GBP-only formatters or GBP-named data.

This is sufficient proof for SPEC. No additional investigation gate is needed before spec writing.

### Approved - Scope must remain cross-surface

A formatter-only patch would be unsafe. The spec must cover source-of-truth propagation, stored event/ticket currency, immutable transaction snapshots, historical data behavior, formatter conversion, and regression gates.

Required spec center of gravity:

- Canonical brand commerce currency.
- Stripe onboarding/SCA/brand propagation contract.
- Brand currency backfill rules for active connected accounts.
- Event draft/publish `ticket_types.currency` contract.
- Checkout/order/door/refund snapshot contract with historical currency preservation.
- UI/export conversion from GBP-only helpers to currency-aware formatting.
- Tests and strict-grep guards that prevent new GBP-only regressions.

### Risk - Migration/deploy sequencing must be explicit

This will likely need a Supabase migration for trigger/backfill/schema or RPC behavior. Local migration max observed during review is `20260515000008_orch_0767_public_brand_profile_view.sql`. The spec must require the implementor to re-check local and linked remote migration ledgers before creating any migration and choose a prefix greater than both.

## Decision

Promote ORCH-0769 from investigation to SPEC.

Next prompt:

- `Mingla_Artifacts/prompts/SPEC_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`

Expected output:

- `Mingla_Artifacts/specs/SPEC_ORCH-0769_APP_WIDE_CURRENCY_AFTER_STRIPE_ONBOARDING.md`

## Hard guards

- Do not dispatch implementor yet.
- Do not accept a symbol-only formatter swap.
- Do not relabel historical GBP order/door/refund amounts as another currency.
- Do not mutate Stripe/Supabase production data during spec.
- Do not let ORCH-0764C country-change work silently claim this as solved; ORCH-0764C covers Stripe account country replacement/status, not app-wide commerce currency.
