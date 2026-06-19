# Incident: Database unavailable

**Severity:** P0  
**Symptoms:** 5xx from edge functions, Supabase dashboard unreachable, app empty states everywhere.

## Immediate (0–15 min)

1. Confirm scope: [Supabase status](https://status.supabase.com/), project health in dashboard.
2. Post internal status (Slack/email) — use template: *"Mingla Business DB incident — investigating."*
3. Do **not** run destructive migrations during outage.

## Mitigation

- If regional outage: wait for provider recovery; enable status page message.
- If connection pool exhaustion: reduce edge concurrency; pause marketing send cron.
- If bad migration: stop deploys; assess PITR restore ([DR_RESTORE.md](./DR_RESTORE.md), gate G4 in [LAUNCH_GATES.md](../LAUNCH_GATES.md)).

## Recovery verification

- `SELECT 1` via SQL editor
- Smoke: `node scripts/e2e/stripe-connect-smoke.mjs` (if Stripe unaffected)
- Load smoke: `k6 run scripts/load/smoke.js` with staging credentials

## Post-incident

- Timeline + root cause in incident doc
- Add missing index/RLS fix ORCH if query storm caused pool exhaustion
- On-call drill reference: [SYNTHETIC_INCIDENT_DRILL.md](./SYNTHETIC_INCIDENT_DRILL.md) (G5)
