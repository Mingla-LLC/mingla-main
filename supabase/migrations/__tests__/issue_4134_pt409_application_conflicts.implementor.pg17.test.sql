\set ON_ERROR_STOP on

-- Issue #4134 — no database function answers an ordinary application conflict
-- with SQLSTATE 40001 any more. PostgREST 14 retries 40001 without limit, so a
-- stale call that can never succeed loops forever and pins database CPU.
-- Run after the full migration chain on PostgreSQL 17.
--
-- A. Catalogue: no function outside the system schemas raises 40001 /
--    serialization_failure in any RAISE form, and every handler that catches
--    40001 also catches PT409. This also fails if a later migration brings a
--    40001 raise back.
-- B. Behaviour: stale calls return PT409 once, with the original message and
--    zero row change (biz_apply_trip_draft_graph, biz_publish_trip_command,
--    ops_request_begin).
-- C. Handlers: get_brand_circle_reach still RE-RAISES its stale-cursor
--    conflict instead of swallowing it into an "unavailable" answer, and the
--    other three handlers keep their original condition plus PT409.
-- MINGLA-INVARIANT: I-4134-NO-RETRYABLE-APPLICATION-CONFLICTS | issue #4134 | No function outside pg_catalog/information_schema raises SQLSTATE 40001 or serialization_failure; application conflicts use PT409 (one HTTP 409) with their messages unchanged, and handlers that caught 40001 also catch PT409.

BEGIN;

DO $catalogue$
DECLARE
  v_bad text;
BEGIN
  SELECT pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', '
                               ORDER BY p.oid::pg_catalog.regprocedure::text) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND (p.prosrc ~* 'errcode\s*:?=\s*''(40001|serialization_failure)'''
          OR p.prosrc ~* 'raise\s+(exception\s+)?sqlstate\s+''40001'''
          OR p.prosrc ~* 'raise\s+(exception\s+)?serialization_failure\M');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4134 A-01 FAIL: these functions still raise SQLSTATE 40001: %', v_bad;
  END IF;

  SELECT pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', '
                               ORDER BY p.oid::pg_catalog.regprocedure::text) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.prosrc ~* '(when|or)\s+(serialization_failure|sqlstate\s+''40001'')(?!\s+or\s+sqlstate\s+''PT409'')';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4134 A-02 FAIL: these handlers catch 40001 but not PT409: %', v_bad;
  END IF;

  -- The function the October incident ran through, by name.
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.biz_apply_trip_draft_graph(uuid, jsonb, timestamp with time zone, uuid)'::pg_catalog.regprocedure),
       'RAISE EXCEPTION ''trip_revision_conflict'' USING ERRCODE = ''PT409''') = 0 THEN
    RAISE EXCEPTION 'ISSUE-4134 A-03 FAIL: biz_apply_trip_draft_graph is not pinned to PT409';
  END IF;

  RAISE NOTICE 'ISSUE-4134 A PASS: no function raises 40001; every 40001 handler also catches PT409';
END
$catalogue$;

-- Fixture: one owner, one brand, one trip draft.
SELECT set_config('request.jwt.claim.sub', '41340000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
INSERT INTO auth.users(id, email)
VALUES ('41340000-0000-4000-8000-000000000001', 'issue4134@example.test');
INSERT INTO public.creator_accounts(id) VALUES ('41340000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES ('41340000-0000-4000-8000-000000000010', '41340000-0000-4000-8000-000000000001',
        'Issue 4134 Brand', 'issue-4134', 'GBP');

CREATE TEMP TABLE t4134 AS
SELECT public.biz_create_trip_draft(
  '41340000-0000-4000-8000-000000000010',
  jsonb_build_object('title', 'Issue 4134 Trip', 'timezone', 'Europe/London'),
  '41340000-0000-4000-8000-0000000000a1'
) AS graph;

DO $behaviour$
DECLARE
  v_event uuid;
  v_rev timestamptz;
  v_before jsonb;
  v_after jsonb;
  v_state text;
  v_message text;
BEGIN
  SELECT (graph#>>'{event,id}')::uuid, (graph->>'revision')::timestamptz
    INTO v_event, v_rev FROM t4134;
  IF v_event IS NULL OR v_rev IS NULL THEN
    RAISE EXCEPTION 'ISSUE-4134 B-00 FAIL: trip fixture was not created';
  END IF;

  -- B-1 a stale trip draft save: the call the October incident looped on.
  SELECT jsonb_build_object(
           'event', (SELECT to_jsonb(e) FROM public.events AS e WHERE e.id = v_event),
           'days', (SELECT count(*) FROM public.trip_days WHERE event_id = v_event),
           'receipts', (SELECT count(*) FROM public.biz_trip_command_receipts
                         WHERE operation_id = '41340000-0000-4000-8000-0000000000a2'))
    INTO v_before;
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object(
        'event', jsonb_build_object('title', 'A stale title that must not win'),
        'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Stale day'))),
      v_rev - interval '1 second',
      '41340000-0000-4000-8000-0000000000a2');
    RAISE EXCEPTION 'ISSUE-4134 B-01 FAIL: a stale trip draft save was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'PT409' OR v_message IS DISTINCT FROM 'trip_revision_conflict' THEN
    RAISE EXCEPTION 'ISSUE-4134 B-02 FAIL: stale trip draft save returned % / %', v_state, v_message;
  END IF;
  SELECT jsonb_build_object(
           'event', (SELECT to_jsonb(e) FROM public.events AS e WHERE e.id = v_event),
           'days', (SELECT count(*) FROM public.trip_days WHERE event_id = v_event),
           'receipts', (SELECT count(*) FROM public.biz_trip_command_receipts
                         WHERE operation_id = '41340000-0000-4000-8000-0000000000a2'))
    INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-4134 B-03 FAIL: the refused trip draft save changed data';
  END IF;

  -- B-2 a stale publish.
  v_state := NULL;
  v_message := NULL;
  BEGIN
    PERFORM public.biz_publish_trip_command(
      v_event, v_rev - interval '1 second', '41340000-0000-4000-8000-0000000000a3');
    RAISE EXCEPTION 'ISSUE-4134 B-04 FAIL: a stale trip publish was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'PT409' OR v_message IS DISTINCT FROM 'trip_revision_conflict' THEN
    RAISE EXCEPTION 'ISSUE-4134 B-05 FAIL: stale trip publish returned % / %', v_state, v_message;
  END IF;
  SELECT jsonb_build_object(
           'event', (SELECT to_jsonb(e) FROM public.events AS e WHERE e.id = v_event),
           'days', (SELECT count(*) FROM public.trip_days WHERE event_id = v_event),
           'receipts', (SELECT count(*) FROM public.biz_trip_command_receipts
                         WHERE operation_id = '41340000-0000-4000-8000-0000000000a2'))
    INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-4134 B-06 FAIL: the refused trip publish changed data';
  END IF;

  -- B-3 a repeated request whose first attempt never finished: the "try
  -- again" that a server-side retry can never clear.
  IF public.ops_request_begin('issue4134@example.test', 'issue4134-key-01', 'update',
                              '{"id":"x"}'::jsonb) IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-4134 B-07 FAIL: the first request was not recorded as new';
  END IF;
  SELECT to_jsonb(k) INTO v_before FROM public.ops_request_keys AS k
   WHERE k.actor_email = 'issue4134@example.test' AND k.request_key = 'issue4134-key-01';
  v_state := NULL;
  v_message := NULL;
  BEGIN
    PERFORM public.ops_request_begin('issue4134@example.test', 'issue4134-key-01', 'update',
                                     '{"id":"x"}'::jsonb);
    RAISE EXCEPTION 'ISSUE-4134 B-08 FAIL: an unfinished request was replayed';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'PT409'
     OR v_message IS DISTINCT FROM 'try_again: The first request did not finish. Send the same request again.' THEN
    RAISE EXCEPTION 'ISSUE-4134 B-09 FAIL: unfinished request returned % / %', v_state, v_message;
  END IF;
  SELECT to_jsonb(k) INTO v_after FROM public.ops_request_keys AS k
   WHERE k.actor_email = 'issue4134@example.test' AND k.request_key = 'issue4134-key-01';
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ISSUE-4134 B-10 FAIL: the refused repeat changed the request record';
  END IF;

  RAISE NOTICE 'ISSUE-4134 B PASS: stale calls return PT409 once with their messages and change nothing';
END
$behaviour$;

DO $handlers$
DECLARE
  v_state text;
  v_message text;
  v_answer jsonb;
BEGIN
  -- C-1 get_brand_circle_reach re-raises its own stale-cursor conflict. If its
  -- handler had not learned PT409, WHEN OTHERS would return an "unavailable"
  -- page and the caller would never learn the cursor is stale. The cursor
  -- names a snapshot version the brand has never had.
  BEGIN
    v_answer := public.get_brand_circle_reach(
      '41340000-0000-4000-8000-000000000010', 'follower',
      jsonb_build_object('memberId', '41340000-0000-4000-8000-0000000000f1',
                         'ringOrder', 2, 'snapshotVersion', 987654321, 'sortName', 'a'),
      10);
    RAISE EXCEPTION 'ISSUE-4134 C-01 FAIL: a stale circle cursor was answered with %', v_answer;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM 'PT409' OR v_message IS DISTINCT FROM 'circle_cursor_stale' THEN
    RAISE EXCEPTION 'ISSUE-4134 C-02 FAIL: stale circle cursor returned % / %', v_state, v_message;
  END IF;

  -- C-2 the other handlers keep their original condition and add PT409.
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.biz_guest_roster_list(uuid, text, text, text, jsonb, integer)'::pg_catalog.regprocedure),
       'EXCEPTION WHEN serialization_failure OR SQLSTATE ''PT409'' THEN RAISE;') = 0 THEN
    RAISE EXCEPTION 'ISSUE-4134 C-03 FAIL: biz_guest_roster_list no longer re-raises its stale cursor';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.ops_brand_autolink()'::pg_catalog.regprocedure),
       'WHEN deadlock_detected OR lock_not_available OR serialization_failure OR SQLSTATE ''PT409'' THEN') = 0 THEN
    RAISE EXCEPTION 'ISSUE-4134 C-04 FAIL: ops_brand_autolink no longer treats a conflict as busy';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.ops_brand_cards_confirm(uuid[], text)'::pg_catalog.regprocedure),
       'WHEN deadlock_detected OR lock_not_available OR serialization_failure OR SQLSTATE ''PT409'' THEN') = 0 THEN
    RAISE EXCEPTION 'ISSUE-4134 C-05 FAIL: ops_brand_cards_confirm no longer treats a conflict as busy';
  END IF;

  RAISE NOTICE 'ISSUE-4134 C PASS: handlers that caught 40001 still catch the same conflicts as PT409';
END
$handlers$;

ROLLBACK;
