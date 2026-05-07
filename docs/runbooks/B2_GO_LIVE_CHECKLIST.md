# B2a Path C V3 — Go-Live Checklist

**Status:** Pre-launch operator checklist before first real-money brand admin onboards.
**Authoritative source:** B2a Path C V3 SPEC §11 risk register + Stripe's official Go Live checklist (https://docs.stripe.com/get-started/checklist/go-live).
**Owner:** Sethogieva (operator) + Mingla legal/compliance lead.
**Estimated time:** 4-8 hours, sequential.

---

## When to use this checklist

Run this checklist **once**, before flipping any environment from test mode to live mode. After live-mode launch, individual sections may be re-run as part of incident response (e.g., re-run the dispute section after a chargeback).

---

## Pre-flight

- [ ] All B2a Path C V3 phases (Sub-A + Sub-B + Sub-C + Phase 16 smoke + Phase 17 tester) closed with PASS verdict
- [ ] All 9 strict-grep gates passing on `Seth` branch
- [ ] All migrations applied to remote DB
- [ ] All edge functions deployed to Supabase
- [ ] Mingla Business app TestFlight build available
- [ ] Mingla legal/compliance has signed off on Mingla Business ToS copy (Phase 12 placeholder replaced with final text)

---

## Section A — Stripe Connect platform readiness

Per https://docs.stripe.com/get-started/checklist/go-live:

- [ ] Stripe live-mode account verified (business identity + tax info submitted + approved)
- [ ] Connect platform activated in live mode (parallel to test-mode activation done in Phase 0'')
- [ ] Connect Platform Agreement accepted in live mode by an authorized signatory
- [ ] Live-mode 6 RAKs created with same scope set as test-mode (per `B2_RAK_MIGRATION_RUNBOOK.md` Step 6)
- [ ] Live-mode 2 webhook endpoints created:
  - Connect endpoint subscribed to the 14 connected-account events (per V3 SPEC §13 amendment A4)
  - Platform endpoint subscribed to `application_fee.created` + `application_fee.refunded`
- [ ] Live-mode webhook endpoint URLs match production Supabase fn URLs
- [ ] Stripe Dashboard "Test/Live" mode toggle visible and tested (operator can switch contexts)

---

## Section B — Supabase production environment

- [ ] Production Supabase project provisioned + region matches user-base centroid (US East / EU West)
- [ ] All 12 V3 migrations applied to production (`supabase db push` against production project ref)
- [ ] All 13 production env vars set (per `B2_RAK_MIGRATION_RUNBOOK.md` Step 7):
  - 6 STRIPE_RAK_* (live values)
  - STRIPE_SECRET_KEY (live full secret — kept until full RAK migration confirmed working)
  - STRIPE_WEBHOOK_SECRET (live Connect endpoint signing secret)
  - STRIPE_WEBHOOK_SECRET_PLATFORM (live Platform endpoint signing secret)
  - STRIPE_WEBHOOK_SECRET_PREVIOUS (empty string)
  - STRIPE_API_VERSION (`2026-04-30.preview` until Stripe GA's Accounts v2)
  - CRON_SECRET (random 64-char string for cron-invoked edge fns)
  - RESEND_API_KEY (live)
- [ ] EAS production build env vars set (`mingla-business`):
  - EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (live `pk_live_*`)
  - EXPO_PUBLIC_SUPABASE_URL (production)
  - EXPO_PUBLIC_SUPABASE_ANON_KEY (production)
- [ ] All 7 Stripe edge functions deployed to production (`supabase functions deploy`):
  - brand-stripe-onboard
  - brand-stripe-refresh-status
  - brand-stripe-detach
  - brand-stripe-balances
  - stripe-kyc-stall-reminder
  - stripe-webhook
  - stripe-webhook-health-check
- [ ] notify-dispatch redeployed (extended for stripe.* + business.* types)
- [ ] Cron schedules configured: stripe-kyc-stall-reminder daily, stripe-webhook-health-check every 6 hours
- [ ] Production smoke (`scripts/e2e/stripe-connect-smoke.mjs`) passes against live mode for at least 3 countries

---

## Section C — Compliance + legal

- [ ] Mingla Privacy Policy updated to disclose Stripe as a data processor + the data shared
- [ ] Mingla Terms of Service updated to reflect:
  - Mingla as merchant of record per `controller.fees.payer=application` + `controller.losses.payments=application`
  - Application fee disclosure (whatever the percentage is)
  - Dispute responsibility (Mingla absorbs chargebacks)
- [ ] Mingla Business ToS Acceptance Gate copy reviewed by legal (Phase 12 deliverable)
- [ ] GDPR data-processing agreement (DPA) with Stripe in place (Stripe provides standard DPA)
- [ ] Connect Platform Agreement T&Cs disclosure surfaces shipped (Phase 12 covers disclosure during onboarding)
- [ ] DPO appointed (if Mingla has >250 employees OR processes systematic high-risk data)
- [ ] Cookie consent banner updated if any Stripe analytics added (typically not needed for backend-only Stripe)

---

## Section D — 1099-K / tax reporting

- [ ] Operator confirms `controller.requirement_collection=stripe` matches platform model (Stripe handles 1099-K filing)
- [ ] Stripe Tax enabled if cross-border transactions in scope
- [ ] US brand admins know to expect a 1099-K from Stripe (NOT from Mingla) for sales >$600 in calendar year
- [ ] Brand admin ToS clause references Stripe as the 1099-K filer

---

## Section E — Disputes + chargebacks

- [ ] Operator has access to Stripe's dispute dashboard and knows the response window (typically 7-14 days)
- [ ] Mingla support team trained to answer dispute questions from brand admins
- [ ] Dispute evidence collection process documented (which order details to attach, how to respond via Stripe)
- [ ] Audit log retention confirmed sufficient to support disputes (Sub-A migration `20260511000003_b2a_v3_notifications.sql` retains audit_log indefinitely; consider retention policy)
- [ ] Chargeback rate threshold monitored (>1% triggers Stripe risk review; Mingla absorbs the charge)

---

## Section F — Monitoring + alerting

- [ ] Supabase edge fn logs accessible to ops team
- [ ] Webhook silence alert (`stripe-webhook-health-check` cron) tested by killing the endpoint briefly in test mode + verifying ops@mingla.app receives the alert
- [ ] Stripe Dashboard → Webhooks → endpoint metrics page bookmarked
- [ ] Sentry / equivalent error tracking wired into Mingla Business + edge fns
- [ ] On-call rotation / escalation contact list documented

---

## Section G — Go-live deploy choreography

The actual flip from test → live happens here. ALL prior sections must be checked before this section.

1. [ ] Operator opens a deploy ticket in `Mingla_Artifacts/DECISION_LOG.md` declaring the go-live timestamp
2. [ ] Operator notifies first-batch brand admin (single cooperative real-money brand) that go-live is imminent
3. [ ] Operator deploys EAS production build with live env vars
4. [ ] First brand admin onboards through the live flow
5. [ ] Operator verifies on Stripe Dashboard that the live connected account appears and has `charges_enabled=true` after KYC
6. [ ] Operator monitors webhook deliveries for 60 minutes — confirm zero 400s
7. [ ] First small real-money charge processed (e.g., £1 test ticket the brand admin refunds immediately) — full life cycle verified
8. [ ] Operator declares go-live complete in DECISION_LOG with timestamp + first brand admin reference

---

## Section H — Post-launch first-week checklist

Daily for the first 7 days post-go-live:

- [ ] Day 1: Webhook delivery success rate ≥ 99%
- [ ] Day 1: No 1xx-2xx 400 errors in stripe-webhook fn logs
- [ ] Day 1: First real payout completes successfully
- [ ] Day 3: First KYC stall reminder cron run (if any brand admin is still in onboarding)
- [ ] Day 7: Webhook silence alert has NOT fired (no >6h silence windows)
- [ ] Day 7: All onboarded brand admins reachable for a "how was the experience" survey

---

## What NOT to do

- ❌ Do NOT enable any country outside the canonical 34-country allowlist (per I-PROPOSED-T) without first running an ORCH cycle to expand the list, the DB CHECK constraint, and the country picker.
- ❌ Do NOT skip the live-mode RAK migration. Live mode using the test-mode `STRIPE_SECRET_KEY` will fail at the first API call.
- ❌ Do NOT proceed past Section G without first onboarding a single cooperative real-money brand to validate end-to-end. Mass onboarding before validation breaks at scale and is operationally hard to clean up.
- ❌ Do NOT enable webhooks in production without verifying the signing secrets match Stripe's actual values (per `B2_WEBHOOK_SECRET_ROTATION_RUNBOOK.md` Step 4 verification pattern).
