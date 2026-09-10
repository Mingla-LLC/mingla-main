# Launch gates — Issue #426 Tier 2

Engineering scaffolding (Tier 1) can merge without these. **Do not claim production-ready at 100k until every gate has linked evidence.**

## Gate checklist (updated 2026-09-10)

| # | Gate | Status | Evidence |
|---|------|--------|----------|
| G1 | **100k load test on staging** | 🟡 Engineering landed (1A); Phase 4 run pending | Public harness + trip/exp CDN bundles on branch; recipe [`docs/evidence/g1-load/phase4-100k-runner-recipe.md`](./evidence/g1-load/phase4-100k-runner-recipe.md). Discover remains platform-limited (existing Phase 2/3 reports). |
| G2 | **Staging Supabase project** | ✅ | Historical G2; authority now via `docs/contracts/production-supabase-authority.json` (see DR runbook). |
| G3 | **Sentry live** | 🟡 Scaffolding ✅; operator DSN/proof pending | [`docs/evidence/g3-sentry/`](./evidence/g3-sentry/) · pack [`docs/evidence/g3-g5-operator-pack.md`](./evidence/g3-g5-operator-pack.md) |
| G4 | **DR restore performed** | 🟡 Scaffolding ✅; timed drill pending | [`docs/runbooks/DR_RESTORE.md`](./runbooks/DR_RESTORE.md) · clone-only |
| G5 | **Synthetic incident drill** | 🟡 Scaffolding ✅; drill pending (needs G3 alerts) | [`docs/runbooks/SYNTHETIC_INCIDENT_DRILL.md`](./runbooks/SYNTHETIC_INCIDENT_DRILL.md) |
| G6 | **Stripe TEST → LIVE** | 🟡 2A attestation in-repo; screenshots pending | [`docs/evidence/g6-stripe-live/`](./evidence/g6-stripe-live/) |
| G7 | **App Store + Play** | 🟡 2A attestation in-repo; screenshots pending | [`docs/evidence/g7-store-submission/`](./evidence/g7-store-submission/) |

## Tier 1 (engineering — no platform blockers)

Completed via repo/CI:

- Load harness + load profile doc
- Production-readiness audit scripts (RLS, secrets, swallowed errors, N+1 heuristic)
- Feature flags / kill switches (`mingla-business/src/config/featureFlags.ts`)
- Incident runbooks + cost model template
- Structured logging helper for edge functions
- Grade A evidence (per domain): [checkout](./evidence/grade-a-checkout.md), [hub](./evidence/grade-a-hub.md), [marketing](./evidence/grade-a-marketing.md), [trip checkout](./evidence/grade-a-trip-checkout.md) — CI contracts in `scripts/audit/`
- Load harness: k6 scripts including `marketing-send.js` + **public offering path** (`public-event-bundle`, `public-trip-read`, `public-experience-read`, `public-offering-fanout`) — `node scripts/load/validate-k6-scripts.mjs`
- G3/G4/G5 + public-offering contracts wired through `scripts/audit/run-all.mjs`

## Architecture notes (1A)

- Viral cost is the **data** path (`/api/*-checkout-bundle`, `s-maxage=5`), not Host SEO HTML (`publicSearchDocument` stays `no-store` per #2986).
- Event bundle: #2879. Trip + experience bundles: #426.

## Related

- Epic: GitHub #426
- Cost model: [cost-model-100k.md](./cost-model-100k.md)
- Load profile: [load-profile.md](./load-profile.md)
