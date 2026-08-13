# DR restore — database point-in-time recovery

**Gate:** G4 — DR restore performed (#426 Tier 2)  
**Owner:** Platform  
**Severity context:** P0 when production DB is lost or corrupted

## Objectives

| Metric | Target (initial) | Notes |
|--------|------------------|-------|
| **RPO** | ≤ 24 h (daily backup) or ≤ minutes (PITR on Pro) | Confirm plan tier in Supabase dashboard |
| **RTO** | ≤ 4 h wall-clock | Fill with measured drill duration |
| **Verification** | SQL + app smoke within 30 min of restore complete | See verification section |

## When to use

- Accidental destructive migration or bad data deploy
- Regional Supabase outage with unrecoverable project state
- Ransomware / credential compromise requiring clean restore
- **G4 drill:** scheduled exercise on a **new isolated clone of the project declared in
  `docs/contracts/production-supabase-authority.json`** (see warning below)

> ⚠️ **The authority contract identifies the LIVE PRODUCTION project, never a staging target.**
> There is no separate Mingla staging project. Therefore the G4 drill MUST
> be run as **"Restore to a new project" (clone)** — NEVER an **in-place** restore, which would
> overwrite live production data. An in-place restore is for a real incident only.

## Prerequisites

- Supabase org **Owner** or **Admin** access
- PITR or daily backups enabled on target project (Settings → Database → Backups)
- Incident channel ready (Slack/email template from [INCIDENT_DATABASE_DOWN.md](./INCIDENT_DATABASE_DOWN.md))
- Isolated-clone credentials for post-restore smoke (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional `SUPABASE_SERVICE_ROLE_KEY`)

## Roles

| Role | Responsibility |
|------|----------------|
| **Incident commander** | Declares start/end, owns comms |
| **DB operator** | Executes Supabase restore in dashboard |
| **Verifier** | Runs SQL + smoke checks, records timestamps |

## Procedure (real incident or isolated-clone drill)

### 1. Declare and freeze (T0)

1. Post: *"Mingla Business DB restore started — writes paused."*
2. Stop deploys and cron (marketing send, Ari batch jobs).
3. Record **T0** = wall-clock UTC when decision to restore is made.

### 2. Choose recovery point

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → project → **Database** → **Backups**.
2. For PITR: pick timestamp **just before** the bad change (note timezone).
3. For daily backup: pick latest clean snapshot before incident.
4. Record target recovery timestamp in incident/drill log.

### 3. Restore (T1 → T2)

**Clone drill (recommended for G4 evidence — safe on live production):**

1. Read `docs/contracts/production-supabase-authority.json`, then **restore its project to a new project** (clone) so live production stays untouched and serving real users.
2. Do NOT in-place restore for the drill — that would take live production down and overwrite real data. In-place is for a real incident only, in a scheduled maintenance window.

**Production incident:**

1. Follow Supabase guided restore (PITR or backup → new project or in-place per runbook decision).
2. Update DNS / secrets only after verification on restored instance.

Record:

- **T1** = restore job submitted (UTC)
- **T2** = Supabase reports restore **Complete** (UTC)

### 4. Reconnect clients (if new project ref)

If restore created a **new** project ref:

1. Label every clone-only credential and local environment as a drill target. Never place clone values in Production-scoped EAS, Vercel, or GitHub settings.
2. Deploy functions to the clone only from a dedicated drill checkout after recording the clone ref. The production deploy wrapper intentionally rejects clone refs.
3. Do **not** copy production Stripe live keys to a drill clone.

### 5. Verification (T2 → T3)

Run in order; all must pass before declaring recovery.

**SQL (Supabase SQL editor on restored project)**

```sql
SELECT 1 AS ok;
SELECT COUNT(*) AS profiles FROM profiles;
SELECT COUNT(*) AS business_events FROM business_events;
```

Expect non-error counts consistent with pre-drill snapshot (exact counts optional for drill; zero rows = fail).

**Edge / load smoke**

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon-key>"

# Quick HTTP smoke (adjust VUs for staging capacity)
k6 run scripts/load/smoke.js
```

**Optional:** Stripe test smoke if Connect config unchanged:

```bash
export STRIPE_SECRET_KEY="sk_test_..."
node scripts/e2e/stripe-connect-smoke.mjs
```

Record **T3** = last verification step passed (UTC).

### 6. Close out

1. Post all-clear with duration: `T3 - T0` (total), `T2 - T1` (restore job), `T3 - T2` (verify).
2. File drill/incident report: `docs/evidence/g4-dr-restore/reports/<timestamp>-drill.json` (use `./scripts/ops/g4-dr-restore-drill.sh`).
3. Update RTO line in this runbook if measured duration differs from target.
4. For G4 gate: attach report + dashboard screenshot to GitHub #426.

## Timed drill helper

```bash
./scripts/ops/g4-dr-restore-drill.sh start          # prints checklist, creates report stub
# ... perform Supabase restore manually ...
./scripts/ops/g4-dr-restore-drill.sh mark restore-submitted
./scripts/ops/g4-dr-restore-drill.sh mark restore-complete
./scripts/ops/g4-dr-restore-drill.sh verify         # optional smoke if env set
./scripts/ops/g4-dr-restore-drill.sh finish
```

## Rollback of a bad restore

If verification fails on restored instance:

1. Do not repoint production traffic.
2. Retry restore to an earlier PITR timestamp or alternate backup.
3. Escalate to Supabase support with project ref + incident timeline.

## Related

- [INCIDENT_DATABASE_DOWN.md](./INCIDENT_DATABASE_DOWN.md) — live outage response
- [LAUNCH_GATES.md](../LAUNCH_GATES.md) — G4 evidence requirements
- [G4 evidence folder](../evidence/g4-dr-restore/README.md)
