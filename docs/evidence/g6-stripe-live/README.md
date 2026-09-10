# G6 — Stripe LIVE evidence backfill (#426 / decision 2A)

**Gate:** G6 — Stripe TEST → LIVE  
**Mode:** Evidence backfill only (no mode flip). Product already asserts live-mode checkout.

## Canonical product attestation (in-repo)

From [`PRODUCT_AND_STRATEGY.md`](../../../PRODUCT_AND_STRATEGY.md) §2 (2026-07-19):

> **Stripe (live mode)** — card checkout for tickets, reservations, trips, and experiences, with brand-level Stripe Connect payouts…

Also asserts **Paystack (live mode)** for the Nigeria rail.

## Operator evidence still required (attach screenshots here / on #426)

| Check | Artifact |
|-------|----------|
| Stripe Dashboard in **Live** mode (platform account) | `reports/stripe-live-dashboard.png` |
| Live Connect + Platform webhook endpoints present | `reports/stripe-live-webhooks.png` |
| Redacted `eas env:list` showing `pk_live_*` on mingla-business production | `reports/eas-pk-live-redacted.txt` |
| One recent live charge or Connect payout row (PII redacted) | `reports/live-charge-redacted.png` |

## Checklist annotation

Work [`docs/runbooks/B2_GO_LIVE_CHECKLIST.md`](../../runbooks/B2_GO_LIVE_CHECKLIST.md). For each section mark:

- `[x] verified-already-live` — confirmed via dashboard evidence above
- `[~] N/A post-launch` — not re-run for 2A backfill
- leave `[ ]` only for items that are still genuinely open

## Close checklist for #426

- [ ] Screenshots / redacted CLI attached under `reports/` or pasted on #426
- [ ] B2 checklist annotated
- [ ] Epic Tier 2 G6 row → ✅ with link to this folder
