\set ON_ERROR_STOP on
-- Issue #3040 Retest 1 — INDEPENDENT TESTER adversarial suite: REAL
-- concurrency between "the Host replaced this ad video" (cover_video_cancel_once
-- on a READY ad_creative job) and "the server adds it to the library"
-- (an ad_creatives INSERT for that job). The rework claims the job row lock
-- serializes the two (cancel takes FOR UPDATE, the creative trigger FOR SHARE).
-- The implementor suite proves each half in one session; this one overlaps
-- them in two loopback sessions (dblink), both orders:
--
--   M1  materialize first, still uncommitted, cancel arrives: the cancel WAITS,
--       then sees the creative and leaves the job ready (it is in the library).
--   M2  cancel first, still uncommitted, materialize arrives: the insert WAITS,
--       then sees the cancel and is refused (ad_creative_job_not_materializable).
--   Invariant after both: no job is both cancelled and in the library.
--
-- MINGLA-INVARIANT: I-AD-VIDEO-CANCELLED-NEVER-MATERIALIZES | issue #3040 | a cancelled ad video job never becomes an ad_creatives row, even when cancel and materialize overlap
--
-- FAILS ON REVERT: drop FOR SHARE from ad_creatives_job_not_cancelled (M2's
-- insert reads the pre-cancel snapshot and lands a creative on a cancelled
-- job), or drop the trigger (same), or drop FOR UPDATE / the creative check
-- from cover_video_cancel_once (M1 cancels a job that is in the library).
--
-- Commits its fixtures so the other sessions can see them; the cleanup at the
-- bottom removes every row by id. Runs as supabase_admin.
\getenv t3040m_pw PGPASSWORD

CREATE SCHEMA t3040_mrace;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA t3040_mrace;
SELECT n.nspname AS t3040m_dblink_schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'dblink' \gset
SET search_path = public, :"t3040m_dblink_schema";

CREATE TABLE t3040_mrace.ids AS
SELECT
  gen_random_uuid() AS h,
  gen_random_uuid() AS brand,
  gen_random_uuid() AS job1,
  gen_random_uuid() AS job2,
  replace(gen_random_uuid()::text, '-', '') AS sfx,
  format('host=127.0.0.1 port=%s dbname=postgres user=supabase_admin password=%s',
         current_setting('port'), :'t3040m_pw') AS conn;

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id) SELECT h FROM t3040_mrace.ids;
INSERT INTO public.creator_accounts(id, email) SELECT h, 't3040-mrace@example.test' FROM t3040_mrace.ids;
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
SELECT brand, h, 'T3040 MRace', 't3040-mrace-' || sfx, 'USD' FROM t3040_mrace.ids;
COMMIT;

-- Two READY ad_creative jobs (the trigger-validated INSERT path is exercised by
-- the implementor suites; here the rows are the shape the webhook leaves).
INSERT INTO public.event_cover_video_jobs(id,requested_by,target_kind,brand_id,draft_owner_key,provider,status,apply_mode,
    source_asset_id,source_duration_ms,trim_end_ms,processed_url,processed_poster_url,processed_mime_type,processed_bytes,
    processed_duration_ms,completed_at)
SELECT j.id, i.h, 'ad_creative', i.brand, 'host-ad:mrace', 'bunny', 'ready', 'published_manual',
    'guid-mrace-' || left(j.id::text, 8), 8000, 8000,
    'https://cdn.test/guid-mrace-' || left(j.id::text, 8) || '/play_1080p.mp4',
    'https://cdn.test/guid-mrace-' || left(j.id::text, 8) || '/thumbnail.jpg', 'video/mp4', 1000, 8000, now()
FROM t3040_mrace.ids i CROSS JOIN LATERAL (VALUES (i.job1), (i.job2)) AS j(id);

CREATE FUNCTION t3040_mrace.is_waiting(p_pid integer)
RETURNS boolean LANGUAGE plpgsql AS $fn$
BEGIN
  FOR i IN 1..150 LOOP
    IF EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = p_pid AND NOT l.granted) THEN RETURN true; END IF;
    PERFORM pg_sleep(0.1);
  END LOOP;
  RETURN false;
END;
$fn$;

CREATE FUNCTION t3040_mrace.insert_sql(p_job uuid)
RETURNS text LANGUAGE sql AS $fn$
  SELECT format(
    'INSERT INTO public.ad_creatives(kind,name,source_url,bunny_video_id,poster_url,mp4_master_url,brand_id,content_hash,source,source_job_id) '
    'SELECT ''video'',''race'',processed_url,source_asset_id,processed_poster_url,processed_url,brand_id,%L,''host_upload'',id '
    'FROM public.event_cover_video_jobs WHERE id=%L',
    repeat('c', 64), p_job);
$fn$;

DO $$
DECLARE
  v record;
  v_pid_b integer;
  v_status text;
  v_err text;
  v_n integer;
BEGIN
  SELECT * INTO v FROM t3040_mrace.ids;
  PERFORM dblink_connect('t3040m_a', v.conn);
  PERFORM dblink_connect('t3040m_b', v.conn);
  SELECT pid INTO v_pid_b FROM dblink('t3040m_b', 'SELECT pg_backend_pid()') AS t(pid integer);

  -- ── M1 materialize first, cancel overlaps ─────────────────────────────
  PERFORM dblink_exec('t3040m_a', 'BEGIN');
  PERFORM dblink_exec('t3040m_a', t3040_mrace.insert_sql(v.job1));
  PERFORM dblink_send_query('t3040m_b',
    format('SELECT (public.cover_video_cancel_once(%L)).status', v.job1));
  IF NOT t3040_mrace.is_waiting(v_pid_b) THEN
    PERFORM dblink_exec('t3040m_a', 'ROLLBACK');
    RAISE EXCEPTION 'M1 the cancel did not wait for the in-flight materialize';
  END IF;
  PERFORM dblink_exec('t3040m_a', 'COMMIT');
  SELECT s INTO v_status FROM dblink_get_result('t3040m_b') AS t(s text);
  PERFORM * FROM dblink_get_result('t3040m_b') AS t(s text);
  IF v_status <> 'ready' THEN
    RAISE EXCEPTION 'M1 a job already in the library was cancelled (status %)', v_status;
  END IF;

  -- ── M2 cancel first, materialize overlaps ─────────────────────────────
  PERFORM dblink_exec('t3040m_a', 'BEGIN');
  SELECT s INTO v_status FROM dblink('t3040m_a',
    format('SELECT (public.cover_video_cancel_once(%L)).status', v.job2)) AS t(s text);
  IF v_status <> 'cancelled' THEN
    PERFORM dblink_exec('t3040m_a', 'ROLLBACK');
    RAISE EXCEPTION 'M2 setup: a ready ad video without a creative was not cancellable (%)', v_status;
  END IF;
  PERFORM dblink_send_query('t3040m_b', t3040_mrace.insert_sql(v.job2));
  IF NOT t3040_mrace.is_waiting(v_pid_b) THEN
    PERFORM dblink_exec('t3040m_a', 'ROLLBACK');
    RAISE EXCEPTION 'M2 the materialize did not wait for the in-flight cancel';
  END IF;
  PERFORM dblink_exec('t3040m_a', 'COMMIT');
  BEGIN
    PERFORM * FROM dblink_get_result('t3040m_b', true) AS t(r text);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM * FROM dblink_get_result('t3040m_b', false) AS t(r text);
  IF v_err IS NULL OR v_err NOT LIKE '%ad_creative_job_not_materializable%' THEN
    RAISE EXCEPTION 'M2 a creative was created for a job cancelled concurrently (error: %)', coalesce(v_err, 'none');
  END IF;

  SELECT count(*) INTO v_n
  FROM public.event_cover_video_jobs j JOIN public.ad_creatives c ON c.source_job_id = j.id
  WHERE j.id IN (v.job1, v.job2) AND j.status IN ('cancelled','superseded','failed');
  IF v_n <> 0 THEN RAISE EXCEPTION 'invariant: % cancelled ad job(s) are in the library', v_n; END IF;

  PERFORM dblink_disconnect('t3040m_a');
  PERFORM dblink_disconnect('t3040m_b');
  RAISE NOTICE 'issue_3040 cancel/materialize race tester adversarial PASS';
END;
$$;

-- Cleanup: every committed row, by id.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.ad_creatives c USING t3040_mrace.ids i WHERE c.source_job_ref IN (i.job1, i.job2) OR c.source_job_id IN (i.job1, i.job2);
DELETE FROM public.event_cover_video_jobs j USING t3040_mrace.ids i WHERE j.brand_id = i.brand;
DELETE FROM public.brand_team_members m USING t3040_mrace.ids i WHERE m.brand_id = i.brand;
DELETE FROM public.brands b USING t3040_mrace.ids i WHERE b.id = i.brand;
DELETE FROM public.creator_accounts c USING t3040_mrace.ids i WHERE c.id = i.h;
DELETE FROM auth.users u USING t3040_mrace.ids i WHERE u.id = i.h;
COMMIT;
RESET search_path;
DROP SCHEMA t3040_mrace CASCADE;

\echo 'issue_3040_cancel_materialize_race.tester.adversarial.pg17: PASS'
