-- MINGLA-INVARIANT: I-ARI-GAPS-LOGGED-ONCE-PER-TURN | issue #3355 | public.ari_record_turn_gaps (service role only) writes at most one ari_capability_gap_events row per gap type per turn, bound to the caller's own Ari conversation, and a host reads only their own gap rows.
-- MINGLA-INVARIANT: I-ARI-GAP-DIGEST-WEEKLY | issue #3355 | public.ari_gap_weekly_digest records one ari_gap_digests row per ISO week and adds at most ONE Work board card for it through ops_auto_card_upsert (auto_key ari_gap_digest:<ISO week>); Ari gaps and "Turn into eval" are admin only.
-- MINGLA-INVARIANT: I-ARI-ASK-TEAM-HOURLY | issue #3355 | An "Ask the Mingla team" note (tell_owner_in_brand_group about ask_mingla_team) posts at most once per Ari conversation per hour; a retry of the same approval replays its receipt.
--
-- Wave D (20280623073355). Reverting the migration fails the first block
-- (no ari_record_turn_gaps).

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('33550000-d200-4000-8000-000000000001','d2-owner@test.local','{"full_name":"Olu Owner"}'),
  ('33550000-d200-4000-8000-000000000002','d2-host@test.local','{"full_name":"Ada Host"}'),
  ('33550000-d200-4000-8000-000000000003','d2-outsider@test.local','{"full_name":"Out Sider"}'),
  ('33550000-d200-4000-8000-000000000004','d2-staff@test.local','{"full_name":"Sam Staff"}');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
  ('33550000-d200-4000-8000-000000000001','d2-owner@test.local','Olu Owner','d2_owner','business'),
  ('33550000-d200-4000-8000-000000000002','d2-host@test.local','Ada Host','d2_host','business'),
  ('33550000-d200-4000-8000-000000000003','d2-outsider@test.local','Out Sider','d2_outsider','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name) VALUES
  ('33550000-d200-4000-8000-000000000001','d2-owner@test.local','Olu Owner','D2 Host');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('33550000-d200-4000-8000-0000000000b1','33550000-d200-4000-8000-000000000001','Favy Lagos','d2-favy-lagos');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('33550000-d200-4000-8000-0000000000b1','33550000-d200-4000-8000-000000000002','event_manager',now());
INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
  ('33550000-d200-4000-8000-0000000000c1','33550000-d200-4000-8000-000000000002','33550000-d200-4000-8000-0000000000b1'),
  ('33550000-d200-4000-8000-0000000000c2','33550000-d200-4000-8000-000000000002','33550000-d200-4000-8000-0000000000b1'),
  ('33550000-d200-4000-8000-0000000000c3','33550000-d200-4000-8000-000000000003',NULL);
-- Six owner turns in c1, oldest first, one minute apart.
INSERT INTO public.agent_messages(id,conversation_id,user_id,role,content,created_at)
SELECT ('33550000-d200-4000-8000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       '33550000-d200-4000-8000-0000000000c1','33550000-d200-4000-8000-000000000002',
       'user', jsonb_build_object('text', 'owner turn ' || g), now() - make_interval(mins => 10 - g)
  FROM generate_series(1, 6) g;
INSERT INTO public.admin_users(email, role, status)
VALUES ('d2-staff@test.local', 'admin', 'active');

CREATE OR REPLACE FUNCTION pg_temp.d2_as(p_user uuid, p_email text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
END;
$$;

DO $d2record$
DECLARE
  v_host constant uuid := '33550000-d200-4000-8000-000000000002';
  v_conv constant uuid := '33550000-d200-4000-8000-0000000000c1';
  v_msg constant uuid := '33550000-d200-4000-8000-000000000106';
  v_n integer;
  v_error text;
BEGIN
  IF has_function_privilege('authenticated', 'public.ari_record_turn_gaps(uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ari_record_turn_gaps(uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ari_record_turn_gaps(uuid,uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D2-ACL ari_record_turn_gaps must be service role only';
  END IF;
  IF has_table_privilege('authenticated', 'public.ari_capability_gap_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.ari_gap_digests', 'SELECT') THEN
    RAISE EXCEPTION 'D2-ACL hosts must not write gaps or read digests';
  END IF;

  SET LOCAL ROLE service_role;
  -- 1. One row per type per turn, even when a type repeats in one call.
  v_n := public.ari_record_turn_gaps(v_host, v_conv, v_msg, 'turn-1', jsonb_build_array(
    jsonb_build_object('type', 'refusal', 'excerpt', 'create a discount code [number]'),
    jsonb_build_object('type', 'refusal', 'excerpt', 'second refusal same turn'),
    jsonb_build_object('type', 'frustration', 'excerpt', 'WHY IS THIS NOT WORKING', 'strong', true)
  ));
  IF v_n <> 2 THEN RAISE EXCEPTION 'D2-1 expected 2 rows, got %', v_n; END IF;
  -- The same turn logged again adds nothing.
  v_n := public.ari_record_turn_gaps(v_host, v_conv, v_msg, 'turn-1',
    jsonb_build_array(jsonb_build_object('type', 'refusal', 'excerpt', 'again')));
  IF v_n <> 0 THEN RAISE EXCEPTION 'D2-1 a repeat of the turn added % row(s)', v_n; END IF;
  -- A later turn is a new occurrence.
  v_n := public.ari_record_turn_gaps(v_host, v_conv, NULL, 'turn-2',
    jsonb_build_array(jsonb_build_object('type', 'refusal', 'excerpt', 'still cannot')));
  IF v_n <> 1 THEN RAISE EXCEPTION 'D2-1 the next turn was not logged'; END IF;
  RESET ROLE;
  IF (SELECT occurrence_count FROM public.ari_capability_gaps WHERE capability_key = 'auto.refusal') <> 2 THEN
    RAISE EXCEPTION 'D2-1 the refusal count is not the number of events';
  END IF;
  IF (SELECT brand_id FROM public.ari_capability_gap_events WHERE turn_key = 'turn-1' AND gap_type = 'refusal')
     IS DISTINCT FROM '33550000-d200-4000-8000-0000000000b1'::uuid THEN
    RAISE EXCEPTION 'D2-1 the gap did not take the conversation''s brand';
  END IF;

  -- 2. A conversation that is not the user's, or an unknown type, is refused.
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.ari_record_turn_gaps(v_host, '33550000-d200-4000-8000-0000000000c3', NULL, 'turn-x',
      jsonb_build_array(jsonb_build_object('type', 'refusal')));
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'conversation_mismatch' THEN RAISE EXCEPTION 'D2-2 another user''s conversation (%)', v_error; END IF;
  BEGIN
    PERFORM public.ari_record_turn_gaps(v_host, v_conv, NULL, 'turn-y',
      jsonb_build_array(jsonb_build_object('type', 'made_up')));
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'invalid_gap_type' THEN RAISE EXCEPTION 'D2-2 unknown type (%)', v_error; END IF;
  RESET ROLE;
END
$d2record$;

-- 3. The host reads their own gaps; the window is the last 5 owner turns.
DO $d2signals$
DECLARE
  v_host constant uuid := '33550000-d200-4000-8000-000000000002';
  v_outsider constant uuid := '33550000-d200-4000-8000-000000000003';
  v_conv constant uuid := '33550000-d200-4000-8000-0000000000c1';
  v_signals jsonb;
  v_error text;
  v_count bigint;
BEGIN
  -- A gap from before the 5th latest owner turn is outside the window.
  INSERT INTO public.ari_capability_gap_events(gap_id, gap_type, user_id, conversation_id, turn_key, excerpt, created_at)
  SELECT id, 'refusal', v_host, v_conv, 'turn-old', 'old', now() - interval '20 minutes'
    FROM public.ari_capability_gaps WHERE capability_key = 'auto.refusal';
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.d2_as(v_host);
  v_signals := public.ari_conversation_gap_signals(v_conv);
  IF jsonb_array_length(v_signals) <> 3
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_signals) x WHERE x->>'excerpt' = 'old') THEN
    RAISE EXCEPTION 'D2-3 signals window wrong: %', v_signals;
  END IF;
  SELECT count(*) INTO v_count FROM public.ari_capability_gap_events;
  IF v_count <> 4 THEN RAISE EXCEPTION 'D2-3 the host should read their 4 gap rows, read %', v_count; END IF;
  PERFORM pg_temp.d2_as(v_outsider);
  SELECT count(*) INTO v_count FROM public.ari_capability_gap_events;
  IF v_count <> 0 THEN RAISE EXCEPTION 'D2-3 another user read % gap row(s)', v_count; END IF;
  BEGIN
    PERFORM public.ari_conversation_gap_signals(v_conv);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'D2-3 another user read the signals (%)', v_error; END IF;
  RESET ROLE;
END
$d2signals$;

-- 4. Admin "Ari gaps" and "Turn into eval".
DO $d2admin$
DECLARE
  v_host constant uuid := '33550000-d200-4000-8000-000000000002';
  v_staff constant uuid := '33550000-d200-4000-8000-000000000004';
  v_view jsonb;
  v_event uuid;
  v_eval jsonb;
  v_again jsonb;
  v_error text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.d2_as(v_host);
  BEGIN
    PERFORM public.ari_admin_capability_gap_events(8, NULL, 50);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error <> 'not_authorized' THEN RAISE EXCEPTION 'D2-4 a host opened Ari gaps (%)', v_error; END IF;

  PERFORM pg_temp.d2_as(v_staff, 'd2-staff@test.local');
  v_view := public.ari_admin_capability_gap_events(8, NULL, 50);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_view->'weeks') w
                  WHERE w->>'gap_type' = 'refusal' AND (w->>'count')::integer = 3) THEN
    RAISE EXCEPTION 'D2-4 weekly refusal count wrong: %', v_view->'weeks';
  END IF;
  SELECT (e->>'id')::uuid INTO v_event FROM jsonb_array_elements(v_view->'events') e
   WHERE e->>'gap_type' = 'frustration' LIMIT 1;
  IF v_event IS NULL THEN RAISE EXCEPTION 'D2-4 frustration event missing: %', v_view->'events'; END IF;

  v_eval := public.ari_admin_gap_to_eval(v_event);
  IF (v_eval->>'created')::boolean IS NOT TRUE
     OR v_eval->>'scenario_key' NOT LIKE 'GAP-%'
     OR v_eval->'input_fixture'->>'message' <> 'WHY IS THIS NOT WORKING'
     OR v_eval->'expected_fixture'->'forbidden_gap_types'->>0 <> 'frustration' THEN
    RAISE EXCEPTION 'D2-4 eval scenario wrong: %', v_eval;
  END IF;
  v_again := public.ari_admin_gap_to_eval(v_event);
  IF (v_again->>'created')::boolean IS NOT FALSE OR v_again->>'id' <> v_eval->>'id' THEN
    RAISE EXCEPTION 'D2-4 turning a gap into an eval twice made two scenarios';
  END IF;
  v_view := public.ari_admin_capability_gap_events(8, 'frustration', 50);
  IF (v_view->'events'->0->>'eval_scenario_key') IS DISTINCT FROM v_eval->>'scenario_key' THEN
    RAISE EXCEPTION 'D2-4 the gap does not show its eval: %', v_view->'events';
  END IF;
  RESET ROLE;
END
$d2admin$;

-- 5. The weekly digest: one row and one Work card per week.
DO $d2digest$
DECLARE
  v_week date := date_trunc('week', now())::date;
  v_first jsonb;
  v_second jsonb;
  v_empty jsonb;
  v_cards bigint;
BEGIN
  IF has_function_privilege('authenticated', 'public.ari_gap_weekly_digest(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'D2-5 hosts must not run the digest';
  END IF;
  v_first := public.ari_gap_weekly_digest(v_week);
  IF (v_first->>'total')::integer <> 4 OR (v_first->'counts'->>'refusal')::integer <> 3 THEN
    RAISE EXCEPTION 'D2-5 digest counts wrong: %', v_first;
  END IF;
  v_second := public.ari_gap_weekly_digest(v_week);
  SELECT count(*) INTO v_cards FROM public.ops_work_cards
   WHERE auto_key = 'ari_gap_digest:' || to_char(v_week, 'IYYY-"W"IW');
  IF v_first->'card'->>'status' = 'added' THEN
    IF v_cards <> 1 OR v_second->'card'->>'status' <> 'kept' THEN
      RAISE EXCEPTION 'D2-5 a second run made another card (cards %, %)', v_cards, v_second;
    END IF;
  ELSIF v_cards <> 0 THEN
    RAISE EXCEPTION 'D2-5 a refused card still landed: %', v_first;
  END IF;
  IF (SELECT count(*) FROM public.ari_gap_digests WHERE week_start = v_week) <> 1 THEN
    RAISE EXCEPTION 'D2-5 the digest row is not one per week';
  END IF;
  -- A week with no gaps records a digest and adds no card.
  v_empty := public.ari_gap_weekly_digest(v_week - 70);
  IF v_empty->'card'->>'status' <> 'skipped_empty' THEN
    RAISE EXCEPTION 'D2-5 an empty week made a card: %', v_empty;
  END IF;
  RAISE NOTICE 'D2-5 digest card: %', v_first->'card';
END
$d2digest$;

-- 6. "Ask the Mingla team": once per Ari conversation per hour.
DO $d2askteam$
DECLARE
  v_brand constant uuid := '33550000-d200-4000-8000-0000000000b1';
  v_host constant uuid := '33550000-d200-4000-8000-000000000002';
  v_note constant text := 'Ada asked Ari for help with Favy Lagos and Ari could not finish it.';
  v_group uuid;
  v_op1 uuid := gen_random_uuid();
  v_op2 uuid := gen_random_uuid();
  v_op3 uuid := gen_random_uuid();
  v_args jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_other jsonb;
  v_error text;
BEGIN
  SELECT id INTO STRICT v_group FROM public.conversations
   WHERE linked_entity_type = 'brand' AND brand_id = v_brand;
  v_args := jsonb_build_object('brand_id', v_brand, 'about', 'ask_mingla_team',
    'ari_conversation_id', '33550000-d200-4000-8000-0000000000c1',
    'send_to', 'Favy Lagos group chat', 'message', v_note);
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES
    (v_op1,v_host,'33550000-d200-4000-8000-0000000000c1','tell_owner_in_brand_group',v_args,'executing','ari',v_brand,now(),now()),
    (v_op2,v_host,'33550000-d200-4000-8000-0000000000c1','tell_owner_in_brand_group',v_args,'executing','ari',v_brand,now(),now()),
    (v_op3,v_host,'33550000-d200-4000-8000-0000000000c2','tell_owner_in_brand_group',
      v_args || jsonb_build_object('ari_conversation_id', '33550000-d200-4000-8000-0000000000c2'),'executing','ari',v_brand,now(),now());
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.d2_as(v_host);
  v_first := public.ari_tell_owner_in_brand_group(v_op1, v_group, v_note);
  IF (v_first->>'sent')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'D2-6 first ask failed: %', v_first; END IF;
  v_replay := public.ari_tell_owner_in_brand_group(v_op1, v_group, v_note);
  IF (v_replay->>'replayed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'D2-6 retry did not replay: %', v_replay; END IF;
  BEGIN
    PERFORM public.ari_tell_owner_in_brand_group(v_op2, v_group, v_note);
    v_error := 'none';
  EXCEPTION WHEN OTHERS THEN v_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_error <> 'PT409:ask_team_recently_sent' THEN
    RAISE EXCEPTION 'D2-6 a second ask within the hour was not refused (%)', v_error;
  END IF;
  v_other := public.ari_tell_owner_in_brand_group(v_op3, v_group, v_note);
  IF (v_other->>'sent')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'D2-6 another chat was blocked: %', v_other; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM public.messages WHERE conversation_id = v_group AND content = v_note) <> 2 THEN
    RAISE EXCEPTION 'D2-6 expected exactly two posted notes';
  END IF;
END
$d2askteam$;

SELECT 'issue_3355_ari_gap_logging: all tests passed' AS result;
ROLLBACK;
