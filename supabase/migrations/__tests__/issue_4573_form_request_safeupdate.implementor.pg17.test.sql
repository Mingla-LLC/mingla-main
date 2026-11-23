-- MINGLA-INVARIANT: I-4573-NO-BARE-DELETE-UPDATE | issue #4573 | no public function body has a DELETE or UPDATE without a WHERE clause: hosted PostgREST sessions preload pg-safeupdate (authenticator session_preload_libraries=safeupdate), which refuses one with SQLSTATE 21000 (T-1, any function, not only the form request ones; write WHERE true to clear a scratch table).
--
-- #4573 (20281127004573_issue_4573_form_request_safeupdate.sql): PostgreSQL 17 proof after the full
-- replay, run as supabase_admin.
--
-- T-1  catalog (SC-4, unconditional): no public function has a bare DELETE FROM <rel>; or an
--      UPDATE <rel> SET ...; with no WHERE (string literals and comments stripped first).
-- T-2  with LOAD 'safeupdate' (what every PostgREST session runs with in production):
--      SC-1 brand_form_request_enqueue queues an all-NG audience and a mixed NG/US audience;
--      SC-2 with texts off (over the monthly allowance) the enqueue succeeds, reason
--           monthly_allowance, and no queued row is routed by text;
--      SC-3 brand_form_auto_reminders_due() with one due attachment returns runs >= 1.
--
-- FAILS-ON-REVERT: removing any WHERE true from 20281127004573 fails T-1, and fails T-2 with
-- SQLSTATE 21000 "DELETE requires a WHERE clause" (SC-1, SC-3) or "UPDATE requires a WHERE
-- clause" (SC-2).

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4573 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.u(p_tag text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5('i4573:' || p_tag)::uuid $fn$;

CREATE OR REPLACE FUNCTION pg_temp.subj(VARIADIC p_tags text[]) RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT jsonb_agg(jsonb_build_object('kind', 'rsvp', 'id', pg_temp.u(t))) FROM unnest(p_tags) t
$fn$;

-- ═══ T-1 catalog: no bare DELETE / UPDATE in any public function (SC-4) ═══════════
DO $t$
DECLARE v_bad text;
BEGIN
  WITH src AS (
    SELECT p.oid::regprocedure::text AS fn,
           -- Single-quoted literals and comments out first, in one left-to-right pass (a ';' inside a
           -- string is not a statement end; an apostrophe inside a comment does not open a string).
           regexp_replace(p.prosrc, '''([^'']|'''')*''|--[^\n]*', ' ', 'g') AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  ), hits AS (
    SELECT fn, 'DELETE' AS stmt FROM src
     WHERE body ~* '\mDELETE\s+FROM\s+[a-z_."]+\s*;'
    UNION ALL
    SELECT s.fn, 'UPDATE' FROM src s
     CROSS JOIN LATERAL regexp_matches(s.body, '(\mUPDATE\s+[a-z_."]+(?:\s+(?:AS\s+)?[a-z_]+)?\s+SET\s[^;]*;)', 'gi') m(x)
     WHERE m.x[1] !~* '\mWHERE\M'
  )
  SELECT string_agg(DISTINCT fn || ' (' || stmt || ')', ', ') INTO v_bad FROM hits;
  PERFORM pg_temp.ok(v_bad IS NULL,
    'T-1 SC-4 no public function has a DELETE or UPDATE without WHERE (found: ' || COALESCE(v_bad, 'none') || ')');
END;
$t$;

BEGIN;
-- What PostgREST sessions run with in hosted Supabase.
LOAD 'safeupdate';

-- The fixture: a brand, one page with six guests (NG and US phones, all with email), one live form.
DO $t$
DECLARE
  v_def jsonb := '{"schema":"mingla.brand_form.v1","title":"Guest questions","intro":"One question","questions":[{"id":"45739100-0000-4000-8000-000000000101","position":0,"type":"short_text","label":"Dietary needs","required":true}]}'::jsonb;
  v_tag text;
  v_tz text := (SELECT name FROM pg_timezone_names WHERE extract(hour FROM now() AT TIME ZONE name) BETWEEN 11 AND 18
                  AND name LIKE 'Etc/GMT%' ORDER BY name LIMIT 1);
BEGIN
  FOREACH v_tag IN ARRAY ARRAY['owner','u1','u2','u3','u4','u5','u6'] LOOP
    INSERT INTO auth.users(id, email) VALUES (pg_temp.u(v_tag), 'i4573-' || v_tag || '@example.test');
    INSERT INTO public.profiles(id, email, display_name, first_name, last_name)
    VALUES (pg_temp.u(v_tag), 'i4573-' || v_tag || '@example.test', initcap(v_tag) || ' Person', initcap(v_tag), 'Person')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'Issue 4573', 'i4573-brand', 'NGN');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (pg_temp.u('brand'), pg_temp.u('owner'), 'brand_owner', now());
  -- The page starts in 47 hours: inside the automatic reminder's 46-48 hour window.
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (pg_temp.u('e'), pg_temp.u('brand'), 'Safeupdate night', 'i4573-e', 'rsvp', 'scheduled', 'public', v_tz, 'NGN');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (pg_temp.u('e'), now() + interval '47 hours', now() + interval '51 hours', 'UTC', true);
  INSERT INTO public.event_rsvps(id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (pg_temp.u('r1'), pg_temp.u('e'), pg_temp.u('u1'), 'Ada One', 'i4573-r1@example.test', '+2348030000001', 'going', 'approved'),
         (pg_temp.u('r2'), pg_temp.u('e'), pg_temp.u('u2'), 'Bola Two', 'i4573-r2@example.test', '+2348030000002', 'going', 'approved'),
         (pg_temp.u('r3'), pg_temp.u('e'), pg_temp.u('u3'), 'Cy Three', 'i4573-r3@example.test', '+12025558003', 'going', 'approved'),
         (pg_temp.u('r4'), pg_temp.u('e'), pg_temp.u('u4'), 'Dayo Four', 'i4573-r4@example.test', '+2348030000004', 'going', 'approved'),
         (pg_temp.u('r5'), pg_temp.u('e'), pg_temp.u('u5'), 'Eze Five', 'i4573-r5@example.test', '+2348030000005', 'going', 'approved'),
         (pg_temp.u('r6'), pg_temp.u('e'), pg_temp.u('u6'), 'Femi Six', 'i4573-r6@example.test', '+2348030000006', 'going', 'approved');
  INSERT INTO public.brand_forms(id, brand_id, name, status, draft, created_by, updated_by)
  VALUES (pg_temp.u('F'), pg_temp.u('brand'), 'Safeupdate questions', 'draft', v_def, pg_temp.u('owner'), pg_temp.u('owner'));
  INSERT INTO public.brand_form_versions(id, form_id, version, definition, definition_sha256, published_by)
  VALUES (pg_temp.u('Fv'), pg_temp.u('F'), 1, v_def, encode(digest(v_def::text, 'sha256'), 'hex'), pg_temp.u('owner'));
  UPDATE public.brand_forms SET status = 'live', live_version_id = pg_temp.u('Fv') WHERE id = pg_temp.u('F');
  INSERT INTO public.brand_form_attachments(id, form_id, brand_id, event_id, mode, created_by)
  VALUES (pg_temp.u('a'), pg_temp.u('F'), pg_temp.u('brand'), pg_temp.u('e'), 'required_step', pg_temp.u('owner'));
  PERFORM set_config('session_replication_role', 'origin', true);
END;
$t$;

-- ═══ T-2 the calls PostgREST makes, with safeupdate loaded ════════════════════════
DO $t$
DECLARE v jsonb; v_err text;
BEGIN
  -- Prove the guard is live in this session: a bare DELETE is refused here.
  BEGIN
    EXECUTE 'CREATE TEMP TABLE i4573_probe (x int) ON COMMIT DROP';
    EXECUTE 'DELETE FROM pg_temp.i4573_probe';
    v_err := 'ok';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  PERFORM pg_temp.ok(v_err = '21000', 'T-2 pg-safeupdate is loaded in this session (bare DELETE: ' || v_err || ')');

  -- SC-1a: an all-NG audience.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('owner'), pg_temp.u('F'), pg_temp.u('e'), 'ask', 'everyone',
         pg_temp.subj('r1', 'r2'), ARRAY['email', 'sms']);
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'queued')::integer = 2,
    'T-2 SC-1 under safeupdate an all-NG audience is queued (' || v::text || ')');
  -- SC-1b: a mixed NG/US audience.
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('owner'), pg_temp.u('F'), pg_temp.u('e'), 'ask', 'everyone',
         pg_temp.subj('r3', 'r4'), ARRAY['email', 'sms']);
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'queued')::integer = 2,
    'T-2 SC-1 under safeupdate a mixed NG/US audience is queued (' || v::text || ')');

  -- SC-2: one text a month and four already queued this month: texts are off for the send.
  INSERT INTO public.brand_messaging_limits (brand_id, email_monthly, sms_monthly, reason)
  VALUES (pg_temp.u('brand'), 1000, 1, 'i4573');
  SET LOCAL ROLE service_role;
  v := public.brand_form_request_enqueue(pg_temp.u('owner'), pg_temp.u('F'), pg_temp.u('e'), 'ask', 'everyone',
         pg_temp.subj('r5', 'r6'), ARRAY['email', 'sms']);
  RESET ROLE;
  PERFORM pg_temp.ok(v->'textsOff'->>'reason' = 'monthly_allowance' AND (v->>'queued')::integer = 2
      AND (v->>'textsQueued')::integer = 0,
    'T-2 SC-2 under safeupdate texts off: the send succeeds by email (' || v::text || ')');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.brand_form_request_sends
                                  WHERE form_id = pg_temp.u('F') AND rsvp_id IN (pg_temp.u('r5'), pg_temp.u('r6'))
                                    AND 'sms' = ANY (route)),
    'T-2 SC-2 no row queued with texts off is routed by text');

  -- SC-3: switch the automatic reminder on; the page starts in 47 hours.
  UPDATE public.brand_form_attachments SET auto_remind = true, auto_remind_channels = ARRAY['email']
   WHERE id = pg_temp.u('a');
  -- Clear the asks so nobody is held by the 24-hour per-person throttle.
  DELETE FROM public.brand_form_request_sends WHERE form_id = pg_temp.u('F');
  SET LOCAL ROLE service_role;
  v := public.brand_form_auto_reminders_due();
  RESET ROLE;
  PERFORM pg_temp.ok((v->>'runs')::integer >= 1 AND (v->>'queued')::integer >= 1,
    'T-2 SC-3 under safeupdate the automatic reminder runs and queues (' || v::text || ')');
END;
$t$;

ROLLBACK;
