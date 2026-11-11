-- Issue #3355 rework 3 (tester R3-7) — I-ARI-FOLLOW-UP-NEVER-CANCELS
-- (declared in supabase/functions/_shared/__tests__/issue_3355_rework_3.implementor.test.ts;
-- enforced in SQL by 20280623133355_issue_3355_flow_follow_up_never_cancels.sql).
--
--   F1  a completed event setup and a parked trip setup in one chat: the
--       follow-up start ("Yes" on the old event card, answers.follow_up_of)
--       is refused with flow_run_open (PT409) and the trip stays parked;
--   F2  the same with a live setup open: refused, the live setup untouched;
--   F3  with nothing else open the follow-up starts (completed run kept);
--   F4  a new setup (no follow_up_of) still replaces the chat's parked one
--       (the Wave A rule is unchanged).
-- Reverting 20280623133355 (the 20280623013355 body) raises F1: the parked
-- trip is cancelled.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('33550000-b3b3-4000-8000-0000000000f1','rw3-owner@test.local');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-b3b3-4000-8000-0000000000f1','rw3-owner@test.local','Rw3','rw3_owner','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-b3b3-4000-8000-0000000000f1','rw3-owner@test.local','Rw3','Rw3');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('33550000-b3b3-4000-8000-0000000000f2','33550000-b3b3-4000-8000-0000000000f1','Rework Three','rw3-brand');
INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
  ('33550000-b3b3-4000-8000-0000000000c1','33550000-b3b3-4000-8000-0000000000f1','33550000-b3b3-4000-8000-0000000000f2'),
  ('33550000-b3b3-4000-8000-0000000000c2','33550000-b3b3-4000-8000-0000000000f1','33550000-b3b3-4000-8000-0000000000f2'),
  ('33550000-b3b3-4000-8000-0000000000c3','33550000-b3b3-4000-8000-0000000000f1','33550000-b3b3-4000-8000-0000000000f2'),
  ('33550000-b3b3-4000-8000-0000000000c4','33550000-b3b3-4000-8000-0000000000f1','33550000-b3b3-4000-8000-0000000000f2');

-- A completed create_event run in chat p_chat (evidence on the draft).
CREATE OR REPLACE FUNCTION pg_temp.rw3_completed_event(p_chat uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  o uuid := '33550000-b3b3-4000-8000-0000000000f1';
  b uuid := '33550000-b3b3-4000-8000-0000000000f2';
  a uuid; r jsonb; k uuid := gen_random_uuid();
BEGIN
  a := (public.ari_flow_run_start(o,b,'create_event',2,'one_per_subject',p_chat,NULL,'{}')->'run'->>'id')::uuid;
  r := public.ari_flow_run_lease(a,o,k,30);
  PERFORM public.ari_flow_run_advance(a,k,(r->'run'->>'revision')::int,
    '{"status":"completed","completion_evidence":{"probe":"events_exists","observed":true}}');
  RETURN a;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.rw3_follow_up(p_chat uuid, p_of uuid) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT public.ari_flow_run_start('33550000-b3b3-4000-8000-0000000000f1',
    '33550000-b3b3-4000-8000-0000000000f2','create_event',2,'one_per_subject',p_chat,NULL,
    jsonb_build_object('follow_up_of', jsonb_build_object('value', p_of, 'source', 'engine')));
$$;

-- ── F1 a parked setup is never cancelled by an old card's "Yes" ───────────
DO $f1$
DECLARE
  o uuid := '33550000-b3b3-4000-8000-0000000000f1';
  b uuid := '33550000-b3b3-4000-8000-0000000000f2';
  c uuid := '33550000-b3b3-4000-8000-0000000000c1';
  a uuid; t uuid; r jsonb; k uuid := gen_random_uuid(); v_state text;
BEGIN
  a := pg_temp.rw3_completed_event(c);
  t := (public.ari_flow_run_start(o,b,'create_trip',2,'one_per_subject',c,NULL,'{}')->'run'->>'id')::uuid;
  r := public.ari_flow_run_lease(t,o,k,30);
  PERFORM public.ari_flow_run_advance(t,k,(r->'run'->>'revision')::int,'{"status":"parked"}');
  BEGIN
    PERFORM pg_temp.rw3_follow_up(c, a);
    RAISE EXCEPTION 'F1 the follow-up start was not refused';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    GET STACKED DIAGNOSTICS v_state = MESSAGE_TEXT;
    IF v_state <> 'flow_run_open' THEN
      RAISE EXCEPTION 'F1 wrong refusal: %', v_state;
    END IF;
  END;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = t) <> 'parked' THEN
    RAISE EXCEPTION 'F1 the parked trip setup was % after "Yes" on the old event card',
      (SELECT status FROM public.ari_flow_runs WHERE id = t);
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = a) <> 'completed' THEN
    RAISE EXCEPTION 'F1 the completed run changed';
  END IF;
  IF (SELECT count(*) FROM public.ari_flow_runs WHERE conversation_id = c) <> 2 THEN
    RAISE EXCEPTION 'F1 a follow-up run was created';
  END IF;
END
$f1$;

-- ── F2 a live setup is never cancelled either ─────────────────────────────
DO $f2$
DECLARE
  o uuid := '33550000-b3b3-4000-8000-0000000000f1';
  b uuid := '33550000-b3b3-4000-8000-0000000000f2';
  c uuid := '33550000-b3b3-4000-8000-0000000000c2';
  a uuid; t uuid; refused boolean := false;
BEGIN
  a := pg_temp.rw3_completed_event(c);
  t := (public.ari_flow_run_start(o,b,'create_trip',2,'one_per_subject',c,NULL,'{}')->'run'->>'id')::uuid;
  BEGIN
    PERFORM pg_temp.rw3_follow_up(c, a);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'F2 the follow-up start was not refused'; END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = t) <> 'active' THEN
    RAISE EXCEPTION 'F2 the live trip setup was %', (SELECT status FROM public.ari_flow_runs WHERE id = t);
  END IF;
END
$f2$;

-- ── F3 nothing else open: the follow-up starts ─────────────────────────────
DO $f3$
DECLARE
  c uuid := '33550000-b3b3-4000-8000-0000000000c3';
  a uuid; r jsonb;
BEGIN
  a := pg_temp.rw3_completed_event(c);
  r := pg_temp.rw3_follow_up(c, a);
  IF (r->>'created')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'F3 the follow-up did not start: %', r;
  END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = a) <> 'completed' THEN
    RAISE EXCEPTION 'F3 the completed run changed';
  END IF;
END
$f3$;

-- ── F4 a new setup still replaces the chat's parked one (Wave A) ──────────
DO $f4$
DECLARE
  o uuid := '33550000-b3b3-4000-8000-0000000000f1';
  b uuid := '33550000-b3b3-4000-8000-0000000000f2';
  c uuid := '33550000-b3b3-4000-8000-0000000000c4';
  t uuid; r jsonb; k uuid := gen_random_uuid();
BEGIN
  t := (public.ari_flow_run_start(o,b,'create_trip',2,'one_per_subject',c,NULL,'{}')->'run'->>'id')::uuid;
  r := public.ari_flow_run_lease(t,o,k,30);
  PERFORM public.ari_flow_run_advance(t,k,(r->'run'->>'revision')::int,'{"status":"parked"}');
  PERFORM public.ari_flow_run_start(o,b,'create_event',2,'one_per_subject',c,NULL,'{}');
  IF (SELECT status FROM public.ari_flow_runs WHERE id = t) <> 'cancelled' THEN
    RAISE EXCEPTION 'F4 a new setup no longer replaces the parked one (%)',
      (SELECT status FROM public.ari_flow_runs WHERE id = t);
  END IF;
END
$f4$;

ROLLBACK;
