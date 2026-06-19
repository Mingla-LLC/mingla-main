# Incident: Edge function storm / elevated errors

**Severity:** P1  
**Symptoms:** Spike in edge invocations, 504 timeouts, cold-start latency, Sentry noise.

## Immediate

1. Supabase → Edge Functions → identify top offenders by invocation count.
2. Check recent deploys (`deploy-functions` workflow / manual `supabase functions deploy`).
3. Disable risky features via feature flags if needed:
   - `EXPO_PUBLIC_FF_MARKETING_SEND_ENABLED=false`
   - `EXPO_PUBLIC_FF_ARI_ENABLED=false`
   - Ship OTA for business app.

## Common causes

- Marketing blast without queue/backoff
- N+1 queries in hot path
- Missing pagination on list endpoints
- Webhook retry loop

## Mitigation

- Scale Supabase compute tier (operator)
- Add rate limits at edge fn entry
- Pause cron jobs invoking heavy functions

## Verification

- Error rate &lt; 0.1% for 15 minutes
- p95 within SLO in [load-profile.md](../load-profile.md)

## Drill

Quarterly synthetic alert drill: [SYNTHETIC_INCIDENT_DRILL.md](./SYNTHETIC_INCIDENT_DRILL.md) (G5).
