# G6 — Stripe LIVE evidence backfill (#426 / decision 2A)

**Gate:** G6 — Stripe TEST → LIVE  
**Mode:** Evidence backfill only (no mode flip). Product already asserts live-mode checkout.  
**Status:** 🟡 Partial — `pk_live` attestation landed; Stripe Dashboard screenshots still required.

## Canonical product attestation (in-repo)

From [`PRODUCT_AND_STRATEGY.md`](../../../PRODUCT_AND_STRATEGY.md) §2 (2026-07-19):

> **Stripe (live mode)** — card checkout for tickets, reservations, trips, and experiences, with brand-level Stripe Connect payouts…

Also asserts **Paystack (live mode)** for the Nigeria rail.

## Evidence captured

| Check | Artifact | Status |
|-------|----------|--------|
| Redacted live publishable-key attestation (from verified production OTA manifests in COMMS) | [`reports/eas-pk-live-redacted.txt`](./reports/eas-pk-live-redacted.txt) | ✅ |
| Stripe Dashboard in **Live** mode (platform account) | `reports/stripe-live-dashboard.png` | ❌ needs operator login |
| Live Connect + Platform webhook endpoints present | `reports/stripe-live-webhooks.png` | ❌ needs operator login |
| One recent live charge or Connect payout row (PII redacted) | `reports/live-charge-redacted.png` | ❌ needs operator login |

## Checklist annotation

Work [`docs/runbooks/B2_GO_LIVE_CHECKLIST.md`](../../runbooks/B2_GO_LIVE_CHECKLIST.md) only after dashboard screenshots exist. Until then:

- Publishable key live-mode: treat as `[x] verified-already-live` via COMMS OTA manifest checks cited in `eas-pk-live-redacted.txt`
- Webhooks / live charge / Connect payout UI: leave open

## Close checklist for #426

- [~] Partial screenshots / redacted attestation under `reports/` (pk_live only)
- [ ] Stripe Dashboard + webhooks + live charge screenshots
- [ ] B2 checklist fully annotated
- [ ] Epic Tier 2 G6 row → ✅ (blocked on dashboard trio)
