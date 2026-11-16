-- #4452 rework 1: SQL defects from the FAIL verdict (comment 6915027543).
--
-- RW-SQL-1 (P2-9)  four concurrent forms_submit_core calls with ONE idempotency key (real
--                  sessions through dblink): no error, one new row, three replays, and
--                  resubmit_count stays 0.
-- RW-SQL-2 (P2-9)  a second key for the same email within 24 h is one resubmit; replaying
--                  that second key is a replay, never a second count.
-- RW-SQL-3 (P2-10) lead_reconcile() isolates a row that keeps failing and repairs the rest.
-- RW-SQL-4 (P3-16) a source row that keeps failing is ONE lead_ingest_failures row whose
--                  attempts count up (trigger + each reconcile), for both failure reasons.
-- RW-SQL-5 (P2-11) forms_track_event writes at most 200 rows per visit per day.
--
-- FAILS-ON-REVERT (verified by the implementor): the per-key advisory lock in
-- forms_submit_core -> RW-SQL-1 (one retry is miscounted as a dedupe); the per-row
-- EXCEPTION block in lead_reconcile -> RW-SQL-3; the upsert in lead_note_failure ->
-- RW-SQL-4; the per-visit cap in forms_track_event -> RW-SQL-5. The ON CONFLICT on
-- form_submission_keys is defence in depth behind the lock (with both removed the
-- retries raise 23505, as the tester reported); RW-SQL-2 pins its behaviour.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.t_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 rework FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.t_drop_form(p_form uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  -- Forms and versions are never deleted in the product (RESTRICT plus an
  -- immutability trigger), so the committed fixture unwinds with triggers off.
  PERFORM set_config('session_replication_role', 'replica', true);
  DELETE FROM public.lead_events WHERE source_table = 'form_submissions'
     AND source_id IN (SELECT id FROM public.form_submissions WHERE form_id = p_form);
  DELETE FROM public.leads l WHERE l.email_key LIKE '%@fixture-4452.org'
     AND NOT EXISTS (SELECT 1 FROM public.lead_events e WHERE e.lead_id = l.id);
  DELETE FROM public.form_automation_sends WHERE run_id IN (SELECT id FROM public.form_automation_runs WHERE form_id = p_form);
  DELETE FROM public.form_automation_runs WHERE form_id = p_form;
  DELETE FROM public.form_submission_keys WHERE submission_id IN (SELECT id FROM public.form_submissions WHERE form_id = p_form);
  DELETE FROM public.form_submissions WHERE form_id = p_form;
  DELETE FROM public.form_automation_versions WHERE form_id = p_form;
  DELETE FROM public.form_automations WHERE form_id = p_form;
  DELETE FROM public.form_versions WHERE form_id = p_form;
  DELETE FROM public.forms WHERE id = p_form;
  PERFORM set_config('session_replication_role', 'origin', true);
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.t_answers(p_email text)
RETURNS jsonb LANGUAGE sql AS $a$
  SELECT jsonb_build_object('name', 'Ada Okafor', 'email', p_email, 'consent', true,
    'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
    'your_main_social', jsonb_build_object('platform','instagram','value','@ada'), 'city', jsonb_build_object('label','Lagos'))
$a$;

-- Committed fixture: the concurrent sessions must see the form. Leftovers from an
-- interrupted run are removed first.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $c$ BEGIN
  IF to_regclass('public.zz_rw4452_fixture') IS NOT NULL THEN
    PERFORM pg_temp.t_drop_form(form_id) FROM public.zz_rw4452_fixture;
    DROP TABLE public.zz_rw4452_fixture;
  END IF;
END $c$;
DELETE FROM public.admin_team_members WHERE email = 'rw4452-web@mingla-fixture.org';
DELETE FROM auth.users WHERE id = '44520000-0000-4000-f000-0000000000c1';
INSERT INTO auth.users(id, email, email_confirmed_at)
VALUES ('44520000-0000-4000-f000-0000000000c1', 'rw4452-web@mingla-fixture.org', now());
INSERT INTO public.admin_team_members(email, role, status, accepted_at)
VALUES ('rw4452-web@mingla-fixture.org', 'website', 'active', now());
CREATE TABLE public.zz_rw4452_fixture (form_id uuid);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"44520000-0000-4000-f000-0000000000c1","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '44520000-0000-4000-f000-0000000000c1', true) \g /dev/null
CREATE TEMP TABLE rw_f ON COMMIT DROP AS SELECT (public.admin_form_create('Rework race', 'creator', 'creators')->>'id')::uuid AS id;
SELECT public.admin_form_mark_tested((SELECT id FROM rw_f)) \g /dev/null
SELECT public.admin_form_publish((SELECT id FROM rw_f), 1) \g /dev/null
RESET ROLE;
INSERT INTO public.zz_rw4452_fixture SELECT id FROM rw_f;
COMMIT;

-- ═══ RW-SQL-1: concurrent retries with one key ══════════════════════════════
DO $t$
DECLARE
  -- Loopback is trust on the CI image (supabase/postgres), the unix socket is scram there.
  v_conn text := format('dbname=%L user=%L host=127.0.0.1 port=5432', current_database(), current_user);
  v_form uuid := (SELECT form_id FROM public.zz_rw4452_fixture);
  v_key uuid := gen_random_uuid();
  v_call text;
  v_res text;
  v_new integer := 0;
  v_replay integer := 0;
  v_err integer := 0;
  c text;
BEGIN
  v_call := format($q$SELECT public.forms_submit_core(jsonb_build_object('idempotency_key', %L,
    'form_id', %L, 'email', 'race-key@fixture-4452.org', 'answers', %L::jsonb, 'time_zone', 'Africa/Lagos',
    'page_path', '/creators', 'placement', 'inline', 'ads_allowed', false))::text || (pg_sleep(%s) IS NULL)::text$q$,
    v_key, v_form, pg_temp.t_answers('race-key@fixture-4452.org')::text, '%s');
  FOREACH c IN ARRAY ARRAY['rw4452_a','rw4452_b','rw4452_c','rw4452_d'] LOOP
    PERFORM dblink_connect(c, v_conn);
  END LOOP;
  -- a holds its transaction open for 1 s after the core returns; b, c and d arrive inside it.
  PERFORM dblink_send_query('rw4452_a', format(v_call, '1'));
  PERFORM pg_sleep(0.2);
  FOREACH c IN ARRAY ARRAY['rw4452_b','rw4452_c','rw4452_d'] LOOP
    PERFORM dblink_send_query(c, format(v_call, '0'));
  END LOOP;
  FOREACH c IN ARRAY ARRAY['rw4452_a','rw4452_b','rw4452_c','rw4452_d'] LOOP
    BEGIN
      SELECT r INTO v_res FROM dblink_get_result(c) AS t(r text);
      PERFORM * FROM dblink_get_result(c) AS t(r text); -- drain
      IF v_res LIKE '%"replay": true%' THEN v_replay := v_replay + 1;
      ELSIF v_res LIKE '%"replay": false%' AND v_res LIKE '%"deduped": false%' THEN v_new := v_new + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1;
      RAISE NOTICE 'session % error: % %', c, SQLSTATE, SQLERRM;
    END;
    PERFORM dblink_disconnect(c);
  END LOOP;
  PERFORM pg_temp.t_assert(v_err = 0, 'RW-SQL-1 no concurrent retry errors (got ' || v_err || ')');
  PERFORM pg_temp.t_assert(v_new = 1 AND v_replay = 3, format('RW-SQL-1 one new row and three replays (new=%s replay=%s)', v_new, v_replay));
  PERFORM pg_temp.t_assert((SELECT count(*) = 1 AND max(resubmit_count) = 0 FROM public.form_submissions
                             WHERE email = 'race-key@fixture-4452.org'), 'RW-SQL-1 one row, resubmit_count 0');
END
$t$;

-- ═══ RW-SQL-2: a real resubmit counts once, its replay never ═══════════════════
DO $t$
DECLARE
  v_form uuid := (SELECT form_id FROM public.zz_rw4452_fixture);
  v_k2 uuid := gen_random_uuid();
  v jsonb; v2 jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v := public.forms_submit_core(jsonb_build_object('idempotency_key', v_k2, 'form_id', v_form, 'email', 'race-key@fixture-4452.org',
    'answers', pg_temp.t_answers('race-key@fixture-4452.org'), 'time_zone', 'Africa/Lagos', 'page_path', '/creators',
    'placement', 'inline', 'ads_allowed', false));
  v2 := public.forms_submit_core(jsonb_build_object('idempotency_key', v_k2, 'form_id', v_form, 'email', 'race-key@fixture-4452.org',
    'answers', pg_temp.t_answers('race-key@fixture-4452.org'), 'time_zone', 'Africa/Lagos', 'page_path', '/creators',
    'placement', 'inline', 'ads_allowed', false));
  RESET ROLE;
  PERFORM pg_temp.t_assert(v->>'deduped' = 'true' AND v->>'replay' = 'false', 'RW-SQL-2 a new key for the same email is a dedupe');
  PERFORM pg_temp.t_assert(v2->>'replay' = 'true' AND v2->>'submission_id' = v->>'submission_id', 'RW-SQL-2 its replay returns the same row');
  PERFORM pg_temp.t_assert((SELECT resubmit_count = 1 FROM public.form_submissions WHERE id = (v->>'submission_id')::uuid),
    'RW-SQL-2 resubmit_count is exactly 1');
  PERFORM pg_temp.t_assert((SELECT count(*) = 1 FROM public.form_submission_keys WHERE idempotency_key = v_k2),
    'RW-SQL-2 the side key is written once');
END
$t$;

-- Clean the committed fixture.
SELECT pg_temp.t_drop_form(form_id) FROM public.zz_rw4452_fixture \g /dev/null
DROP TABLE public.zz_rw4452_fixture;
DELETE FROM public.admin_team_members WHERE email = 'rw4452-web@mingla-fixture.org';
DELETE FROM auth.users WHERE id = '44520000-0000-4000-f000-0000000000c1';

-- ═══ RW-SQL-3 and RW-SQL-4: reconcile isolation and failure dedupe ═══════════
BEGIN;
DO $t$
DECLARE v_bad uuid := gen_random_uuid(); v_good uuid := gen_random_uuid(); v_tab uuid := gen_random_uuid();
BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT rw4452_poison CHECK (name IS DISTINCT FROM 'Poison Person');
  INSERT INTO public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_bad, ARRAY['restaurant'], 'Poison Bar', 'Poison Person', 'Lagos', 'rw-poison@fixture-4452.org', 'organiser_marketing', false);
  INSERT INTO public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_tab, ARRAY['restaurant'], 'Tab Bar', 'Tab', 'Lagos', E'rw-tab@fixture-4452.org\t', 'organiser_marketing', false);
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_good, ARRAY['restaurant'], 'Good Bar', 'Good Person', 'Lagos', 'rw-good@fixture-4452.org', 'organiser_marketing', false);
  SET LOCAL session_replication_role = origin;

  PERFORM public.lead_reconcile();
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.leads WHERE email_key = 'rw-good@fixture-4452.org'),
    'RW-SQL-3 reconcile repairs the good row past a row that keeps failing');
  PERFORM public.lead_reconcile();

  PERFORM pg_temp.t_assert((SELECT count(*) = 1 FROM public.lead_ingest_failures WHERE source_id = v_bad),
    'RW-SQL-4 the poison row is one failure row after the trigger and two reconciles');
  PERFORM pg_temp.t_assert((SELECT attempts = 3 AND reason = 'error' AND sqlstate = '23514' FROM public.lead_ingest_failures WHERE source_id = v_bad),
    'RW-SQL-4 its attempts count 3 with the SQLSTATE kept');
  PERFORM pg_temp.t_assert((SELECT count(*) = 1 AND max(attempts) = 3 FROM public.lead_ingest_failures WHERE source_id = v_tab AND reason = 'invalid_email'),
    'RW-SQL-4 an unusable email is one row whose attempts count up');
  PERFORM pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.lead_ingest_failures WHERE source_id = v_good),
    'RW-SQL-4 a repaired row leaves no failure');
END
$t$;
ROLLBACK;

-- ═══ RW-SQL-5: the per-visit funnel cap ══════════════════════════════════════
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $t$
DECLARE
  v_web constant uuid := '44520000-0000-4000-f000-0000000000c2';
  v_form uuid; v_visit uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); i integer;
BEGIN
  INSERT INTO auth.users(id, email, email_confirmed_at) VALUES (v_web, 'rw4452-web2@mingla-fixture.org', now());
  INSERT INTO public.admin_team_members(email, role, status, accepted_at) VALUES ('rw4452-web2@mingla-fixture.org', 'website', 'active', now());
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_web::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_web, 'role', 'authenticated')::text, true);
  v_form := (public.admin_form_create('Rework track', 'creator', 'creators')->>'id')::uuid;
  PERFORM public.admin_form_mark_tested(v_form);
  PERFORM public.admin_form_publish(v_form, 1);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  FOR i IN 1..205 LOOP
    PERFORM public.forms_track_event(jsonb_build_object('form_id', v_form, 'event', 'form_step', 'visit_id', v_visit,
      'page_path', '/creators', 'placement', 'inline', 'step', 1));
  END LOOP;
  PERFORM public.forms_track_event(jsonb_build_object('form_id', v_form, 'event', 'form_viewed', 'visit_id', v_other,
    'page_path', '/creators', 'placement', 'inline'));
  RESET ROLE;
  PERFORM pg_temp.t_assert((SELECT count(*) FROM public.form_funnel_events WHERE visit_id = v_visit) = 200,
    'RW-SQL-5 one visit is capped at 200 funnel rows a day');
  PERFORM pg_temp.t_assert((SELECT count(*) FROM public.form_funnel_events WHERE visit_id = v_other) = 1,
    'RW-SQL-5 another visit still records');
END
$t$;
ROLLBACK;
