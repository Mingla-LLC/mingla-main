\set ON_ERROR_STOP on
-- Issue #3040 — INDEPENDENT TESTER adversarial suite: REAL concurrency on the
-- lane's create-or-replay contract. The implementor suites run in one session
-- and cannot say what happens when two hosts (or two tabs) replace the same
-- cover at the same moment. This suite opens loopback sessions (dblink) and
-- interleaves them on purpose:
--
--   C1  Two DIFFERENT replacements of one event cover overlap. The second must
--       WAIT for the first (per-target advisory lock), then supersede it. Both
--       calls succeed; exactly one active job remains, and it is the newer one.
--       Without the lock the second insert hits the one-active-per-event
--       unique index and (after B-17) raises at the host.
--   C2  The SAME operation is replayed by two sessions at once (a retry racing
--       the original request). Both get the same job; one row exists.
--   C3  Two ad videos for the same Host Ads draft overlap. Ad videos are
--       upload-only and non-superseding: neither waits for the other and both
--       stay active (a cover-target lock or supersede here would discard a
--       video the host chose).
--
-- MINGLA-INVARIANT: I-VIDEO-ONE-ACTIVE-COVER-PER-TARGET | issue #3040 | overlapping replacements serialize per target and leave exactly one live job; ad videos never supersede
--
-- FAILS ON REVERT: drop the pg_advisory_xact_lock in
-- cover_video_create_or_replay_job (C1 raises unique_violation in session B /
-- C2 raises or returns a second row), or give ad_creative the cover lock key
-- or the supersede arm (C3 waits / supersedes).
--
-- Like issue_3660_host_account_deletion.tester2.races, this suite has to
-- COMMIT its fixtures so the other sessions can see them; the cleanup at the
-- bottom removes every row by id. Runs as supabase_admin.
\getenv t3040_pw PGPASSWORD

CREATE SCHEMA t3040_race;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA t3040_race;
SELECT n.nspname AS t3040_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"t3040_dblink_schema";

CREATE TABLE t3040_race.ids AS
SELECT
  gen_random_uuid() AS h,
  gen_random_uuid() AS brand,
  gen_random_uuid() AS event,
  gen_random_uuid() AS op_a,
  gen_random_uuid() AS op_b,
  gen_random_uuid() AS op_c,
  gen_random_uuid() AS op_x,
  gen_random_uuid() AS op_y,
  replace(gen_random_uuid()::text, '-', '') AS sfx,
  format('host=127.0.0.1 port=%s dbname=postgres user=supabase_admin password=%s',
         current_setting('port'), :'t3040_pw') AS conn;

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id) SELECT h FROM t3040_race.ids;
INSERT INTO public.creator_accounts(id, email)
SELECT h, 't3040-race@example.test' FROM t3040_race.ids;
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
SELECT brand, h, 'T3040 Race', 't3040-race-' || sfx, 'USD' FROM t3040_race.ids;
INSERT INTO public.events(id, brand_id, created_by, title, slug, status)
SELECT event, brand, h, 'T3040 Race', 't3040-race-e-' || sfx, 'draft' FROM t3040_race.ids;
COMMIT;

CREATE FUNCTION t3040_race.is_waiting(p_pid integer, p_locktype text)
RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  FOR i IN 1..150 LOOP
    IF EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = p_pid AND NOT l.granted AND l.locktype = p_locktype) THEN
      RETURN true;
    END IF;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN false;
END;
$fn$;

-- The SQL one session runs to create (or replay) a job.
CREATE FUNCTION t3040_race.create_sql(p_kind text, p_op uuid, p_owner text, p_sha text)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format(
    'SELECT (j).id::text, (j).status FROM (SELECT public.cover_video_create_or_replay_job(%L,%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L,%L,%L,%s,%s,0,%s,true) AS j) s',
    i.h, p_op, p_kind,
    CASE WHEN p_kind = 'event' THEN i.event::text END,
    i.brand, p_owner, 'published_manual', 'bunny', 'race.mp4', 'video/mp4', 'mp4',
    p_sha, 3000000, 9000, 9000)
  FROM t3040_race.ids i;
$fn$;

DO $$
DECLARE
  v record;
  v_pid_a integer;
  v_pid_b integer;
  v_id_a text;
  v_id_b text;
  v_id_b2 text;
  v_status text;
  v_n integer;
BEGIN
  SELECT * INTO v FROM t3040_race.ids;
  PERFORM dblink_connect('t3040_a', v.conn);
  PERFORM dblink_connect('t3040_b', v.conn);
  SELECT pid INTO v_pid_a FROM dblink('t3040_a', 'SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO v_pid_b FROM dblink('t3040_b', 'SELECT pg_backend_pid()') AS t(pid integer);

  -- ── C1 two different replacements overlap ──────────────────────────────
  PERFORM dblink_exec('t3040_a', 'BEGIN');
  SELECT id INTO v_id_a FROM dblink('t3040_a', t3040_race.create_sql('event', v.op_a, NULL, repeat('a',64)))
    AS t(id text, status text);
  PERFORM dblink_send_query('t3040_b', t3040_race.create_sql('event', v.op_b, NULL, repeat('b',64)));
  IF NOT t3040_race.is_waiting(v_pid_b, 'advisory') THEN
    PERFORM dblink_exec('t3040_a', 'ROLLBACK');
    RAISE EXCEPTION 'C1 the second replacement did not wait for the first (no per-target lock)';
  END IF;
  PERFORM dblink_exec('t3040_a', 'COMMIT');
  SELECT id, status INTO v_id_b, v_status FROM dblink_get_result('t3040_b') AS t(id text, status text);
  PERFORM * FROM dblink_get_result('t3040_b') AS t(id text, status text);
  IF v_id_b IS NULL OR v_id_b = v_id_a OR v_status <> 'source_uploading' THEN
    RAISE EXCEPTION 'C1 the waiting replacement returned % / %', v_id_b, v_status;
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id = v_id_a::uuid) <> 'superseded' THEN
    RAISE EXCEPTION 'C1 the first replacement was not superseded';
  END IF;
  SELECT count(*) INTO v_n FROM public.event_cover_video_jobs
   WHERE event_id = v.event AND target_kind = 'event'
     AND status NOT IN ('failed','cancelled','superseded','applied');
  IF v_n <> 1 THEN RAISE EXCEPTION 'C1 % active cover jobs after overlapping replacements', v_n; END IF;

  -- ── C2 the same operation replayed by two sessions at once ─────────────
  PERFORM dblink_exec('t3040_a', 'BEGIN');
  SELECT id INTO v_id_a FROM dblink('t3040_a', t3040_race.create_sql('event', v.op_c, NULL, repeat('c',64)))
    AS t(id text, status text);
  PERFORM dblink_send_query('t3040_b', t3040_race.create_sql('event', v.op_c, NULL, repeat('c',64)));
  IF NOT t3040_race.is_waiting(v_pid_b, 'advisory') THEN
    PERFORM dblink_exec('t3040_a', 'ROLLBACK');
    RAISE EXCEPTION 'C2 a concurrent replay did not wait for the original request';
  END IF;
  PERFORM dblink_exec('t3040_a', 'COMMIT');
  SELECT id INTO v_id_b2 FROM dblink_get_result('t3040_b') AS t(id text, status text);
  PERFORM * FROM dblink_get_result('t3040_b') AS t(id text, status text);
  IF v_id_b2 IS DISTINCT FROM v_id_a THEN
    RAISE EXCEPTION 'C2 a concurrent replay returned a different job (% vs %)', v_id_b2, v_id_a;
  END IF;
  SELECT count(*) INTO v_n FROM public.event_cover_video_jobs WHERE requested_by = v.h AND client_operation_id = v.op_c;
  IF v_n <> 1 THEN RAISE EXCEPTION 'C2 one operation produced % rows', v_n; END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id = v_id_b::uuid) <> 'superseded' THEN
    RAISE EXCEPTION 'C2 the previous cover job was not superseded by the replayed operation';
  END IF;

  -- ── C3 two ad videos for the same draft overlap ────────────────────────
  PERFORM dblink_exec('t3040_a', 'BEGIN');
  SELECT id INTO v_id_a FROM dblink('t3040_a', t3040_race.create_sql('ad_creative', v.op_x, 'host-ad:race-draft', repeat('d',64)))
    AS t(id text, status text);
  PERFORM dblink_send_query('t3040_b', t3040_race.create_sql('ad_creative', v.op_y, 'host-ad:race-draft', repeat('e',64)));
  PERFORM pg_sleep(0.5);
  IF dblink_is_busy('t3040_b') = 1 THEN
    PERFORM dblink_exec('t3040_a', 'COMMIT');
    PERFORM * FROM dblink_get_result('t3040_b') AS t(id text, status text);
    PERFORM * FROM dblink_get_result('t3040_b') AS t(id text, status text);
    RAISE EXCEPTION 'C3 a second ad video waited on the first (cover lock applied to ad videos)';
  END IF;
  SELECT id, status INTO v_id_b, v_status FROM dblink_get_result('t3040_b') AS t(id text, status text);
  PERFORM * FROM dblink_get_result('t3040_b') AS t(id text, status text);
  PERFORM dblink_exec('t3040_a', 'COMMIT');
  SELECT count(*) INTO v_n FROM public.event_cover_video_jobs
   WHERE id IN (v_id_a::uuid, v_id_b::uuid) AND status = 'source_uploading';
  IF v_n <> 2 THEN RAISE EXCEPTION 'C3 % of 2 overlapping ad videos are still active', v_n; END IF;

  PERFORM dblink_disconnect('t3040_a');
  PERFORM dblink_disconnect('t3040_b');
  RAISE NOTICE 'issue_3040 concurrent replace tester adversarial PASS';
END;
$$;

-- Cleanup: every committed row, by id.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.event_cover_video_jobs j USING t3040_race.ids i WHERE j.brand_id = i.brand;
DELETE FROM public.events e USING t3040_race.ids i WHERE e.id = i.event;
DELETE FROM public.brand_team_members m USING t3040_race.ids i WHERE m.brand_id = i.brand;
DELETE FROM public.brands b USING t3040_race.ids i WHERE b.id = i.brand;
DELETE FROM public.creator_accounts c USING t3040_race.ids i WHERE c.id = i.h;
DELETE FROM auth.users u USING t3040_race.ids i WHERE u.id = i.h;
COMMIT;
RESET search_path;
DROP SCHEMA t3040_race CASCADE;

\echo 'issue_3040_concurrent_replace.tester.adversarial.pg17: PASS'
