\set ON_ERROR_STOP on

-- Issue #4134 — INDEPENDENT TESTER adversarial suite, on the fully replayed
-- PG17 schema. Run from the repository root as supabase_admin.
--
-- The implementor's suite proves the happy path: the catalogue holds no 40001
-- raise, three stale calls answer PT409, and the four widened handlers read
-- right in their source text. This suite attacks other angles:
--
--   T1 STALE   real cursors that really went stale. biz_guest_roster_list is
--              given a genuine signed cursor, the roster then changes, and the
--              old cursor must come back as PT409 guest_roster_cursor_stale,
--              never as 22023 guest_roster_filter_invalid (what its WHEN OTHERS
--              arm would have turned it into). get_brand_circle_reach is given
--              a cursor one snapshot behind, and must raise PT409
--              circle_cursor_stale instead of answering "unavailable"; the
--              current snapshot's cursor must still be answered.
--   T2 GENUINE a genuine SQLSTATE 40001 (serialization_failure) arising inside
--              each of the four widened handlers is still handled exactly as
--              before (re-raised as 40001, or counted "busy"), PT409 is handled
--              the same way, and an unrelated error still falls through to the
--              WHEN OTHERS arm unchanged.
--   T3 AGAIN   the migration applied a second time is a no-op: every
--              function keeps its oid, its definition (md5 of
--              pg_get_functiondef), owner, grants and comment, and only the
--              77 target functions in public/private are even rewritten.
--   T4 CLOSED  the migration fails closed and rolls back as a whole: a 40001
--              raise left in any function (here outside public/private) makes
--              it refuse; so does drift in a TARGET function's grant, comment,
--              search_path, volatility, owner or oid, forced by an event
--              trigger while the migration re-creates it; so does a target
--              whose definition is no longer the one the file was generated
--              from (the file must never overwrite a later change). After each
--              refusal nothing is applied. Finally a target reverted to its
--              pre-migration 40001 definition is restored by a clean run, and
--              the clean run touches the 77 targets and nothing else.
--
-- T1 and T2 roll back. T3 and T4 must commit (the migration owns its own
-- transaction); T4 removes every object it created and re-checks the
-- catalogue at the end.

-------------------------------------------------------------------------------
-- T1 + T2 (rolled back)
-------------------------------------------------------------------------------
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('41340000-0000-4000-9000-000000000001', 'owner.t4134@test.local');
INSERT INTO public.creator_accounts(id) VALUES ('41340000-0000-4000-9000-000000000001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
VALUES ('41340000-0000-4000-9000-000000000010', '41340000-0000-4000-9000-000000000001',
        'Issue 4134 Tester Brand', 'issue-4134-tester-brand', 'GBP', now(), now());
INSERT INTO public.events(id, brand_id, created_by, event_type, title, slug, status, visibility, currency,
  timezone, party_types, rsvp_approval_mode, rsvp_discoverable, theme, created_at, updated_at)
VALUES ('41340000-0000-4000-9000-000000000020', '41340000-0000-4000-9000-000000000010',
        '41340000-0000-4000-9000-000000000001', 'rsvp', 'Issue 4134 Tester Event', 'issue-4134-tester-event',
        'scheduled', 'public', 'GBP', 'UTC', '{}', 'auto', false, '{}', now(), now());
INSERT INTO public.brand_people(id, brand_id, display_name) VALUES
  ('41340000-0000-4000-9000-000000000031', '41340000-0000-4000-9000-000000000010', 'Ada Guest'),
  ('41340000-0000-4000-9000-000000000032', '41340000-0000-4000-9000-000000000010', 'Bola Guest'),
  ('41340000-0000-4000-9000-000000000033', '41340000-0000-4000-9000-000000000010', 'Chidi Guest');
INSERT INTO public.brand_offering_invites(id, brand_id, event_id, brand_person_id, origin) VALUES
  ('41340000-0000-4000-9000-000000000041', '41340000-0000-4000-9000-000000000010',
   '41340000-0000-4000-9000-000000000020', '41340000-0000-4000-9000-000000000031', 'wizard'),
  ('41340000-0000-4000-9000-000000000042', '41340000-0000-4000-9000-000000000010',
   '41340000-0000-4000-9000-000000000020', '41340000-0000-4000-9000-000000000032', 'wizard'),
  ('41340000-0000-4000-9000-000000000043', '41340000-0000-4000-9000-000000000010',
   '41340000-0000-4000-9000-000000000020', '41340000-0000-4000-9000-000000000033', 'wizard');
INSERT INTO public.guest_roster_brand_rollouts(brand_id, phase)
VALUES ('41340000-0000-4000-9000-000000000010', 'internal_read');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'guest_roster_read_enabled';
INSERT INTO public.brand_reach_refresh_state(brand_id, snapshot_version)
VALUES ('41340000-0000-4000-9000-000000000010', 5)
ON CONFLICT (brand_id) DO UPDATE SET snapshot_version = EXCLUDED.snapshot_version;

SELECT set_config('request.jwt.claim.sub', '41340000-0000-4000-9000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Runs one call and reports its SQLSTATE and message ('00000' on success).
CREATE FUNCTION pg_temp.t4134_outcome(p_sql text, OUT state text, OUT message text, OUT answer jsonb)
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql INTO answer;
  state := '00000';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, message = MESSAGE_TEXT;
END;
$fn$;

DO $t1$
DECLARE
  v_page jsonb;
  v_cursor jsonb;
  o record;
BEGIN
  -- T1-01 a genuine first page with a signed cursor.
  v_page := public.biz_guest_roster_list('41340000-0000-4000-9000-000000000020', 'all', NULL,
                                         'action_priority', NULL, 1);
  v_cursor := v_page->'nextCursor';
  IF v_cursor IS NULL OR jsonb_typeof(v_cursor) <> 'object' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T1-01 FAIL: the roster fixture gave no next cursor: %', v_page;
  END IF;

  -- T1-02 the same cursor, before anything changed, is still answered: the
  -- staleness below is caused by the change, not by the cursor itself.
  SELECT * INTO o FROM pg_temp.t4134_outcome(format(
    'SELECT public.biz_guest_roster_list(%L, %L, NULL, %L, %L::jsonb, 1)',
    '41340000-0000-4000-9000-000000000020', 'all', 'action_priority', v_cursor));
  IF o.state <> '00000' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T1-02 FAIL: a fresh roster cursor was refused with % / %', o.state, o.message;
  END IF;

  -- T1-03 a malformed cursor field (with the current watermark and query) is
  -- still the WHEN OTHERS arm's 22023 guest_roster_filter_invalid.
  SELECT * INTO o FROM pg_temp.t4134_outcome(format(
    'SELECT public.biz_guest_roster_list(%L, %L, NULL, %L, %L::jsonb, 1)',
    '41340000-0000-4000-9000-000000000020', 'all', 'action_priority',
    v_cursor || jsonb_build_object('activityAt', 'not a time')));
  IF o.state IS DISTINCT FROM '22023' OR o.message IS DISTINCT FROM 'guest_roster_filter_invalid' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T1-03 FAIL: a malformed roster cursor returned % / %', o.state, o.message;
  END IF;

  -- T1-04 the roster changes; the old cursor is now stale.
  INSERT INTO public.guest_roster_change_events(event_id, roster_key, fact_kind)
  VALUES ('41340000-0000-4000-9000-000000000020', 'person:41340000-0000-4000-9000-000000000033', 'rsvp');
  SELECT * INTO o FROM pg_temp.t4134_outcome(format(
    'SELECT public.biz_guest_roster_list(%L, %L, NULL, %L, %L::jsonb, 1)',
    '41340000-0000-4000-9000-000000000020', 'all', 'action_priority', v_cursor));
  IF o.state IS DISTINCT FROM 'PT409' OR o.message IS DISTINCT FROM 'guest_roster_cursor_stale' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T1-04 FAIL: a stale roster cursor returned % / % (want PT409 / guest_roster_cursor_stale)',
      o.state, o.message;
  END IF;

  -- T1-05 a circle cursor one snapshot behind is stale, not "unavailable".
  SELECT * INTO o FROM pg_temp.t4134_outcome(format(
    'SELECT public.get_brand_circle_reach(%L, %L, %L::jsonb, 10)',
    '41340000-0000-4000-9000-000000000010', 'all',
    jsonb_build_object('memberId', '41340000-0000-4000-9000-0000000000f1', 'ringOrder', 2,
                       'snapshotVersion', 4, 'sortName', 'a')));
  IF o.state IS DISTINCT FROM 'PT409' OR o.message IS DISTINCT FROM 'circle_cursor_stale' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T1-05 FAIL: a stale circle cursor returned % / % / %', o.state, o.message, o.answer;
  END IF;

  -- T1-06 the current snapshot's cursor is answered (no error at all).
  SELECT * INTO o FROM pg_temp.t4134_outcome(format(
    'SELECT public.get_brand_circle_reach(%L, %L, %L::jsonb, 10)',
    '41340000-0000-4000-9000-000000000010', 'all',
    jsonb_build_object('memberId', '41340000-0000-4000-9000-0000000000f1', 'ringOrder', 2,
                       'snapshotVersion', 5, 'sortName', 'a')));
  IF o.state <> '00000' OR o.answer->>'schemaVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T1-06 FAIL: the current circle cursor returned % / % / %', o.state, o.message, o.answer;
  END IF;

  -- T1-07 the snapshot moves on: yesterday's good cursor becomes stale.
  UPDATE public.brand_reach_refresh_state SET snapshot_version = 6
   WHERE brand_id = '41340000-0000-4000-9000-000000000010';
  SELECT * INTO o FROM pg_temp.t4134_outcome(format(
    'SELECT public.get_brand_circle_reach(%L, %L, %L::jsonb, 10)',
    '41340000-0000-4000-9000-000000000010', 'follower',
    jsonb_build_object('memberId', '41340000-0000-4000-9000-0000000000f1', 'ringOrder', 2,
                       'snapshotVersion', 5, 'sortName', 'a')));
  IF o.state IS DISTINCT FROM 'PT409' OR o.message IS DISTINCT FROM 'circle_cursor_stale' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T1-07 FAIL: a superseded circle cursor returned % / % / %', o.state, o.message, o.answer;
  END IF;

  RAISE NOTICE 'ISSUE-4134-T T1 PASS: stale roster and circle cursors are reported as stale (PT409), nothing else';
END
$t1$;

-------------------------------------------------------------------------------
-- T2: what each widened handler does with a genuine 40001, with PT409 and
-- with an unrelated error. The error is raised at the exact point the handler
-- guards, by a stand-in chosen with the GUC issue_4134_tester.mode:
--   serialization -> SQLSTATE 40001, the real "could not serialize" message
--   pt409         -> SQLSTATE PT409
--   other         -> SQLSTATE P0001
-- Every stand-in is rolled back with this transaction.
-------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t4134_raise_for_mode() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  CASE current_setting('issue_4134_tester.mode', true)
    WHEN 'serialization' THEN
      RAISE EXCEPTION 'could not serialize access due to concurrent update'
        USING ERRCODE = 'serialization_failure';
    WHEN 'pt409' THEN
      RAISE EXCEPTION 'tester_stale_conflict' USING ERRCODE = 'PT409';
    WHEN 'other' THEN
      RAISE EXCEPTION 'tester_unrelated_failure' USING ERRCODE = 'P0001';
    ELSE NULL;
  END CASE;
END;
$fn$;

-- get_brand_circle_reach: the first thing after its argument checks.
CREATE OR REPLACE FUNCTION public.issue_1777_brand_reach_scope_status(p_brand_id uuid, p_ring text)
RETURNS TABLE(scope_state text, safe_reason text, generation_id uuid, member_count bigint,
              refreshed_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
  PERFORM pg_temp.t4134_raise_for_mode();
  scope_state := 'unavailable'; safe_reason := 'authority_unavailable';
  RETURN NEXT;
END;
$fn$;

-- ops_brand_autolink and ops_brand_cards_confirm: the per-brand worker. Only
-- this suite's brand fails; any other brand a run picks up is linked.
CREATE OR REPLACE FUNCTION public.ops_brand_autolink_one(p_brand_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'pg_temp'
AS $fn$
BEGIN
  IF p_brand_id = '41340000-0000-4000-9000-000000000010' THEN
    PERFORM pg_temp.t4134_raise_for_mode();
  END IF;
  RETURN jsonb_build_object('status', 'linked', 'record_id', NULL);
END;
$fn$;

-- biz_guest_roster_list: its guarded block only reads its own arguments, so
-- the raise is placed at the top of that block in a rolled-back copy.
DO $inject$
DECLARE
  v_def text := pg_catalog.pg_get_functiondef(
    'public.biz_guest_roster_list(uuid, text, text, text, jsonb, integer)'::pg_catalog.regprocedure);
  v_anchor constant text := E'  BEGIN\n    IF p_cursor IS NOT NULL AND (\n';
  v_new text;
BEGIN
  IF pg_catalog.strpos(v_def, v_anchor) = 0 THEN
    RAISE EXCEPTION 'ISSUE-4134-T T2-00 FAIL: biz_guest_roster_list no longer has its guarded cursor block';
  END IF;
  v_new := pg_catalog.replace(v_def, v_anchor,
    E'  BEGIN\n    PERFORM pg_temp.t4134_raise_for_mode();\n    IF p_cursor IS NOT NULL AND (\n');
  EXECUTE v_new;
END
$inject$;

INSERT INTO public.admin_users(email, role, status, accepted_at)
VALUES ('owner.t4134@test.local', 'owner', 'active', now());
INSERT INTO public.ops_settings(key, value, updated_by)
VALUES ('brand_auto_since', to_jsonb(now()), 'owner.t4134@test.local')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

DO $t2$
DECLARE
  o record;
  v_mode text;
  v_res jsonb;
  v_n integer := 0;
  v_want_circle text;
  v_want_roster text;
BEGIN
  FOREACH v_mode IN ARRAY ARRAY['serialization', 'pt409', 'other'] LOOP
    v_n := v_n + 1;
    PERFORM set_config('issue_4134_tester.mode', v_mode, true);

    -- T2-a get_brand_circle_reach: 40001 and PT409 are re-raised as they are;
    -- anything else is the "unavailable" answer.
    SELECT * INTO o FROM pg_temp.t4134_outcome(format(
      'SELECT public.get_brand_circle_reach(%L, %L, NULL, 10)',
      '41340000-0000-4000-9000-000000000010', 'all'));
    v_want_circle := CASE v_mode WHEN 'serialization' THEN '40001' WHEN 'pt409' THEN 'PT409' ELSE '00000' END;
    IF o.state IS DISTINCT FROM v_want_circle
       OR (v_mode = 'serialization' AND o.message IS DISTINCT FROM 'could not serialize access due to concurrent update')
       OR (v_mode = 'pt409' AND o.message IS DISTINCT FROM 'tester_stale_conflict')
       OR (v_mode = 'other' AND o.answer->>'state' IS DISTINCT FROM 'unavailable') THEN
      RAISE EXCEPTION 'ISSUE-4134-T T2-a FAIL (%): get_brand_circle_reach returned % / % / %',
        v_mode, o.state, o.message, o.answer;
    END IF;

    -- T2-b biz_guest_roster_list: 40001 and PT409 are re-raised as they are;
    -- anything else becomes guest_roster_filter_invalid.
    SELECT * INTO o FROM pg_temp.t4134_outcome(format(
      'SELECT public.biz_guest_roster_list(%L, %L, NULL, %L, NULL, 5)',
      '41340000-0000-4000-9000-000000000020', 'all', 'action_priority'));
    v_want_roster := CASE v_mode WHEN 'serialization' THEN '40001' WHEN 'pt409' THEN 'PT409' ELSE '22023' END;
    IF o.state IS DISTINCT FROM v_want_roster
       OR (v_mode = 'serialization' AND o.message IS DISTINCT FROM 'could not serialize access due to concurrent update')
       OR (v_mode = 'pt409' AND o.message IS DISTINCT FROM 'tester_stale_conflict')
       OR (v_mode = 'other' AND o.message IS DISTINCT FROM 'guest_roster_filter_invalid') THEN
      RAISE EXCEPTION 'ISSUE-4134-T T2-b FAIL (%): biz_guest_roster_list returned % / %', v_mode, o.state, o.message;
    END IF;

    -- T2-c ops_brand_autolink: 40001 and PT409 are "busy" (no wait row);
    -- anything else stops the brand and records a wait.
    DELETE FROM public.ops_brand_autolink_waits WHERE brand_id = '41340000-0000-4000-9000-000000000010';
    v_res := public.ops_brand_autolink();
    IF v_mode IN ('serialization', 'pt409') THEN
      IF (v_res->>'busy')::integer IS DISTINCT FROM 1
         OR EXISTS (SELECT 1 FROM public.ops_brand_autolink_waits
                     WHERE brand_id = '41340000-0000-4000-9000-000000000010') THEN
        RAISE EXCEPTION 'ISSUE-4134-T T2-c FAIL (%): ops_brand_autolink did not count the brand busy: %', v_mode, v_res;
      END IF;
    ELSIF (v_res->>'busy')::integer IS DISTINCT FROM 0
       OR (SELECT last_status FROM public.ops_brand_autolink_waits
            WHERE brand_id = '41340000-0000-4000-9000-000000000010') IS DISTINCT FROM 'stopped' THEN
      RAISE EXCEPTION 'ISSUE-4134-T T2-c FAIL (%): ops_brand_autolink did not stop the brand: %', v_mode, v_res;
    END IF;

    -- T2-d ops_brand_cards_confirm: 40001 and PT409 are "busy"; anything else
    -- is "failed" with its words.
    v_res := public.ops_brand_cards_confirm(ARRAY['41340000-0000-4000-9000-000000000010']::uuid[],
                                            'issue4134-tester-key-0' || v_n);
    IF v_mode IN ('serialization', 'pt409') THEN
      IF (v_res->>'busy')::integer IS DISTINCT FROM 1 OR v_res#>>'{results,0,status}' IS DISTINCT FROM 'busy' THEN
        RAISE EXCEPTION 'ISSUE-4134-T T2-d FAIL (%): ops_brand_cards_confirm did not report busy: %', v_mode, v_res;
      END IF;
    ELSIF (v_res->>'busy')::integer IS DISTINCT FROM 0 OR v_res#>>'{results,0,status}' IS DISTINCT FROM 'failed'
       OR v_res#>>'{results,0,words}' IS DISTINCT FROM 'Not changed: tester_unrelated_failure' THEN
      RAISE EXCEPTION 'ISSUE-4134-T T2-d FAIL (%): ops_brand_cards_confirm did not report failed: %', v_mode, v_res;
    END IF;
  END LOOP;

  RAISE NOTICE 'ISSUE-4134-T T2 PASS: a genuine 40001 and a PT409 are handled the same way by all four handlers; other errors are unchanged';
END
$t2$;

ROLLBACK;

-------------------------------------------------------------------------------
-- Shared by T3 and T4: a snapshot of every function outside the system
-- schemas. Definitions are read under the search_path the migration itself
-- uses, so an md5 means the same thing here as in the migration.
-------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t4134_def(p_oid oid) RETURNS text
LANGUAGE sql STABLE SET search_path TO pg_catalog, pg_temp
AS $fn$ SELECT pg_get_functiondef(p_oid) $fn$;

CREATE TEMP TABLE t4134_procs (
  oid oid PRIMARY KEY,
  nspname name NOT NULL,
  proc_xmin text NOT NULL,
  def_md5 text NOT NULL,
  proowner oid NOT NULL,
  acl text,
  comment text
);

CREATE FUNCTION pg_temp.t4134_take_snapshot() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  TRUNCATE t4134_procs;
  INSERT INTO t4134_procs
  SELECT p.oid, n.nspname, p.xmin::text, md5(pg_temp.t4134_def(p.oid)), p.proowner, p.proacl::text,
         obj_description(p.oid, 'pg_proc')
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prokind <> 'a';
END;
$fn$;

-- Functions whose definition, owner, grants or comment differ from the
-- snapshot, or that are gone (a new oid counts as gone).
CREATE FUNCTION pg_temp.t4134_drift() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT string_agg(coalesce(p.oid::regprocedure::text, s.oid::text), ', ' ORDER BY 1)
    FROM t4134_procs AS s
    LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = s.oid
   WHERE p.oid IS NULL
      OR md5(pg_temp.t4134_def(p.oid)) IS DISTINCT FROM s.def_md5
      OR p.proowner IS DISTINCT FROM s.proowner
      OR p.proacl::text IS DISTINCT FROM s.acl
      OR obj_description(p.oid, 'pg_proc') IS DISTINCT FROM s.comment
$fn$;

-- Functions whose pg_proc row was written since the snapshot.
CREATE FUNCTION pg_temp.t4134_rewritten() RETURNS TABLE(signature text, nspname name)
LANGUAGE sql STABLE AS $fn$
  SELECT p.oid::regprocedure::text, s.nspname
    FROM t4134_procs AS s
    JOIN pg_catalog.pg_proc AS p ON p.oid = s.oid
   WHERE p.xmin::text <> s.proc_xmin
$fn$;

-------------------------------------------------------------------------------
-- T3: applying the migration again changes nothing. CREATE OR REPLACE writes
-- each target's pg_proc row again, so "nothing" means: every function keeps
-- its oid, definition, owner, grants and comment, and the only rows written
-- are the 77 targets in public/private.
-------------------------------------------------------------------------------
SELECT pg_temp.t4134_take_snapshot();

\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql

DO $t3$
DECLARE
  v_bad text;
  v_count integer;
BEGIN
  v_bad := pg_temp.t4134_drift();
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4134-T T3-1 FAIL: a second run changed or dropped: %', v_bad;
  END IF;
  SELECT count(*), string_agg(r.signature, ', ') FILTER (WHERE r.nspname NOT IN ('public', 'private'))
    INTO v_count, v_bad
    FROM pg_temp.t4134_rewritten() AS r;
  IF v_bad IS NOT NULL OR v_count <> 77 THEN
    RAISE EXCEPTION 'ISSUE-4134-T T3-2 FAIL: a second run wrote % functions (want the 77 targets); outside public/private: %',
      v_count, coalesce(v_bad, '<none>');
  END IF;
  RAISE NOTICE 'ISSUE-4134-T T3 PASS: a second run of the migration left every definition, owner, grant and comment as it was';
END
$t3$;

-------------------------------------------------------------------------------
-- T4: the migration fails closed and rolls back whole.
-------------------------------------------------------------------------------
-- A 40001 raise in a schema the migration does not rewrite.
CREATE SCHEMA issue_4134_tester;
CREATE FUNCTION issue_4134_tester.lingering() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'lingering_conflict' USING ERRCODE = '40001';
END;
$fn$;

-- An event trigger that, only while issue_4134_tester.break is set in this
-- session, changes more than the body of one TARGET function at the moment
-- the migration re-creates it.
CREATE FUNCTION issue_4134_tester.break_target() RETURNS event_trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_mode text := coalesce(current_setting('issue_4134_tester.break', true), '');
  v_cmd record;
  v_def text;
  v_owner text;
BEGIN
  IF v_mode = '' THEN RETURN; END IF;
  FOR v_cmd IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF v_cmd.objid = 'public.ops_request_begin(text,text,text,jsonb)'::regprocedure::oid THEN
      PERFORM set_config('issue_4134_tester.break', '', true);
      CASE v_mode
        WHEN 'acl' THEN
          REVOKE EXECUTE ON FUNCTION public.ops_request_begin(text, text, text, jsonb) FROM service_role;
        WHEN 'comment' THEN
          COMMENT ON FUNCTION public.ops_request_begin(text, text, text, jsonb) IS 'changed during the migration';
        WHEN 'config' THEN
          ALTER FUNCTION public.ops_request_begin(text, text, text, jsonb) SET search_path TO 'public';
        WHEN 'volatility' THEN
          ALTER FUNCTION public.ops_request_begin(text, text, text, jsonb) STABLE;
        WHEN 'owner' THEN
          SELECT CASE WHEN pg_get_userbyid(p.proowner) = 'postgres' THEN 'supabase_admin' ELSE 'postgres' END
            INTO v_owner FROM pg_proc AS p WHERE p.oid = v_cmd.objid;
          EXECUTE format('ALTER FUNCTION public.ops_request_begin(text, text, text, jsonb) OWNER TO %I', v_owner);
        WHEN 'oid' THEN
          v_def := pg_get_functiondef(v_cmd.objid);
          DROP FUNCTION public.ops_request_begin(text, text, text, jsonb);
          EXECUTE v_def;
      END CASE;
    END IF;
  END LOOP;
END;
$fn$;
CREATE EVENT TRIGGER issue_4134_tester_break_target ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION issue_4134_tester.break_target();

-- The target as this branch ships it, to check against and restore from.
CREATE TEMP TABLE t4134_saved AS
SELECT pg_temp.t4134_def('public.ops_request_begin(text,text,text,jsonb)'::regprocedure) AS def;

CREATE FUNCTION pg_temp.t4134_assert_refused(p_case text, p_last_error text, p_want text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_bad text;
BEGIN
  IF p_last_error IS NULL OR p_last_error NOT LIKE p_want THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4 FAIL (%): the migration did not refuse as expected; last error: %',
      p_case, coalesce(p_last_error, '<none>');
  END IF;
  SELECT string_agg(r.signature, ', ') INTO v_bad FROM pg_temp.t4134_rewritten() AS r;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4 FAIL (%): a refused run still wrote: %', p_case, v_bad;
  END IF;
  v_bad := pg_temp.t4134_drift();
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4 FAIL (%): a refused run still changed: %', p_case, v_bad;
  END IF;
  RAISE NOTICE 'ISSUE-4134-T T4 PASS (%): refused and rolled back whole', p_case;
END;
$fn$;

SELECT pg_temp.t4134_take_snapshot();

\echo 'ISSUE-4134-T T4: the next ERROR lines are the migration refusing, as this test expects.'
\set ON_ERROR_STOP off

-- T4-1 a 40001 raise left in a function the migration does not rewrite.
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('lingering 40001', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: still raising or only catching SQLSTATE 40001: issue_4134_tester.lingering()');
DROP FUNCTION issue_4134_tester.lingering();
SELECT pg_temp.t4134_take_snapshot();

-- T4-2..7 drift in a target function while the migration re-creates it.
SELECT set_config('issue_4134_tester.break', 'acl', false);
\set ON_ERROR_STOP off
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('grant', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: rewriting changed more than the body of: %public.ops_request_begin(text,text,text,jsonb)%');

SELECT set_config('issue_4134_tester.break', 'comment', false);
\set ON_ERROR_STOP off
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('comment', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: rewriting changed more than the body of: %public.ops_request_begin(text,text,text,jsonb)%');

SELECT set_config('issue_4134_tester.break', 'config', false);
\set ON_ERROR_STOP off
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('search_path', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: rewriting changed more than the body of: %public.ops_request_begin(text,text,text,jsonb)%');

SELECT set_config('issue_4134_tester.break', 'volatility', false);
\set ON_ERROR_STOP off
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('volatility', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: rewriting changed more than the body of: %public.ops_request_begin(text,text,text,jsonb)%');

SELECT set_config('issue_4134_tester.break', 'owner', false);
\set ON_ERROR_STOP off
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('owner', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: rewriting changed more than the body of: %public.ops_request_begin(text,text,text,jsonb)%');

SELECT set_config('issue_4134_tester.break', 'oid', false);
\set ON_ERROR_STOP off
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('oid', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: rewriting changed more than the body of: %public.ops_request_begin(text,text,text,jsonb)%');
SELECT set_config('issue_4134_tester.break', '', false);

-- T4-8 a target that moved on since the file was generated (a later change)
-- is refused, never overwritten.
DO $t4_moved$
DECLARE v_def text := (SELECT def FROM t4134_saved);
BEGIN
  IF pg_catalog.strpos(v_def, 'Send the same request again.') = 0 THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4-8 FAIL: ops_request_begin no longer has the message this case edits';
  END IF;
  EXECUTE pg_catalog.replace(v_def, 'Send the same request again.', 'Send the same request once more.');
END
$t4_moved$;
SELECT pg_temp.t4134_take_snapshot();
\set ON_ERROR_STOP off
\set LAST_ERROR_MESSAGE ''
\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql
SELECT set_config('issue_4134_tester.last_error', :'LAST_ERROR_MESSAGE', false);
\set ON_ERROR_STOP on
SELECT pg_temp.t4134_assert_refused('moved on', current_setting('issue_4134_tester.last_error'),
  'issue_4134_verify: not the definition this migration was generated from: public.ops_request_begin(text,text,text,jsonb)');
DO $t4_moved_kept$
BEGIN
  IF pg_catalog.strpos(pg_temp.t4134_def('public.ops_request_begin(text,text,text,jsonb)'::regprocedure),
                       'Send the same request once more.') = 0 THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4-8 FAIL: the refused run overwrote the later change';
  END IF;
  RAISE NOTICE 'ISSUE-4134-T T4-8 PASS: a target that moved on is refused and kept as it was';
END
$t4_moved_kept$;

-- T4-9 a target reverted to its pre-migration 40001 definition: a clean run
-- puts it back exactly as generated and writes the 77 targets and nothing
-- else.
DO $t4_revert$
DECLARE
  v_def text := (SELECT def FROM t4134_saved);
  v_from constant text := 'USING ERRCODE = ''PT409''';
BEGIN
  IF (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_from, '')))
     / pg_catalog.length(v_from) <> 1 THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4-9 FAIL: ops_request_begin no longer has exactly one PT409 raise';
  END IF;
  EXECUTE pg_catalog.replace(v_def, v_from, 'USING ERRCODE = ''40001''');
END
$t4_revert$;
SELECT pg_temp.t4134_take_snapshot();

\ir ../20271231204134_issue_4134_pt409_application_conflicts.sql

DO $t4_clean$
DECLARE
  v_bad text;
  v_count integer;
BEGIN
  v_bad := pg_temp.t4134_drift();
  IF v_bad IS DISTINCT FROM 'public.ops_request_begin(text,text,text,jsonb)'::regprocedure::text THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4-9 FAIL: the clean run should change only the reverted target; it changed: %',
      coalesce(v_bad, '<nothing>');
  END IF;
  IF pg_temp.t4134_def('public.ops_request_begin(text,text,text,jsonb)'::regprocedure)
     IS DISTINCT FROM (SELECT def FROM t4134_saved) THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4-9 FAIL: the reverted target did not come back exactly as generated';
  END IF;
  SELECT count(*), string_agg(r.signature, ', ') FILTER (WHERE r.nspname NOT IN ('public', 'private'))
    INTO v_count, v_bad
    FROM pg_temp.t4134_rewritten() AS r;
  IF v_bad IS NOT NULL OR v_count <> 77 THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4-9 FAIL: the clean run wrote % functions (want the 77 targets); outside public/private: %',
      v_count, coalesce(v_bad, '<none>');
  END IF;
  RAISE NOTICE 'ISSUE-4134-T T4-9 PASS: a clean run restored the reverted target exactly and wrote only the 77 targets';
END
$t4_clean$;

-- Clean up everything T4 created, then prove the catalogue is clean again.
DROP EVENT TRIGGER issue_4134_tester_break_target;
DROP SCHEMA issue_4134_tester CASCADE;
DROP TABLE t4134_procs;
DROP TABLE t4134_saved;

DO $t4_after$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND (p.prosrc ~* 'errcode\s*:?=\s*''(40001|serialization_failure)'''
          OR p.prosrc ~* 'raise\s+(exception\s+)?sqlstate\s+''40001'''
          OR p.prosrc ~* 'raise\s+(exception\s+)?serialization_failure\M'
          OR p.prosrc ~* '(when|or)\s+(serialization_failure|sqlstate\s+''40001'')(?!\s+or\s+sqlstate\s+''PT409'')'
          OR p.proname LIKE 'issue\_4134\_tester%');
  IF v_bad IS NOT NULL OR to_regnamespace('issue_4134_tester') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'issue_4134_tester_break_target') THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4 FAIL: cleanup left a 40001 raise or a tester object behind: %', v_bad;
  END IF;
  IF (SELECT pg_get_userbyid(proowner) || ' ' || coalesce(proacl::text, '')
        FROM pg_proc WHERE oid = 'public.ops_request_begin(text,text,text,jsonb)'::regprocedure)
     NOT LIKE '%service_role=X%' THEN
    RAISE EXCEPTION 'ISSUE-4134-T T4 FAIL: ops_request_begin lost its service_role grant';
  END IF;
  RAISE NOTICE 'ISSUE-4134-T PASS: stale stays stale, genuine 40001 handled as before, idempotent, fails closed';
END
$t4_after$;
