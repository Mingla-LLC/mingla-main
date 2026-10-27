\set ON_ERROR_STOP on

-- Issue #3801 — TESTER adversarial suite for
-- 20271231303801_issue_3801_draft_cover_video_keeps_revision.sql.
-- Run after the full migration chain on PostgreSQL 17.
--
-- The implementor's suite proves the happy path through the real functions.
-- This suite attacks what would let a real edit skip the revision bump, or
-- break an ordinary write:
--
-- T1. The trigger checks the row's status itself. With the flag forced 'on'
--     (as any caller of a later function might leave it), a cover-only change
--     to a PUBLISHED event still moves updated_at. The EXISTS in
--     cover_video_apply_once is not the only gate.
-- T2. Point-typed columns (location_geo, departure_geo) have no equality
--     operator. A draft with both set keeps its revision through the real
--     apply, with no error (the jsonb comparison, not a row comparison).
-- T3. The apply's own UPDATE fails inside a caller's exception block: the flag
--     is not left 'on' for the rest of the transaction, and a later cover-only
--     change to the same draft moves the revision.
-- T4. A soft-deleted draft: the apply writes nothing, the job stays ready, the
--     flag reads '' afterwards.
-- T5. Brands keep the shared function: with the flag forced 'on', a brand
--     cover apply through the real function still moves brands.updated_at.
-- T6. An authenticated brand owner, the way PostgREST runs a request:
--     (a) cannot EXECUTE cover_video_apply_once;
--     (b) can still rename their own draft (the trigger fires although
--         EXECUTE on events_set_updated_at is revoked), and the revision moves;
--     (c) a cover-only change by the owner, without the flag, moves it too.
-- T7. Catalog: only cover_video_apply_once and events_set_updated_at name the
--     flag; no function sets any setting from a non-literal or concatenated
--     name; no function carries the flag in its SET clause; anon and
--     authenticated cannot execute cover_video_apply_once; the trigger
--     function is not SECURITY DEFINER.
--
-- Fails on revert (verified on a full PG17 replay):
--   * delete `IF OLD.status = 'draft' THEN` and its END IF from
--     events_set_updated_at -> T1-01 red (the implementor suite stays green);
--   * GRANT EXECUTE on cover_video_apply_once to authenticated -> T7-04 red;
--   * migration absent (trg_events_updated_at on update_updated_at_column)
--     -> T2-03 red.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '38010000-0000-4000-8000-0000000ad001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"38010000-0000-4000-8000-0000000ad001","role":"authenticated"}', true);
INSERT INTO auth.users(id, email)
VALUES ('38010000-0000-4000-8000-0000000ad001', 'issue3801-tester-cover@example.test');
INSERT INTO public.creator_accounts(id) VALUES ('38010000-0000-4000-8000-0000000ad001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES ('38010000-0000-4000-8000-0000000ad010', '38010000-0000-4000-8000-0000000ad001',
        'Issue 3801 Tester Brand', 'issue-3801-tester-cover', 'GBP');

CREATE FUNCTION pg_temp.age_revision(p_event uuid) RETURNS timestamptz
LANGUAGE plpgsql AS $fx$
DECLARE v_rev timestamptz;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET updated_at = now() - interval '1 hour' WHERE id = p_event
  RETURNING updated_at INTO v_rev;
  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN v_rev;
END
$fx$;

CREATE FUNCTION pg_temp.aged_trip(p_title text) RETURNS uuid
LANGUAGE plpgsql AS $fx$
DECLARE v_event uuid;
BEGIN
  SELECT (public.biz_create_trip_draft(
    '38010000-0000-4000-8000-0000000ad010',
    jsonb_build_object('title', p_title, 'timezone', 'Europe/London'),
    gen_random_uuid())#>>'{event,id}')::uuid INTO v_event;
  IF v_event IS NULL THEN RAISE EXCEPTION 'ISSUE-3801-T fixture FAIL: trip draft not created'; END IF;
  PERFORM pg_temp.age_revision(v_event);
  RETURN v_event;
END
$fx$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

-- A ready event cover job (draft_auto, the webhook's mode), not yet applied.
CREATE FUNCTION pg_temp.ready_event_job(p_event uuid) RETURNS public.event_cover_video_jobs
LANGUAGE plpgsql AS $fx$
DECLARE j public.event_cover_video_jobs;
BEGIN
  INSERT INTO public.event_cover_video_jobs(requested_by, event_id, brand_id, provider, status,
    apply_mode, target_kind, source_asset_id, source_duration_ms, trim_start_ms, trim_end_ms,
    processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
  VALUES ('38010000-0000-4000-8000-0000000ad001', p_event, '38010000-0000-4000-8000-0000000ad010',
    'bunny', 'ready', 'draft_auto', 'event', 'tester-guid-' || p_event || '-' || gen_random_uuid(),
    13000, 0, 13000,
    'https://vz-tester.b-cdn.net/' || p_event || '/play_720p.mp4',
    'https://vz-tester.b-cdn.net/' || p_event || '/thumbnail.jpg', 'video/mp4', 4096, 13000)
  RETURNING * INTO j;
  RETURN j;
END
$fx$;

DO $cases$
DECLARE
  v_event uuid;
  v_rev timestamptz;
  v_brand_rev timestamptz;
  j public.event_cover_video_jobs;
  v_state text;
  v_message text;
BEGIN
  -- ── T1: the trigger itself refuses to keep a published event's revision ──
  v_event := pg_temp.aged_trip('Issue 3801 T1');
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET status = 'scheduled' WHERE id = v_event;
  PERFORM set_config('session_replication_role', 'origin', true);
  v_rev := pg_temp.rev(v_event);
  PERFORM pg_catalog.set_config('mingla.cover_video_apply', 'on', true);
  UPDATE public.events SET cover_media_type = 'video',
         cover_media_url = 'https://vz-tester.b-cdn.net/t1/play_720p.mp4',
         cover_media_poster_url = 'https://vz-tester.b-cdn.net/t1/thumbnail.jpg'
   WHERE id = v_event;
  PERFORM pg_catalog.set_config('mingla.cover_video_apply', '', true);
  IF pg_temp.rev(v_event) IS NOT DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801-T T1-01 FAIL: with the flag on, a cover-only change to a PUBLISHED event kept its revision (%)',
      v_rev;
  END IF;
  RAISE NOTICE 'ISSUE-3801-T T1 PASS: the trigger checks the status itself; a published event always moves';

  -- ── T2: point columns do not break the comparison ──────────────────────
  v_event := pg_temp.aged_trip('Issue 3801 T2');
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET location_geo = point(-9.1393, 38.7223),
         departure_geo = point(-0.1276, 51.5072),
         updated_at = now() - interval '1 hour'
   WHERE id = v_event;
  PERFORM set_config('session_replication_role', 'origin', true);
  v_rev := pg_temp.rev(v_event);
  j := pg_temp.ready_event_job(v_event);
  BEGIN
    j := public.cover_video_apply_once(j.id, 0, j.processed_url, NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RAISE EXCEPTION 'ISSUE-3801-T T2-01 FAIL: the apply errored on a draft with point columns: % / %',
      v_state, v_message;
  END;
  IF j.status IS DISTINCT FROM 'applied'
     OR (SELECT cover_media_type FROM public.events WHERE id = v_event) IS DISTINCT FROM 'video' THEN
    RAISE EXCEPTION 'ISSUE-3801-T T2-02 FAIL: the video was not applied (job %)', j.status;
  END IF;
  IF pg_temp.rev(v_event) IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801-T T2-03 FAIL: a draft with point columns set moved its revision on the apply';
  END IF;
  RAISE NOTICE 'ISSUE-3801-T T2 PASS: point columns set; the apply keeps the draft revision without error';

  -- T3 runs in the second transaction below (it needs a trigger).

  -- ── T4: a soft-deleted draft is not written and leaves no flag ─────────
  -- The job is recorded while the draft is live (a job for a deleted event is
  -- refused at insert); the host then deletes the draft before it applies.
  v_event := pg_temp.aged_trip('Issue 3801 T4');
  j := pg_temp.ready_event_job(v_event);
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET deleted_at = now() - interval '5 minutes' WHERE id = v_event;
  PERFORM set_config('session_replication_role', 'origin', true);
  v_rev := pg_temp.rev(v_event);
  j := public.cover_video_apply_once(j.id, 0, j.processed_url, NULL);
  IF j.status IS DISTINCT FROM 'ready'
     OR (SELECT cover_media_url FROM public.events WHERE id = v_event) IS NOT DISTINCT FROM j.processed_url
     OR pg_temp.rev(v_event) IS DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801-T T4-01 FAIL: a soft-deleted draft was written (job %)', j.status;
  END IF;
  IF pg_catalog.current_setting('mingla.cover_video_apply', true) IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'ISSUE-3801-T T4-02 FAIL: the flag outlived an apply that wrote nothing (%)',
      pg_catalog.current_setting('mingla.cover_video_apply', true);
  END IF;
  RAISE NOTICE 'ISSUE-3801-T T4 PASS: a soft-deleted draft is not written; no flag remains';

  -- ── T5: brands keep the shared function, flag or not ───────────────────
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.brands SET updated_at = now() - interval '1 hour'
   WHERE id = '38010000-0000-4000-8000-0000000ad010';
  PERFORM set_config('session_replication_role', 'origin', true);
  SELECT updated_at INTO v_brand_rev FROM public.brands WHERE id = '38010000-0000-4000-8000-0000000ad010';
  INSERT INTO public.event_cover_video_jobs(requested_by, event_id, brand_id, provider, status,
    apply_mode, target_kind, source_asset_id, source_duration_ms, trim_start_ms, trim_end_ms,
    processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
  VALUES ('38010000-0000-4000-8000-0000000ad001', NULL, '38010000-0000-4000-8000-0000000ad010',
    'bunny', 'ready', 'draft_auto', 'brand', 'tester-brand-guid-' || gen_random_uuid(), 13000, 0, 13000,
    'https://vz-tester.b-cdn.net/brand/play_720p.mp4', 'https://vz-tester.b-cdn.net/brand/thumbnail.jpg',
    'video/mp4', 4096, 13000)
  RETURNING * INTO j;
  PERFORM pg_catalog.set_config('mingla.cover_video_apply', 'on', true);
  j := public.cover_video_apply_once(j.id, 0, j.processed_url, NULL);
  PERFORM pg_catalog.set_config('mingla.cover_video_apply', '', true);
  IF j.status IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'ISSUE-3801-T T5-01 FAIL: the brand job did not apply (%)', j.status;
  END IF;
  IF (SELECT updated_at FROM public.brands WHERE id = '38010000-0000-4000-8000-0000000ad010')
     IS NOT DISTINCT FROM v_brand_rev THEN
    RAISE EXCEPTION 'ISSUE-3801-T T5-02 FAIL: a brand cover apply kept brands.updated_at';
  END IF;
  RAISE NOTICE 'ISSUE-3801-T T5 PASS: a brand cover apply still moves brands.updated_at, flag or not';

  -- ── T7: catalog — nothing a client can reach sets or carries the flag ──
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND p.prosrc ~ 'mingla\.cover_video_apply'
       AND p.proname NOT IN ('cover_video_apply_once', 'events_set_updated_at')
       AND n.nspname <> 'pg_temp' AND n.nspname !~ '^pg_temp_') THEN
    RAISE EXCEPTION 'ISSUE-3801-T T7-01 FAIL: another function names mingla.cover_video_apply: %',
      (SELECT string_agg(n.nspname || '.' || p.proname, ', ') FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosrc ~ 'mingla\.cover_video_apply'
          AND p.proname NOT IN ('cover_video_apply_once', 'events_set_updated_at')
          AND n.nspname !~ '^pg_temp');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_temp'
       AND p.prosrc ~* 'set_config\s*\(\s*(''[^'']*''\s*\|\||[^''[:space:]])') THEN
    RAISE EXCEPTION 'ISSUE-3801-T T7-02 FAIL: a function sets a setting from a non-literal name: %',
      (SELECT string_agg(n.nspname || '.' || p.proname, ', ') FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_temp'
          AND p.prosrc ~* 'set_config\s*\(\s*(''[^'']*''\s*\|\||[^''[:space:]])');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE array_to_string(p.proconfig, ',') ~ 'mingla\.cover_video_apply') THEN
    RAISE EXCEPTION 'ISSUE-3801-T T7-03 FAIL: a function carries mingla.cover_video_apply in its SET clause';
  END IF;
  IF has_function_privilege('authenticated', 'public.cover_video_apply_once(uuid,bigint,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cover_video_apply_once(uuid,bigint,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cover_video_apply_once(uuid,bigint,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3801-T T7-04 FAIL: cover_video_apply_once grants changed (anon/authenticated may run it, or service_role cannot)';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.events_set_updated_at()'::regprocedure) THEN
    RAISE EXCEPTION 'ISSUE-3801-T T7-05 FAIL: events_set_updated_at is SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'ISSUE-3801-T T7 PASS: only the apply sets the flag; no client-reachable path can';
END
$cases$;

ROLLBACK;

-- ── T3 / T6 need DDL and a role switch; they run in their own transaction ──
-- T3: the apply's own UPDATE fails. zz_issue_3801_tester_boom fires after
-- trg_events_updated_at and raises for the one event a test setting names.
BEGIN;

SELECT set_config('request.jwt.claim.sub', '38010000-0000-4000-8000-0000000ad001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"38010000-0000-4000-8000-0000000ad001","role":"authenticated"}', true);
INSERT INTO auth.users(id, email)
VALUES ('38010000-0000-4000-8000-0000000ad001', 'issue3801-tester-cover@example.test');
INSERT INTO public.creator_accounts(id) VALUES ('38010000-0000-4000-8000-0000000ad001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES ('38010000-0000-4000-8000-0000000ad010', '38010000-0000-4000-8000-0000000ad001',
        'Issue 3801 Tester Brand', 'issue-3801-tester-cover', 'GBP');

CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $fx$
BEGIN
  IF NEW.id::text = pg_catalog.current_setting('mingla.issue_3801_tester_boom', true) THEN
    RAISE EXCEPTION 'issue_3801_tester_boom';
  END IF;
  RETURN NEW;
END
$fx$;
CREATE TRIGGER zz_issue_3801_tester_boom BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();

CREATE TEMP TABLE issue_3801_t6(event_id uuid, rev timestamptz) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON issue_3801_t6 TO authenticated;

DO $t3$
DECLARE
  v_event uuid;
  v_rev timestamptz;
  j public.event_cover_video_jobs;
  v_message text;
BEGIN
  SELECT (public.biz_create_trip_draft('38010000-0000-4000-8000-0000000ad010',
    jsonb_build_object('title', 'Issue 3801 T3', 'timezone', 'Europe/London'),
    gen_random_uuid())#>>'{event,id}')::uuid INTO v_event;
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET updated_at = now() - interval '1 hour' WHERE id = v_event
  RETURNING updated_at INTO v_rev;
  PERFORM set_config('session_replication_role', 'origin', true);

  INSERT INTO public.event_cover_video_jobs(requested_by, event_id, brand_id, provider, status,
    apply_mode, target_kind, source_asset_id, source_duration_ms, trim_start_ms, trim_end_ms,
    processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
  VALUES ('38010000-0000-4000-8000-0000000ad001', v_event, '38010000-0000-4000-8000-0000000ad010',
    'bunny', 'ready', 'draft_auto', 'event', 'tester-guid-t3-' || gen_random_uuid(), 13000, 0, 13000,
    'https://vz-tester.b-cdn.net/t3/play_720p.mp4', 'https://vz-tester.b-cdn.net/t3/thumbnail.jpg',
    'video/mp4', 4096, 13000)
  RETURNING * INTO j;

  PERFORM pg_catalog.set_config('mingla.issue_3801_tester_boom', v_event::text, true);
  BEGIN
    PERFORM public.cover_video_apply_once(j.id, 0, j.processed_url, NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  END;
  PERFORM pg_catalog.set_config('mingla.issue_3801_tester_boom', '', true);
  IF v_message IS DISTINCT FROM 'issue_3801_tester_boom' THEN
    RAISE EXCEPTION 'ISSUE-3801-T T3-01 FAIL: the forced failure inside the apply did not fire (%)', v_message;
  END IF;
  IF pg_catalog.current_setting('mingla.cover_video_apply', true) = 'on' THEN
    RAISE EXCEPTION 'ISSUE-3801-T T3-02 FAIL: a failed apply left the flag on for the rest of the transaction';
  END IF;
  IF (SELECT status FROM public.event_cover_video_jobs WHERE id = j.id) IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'ISSUE-3801-T T3-03 FAIL: the failed apply changed the job';
  END IF;
  UPDATE public.events SET cover_media_url = 'https://images.example.test/t3.jpg',
         cover_media_type = 'image' WHERE id = v_event;
  IF (SELECT updated_at FROM public.events WHERE id = v_event) IS NOT DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801-T T3-04 FAIL: after a failed apply, a host cover change kept the revision';
  END IF;
  RAISE NOTICE 'ISSUE-3801-T T3 PASS: a failed apply leaves no flag; a later cover change moves the revision';

  -- T6 fixture: a draft owned by the brand, revision aged.
  SELECT (public.biz_create_trip_draft('38010000-0000-4000-8000-0000000ad010',
    jsonb_build_object('title', 'Issue 3801 T6', 'timezone', 'Europe/London'),
    gen_random_uuid())#>>'{event,id}')::uuid INTO v_event;
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET updated_at = now() - interval '1 hour' WHERE id = v_event
  RETURNING updated_at INTO v_rev;
  PERFORM set_config('session_replication_role', 'origin', true);
  INSERT INTO issue_3801_t6 VALUES (v_event, v_rev);

  INSERT INTO public.event_cover_video_jobs(requested_by, event_id, brand_id, provider, status,
    apply_mode, target_kind, source_asset_id, source_duration_ms, trim_start_ms, trim_end_ms,
    processed_url, processed_poster_url, processed_mime_type, processed_bytes, processed_duration_ms)
  VALUES ('38010000-0000-4000-8000-0000000ad001', v_event, '38010000-0000-4000-8000-0000000ad010',
    'bunny', 'ready', 'draft_auto', 'event', 'tester-guid-t6', 13000, 0, 13000,
    'https://vz-tester.b-cdn.net/t6/play_720p.mp4', 'https://vz-tester.b-cdn.net/t6/thumbnail.jpg',
    'video/mp4', 4096, 13000);
END
$t3$;

DROP TRIGGER zz_issue_3801_tester_boom ON public.events;

-- ── T6: an authenticated brand owner, the way a PostgREST request runs ───
SET LOCAL ROLE authenticated;

DO $t6$
DECLARE
  v_event uuid;
  v_rev timestamptz;
  v_job uuid;
  v_state text;
  v_rows integer;
BEGIN
  SELECT event_id, rev INTO v_event, v_rev FROM issue_3801_t6;

  -- (a) the apply is not callable by a signed-in user.
  SELECT id INTO v_job FROM public.event_cover_video_jobs WHERE source_asset_id = 'tester-guid-t6';
  v_state := NULL;
  BEGIN
    PERFORM public.cover_video_apply_once(
      coalesce(v_job, '38010000-0000-4000-8000-0000000ad0ff'::uuid), 0,
      'https://vz-tester.b-cdn.net/t6/play_720p.mp4', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'ISSUE-3801-T T6-01 FAIL: authenticated could call cover_video_apply_once (sqlstate %)', v_state;
  END IF;

  -- (b) the owner's own rename still works and still moves the revision.
  v_state := NULL;
  BEGIN
    UPDATE public.events SET title = 'Owner renamed it' WHERE id = v_event;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RAISE EXCEPTION 'ISSUE-3801-T T6-02 FAIL: the owner''s rename errored (sqlstate %)', v_state;
  END;
  IF v_rows IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ISSUE-3801-T T6-03 FAIL: the owner''s rename touched % rows (RLS fixture?)', v_rows;
  END IF;
  IF (SELECT updated_at FROM public.events WHERE id = v_event) IS NOT DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801-T T6-04 FAIL: the owner''s rename kept the revision';
  END IF;
  UPDATE issue_3801_t6 SET rev = (SELECT updated_at FROM public.events WHERE id = v_event);
END
$t6$;

RESET ROLE;
DO $age$
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.events SET updated_at = now() - interval '2 hours'
   WHERE id = (SELECT event_id FROM issue_3801_t6);
  UPDATE issue_3801_t6 SET rev = now() - interval '2 hours';
  PERFORM set_config('session_replication_role', 'origin', true);
END
$age$;
SET LOCAL ROLE authenticated;

DO $t6c$
DECLARE
  v_event uuid;
  v_rev timestamptz;
BEGIN
  SELECT event_id, rev INTO v_event, v_rev FROM issue_3801_t6;
  -- (c) a cover-only change by the owner, no flag: the revision moves.
  UPDATE public.events SET cover_media_url = 'https://images.example.test/owner.jpg',
         cover_media_type = 'image' WHERE id = v_event;
  IF (SELECT updated_at FROM public.events WHERE id = v_event) IS NOT DISTINCT FROM v_rev THEN
    RAISE EXCEPTION 'ISSUE-3801-T T6-05 FAIL: an owner''s cover-only change kept the revision without the flag';
  END IF;
  RAISE NOTICE 'ISSUE-3801-T T6 PASS: a signed-in owner cannot run the apply; their own edits, cover included, move the revision';
END
$t6c$;

RESET ROLE;
ROLLBACK;

\echo 'issue_3801_draft_cover_video_keeps_revision.tester.adversarial.pg17: PASS'
