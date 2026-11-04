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
-- added to this list the same way.
-------------------------------------------------------------------------------
CREATE TEMP TABLE t4134_superseded AS
SELECT p.oid, pg_temp.t4134_def(p.oid) AS def, md5(pg_temp.t4134_def(p.oid)) AS def_md5
  FROM pg_catalog.pg_proc AS p
 WHERE p.oid IN ('private.enqueue_wizard_invites_on_publish_v1(uuid,bigint,boolean)'::regprocedure,
                 'public.biz_replace_offering_invite_plan_v1(uuid,jsonb,bigint,uuid)'::regprocedure);

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
