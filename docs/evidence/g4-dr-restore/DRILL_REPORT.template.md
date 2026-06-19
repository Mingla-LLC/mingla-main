# G4 drill report template

Reports are written automatically by `./scripts/ops/g4-dr-restore-drill.sh` to `reports/<utc>-drill.json`.

## Example (fill after drill)

```json
{
  "gate": "G4",
  "projectRef": "gqnoajqerqhnvulmnyvv",
  "restoredProjectRef": "xxxxxxxxxxxxxxxxxxxx",
  "recoveryType": "pitr-clone",
  "recoveryPointUtc": "2026-06-09T12:00:00Z",
  "timestamps": {
    "t0_decisionUtc": "2026-06-09T14:00:00Z",
    "t1_restoreSubmittedUtc": "2026-06-09T14:05:00Z",
    "t2_restoreCompleteUtc": "2026-06-09T14:47:00Z",
    "t3_verificationCompleteUtc": "2026-06-09T15:02:00Z"
  },
  "durationsMinutes": {
    "restoreJob": 42,
    "verification": 15,
    "total": 62
  },
  "verification": {
    "sqlOk": true,
    "k6SmokeExitCode": 0,
    "stripeSmokeSkipped": true
  },
  "operator": "name",
  "notes": "Restored to clone ref; staging ref unchanged."
}
```

## Field definitions

| Field | Meaning |
|-------|---------|
| `t0_decisionUtc` | Decision to restore (incident commander) |
| `t1_restoreSubmittedUtc` | Restore job submitted in Supabase |
| `t2_restoreCompleteUtc` | Dashboard shows restore complete |
| `t3_verificationCompleteUtc` | All verification steps passed |
| `recoveryType` | `pitr-clone`, `pitr-in-place`, `daily-backup-clone`, etc. |
