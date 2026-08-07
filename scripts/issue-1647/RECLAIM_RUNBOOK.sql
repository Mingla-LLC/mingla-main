-- Issue #1647 + #1644 Stage-4 — OPERATOR RUNBOOK.
--
-- Nothing in this file runs automatically. It is the ordered set of statements
-- the orchestrator executes, with the measurement queries that prove each one
-- did what it claimed. Every number quoted as "before" was measured on
-- production `gqnoajqerqhnvulmnyvv` on 2026-08-06.
--
-- LANE: per COMMS-0122 the Supabase CLI is drift-blocked, so this goes through
-- the Management API `/database/query` endpoint as role `postgres` (confirmed:
-- postgres holds DELETE, TRUNCATE and MAINTAIN on both cron.job_run_details and
-- net._http_response, and owns all three archive tables).
--
-- ⚠ TRANSACTION-BLOCK CAVEAT: `VACUUM` and `REINDEX ... CONCURRENTLY` cannot run
-- inside a transaction block. If the Management API wraps the request body in
-- one, those statements return
--   ERROR: VACUUM cannot run inside a transaction block
-- Fall back to psql on the DIRECT (non-pooler) connection string for those two
-- steps only. Everything else is transaction-safe. Each step below says which it
-- is.
--
-- ⚠ COLLISION GUARD: STEP 8 needs an ACCESS EXCLUSIVE lock on `place_pool` (see
-- the migration header). Do not run it while the #1644 collage re-encode is
-- in flight. The RPC aborts in 5 s rather than queueing, but do not rely on that
-- as a scheduling strategy.

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 0 — BEFORE. Capture this; it is what the "after" is measured against.
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected on 2026-08-06:
--   database 6276 MB · admin_place_pool_mv 611 MB · cron.job_run_details 491 MB
--   net._http_response 411 MB · profiles 46 MB · archives 90.4 MiB
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT n.nspname || '.' || c.relname                    AS relation,
       pg_size_pretty(pg_total_relation_size(c.oid))    AS total,
       pg_size_pretty(pg_indexes_size(c.oid))           AS indexes
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (n.nspname, c.relname) IN (
        ('public','admin_place_pool_mv'), ('cron','job_run_details'),
        ('net','_http_response'), ('public','profiles'),
        ('public','_archive_card_pool'), ('public','_archive_card_pool_stops'),
        ('public','_archive_orch_0700_doomed_columns'))
ORDER BY pg_total_relation_size(c.oid) DESC;

-- The bug, stated in numbers. Expect 4320 / 0 / 4320 and avg 120.01 s.
SELECT count(*) AS runs,
       count(*) FILTER (WHERE status = 'succeeded')  AS ok,
       count(*) FILTER (WHERE status <> 'succeeded') AS failed,
       round(avg(EXTRACT(EPOCH FROM (end_time - start_time)))::numeric, 2) AS avg_secs,
       max(end_time) FILTER (WHERE status = 'succeeded') AS last_success
FROM cron.job_run_details
WHERE jobid = 13 AND start_time > now() - interval '30 days';

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — Apply the matview migration. TRANSACTION-SAFE.
--   supabase/migrations/20270222001647_issue_1647_admin_place_pool_mv_slim.sql
-- It cancels any in-flight (doomed) refresh, rebuilds without the four unread
-- columns, restores the four indexes, tightens the grants to service_role, and
-- RAISEs if any of that did not happen. Idempotent — a second apply is a no-op.
-- Expected duration: ~10-15 s. Expected size after: ~76 MB (from 611 MB).
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 — PROVE THE REFRESH. Do not take the migration's word for it.
-- ═══════════════════════════════════════════════════════════════════════════
-- (a) time one refresh by hand. Before: died at 120.00 s, every run, 66 days.
--     Expect single-digit seconds.
\timing on
SELECT public.cron_refresh_admin_place_pool_mv();
\timing off

-- (b) the size it now occupies
SELECT pg_size_pretty(pg_total_relation_size('public.admin_place_pool_mv')) AS mv_total,
       pg_size_pretty(pg_total_relation_size(
         (SELECT reltoastrelid FROM pg_class WHERE oid='public.admin_place_pool_mv'::regclass))) AS mv_toast;

-- (c) the view is CURRENT, not a 31-May snapshot. Before the fix this was
--     2026-05-31; it must now be within minutes of place_pool's own max.
SELECT (SELECT max(updated_at) FROM public.admin_place_pool_mv) AS mv_newest,
       (SELECT max(updated_at) FROM public.place_pool)          AS pool_newest,
       (SELECT count(*) FROM public.admin_place_pool_mv)        AS mv_rows,
       (SELECT count(*) FROM public.place_pool)                 AS pool_rows;

-- (d) THE DEFINITION OF DONE: a RUN of successes, not one manual refresh.
--     Re-run this ~40 minutes after STEP 1. Expect ok = runs.
SELECT count(*) AS runs,
       count(*) FILTER (WHERE status = 'succeeded') AS ok,
       round(max(EXTRACT(EPOCH FROM (end_time - start_time)))::numeric, 2) AS slowest_secs
FROM cron.job_run_details
WHERE jobid = 13 AND start_time > now() - interval '45 minutes';

-- (e) the anon read must now be refused. From a shell, NOT here:
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     "$SUPABASE_URL/rest/v1/admin_place_pool_mv?select=id&limit=1" \
--     -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--   Before the fix: 200 with real rows. After: 401/404 (PostgREST hides what the
--   role cannot select).

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3 — Apply the watchdog + retention migration. TRANSACTION-SAFE.
--   supabase/migrations/20270222001648_issue_1647_cron_health_and_retention.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- Sanity: the watchdog must see what we saw by hand.
SELECT jobname, runs, successes, failures, consecutive_failures,
       last_success_at, hours_since_success, left(coalesce(last_error,''), 60) AS err
FROM public.issue_1647_cron_job_health(6)
ORDER BY consecutive_failures DESC, failures DESC
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4 — Deploy `api-health-probe` from MERGED main (orchestrator-owned).
--   verify_jwt to preserve: whatever config.toml currently declares — this
--   change does not touch it.
-- Order does not matter: the probe is gated on the tile being registered, so it
-- is safe to deploy before or after STEP 3. Applying first just means the tile
-- reports on the very next hourly tick.
-- Verify on the next tick (job 30 runs at :00):
-- ═══════════════════════════════════════════════════════════════════════════
SELECT status, checked_at, detail -> 'summary' AS summary, detail -> 'failing' AS failing
FROM public.api_health_checks
WHERE service_key = 'pg_cron'
ORDER BY checked_at DESC LIMIT 3;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5 — Drain the cron log backlog. TRANSACTION-SAFE.
-- 475,386 rows / 491 MB, 373,648 of them older than 14 days, never vacuumed.
-- The scheduled job does this on its own every 20 minutes; calling it in a loop
-- just gets there in one sitting. Each call is bounded, so none can time out.
-- Repeat until it returns 0 (about 15 calls).
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.issue_1647_purge_cron_run_details(14, 25000) AS deleted;

SELECT count(*) AS rows_left,
       count(*) FILTER (WHERE end_time < now() - interval '14 days') AS still_expired,
       pg_size_pretty(pg_total_relation_size('cron.job_run_details')) AS size_before_vacuum
FROM cron.job_run_details;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6 — Return the freed space to the OS. NOT TRANSACTION-SAFE.
-- Run these three as standalone statements (psql on the direct connection if
-- the Management API wraps requests in a transaction).
-- ═══════════════════════════════════════════════════════════════════════════
-- 6a. ~358 MB. Brief ACCESS EXCLUSIVE on cron.job_run_details; pg_cron pauses
--     its logging for the rewrite, which is seconds on the drained table.
VACUUM (FULL, ANALYZE) cron.job_run_details;

-- 6b. ~410 MB. 1,907 live rows in 411 MB of heap: pg_net's 6-hour TTL deletes
--     the rows but never shrinks the file. VACUUM FULL keeps the live rows.
--     If VACUUM FULL is impossible in your lane, `TRUNCATE net._http_response;`
--     is transaction-safe and reclaims the same space — verified safe here
--     because NOTHING in the database or the monorepo calls
--     net.http_collect_response, so every net.http_post is fire-and-forget and
--     no caller is waiting on a stored response.
VACUUM (FULL, ANALYZE) net._http_response;

-- 6c. ~46 MB. 102 rows, 0.04 MB of data, 46 MB of indexes — btree pages the
--     2026-06-22 production test-wipe deleted rows from and never reclaimed.
--     ZERO data change. CONCURRENTLY avoids locking a live table; if your lane
--     cannot run it, plain `REINDEX TABLE public.profiles;` is transaction-safe
--     and takes a sub-second ACCESS EXCLUSIVE lock on a 102-row table.
REINDEX TABLE CONCURRENTLY public.profiles;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7 — Apply the archive export/drop migration. TRANSACTION-SAFE.
--   supabase/migrations/20270222001649_issue_1647_archive_export_then_drop.sql
-- Creates the manifest and the guarded RPC. Drops NOTHING by itself.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 8 — Export, then drop. ~90.4 MiB. From a shell:
--
--   export SUPABASE_URL=https://gqnoajqerqhnvulmnyvv.supabase.co
--   export SUPABASE_SERVICE_ROLE_KEY=...
--   deno run --allow-net --allow-env --allow-read --allow-write \
--     scripts/issue-1647/export-archive-tables.ts \
--     --out ~/Desktop/issue-1647-archive-export
--
-- Then, ONLY WHEN THE COLLAGE RE-ENCODE IS IDLE (STEP 8 needs ACCESS EXCLUSIVE
-- on place_pool — see the migration header):
-- ═══════════════════════════════════════════════════════════════════════════
SELECT jsonb_pretty(public.issue_1647_drop_expired_archives(true));   -- dry run
-- Read the report. Confirm each table's exported_to path exists on disk and its
-- row count matches. Then, and only then:
SELECT jsonb_pretty(public.issue_1647_drop_expired_archives(false));  -- the drop

-- NOTE for the storage side: `_archive_card_pool.image_url` / `.images` may hold
-- the last surviving reference to some stored photos. Any storage orphan sweep
-- must run AFTER this drop, not before, or it will miss them.

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 9 — AFTER. Same queries as STEP 0.
-- Expected: database 6276 MB -> ~4.9 GB.
--   admin_place_pool_mv  611 MB -> ~76 MB     (-535 MB)
--   cron.job_run_details 491 MB -> ~125 MB    (-366 MB)
--   net._http_response   411 MB -> <2 MB      (-409 MB)
--   profiles              46 MB -> <1 MB      (-45 MB)
--   archives            90.4 MiB -> 0         (-90 MB)
--                                    total   ~1.45 GB
-- ═══════════════════════════════════════════════════════════════════════════
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT jobname, schedule, active FROM cron.job
WHERE jobname LIKE 'issue_1647%' ORDER BY jobname;

-- And the thing that actually mattered: it is no longer possible for this to be
-- invisible. Expect one row, status healthy, updated within the hour.
SELECT service_key, status, checked_at, detail -> 'summary' AS summary
FROM public.api_health_checks WHERE service_key = 'pg_cron'
ORDER BY checked_at DESC LIMIT 1;
