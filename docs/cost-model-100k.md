# Cost model at 100k — Mingla Business (#426)

**Template.** Fill assumptions with staging load-test results before launch sign-off.

## Assumptions

| Input | Value | Source |
|-------|-------|--------|
| Business users | 100,000 | Product target |
| Peak concurrent | 5,000 | 5% of users |
| Avg edge invocations / user / day | TBD | Load test + Mixpanel |
| Avg DB rows read / checkout | TBD | EXPLAIN on staging |
| Ari messages / user / month | TBD | Product estimate |
| Marketing emails / month | TBD | Campaign plan |

## Monthly cost drivers (fill in)

| Service | Unit | Est. volume | Unit cost | Est. $/mo |
|---------|------|-------------|-----------|-----------|
| Supabase Pro/Team compute | — | — | — | |
| Edge function invocations | per 1M | | | |
| Database egress | GB | | | |
| Storage (brand covers, video) | GB | | | |
| Gemini (Ari) | tokens | | | |
| Resend (email) | emails | | | |
| Twilio (SMS) | messages | | | |
| OneSignal | MAU | | | |
| Stripe | % + fixed | GMV | | |
| Mapbox | requests | | | |
| Sentry | events | | | |

## Budget guardrails

- Set Supabase spend alert at **80%** of budgeted compute.
- Set third-party burst caps (marketing send queue max RPS).
- Review quarterly or after 10× user growth.

## Sign-off

| Role | Name | Date | Within budget? |
|------|------|------|----------------|
| Engineering | | | |
| Leadership | | | |
