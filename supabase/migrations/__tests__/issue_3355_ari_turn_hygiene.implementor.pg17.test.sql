-- Issue #3355 P1 — Ari turn and confirm hygiene (implementor happy path).
--
-- Pins, on the database clock:
--   * a claimed client_turn_id is a replay and is never rate-limited;
--   * only owner turns count; the 201st owner turn is refused with a reset
--     time equal to the oldest counted turn + 24 h (not "now + 24 h");
--   * an executing confirmation older than 2 minutes no longer blocks chat;
--   * agent_pending_action_claim_for_confirm decides expiry with now(): a row
--     whose expires_at is one second in the past is refused even though the
--     caller never looked at a clock;
--   * Ari proposals live 30 minutes, Hub proposals keep 5;
--   * a new Ari proposal supersedes the older pending one in the same chat;
--   * a stale executing row with a receipt becomes executed, and one without a
--     receipt past 10 minutes becomes failed_unknown with one plain owner line.
-- Applying the migration is required; reverting any function body makes a
-- block below raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355th$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000000c1';
  v_conversation uuid := '33550000-0000-4000-8000-0000000000c2';
  v_window record;
  v_oldest timestamptz;
  v_replay_turn uuid := '33550000-0000-4000-8000-0000000000c3';
  v_pending_a uuid := gen_random_uuid();
  v_pending_b uuid := gen_random_uuid();
  v_expired uuid := gen_random_uuid();
  v_live uuid := gen_random_uuid();
  v_hub uuid := gen_random_uuid();
  v_stale_receipt uuid := gen_random_uuid();
  v_stale_unknown uuid := gen_random_uuid();
  v_stale_young uuid := gen_random_uuid();
  v_answer text;
  v_status text;
  v_expires timestamptz;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES (v_owner,'owner-3355th@example.invalid');
  INSERT INTO public.agent_conversations(id,user_id) VALUES (v_conversation,v_owner);

  -- 200 owner turns over the last 20 hours, oldest first; plus 50 engine turns.
  INSERT INTO public.agent_messages(id,conversation_id,user_id,role,content)
  SELECT md5('m' || g)::uuid, v_conversation, v_owner, 'user', '{"text":"hi"}'
  FROM generate_series(1,250) g;
  INSERT INTO public.agent_turn_attempts(
    user_id,conversation_id,user_message_id,client_turn_id,request_digest,
    manifest_digest,status,origin,counted_at
  )
  SELECT v_owner, v_conversation, md5('m' || g)::uuid,
    CASE WHEN g = 200 THEN v_replay_turn ELSE md5('t' || g)::uuid END,
    repeat('a',64), repeat('b',64), 'completed',
    CASE WHEN g > 200 THEN 'engine' ELSE 'owner' END,
    now() - interval '20 hours' + (g * interval '5 minutes')
  FROM generate_series(1,250) g;

  SELECT min(counted_at) INTO v_oldest FROM public.agent_turn_attempts
  WHERE user_id = v_owner AND origin = 'owner';

  SELECT * INTO v_window FROM public.agent_turn_rate_window(v_owner, gen_random_uuid());
  IF v_window.allowed OR v_window.reason <> 'rate_limited_daily' THEN
    RAISE EXCEPTION 'the 201st owner turn must be refused, got %', row_to_json(v_window);
  END IF;
  IF v_window.turn_count <> 200 THEN
    RAISE EXCEPTION 'engine turns must not count: counted %', v_window.turn_count;
  END IF;
  IF v_window.reset_at <> v_oldest + interval '24 hours' THEN
    RAISE EXCEPTION 'reset must be oldest counted turn + 24h: % vs %', v_window.reset_at, v_oldest + interval '24 hours';
  END IF;
  IF v_window.retry_after_seconds < 3 * 3600 OR v_window.retry_after_seconds > 5 * 3600 THEN
    RAISE EXCEPTION 'retry_after_seconds must come from the DB clock: %', v_window.retry_after_seconds;
  END IF;

  SELECT * INTO v_window FROM public.agent_turn_rate_window(v_owner, v_replay_turn);
  IF NOT v_window.allowed OR NOT v_window.replay THEN
    RAISE EXCEPTION 'a claimed client_turn_id at the cap must replay, got %', row_to_json(v_window);
  END IF;

  -- Free one slot: the window opens.
  UPDATE public.agent_turn_attempts SET counted_at = now() - interval '25 hours'
  WHERE user_id = v_owner AND counted_at = v_oldest;
  SELECT * INTO v_window FROM public.agent_turn_rate_window(v_owner, gen_random_uuid());
  IF NOT v_window.allowed OR v_window.turn_count <> 199 THEN
    RAISE EXCEPTION 'one slot must be free, got %', row_to_json(v_window);
  END IF;

  -- TTL: Ari 30 minutes, Hub 5, explicit kept.
  INSERT INTO public.agent_pending_actions(id,user_id,conversation_id,tool_name,tool_args,server_proposed_at)
  VALUES (v_pending_a,v_owner,v_conversation,'create_event','{}',now());
  SELECT expires_at INTO v_expires FROM public.agent_pending_actions WHERE id = v_pending_a;
  IF v_expires <> now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'Ari proposals must live 30 minutes on the DB clock: %', v_expires - now();
  END IF;
  INSERT INTO public.agent_pending_actions(id,user_id,conversation_id,tool_name,tool_args,source)
  VALUES (v_hub,v_owner,NULL,'apply_menu','{}','hub_experience');
  SELECT expires_at INTO v_expires FROM public.agent_pending_actions WHERE id = v_hub;
  IF v_expires <> now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Hub proposals keep the 5-minute default: %', v_expires - now();
  END IF;

  -- Supersede: a newer Ari proposal in the same chat retires the older one.
  INSERT INTO public.agent_pending_actions(id,user_id,conversation_id,tool_name,tool_args,server_proposed_at)
  VALUES (v_pending_b,v_owner,v_conversation,'update_event','{}',now());
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_pending_a;
  IF v_status <> 'superseded' THEN
    RAISE EXCEPTION 'older pending proposal must be superseded, got %', v_status;
  END IF;
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_pending_b;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'newest proposal must stay pending, got %', v_status;
  END IF;

  -- Claim decides expiry on the DB clock.
  INSERT INTO public.agent_pending_actions(id,user_id,conversation_id,tool_name,tool_args,expires_at,server_proposed_at)
  VALUES (v_expired,v_owner,v_conversation,'create_event','{}',now() - interval '1 second',now());
  v_answer := public.agent_pending_action_claim_for_confirm(v_expired,v_owner,'{"a":1}'::jsonb,false);
  IF v_answer <> 'expired' THEN
    RAISE EXCEPTION 'expired by one second must be refused, got %', v_answer;
  END IF;
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_expired;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'an expired claim must change nothing, got %', v_status;
  END IF;

  INSERT INTO public.agent_pending_actions(id,user_id,conversation_id,tool_name,tool_args,server_proposed_at)
  VALUES (v_live,v_owner,v_conversation,'create_event','{"title":"x"}',now());
  v_answer := public.agent_pending_action_claim_for_confirm(v_live,v_owner,NULL,true);
  IF v_answer <> 'pending' THEN
    RAISE EXCEPTION 'probe must answer pending, got %', v_answer;
  END IF;
  v_answer := public.agent_pending_action_claim_for_confirm(v_live,v_owner,'{"title":"y"}'::jsonb,false);
  IF v_answer <> 'claimed' THEN
    RAISE EXCEPTION 'live proposal must be claimed, got %', v_answer;
  END IF;
  PERFORM 1 FROM public.agent_pending_actions
  WHERE id = v_live AND status = 'executing' AND tool_args = '{"title":"y"}'::jsonb
    AND executing_started_at = now() AND execution_attested_at = now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim must flip with the confirmed args and a DB-clock lease';
  END IF;
  v_answer := public.agent_pending_action_claim_for_confirm(v_live,v_owner,'{"title":"y"}'::jsonb,false);
  IF v_answer <> 'executing' THEN
    RAISE EXCEPTION 'second claim must see executing, got %', v_answer;
  END IF;

  -- A fresh executing lease blocks; an aged one does not.
  SELECT * INTO v_window FROM public.agent_turn_rate_window(v_owner, gen_random_uuid());
  IF v_window.allowed OR v_window.reason <> 'rate_limited_inflight' THEN
    RAISE EXCEPTION 'a fresh executing lease must block, got %', row_to_json(v_window);
  END IF;
  UPDATE public.agent_pending_actions
  SET executing_started_at = now() - interval '3 minutes'
  WHERE id = v_live;
  SELECT * INTO v_window FROM public.agent_turn_rate_window(v_owner, gen_random_uuid());
  IF NOT v_window.allowed THEN
    RAISE EXCEPTION 'an executing row aged 3 minutes must not block, got %', row_to_json(v_window);
  END IF;

  -- Stale reconcile.
  INSERT INTO public.agent_pending_actions(id,user_id,conversation_id,tool_name,tool_args,status,server_proposed_at,execution_attested_at,executing_started_at)
  VALUES
    (v_stale_receipt,v_owner,v_conversation,'update_event','{}','executing',now(),now(),now() - interval '3 minutes'),
    (v_stale_unknown,v_owner,v_conversation,'save_site_plan_answers','{}','executing',now(),now(),now() - interval '11 minutes'),
    (v_stale_young,v_owner,v_conversation,'save_site_plan_design','{}','executing',now(),now(),now() - interval '3 minutes');
  INSERT INTO public.agent_operation_receipts(operation_id,user_id,tool_name,request_hash,result)
  VALUES (v_stale_receipt,v_owner,'update_event',repeat('c',64),'{"event":{"id":"e"}}');
  PERFORM public.agent_pending_action_reconcile_stale(v_owner);
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_stale_receipt;
  IF v_status <> 'executed' THEN
    RAISE EXCEPTION 'stale row with a receipt must become executed, got %', v_status;
  END IF;
  PERFORM 1 FROM public.agent_pending_action_terminal_receipts
  WHERE pending_action_id = v_stale_receipt AND outcome = 'executed';
  IF NOT FOUND THEN RAISE EXCEPTION 'executed reconcile must write the terminal receipt'; END IF;
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_stale_unknown;
  IF v_status <> 'failed_unknown' THEN
    RAISE EXCEPTION 'stale row without a receipt past 10 minutes must become failed_unknown, got %', v_status;
  END IF;
  SELECT count(*) INTO v_count FROM public.agent_messages
  WHERE conversation_id = v_conversation AND role = 'assistant'
    AND content->>'text' LIKE 'I couldn''t confirm that change saved%';
  IF v_count <> 1 THEN RAISE EXCEPTION 'exactly one owner line for failed_unknown, got %', v_count; END IF;
  SELECT status INTO v_status FROM public.agent_pending_actions WHERE id = v_stale_young;
  IF v_status <> 'executing' THEN
    RAISE EXCEPTION 'a row inside 10 minutes without a receipt stays executing, got %', v_status;
  END IF;

  -- Privilege: no client role may call the service functions.
  IF has_function_privilege('authenticated','public.agent_turn_rate_window(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.agent_pending_action_claim_for_confirm(uuid,uuid,jsonb,boolean)','EXECUTE')
     OR has_function_privilege('anon','public.agent_pending_action_reconcile_stale(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'turn hygiene functions must be service-role only';
  END IF;
END;
$i3355th$;

ROLLBACK;
