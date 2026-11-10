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
-- Targets a later migration has superseded. On the full chain, #3682
-- (20280401033682_issue_3682_account_invite_recipients.sql) re-defines two of
-- the 77 targets, so a replay of this file correctly refuses them as "moved
-- on" (that refusal is T4-8). T3 and T4 prove the replay contract against the
-- definitions this file generates, so the two are put back here, verbatim from
-- section B of the migration, and the later definitions are restored and
-- md5-checked once T4 is done. A target superseded by a further migration is
-- added to this list the same way. #4270 W1
-- (20280427004270_issue_4270_w1_work_board_three_columns.sql) re-defines
-- ops_work_add and ops_work_update (the Send, Spend or Publish tag), so they
-- are put back and restored the same way. #4270 W3
-- (20280427024270_issue_4270_w3_brand_plan.sql) re-defines
-- content_calendar_update (a post's brand, collaborator and plan link), so it
-- is put back and restored the same way. #3645
-- (20280422003645_issue_3645_unpaid_release_holds.sql) re-defines
-- issue_1389_record_stay_dispute (a dispute on an unpaid stay payout becomes
-- an append-only hold), so it is put back and restored the same way. #4255
-- (20280605004255_issue_4255_content_calendar_approved_designed.sql)
-- re-defines content_calendar_move (Designed needs a Drive link, Approved
-- records the go), so it is put back and restored the same way.
-------------------------------------------------------------------------------
CREATE TEMP TABLE t4134_superseded AS
SELECT p.oid, pg_temp.t4134_def(p.oid) AS def, md5(pg_temp.t4134_def(p.oid)) AS def_md5
  FROM pg_catalog.pg_proc AS p
 WHERE p.oid IN ('private.enqueue_wizard_invites_on_publish_v1(uuid,bigint,boolean)'::regprocedure,
                 'public.biz_replace_offering_invite_plan_v1(uuid,jsonb,bigint,uuid)'::regprocedure,
                 'public.ops_work_add(jsonb,text)'::regprocedure,
                 'public.ops_work_update(uuid,jsonb,bigint,text)'::regprocedure,
                 'public.content_calendar_update(uuid,jsonb,bigint,text)'::regprocedure,
                 'public.issue_1389_record_stay_dispute(text,text,text,text,integer,text,text)'::regprocedure,
                 'public.content_calendar_move(uuid,text,bigint,boolean,boolean,boolean,text)'::regprocedure);

BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;
CREATE OR REPLACE FUNCTION private.enqueue_wizard_invites_on_publish_v1(p_event_id uuid, p_expected_revision bigint, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_selection_id uuid; v_outbox_id uuid; v_outbox_state text;
  v_selected_count integer; v_ids uuid[];
BEGIN
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans
    WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',false,'selectedCount',0,'status','not_requested'));
  END IF;
  SELECT COALESCE(array_agg(m.brand_person_id ORDER BY m.brand_person_id),'{}'::uuid[])
    INTO v_ids
  FROM private.brand_offering_invite_plan_members m
  WHERE m.plan_id=v_plan.id;
  v_selected_count:=cardinality(v_ids);
  IF v_plan.state='locked' THEN
    SELECT o.id,o.state INTO v_outbox_id,v_outbox_state
    FROM private.brand_offering_invite_selections s
    LEFT JOIN private.brand_offering_invite_outbox o ON o.plan_id=v_plan.id
      AND o.selection_revision=s.selection_revision
    WHERE s.event_id=p_event_id AND s.selection_revision=v_plan.published_selection_revision;
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',v_selected_count>0,
      'selectedCount',v_selected_count,
      'selectionRevision',v_plan.published_selection_revision,
      'outboxJobId',v_outbox_id,'status',COALESCE(v_outbox_state,'empty')));
  END IF;
  IF v_selected_count=0 THEN
    UPDATE private.brand_offering_invite_plans SET
      state='locked',published_selection_revision=selection_revision,locked_at=now(),updated_at=now()
    WHERE event_id=p_event_id;
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',false,'selectedCount',0,'selectionRevision',v_plan.selection_revision,'status','empty'));
  END IF;
  IF NOT COALESCE(p_confirmed,false) OR p_expected_revision IS NULL
     OR p_expected_revision<>v_plan.selection_revision THEN
    RAISE EXCEPTION 'wizard_invite_publish_confirmation_required' USING ERRCODE='PT409';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_ids) pid
    LEFT JOIN public.brand_people bp ON bp.id=pid AND bp.brand_id=v_plan.brand_id AND bp.record_status='active'
    WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE='PT409';
  END IF;
  INSERT INTO private.brand_offering_invite_selections(
    event_id,brand_id,event_type,selection_revision,brand_person_ids,selection_hash,actor_id)
  VALUES(p_event_id,v_plan.brand_id,v_plan.event_type,v_plan.selection_revision,
    v_ids,v_plan.selection_hash,v_plan.updated_by)
  ON CONFLICT(event_id,selection_revision) DO UPDATE SET event_id=EXCLUDED.event_id
  RETURNING id INTO v_selection_id;
  INSERT INTO private.brand_offering_invite_outbox(
    plan_id,brand_id,event_id,event_type,selection_revision,operation_key,sealed_selection_id)
  VALUES(v_plan.id,v_plan.brand_id,p_event_id,v_plan.event_type,v_plan.selection_revision,
    'wizard:v1:'||v_plan.event_type||':'||p_event_id::text||':'||v_plan.selection_revision::text,
    v_selection_id)
  ON CONFLICT(event_id,selection_revision) DO UPDATE
    SET operation_key=EXCLUDED.operation_key
  RETURNING id,state INTO v_outbox_id,v_outbox_state;
  INSERT INTO private.brand_offering_invite_observability_events(
    event_name,outbox_job_id,offering_kind,selection_revision,selected_count,job_state)
  VALUES('wizard_invite_outbox_enqueued',v_outbox_id,v_plan.event_type,
    v_plan.selection_revision,v_selected_count,v_outbox_state)
  ON CONFLICT(outbox_job_id) DO NOTHING;
  UPDATE private.brand_offering_invite_plans SET
    state='locked',published_selection_revision=selection_revision,locked_at=now(),updated_at=now()
  WHERE event_id=p_event_id;
  RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
    'planned',true,'selectedCount',v_selected_count,
    'selectionRevision',v_plan.selection_revision,'outboxJobId',v_outbox_id,'status',v_outbox_state));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_replace_offering_invite_plan_v1(p_event_id uuid, p_selection jsonb, p_expected_revision bigint, p_client_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_scope record; v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_plan_id uuid;
  v_ids uuid[] := '{}'; v_explicit uuid[] := '{}'; v_excluded uuid[] := '{}';
  v_groups uuid[] := '{}'; v_everyone boolean; v_followers boolean; v_friends boolean;
  v_request_hash text; v_legacy_hash text;
  v_prior private.brand_offering_invite_mutation_receipts%ROWTYPE; v_result jsonb;
  v_rings text[] := '{}'; v_keys text[]; v_flags boolean;
  v_raw_selection jsonb; v_legacy_shape boolean := false;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id, v_actor);
  IF p_client_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR jsonb_typeof(p_selection) <> 'object' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  v_raw_selection := p_selection;
  v_keys := ARRAY(SELECT jsonb_object_keys(p_selection) ORDER BY 1);
  IF v_keys = ARRAY[
       'excludedPersonIds', 'includeEveryone', 'manualGroupIds', 'personIds'
     ]::text[] THEN
    v_legacy_shape := true;
    p_selection := p_selection || jsonb_build_object(
      'includeFollowers', false,
      'includeFriendsOfFollowers', false);
  ELSIF v_keys <> ARRAY[
       'excludedPersonIds',
       'includeEveryone',
       'includeFollowers',
       'includeFriendsOfFollowers',
       'manualGroupIds',
       'personIds'
     ]::text[] THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_selection -> 'manualGroupIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'personIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'excludedPersonIds') <> 'array'
     OR jsonb_typeof(p_selection -> 'includeEveryone') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFollowers') <> 'boolean'
     OR jsonb_typeof(p_selection -> 'includeFriendsOfFollowers') <> 'boolean' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_explicit
      FROM jsonb_array_elements_text(p_selection -> 'personIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_groups
      FROM jsonb_array_elements_text(p_selection -> 'manualGroupIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid), '{}') INTO v_excluded
      FROM jsonb_array_elements_text(p_selection -> 'excludedPersonIds') x;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE = '22023';
  END;
  v_everyone := (p_selection ->> 'includeEveryone')::boolean;
  v_followers := (p_selection ->> 'includeFollowers')::boolean;
  v_friends := (p_selection ->> 'includeFriendsOfFollowers')::boolean;
  IF v_followers THEN
    v_rings := array_append(v_rings, 'follower');
  END IF;
  IF v_friends THEN
    v_rings := array_append(v_rings, 'extended');
  END IF;
  v_request_hash := encode(extensions.digest(convert_to(
    jsonb_build_object('expectedRevision', p_expected_revision, 'selection', p_selection)::text, 'UTF8'), 'sha256'), 'hex');
  IF v_legacy_shape THEN
    v_legacy_hash := encode(extensions.digest(convert_to(
      jsonb_build_object('expectedRevision', p_expected_revision, 'selection', v_raw_selection)::text, 'UTF8'), 'sha256'), 'hex');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 1780));
  SELECT * INTO v_prior FROM private.brand_offering_invite_mutation_receipts
    WHERE event_id = p_event_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_prior.actor_id = v_actor AND (
         v_prior.request_hash = v_request_hash
         OR (v_legacy_shape AND v_prior.request_hash = v_legacy_hash)
       ) THEN
      RETURN v_prior.response_json || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'wizard_invite_idempotency_conflict' USING ERRCODE = '23505';
  END IF;
  IF v_scope.event_deleted OR v_scope.event_status <> 'draft' OR v_scope.event_visibility <> 'draft' THEN
    RAISE EXCEPTION 'wizard_invite_offering_not_draft' USING ERRCODE = '55000';
  END IF;
  IF NOT COALESCE((SELECT is_enabled FROM public.feature_flags
      WHERE flag_key = 'business_wizard_invite_selection_v1'), false) THEN
    RAISE EXCEPTION 'wizard_invite_feature_disabled' USING ERRCODE = '55000';
  END IF;
  IF v_followers THEN
    SELECT count(*) = 1 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags WHERE flag_key = 'brand_circle_followers_v1';
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_friends THEN
    SELECT count(*) = 3 AND bool_and(is_enabled) INTO v_flags
      FROM public.feature_flags
     WHERE flag_key IN (
       'brand_circle_extended_v1',
       'brand_circle_extended_controls_ios_v1',
       'brand_circle_extended_controls_android_v1');
    IF NOT COALESCE(v_flags, false) THEN
      RAISE EXCEPTION 'wizard_invite_circle_unavailable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_groups) gid LEFT JOIN public.marketing_audiences a
      ON a.id = gid AND a.brand_id = v_scope.brand_id AND a.deleted_at IS NULL
      AND NOT a.is_system_generated AND a.query_definition = '{"kind":"manual_group"}'::jsonb
      WHERE a.id IS NULL)
     OR EXISTS(SELECT 1 FROM unnest(v_explicit || v_excluded) pid LEFT JOIN public.brand_people bp
      ON bp.id = pid AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active' WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_ids FROM (
    SELECT bp.id FROM public.brand_people bp
      WHERE v_everyone AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM unnest(v_explicit) requested(id)
      JOIN public.brand_people bp ON bp.id = requested.id AND bp.brand_id = v_scope.brand_id AND bp.record_status = 'active'
    UNION
    SELECT bp.id FROM public.marketing_manual_group_memberships gm
      JOIN public.brand_people bp ON bp.id = gm.brand_person_id AND bp.brand_id = gm.brand_id AND bp.record_status = 'active'
      WHERE gm.audience_id = ANY (v_groups) AND gm.brand_id = v_scope.brand_id AND gm.state = 'active'
    UNION
    SELECT person_id FROM private.issue_3682_circle_invite_person_ids(v_scope.brand_id, v_rings) person_id
  ) selected WHERE NOT (id = ANY (v_excluded));
  IF cardinality(v_ids) > 500 THEN RAISE EXCEPTION 'wizard_invite_selection_too_large' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans WHERE event_id = p_event_id FOR UPDATE;
  IF FOUND AND v_plan.state = 'locked' THEN RAISE EXCEPTION 'wizard_invite_plan_locked' USING ERRCODE = '55000'; END IF;
  IF COALESCE(v_plan.selection_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'wizard_invite_revision_conflict' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('currentRevision', COALESCE(v_plan.selection_revision, 0))::text;
  END IF;
  INSERT INTO private.brand_offering_invite_plans(
    event_id, brand_id, event_type, selection_revision, selection_hash, created_by, updated_by)
  VALUES (p_event_id, v_scope.brand_id, v_scope.event_type, p_expected_revision + 1,
    private.issue_1780_selection_hash(v_ids), v_actor, v_actor)
  ON CONFLICT (event_id) DO UPDATE SET
    selection_revision = EXCLUDED.selection_revision,
    selection_hash = EXCLUDED.selection_hash, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING id INTO v_plan_id;
  DELETE FROM private.brand_offering_invite_plan_members
  WHERE plan_id = v_plan_id;
  INSERT INTO private.brand_offering_invite_plan_members(
    plan_id, brand_person_id, added_by)
  SELECT v_plan_id, id, v_actor FROM unnest(v_ids) selected(id);
  v_result := private.issue_1780_plan_response(p_event_id) || jsonb_build_object('replayed', false);
  INSERT INTO private.brand_offering_invite_mutation_receipts(event_id, client_request_id, actor_id, request_hash, response_json)
    VALUES (p_event_id, p_client_request_id, v_actor, v_request_hash, v_result);
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_work_add(p_items jsonb, p_request_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; v_today date := public.ops_today(NULL); v_replay jsonb; v_item jsonb; v_idx integer := 0; v_rows jsonb := '[]'::jsonb;
  v_chk jsonb; cl jsonb; c public.ops_work_cards; v_event uuid; v_gate jsonb; v_added integer := 0; v_refused integer := 0;
  v_dups integer := 0; v_out jsonb; v_fields text; v_owners text[]; v_watchers text[]; v_ex_id uuid; v_ex_number bigint; v_ex_title text; v_who text;
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,80}$' THEN
    RAISE EXCEPTION 'request_key_required: Send a request key of 8 to 80 letters, digits, - or _, new for a new request and unchanged for a repeat.' USING ERRCODE = '22023';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_cards: Send a list of 1 to 50 cards.' USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key || '-add', 'add', p_items);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  v_who := public.ops_actor_label(v.actor_email, v.via);

  FOR v_item IN SELECT e.value FROM jsonb_array_elements(p_items) WITH ORDINALITY e(value, ord) ORDER BY e.ord LOOP
    v_chk := public.ops_validate_card(v_item, 'add', v.actor_email, v_today);
    IF jsonb_array_length(v_chk->'fixes') > 0 THEN
      SELECT string_agg(DISTINCT public.ops_field_words(f->>'field'), ', ') INTO v_fields FROM jsonb_array_elements(v_chk->'fixes') f;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'refused', 'fixes', v_chk->'fixes',
        'title', v_chk->'clean'->'title'));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', NULL, NULL, NULL,
        format('Card not added (%s): %s to fix.', COALESCE(v_chk->'clean'->>'title', 'no title'), v_fields),
        jsonb_build_object('fields', (SELECT jsonb_agg(DISTINCT f->>'field') FROM jsonb_array_elements(v_chk->'fixes') f)));
      v_refused := v_refused + 1;
    ELSIF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' THEN
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate', 'existing', v_chk->'duplicate',
        'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
      PERFORM public.ops_log_write(v.actor_email, v.via, 'card_refused', 'stopped', (v_chk->'duplicate'->>'id')::uuid, 'work_card', (v_chk->'duplicate'->>'id')::uuid,
        format('Card not added: it repeats Card %s.', v_chk->'duplicate'->>'number'), '{}'::jsonb);
      v_dups := v_dups + 1;
    ELSE
      cl := v_chk->'clean';
      v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
      v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
      v_gate := CASE WHEN cl->>'kind' = 'promo' THEN public.ops_promo_gate(cl->'anchor', v_today) END;
      BEGIN
        INSERT INTO public.ops_work_cards (title, instructions, done_means, status, blocked, blocked_kind, blocked_reason, person_reason,
          kind, kit_step, anchor_kind, anchor_id, due_on, due_source, sprint_id, plan, created_by, created_via, updated_by, updated_via, request_key)
        VALUES (cl->>'title', cl->>'instructions', cl->>'done_means',
          CASE WHEN cl->>'person_reason' IS NOT NULL THEN 'person' ELSE 'todo' END,
          COALESCE((v_gate->>'blocked')::boolean, false),
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'kind' END,
          CASE WHEN COALESCE((v_gate->>'blocked')::boolean, false) THEN v_gate->>'reason' END,
          cl->>'person_reason', cl->>'kind', (cl->>'kit_step')::integer, cl->>'anchor_kind', (cl->>'anchor_id')::uuid,
          (cl->>'due_on')::date, cl->>'due_source', public.ops_sprint_for((cl->>'due_on')::date, v_today), cl->'plan',
          v.actor_email, v.via, v.actor_email, v.via, p_request_key || '-i' || v_idx)
        RETURNING * INTO c;
        PERFORM public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
        PERFORM public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
        v_event := public.ops_card_event(c.id, v.actor_email, v.via, 'added', NULL, NULL, public.ops_card_snapshot(c.id), NULL, c.revision);
        IF public.ops_github_set(c.id, cl->'github', v.actor_email, v.via) THEN
          PERFORM public.ops_card_event(c.id, v.actor_email, v.via, 'github',
            'GitHub: ' || (SELECT string_agg('#' || (g->>'number'), ', ') FROM jsonb_array_elements(cl->'github') g), NULL, NULL, c.revision, c.revision);
        END IF;
        PERFORM public.ops_notify_people(c.id, v_event, v_owners, v.actor_email, format('%s added you as owner: %s', v_who, c.title));
        PERFORM public.ops_notify_people(c.id, v_event, v_watchers, v.actor_email, format('%s added you as watcher: %s', v_who, c.title));
        PERFORM public.ops_log_write(v.actor_email, v.via, 'card_added', 'ok', c.id, 'work_card', c.id,
          format('Added Card %s: %s', c.number, c.title), jsonb_build_object('owners', cardinality(v_owners), 'watchers', cardinality(v_watchers)));
        IF c.status = 'person' THEN
          PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
            format('Card %s needs a person: %s', c.number, c.title), jsonb_build_object('reason', c.person_reason));
        END IF;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'added', 'card', public.ops_card_json(c, v_today)));
        v_added := v_added + 1;
      EXCEPTION WHEN unique_violation THEN
        SELECT w.id, w.number, w.title INTO v_ex_id, v_ex_number, v_ex_title FROM public.ops_work_cards w
         WHERE w.archived_at IS NULL AND ((w.title_key = public.crm_name_key(cl->>'title') AND w.status <> 'done')
            OR (w.anchor_kind = cl->>'anchor_kind' AND w.anchor_id = (cl->>'anchor_id')::uuid AND w.kit_step = (cl->>'kit_step')::integer))
         LIMIT 1;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('index', v_idx, 'status', 'duplicate',
          'existing', jsonb_build_object('id', v_ex_id, 'number', v_ex_number, 'title', v_ex_title),
          'message', format('An open card already does this: "%s" (Card %s). Update that card instead.', v_ex_title, v_ex_number)));
        v_dups := v_dups + 1;
      END;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;
  v_out := jsonb_build_object('results', v_rows, 'added', v_added, 'refused', v_refused, 'duplicate', v_dups, 'replayed', false);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key || '-add', 'add', v_out);
  RETURN v_out;
EXCEPTION WHEN others THEN
  IF SQLERRM ~ '^[a-z_]+: ' THEN RAISE; END IF;
  RAISE WARNING 'ops_work_add: request stopped (% %)', SQLSTATE, SQLERRM;
  RAISE EXCEPTION 'try_again: Something went wrong on our side, so nothing in this request was added. Send the same request again.' USING ERRCODE = 'PT409';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.ops_work_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  v record; c public.ops_work_cards; n public.ops_work_cards; v_today date := public.ops_today(NULL); v_replay jsonb; v_bad text;
  v_before jsonb; v_item jsonb; v_chk jsonb; cl jsonb; v_fixes jsonb; v_people jsonb; v_links_changed boolean := false;
  v_cats text[] := ARRAY[]::text[]; v_action text; v_event uuid; v_out jsonb; v_gate jsonb; v_week date; v_who text;
  v_status text; v_reason text; v_result text; v_breason text; v_owners text[]; v_watchers text[]; v_anchor_changed boolean := false;
  v_back boolean := false; v_back_reason text; -- Wave 2: leaving Needs a person
  v_removed_words text; -- #3980 rework 2: who was taken off, for the agent log
  v_gh_changed boolean := false; v_chat text;
  v_gh_list text; v_gh_wait boolean := false; -- #3980 synced, Wave 2: waiting for GitHub
  v_gh_cur text; -- #3980 W2 rework: the links a waiting card has now
BEGIN
  SELECT * INTO v FROM public.crm_ctx();
  v_chat := CASE WHEN v.via IS NOT NULL THEN public.ops_ctx_chat() END;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one field to change.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_changes) k
   WHERE k NOT IN ('title','instructions','done_means','due_on','week','owners','watchers','links','anchor','plan','result',
                   'blocked','blocked_reason','status','person_reason','reason','github','blocked_on_github') ORDER BY k LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: A card change does not take "%s".', left(v_bad, 60)) USING ERRCODE = '22023';
  END IF;
  v_replay := public.ops_request_begin(v.actor_email, p_request_key, 'update',
    jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  c := public.ops_card_lock(p_id, p_expected_revision);
  IF c.status = 'done' THEN RAISE EXCEPTION 'card_closed: Reopen this card before changing it.' USING ERRCODE = '22023'; END IF;
  PERFORM public.ops_agent_owns(c, v.actor_email, v.via);
  PERFORM public.ops_claim_assert('work_card', c.id, v.actor_email, v.via);
  v_before := public.ops_card_snapshot(c.id);
  v_who := public.ops_actor_label(v.actor_email, v.via);
  v_anchor_changed := p_changes ? 'anchor' AND (p_changes->'anchor' IS DISTINCT FROM
    CASE WHEN c.anchor_id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) END);

  v_item := jsonb_build_object('id', c.id,
    'title', COALESCE(p_changes->'title', to_jsonb(c.title)),
    'instructions', COALESCE(p_changes->'instructions', to_jsonb(c.instructions)),
    'done_means', COALESCE(p_changes->'done_means', to_jsonb(c.done_means)),
    'owners', CASE WHEN p_changes ? 'owners' THEN p_changes->'owners' ELSE to_jsonb(public.ops_card_people(c.id, 'owner')) END,
    'watchers', CASE WHEN p_changes ? 'watchers' THEN p_changes->'watchers' ELSE to_jsonb(public.ops_card_people(c.id, 'watcher')) END,
    'links', CASE WHEN p_changes ? 'links' THEN p_changes->'links'
                  ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', l.kind, 'id', l.target_id)) FROM public.ops_work_links l WHERE l.card_id = c.id), '[]'::jsonb) END,
    'anchor', CASE WHEN p_changes ? 'anchor' THEN p_changes->'anchor'
                   WHEN c.anchor_id IS NOT NULL THEN jsonb_build_object('kind', c.anchor_kind, 'id', c.anchor_id) ELSE 'null'::jsonb END,
    'kit_step', to_jsonb(c.kit_step), 'kind', to_jsonb(c.kind),
    'person_reason', CASE WHEN p_changes ? 'person_reason' THEN p_changes->'person_reason' ELSE to_jsonb(c.person_reason) END,
    'plan', CASE WHEN p_changes ? 'plan' THEN p_changes->'plan' ELSE c.plan END,
    'github', CASE WHEN p_changes ? 'github' THEN p_changes->'github'
                   ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', g.kind, 'number', g.number) ORDER BY g.number)
                                    FROM public.ops_work_github g WHERE g.card_id = c.id), '[]'::jsonb) END,
    'due_on', CASE WHEN p_changes ? 'due_on' THEN p_changes->'due_on'
                   WHEN v_anchor_changed AND c.due_source <> 'explicit' THEN 'null'::jsonb ELSE to_jsonb(c.due_on) END,
    '_due_source', CASE WHEN p_changes ? 'due_on' THEN 'explicit' ELSE c.due_source END);
  IF p_changes ? 'links' AND NOT (p_changes ? 'anchor') AND c.anchor_id IS NOT NULL
     AND jsonb_typeof(p_changes->'links') = 'array'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'links') l WHERE l->>'kind' = c.anchor_kind AND lower(l->>'id') = c.anchor_id::text)
     AND c.kind = 'task' AND c.kit_step IS NULL THEN
    -- removing the anchor's link frees the card from its event
    v_item := jsonb_set(v_item, '{anchor}', 'null'::jsonb);
    IF c.due_source <> 'explicit' THEN v_item := jsonb_set(v_item, '{due_on}', to_jsonb(c.due_on)); v_item := jsonb_set(v_item, '{_due_source}', '"explicit"'); END IF;
    v_anchor_changed := true;
  END IF;
  v_chk := public.ops_validate_card(v_item, 'update', v.actor_email, v_today);
  v_fixes := v_chk->'fixes';
  IF v_chk->'duplicate' IS NOT NULL AND jsonb_typeof(v_chk->'duplicate') = 'object' AND p_changes ? 'title' THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'title', 'message',
      format('An open card already does this: "%s" (Card %s). Update that card instead.', v_chk->'duplicate'->>'title', v_chk->'duplicate'->>'number')));
  END IF;
  cl := v_chk->'clean';

  -- status, needs a person, blocked, result, week
  v_status := c.status; v_reason := c.person_reason;
  IF p_changes ? 'status' THEN
    IF jsonb_typeof(p_changes->'status') <> 'string' OR p_changes->>'status' NOT IN ('todo','doing','person') THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'status', 'message', 'Status can be todo, doing or person. Close a card with proof, or push it back.'));
    ELSE v_status := p_changes->>'status'; END IF;
  END IF;
  IF p_changes ? 'person_reason' THEN v_reason := cl->>'person_reason'; END IF;
  IF v_status = 'person' AND v_reason IS NULL THEN
    v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'person_reason', 'message', 'Needs a person must say why: send, spend, publish or other.'));
  END IF;
  IF v_status <> 'person' THEN v_reason := NULL; END IF;
  -- Wave 2: an agent moving a card that needs a person back to To do or
  -- Doing must say why; the log records it and owners and watchers are told.
  v_back := c.status = 'person' AND v_status <> 'person';
  IF v_back THEN
    v_back_reason := CASE WHEN jsonb_typeof(p_changes->'reason') = 'string' THEN left(public.ops_one_line(p_changes->>'reason'), 500) END;
    IF public.ops_has_control(v_back_reason) THEN v_back_reason := NULL; END IF;
    IF v.via IS NOT NULL AND v_back_reason IS NULL THEN
      RAISE EXCEPTION 'reason_required: Say why this card no longer needs a person. Your person and the card''s watchers are told.' USING ERRCODE = '22023';
    END IF;
  END IF;
  -- #3980 W2 rework 3: an agent never moves a roadmap approval card or
  -- changes what it waits for, so it cannot send it back and then close it.
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (v_status IS DISTINCT FROM c.status OR (p_changes ? 'person_reason' AND cl->>'person_reason' IS DISTINCT FROM c.person_reason)) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person moves this card.' USING ERRCODE = '42501';
  END IF;
  n := c;
  -- Wave 2: the GitHub issues and pull requests the card waits for.
  SELECT string_agg('#' || (x->>'number'), ', ' ORDER BY (x->>'number')::integer) INTO v_gh_list
    FROM jsonb_array_elements(COALESCE(cl->'github', '[]'::jsonb)) x;
  SELECT string_agg('#' || g.number, ', ' ORDER BY g.number) INTO v_gh_cur FROM public.ops_work_github g WHERE g.card_id = c.id;
  -- #3980 W2 rework: an agent cannot change what a waiting card waits for
  -- (adding, removing or swapping a link would let it lift the wait); a
  -- person can, and the agent log says who did.
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL AND p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_cur, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF c.blocked_kind = 'github' AND v.via IS NOT NULL
     AND ((p_changes ? 'blocked_on_github' AND jsonb_typeof(p_changes->'blocked_on_github') = 'boolean' AND NOT (p_changes->>'blocked_on_github')::boolean)
          OR (NOT (p_changes ? 'blocked_on_github') AND p_changes ? 'blocked')) THEN
    RAISE EXCEPTION '%', format('gate_blocked: This card waits for %s to be Live on Mingla.', COALESCE(v_gh_list, 'its GitHub issue'))
      USING ERRCODE = '42501';
  END IF;
  IF p_changes ? 'blocked_on_github' THEN
    v_gh_wait := true;
    IF jsonb_typeof(p_changes->'blocked_on_github') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_on_github', 'message', 'Blocked until Live must be true or false.'));
    ELSIF (p_changes->>'blocked_on_github')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      IF v_gh_list IS NULL THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'Link a GitHub issue or pull request first; the card then waits for it to be Live.'));
      ELSE n.blocked := true; n.blocked_kind := 'github'; n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
    ELSIF c.blocked_kind = 'github' THEN
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked' THEN
    IF jsonb_typeof(p_changes->'blocked') <> 'boolean' THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked', 'message', 'Blocked must be true or false.'));
    ELSIF (p_changes->>'blocked')::boolean THEN
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      v_breason := public.ops_one_line(p_changes->>'blocked_reason');
      IF v_breason IS NULL OR char_length(v_breason) NOT BETWEEN 5 AND 300 THEN
        v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.'));
      ELSE n.blocked := true; n.blocked_kind := 'manual'; n.blocked_reason := v_breason; END IF;
    ELSE
      IF c.blocked_kind IN ('waiting_go_live', 'organic_only') THEN
        RAISE EXCEPTION 'gate_blocked: This card waits for the event to be public with at least 21 days left. The owner or an admin can override it with a reason.' USING ERRCODE = '42501';
      END IF;
      n.blocked := false; n.blocked_kind := NULL; n.blocked_reason := NULL;
    END IF;
  ELSIF p_changes ? 'blocked_reason' THEN
    v_breason := public.ops_one_line(p_changes->>'blocked_reason');
    IF c.blocked_kind = 'manual' AND v_breason IS NOT NULL AND char_length(v_breason) BETWEEN 5 AND 300 THEN n.blocked_reason := v_breason;
    ELSE v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'blocked_reason', 'message', 'Say what blocks this card in 5 to 300 characters.')); END IF;
  END IF;
  -- Wave 2: a card waiting for GitHub keeps its reason in step with its links.
  IF NOT v_gh_wait AND n.blocked_kind = 'github' AND p_changes ? 'github' THEN
    IF v_gh_list IS NULL THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'github', 'message', 'A card waiting for GitHub keeps at least one GitHub link. Lift the wait first.'));
    ELSE n.blocked_reason := format('Waiting for %s to be Live.', v_gh_list); END IF;
  END IF;
  IF p_changes ? 'result' THEN
    v_result := CASE WHEN jsonb_typeof(p_changes->'result') = 'string' THEN public.ops_multi_line(p_changes->>'result') END;
    IF char_length(COALESCE(v_result, '')) > 2000 OR public.ops_has_control(v_result) THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'result', 'message', 'Keep the result to 2,000 characters.'));
    ELSE n.result := v_result; END IF;
  END IF;
  IF p_changes ? 'week' AND jsonb_typeof(p_changes->'week') <> 'null' THEN
    BEGIN
      v_week := public.ops_monday((p_changes->>'week')::date);
      IF v_week NOT BETWEEN v_today - 730 AND v_today + 730 THEN RAISE EXCEPTION 'bad' USING ERRCODE = '22007'; END IF;
    EXCEPTION WHEN others THEN
      v_fixes := v_fixes || jsonb_build_array(jsonb_build_object('field', 'week', 'message', 'Sprint must be a real week within two years.'));
      v_week := NULL;
    END;
  END IF;
  IF jsonb_array_length(v_fixes) > 0 THEN
    RAISE EXCEPTION '%', 'invalid_card: ' || (SELECT string_agg(f->>'message', ' ') FROM jsonb_array_elements(v_fixes) f)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('fixes', v_fixes)::text;
  END IF;

  n.title := cl->>'title'; n.instructions := cl->>'instructions'; n.done_means := cl->>'done_means';
  n.anchor_kind := cl->>'anchor_kind'; n.anchor_id := (cl->>'anchor_id')::uuid;
  n.due_on := (cl->>'due_on')::date; n.due_source := cl->>'due_source'; n.plan := cl->'plan';
  n.status := v_status; n.person_reason := v_reason;
  IF v_status = 'doing' AND c.status <> 'doing' THEN n.started_at := COALESCE(c.started_at, clock_timestamp()); n.working_by := v.actor_email; n.working_via := v.via; END IF;
  -- Back to To do: nobody is working on it any more, so the mark ends.
  IF v_status = 'todo' AND c.status = 'doing' THEN n.working_by := NULL; n.working_via := NULL; END IF;
  n.sprint_id := CASE WHEN v_week IS NOT NULL THEN public.ops_sprint_ensure(v_week) ELSE c.sprint_id END;
  IF c.kind = 'promo' AND v_anchor_changed AND c.override_at IS NULL THEN
    v_gate := public.ops_promo_gate(cl->'anchor', v_today);
    n.blocked := (v_gate->>'blocked')::boolean;
    n.blocked_kind := CASE WHEN n.blocked THEN v_gate->>'kind' END;
    n.blocked_reason := CASE WHEN n.blocked THEN v_gate->>'reason' END;
  END IF;

  -- #3980 W2 rework 4: on a roadmap approval card an agent changes nothing
  -- that ties it to its draft or decides whether it is open: its links, its
  -- GitHub links, blocked or waiting, or its anchor. Its wording, plan,
  -- result and due date stay editable. (A trigger refuses the same for every
  -- other writer.)
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (ROW(n.blocked, n.blocked_kind, n.blocked_reason, n.anchor_kind, n.anchor_id)
            IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason, c.anchor_kind, c.anchor_id)
          OR (p_changes ? 'github' AND v_gh_list IS DISTINCT FROM v_gh_cur)
          OR (p_changes ? 'links' AND
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT l.kind || ':' || l.target_id::text AS k FROM public.ops_work_links l WHERE l.card_id = c.id) a)
              IS DISTINCT FROM
              (SELECT string_agg(k, ',' ORDER BY k COLLATE "C") FROM (
                 SELECT DISTINCT (x->>'kind') || ':' || lower(x->>'id') AS k FROM jsonb_array_elements(COALESCE(cl->'links', '[]'::jsonb)) x) b))) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes what this card links to or waits for.' USING ERRCODE = '42501';
  END IF;
  -- #3980 W2 follow-up: nor who owns or watches it (the same test
  -- ops_people_set uses for "changed"; a trigger backstops every writer).
  IF v.via IS NOT NULL AND c.auto_key LIKE 'roadmap\_shipped:%'
     AND (public.ops_card_people(c.id, 'owner')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)) x ORDER BY x)
          OR public.ops_card_people(c.id, 'watcher')
            IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(cl->'watchers', '[]'::jsonb)) x
                                    WHERE NOT x = ANY (ARRAY(SELECT jsonb_array_elements_text(COALESCE(cl->'owners', '[]'::jsonb)))) ORDER BY x)) THEN
    RAISE EXCEPTION 'people_only: A person approves what hosts are told. Only a person changes who owns or watches this card.' USING ERRCODE = '42501';
  END IF;

  IF ROW(n.title, n.instructions, n.done_means, n.due_on, n.sprint_id, n.anchor_kind, n.anchor_id, n.result)
     IS DISTINCT FROM ROW(c.title, c.instructions, c.done_means, c.due_on, c.sprint_id, c.anchor_kind, c.anchor_id, c.result) THEN
    v_cats := v_cats || 'updated'::text;
  END IF;
  IF n.plan IS DISTINCT FROM c.plan THEN v_cats := v_cats || 'plan'::text; END IF;
  IF ROW(n.status, n.person_reason) IS DISTINCT FROM ROW(c.status, c.person_reason) THEN v_cats := v_cats || 'status'::text; END IF;
  IF ROW(n.blocked, n.blocked_kind, n.blocked_reason) IS DISTINCT FROM ROW(c.blocked, c.blocked_kind, c.blocked_reason) THEN
    v_cats := v_cats || CASE WHEN n.blocked THEN 'blocked' ELSE 'unblocked' END;
  END IF;

  UPDATE public.ops_work_cards SET title = n.title, instructions = n.instructions, done_means = n.done_means,
    status = n.status, person_reason = n.person_reason, blocked = n.blocked, blocked_kind = n.blocked_kind, blocked_reason = n.blocked_reason,
    anchor_kind = n.anchor_kind, anchor_id = n.anchor_id, due_on = n.due_on, due_source = n.due_source, sprint_id = n.sprint_id,
    plan = n.plan, result = n.result, started_at = n.started_at, working_by = n.working_by, working_via = n.working_via,
    working_chat = CASE WHEN v_status = 'doing' AND c.status <> 'doing' THEN v_chat
                        WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_chat END,
    working_seen_at = CASE WHEN v_status = 'doing' AND c.status <> 'doing' AND v.via IS NOT NULL THEN clock_timestamp()
                           WHEN v_status = 'doing' AND c.status <> 'doing' THEN NULL
                           WHEN v_status = 'todo' AND c.status = 'doing' THEN NULL ELSE working_seen_at END
   WHERE id = c.id;
  v_owners := ARRAY(SELECT jsonb_array_elements_text(cl->'owners'));
  v_watchers := ARRAY(SELECT jsonb_array_elements_text(cl->'watchers'));
  v_people := public.ops_people_set(c.id, v_owners, v_watchers, v.actor_email, v.via);
  IF (v_people->>'changed')::boolean THEN v_cats := v_cats || 'people'::text; END IF;
  v_links_changed := public.ops_links_set(c.id, cl->'links', v.actor_email, v.via);
  IF v_links_changed THEN v_cats := v_cats || 'links'::text; END IF;
  IF p_changes ? 'github' THEN
    v_gh_changed := public.ops_github_set(c.id, cl->'github', v.actor_email, v.via);
    IF v_gh_changed THEN v_cats := v_cats || 'github'::text; END IF;
    -- #3980 W2 rework: a person changing what a waiting card waits for is logged by name.
    IF v_gh_changed AND c.blocked_kind = 'github' AND v.via IS NULL THEN
      PERFORM public.ops_log_write(v.actor_email, NULL, 'updated', 'info', c.id, 'work_card', c.id,
        format('%s changed what Card %s waits for: %s (was %s).', v_who, c.number, COALESCE(v_gh_list, 'nothing'), COALESCE(v_gh_cur, 'nothing')),
        jsonb_build_object('changed', '["github"]'::jsonb, 'from', v_gh_cur, 'to', v_gh_list, 'waiting', true));
    END IF;
  END IF;

  IF cardinality(v_cats) = 0 THEN
    SELECT * INTO n FROM public.ops_work_cards w WHERE w.id = c.id;
    v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', NULL, 'changed', false);
    PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
    RETURN v_out;
  END IF;
  UPDATE public.ops_work_cards SET revision = revision + 1, updated_by = v.actor_email, updated_via = v.via, updated_at = now()
   WHERE id = c.id RETURNING * INTO n;
  v_action := CASE WHEN cardinality(v_cats) = 1 THEN v_cats[1] ELSE 'updated' END;
  v_event := public.ops_card_event(c.id, v.actor_email, v.via, v_action, CASE WHEN v_back THEN v_back_reason END, v_before, public.ops_card_snapshot(c.id), c.revision, n.revision);
  -- "Gia, Hal": the people taken off the card, by name, for the agent log.
  -- A name another teammate shares carries the address: "Gia <gia@...>".
  SELECT string_agg(public.ops_name(x.email)
           || CASE WHEN EXISTS (SELECT 1 FROM public.admin_team_directory() d
                                 WHERE d.status = 'active' AND d.email <> x.email
                                   AND lower(public.crm_display_name(d.email)) = lower(public.ops_name(x.email)))
                   THEN ' <' || x.email || '>' ELSE '' END, ', ' ORDER BY x.ord) INTO v_removed_words
    FROM jsonb_array_elements_text(COALESCE(v_people->'removed', '[]'::jsonb)) WITH ORDINALITY AS x(email, ord);
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_owners')), v.actor_email,
    format('%s added you as owner: %s', v_who, n.title));
  PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'new_watchers')), v.actor_email,
    format('%s added you as watcher: %s', v_who, n.title));
  -- An agent that takes someone off a card tells them: who, which agent, and
  -- the card (the notice links to it). Guardrail, not a bottleneck.
  IF v.via IN ('claude', 'codex') THEN
    PERFORM public.ops_notify_people(c.id, v_event, ARRAY(SELECT jsonb_array_elements_text(v_people->'removed')), v.actor_email,
      format('%s took you off this card: %s', v_who, n.title));
  END IF;
  IF n.status = 'person' AND c.status <> 'person' THEN
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s: %s needs a person (%s)', v_who, n.title, CASE n.person_reason WHEN 'send' THEN 'send a message' WHEN 'spend' THEN 'spend money' WHEN 'publish' THEN 'publish an event' ELSE 'other' END));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'needs_person', 'info', c.id, 'work_card', c.id,
      format('Card %s needs a person: %s', n.number, n.title), jsonb_build_object('reason', n.person_reason));
  ELSIF v_back THEN
    -- Wave 2: told and logged when a card stops needing a person.
    PERFORM public.ops_notify_people(c.id, v_event, public.ops_card_people(c.id, NULL), v.actor_email,
      format('%s moved %s back to %s from Needs a person%s', v_who, n.title, CASE n.status WHEN 'doing' THEN 'Doing' ELSE 'To do' END,
        COALESCE(': ' || v_back_reason, '')));
    PERFORM public.ops_log_write(v.actor_email, v.via, 'updated', 'info', c.id, 'work_card', c.id,
      format('Card %s no longer needs a person%s', n.number, COALESCE(': ' || v_back_reason, '.')),
      jsonb_build_object('changed', to_jsonb(v_cats), 'from', 'person', 'to', n.status, 'reason', v_back_reason));
  ELSIF v.via IS NOT NULL THEN
    PERFORM public.ops_log_write(v.actor_email, v.via,
      CASE v_action WHEN 'plan' THEN 'step' WHEN 'blocked' THEN 'blocked' WHEN 'unblocked' THEN 'unblocked' ELSE 'updated' END, 'ok', c.id, 'work_card', c.id,
      CASE WHEN v_action = 'plan' THEN format('Plan on Card %s: %s of %s steps done.', n.number,
             (SELECT count(*) FROM jsonb_array_elements(n.plan) s WHERE s->>'status' = 'done'), jsonb_array_length(n.plan))
           WHEN v_action = 'blocked' THEN format('Card %s blocked: %s', n.number, n.blocked_reason)
           -- #3980 rework 2: a removal says who was taken off, not "Updated".
           WHEN v_action = 'people' AND v_removed_words IS NOT NULL
                AND jsonb_array_length(v_people->'new_owners') = 0 AND jsonb_array_length(v_people->'new_watchers') = 0
             THEN format('Took %s off Card %s: %s', v_removed_words, n.number, n.title)
           WHEN v_removed_words IS NOT NULL THEN format('Updated Card %s: %s. Took %s off it.', n.number, n.title, v_removed_words)
           ELSE format('Updated Card %s: %s', n.number, n.title) END, jsonb_build_object('changed', to_jsonb(v_cats)));
  END IF;
  v_out := jsonb_build_object('card', public.ops_card_json(n, v_today), 'event_id', v_event, 'changed', true);
  PERFORM public.ops_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'invalid_card: An open card already has this title. Update that card instead.' USING ERRCODE = '22023';
END;

$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_update(p_id uuid, p_changes jsonb, p_expected_revision bigint, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v record; v_item public.content_calendar_items; v_after jsonb; v_replay jsonb; v_out jsonb;
  v_args jsonb; v_audit uuid; v_action text := 'content.updated'; v_value text; v_channels text[];
  v_fields text[]; v_before_publish timestamptz;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_args := jsonb_build_object('id', p_id, 'changes', p_changes, 'expected_revision', p_expected_revision);
  v_replay := public.content_calendar_request_begin(v.actor_email, p_request_key, 'update', v_args);
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN
       ('title','publish_at','channels','copy','notes','drive_url','live_url','format','audience','city_id')) THEN
    RAISE EXCEPTION 'invalid_changes: Send at least one supported field.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  PERFORM public.ops_claim_assert('content', v_item.id, v.actor_email, v.via);
  IF p_expected_revision IS NULL OR v_item.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='PT409';
  END IF;
  v_before_publish := v_item.publish_at;
  SELECT array_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(p_changes) k;
  IF p_changes ? 'title' THEN
    IF jsonb_typeof(p_changes->'title') <> 'string' OR char_length(btrim(p_changes->>'title')) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'invalid_title: Title must be 1 to 160 characters.' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.content_calendar_items i WHERE i.id<>p_id AND i.deleted_at IS NULL
                 AND i.title_key=public.crm_name_key(p_changes->>'title')) THEN
      RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
    END IF;
    v_item.title := btrim(p_changes->>'title');
  END IF;
  IF p_changes ? 'publish_at' THEN
    IF jsonb_typeof(p_changes->'publish_at') = 'null' THEN v_item.publish_at := NULL;
    ELSIF jsonb_typeof(p_changes->'publish_at') <> 'string' THEN RAISE EXCEPTION 'invalid_publish_at: Use a date-time or null.' USING ERRCODE='22023';
    ELSE v_item.publish_at := (p_changes->>'publish_at')::timestamptz; END IF;
  END IF;
  IF p_changes ? 'channels' THEN
    IF jsonb_typeof(p_changes->'channels') <> 'array' OR jsonb_array_length(p_changes->'channels') > 9
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes->'channels') e
                   WHERE jsonb_typeof(e) <> 'string' OR e#>>'{}' NOT IN ('instagram','tiktok','facebook','x','threads','youtube','linkedin','website','email')) THEN
      RAISE EXCEPTION 'invalid_channels: Choose only supported channels.' USING ERRCODE='22023'; END IF;
    SELECT COALESCE(array_agg(DISTINCT e ORDER BY e), ARRAY[]::text[]) INTO v_channels
      FROM jsonb_array_elements_text(p_changes->'channels') e;
    v_item.channels := v_channels;
  END IF;
  IF p_changes ? 'copy' THEN
    IF v_item.stage NOT IN ('idea','writing') THEN
      RAISE EXCEPTION 'copy_locked: Copy is read-only after Writing. Move the card back to Writing to revise it.' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(p_changes->'copy') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'copy','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_copy: Copy must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.copy_text := NULLIF(p_changes->>'copy','');
  END IF;
  IF p_changes ? 'notes' THEN
    IF jsonb_typeof(p_changes->'notes') NOT IN ('string','null') OR char_length(COALESCE(p_changes->>'notes','')) > 20000 THEN
      RAISE EXCEPTION 'invalid_notes: Notes must be at most 20,000 characters.' USING ERRCODE='22023'; END IF;
    v_item.notes := NULLIF(p_changes->>'notes','');
  END IF;
  FOREACH v_value IN ARRAY ARRAY['drive_url','live_url'] LOOP
    IF p_changes ? v_value THEN
      IF jsonb_typeof(p_changes->v_value) NOT IN ('string','null') OR char_length(COALESCE(p_changes->>v_value,'')) > 2000
         OR (NULLIF(p_changes->>v_value,'') IS NOT NULL AND (p_changes->>v_value) !~ '^https?://') THEN
        RAISE EXCEPTION 'invalid_url: Links must start with http:// or https:// and be at most 2,000 characters.' USING ERRCODE='22023'; END IF;
      IF v_value='drive_url' THEN v_item.drive_url := NULLIF(p_changes->>v_value,'');
      ELSE v_item.live_url := NULLIF(p_changes->>v_value,''); END IF;
    END IF;
  END LOOP;
  IF p_changes ? 'format' THEN
    IF jsonb_typeof(p_changes->'format') NOT IN ('string','null') OR (NULLIF(p_changes->>'format','') IS NOT NULL
       AND p_changes->>'format' NOT IN ('graphic','carousel','short_video','long_video','story','talking_head','motion_graphics','photo_ugc','blog','email','landing_page')) THEN
      RAISE EXCEPTION 'invalid_format: Choose a supported format.' USING ERRCODE='22023'; END IF;
    v_item.format := NULLIF(p_changes->>'format','');
  END IF;
  IF p_changes ? 'audience' THEN
    IF jsonb_typeof(p_changes->'audience') NOT IN ('string','null') OR (NULLIF(p_changes->>'audience','') IS NOT NULL
       AND p_changes->>'audience' NOT IN ('explorer','business','education_investor')) THEN
      RAISE EXCEPTION 'invalid_audience: Choose a supported audience.' USING ERRCODE='22023'; END IF;
    v_item.audience := NULLIF(p_changes->>'audience','');
  END IF;
  IF p_changes ? 'city_id' THEN
    IF jsonb_typeof(p_changes->'city_id')='null' OR NULLIF(p_changes->>'city_id','') IS NULL THEN v_item.city_id := NULL;
    ELSIF jsonb_typeof(p_changes->'city_id') <> 'string' OR NOT EXISTS (SELECT 1 FROM public.seeding_cities c WHERE c.id=(p_changes->>'city_id')::uuid) THEN
      RAISE EXCEPTION 'invalid_city: Choose a listed city.' USING ERRCODE='22023';
    ELSE v_item.city_id := (p_changes->>'city_id')::uuid; END IF;
  END IF;
  IF v_item.stage NOT IN ('idea','writing') AND
     (NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL OR v_item.copy_approved_at IS NULL OR v_item.copy_approved_by IS NULL) THEN
    RAISE EXCEPTION 'copy_approval_required: Design and later stages require approved copy.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage IN ('scheduled','published') AND
     (v_item.design_approved_at IS NULL OR v_item.design_approved_by IS NULL OR v_item.publish_at IS NULL OR cardinality(v_item.channels)=0) THEN
    RAISE EXCEPTION 'schedule_required: Scheduled and Published require approved design, a publish date and at least one channel.' USING ERRCODE='22023';
  END IF;
  IF v_item.stage='published' AND v_item.live_url IS NULL AND NOT v_item.published_without_link THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  UPDATE public.content_calendar_items SET title=v_item.title, publish_at=v_item.publish_at, channels=v_item.channels,
    copy_text=v_item.copy_text, notes=v_item.notes, drive_url=v_item.drive_url, live_url=v_item.live_url,
    format=v_item.format, audience=v_item.audience, city_id=v_item.city_id, revision=revision+1,
    updated_by=v.actor_email, updated_at=now() WHERE id=p_id RETURNING * INTO v_item;
  v_after := public.content_calendar_item_json(v_item);
  IF v_fields = ARRAY['publish_at']::text[] THEN v_action := 'content.rescheduled'; END IF;
  v_audit := public.content_calendar_audit_write(p_id, v.actor_email, v.via, v_action,
    jsonb_build_object('changed_fields',to_jsonb(v_fields),'from_revision',p_expected_revision,'to_revision',v_item.revision) ||
    CASE WHEN v_action='content.rescheduled' THEN jsonb_build_object('previous_publish_at',v_before_publish) ELSE '{}'::jsonb END);
  v_out := jsonb_build_object('item', v_after, 'audit_id', v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email, p_request_key, 'update', v_out);
  RETURN v_out;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_title: That title is already on the content calendar. Open the existing card instead.' USING ERRCODE='23505';
WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
  RAISE EXCEPTION 'invalid_changes: A date or identifier has the wrong shape.' USING ERRCODE='22023';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_record_stay_dispute(p_provider_event_id text, p_provider_event_type text, p_provider_charge_ref text, p_dispute_ref text, p_amount_minor integer, p_currency_code text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_event_id uuid;
  v_line record;
  v_resolved boolean := lower(p_status) IN ('won', 'warning_closed');
  v_release public.brand_payout_releases%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor < 0
     OR upper(COALESCE(p_currency_code, '')) !~ '^[A-Z]{3}$'
     OR char_length(COALESCE(p_provider_event_id, '')) NOT BETWEEN 3 AND 240
     OR char_length(COALESCE(p_provider_charge_ref, '')) NOT BETWEEN 3 AND 200
     OR char_length(COALESCE(p_dispute_ref, '')) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE provider = 'stripe'
    AND (
      provider_charge_ref = p_provider_charge_ref
      OR provider_payment_ref = p_provider_charge_ref
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_attempt.group_id
  FOR UPDATE;
  IF v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR p_amount_minor > v_attempt.amount_minor THEN
    RAISE EXCEPTION 'stay_provider_evidence_mismatch'
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.stay_provider_events (
    provider, provider_event_id, provider_event_type,
    payment_attempt_id, event_fingerprint, safe_payload
  ) VALUES (
    'stripe', p_provider_event_id, p_provider_event_type,
    v_attempt.id,
    encode(extensions.digest(
      pg_catalog.convert_to(
        p_provider_event_id || ':' || p_dispute_ref || ':' || p_status,
        'UTF8'
      ),
      'sha256'
    ), 'hex'),
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', true,
      'groupId', v_group.id,
      'replayed', true
    );
  END IF;

  IF v_resolved THEN
    UPDATE public.stay_reservation_lines
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id
      AND state = 'reconciliation_required';
    UPDATE public.stay_reservation_groups
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE id = v_group.id
      AND state = 'reconciliation_required'
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_refunds refund_row
        WHERE refund_row.group_id = v_group.id
          AND refund_row.state IN (
            'submitted', 'processing', 'manual_reconciliation'
          )
      );
  ELSE
    UPDATE public.stay_reservation_lines
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id AND state = 'confirmed';
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN ('confirmed', 'partially_cancelled');
  END IF;

  FOR v_line IN
    WITH weights AS (
      SELECT
        line.id,
        line.total_minor,
        floor(
          p_amount_minor::numeric * line.total_minor
            / v_attempt.amount_minor
        )::integer AS amount_floor,
        (
          p_amount_minor::numeric * line.total_minor
            - floor(
              p_amount_minor::numeric * line.total_minor
                / v_attempt.amount_minor
            ) * v_attempt.amount_minor
        ) AS remainder
      FROM public.stay_reservation_lines line
      WHERE line.group_id = v_group.id
        AND line.state <> 'cancelled'
    ),
    ranked AS (
      SELECT
        weights.*,
        row_number() OVER (ORDER BY remainder DESC, id) AS remainder_rank,
        p_amount_minor - sum(amount_floor) OVER () AS extras
      FROM weights
    )
    SELECT
      id AS line_id,
      amount_floor
        + CASE WHEN remainder_rank <= extras THEN 1 ELSE 0 END
        AS disputed_minor
    FROM ranked
    ORDER BY id
  LOOP
    SELECT release_row.* INTO v_release
    FROM public.payout_release_items item
    JOIN public.brand_payout_releases release_row
      ON release_row.id = item.release_id
    WHERE item.source_type = 'stay_reservation'
      AND item.source_id = v_line.line_id
    FOR UPDATE OF release_row;
    IF FOUND AND v_release.status <> 'released' THEN
      UPDATE public.payout_release_items
      SET disputed_cents = CASE WHEN v_resolved
            THEN 0 ELSE v_line.disputed_minor END,
          net_cents = GREATEST(
            0,
            gross_cents - refunded_cents
              - CASE WHEN v_resolved THEN 0 ELSE v_line.disputed_minor END
              - mingla_fee_cents - partner_share_cents
              - provider_fee_cents
          )
      WHERE source_type = 'stay_reservation'
        AND source_id = v_line.line_id;
      UPDATE public.brand_payout_releases release_row
      SET disputed_cents = totals.disputed,
          net_release_cents = totals.net,
          updated_at = now()
      FROM (
        SELECT
          sum(item.disputed_cents)::integer AS disputed,
          sum(item.net_cents)::integer AS net
        FROM public.payout_release_items item
        WHERE item.release_id = v_release.id
      ) totals
      WHERE release_row.id = v_release.id;
    ELSIF FOUND AND v_release.status = 'released'
      AND v_line.disputed_minor > 0 THEN
      INSERT INTO public.payout_ledger_adjustments (
        release_id, brand_id, currency, kind, amount_cents,
        provider_ref, idempotency_key
      ) VALUES (
        v_release.id, v_release.brand_id, v_release.currency,
        CASE WHEN v_resolved
          THEN 'dispute_reversal' ELSE 'post_release_dispute' END,
        v_line.disputed_minor, p_dispute_ref,
        'stay-dispute:' || p_dispute_ref || ':' ||
          v_line.line_id || ':' ||
          CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      IF NOT v_resolved THEN
        PERFORM public.convert_postponement_debt_to_permanent(
          v_release.id,
          'post_release_dispute',
          LEAST(
            v_line.disputed_minor,
            v_release.organiser_cash_delivered_cents
          ),
          now()
        );
      END IF;
    END IF;

    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_group.id, v_line.line_id, v_attempt.id,
      CASE WHEN v_resolved THEN 'payout_reversed' ELSE 'chargeback' END,
      v_line.disputed_minor, v_attempt.currency_code, p_dispute_ref,
      'stay:dispute:' || p_dispute_ref || ':' || v_line.line_id ||
        ':' || CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
      jsonb_build_object('status', lower(p_status))
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id,
    CASE WHEN v_resolved
      THEN 'stay_dispute_resolved' ELSE 'stay_dispute_recorded' END,
    'service',
    'dispute:' || p_dispute_ref || ':' ||
      CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  RETURN jsonb_build_object(
    'matched', true,
    'groupId', v_group.id,
    'brandId', v_group.brand_id,
    'resolved', v_resolved
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.content_calendar_move(p_id uuid, p_to text, p_expected_revision bigint, p_approve_copy boolean DEFAULT false, p_approve_design boolean DEFAULT false, p_publish_without_link boolean DEFAULT false, p_request_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v record; v_item public.content_calendar_items; v_replay jsonb; v_out jsonb; v_audit uuid;
  v_from_idx integer; v_to_idx integer; v_now timestamptz := clock_timestamp();
  v_previous_copy_by text; v_previous_copy_at timestamptz;
  v_previous_design_by text; v_previous_design_at timestamptz; v_previous_without_link boolean;
BEGIN
  SELECT * INTO v FROM public.content_calendar_ctx();
  v_replay := public.content_calendar_request_begin(v.actor_email,p_request_key,'move',jsonb_build_object(
    'id',p_id,'to',p_to,'expected_revision',p_expected_revision,'approve_copy',COALESCE(p_approve_copy,false),
    'approve_design',COALESCE(p_approve_design,false),'publish_without_link',COALESCE(p_publish_without_link,false)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  SELECT * INTO v_item FROM public.content_calendar_items i WHERE i.id=p_id AND i.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That content card is no longer here.' USING ERRCODE='P0002'; END IF;
  PERFORM public.ops_claim_assert('content', v_item.id, v.actor_email, v.via);
  IF p_expected_revision IS NULL OR v_item.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then apply your change again.' USING ERRCODE='PT409'; END IF;
  SELECT ord INTO v_from_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=v_item.stage;
  SELECT ord INTO v_to_idx FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE stage=p_to;
  IF v_to_idx IS NULL THEN RAISE EXCEPTION 'invalid_stage: Use Idea, Writing, Design, Review, Scheduled or Published.' USING ERRCODE='22023'; END IF;
  IF v_to_idx=v_from_idx THEN RAISE EXCEPTION 'no_change: That card is already in this stage.' USING ERRCODE='22023'; END IF;
  IF v_to_idx > v_from_idx + 1 THEN RAISE EXCEPTION 'stage_order: Move forward one stage at a time.' USING ERRCODE='22023'; END IF;
  v_previous_copy_by:=v_item.copy_approved_by; v_previous_copy_at:=v_item.copy_approved_at;
  v_previous_design_by:=v_item.design_approved_by; v_previous_design_at:=v_item.design_approved_at;
  v_previous_without_link:=v_item.published_without_link;
  IF v_item.stage='writing' AND p_to='design' THEN
    IF NULLIF(btrim(COALESCE(v_item.copy_text,'')),'') IS NULL THEN RAISE EXCEPTION 'copy_required: Add copy before Design.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_copy,false) THEN RAISE EXCEPTION 'copy_approval_required: Approve the copy before Design.' USING ERRCODE='22023'; END IF;
    v_item.copy_approved_by:=v.actor_email; v_item.copy_approved_at:=v_now;
  ELSIF v_item.stage='review' AND p_to='scheduled' THEN
    IF v_item.publish_at IS NULL OR cardinality(v_item.channels)=0 THEN RAISE EXCEPTION 'schedule_required: Add a publish date, time and at least one channel.' USING ERRCODE='22023'; END IF;
    IF NOT COALESCE(p_approve_design,false) THEN RAISE EXCEPTION 'design_approval_required: Approve the design before Scheduled.' USING ERRCODE='22023'; END IF;
    v_item.design_approved_by:=v.actor_email; v_item.design_approved_at:=v_now;
  ELSIF v_item.stage='scheduled' AND p_to='published' AND v_item.live_url IS NULL AND NOT COALESCE(p_publish_without_link,false) THEN
    RAISE EXCEPTION 'live_link_required: Add the live link, or explicitly publish without one.' USING ERRCODE='22023';
  END IF;
  IF v_to_idx<v_from_idx THEN
    IF v_to_idx<=2 THEN
      v_item.copy_approved_by:=NULL; v_item.copy_approved_at:=NULL;
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    ELSIF v_to_idx<=4 THEN
      v_item.design_approved_by:=NULL; v_item.design_approved_at:=NULL;
    END IF;
  END IF;
  v_item.published_without_link := p_to='published' AND v_item.live_url IS NULL AND COALESCE(p_publish_without_link,false);
  UPDATE public.content_calendar_items SET stage=p_to,
    copy_approved_by=v_item.copy_approved_by,copy_approved_at=v_item.copy_approved_at,
    design_approved_by=v_item.design_approved_by,design_approved_at=v_item.design_approved_at,
    published_without_link=v_item.published_without_link,
    revision=revision+1,updated_by=v.actor_email,updated_at=now()
    WHERE id=p_id RETURNING * INTO v_item;
  v_audit := public.content_calendar_audit_write(p_id,v.actor_email,v.via,'content.stage_move',jsonb_build_object(
    'previous_stage',(SELECT stage FROM unnest(ARRAY['idea','writing','design','review','scheduled','published']) WITH ORDINALITY s(stage,ord) WHERE ord=v_from_idx),
    'next_stage',p_to,'from_revision',p_expected_revision,'to_revision',v_item.revision,
    'previous_copy_approved_by',v_previous_copy_by,'previous_copy_approved_at',v_previous_copy_at,
    'previous_design_approved_by',v_previous_design_by,'previous_design_approved_at',v_previous_design_at,
    'previous_published_without_link',v_previous_without_link,
    'copy_approved_by',v_item.copy_approved_by,'copy_approved_at',v_item.copy_approved_at,
    'design_approved_by',v_item.design_approved_by,'design_approved_at',v_item.design_approved_at,
    'published_without_link',v_item.published_without_link));
  v_out := jsonb_build_object('item',public.content_calendar_item_json(v_item),'audit_id',v_audit);
  PERFORM public.content_calendar_request_finish(v.actor_email,p_request_key,'move',v_out);
  RETURN v_out;
END;
$function$
;
COMMIT;

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

-- Restore the definitions the later migration left, exactly.
DO $t4_restore_superseded$
DECLARE
  r record;
  v_bad text;
BEGIN
  FOR r IN SELECT def FROM t4134_superseded LOOP
    EXECUTE r.def;
  END LOOP;
  SELECT string_agg(s.oid::regprocedure::text, ', ') INTO v_bad
    FROM t4134_superseded AS s
   WHERE md5(pg_temp.t4134_def(s.oid)) IS DISTINCT FROM s.def_md5;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4134-T restore FAIL: the later definition did not come back exactly: %', v_bad;
  END IF;
END
$t4_restore_superseded$;
DROP TABLE t4134_superseded;

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
