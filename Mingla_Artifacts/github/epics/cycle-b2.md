# Cycle B2 — Backend: Stripe Connect wired live

**Phase:** Phase 6 — Backend MVP
**Estimated effort:** ~48 hrs
**Status:** ⬜ PLACEHOLDER
**Codebase:** `supabase/` + `mingla-business/`

## Scope

Replace the Stripe Connect onboarding STUB from Cycle 2 with the live integration. Embedded onboarding (not redirect). Webhooks signed + replay-safe via durable queue. Brand-level Connect accounts.

## Journeys (to refine)

- J-B2.1 — Stripe Connect onboarding (embedded) + status webhooks
- J-B2.2 — Brand-level account routing (Q5 resolution: brand vs account billing)
- J-B2.3 — Connect status surfacing in UI (banner refresh from webhook events)
- J-B2.4 — KYC stall recovery (email follow-up, resume-onboarding deep link)
- J-B2.5 — Account-detach flow (brand admin can disconnect Stripe)

## References

- BUSINESS_PROJECT_PLAN §B.6 (`stripe_connect_accounts`, `payouts`, `payment_webhook_events`)
- Strategic Plan Q3 (Connect type — Standard/Express/Custom — resolve at B2 kickoff)
- Strategic Plan Q5 (brand-vs-account billing — resolve at B2 kickoff)
- R2 (Stripe Connect onboarding friction)

## Notes

Two open strategic questions resolve here. Don't start B2 until founder + engineer agree on Q3 + Q5.
