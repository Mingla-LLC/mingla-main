-- MINGLA-INVARIANT: I-ARI-QUALITY-PANEL-ADMIN-ONLY | issue #3355 | public.ari_admin_quality_metrics is read-only and refused for everyone but a Mingla admin; its flow completion, park, refusal, repeat-request, empty-reply and thumbs-up rates are the counts it reports over the chosen window (1..180 days), and turns to done counts host messages between a setup's start and completion.
--
-- Wave F (20280702093355). Reverting the migration fails the first block
-- (no ari_admin_quality_metrics). The database may already hold rows, so
-- counts are checked as deltas against a read taken before this test's rows.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('33550000-f200-4000-8000-000000000001','f2-owner@test.local','{"full_name":"Olu Owner"}'),
  ('33550000-f200-4000-8000-000000000002','f2-host@test.local','{"full_name":"Ada Host"}'),
  ('33550000-f200-4000-8000-000000000004','f2-staff@test.local','{"full_name":"Sam Staff"}');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-f200-4000-8000-000000000001','f2-owner@test.local','Olu Owner','f2_owner','business'),
  ('33550000-f200-4000-8000-000000000002','f2-host@test.local','Ada Host','f2_host','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-f200-4000-8000-000000000001','f2-owner@test.local','Olu Owner','F2 Host');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('33550000-f200-4000-8000-0000000000b1','33550000-f200-4000-8000-000000000001','Harmattan Kitchen','f2-harmattan');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('33550000-f200-4000-8000-0000000000b1','33550000-f200-4000-8000-000000000002','event_manager',now());
INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
  ('33550000-f200-4000-8000-0000000000c1','33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000b1');
INSERT INTO public.admin_users(email, role, status)
VALUES ('f2-staff@test.local', 'admin', 'active');

CREATE OR REPLACE FUNCTION pg_temp.f2_as(p_user uuid, p_email text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
END;
$$;

CREATE TEMP TABLE f2_before(days integer PRIMARY KEY, view jsonb) ON COMMIT DROP;
GRANT ALL ON f2_before TO authenticated;

DO $f2acl$
DECLARE
  v_error text;
BEGIN
  IF has_function_privilege('anon', 'public.ari_admin_quality_metrics(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F2-ACL anon can execute ari_admin_quality_metrics';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ari_admin_quality_metrics(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F2-ACL admins call it through authenticated';
  END IF;
  -- A host (not a Mingla admin) is refused.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f2_as('33550000-f200-4000-8000-000000000002', 'f2-host@test.local');
  BEGIN
    PERFORM public.ari_admin_quality_metrics(30);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN
    RAISE EXCEPTION 'F2-1 a host opened the quality panel (%)', v_error;
  END IF;
  -- The admin's read before this test's rows (the baseline for deltas).
  PERFORM pg_temp.f2_as('33550000-f200-4000-8000-000000000004', 'f2-staff@test.local');
  INSERT INTO f2_before VALUES
    (30, public.ari_admin_quality_metrics(30)),
    (60, public.ari_admin_quality_metrics(60));
  RESET ROLE;
END
$f2acl$;

-- This test's rows: 4 host turns and 4 Ari replies in the last hour, one
-- host turn 40 days ago; four setups (completed, parked, cancelled, and one
-- completed 40 days ago); three gap events; one thumbs up, one down.
INSERT INTO public.agent_messages(id,conversation_id,user_id,role,content,created_at)
SELECT ('33550000-f200-4000-8000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       '33550000-f200-4000-8000-0000000000c1','33550000-f200-4000-8000-000000000002',
       CASE WHEN g % 2 = 1 THEN 'user' ELSE 'assistant' END,
       jsonb_build_object('text', 'turn ' || g), now() - make_interval(mins => 20 - g)
  FROM generate_series(1, 8) g;
INSERT INTO public.agent_messages(id,conversation_id,user_id,role,content,created_at) VALUES
  ('33550000-f200-4000-8000-000000000199','33550000-f200-4000-8000-0000000000c1',
   '33550000-f200-4000-8000-000000000002','user','{"text":"old turn"}', now() - interval '40 days' + interval '1 minute');

INSERT INTO public.ari_flow_runs(id,brand_id,flow_key,flow_version,concurrency,started_by,conversation_id,status,completion_evidence,created_at,completed_at,parked_at)
VALUES
  -- Completed, with host turns 1 and 3 (19 and 17 minutes ago) inside it.
  ('33550000-f200-4000-8000-0000000000f1','33550000-f200-4000-8000-0000000000b1','create_event',1,'one_per_subject',
   '33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000c1','completed','{"probe":"test"}',
   now() - interval '19 minutes 30 seconds', now() - interval '16 minutes 30 seconds', NULL),
  ('33550000-f200-4000-8000-0000000000f2','33550000-f200-4000-8000-0000000000b1','create_trip',1,'one_per_subject',
   '33550000-f200-4000-8000-000000000002',NULL,'parked',NULL, now() - interval '10 minutes', NULL, now() - interval '9 minutes'),
  ('33550000-f200-4000-8000-0000000000f3','33550000-f200-4000-8000-0000000000b1','create_venue',1,'one_per_subject',
   '33550000-f200-4000-8000-000000000002',NULL,'cancelled',NULL, now() - interval '8 minutes', NULL, NULL),
  ('33550000-f200-4000-8000-0000000000f4','33550000-f200-4000-8000-0000000000b1','create_event',1,'one_per_subject',
   '33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000c1','completed','{"probe":"test"}',
   now() - interval '40 days', now() - interval '40 days' + interval '5 minutes', NULL);

SET LOCAL ROLE service_role;
SELECT public.ari_record_turn_gaps('33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000c1',NULL,'f2-turn-1',
  jsonb_build_array(jsonb_build_object('type','refusal','excerpt','not available')));
SELECT public.ari_record_turn_gaps('33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000c1',NULL,'f2-turn-2',
  jsonb_build_array(jsonb_build_object('type','repeated_request','excerpt','same again')));
SELECT public.ari_record_turn_gaps('33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000c1',NULL,'f2-turn-3',
  jsonb_build_array(jsonb_build_object('type','empty_reply','excerpt','')));
RESET ROLE;

INSERT INTO public.ari_message_feedback(user_id,conversation_id,assistant_message_id,sentiment) VALUES
  ('33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000c1','33550000-f200-4000-8000-000000000102','positive'),
  ('33550000-f200-4000-8000-000000000002','33550000-f200-4000-8000-0000000000c1','33550000-f200-4000-8000-000000000104','negative');

DO $f2metrics$
DECLARE
  v_before jsonb;
  v_before60 jsonb;
  v_view jsonb;
  v_view60 jsonb;
  v_delta integer;
  v_event jsonb;
BEGIN
  SELECT view INTO v_before FROM f2_before WHERE days = 30;
  SELECT view INTO v_before60 FROM f2_before WHERE days = 60;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f2_as('33550000-f200-4000-8000-000000000004', 'f2-staff@test.local');
  v_view := public.ari_admin_quality_metrics(30);
  v_view60 := public.ari_admin_quality_metrics(60);

  -- Counts this test added (deltas), inside the 30-day window.
  IF (v_view->'flows'->>'started')::int - (v_before->'flows'->>'started')::int <> 3
     OR (v_view->'flows'->>'completed')::int - (v_before->'flows'->>'completed')::int <> 1
     OR (v_view->'flows'->>'parked')::int - (v_before->'flows'->>'parked')::int <> 1
     OR (v_view->'flows'->>'cancelled')::int - (v_before->'flows'->>'cancelled')::int <> 1 THEN
    RAISE EXCEPTION 'F2-2 flow counts wrong: before % after %', v_before->'flows', v_view->'flows';
  END IF;
  IF (v_view->'turns'->>'host_turns')::int - (v_before->'turns'->>'host_turns')::int <> 4
     OR (v_view->'turns'->>'ari_replies')::int - (v_before->'turns'->>'ari_replies')::int <> 4
     OR (v_view->'turns'->>'refusals')::int - (v_before->'turns'->>'refusals')::int <> 1
     OR (v_view->'turns'->>'repeat_requests')::int - (v_before->'turns'->>'repeat_requests')::int <> 1
     OR (v_view->'turns'->>'empty_replies')::int - (v_before->'turns'->>'empty_replies')::int <> 1 THEN
    RAISE EXCEPTION 'F2-3 turn counts wrong: before % after %', v_before->'turns', v_view->'turns';
  END IF;
  IF (v_view->'feedback'->>'up')::int - (v_before->'feedback'->>'up')::int <> 1
     OR (v_view->'feedback'->>'down')::int - (v_before->'feedback'->>'down')::int <> 1 THEN
    RAISE EXCEPTION 'F2-4 thumbs wrong: %', v_view->'feedback';
  END IF;

  -- Rates are the reported counts (4 places).
  IF (v_view->'rates'->>'flow_completion')::numeric <> round(
       (v_view->'flows'->>'completed')::numeric / (v_view->'flows'->>'started')::numeric, 4)
     OR (v_view->'rates'->>'park')::numeric <> round(
       (v_view->'flows'->>'parked')::numeric / (v_view->'flows'->>'started')::numeric, 4)
     OR (v_view->'rates'->>'refusal')::numeric <> round(
       (v_view->'turns'->>'refusals')::numeric / (v_view->'turns'->>'ari_replies')::numeric, 4)
     OR (v_view->'rates'->>'repeat_request')::numeric <> round(
       (v_view->'turns'->>'repeat_requests')::numeric / (v_view->'turns'->>'host_turns')::numeric, 4)
     OR (v_view->'rates'->>'empty_reply')::numeric <> round(
       (v_view->'turns'->>'empty_replies')::numeric / (v_view->'turns'->>'ari_replies')::numeric, 4)
     OR (v_view->'rates'->>'thumbs_up')::numeric <> round(
       (v_view->'feedback'->>'up')::numeric /
       ((v_view->'feedback'->>'up')::numeric + (v_view->'feedback'->>'down')::numeric), 4) THEN
    RAISE EXCEPTION 'F2-5 rates do not match counts: %', v_view;
  END IF;

  -- The window: the 40-day-old setup and turn count only in 60 days.
  v_delta := (v_view60->'flows'->>'started')::int - (v_before60->'flows'->>'started')::int;
  IF v_delta <> 4 THEN RAISE EXCEPTION 'F2-6 60-day window started delta %, want 4', v_delta; END IF;
  v_delta := (v_view60->'turns'->>'host_turns')::int - (v_before60->'turns'->>'host_turns')::int;
  IF v_delta <> 5 THEN RAISE EXCEPTION 'F2-6 60-day window host-turn delta %, want 5', v_delta; END IF;
  IF (public.ari_admin_quality_metrics(0)->>'days')::int <> 1
     OR (public.ari_admin_quality_metrics(9999)->>'days')::int <> 180
     OR (public.ari_admin_quality_metrics(NULL)->>'days')::int <> 30 THEN
    RAISE EXCEPTION 'F2-6 the window must clamp to 1..180 (default 30)';
  END IF;

  -- Turns to done: the completed event setup saw host turns 1 and 3.
  SELECT e INTO v_event FROM jsonb_array_elements(v_view->'turns_to_done') e
   WHERE e->>'flow_key' = 'create_event';
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'F2-7 no turns-to-done row for create_event: %', v_view->'turns_to_done';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_view->'turns_to_done') e
     WHERE e->>'flow_key' = 'create_event' AND (e->>'completed')::int >= 1
       AND (e->>'median_turns')::int >= 0
  ) THEN
    RAISE EXCEPTION 'F2-7 turns-to-done row malformed: %', v_event;
  END IF;
  RESET ROLE;

  -- This test's own setup in isolation: exactly 2 host turns to done.
  IF (SELECT count(*) FROM public.agent_messages m, public.ari_flow_runs r
       WHERE r.id = '33550000-f200-4000-8000-0000000000f1'
         AND m.conversation_id = r.conversation_id AND m.role = 'user'
         AND m.created_at >= r.created_at AND m.created_at <= r.completed_at) <> 2 THEN
    RAISE EXCEPTION 'F2-7 fixture: the completed setup should hold 2 host turns';
  END IF;
END
$f2metrics$;

-- Read only: the panel's read changed nothing.
DO $f2readonly$
DECLARE
  v_runs bigint;
  v_after bigint;
BEGIN
  SELECT count(*) INTO v_runs FROM public.ari_flow_runs;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.f2_as('33550000-f200-4000-8000-000000000004', 'f2-staff@test.local');
  PERFORM public.ari_admin_quality_metrics(30);
  RESET ROLE;
  SELECT count(*) INTO v_after FROM public.ari_flow_runs;
  IF v_after <> v_runs THEN RAISE EXCEPTION 'F2-8 the read wrote rows'; END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.ari_admin_quality_metrics(integer)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'F2-8 ari_admin_quality_metrics must be STABLE (read only)';
  END IF;
END
$f2readonly$;

ROLLBACK;
