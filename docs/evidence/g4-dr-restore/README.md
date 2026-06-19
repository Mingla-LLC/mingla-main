# G4 — DR restore performed (#426 Tier 2)

**Gate:** G4 — DR restore performed  
**Owner:** Platform  
**Status:** In progress (runbook + drill tooling landed; timed drill + evidence pending)

## Evidence required (LAUNCH_GATES.md)

| Check | How to prove |
|-------|----------------|
| Restore executed | Supabase dashboard screenshot: backup/PITR restore job **Complete** |
| Timed duration | JSON report in `reports/` with T0–T3 UTC timestamps |
| Runbook updated | `docs/runbooks/DR_RESTORE.md` RTO row matches measured `T3 - T0` |
| Verification passed | SQL smoke + `k6 run scripts/load/smoke.js` exit 0 (or logged skip reason) |

## Recommended drill scope

Use **staging** project `gqnoajqerqhnvulmnyvv` (G2). Prefer **restore to a new project** so daily staging work is unaffected.

Do not run destructive drills on production for gate evidence.

## Operator steps

### 1. Preflight

```bash
# Confirm backups/PITR visible in dashboard → Database → Backups
./scripts/ops/g4-dr-restore-drill.sh start
```

### 2. Execute restore

Follow [DR_RESTORE.md](../../runbooks/DR_RESTORE.md) sections 2–3 in the Supabase dashboard.

After each milestone:

```bash
./scripts/ops/g4-dr-restore-drill.sh mark restore-submitted
./scripts/ops/g4-dr-restore-drill.sh mark restore-complete
```

### 3. Verify restored project

Point env at restored project ref (if clone):

```bash
export SUPABASE_URL="https://<restored-ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon-key>"
./scripts/ops/g4-dr-restore-drill.sh verify
./scripts/ops/g4-dr-restore-drill.sh finish
```

Copy the finished report path from script output into #426.

### 4. Update RTO

If total duration `T3 - T0` differs from the 4 h placeholder in the runbook, edit the RTO table in `DR_RESTORE.md` in a follow-up commit (or same PR as evidence).

## CI contract

```bash
node scripts/audit/g4-dr-restore-contract.mjs
```

## Close checklist for #426

- [ ] Drill report JSON committed or pasted in #426 (`reports/*-drill.json`)
- [ ] Screenshot: Supabase restore job complete
- [ ] Screenshot or log: verification smoke passed
- [ ] RTO minutes recorded in runbook
- [ ] Mark G4 complete in LAUNCH_GATES.md (separate PR after evidence review)

## Report template

See [DRILL_REPORT.template.md](./DRILL_REPORT.template.md) for the JSON field reference.
