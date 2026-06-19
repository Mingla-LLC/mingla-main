# Synthetic incident drill — alert → ack → resolve

**Gate:** G5 — Synthetic incident drill (#426 Tier 2)  
**Owner:** Platform  
**Prerequisite:** G3 Sentry live (errors + alert rule routed to Slack/email)

## Objectives

| Metric | Target (initial) | Notes |
|--------|------------------|-------|
| **P0 ack SLA** | ≤ 15 min | Database unavailable — [INCIDENT_DATABASE_DOWN.md](./INCIDENT_DATABASE_DOWN.md) |
| **P1 ack SLA** | ≤ 30 min | Edge storm — [INCIDENT_EDGE_FUNCTION_STORM.md](./INCIDENT_EDGE_FUNCTION_STORM.md) |
| **End-to-end drill** | Alert fired → human ack → resolve | Timed evidence for #426 |

## When to use

- **G5 gate evidence:** scheduled drill on staging (non-customer impact)
- **Quarterly:** re-run to validate on-call routing still works after Sentry/Slack changes
- **Not for production incidents** — use the severity-specific runbooks above

## Roles

| Role | Responsibility |
|------|----------------|
| **Drill coordinator** | Starts drill, records timestamps, files report |
| **On-call** | Acknowledges alert in notification channel within SLA |
| **Observer** | Confirms alert content is actionable (project, env, link to Sentry) |

## Prerequisites

- [ ] G3: `SENTRY_DSN` on Supabase staging + native DSN in EAS (for real error path)
- [ ] Sentry alert rule configured (see [G5 evidence README](../evidence/g5-synthetic-incident/README.md))
- [ ] Notification destination live (Slack channel or email list)
- [ ] On-call roster known for drill window

## Procedure

### 1. Start drill (T0)

```bash
./scripts/ops/g5-synthetic-incident-drill.sh start --severity P1
```

Record **T0** = UTC when inject is about to be sent.

### 2. Inject synthetic alert

**Option A — programmatic (recommended):**

```bash
export SENTRY_DSN="https://<key>@o4511136062701568.ingest.us.sentry.io/<project>"
node scripts/ops/inject-g5-synthetic-alert.mjs
```

Event is tagged `drill:g5` and `severity:P1` (or `P0` if drill uses `--severity P0`).

**Option B — edge path (validates full G3 pipeline):**

Invoke a wrapped edge function that hits `logError` with the drill tag (see G5 evidence README).

**Option C — Sentry UI:**

Alert rule → **Send test notification** (only valid if rule already exists).

Record **T0-inject** when inject completes (script prints timestamp).

### 3. Alert received (T1)

When Slack/email notification arrives:

```bash
./scripts/ops/g5-synthetic-incident-drill.sh mark alert-received
```

### 4. Acknowledge (T2)

On-call acknowledges in the notification tool (Slack reaction, PagerDuty ack, or Sentry issue assign):

```bash
./scripts/ops/g5-synthetic-incident-drill.sh mark acknowledged
```

**SLA check:** `T2 - T0` must be ≤ 15 min (P0) or ≤ 30 min (P1). Drill fails gate evidence if exceeded.

### 5. Resolve and close (T3)

1. Mark Sentry issue resolved (filter: tag `drill:g5`).
2. Post drill all-clear in internal channel.

```bash
./scripts/ops/g5-synthetic-incident-drill.sh finish
```

Attach report JSON + notification screenshot to GitHub #426.

## Timed drill helper

```bash
./scripts/ops/g5-synthetic-incident-drill.sh start [--severity P0|P1]
node scripts/ops/inject-g5-synthetic-alert.mjs   # or edge / Sentry test path
./scripts/ops/g5-synthetic-incident-drill.sh mark alert-received
./scripts/ops/g5-synthetic-incident-drill.sh mark acknowledged
./scripts/ops/g5-synthetic-incident-drill.sh finish
```

## Recommended Sentry alert rule (operator)

Create in Sentry → **Alerts** → **Issues**:

| Field | Value |
|-------|-------|
| Name | `G5 drill — edge error (staging)` |
| Environment | `staging` or `edge` |
| Filter | `tags.drill is g5` OR error level from edge runtime |
| Action | Slack `#mingla-incidents` (or email on-call list) |

For production readiness, duplicate rule without `drill:g5` filter for real edge errors.

## Related

- G3 setup: [docs/evidence/g3-sentry/README.md](../evidence/g3-sentry/README.md)
- G5 evidence: [docs/evidence/g5-synthetic-incident/README.md](../evidence/g5-synthetic-incident/README.md)
- [LAUNCH_GATES.md](../LAUNCH_GATES.md)
