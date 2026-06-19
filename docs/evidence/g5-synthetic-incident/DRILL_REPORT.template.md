# G5 drill report template

Reports are written by `./scripts/ops/g5-synthetic-incident-drill.sh finish` to `reports/<utc>-drill.json`.

## Example (fill after drill)

```json
{
  "gate": "G5",
  "severity": "P1",
  "slaAckMinutes": 30,
  "injectMethod": "inject-g5-synthetic-alert.mjs",
  "sentryProject": "mingla-business",
  "notificationChannel": "slack:#mingla-incidents",
  "timestamps": {
    "t0_drillStartUtc": "2026-06-19T10:00:00Z",
    "t1_alertReceivedUtc": "2026-06-19T10:00:45Z",
    "t2_acknowledgedUtc": "2026-06-19T10:03:12Z",
    "t3_resolvedUtc": "2026-06-19T10:08:00Z"
  },
  "durationsMinutes": {
    "alertDelivery": 0,
    "ack": 3,
    "totalToAck": 3,
    "resolve": 5
  },
  "slaMet": true,
  "operator": "name",
  "onCall": "name",
  "notes": "Drill inject via Sentry store API; ack in Slack."
}
```

## Field definitions

| Field | Meaning |
|-------|---------|
| `t0_drillStartUtc` | Drill started / inject sent |
| `t1_alertReceivedUtc` | On-call notification received |
| `t2_acknowledgedUtc` | Human ack in Slack/Sentry/PagerDuty |
| `t3_resolvedUtc` | Issue marked resolved, drill closed |
| `slaMet` | `totalToAck` ≤ `slaAckMinutes` |
