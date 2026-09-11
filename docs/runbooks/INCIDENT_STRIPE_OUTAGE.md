# Incident: Stripe unavailable

**Severity:** P1 (checkout blocked)  
**Symptoms:** Checkout failures, `ticket-checkout-create` errors, webhook backlog.

## Immediate

1. Check [Stripe status](https://status.stripe.com/).
2. Surface honest buyer copy — do not retry-charge in a tight loop.
3. Check webhook arrival on the API health dashboard — `api-health-probe` records Stripe
   webhook freshness hourly (`last_received`), and `stripe_audit_log` for recent events.
   Silence alone is informational at current traffic (ORCH-1213); a real Stripe API/auth
   outage pages through the synthetic Stripe probe. (#3200 retired `stripe-webhook-health-check`,
   which this step used to name: it had never run, and alerted to a non-Mingla address.)

## Mitigation

- Checkout: show maintenance message on payment step
- Onboarding: defer Connect onboarding CTA (non-blocking for existing brands)
- Queue webhook events; Stripe retries for ~3 days

## Recovery

- Run `scripts/e2e/stripe-connect-smoke.mjs` against test mode
- Reconcile stuck checkouts: `reconcile-stuck-checkouts` edge fn (operator cron)

## References

- [B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md](./B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md)
- [B2_GO_LIVE_CHECKLIST.md](./B2_GO_LIVE_CHECKLIST.md)
