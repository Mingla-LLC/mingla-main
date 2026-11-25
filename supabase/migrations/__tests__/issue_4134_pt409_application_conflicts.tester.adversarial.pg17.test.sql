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
-- records the go), so it is put back and restored the same way. #4382
-- (20280613004382 / 20280613024382, Support Desk redesign) re-defines
-- issue_3720_set_next_update, issue_3720_link_product_signal_source,
-- issue_3720_update_product_signal and issue_3720_save_product_avengers_review
-- (staff threads became tickets; new Product stages), so they are put back and
-- restored the same way. It also DROPS issue_3720_update_internal_thread and
-- issue_3988_reassign_internal_thread with the staff-thread table; they are
-- re-created here from section B for the replay and dropped again after T4.
-- #4522 (20281202044522_issue_4522_plan_v2_model.sql) re-defines
-- biz_apply_trip_draft_graph ("Use this plan for all packages" and the v2
-- plan price check), so it is put back and restored the same way.
-- [TEST-MOD-APPROVED #4490] #4490 P3
-- (20281203144490_issue_4490_p3_packages_deposits.sql) re-defines
-- issue_1388_guard_state_transition (an active venue-booking commitment may
-- move window or change guests inside a governed booking change), so it is
-- put back and restored the same way.
-- [TEST-MOD-APPROVED #4490] #4490 Round 4J
-- (20281203404490_issue_4490_gaps_stay_features.sql) re-defines
-- biz_manage_stay_inventory, issue_1388_manage_request, issue_1389_cancel,
-- issue_1389_cancel_preview and issue_1389_prepare_payment (Stays checks key
-- on the venue's features, not its type), so they are put back verbatim from
-- section B and restored and md5-checked the same way. No assertion changed.
-- #4571 W3 (20281130034571) re-defines team_agent_call (set_owners takes
-- watcher_emails; my_day carries calls_due), so it is put back from section B
-- (read from the migration file itself, not copied) and restored the same way.
-------------------------------------------------------------------------------
\set t4134_tac `sed -n '/^CREATE OR REPLACE FUNCTION public.team_agent_call(p_key_hash text, p_tool text, p_args jsonb, p_client text)$/,/^;$/p' supabase/migrations/20271231204134_issue_4134_pt409_application_conflicts.sql`
CREATE TEMP TABLE t4134_superseded AS
SELECT p.oid, pg_temp.t4134_def(p.oid) AS def, md5(pg_temp.t4134_def(p.oid)) AS def_md5
  FROM pg_catalog.pg_proc AS p
 WHERE p.oid IN ('private.enqueue_wizard_invites_on_publish_v1(uuid,bigint,boolean)'::regprocedure,
                 'public.biz_replace_offering_invite_plan_v1(uuid,jsonb,bigint,uuid)'::regprocedure,
                 'public.ops_work_add(jsonb,text)'::regprocedure,
                 'public.ops_work_update(uuid,jsonb,bigint,text)'::regprocedure,
                 'public.content_calendar_update(uuid,jsonb,bigint,text)'::regprocedure,
                 'public.issue_1389_record_stay_dispute(text,text,text,text,integer,text,text)'::regprocedure,
                 'public.content_calendar_move(uuid,text,bigint,boolean,boolean,boolean,text)'::regprocedure,
                 'public.issue_3720_set_next_update(text,uuid,integer,timestamp with time zone,text)'::regprocedure,
                 'public.issue_3720_link_product_signal_source(uuid,integer,text,uuid)'::regprocedure,
                 'public.issue_3720_update_product_signal(uuid,integer,text,text,timestamp with time zone,text,text)'::regprocedure,
                 'public.issue_3720_save_product_avengers_review(uuid,integer,text,text,text,text[],text,text,text,text,text,text)'::regprocedure,
                 'public.biz_apply_trip_draft_graph(uuid,jsonb,timestamp with time zone,uuid)'::regprocedure,
                 'public.issue_1388_guard_state_transition()'::regprocedure,
                 'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
                 'public.issue_1388_manage_request(text,uuid,bigint,text,uuid)'::regprocedure,
                 'public.issue_1389_cancel(uuid,text,text,text,uuid)'::regprocedure,
                 'public.issue_1389_cancel_preview(uuid,uuid[],bigint,uuid)'::regprocedure,
                 'public.issue_1389_prepare_payment(uuid,text,bigint,uuid)'::regprocedure,
                 'public.team_agent_call(text,text,jsonb,text)'::regprocedure);

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
-- #4382 put-backs (verbatim from section B of the migration).
CREATE OR REPLACE FUNCTION public.issue_3720_link_product_signal_source(p_signal_id uuid, p_expected_revision integer, p_source_kind text, p_source_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_source_kind NOT IN ('support_ticket', 'internal_thread') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_source_kind = 'support_ticket'
     AND NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_source_kind = 'internal_thread'
     AND NOT EXISTS (SELECT 1 FROM public.support_internal_threads WHERE id = p_source_id) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.support_product_signals
     SET affected_people = affected_people + 1,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.support_product_signals WHERE id = p_signal_id) THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  BEGIN
    INSERT INTO public.support_product_signal_sources(signal_id, source_kind, source_id, linked_by)
    VALUES (p_signal_id, p_source_kind, p_source_id, v_actor);
  EXCEPTION WHEN unique_violation THEN
    -- Keep the counter and link atomic if another operator linked the source.
    RAISE;
  END;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_source_linked', 'product_signal', p_signal_id,
    jsonb_build_object(
      'source_kind', p_source_kind,
      'source_id', p_source_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_save_product_avengers_review(p_signal_id uuid, p_expected_revision integer, p_public_title text, p_public_problem_statement text, p_public_outcome text, p_public_acceptance_criteria text[], p_board_product text, p_board_theme text, p_board_priority text, p_board_estimate text, p_board_horizon text, p_board_quarter text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_kind text;
  v_revision integer;
  v_work_type text;
  v_criteria text[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_expected_revision' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision = 0
     AND EXISTS (SELECT 1 FROM public.product_avengers_reviews r WHERE r.signal_id = p_signal_id) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_revision > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.product_avengers_reviews r
        WHERE r.signal_id = p_signal_id AND r.revision = p_expected_revision
     ) THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  SELECT s.signal_kind INTO v_kind
    FROM public.support_product_signals s WHERE s.id = p_signal_id FOR UPDATE;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_kind NOT IN ('bug', 'feature') THEN
    RAISE EXCEPTION 'signal_not_product_work' USING ERRCODE = '22023';
  END IF;
  v_work_type := CASE v_kind WHEN 'bug' THEN 'Bug' ELSE 'Initiative' END;
  SELECT array_agg(btrim(value)) INTO v_criteria
    FROM unnest(COALESCE(p_public_acceptance_criteria, ARRAY[]::text[])) value
   WHERE char_length(btrim(value)) BETWEEN 4 AND 1000;
  IF cardinality(COALESCE(v_criteria, ARRAY[]::text[])) = 0 THEN
    RAISE EXCEPTION 'acceptance_criteria_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.product_avengers_reviews (
    signal_id, public_title, public_problem_statement, public_outcome,
    public_acceptance_criteria, board_work_type, board_product, board_theme,
    board_priority, board_estimate, board_horizon, board_quarter,
    reviewed_by, reviewed_at
  ) VALUES (
    p_signal_id, btrim(p_public_title), btrim(p_public_problem_statement),
    btrim(p_public_outcome), v_criteria, v_work_type, p_board_product,
    btrim(p_board_theme), p_board_priority, p_board_estimate,
    p_board_horizon, p_board_quarter, v_actor, now()
  )
  ON CONFLICT (signal_id) DO UPDATE
    SET public_title = EXCLUDED.public_title,
        public_problem_statement = EXCLUDED.public_problem_statement,
        public_outcome = EXCLUDED.public_outcome,
        public_acceptance_criteria = EXCLUDED.public_acceptance_criteria,
        board_work_type = EXCLUDED.board_work_type,
        board_product = EXCLUDED.board_product,
        board_theme = EXCLUDED.board_theme,
        board_priority = EXCLUDED.board_priority,
        board_estimate = EXCLUDED.board_estimate,
        board_horizon = EXCLUDED.board_horizon,
        board_quarter = EXCLUDED.board_quarter,
        reviewed_by = EXCLUDED.reviewed_by,
        reviewed_at = now(),
        revision = public.product_avengers_reviews.revision + 1,
        updated_at = now()
    WHERE public.product_avengers_reviews.revision = p_expected_revision
  RETURNING revision INTO v_revision;
  IF v_revision IS NULL THEN
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.product_avengers_audit(actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'save_public_review', 'product_signal', p_signal_id::text,
    jsonb_build_object('revision', v_revision, 'work_type', v_work_type));
  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_set_next_update(p_source_kind text, p_source_id uuid, p_expected_revision integer, p_next_update_at timestamp with time zone, p_next_update_note text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_revision integer;
  v_conversation uuid;
  v_before jsonb;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_source_kind NOT IN ('support_ticket', 'internal_thread') THEN
    RAISE EXCEPTION 'invalid_source_kind' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_update_note, '')) = '' THEN
    RAISE EXCEPTION 'next_update_note_required' USING ERRCODE = '22023';
  END IF;

  IF p_source_kind = 'support_ticket' THEN
    SELECT conversation_id,
           jsonb_build_object('next_update_at', next_update_at, 'revision', support_workflow_revision)
      INTO v_conversation, v_before
      FROM public.support_tickets
     WHERE id = p_source_id;

    UPDATE public.support_tickets
       SET next_update_at = p_next_update_at,
           next_update_note = left(btrim(p_next_update_note), 500),
           last_message_at = now(),
           support_workflow_revision = support_workflow_revision + 1
     WHERE id = p_source_id
       AND support_workflow_revision = p_expected_revision
    RETURNING support_workflow_revision INTO v_revision;

    IF v_revision IS NULL THEN
      IF v_conversation IS NULL THEN
        RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
      END IF;
      RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
    END IF;

    INSERT INTO public.messages(conversation_id, sender_id, content, message_type)
    VALUES (
      v_conversation,
      NULL,
      'Mingla will update you by ' || to_char(p_next_update_at AT TIME ZONE 'UTC', 'FMDay, FMMonth DD at HH12:MI AM') || ' UTC. ' || left(btrim(p_next_update_note), 500),
      'system'
    );
  ELSE
    SELECT jsonb_build_object('next_update_at', next_update_at, 'revision', revision)
      INTO v_before
      FROM public.support_internal_threads
     WHERE id = p_source_id;

    UPDATE public.support_internal_threads
       SET next_update_at = p_next_update_at,
           next_update_note = left(btrim(p_next_update_note), 500),
           updated_at = now(),
           revision = revision + 1
     WHERE id = p_source_id
       AND revision = p_expected_revision
    RETURNING revision INTO v_revision;

    IF v_revision IS NULL THEN
      IF v_before IS NULL THEN
        RAISE EXCEPTION 'source_not_found' USING ERRCODE = 'P0002';
      END IF;
      RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor,
    'next_update_set',
    CASE WHEN p_source_kind = 'support_ticket' THEN 'support_ticket' ELSE 'internal_thread' END,
    p_source_id,
    v_before,
    jsonb_build_object('next_update_at', p_next_update_at, 'revision', v_revision)
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_update_internal_thread(p_thread_id uuid, p_expected_revision integer, p_status text, p_priority text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_status NOT IN ('new', 'open', 'pending', 'resolved', 'closed')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object('status', status, 'priority', priority, 'revision', revision)
    INTO v_before
    FROM public.support_internal_threads
   WHERE id = p_thread_id;

  UPDATE public.support_internal_threads
     SET status = p_status,
         priority = p_priority,
         resolved_at = CASE
           WHEN p_status IN ('resolved', 'closed') THEN coalesce(resolved_at, now())
           ELSE NULL
         END,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_thread_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'internal_thread_updated', 'internal_thread', p_thread_id, v_before,
    jsonb_build_object('status', p_status, 'priority', p_priority, 'revision', v_revision)
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3720_update_product_signal(p_signal_id uuid, p_expected_revision integer, p_state text, p_priority text, p_next_update_at timestamp with time zone, p_next_step text, p_customer_reply_draft text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_state NOT IN ('needs_review', 'waiting_details', 'ready_product', 'linked', 'update_due', 'released', 'closed')
     OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;
  IF p_next_update_at IS NULL OR p_next_update_at <= now() + interval '14 minutes' THEN
    RAISE EXCEPTION 'next_update_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_next_step, '')) = '' OR btrim(coalesce(p_customer_reply_draft, '')) = '' THEN
    RAISE EXCEPTION 'product_fields_required' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'state', state, 'priority', priority, 'next_update_at', next_update_at, 'revision', revision
  ) INTO v_before
    FROM public.support_product_signals
   WHERE id = p_signal_id;

  UPDATE public.support_product_signals
     SET state = p_state,
         priority = p_priority,
         next_update_at = p_next_update_at,
         next_step = left(btrim(p_next_step), 1000),
         customer_reply_draft = left(btrim(p_customer_reply_draft), 4000),
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_signal_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'product_signal_updated', 'product_signal', p_signal_id, v_before,
    jsonb_build_object(
      'state', p_state, 'priority', p_priority,
      'next_update_at', p_next_update_at, 'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_3988_reassign_internal_thread(p_thread_id uuid, p_expected_revision integer, p_assigned_staff_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF p_assigned_staff_id IS NULL THEN
    RAISE EXCEPTION 'assignee_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.support_staff
     WHERE user_id = p_assigned_staff_id AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'assignee_not_support_staff' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'assigned_staff_id', assigned_staff_id,
    'revision', revision
  ) INTO v_before
    FROM public.support_internal_threads
   WHERE id = p_thread_id;

  UPDATE public.support_internal_threads
     SET assigned_staff_id = p_assigned_staff_id,
         updated_at = now(),
         revision = revision + 1
   WHERE id = p_thread_id AND revision = p_expected_revision
  RETURNING revision INTO v_revision;

  IF v_revision IS NULL THEN
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'thread_not_found' USING ERRCODE = 'P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.support_product_workflow_audit(
    actor_user_id, action, entity_kind, entity_id, before_snapshot, after_snapshot
  ) VALUES (
    v_actor, 'internal_thread_reassigned', 'internal_thread', p_thread_id, v_before,
    jsonb_build_object(
      'assigned_staff_id', p_assigned_staff_id,
      'revision', v_revision
    )
  );

  RETURN v_revision;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_apply_trip_draft_graph(p_event_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
  v_item jsonb;
  v_ticket_type uuid;
  v_currency char(3);
  v_theme jsonb;
  v_business_trip jsonb;
  v_known text[] := ARRAY['event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings'];
  -- issue #3801
  v_dates_touched boolean;
  v_trip_start timestamptz;
  v_trip_end timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip';
  END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'apply_trip_draft_graph', v_event.brand_id, p_event_id,
    jsonb_build_object('patch', p_patch, 'expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'trip_not_draft'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'trip_patch_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k
     WHERE NOT (k = ANY (v_known))
  ) THEN
    RAISE EXCEPTION 'trip_patch_key_not_allowed' USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------------ basics --
  IF p_patch ? 'event' THEN
    IF jsonb_typeof(p_patch->'event') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'event') key
       WHERE key <> ALL (ARRAY[
         'title', 'description', 'timezone', 'destination_text', 'departure_text',
         'cover_media_url', 'cover_media_poster_url', 'cover_media_type',
         'cover_media_gallery', 'business_trip'])
    ) THEN
      RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
    END IF;

    -- `events.destination_text` / `events.departure_text` are the canonical
    -- columns (ORCH-0950-expanded, ORCH-1016, I-PROPOSED-TRIP-CANONICAL-COLUMNS)
    -- and publish reads them. The theme keys are the authoring input and the
    -- wire format the existing publish/live owners consume. Both are written in
    -- the one statement below, DERIVED FROM THE SAME merged object, so the two
    -- cannot drift and neither input shape can produce a half-written trip.
    v_theme := COALESCE(v_event.theme, '{}'::jsonb);
    v_business_trip := COALESCE(v_theme->'business_trip', '{}'::jsonb);
    IF (p_patch->'event') ? 'business_trip' THEN
      IF jsonb_typeof(p_patch#>'{event,business_trip}') <> 'object' THEN
        RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
      END IF;
      v_business_trip := v_business_trip || (p_patch#>'{event,business_trip}');
    END IF;
    IF (p_patch->'event') ? 'destination_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('destinationLocationText', p_patch#>'{event,destination_text}');
    END IF;
    IF (p_patch->'event') ? 'departure_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('departureLocationText', p_patch#>'{event,departure_text}');
    END IF;
    v_theme := jsonb_set(v_theme, '{business_trip}', v_business_trip, true);

    UPDATE public.events SET
      title = CASE WHEN (p_patch->'event') ? 'title'
                THEN COALESCE(NULLIF(btrim(p_patch#>>'{event,title}'), ''), title) ELSE title END,
      description = CASE WHEN (p_patch->'event') ? 'description'
                THEN NULLIF(p_patch#>>'{event,description}', '') ELSE description END,
      timezone = CASE WHEN (p_patch->'event') ? 'timezone'
                THEN COALESCE(NULLIF(p_patch#>>'{event,timezone}', ''), 'UTC') ELSE timezone END,
      -- Derived from the MERGED business_trip, not from the raw patch key, so a
      -- destinationLocationText nested under `event.business_trip` populates
      -- the canonical column exactly as `event.destination_text` does. This
      -- also heals a legacy row whose theme and column disagree, on the next
      -- patch.
      destination_text = CASE WHEN v_business_trip ? 'destinationLocationText'
                THEN NULLIF(btrim(v_business_trip->>'destinationLocationText'), '') ELSE destination_text END,
      departure_text = CASE WHEN v_business_trip ? 'departureLocationText'
                THEN NULLIF(btrim(v_business_trip->>'departureLocationText'), '') ELSE departure_text END,
      cover_media_url = CASE WHEN (p_patch->'event') ? 'cover_media_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_url}', '') ELSE cover_media_url END,
      cover_media_poster_url = CASE WHEN (p_patch->'event') ? 'cover_media_poster_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_poster_url}', '') ELSE cover_media_poster_url END,
      cover_media_type = CASE WHEN (p_patch->'event') ? 'cover_media_type'
                THEN NULLIF(p_patch#>>'{event,cover_media_type}', '') ELSE cover_media_type END,
      cover_media_gallery = CASE WHEN (p_patch->'event') ? 'cover_media_gallery'
                THEN p_patch#>'{event,cover_media_gallery}' ELSE cover_media_gallery END,
      theme = v_theme,
      updated_at = now()
     WHERE id = p_event_id;

    -- issue #3801 — ONE OWNER FOR DRAFT TRIP DATES: the master event_dates row.
    --
    -- The wizard authors the dates as startAt / endAt inside
    -- `event.business_trip`, and never sends an `event_dates` group. Before
    -- this block the dates therefore reached the theme only, while publish and
    -- every reader (the wizard reload, the Hub list) read the master
    -- event_dates row — which did not exist. Publish refused every trip with
    -- `trip_dates_required` and the wizard reopened with blank dates.
    --
    -- The master row is now derived here, from the SAME merged object the theme
    -- write above just used and in the same transaction, so the two cannot
    -- drift:
    --   * dates touched by this patch and complete (both set, end after start)
    --       -> the master row is replaced with them;
    --   * dates touched and now cleared, half-set or out of order
    --       -> the master row is removed, so no stale row can outvote the
    --          theme at publish (the publish owner then names the real fault);
    --   * dates NOT touched, the theme holds a complete pair, and there is no
    --     master row -> the row is created. This heals a draft saved before
    --     this migration on its next basics save;
    --   * dates NOT touched and a master row exists -> left exactly as it is
    --     (it may have been written through the explicit `event_dates` group).
    -- An explicit `event_dates` group in the same patch keeps its existing
    -- behaviour and wins: this block stands aside and the group below runs.
    IF NOT (p_patch ? 'event_dates') THEN
      v_dates_touched := COALESCE(
        (p_patch#>'{event,business_trip}') ? 'startAt'
        OR (p_patch#>'{event,business_trip}') ? 'endAt', false);
      v_trip_start := NULL;
      v_trip_end := NULL;
      BEGIN
        v_trip_start := NULLIF(btrim(v_business_trip->>'startAt'), '')::timestamptz;
        v_trip_end := NULLIF(btrim(v_business_trip->>'endAt'), '')::timestamptz;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow
             OR invalid_parameter_value OR invalid_text_representation THEN
          -- A date this patch just wrote that is not a date is refused, with
          -- the code the `event_dates` group already uses. Unreadable text
          -- already sitting in an old draft is not this patch's fault and
          -- must not block an unrelated save.
          IF v_dates_touched THEN
            RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
          END IF;
          v_trip_start := NULL;
          v_trip_end := NULL;
      END;

      IF v_trip_start IS NOT NULL AND v_trip_end IS NOT NULL
         AND v_trip_end > v_trip_start THEN
        IF v_dates_touched OR NOT EXISTS (
          SELECT 1 FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true
        ) THEN
          DELETE FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true;
          INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
          SELECT p_event_id, v_trip_start, v_trip_end, e.timezone, true
            FROM public.events e
           WHERE e.id = p_event_id;
        END IF;
      ELSIF v_dates_touched THEN
        DELETE FROM public.event_dates
         WHERE event_id = p_event_id AND is_master = true;
      END IF;
    END IF;
  END IF;

  ------------------------------------------------------------------- dates --
  IF p_patch ? 'event_dates' THEN
    IF jsonb_typeof(p_patch->'event_dates') <> 'array' THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.event_dates WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'event_dates') LOOP
      IF NULLIF(v_item->>'start_at', '') IS NULL THEN
        RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id,
        (v_item->>'start_at')::timestamptz,
        NULLIF(v_item->>'end_at', '')::timestamptz,
        COALESCE(NULLIF(v_item->>'timezone', ''), v_event.timezone),
        COALESCE((v_item->>'is_master')::boolean, true)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------------- days --
  IF p_patch ? 'days' THEN
    IF jsonb_typeof(p_patch->'days') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          WHERE jsonb_typeof(d) <> 'object'
             OR COALESCE((d->>'ordinal')::int, 0) < 1
             OR NULLIF(btrim(d->>'title'), '') IS NULL
             OR jsonb_typeof(COALESCE(d->'media', '[]'::jsonb)) <> 'array')
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          GROUP BY (d->>'ordinal')::int HAVING count(*) > 1)
    THEN
      RAISE EXCEPTION 'trip_days_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_days WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'days') LOOP
      INSERT INTO public.trip_days(event_id, ordinal, title, narrative, date, stops, media)
      VALUES (
        p_event_id,
        (v_item->>'ordinal')::smallint,
        v_item->>'title',
        NULLIF(v_item->>'narrative', ''),
        NULLIF(v_item->>'date', '')::date,
        COALESCE(v_item->'stops', '[]'::jsonb),
        COALESCE(v_item->'media', '[]'::jsonb)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------- inclusions --
  IF p_patch ? 'inclusions' THEN
    IF jsonb_typeof(p_patch->'inclusions') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'inclusions') i
          WHERE COALESCE(i->>'kind', '') NOT IN ('included', 'excluded')
             OR NULLIF(btrim(i->>'item'), '') IS NULL
             OR COALESCE((i->>'ordinal')::int, -1) < 0)
    THEN
      RAISE EXCEPTION 'trip_inclusions_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'inclusions') LOOP
      INSERT INTO public.trip_inclusions(event_id, kind, item, ordinal)
      VALUES (p_event_id, v_item->>'kind', v_item->>'item', (v_item->>'ordinal')::smallint);
    END LOOP;
  END IF;

  ------------------------------------------------------------------- tiers --
  IF p_patch ? 'tiers' THEN
    IF jsonb_typeof(p_patch->'tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    v_currency := v_event.currency;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;

      IF COALESCE((v_item->>'deleted')::boolean, false) THEN
        IF v_ticket_type IS NULL THEN RAISE EXCEPTION 'trip_tier_id_required'; END IF;
        IF EXISTS (
          SELECT 1 FROM public.tickets
           WHERE ticket_type_id = v_ticket_type
             AND status IN ('valid', 'used', 'transferred')
        ) THEN
          RAISE EXCEPTION 'tier_delete_with_sales';
        END IF;
        UPDATE public.ticket_types
           SET deleted_at = now(), updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        CONTINUE;
      END IF;

      PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');

      IF v_ticket_type IS NULL THEN
        IF NULLIF(btrim(v_item->>'tier_name'), '') IS NULL
           OR COALESCE((v_item->>'price_cents')::int, -1) < 0
           OR COALESCE((v_item->>'capacity')::int, 0) < 1 THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.ticket_types(
          event_id, name, price_cents, currency, quantity_total, is_unlimited,
          is_free, min_purchase_qty, available_online, available_in_person, display_order
        ) VALUES (
          p_event_id,
          v_item->>'tier_name',
          COALESCE((v_item->>'price_cents')::int, 0),
          v_currency,
          (v_item->>'capacity')::int,
          false,
          COALESCE((v_item->>'price_cents')::int, 0) = 0,
          1, true, false,
          COALESCE((v_item->>'display_order')::int, 0)
        ) RETURNING id INTO v_ticket_type;
        INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
        VALUES (p_event_id, v_ticket_type, v_item->>'tier_name',
                COALESCE(v_item->'tier_metadata', '{}'::jsonb));
      ELSE
        IF (v_item ? 'price_cents' AND (v_item->>'price_cents')::int < 0)
           OR (v_item ? 'capacity' AND (v_item->>'capacity')::int < 1) THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        UPDATE public.ticket_types SET
          name = COALESCE(v_item->>'tier_name', name),
          price_cents = COALESCE((v_item->>'price_cents')::int, price_cents),
          quantity_total = COALESCE((v_item->>'capacity')::int, quantity_total),
          is_free = COALESCE((v_item->>'price_cents')::int, price_cents) = 0,
          updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        UPDATE public.trip_pricing_tiers SET
          tier_name = COALESCE(v_item->>'tier_name', tier_name),
          tier_metadata = COALESCE(v_item->'tier_metadata', tier_metadata)
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      END IF;
    END LOOP;
  END IF;

  ----------------------------------------------------------- intake schemas --
  IF p_patch ? 'intake_schemas' THEN
    IF jsonb_typeof(p_patch->'intake_schemas') <> 'array' THEN
      RAISE EXCEPTION 'trip_intake_schemas_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'intake_schemas') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;
      IF v_ticket_type IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.trip_pricing_tiers
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type
      ) THEN
        RAISE EXCEPTION 'trip_intake_schema_unknown_tier';
      END IF;
      IF NOT (v_item ? 'schema') OR jsonb_typeof(v_item->'schema') = 'null' THEN
        DELETE FROM public.trip_intake_schemas
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      ELSE
        IF NOT public.validate_trip_intake_schema(v_item->'schema') THEN
          RAISE EXCEPTION 'trip_intake_schema_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.trip_intake_schemas(event_id, ticket_type_id, schema, schema_version_id)
        VALUES (p_event_id, v_ticket_type, v_item->'schema',
                NULLIF(v_item#>>'{schema,schema_version_id}', '')::uuid)
        ON CONFLICT (event_id, ticket_type_id) DO UPDATE
          SET schema = EXCLUDED.schema,
              schema_version_id = EXCLUDED.schema_version_id,
              updated_at = now();
      END IF;
    END LOOP;
  END IF;

  ---------------------------------------------------------------- settings --
  IF p_patch ? 'settings' THEN
    IF jsonb_typeof(p_patch->'settings') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'settings') key
       WHERE key <> ALL (ARRAY[
         'refund_policy', 'booking_deadline', 'bookings_closed',
         'pass_tax', 'pass_mingla_fee', 'pass_service_fee'])
    ) THEN
      RAISE EXCEPTION 'trip_settings_patch_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.events SET
      refund_policy = CASE WHEN (p_patch->'settings') ? 'refund_policy'
                THEN p_patch#>'{settings,refund_policy}' ELSE refund_policy END,
      booking_deadline = CASE WHEN (p_patch->'settings') ? 'booking_deadline'
                THEN NULLIF(p_patch#>>'{settings,booking_deadline}', '')::timestamptz ELSE booking_deadline END,
      bookings_closed = CASE WHEN (p_patch->'settings') ? 'bookings_closed'
                THEN (p_patch#>>'{settings,bookings_closed}')::boolean ELSE bookings_closed END,
      pass_tax = CASE WHEN (p_patch->'settings') ? 'pass_tax'
                THEN (p_patch#>>'{settings,pass_tax}')::boolean ELSE pass_tax END,
      pass_mingla_fee = CASE WHEN (p_patch->'settings') ? 'pass_mingla_fee'
                THEN (p_patch#>>'{settings,pass_mingla_fee}')::boolean ELSE pass_mingla_fee END,
      pass_service_fee = CASE WHEN (p_patch->'settings') ? 'pass_service_fee'
                THEN (p_patch#>>'{settings,pass_service_fee}')::boolean ELSE pass_service_fee END,
      updated_at = now()
     WHERE id = p_event_id;
  END IF;

  -- A sidecar-only patch still advances the graph revision, so the next
  -- compare-and-swap sees a moved target.
  UPDATE public.events SET updated_at = now() WHERE id = p_event_id;

  v_result := public.biz_get_trip_draft_graph(p_event_id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1388_guard_state_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stay_history_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'stay_quotes' THEN
    IF OLD.status <> NEW.status AND NOT (
      (OLD.status = 'building' AND NEW.status = 'active')
      OR (
        OLD.status = 'active'
        AND NEW.status IN ('expired', 'consumed')
      )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_groups' THEN
    IF OLD.state <> NEW.state AND NOT (
       (
         OLD.state = 'instant_payment_pending'
         AND NEW.state IN (
           'finalizing', 'cancelled', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'request_pending'
         AND NEW.state IN (
           'approved_payment_required',
           'declined',
           'request_expired',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'approved_payment_required'
         AND NEW.state IN (
           'finalizing',
           'request_expired',
           'cancelled',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'finalizing'
         AND NEW.state IN ('confirmed', 'reconciliation_required')
       )
       OR (
         OLD.state = 'confirmed'
         AND NEW.state IN (
           'partially_cancelled', 'cancelled', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'partially_cancelled'
         AND NEW.state IN ('cancelled', 'reconciliation_required')
       )
       OR (
         OLD.state = 'reconciliation_required'
         AND NEW.state IN (
           'finalizing',
           'confirmed',
           'partially_cancelled',
           'cancelled'
         )
       )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_reservation_lines' THEN
    IF OLD.state <> NEW.state AND NOT (
       (
         OLD.state = 'payment_pending'
         AND NEW.state IN (
           'confirmed', 'cancelled', 'expired', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'request_pending'
         AND NEW.state IN (
           'approved_payment_required',
           'declined',
           'expired',
           'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'approved_payment_required'
         AND NEW.state IN (
           'confirmed', 'cancelled', 'expired', 'reconciliation_required'
         )
       )
       OR (
         OLD.state = 'confirmed'
         AND NEW.state IN ('cancelled', 'reconciliation_required')
       )
       OR (
         OLD.state = 'reconciliation_required'
         AND NEW.state IN ('confirmed', 'cancelled')
       )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_holds' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_hold_identity_immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.state <> NEW.state AND NOT (
      (
        OLD.state = 'active'
        AND NEW.state IN (
          'converted', 'released', 'expired', 'reconciliation_required'
        )
      )
      OR (
        OLD.state = 'reconciliation_required'
        AND NEW.state IN ('converted', 'released')
      )
    ) THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  ELSIF TG_TABLE_NAME = 'stay_inventory_commitments' THEN
    IF NEW.id <> OLD.id
       OR NEW.group_id <> OLD.group_id
       OR NEW.reservation_line_id <> OLD.reservation_line_id
       OR NEW.resource_type <> OLD.resource_type
       OR NEW.offering_id <> OLD.offering_id
       OR NEW.room_date IS DISTINCT FROM OLD.room_date
       OR NEW.place_window_id IS DISTINCT FROM OLD.place_window_id
       OR NEW.quantity <> OLD.quantity
       OR NEW.exclusive_unit_id IS DISTINCT FROM OLD.exclusive_unit_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'stay_commitment_identity_immutable'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.state <> NEW.state
       AND NOT (OLD.state = 'active' AND NEW.state = 'released') THEN
      RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.biz_manage_stay_inventory(p_action text, p_venue_id uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_expected_version bigint DEFAULT NULL::bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_offering public.stay_offerings%ROWTYPE;
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_offering_id uuid;
  v_currency character(3);
  v_item jsonb;
  v_job public.stay_bulk_jobs%ROWTYPE;
  v_success integer := 0;
  v_failed integer := 0;
  v_index integer := 0;
  v_error text;
  v_rule public.stay_place_schedule_rules%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_date date;
  v_end_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_start_resolution text;
  v_end_resolution text;
  v_local_window_start timestamp;
  v_local_window_end timestamp;
  v_local_slot_start timestamp;
  v_local_slot_end timestamp;
  v_next_version integer;
  v_current_price public.stay_price_versions%ROWTYPE;
  v_current_policy public.stay_policy_versions%ROWTYPE;
  v_current_fee public.stay_fee_versions%ROWTYPE;
  v_media_id uuid;
  v_request_hash text;
  v_requires_finance boolean;
  v_requires_inventory boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND OR v_venue.venue_category <> 'stay' THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_requires_finance := v_action IN (
    'set_price',
    'set_policy',
    'replace_fees',
    'resolve_currency_reconciliation'
  )
     OR (
       v_action = 'create_offering'
       AND (
         p_payload ? 'price'
         OR jsonb_array_length(COALESCE(p_payload->'fees', '[]'::jsonb)) > 0
       )
     )
     OR (
       v_action = 'bulk_create'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) item
         WHERE item ? 'price'
            OR jsonb_array_length(COALESCE(item->'fees', '[]'::jsonb)) > 0
       )
     )
     OR (
       v_action = 'upsert_room_nights'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p_payload->'nights', '[]'::jsonb)) night
         WHERE night ? 'priceOverrideMinor'
       )
     )
     OR (
       v_action = 'upsert_place_windows'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           COALESCE(p_payload->'windows', '[]'::jsonb)
         ) window_item
         WHERE window_item ? 'priceOverrideMinor'
       )
     );
  v_requires_inventory := v_action NOT IN (
    'get',
    'set_price',
    'set_policy',
    'replace_fees',
    'resolve_currency_reconciliation'
  );

  IF v_action = 'get' THEN
    IF NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'read'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_requires_inventory AND NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'inventory'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_requires_finance AND NOT public.issue_1387_has_brand_capability(
      v_venue.brand_id, v_uid, 'finance'
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  IF v_action = 'resolve_currency_reconciliation' THEN
    RETURN public.issue_1387_resolve_currency_reconciliation(
      v_venue.brand_id,
      (p_payload->>'reconciliationId')::uuid,
      p_payload->>'decision',
      NULLIF(p_payload->>'fxSnapshotId', '')::uuid,
      COALESCE(p_payload->'ranges', '[]'::jsonb),
      COALESCE(p_payload->'stayItems', '[]'::jsonb),
      p_request_id
    );
  ELSIF v_action = 'get' THEN
    RETURN public.issue_1387_stay_inventory_snapshot(p_venue_id);
  ELSIF v_action = 'save_settings' THEN
    INSERT INTO public.stay_settings (
      venue_id, brand_id, property_kind, timezone, default_booking_mode,
      check_in_time, check_out_time, instant_payment_hold_minutes,
      request_response_hours, approved_payment_minutes, booking_horizon_days,
      booking_state, house_rules, created_by, updated_by
    ) VALUES (
      p_venue_id,
      v_venue.brand_id,
      NULLIF(lower(pg_catalog.btrim(p_payload->>'propertyKind')), ''),
      COALESCE(NULLIF(pg_catalog.btrim(p_payload->>'timezone'), ''), 'UTC'),
      COALESCE(
        NULLIF(lower(pg_catalog.btrim(p_payload->>'defaultBookingMode')), ''),
        'request'
      ),
      COALESCE(NULLIF(p_payload->>'checkInTime', '')::time, '15:00'::time),
      COALESCE(NULLIF(p_payload->>'checkOutTime', '')::time, '11:00'::time),
      COALESCE((p_payload->>'instantPaymentHoldMinutes')::smallint, 15),
      COALESCE((p_payload->>'requestResponseHours')::smallint, 24),
      COALESCE((p_payload->>'approvedPaymentMinutes')::smallint, 30),
      COALESCE((p_payload->>'bookingHorizonDays')::smallint, 365),
      COALESCE(NULLIF(lower(p_payload->>'bookingState'), ''), 'draft'),
      NULLIF(p_payload->>'houseRules', ''),
      v_uid,
      v_uid
    )
    ON CONFLICT (venue_id) DO UPDATE
      SET property_kind = EXCLUDED.property_kind,
          timezone = EXCLUDED.timezone,
          default_booking_mode = EXCLUDED.default_booking_mode,
          check_in_time = EXCLUDED.check_in_time,
          check_out_time = EXCLUDED.check_out_time,
          instant_payment_hold_minutes = EXCLUDED.instant_payment_hold_minutes,
          request_response_hours = EXCLUDED.request_response_hours,
          approved_payment_minutes = EXCLUDED.approved_payment_minutes,
          booking_horizon_days = EXCLUDED.booking_horizon_days,
          booking_state = EXCLUDED.booking_state,
          house_rules = EXCLUDED.house_rules,
          version = public.stay_settings.version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE p_expected_version IS NOT NULL
        AND public.stay_settings.version = p_expected_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
  ELSIF v_action = 'create_offering' THEN
    v_offering_id := public.issue_1387_create_offering_internal(
      v_venue.brand_id, p_venue_id, p_payload, v_uid
    );
  ELSIF v_action = 'update_offering' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    UPDATE public.stay_offerings
      SET name = COALESCE(NULLIF(pg_catalog.btrim(p_payload->>'name'), ''), name),
          summary = COALESCE(p_payload->>'summary', summary),
          description = COALESCE(p_payload->>'description', description),
          confirmation_mode = CASE WHEN p_payload ? 'confirmationMode'
            THEN NULLIF(
              lower(pg_catalog.btrim(p_payload->>'confirmationMode')), ''
            )
            ELSE confirmation_mode END,
          inventory_basis = COALESCE(
            NULLIF(lower(p_payload->>'inventoryBasis'), ''),
            inventory_basis
          ),
          unit_naming_mode = COALESCE(
            NULLIF(lower(p_payload->>'unitNamingMode'), ''),
            unit_naming_mode
          ),
          quantity = CASE WHEN p_payload ? 'quantity'
            THEN NULLIF(p_payload->>'quantity', '')::integer ELSE quantity END,
          capacity = CASE WHEN p_payload ? 'capacity'
            THEN NULLIF(p_payload->>'capacity', '')::integer ELSE capacity END,
          min_guests = COALESCE(
            (p_payload->>'minGuests')::integer, min_guests
          ),
          max_guests = COALESCE((p_payload->>'maxGuests')::integer, max_guests),
          max_adults = CASE WHEN p_payload ? 'maxAdults'
            THEN NULLIF(p_payload->>'maxAdults', '')::integer ELSE max_adults END,
          max_children = CASE WHEN p_payload ? 'maxChildren'
            THEN NULLIF(p_payload->>'maxChildren', '')::integer
            ELSE max_children END,
          place_pricing_basis = CASE WHEN p_payload ? 'placePricingBasis'
            THEN NULLIF(lower(p_payload->>'placePricingBasis'), '')
            ELSE place_pricing_basis END,
          min_notice_minutes = COALESCE(
            (p_payload->>'minNoticeMinutes')::integer, min_notice_minutes
          ),
          max_advance_days = CASE WHEN p_payload ? 'maxAdvanceDays'
            THEN NULLIF(p_payload->>'maxAdvanceDays', '')::integer
            ELSE max_advance_days END,
          buffer_before_minutes = COALESCE(
            (p_payload->>'bufferBeforeMinutes')::integer,
            buffer_before_minutes
          ),
          buffer_after_minutes = COALESCE(
            (p_payload->>'bufferAfterMinutes')::integer,
            buffer_after_minutes
          ),
          amenities = CASE WHEN p_payload ? 'amenities' THEN ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'amenities')
          ) ELSE amenities END,
          safety_rules = CASE WHEN p_payload ? 'safetyRules' THEN ARRAY(
            SELECT jsonb_array_elements_text(p_payload->'safetyRules')
          ) ELSE safety_rules END,
          accessibility_features = CASE
            WHEN p_payload ? 'accessibilityFeatures' THEN ARRAY(
              SELECT jsonb_array_elements_text(p_payload->'accessibilityFeatures')
            ) ELSE accessibility_features END,
          access_scope = COALESCE(
            NULLIF(lower(pg_catalog.btrim(p_payload->>'accessScope')), ''),
            access_scope
          ),
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE id = v_offering_id
        AND venue_id = p_venue_id
        AND version = p_expected_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
  ELSIF v_action = 'replace_units' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_offering_id
      AND venue_id = p_venue_id
      AND inventory_basis = 'exclusive_units'
      AND unit_naming_mode = 'named'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_named_unit_not_allowed' USING ERRCODE = '22023';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF jsonb_typeof(COALESCE(p_payload->'units', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(p_payload->'units', '[]'::jsonb))
          > v_offering.quantity THEN
      RAISE EXCEPTION 'stay_unit_quantity_exceeded' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_units
      SET status = 'archived', updated_by = v_uid, updated_at = now(),
          version = version + 1
      WHERE offering_id = v_offering_id AND status <> 'archived';
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_payload->'units', '[]'::jsonb))
    LOOP
      INSERT INTO public.stay_units (
        offering_id, brand_id, venue_id, name, external_reference,
        created_by, updated_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        pg_catalog.btrim(v_item->>'name'),
        NULLIF(pg_catalog.btrim(v_item->>'externalReference'), ''),
        v_uid, v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'change_status' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering
    FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND OR v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF lower(p_payload->>'status') = 'live' THEN
      SELECT * INTO v_settings
      FROM public.stay_settings s
      WHERE s.venue_id = p_venue_id AND s.booking_state = 'active';
      IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.stay_price_versions p
        WHERE p.offering_id = v_offering_id AND p.effective_to IS NULL
      ) OR NOT EXISTS (
        SELECT 1 FROM public.stay_policy_versions p
        WHERE p.offering_id = v_offering_id AND p.effective_to IS NULL
      ) OR (
        SELECT count(*) FROM public.stay_offering_media m
        WHERE m.offering_id = v_offering_id
          AND m.status = 'ready' AND m.is_cover
      ) <> 1 THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF pg_catalog.btrim(v_offering.description) = ''
         OR v_venue.claim_status <> 'verified' THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.kind = 'room' AND NOT EXISTS (
        SELECT 1 FROM public.stay_room_nights n
        WHERE n.offering_id = v_offering_id
          AND NOT n.stop_sell
          AND n.sellable_quantity > 0
          AND n.local_date >=
            (now() AT TIME ZONE v_settings.timezone)::date
      ) THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.kind = 'place' AND NOT EXISTS (
        SELECT 1 FROM public.stay_place_windows w
        WHERE w.offering_id = v_offering_id
          AND NOT w.stop_sell
          AND COALESCE(w.sellable_units, w.sellable_capacity, 0) > 0
          AND w.ends_at > now()
      ) THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF v_offering.unit_naming_mode = 'named' AND (
        SELECT count(*) FROM public.stay_units u
        WHERE u.offering_id = v_offering_id AND u.status = 'active'
      ) <> v_offering.quantity THEN
        RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
      END IF;
      IF NOT public.pg_brand_can_collect(v_venue.brand_id)
         OR NOT EXISTS (
           SELECT 1 FROM public.brands b
           WHERE b.id = v_venue.brand_id AND b.default_currency IS NOT NULL
         ) THEN
        RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    UPDATE public.stay_offerings
      SET status = lower(p_payload->>'status'),
          archived_at = CASE WHEN lower(p_payload->>'status') = 'archived'
            THEN now() ELSE NULL END,
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'set_policy' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_current_policy
    FROM public.stay_policy_versions
    WHERE offering_id = v_offering_id AND effective_to IS NULL
    FOR UPDATE;
    v_next_version := COALESCE(v_current_policy.version_number, 0) + 1;
    IF v_current_policy.id IS NOT NULL THEN
      UPDATE public.stay_policy_versions SET effective_to = now()
      WHERE id = v_current_policy.id;
    END IF;
    INSERT INTO public.stay_policy_versions (
      offering_id, brand_id, venue_id, version_number,
      cancellation_policy, free_cancel_cutoff_minutes,
      late_refund_basis_points, no_show_refund_basis_points,
      operator_cancel_refund_basis_points, request_terms, house_rules,
      terms, created_by
    ) VALUES (
      v_offering_id, v_venue.brand_id, p_venue_id, v_next_version,
      pg_catalog.btrim(p_payload->>'cancellationPolicy'),
      COALESCE((p_payload->>'freeCancelCutoffMinutes')::integer, 0),
      COALESCE((p_payload->>'lateRefundBasisPoints')::integer, 0),
      COALESCE((p_payload->>'noShowRefundBasisPoints')::integer, 0),
      COALESCE(
        (p_payload->>'operatorCancelRefundBasisPoints')::integer, 10000
      ),
      NULLIF(p_payload->>'requestTerms', ''),
      NULLIF(p_payload->>'houseRules', ''),
      COALESCE(p_payload->'terms', '{}'::jsonb), v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'set_price' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    v_currency := public.issue_1387_assert_authoring_currency(
      v_venue.brand_id,
      upper(p_payload->>'currencyCode')::character(3)
    );
    SELECT * INTO v_current_price
    FROM public.stay_price_versions
    WHERE offering_id = v_offering_id AND effective_to IS NULL
    FOR UPDATE;
    v_next_version := COALESCE(v_current_price.version_number, 0) + 1;
    IF v_current_price.id IS NOT NULL THEN
      UPDATE public.stay_price_versions SET effective_to = now()
      WHERE id = v_current_price.id;
    END IF;
    INSERT INTO public.stay_price_versions (
      offering_id, brand_id, venue_id, version_number, amount_minor,
      currency_code, pricing_unit, supersedes_version_id, created_by
    ) VALUES (
      v_offering_id, v_venue.brand_id, p_venue_id, v_next_version,
      (p_payload->>'amountMinor')::bigint, v_currency,
      CASE
        WHEN v_offering.kind = 'room' THEN 'room_night'
        WHEN v_offering.place_pricing_basis = 'per_booking'
          THEN 'place_booking'
        WHEN v_offering.place_pricing_basis = 'per_unit'
          THEN 'place_unit'
        ELSE 'place_guest'
      END,
      v_current_price.id, v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'replace_fees' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    FOR v_current_fee IN
      SELECT * FROM public.stay_fee_versions
      WHERE offering_id = v_offering_id AND effective_to IS NULL
      FOR UPDATE
    LOOP
      UPDATE public.stay_fee_versions SET effective_to = now()
      WHERE id = v_current_fee.id;
    END LOOP;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(p_payload->'fees', '[]'::jsonb)
      )
    LOOP
      SELECT COALESCE(max(f.version_number), 0) + 1
      INTO v_next_version
      FROM public.stay_fee_versions f
      WHERE f.offering_id = v_offering_id
        AND f.fee_key = lower(pg_catalog.btrim(v_item->>'feeKey'));
      IF lower(v_item->>'calculation') LIKE 'fixed_%' THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      INSERT INTO public.stay_fee_versions (
        offering_id, brand_id, venue_id, fee_key, label, version_number,
        fee_kind, calculation, amount_minor, basis_points, currency_code,
        display_mode, refund_treatment, created_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        lower(pg_catalog.btrim(v_item->>'feeKey')),
        pg_catalog.btrim(v_item->>'label'), v_next_version,
        COALESCE(NULLIF(lower(v_item->>'feeKind'), ''), 'mandatory_fee'),
        lower(v_item->>'calculation'),
        NULLIF(v_item->>'amountMinor', '')::bigint,
        NULLIF(v_item->>'basisPoints', '')::integer,
        v_currency,
        COALESCE(NULLIF(lower(v_item->>'displayMode'), ''), 'separate'),
        COALESCE(
          NULLIF(lower(v_item->>'refundTreatment'), ''), 'same_as_line'
        ),
        v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'attach_media' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF COALESCE((p_payload->>'isCover')::boolean, false) THEN
      UPDATE public.stay_offering_media SET is_cover = false, updated_at = now()
      WHERE offering_id = v_offering_id AND is_cover;
    END IF;
    v_media_id := public.issue_1387_attach_media_internal(
      v_offering_id,
      v_venue.brand_id,
      p_venue_id,
      p_payload,
      COALESCE(
        (p_payload->>'sortOrder')::integer,
        (SELECT COALESCE(max(m.sort_order), -1) + 1
         FROM public.stay_offering_media m
         WHERE m.offering_id = v_offering_id)
      ),
      v_uid
    );
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'reorder_media' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'mediaIds', '[]'::jsonb)) <> (
      SELECT count(*) FROM public.stay_offering_media m
      WHERE m.offering_id = v_offering_id
    ) OR (
      SELECT count(DISTINCT (value #>> '{}')::uuid)
      FROM jsonb_array_elements(COALESCE(p_payload->'mediaIds', '[]'::jsonb))
    ) <> jsonb_array_length(COALESCE(p_payload->'mediaIds', '[]'::jsonb)) THEN
      RAISE EXCEPTION 'stay_media_set_changed' USING ERRCODE = 'PT409';
    END IF;
    SET CONSTRAINTS public.stay_offering_media_sort_unique DEFERRED;
    v_index := 0;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_payload->'mediaIds')
    LOOP
      UPDATE public.stay_offering_media
        SET sort_order = v_index, updated_at = now()
        WHERE id = (v_item #>> '{}')::uuid
          AND offering_id = v_offering_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_media_set_changed' USING ERRCODE = 'PT409';
      END IF;
      v_index := v_index + 1;
    END LOOP;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering_id;
  ELSIF v_action = 'remove_media' THEN
    v_media_id := (p_payload->>'mediaId')::uuid;
    SELECT o.* INTO v_offering
    FROM public.stay_offerings o
    JOIN public.stay_offering_media m ON m.offering_id = o.id
    WHERE m.id = v_media_id AND o.venue_id = p_venue_id
    FOR UPDATE OF o;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_media_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_offering.version <> p_expected_version THEN
      RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.stay_offering_media m
      JOIN public.stay_offerings o ON o.id = m.offering_id
      WHERE m.id = v_media_id AND o.venue_id = p_venue_id
        AND o.status = 'live' AND m.is_cover
    ) THEN
      RAISE EXCEPTION 'stay_live_cover_required' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.stay_offering_media m
    USING public.stay_offerings o
    WHERE m.id = v_media_id
      AND o.id = m.offering_id
      AND o.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_media_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.stay_offerings
      SET version = version + 1, updated_by = v_uid, updated_at = now()
      WHERE id = v_offering.id;
  ELSIF v_action = 'bulk_create' THEN
    IF jsonb_typeof(p_payload->'items') <> 'array'
       OR jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'stay_invalid_bulk_request' USING ERRCODE = '22023';
    END IF;
    v_request_hash := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to((p_payload->'items')::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    INSERT INTO public.stay_bulk_jobs (
      venue_id, brand_id, idempotency_key, requested_count,
      request_payload, request_hash, request_id, created_by
    ) VALUES (
      p_venue_id, v_venue.brand_id,
      pg_catalog.btrim(p_payload->>'idempotencyKey'),
      jsonb_array_length(p_payload->'items'),
      p_payload->'items', v_request_hash, p_request_id, v_uid
    )
    ON CONFLICT (venue_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_job;
    IF v_job.id IS NULL THEN
      SELECT * INTO v_job FROM public.stay_bulk_jobs
      WHERE venue_id = p_venue_id
        AND idempotency_key = pg_catalog.btrim(p_payload->>'idempotencyKey');
      IF v_job.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = 'PT409';
      END IF;
      RETURN jsonb_build_object(
        'job', to_jsonb(v_job),
        'items', COALESCE((
          SELECT jsonb_agg(to_jsonb(i) ORDER BY i.item_index)
          FROM public.stay_bulk_job_items i WHERE i.job_id = v_job.id
        ), '[]'::jsonb),
        'replayed', true
      );
    END IF;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_payload->'items')
    LOOP
      BEGIN
        v_offering_id := public.issue_1387_create_offering_internal(
          v_venue.brand_id, p_venue_id, v_item, v_uid
        );
        INSERT INTO public.stay_bulk_job_items (
          job_id, item_index, status, offering_id, result
        ) VALUES (
          v_job.id, v_index, 'succeeded', v_offering_id,
          jsonb_build_object('offeringId', v_offering_id)
        );
        v_success := v_success + 1;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
        INSERT INTO public.stay_bulk_job_items (
          job_id, item_index, status, error_code, safe_error_message
        ) VALUES (
          v_job.id, v_index, 'failed',
          CASE WHEN v_error LIKE 'stay_%' THEN split_part(v_error, ' ', 1)
            ELSE 'stay_item_invalid' END,
          CASE WHEN v_error LIKE 'stay_%'
            THEN 'This item needs review.'
            ELSE 'This item could not be created.' END
        );
        v_failed := v_failed + 1;
      END;
      v_index := v_index + 1;
    END LOOP;
    UPDATE public.stay_bulk_jobs
      SET status = CASE WHEN v_failed = 0 THEN 'completed'
        WHEN v_success = 0 THEN 'failed' ELSE 'completed_with_errors' END,
          succeeded_count = v_success,
          failed_count = v_failed,
          completed_at = now()
      WHERE id = v_job.id
      RETURNING * INTO v_job;
    RETURN jsonb_build_object(
      'job', to_jsonb(v_job),
      'items', (
        SELECT jsonb_agg(to_jsonb(i) ORDER BY i.item_index)
        FROM public.stay_bulk_job_items i WHERE i.job_id = v_job.id
      ),
      'replayed', false
    );
  ELSIF v_action = 'upsert_room_nights' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id AND kind = 'room';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_room_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_array_length(COALESCE(p_payload->'nights', '[]'::jsonb)) > 366 THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(
        COALESCE(p_payload->'nights', '[]'::jsonb)
      )
    LOOP
      IF (v_item->>'localDate')::date
           < (now() AT TIME ZONE v_settings.timezone)::date
         OR (v_item->>'localDate')::date
           > (now() AT TIME ZONE v_settings.timezone)::date
             + LEAST(
               v_settings.booking_horizon_days,
               COALESCE(
                 v_offering.max_advance_days,
                 v_settings.booking_horizon_days
               )
             ) THEN
        RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
      END IF;
      IF v_item ? 'priceOverrideMinor'
         AND NULLIF(v_item->>'priceOverrideMinor', '') IS NOT NULL THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      INSERT INTO public.stay_room_nights (
        offering_id, local_date, brand_id, venue_id, sellable_quantity,
        price_override_minor, currency_code, stop_sell, minimum_nights,
        maximum_nights, updated_by
      ) VALUES (
        v_offering_id, (v_item->>'localDate')::date,
        v_venue.brand_id, p_venue_id,
        COALESCE((v_item->>'sellableQuantity')::integer, v_offering.quantity),
        NULLIF(v_item->>'priceOverrideMinor', '')::bigint,
        v_currency,
        COALESCE((v_item->>'stopSell')::boolean, false),
        COALESCE((v_item->>'minimumNights')::integer, 1),
        NULLIF(v_item->>'maximumNights', '')::integer,
        v_uid
      )
      ON CONFLICT (offering_id, local_date) DO UPDATE
        SET sellable_quantity = EXCLUDED.sellable_quantity,
            price_override_minor = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN EXCLUDED.price_override_minor
              ELSE public.stay_room_nights.price_override_minor
            END,
            currency_code = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN EXCLUDED.currency_code
              ELSE public.stay_room_nights.currency_code
            END,
            stop_sell = EXCLUDED.stop_sell,
            minimum_nights = EXCLUDED.minimum_nights,
            maximum_nights = EXCLUDED.maximum_nights,
            version = public.stay_room_nights.version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE v_item ? 'expectedVersion'
          AND public.stay_room_nights.version =
            (v_item->>'expectedVersion')::bigint;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
      END IF;
    END LOOP;
  ELSIF v_action = 'upsert_place_schedule' THEN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    SELECT * INTO v_offering FROM public.stay_offerings
    WHERE id = v_offering_id AND venue_id = p_venue_id AND kind = 'place';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_place_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    IF (p_payload->>'localStartDate')::date
         < (now() AT TIME ZONE v_settings.timezone)::date
       OR COALESCE(
         NULLIF(p_payload->>'localEndDate', '')::date,
         (p_payload->>'localStartDate')::date
       ) > (now() AT TIME ZONE v_settings.timezone)::date
           + LEAST(
             v_settings.booking_horizon_days,
             COALESCE(
               v_offering.max_advance_days,
               v_settings.booking_horizon_days
             )
           ) THEN
      RAISE EXCEPTION 'stay_date_outside_horizon' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'scheduleRuleId' THEN
      DELETE FROM public.stay_place_windows w
      WHERE w.schedule_rule_id = (p_payload->>'scheduleRuleId')::uuid
        AND w.offering_id = v_offering_id;
      UPDATE public.stay_place_schedule_rules
        SET mode = lower(p_payload->>'mode'),
            timezone = p_payload->>'timezone',
            local_start_date = (p_payload->>'localStartDate')::date,
            local_end_date = NULLIF(p_payload->>'localEndDate', '')::date,
            weekdays = ARRAY(
              SELECT value::text::smallint
              FROM jsonb_array_elements(
                COALESCE(p_payload->'weekdays', '[]'::jsonb)
              )
            ),
            local_start_time = NULLIF(p_payload->>'localStartTime', '')::time,
            local_end_time = NULLIF(p_payload->>'localEndTime', '')::time,
            slot_duration_minutes =
              NULLIF(p_payload->>'slotDurationMinutes', '')::integer,
            slot_interval_minutes =
              NULLIF(p_payload->>'slotIntervalMinutes', '')::integer,
            full_day_start_time =
              NULLIF(p_payload->>'fullDayStartTime', '')::time,
            full_day_end_time =
              NULLIF(p_payload->>'fullDayEndTime', '')::time,
            dst_fold_policy = COALESCE(
              NULLIF(lower(p_payload->>'dstFoldPolicy'), ''),
              dst_fold_policy
            ),
            active = COALESCE((p_payload->>'active')::boolean, active),
            version = version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE id = (p_payload->>'scheduleRuleId')::uuid
          AND offering_id = v_offering_id
          AND version = p_expected_version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
      END IF;
    ELSE
      INSERT INTO public.stay_place_schedule_rules (
        offering_id, brand_id, venue_id, mode, timezone,
        local_start_date, local_end_date, weekdays,
        local_start_time, local_end_time, slot_duration_minutes,
        slot_interval_minutes, full_day_start_time, full_day_end_time,
        dst_fold_policy, created_by, updated_by
      ) VALUES (
        v_offering_id, v_venue.brand_id, p_venue_id,
        lower(p_payload->>'mode'),
        p_payload->>'timezone',
        (p_payload->>'localStartDate')::date,
        NULLIF(p_payload->>'localEndDate', '')::date,
        ARRAY(
          SELECT value::text::smallint
          FROM jsonb_array_elements(
            COALESCE(p_payload->'weekdays', '[]'::jsonb)
          )
        ),
        NULLIF(p_payload->>'localStartTime', '')::time,
        NULLIF(p_payload->>'localEndTime', '')::time,
        NULLIF(p_payload->>'slotDurationMinutes', '')::integer,
        NULLIF(p_payload->>'slotIntervalMinutes', '')::integer,
        NULLIF(p_payload->>'fullDayStartTime', '')::time,
        NULLIF(p_payload->>'fullDayEndTime', '')::time,
        COALESCE(NULLIF(lower(p_payload->>'dstFoldPolicy'), ''), 'reject'),
        v_uid, v_uid
      );
    END IF;
  ELSIF v_action = 'materialize_place_windows' THEN
    SELECT * INTO v_rule
    FROM public.stay_place_schedule_rules
    WHERE id = (p_payload->>'scheduleRuleId')::uuid
      AND venue_id = p_venue_id
      AND active
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_schedule_rule_not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_offering
    FROM public.stay_offerings o
    WHERE o.id = v_rule.offering_id AND o.venue_id = p_venue_id
    FOR UPDATE;
    SELECT * INTO v_settings
    FROM public.stay_settings s
    WHERE s.venue_id = p_venue_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_settings_required' USING ERRCODE = 'P0001';
    END IF;
    v_date := GREATEST(
      v_rule.local_start_date,
      (p_payload->>'fromDate')::date
    );
    v_end_date := LEAST(
      COALESCE(v_rule.local_end_date, (p_payload->>'toDate')::date),
      (p_payload->>'toDate')::date
    );
    IF v_end_date < v_date
       OR v_end_date - v_date > LEAST(
         v_settings.booking_horizon_days,
         COALESCE(
           v_offering.max_advance_days,
           v_settings.booking_horizon_days
         )
       )
       OR v_end_date > (now() AT TIME ZONE v_settings.timezone)::date
         + LEAST(
           v_settings.booking_horizon_days,
           COALESCE(
             v_offering.max_advance_days,
             v_settings.booking_horizon_days
           )
         ) THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.stay_place_windows w
    WHERE w.schedule_rule_id = v_rule.id
      AND w.local_date BETWEEN v_date AND v_end_date;
    WHILE v_date <= v_end_date LOOP
      IF (
        v_rule.mode = 'fixed_slots' AND v_date = v_rule.local_start_date
      ) OR (
        v_rule.mode <> 'fixed_slots'
        AND extract(dow FROM v_date)::smallint = ANY(v_rule.weekdays)
      ) THEN
        IF v_rule.mode = 'full_day' THEN
          v_local_window_start := v_date + v_rule.full_day_start_time;
          v_local_window_end := v_date + v_rule.full_day_end_time;
          IF v_local_window_end <= v_local_window_start THEN
            v_local_window_end := v_local_window_end + interval '1 day';
          END IF;
        ELSE
          v_local_window_start := v_date + v_rule.local_start_time;
          v_local_window_end := v_date + v_rule.local_end_time;
          IF v_local_window_end <= v_local_window_start THEN
            v_local_window_end := v_local_window_end + interval '1 day';
          END IF;
        END IF;
        v_local_slot_start := v_local_window_start;
        v_local_slot_end := CASE
          WHEN v_rule.mode = 'repeating_windows' THEN
            v_local_slot_start
              + pg_catalog.make_interval(mins => v_rule.slot_duration_minutes)
          ELSE v_local_window_end
        END;
        WHILE v_local_slot_end <= v_local_window_end LOOP
        SELECT r.instant, r.resolution
          INTO v_start, v_start_resolution
        FROM public.issue_1387_resolve_local_timestamp(
          v_local_slot_start::date, v_local_slot_start::time,
          v_rule.timezone,
          v_rule.dst_fold_policy
        ) r;
        SELECT r.instant, r.resolution
          INTO v_end, v_end_resolution
        FROM public.issue_1387_resolve_local_timestamp(
          v_local_slot_end::date, v_local_slot_end::time,
          v_rule.timezone, v_rule.dst_fold_policy
        ) r;
        INSERT INTO public.stay_place_windows (
          offering_id, schedule_rule_id, brand_id, venue_id, local_date,
          starts_at, ends_at, sellable_units, sellable_capacity,
          dst_resolution, updated_by
        ) VALUES (
          v_rule.offering_id, v_rule.id, v_rule.brand_id, v_rule.venue_id,
          v_date, v_start, v_end,
          CASE WHEN v_offering.inventory_basis = 'exclusive_units'
            THEN v_offering.quantity ELSE NULL END,
          CASE WHEN v_offering.inventory_basis = 'shared_capacity'
            THEN v_offering.capacity ELSE NULL END,
          CASE WHEN v_start_resolution = 'unambiguous'
                    AND v_end_resolution = 'unambiguous'
            THEN 'unambiguous' ELSE v_rule.dst_fold_policy END,
          v_uid
        )
        ON CONFLICT (offering_id, starts_at, ends_at) DO UPDATE
          SET schedule_rule_id = EXCLUDED.schedule_rule_id,
              sellable_units = EXCLUDED.sellable_units,
              sellable_capacity = EXCLUDED.sellable_capacity,
              dst_resolution = EXCLUDED.dst_resolution,
              version = public.stay_place_windows.version + 1,
              updated_by = v_uid,
              updated_at = now();
          EXIT WHEN v_rule.mode <> 'repeating_windows';
          v_local_slot_start := v_local_slot_start
            + pg_catalog.make_interval(mins => v_rule.slot_interval_minutes);
          v_local_slot_end := v_local_slot_start
            + pg_catalog.make_interval(mins => v_rule.slot_duration_minutes);
        END LOOP;
      END IF;
      v_date := v_date + 1;
    END LOOP;
  ELSIF v_action = 'upsert_place_windows' THEN
    IF jsonb_array_length(
      COALESCE(p_payload->'windows', '[]'::jsonb)
    ) > 500 THEN
      RAISE EXCEPTION 'stay_date_range_too_large' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(p_payload->'windows', '[]'::jsonb))
    LOOP
      SELECT w.* INTO v_window
      FROM public.stay_place_windows w
      JOIN public.stay_offerings o ON o.id = w.offering_id
      WHERE w.id = (v_item->>'windowId')::uuid
        AND w.venue_id = p_venue_id
        AND o.kind = 'place'
      FOR UPDATE OF w;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_place_window_not_found' USING ERRCODE = 'P0002';
      END IF;
      IF v_window.version <> (v_item->>'expectedVersion')::bigint THEN
        RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
      END IF;
      SELECT * INTO v_offering
      FROM public.stay_offerings o
      WHERE o.id = v_window.offering_id;
      IF v_item ? 'priceOverrideMinor'
         AND NULLIF(v_item->>'priceOverrideMinor', '') IS NOT NULL THEN
        v_currency := public.issue_1387_assert_authoring_currency(
          v_venue.brand_id,
          upper(v_item->>'currencyCode')::character(3)
        );
      ELSE
        v_currency := NULL;
      END IF;
      UPDATE public.stay_place_windows
        SET sellable_units = CASE
              WHEN v_offering.inventory_basis = 'exclusive_units'
              THEN COALESCE(
                (v_item->>'sellableUnits')::integer,
                sellable_units
              )
              ELSE NULL
            END,
            sellable_capacity = CASE
              WHEN v_offering.inventory_basis = 'shared_capacity'
              THEN COALESCE(
                (v_item->>'sellableCapacity')::integer,
                sellable_capacity
              )
              ELSE NULL
            END,
            stop_sell = COALESCE(
              (v_item->>'stopSell')::boolean, stop_sell
            ),
            price_override_minor = CASE
              WHEN v_item ? 'priceOverrideMinor'
              THEN NULLIF(v_item->>'priceOverrideMinor', '')::bigint
              ELSE price_override_minor
            END,
            currency_code = CASE
              WHEN v_item ? 'priceOverrideMinor' THEN v_currency
              ELSE currency_code
            END,
            version = version + 1,
            updated_by = v_uid,
            updated_at = now()
        WHERE id = v_window.id;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'stay_invalid_action' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'inventory', public.issue_1387_stay_inventory_snapshot(p_venue_id),
    'offeringId', v_offering_id,
    'requestId', p_request_id
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1388_manage_request(p_action text, p_group_id uuid, p_expected_version bigint, p_idempotency_key text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_existing_event public.stay_reservation_events%ROWTYPE;
  v_event_type text;
  v_event_key text;
  v_payment_deadline timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_action NOT IN ('approve_request', 'decline_request')
     OR p_group_id IS NULL
     OR p_expected_version IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_group.brand_id, v_uid, 'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = v_group.venue_id
  FOR UPDATE;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id
  FOR UPDATE;
  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = p_group_id
  FOR UPDATE;

  v_event_type := CASE v_action
    WHEN 'approve_request' THEN 'stay_request_approved'
    ELSE 'stay_request_declined'
  END;
  v_event_key := v_action || ':' || pg_catalog.btrim(p_idempotency_key);
  SELECT * INTO v_existing_event
  FROM public.stay_reservation_events
  WHERE group_id = p_group_id AND idempotency_key = v_event_key;
  IF FOUND THEN
    IF v_existing_event.event_type NOT IN (
      v_event_type,
      'stay_request_expired'
    ) THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1388_group_projection(p_group_id);
  END IF;
  IF v_hold.id IS NULL OR v_hold.state <> 'active' THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
  END IF;

  IF v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.mode <> 'request' OR v_group.state <> 'request_pending' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;

  IF v_group.request_deadline <= now() OR v_hold.expires_at <= now() THEN
    UPDATE public.stay_reservation_groups
    SET state = 'request_expired', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'expired', version = version + 1, updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET state = 'expired', version = version + 1, updated_at = now()
    WHERE id = v_hold.id;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id,
      request_id, idempotency_key, safe_metadata
    ) VALUES (
      p_group_id, 'stay_request_expired', 'staff', v_uid,
      p_request_id, v_event_key,
      jsonb_build_object('expiredAt', now())
    );
    RETURN public.issue_1388_group_projection(p_group_id);
  END IF;

  IF v_action = 'approve_request' THEN
    IF v_settings.booking_state <> 'active'
       OR NOT public.pg_brand_can_collect(v_group.brand_id)
       OR EXISTS (
         SELECT 1 FROM public.brand_currency_reconciliations r
         WHERE r.brand_id = v_group.brand_id AND r.status = 'pending'
       ) THEN
      RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
    END IF;
    v_payment_deadline :=
      now() + make_interval(mins => v_settings.approved_payment_minutes);
    UPDATE public.stay_reservation_groups
    SET state = 'approved_payment_required',
        payment_deadline = v_payment_deadline,
        version = version + 1,
        updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'approved_payment_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET expires_at = v_payment_deadline,
        reason = 'approved_payment',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    UPDATE public.stay_reservation_groups
    SET state = 'declined', version = version + 1, updated_at = now()
    WHERE id = p_group_id;
    UPDATE public.stay_reservation_lines
    SET state = 'declined', version = version + 1, updated_at = now()
    WHERE group_id = p_group_id AND state = 'request_pending';
    UPDATE public.stay_inventory_holds
    SET state = 'released',
        reason = 'request_declined',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
  END IF;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id,
    request_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, v_event_type, 'staff', v_uid,
    p_request_id, v_event_key,
    jsonb_build_object('paymentDeadline', v_payment_deadline)
  );
  RETURN public.issue_1388_group_projection(p_group_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_cancel_preview(p_group_id uuid, p_selected_line_ids uuid[], p_expected_group_version bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_actor_type text;
  v_selected uuid[];
  v_snapshot jsonb;
  v_amount bigint;
  v_preview_id uuid := gen_random_uuid();
  v_hash text;
  v_expires_at timestamptz := now() + interval '10 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_group_id IS NULL
     OR p_expected_group_version IS NULL
     OR cardinality(p_selected_line_ids) NOT BETWEEN 1 AND 50
     OR array_position(p_selected_line_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT selected_id ORDER BY selected_id)
  INTO v_selected
  FROM unnest(p_selected_line_ids) selected_id;
  IF cardinality(v_selected) <> cardinality(p_selected_line_ids) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.user_id = v_uid THEN
    v_actor_type := 'guest';
  ELSIF public.is_admin_user() THEN
    v_actor_type := 'admin';
  ELSIF public.issue_1387_has_brand_capability(
    v_group.brand_id,
    v_uid,
    'inventory'
  ) THEN
    v_actor_type := 'staff';
  ELSE
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_group.version <> p_expected_group_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF (
    SELECT count(*) FROM public.stay_reservation_lines line
    WHERE line.group_id = p_group_id
      AND line.id = ANY(v_selected)
      AND line.state = 'confirmed'
  ) <> cardinality(v_selected) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_selected)
      AND room_line.kind = 'room'
      AND place_line.group_id = p_group_id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_selected))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND state = 'succeeded'
  ORDER BY succeeded_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH eligible AS (
    SELECT
      allocation.id AS payment_allocation_id,
      allocation.reservation_line_id,
      allocation.component,
      allocation.component_ref,
      allocation.refund_treatment,
      GREATEST(
        0,
        allocation.charged_minor
          - allocation.refunded_minor
          - COALESCE((
            SELECT sum(refund_allocation.amount_minor)
            FROM public.stay_refund_allocations refund_allocation
            JOIN public.stay_refunds refund_row
              ON refund_row.id = refund_allocation.refund_id
            WHERE refund_allocation.payment_allocation_id = allocation.id
              AND refund_row.state IN (
                'submitted', 'processing', 'manual_reconciliation'
              )
          ), 0)
      ) AS outstanding_minor,
      CASE
        WHEN allocation.refund_treatment = 'refundable' THEN 10000
        WHEN allocation.refund_treatment = 'nonrefundable' THEN 0
        WHEN v_actor_type IN ('staff', 'admin') THEN
          COALESCE(
            (line.policy_snapshot->>'operator_cancel_refund_basis_points')
              ::integer,
            10000
          )
        WHEN now() < public.issue_1389_line_start_at(line.id)
          - make_interval(mins => COALESCE(
            (line.policy_snapshot->>'free_cancel_cutoff_minutes')::integer,
            0
          )) THEN 10000
        WHEN now() < public.issue_1389_line_start_at(line.id) THEN
          COALESCE(
            (line.policy_snapshot->>'late_refund_basis_points')::integer,
            0
          )
        ELSE COALESCE(
          (line.policy_snapshot->>'no_show_refund_basis_points')::integer,
          0
        )
      END AS refund_basis_points
    FROM public.stay_payment_allocations allocation
    JOIN public.stay_reservation_lines line
      ON line.id = allocation.reservation_line_id
    WHERE allocation.payment_attempt_id = v_attempt.id
      AND allocation.reservation_line_id = ANY(v_selected)
  ),
  calculated AS (
    SELECT
      eligible.*,
      LEAST(
        outstanding_minor,
        (
          outstanding_minor::numeric * refund_basis_points + 5000
        )::bigint / 10000
      ) AS refund_minor
    FROM eligible
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'paymentAllocationId', payment_allocation_id,
      'reservationLineId', reservation_line_id,
      'component', component,
      'componentRef', component_ref,
      'refundTreatment', refund_treatment,
      'refundBasisPoints', refund_basis_points,
      'amountMinor', refund_minor::text
    ) ORDER BY reservation_line_id, payment_allocation_id), '[]'::jsonb),
    COALESCE(sum(refund_minor), 0)
  INTO v_snapshot, v_amount
  FROM calculated
  WHERE refund_minor > 0;

  v_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'previewId', v_preview_id,
        'groupId', p_group_id,
        'groupVersion', v_group.version,
        'actorUserId', v_uid,
        'selectedLineIds', to_jsonb(v_selected),
        'amountMinor', v_amount::text,
        'allocations', v_snapshot,
        'expiresAt', v_expires_at
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.stay_cancel_previews (
    id, group_id, actor_user_id, actor_type, selected_line_ids,
    group_version, amount_minor, allocation_snapshot, preview_hash, expires_at
  ) VALUES (
    v_preview_id, p_group_id, v_uid, v_actor_type, v_selected,
    v_group.version, v_amount, v_snapshot, v_hash, v_expires_at
  );

  RETURN jsonb_build_object(
    'previewId', v_preview_id,
    'previewHash', v_hash,
    'groupId', p_group_id,
    'groupVersion', v_group.version,
    'selectedLineIds', to_jsonb(v_selected),
    'amountMinor', v_amount::text,
    'currencyCode', v_group.currency_code,
    'allocations', v_snapshot,
    'expiresAt', v_expires_at
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_cancel(p_preview_id uuid, p_preview_hash text, p_idempotency_key text, p_reason text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_refund public.stay_refunds%ROWTYPE;
  v_source public.source_refunds%ROWTYPE;
  v_allocation jsonb;
  v_fee_reversal bigint;
  v_fee_remaining bigint;
  v_existing_fee bigint;
  v_all_active_selected boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_preview_id IS NULL
     OR p_preview_hash !~ '^[a-f0-9]{64}$'
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200
     OR char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
       NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-cancel:' || p_preview_id::text,
      1389
    )
  );
  SELECT * INTO v_refund
  FROM public.stay_refunds
  WHERE idempotency_key = pg_catalog.btrim(p_idempotency_key);
  IF FOUND THEN
    RETURN jsonb_build_object(
      'refundId', v_refund.id,
      'groupId', v_refund.group_id,
      'state', v_refund.state,
      'amountMinor', v_refund.amount_minor::text,
      'currencyCode', v_refund.currency_code
    );
  END IF;

  SELECT * INTO v_preview
  FROM public.stay_cancel_previews
  WHERE id = p_preview_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_preview.actor_user_id <> v_uid
     OR v_preview.preview_hash <> p_preview_hash THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_preview.consumed_at IS NOT NULL OR v_preview.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_cancel_preview_expired' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_preview.group_id
  FOR UPDATE;
  IF v_group.version <> v_preview.group_version
     OR v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = v_group.id AND state = 'succeeded'
  ORDER BY succeeded_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.stay_payment_allocations allocation
  WHERE allocation.payment_attempt_id = v_attempt.id
    AND allocation.reservation_line_id = ANY(v_preview.selected_line_ids)
  ORDER BY allocation.reservation_line_id, allocation.id
  FOR UPDATE;
  PERFORM 1
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.group_id = v_group.id
    AND commitment.reservation_line_id = ANY(v_preview.selected_line_ids)
    AND commitment.state = 'active'
  ORDER BY
    commitment.resource_type,
    commitment.offering_id,
    commitment.room_date,
    commitment.place_window_id,
    commitment.exclusive_unit_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_preview.selected_line_ids)
      AND room_line.kind = 'room'
      AND place_line.group_id = v_group.id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_preview.selected_line_ids))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(application_fee_reversal_minor), 0)
  INTO v_existing_fee
  FROM public.stay_refunds prior_refund
  WHERE prior_refund.payment_attempt_id = v_attempt.id
    AND prior_refund.state IN (
      'submitted', 'processing', 'succeeded', 'manual_reconciliation'
    );
  v_fee_remaining := GREATEST(
    0,
    v_attempt.application_fee_minor - v_existing_fee
  );
  v_fee_reversal := CASE
    WHEN v_preview.amount_minor = 0 THEN 0
    WHEN v_preview.amount_minor >= (
      SELECT COALESCE(sum(
        allocation.charged_minor - allocation.refunded_minor
      ), 0)
      FROM public.stay_payment_allocations allocation
      WHERE allocation.payment_attempt_id = v_attempt.id
    ) THEN v_fee_remaining
    ELSE LEAST(
      v_fee_remaining,
      (
        v_attempt.application_fee_minor::numeric
          * v_preview.amount_minor
          + v_attempt.amount_minor / 2
      )::bigint / v_attempt.amount_minor
    )
  END;

  INSERT INTO public.stay_refunds (
    group_id, payment_attempt_id, cancel_preview_id,
    requested_by_type, requested_by_user_id, reason, state,
    amount_minor, application_fee_reversal_minor, currency_code,
    provider, idempotency_key
  ) VALUES (
    v_group.id, v_attempt.id, v_preview.id,
    v_preview.actor_type, v_uid, pg_catalog.btrim(p_reason),
    CASE WHEN v_preview.amount_minor = 0 THEN 'succeeded' ELSE 'submitted' END,
    v_preview.amount_minor, v_fee_reversal, v_group.currency_code,
    v_attempt.provider, pg_catalog.btrim(p_idempotency_key)
  ) RETURNING * INTO v_refund;

  IF v_preview.amount_minor > 0 THEN
    WITH requested AS (
      SELECT
        (item->>'paymentAllocationId')::uuid AS payment_allocation_id,
        (item->>'reservationLineId')::uuid AS reservation_line_id,
        (item->>'amountMinor')::bigint AS amount_minor
      FROM jsonb_array_elements(v_preview.allocation_snapshot) item
    ),
    floors AS (
      SELECT
        requested.*,
        floor(
          v_fee_reversal::numeric * requested.amount_minor
          / v_preview.amount_minor
        )::bigint AS fee_floor,
        (
          v_fee_reversal::numeric * requested.amount_minor
          - floor(
            v_fee_reversal::numeric * requested.amount_minor
            / v_preview.amount_minor
          ) * v_preview.amount_minor
        ) AS remainder
      FROM requested
    ),
    ranked AS (
      SELECT
        floors.*,
        row_number() OVER (
          ORDER BY remainder DESC, payment_allocation_id
        ) AS remainder_rank,
        v_fee_reversal - sum(fee_floor) OVER () AS extras
      FROM floors
    )
    INSERT INTO public.stay_refund_allocations (
      refund_id, payment_allocation_id, reservation_line_id,
      amount_minor, organizer_liability_minor,
      platform_fee_reversal_minor, state
    )
    SELECT
      v_refund.id,
      ranked.payment_allocation_id,
      ranked.reservation_line_id,
      ranked.amount_minor,
      ranked.amount_minor - (
        ranked.fee_floor
        + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END
      ),
      ranked.fee_floor
        + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END,
      'submitted'
    FROM ranked;

    INSERT INTO public.source_refunds (
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, requested_by_user_id, reason, provider, currency,
      original_charge_cents, buyer_refund_requested_cents,
      original_application_fee_cents, fee_reversal_required_cents,
      fee_state, fee_leg_kind, financial_state,
      organizer_refund_liability_cents, platform_fee_absorption_cents,
      provider_payment_reference, provider_account_reference, idempotency_key
    ) VALUES (
      'stay_reservation', v_refund.id, v_group.id, v_group.brand_id,
      v_group.venue_id, 'stay_cancellation',
      CASE v_preview.actor_type
        WHEN 'guest' THEN 'consumer'
        WHEN 'admin' THEN 'admin'
        ELSE 'brand_staff'
      END,
      v_uid, pg_catalog.btrim(p_reason), v_attempt.provider,
      v_group.currency_code::text, v_attempt.amount_minor::integer,
      v_refund.amount_minor::integer,
      v_attempt.application_fee_minor::integer,
      v_fee_reversal::integer,
      CASE WHEN v_fee_reversal = 0 THEN 'not_required' ELSE 'queued' END,
      CASE
        WHEN v_fee_reversal = 0 THEN 'not_required'
        WHEN v_attempt.provider = 'stripe'
          THEN 'stripe_application_fee_refund'
        ELSE 'paystack_ledger_allocation'
      END,
      'pending',
      (v_refund.amount_minor - v_fee_reversal)::integer,
      v_fee_reversal::integer,
      v_attempt.provider_payment_ref,
      v_attempt.connected_account_ref,
      'stay-refund:' || v_refund.id
    ) RETURNING * INTO v_source;

    UPDATE public.stay_refunds
    SET source_refund_id = v_source.id,
        updated_at = now()
    WHERE id = v_refund.id
    RETURNING * INTO v_refund;

    INSERT INTO public.source_refund_ledger_allocations (
      refund_id, allocation_type, amount_cents, currency, provider,
      state, idempotency_key
    ) VALUES (
      v_source.id, 'buyer_refund', v_source.buyer_refund_requested_cents,
      v_source.currency, v_source.provider, 'prepared',
      'source-refund-allocation:buyer:' || v_source.id
    );
    IF v_source.organizer_refund_liability_cents > 0 THEN
      INSERT INTO public.source_refund_ledger_allocations (
        refund_id, allocation_type, amount_cents, currency, provider,
        state, idempotency_key
      ) VALUES (
        v_source.id, 'organizer_refund_liability',
        v_source.organizer_refund_liability_cents,
        v_source.currency, v_source.provider, 'prepared',
        'source-refund-allocation:organizer:' || v_source.id
      );
    END IF;
    IF v_source.platform_fee_absorption_cents > 0 THEN
      INSERT INTO public.source_refund_ledger_allocations (
        refund_id, allocation_type, amount_cents, currency, provider,
        state, idempotency_key
      ) VALUES (
        v_source.id, 'platform_application_fee_reversal',
        v_source.platform_fee_absorption_cents,
        v_source.currency, v_source.provider, 'prepared',
        'source-refund-allocation:platform:' || v_source.id
      );
    END IF;
  END IF;

  UPDATE public.stay_inventory_commitments
  SET state = 'released',
      released_at = now(),
      release_reason = 'reservation_cancelled'
  WHERE group_id = v_group.id
    AND reservation_line_id = ANY(v_preview.selected_line_ids)
    AND state = 'active';
  UPDATE public.stay_reservation_lines
  SET state = 'cancelled', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND id = ANY(v_preview.selected_line_ids)
    AND state = 'confirmed';

  SELECT NOT EXISTS (
    SELECT 1 FROM public.stay_reservation_lines line
    WHERE line.group_id = v_group.id AND line.state = 'confirmed'
  ) INTO v_all_active_selected;
  UPDATE public.stay_reservation_groups
  SET state = CASE
        WHEN v_all_active_selected THEN 'cancelled'
        ELSE 'partially_cancelled'
      END,
      version = version + 1,
      updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_cancel_previews
  SET consumed_at = now()
  WHERE id = v_preview.id;

  FOR v_allocation IN
    SELECT jsonb_build_object(
      'lineId', allocation.reservation_line_id,
      'amountMinor', sum(allocation.amount_minor)::text
    ) AS value
    FROM public.stay_refund_allocations allocation
    WHERE allocation.refund_id = v_refund.id
    GROUP BY allocation.reservation_line_id
    ORDER BY allocation.reservation_line_id
  LOOP
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, refund_id, entry_type,
      amount_minor, currency_code, idempotency_key, metadata
    ) VALUES (
      v_group.id,
      (v_allocation->>'lineId')::uuid,
      v_attempt.id,
      v_refund.id,
      CASE WHEN v_refund.amount_minor = 0
        THEN 'refund_succeeded' ELSE 'refund_requested' END,
      (v_allocation->>'amountMinor')::bigint,
      v_group.currency_code,
      'stay:refund_requested:' || v_refund.id || ':' ||
        (v_allocation->>'lineId'),
      jsonb_build_object('reason', 'reservation_cancelled')
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_cancelled', v_preview.actor_type, v_uid,
    p_request_id, 'cancel:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'refundId', v_refund.id,
      'selectedLineIds', to_jsonb(v_preview.selected_line_ids),
      'amountMinor', v_refund.amount_minor::text,
      'currencyCode', v_refund.currency_code
    )
  );

  RETURN jsonb_build_object(
    'refundId', v_refund.id,
    'groupId', v_group.id,
    'state', v_refund.state,
    'amountMinor', v_refund.amount_minor::text,
    'currencyCode', v_refund.currency_code,
    'group', public.issue_1388_group_projection(v_group.id)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.issue_1389_prepare_payment(p_group_id uuid, p_idempotency_key text, p_expected_group_version bigint, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_provider text;
  v_account text;
  v_currency text;
  v_take_rate integer;
  v_app_fee bigint;
  v_ordinal integer;
  v_request_hash text;
  v_cutover timestamptz;
  v_readiness_revision bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL
     OR p_expected_group_version IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-payment:' || p_group_id::text || ':' ||
        pg_catalog.btrim(p_idempotency_key),
      1389
    )
  );

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'groupId', p_group_id,
        'expectedVersion', p_expected_group_version
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF v_group.version <> p_expected_group_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = 'PT409';
  END IF;
  IF (
    v_group.mode = 'instant'
    AND v_group.state <> 'instant_payment_pending'
  ) OR (
    v_group.mode = 'request'
    AND v_group.state <> 'approved_payment_required'
  ) THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  IF v_group.mode = 'request' AND v_group.payment_deadline IS NULL THEN
    RAISE EXCEPTION 'stay_payment_before_approval' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = p_group_id
  FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = 'PT409';
  END IF;

  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack'
      THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack'
      THEN pricing.paystack_subaccount_code
      ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency),
    pricing.effective_take_rate_bps
  INTO v_provider, v_account, v_currency, v_take_rate
  FROM public.resolve_brand_pricing_inputs(
    v_group.brand_id,
    v_group.venue_id
  ) pricing
  LIMIT 1;

  SELECT b.payout_hold_cutover_at INTO v_cutover
  FROM public.brands b WHERE b.id = v_group.brand_id;
  SELECT b.discovery_currency_state_version INTO v_readiness_revision
  FROM public.brands b
  WHERE b.id = v_group.brand_id;

  IF v_provider IS NULL
     OR v_currency IS DISTINCT FROM v_group.currency_code::text
     OR NOT public.pg_brand_can_collect(v_group.brand_id)
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_group.brand_id
         AND reconciliation.status = 'pending'
     )
     OR v_cutover IS NULL THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_provider = 'stripe' AND (
    v_account IS NULL
    OR NOT public.issue_1389_flag_enabled('STAY_STRIPE_COMMERCE')
  ) THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_provider = 'paystack' AND (
    v_currency <> 'NGN'
    OR NOT public.issue_1389_flag_enabled('STAY_PAYSTACK_COMMERCE')
  ) THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_group.total_minor <= 0 OR v_group.total_minor > 2147483647 THEN
    RAISE EXCEPTION 'stay_money_out_of_range' USING ERRCODE = '22003';
  END IF;

  v_app_fee := LEAST(
    v_group.total_minor,
    ((v_group.total_minor::numeric * COALESCE(v_take_rate, 0) + 5000)
      / 10000)::bigint
  );
  SELECT COALESCE(max(attempt_ordinal), 0) + 1 INTO v_ordinal
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id;

  INSERT INTO public.stay_payment_attempts (
    group_id, provider, attempt_ordinal, connected_account_ref,
    amount_minor, currency_code, application_fee_minor, state,
    idempotency_key, request_hash, readiness_revision
  ) VALUES (
    p_group_id, v_provider, v_ordinal, v_account,
    v_group.total_minor, v_group.currency_code, v_app_fee, 'created',
    pg_catalog.btrim(p_idempotency_key), v_request_hash,
    COALESCE(v_readiness_revision, 1)
  ) RETURNING * INTO v_attempt;

  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref,
    charged_minor, refund_treatment, snapshot
  )
  SELECT
    v_attempt.id, line.id, 'base', 'base',
    line.base_minor, 'same_as_line',
    jsonb_build_object('policy', line.policy_snapshot)
  FROM public.stay_reservation_lines line
  WHERE line.group_id = p_group_id
  ORDER BY line.id;

  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref,
    charged_minor, refund_treatment, snapshot
  )
  SELECT
    v_attempt.id,
    reservation_line.id,
    CASE quote_fee.fee_kind WHEN 'tax' THEN 'tax' ELSE 'fee' END,
    quote_fee.id::text,
    quote_fee.amount_minor,
    quote_fee.refund_treatment,
    quote_fee.snapshot
  FROM public.stay_reservation_lines reservation_line
  JOIN public.stay_quote_fee_lines quote_fee
    ON quote_fee.quote_line_id = reservation_line.quote_line_id
  WHERE reservation_line.group_id = p_group_id
    AND NOT quote_fee.included_in_base
    AND quote_fee.amount_minor > 0
  ORDER BY reservation_line.id, quote_fee.id;

  IF (
    SELECT COALESCE(sum(allocation.charged_minor), 0)
    FROM public.stay_payment_allocations allocation
    WHERE allocation.payment_attempt_id = v_attempt.id
  ) <> v_attempt.amount_minor THEN
    RAISE EXCEPTION 'stay_payment_allocation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_payment_prepared', 'guest', v_uid, p_request_id,
    'payment-prepared:' || v_attempt.id,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'provider', v_provider,
      'amountMinor', v_attempt.amount_minor::text,
      'currencyCode', v_attempt.currency_code
    )
  );

  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$
;
-- #4571 W3: team_agent_call as section B wrote it.
:t4134_tac
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

-- #4382 removed these two with the staff-thread table; drop the replay copies.
DROP FUNCTION public.issue_3720_update_internal_thread(uuid, integer, text, text);
DROP FUNCTION public.issue_3988_reassign_internal_thread(uuid, integer, uuid);

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
