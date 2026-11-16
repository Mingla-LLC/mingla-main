-- #4452 retest 1 (tester, adversarial): the rework 1 SQL fixes (c5cabd2b88) attacked from
-- angles the implementor's RW-SQL suite does not cover.
--
-- ADV-R1 three concurrent submits with three DIFFERENT keys for one email (no prior row):
--        no error, exactly one row, resubmit_count 2, and every key resolves to that row on
--        replay (the per-key lock must not break the per-email lock ordering).
-- ADV-R2 a retry that arrives while the first attempt with the SAME key is still open, and
--        that first attempt then ROLLS BACK: the retry must create the row (no phantom
--        replay of an id that was never committed).
-- ADV-R3 lead_note_failure (new SECURITY DEFINER writer) is not callable by anon or
--        authenticated, and pins search_path.
-- ADV-R4 a row that failed, then is repaired, is ingested by the next lead_reconcile() and
--        its failure row is cleared (attempts do not linger as a false alarm).
--
-- dblink connects over TCP to 127.0.0.1 inside the container (the image's pg_hba trusts
-- loopback; the local socket needs a password for supabase_admin).
--
-- FAILS-ON-REVERT (verified by the tester on a fresh replay):
--   - drop the per-row EXCEPTION block in lead_reconcile -> ADV-R4's first reconcile aborts;
--   - turn lead_note_failure back into a plain INSERT -> ADV-R4 sees two failure rows.
--   ADV-R1 and ADV-R2 are robustness guards on the new per-key lock (they hold with or
--   without it, because the per-email lock also serialises them); RW-SQL-1 is the revert
--   proof for the lock itself.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION pg_temp.t_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4452 retest tester FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;
CREATE OR REPLACE FUNCTION pg_temp.t_drop_form(p_form uuid)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  DELETE FROM public.lead_events WHERE source_table = 'form_submissions'
     AND source_id IN (SELECT id FROM public.form_submissions WHERE form_id = p_form);
  DELETE FROM public.leads l WHERE l.email_key LIKE '%@fixture-4452r.org'
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
CREATE OR REPLACE FUNCTION pg_temp.t_call(p_key uuid, p_form uuid, p_email text, p_tail text)
RETURNS text LANGUAGE sql AS $a$
  SELECT format($q$SELECT public.forms_submit_core(jsonb_build_object('idempotency_key', %L,
    'form_id', %L, 'email', %L, 'answers', %L::jsonb, 'time_zone', 'Africa/Lagos',
    'page_path', '/creators', 'placement', 'inline', 'ads_allowed', false))::text || %s$q$,
    p_key, p_form, p_email,
    jsonb_build_object('name', 'Ada Okafor', 'email', p_email, 'consent', true,
      'phone', jsonb_build_object('country','NG','dial','+234','number','801 234 5678'), 'what_do_you_make', 'Photo',
      'your_main_social', jsonb_build_object('platform','instagram','value','@ada'), 'city', jsonb_build_object('label','Lagos'))::text,
    p_tail)
$a$;

-- Committed fixture (the dblink sessions must see the form).
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
DO $c$ BEGIN
  IF to_regclass('public.zz_adv4452r_fixture') IS NOT NULL THEN
    PERFORM pg_temp.t_drop_form(form_id) FROM public.zz_adv4452r_fixture;
    DROP TABLE public.zz_adv4452r_fixture;
  END IF;
END $c$;
DELETE FROM public.admin_team_members WHERE email = 'adv4452r-web@mingla-fixture.org';
DELETE FROM auth.users WHERE id = '44520000-0000-4000-f000-0000000000d1';
INSERT INTO auth.users(id, email, email_confirmed_at)
VALUES ('44520000-0000-4000-f000-0000000000d1', 'adv4452r-web@mingla-fixture.org', now());
INSERT INTO public.admin_team_members(email, role, status, accepted_at)
VALUES ('adv4452r-web@mingla-fixture.org', 'website', 'active', now());
CREATE TABLE public.zz_adv4452r_fixture (form_id uuid);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"44520000-0000-4000-f000-0000000000d1","role":"authenticated"}', true),
       set_config('request.jwt.claim.sub', '44520000-0000-4000-f000-0000000000d1', true) \g /dev/null
CREATE TEMP TABLE adv_f ON COMMIT DROP AS SELECT (public.admin_form_create('Retest race', 'creator', 'creators')->>'id')::uuid AS id;
SELECT public.admin_form_mark_tested((SELECT id FROM adv_f)) \g /dev/null
SELECT public.admin_form_publish((SELECT id FROM adv_f), 1) \g /dev/null
RESET ROLE;
INSERT INTO public.zz_adv4452r_fixture SELECT id FROM adv_f;
COMMIT;

-- ═══ ADV-R1: three keys, one email, all at once ═══════════════════════════════
DO $t$
DECLARE
  v_conn text := format('dbname=%L user=%L host=127.0.0.1 port=5432', current_database(), current_user);
  v_form uuid := (SELECT form_id FROM public.zz_adv4452r_fixture);
  v_email text := 'adv-r1@fixture-4452r.org';
  v_keys uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_conns text[] := ARRAY['adv4452r_a','adv4452r_b','adv4452r_c'];
  v_err integer := 0; v_new integer := 0; v_dedupe integer := 0;
  v_res text; v_row uuid; v_rep jsonb; i integer;
BEGIN
  FOR i IN 1..3 LOOP PERFORM dblink_connect(v_conns[i], v_conn); END LOOP;
  -- a holds its transaction 1 s after the core returns; b and c arrive inside it.
  PERFORM dblink_send_query(v_conns[1], pg_temp.t_call(v_keys[1], v_form, v_email, '(pg_sleep(1) IS NULL)::text'));
  PERFORM pg_sleep(0.2);
  PERFORM dblink_send_query(v_conns[2], pg_temp.t_call(v_keys[2], v_form, v_email, $$''$$));
  PERFORM dblink_send_query(v_conns[3], pg_temp.t_call(v_keys[3], v_form, v_email, $$''$$));
  FOR i IN 1..3 LOOP
    BEGIN
      SELECT r INTO v_res FROM dblink_get_result(v_conns[i]) AS t(r text);
      PERFORM * FROM dblink_get_result(v_conns[i]) AS t(r text);
      IF v_res LIKE '%"deduped": true%' THEN v_dedupe := v_dedupe + 1;
      ELSIF v_res LIKE '%"deduped": false%' THEN v_new := v_new + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err + 1; RAISE NOTICE 'session % error: % %', v_conns[i], SQLSTATE, SQLERRM;
    END;
    PERFORM dblink_disconnect(v_conns[i]);
  END LOOP;
  PERFORM pg_temp.t_assert(v_err = 0, 'ADV-R1 no error from three concurrent keys for one email (got ' || v_err || ')');
  PERFORM pg_temp.t_assert(v_new = 1 AND v_dedupe = 2, format('ADV-R1 one new row and two dedupes (new=%s dedupe=%s)', v_new, v_dedupe));
  PERFORM pg_temp.t_assert((SELECT count(*) = 1 AND max(resubmit_count) = 2 FROM public.form_submissions WHERE email = v_email),
    'ADV-R1 one row with resubmit_count 2');
  SELECT id INTO v_row FROM public.form_submissions WHERE email = v_email;
  SET LOCAL ROLE service_role;
  FOR i IN 1..3 LOOP
    v_rep := public.forms_submit_core(jsonb_build_object('idempotency_key', v_keys[i], 'form_id', v_form, 'email', v_email,
      'answers', '{}'::jsonb, 'time_zone', 'Africa/Lagos', 'page_path', '/creators', 'placement', 'inline'));
    PERFORM pg_temp.t_assert(v_rep->>'replay' = 'true' AND (v_rep->>'submission_id')::uuid = v_row,
      format('ADV-R1 key %s replays to the one row', i));
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.t_assert((SELECT resubmit_count = 2 FROM public.form_submissions WHERE id = v_row),
    'ADV-R1 replays never add to resubmit_count');
END
$t$;

-- ═══ ADV-R2: the first attempt rolls back while its retry waits ══════════════
DO $t$
DECLARE
  v_conn text := format('dbname=%L user=%L host=127.0.0.1 port=5432', current_database(), current_user);
  v_form uuid := (SELECT form_id FROM public.zz_adv4452r_fixture);
  v_email text := 'adv-r2@fixture-4452r.org';
  v_key uuid := gen_random_uuid();
  v_a_err text := NULL; v_b text := NULL; v_b_err text := NULL;
BEGIN
  PERFORM dblink_connect('adv4452r_d', v_conn);
  PERFORM dblink_connect('adv4452r_e', v_conn);
  -- d runs the core, keeps the lock 1 s, then fails (division by zero): its transaction rolls back.
  PERFORM dblink_send_query('adv4452r_d', pg_temp.t_call(v_key, v_form, v_email, '(pg_sleep(1) IS NULL)::text || (1/0)::text'));
  PERFORM pg_sleep(0.2);
  PERFORM dblink_send_query('adv4452r_e', pg_temp.t_call(v_key, v_form, v_email, $$''$$));
  BEGIN
    PERFORM * FROM dblink_get_result('adv4452r_d') AS t(r text);
  EXCEPTION WHEN OTHERS THEN v_a_err := SQLSTATE;
  END;
  PERFORM * FROM dblink_get_result('adv4452r_d', false) AS t(r text);
  BEGIN
    SELECT r INTO v_b FROM dblink_get_result('adv4452r_e') AS t(r text);
    PERFORM * FROM dblink_get_result('adv4452r_e') AS t(r text);
  EXCEPTION WHEN OTHERS THEN v_b_err := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM dblink_disconnect('adv4452r_d');
  PERFORM dblink_disconnect('adv4452r_e');
  PERFORM pg_temp.t_assert(v_a_err IS NOT NULL, 'ADV-R2 the first attempt really failed and rolled back');
  PERFORM pg_temp.t_assert(v_b_err IS NULL, 'ADV-R2 the waiting retry raised no error (' || COALESCE(v_b_err, 'none') || ')');
  PERFORM pg_temp.t_assert(v_b LIKE '%"replay": false%' AND v_b LIKE '%"deduped": false%',
    'ADV-R2 the retry creates the row, not a replay of a rolled-back id');
  PERFORM pg_temp.t_assert((SELECT count(*) = 1 FROM public.form_submissions WHERE email = v_email AND idempotency_key = v_key),
    'ADV-R2 exactly one committed row for the key');
END
$t$;

SELECT pg_temp.t_drop_form(form_id) FROM public.zz_adv4452r_fixture \g /dev/null
DROP TABLE public.zz_adv4452r_fixture;
DELETE FROM public.admin_team_members WHERE email = 'adv4452r-web@mingla-fixture.org';
DELETE FROM auth.users WHERE id = '44520000-0000-4000-f000-0000000000d1';

-- ═══ ADV-R3: the new failure writer is internal only ═════════════════════════
DO $t$
DECLARE v_fn regprocedure := 'public.lead_note_failure(text, uuid, text, text)'::regprocedure;
BEGIN
  PERFORM pg_temp.t_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'ADV-R3 anon cannot call lead_note_failure');
  PERFORM pg_temp.t_assert(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'ADV-R3 authenticated cannot call lead_note_failure');
  PERFORM pg_temp.t_assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_fn),
    'ADV-R3 lead_note_failure is SECURITY DEFINER with an empty search_path');
END
$t$;

-- ═══ ADV-R4: fail, repair, reconcile clears the failure ══════════════════════
BEGIN;
DO $t$
DECLARE v_bad uuid := gen_random_uuid();
BEGIN
  ALTER TABLE public.leads ADD CONSTRAINT adv4452r_poison CHECK (name IS DISTINCT FROM 'Poison Retest');
  INSERT INTO public.beta_access_leads (id, brand_type, brand_name, contact_name, city, email, source, consent)
  VALUES (v_bad, ARRAY['restaurant'], 'Poison Retest Bar', 'Poison Retest', 'Lagos', 'adv-r4@fixture-4452r.org', 'organiser_marketing', false);
  PERFORM public.lead_reconcile();
  PERFORM pg_temp.t_assert((SELECT attempts >= 2 FROM public.lead_ingest_failures WHERE source_id = v_bad),
    'ADV-R4 the poison row is recorded and counted, the reconcile run survives it');
  ALTER TABLE public.leads DROP CONSTRAINT adv4452r_poison;
  PERFORM public.lead_reconcile();
  PERFORM pg_temp.t_assert(EXISTS (SELECT 1 FROM public.leads WHERE email_key = 'adv-r4@fixture-4452r.org'),
    'ADV-R4 once repaired, the next reconcile ingests the row');
  PERFORM pg_temp.t_assert(NOT EXISTS (SELECT 1 FROM public.lead_ingest_failures WHERE source_id = v_bad),
    'ADV-R4 and clears its failure row');
END
$t$;
ROLLBACK;
