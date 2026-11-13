# Incident: Database unavailable

**Severity:** P0  
**Symptoms:** 5xx from edge functions, Supabase dashboard unreachable, app empty states everywhere.

## Immediate (0–15 min)

1. Confirm scope: [Supabase status](https://status.supabase.com/), project health in dashboard.
2. Post internal status (Slack/email) — use template: *"Mingla Host DB incident — investigating."*
3. Do **not** run destructive migrations during outage.

## Mitigation

- If regional outage: wait for provider recovery; enable status page message.
- If connection pool exhaustion: reduce edge concurrency; pause marketing send cron.
- If the pool is full of Admin calls (`ops_*`, `team_*`, `admin_*`, `crm_*` in `pg_stat_activity`, application `postgrest`): since #4423 those calls are cut off at 3 s by the PostgREST pre-request hook, so one Admin tab cannot hold a connection for long. Close the looping tab. The hook is on `authenticator`; to switch it off (only if it is itself the problem): `ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';`.
- The api-health-probe database check emails the API health recipients when the pool is at least 80 % in use on two checks in a row (every 5 minutes), or a public request takes over 1 s or fails. To silence it during a known incident: `SELECT cron.unschedule('issue_4423_db_health_probe');`, and re-create it from `20280705114423_issue_4423_w3_db_health_probe.sql` afterwards.
- If bad migration: stop deploys; assess PITR restore ([DR_RESTORE.md](./DR_RESTORE.md), gate G4 in [LAUNCH_GATES.md](../LAUNCH_GATES.md)).

## Recovery verification

- `SELECT 1` via SQL editor
- Smoke: `node scripts/e2e/stripe-connect-smoke.mjs` (if Stripe unaffected)
- Load smoke: `k6 run scripts/load/smoke.js` with staging credentials

## Post-incident

- Timeline + root cause in incident doc
- Add missing index/RLS fix ORCH if query storm caused pool exhaustion
- On-call drill reference: [SYNTHETIC_INCIDENT_DRILL.md](./SYNTHETIC_INCIDENT_DRILL.md) (G5)

## Database hygiene (run by hand, #4423)

These cannot run inside a migration without locking production, so Seth runs them in the Supabase SQL editor, one at a time, in a quiet hour (not at :03/:33, when the place pool view refreshes). Post each result on #4423 and on its Work card.

1. **After an unclean restart (statistics are lost):** `ANALYZE;`
   Verify: `SELECT count(*) FROM pg_stat_user_tables WHERE last_analyze IS NULL AND last_autoanalyze IS NULL AND n_live_tup > 1000;` returns 0.
   Do not drop any index as "unused" until 14 days of statistics have built up after the restart (for the 13 Nov restart: not before 27 Nov).
2. **Bloated indexes** (`profiles`: about 46 MB of indexes for about 250 rows; `user_map_settings`: about 25 MB for about 60 rows):
   `REINDEX TABLE CONCURRENTLY public.profiles;` then `REINDEX TABLE CONCURRENTLY public.user_map_settings;`
   Each must run on its own (not inside a transaction). Verify: `SELECT pg_size_pretty(pg_indexes_size('public.profiles')), pg_size_pretty(pg_indexes_size('public.user_map_settings'));` is a few MB at most.
3. **Bloated table** (`photo_backfill_batches`: about 81 MB for about 900 rows; it is a batch log):
   First confirm nothing is writing it: `SELECT count(*) FROM pg_stat_activity WHERE query ILIKE '%photo_backfill_batches%' AND pid <> pg_backend_pid();` returns 0, and it is not 03:50 UTC (its retention job).
   Then `VACUUM (FULL, ANALYZE) public.photo_backfill_batches;` It takes an exclusive lock on that table for a few seconds.
   Verify: `SELECT pg_size_pretty(pg_total_relation_size('public.photo_backfill_batches'));` is under 2 MB.
4. **Redundant notifications index, on or after 27 Nov only:** `idx_notifications_user_id (user_id)` is covered by `idx_notifications_user_created (user_id, created_at DESC)`.
   Check: `SELECT idx_scan FROM pg_stat_user_indexes WHERE indexrelname = 'idx_notifications_user_id';` If it is 0, the drop ships as a one-line migration (`DROP INDEX IF EXISTS public.idx_notifications_user_id;`) so the source and production stay the same; do not drop it by hand. If it is above 0, keep it and note the count on #4423.
5. **Not needed:** a purge for `cron.job_run_details` already runs every 20 minutes (`issue_1647_cron_log_retention`, 14 days kept). Its size (about 250 MB) is the 14-day window at about 26,000 runs a day; a smaller table needs a shorter window, which is Seth's call.

