# Launch gates — Issue #426 Tier 2

Engineering scaffolding (Tier 1) can merge without these. **Do not claim production-ready at 100k until every gate has linked evidence.**

## Gate checklist

| # | Gate | Owner | Evidence required |
|---|------|-------|-------------------|
| G1 | **100k load test on staging** | Platform | k6 report: p50/p95/p99 + error rate per critical path; green at 100k VU or agreed equivalent |
| G2 | **Staging Supabase project** | Platform | Project ref + EAS channel separated from production |
| G3 | **Sentry live** | Platform | Org/project configured; `EXPO_PUBLIC_SENTRY_DSN` in EAS; edge fn errors visible |
| G4 | **DR restore performed** | Platform | Timed restore from backup; runbook updated with actual duration |
| G5 | **Synthetic incident drill** | Platform | Alert fired and acknowledged within SLA |
| G6 | **Stripe TEST → LIVE** | Operator + legal | [B2_GO_LIVE_CHECKLIST.md](./runbooks/B2_GO_LIVE_CHECKLIST.md) complete |
| G7 | **App Store + Play** | Operator | Submission accepted or in review |

## Tier 1 (engineering — no platform blockers)

Completed via repo/CI:

- Load harness + load profile doc
- Production-readiness audit scripts (RLS, secrets, swallowed errors, N+1 heuristic)
- Feature flags / kill switches (`mingla-business/src/config/featureFlags.ts`)
- Incident runbooks + cost model template
- Structured logging helper for edge functions

## Related

- Epic: GitHub #426
- Cost model: [cost-model-100k.md](./cost-model-100k.md)
- Load profile: [load-profile.md](./load-profile.md)
