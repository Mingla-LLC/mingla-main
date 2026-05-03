# Cycle B5 — Backend: marketing infrastructure (email, SMS, CRM, tracking, attribution, analytics)

**Phase:** Phase 7 — Post-MVP
**Estimated effort:** ~80 hrs
**Status:** ⬜ PLACEHOLDER (post-MVP — strictly after B4 ships and private beta is stable)
**Codebase:** `supabase/` + both frontends

## Scope

The full marketing surface: email campaigns (Resend), SMS campaigns (Twilio), CRM (segments + nurturing flows), tracking links + UTM attribution, analytics dashboards (brand-level + event-level). Compliance-first: double opt-in, suppression lists, sender reputation monitoring, rate limits.

## Journeys (to refine)

- J-B5.1 — Email infra (Resend wired, templates, suppression list, double opt-in)
- J-B5.2 — SMS infra (Twilio wired, opt-in compliance, rate limits)
- J-B5.3 — CRM segments + nurturing flows
- J-B5.4 — Tracking links + UTM attribution
- J-B5.5 — Brand analytics dashboard (Recharts + custom)
- J-B5.6 — Event analytics dashboard (Recharts + custom)

## References

- BUSINESS_PRD §8, §9, §10
- Strategic Plan §4 (out-of-MVP — these were always post-MVP)
- R14 (spam through marketing tools — compliance is mandatory)

## Notes

This is a HUGE cycle. May split into B5a / B5b at decomposition time. Don't start until B4 has been live for 4+ weeks with zero open S0/S1 issues.
