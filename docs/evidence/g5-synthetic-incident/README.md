# G5 — Synthetic incident drill (#426 Tier 2)

**Gate:** G5 — Synthetic incident drill  
**Owner:** Platform  
**Status:** In progress (runbook + drill tooling landed; Sentry alert + timed drill pending)

## Evidence required (LAUNCH_GATES.md)

| Check | How to prove |
|-------|----------------|
| Alert fired | Screenshot: Slack/email notification with Sentry link |
| Ack within SLA | Drill report JSON: `ackMinutes` ≤ SLA for severity |
| End-to-end closed | Screenshot: Sentry issue resolved; `t3_resolvedUtc` in report |
| Runbook exists | [`docs/runbooks/SYNTHETIC_INCIDENT_DRILL.md`](../../runbooks/SYNTHETIC_INCIDENT_DRILL.md) |

## Prerequisites (G3)

G5 closes only after alerting works:

- [ ] `SENTRY_DSN` on Supabase staging (`./scripts/ops/deploy-g3-sentry.sh`)
- [ ] Sentry alert rule → Slack or email (see runbook)
- [ ] Optional: `EXPO_PUBLIC_SENTRY_DSN` in EAS for native path drills

## Operator steps

### 1. Configure alert rule (one-time)

Sentry → Alerts → create issue alert for edge/staging errors (see runbook table).  
Include filter `tags.drill equals g5` for drill-only rule, or use a dedicated `#mingla-drills` channel.

### 2. Run timed drill

```bash
./scripts/ops/g5-synthetic-incident-drill.sh start --severity P1

export SENTRY_DSN="https://<key>@o4511136062701568.ingest.us.sentry.io/<project>"
node scripts/ops/inject-g5-synthetic-alert.mjs

# When notification arrives:
./scripts/ops/g5-synthetic-incident-drill.sh mark alert-received

# When on-call acks:
./scripts/ops/g5-synthetic-incident-drill.sh mark acknowledged

./scripts/ops/g5-synthetic-incident-drill.sh finish
```

**Alternate inject (full edge path):** call any wrapped function that reaches `logError` after setting drill context — e.g. invalid auth on a staging-only test endpoint documented in your drill notes.

### 3. SLA targets

| Severity | Ack SLA | Incident runbook |
|----------|---------|------------------|
| P0 | 15 min | [INCIDENT_DATABASE_DOWN.md](../../runbooks/INCIDENT_DATABASE_DOWN.md) |
| P1 | 30 min | [INCIDENT_EDGE_FUNCTION_STORM.md](../../runbooks/INCIDENT_EDGE_FUNCTION_STORM.md) |

Update runbook SLA table if measured drill differs and team agrees new targets.

## CI contract

```bash
npm run test:g5-synthetic-incident --prefix scripts
# or: node scripts/audit/g5-synthetic-incident-contract.mjs
```

## Close checklist for #426

- [ ] Drill report JSON in `reports/` or pasted in #426
- [ ] Screenshot: alert notification (redact tokens)
- [ ] Screenshot: ack + resolved issue in Sentry
- [ ] Ack time within SLA for chosen severity
- [ ] Mark G5 complete in LAUNCH_GATES.md (separate PR after evidence review)

## Report template

See [DRILL_REPORT.template.md](./DRILL_REPORT.template.md).
