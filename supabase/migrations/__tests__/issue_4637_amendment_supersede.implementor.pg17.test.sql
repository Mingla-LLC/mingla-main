-- MINGLA-INVARIANT: I-ARI-AMENDMENT-BLOCKS-STALE-CONFIRM | issue #4637 | A pending Ari proposal cannot be confirmed after a newer non-affirmation owner message.
-- MINGLA-INVARIANT: I-ARI-NO-SILENT-TURN | issue #4637 | Every claimed owner attempt that fails commits one assistant failure reply atomically.
-- MINGLA-INVARIANT: I-ARI-NO-CARD-WITHOUT-PROSE | issue #4637 | An assistant proposal or rendition cannot be stored without owner prose.
\set ON_ERROR_STOP on
\getenv issue_4637_dblink_password PGPASSWORD
BEGIN;

DO $test$
DECLARE
  v_user uuid := '46371000-0000-4000-8000-000000000001';
  v_chat_supersede uuid := '46371000-0000-4000-8100-000000000001';
  v_chat_backstop uuid := '46371000-0000-4000-8100-000000000002';
  v_chat_affirm uuid := '46371000-0000-4000-8100-000000000003';
  v_chat_failure uuid := '46371000-0000-4000-8100-000000000004';
  v_chat_replay uuid := '46371000-0000-4000-8100-000000000005';
  v_chat_race uuid := '46371000-0000-4000-8100-000000000006';
  v_pending_supersede uuid := '46371000-0000-4000-8200-000000000001';
  v_pending_backstop uuid := '46371000-0000-4000-8200-000000000002';
  v_pending_affirm uuid := '46371000-0000-4000-8200-000000000003';
  v_pending_batch uuid := '46371000-0000-4000-8200-000000000004';
  v_pending_confirm_failure uuid := '46371000-0000-4000-8200-000000000005';
  v_pending_affirm_bound uuid := '46371000-0000-4000-8200-000000000006';
  v_pending_replay uuid := '46371000-0000-4000-8200-000000000007';
  v_pending_race uuid := '46371000-0000-4000-8200-000000000008';
  v_pending_race_replacement uuid := '46371000-0000-4000-8200-000000000009';
  v_pending_replace uuid := '46371000-0000-4000-8200-000000000010';
  v_pending_replace_next uuid := '46371000-0000-4000-8200-000000000011';
  v_message_supersede uuid := '46371000-0000-4000-8300-000000000001';
  v_message_backstop uuid := '46371000-0000-4000-8300-000000000002';
  v_message_affirm uuid := '46371000-0000-4000-8300-000000000003';
  v_message_failure uuid := '46371000-0000-4000-8300-000000000004';
  v_message_affirm_bound uuid := '46371000-0000-4000-8300-000000000005';
  v_message_replay uuid := '46371000-0000-4000-8300-000000000006';
  v_message_replay_origin uuid := '46371000-0000-4000-8300-000000000007';
  v_message_race_origin uuid := '46371000-0000-4000-8300-000000000008';
  v_message_race_amendment uuid := '46371000-0000-4000-8300-000000000009';
  v_message_replace_affirm uuid := '46371000-0000-4000-8300-000000000010';
  v_failure_reply uuid := '46371000-0000-4000-8400-000000000001';
  v_proposal_reply uuid := '46371000-0000-4000-8400-000000000002';
  v_backstop_proposal uuid := '46371000-0000-4000-8400-000000000003';
  v_pending_failure_reply uuid;
  v_replayed_failure_reply uuid;
  v_attempt uuid := '46371000-0000-4000-8500-000000000001';
  v_client_turn uuid := '46371000-0000-4000-8600-000000000001';
  v_confirm_client_turn uuid := '46371000-0000-4000-8600-000000000002';
  v_replay_origin_turn uuid := '46371000-0000-4000-8600-000000000003';
  v_race_origin_turn uuid := '46371000-0000-4000-8600-000000000004';
  v_result text;
  v_won boolean;
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.ari_supersede_pending_on_owner_turn(uuid,uuid,uuid)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role',
       'public.ari_supersede_pending_on_owner_turn(uuid,uuid,uuid)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.commit_agent_chat_failure_turn(uuid,integer,uuid,uuid,uuid,uuid,jsonb,text,text,text,text)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.ari_bind_pending_affirmation(uuid,uuid,uuid,uuid)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.replace_agent_pending_action_for_edit(uuid,uuid,uuid,jsonb,text,text)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role',
       'public.replace_agent_pending_action_for_edit(uuid,uuid,uuid,jsonb,text,text)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role',
       'public.ari_bind_pending_affirmation(uuid,uuid,uuid,uuid)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.terminalize_agent_pending_failure(uuid,uuid,text,text,jsonb,text,text)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role',
       'public.terminalize_agent_pending_failure(uuid,uuid,text,text,jsonb,text,text)',
       'EXECUTE'
     ) OR has_table_privilege(
       'authenticated','public.ari_pending_affirmation_bindings','SELECT'
     ) OR NOT has_table_privilege(
       'service_role','public.ari_pending_affirmation_bindings','INSERT'
     ) THEN
    RAISE EXCEPTION 'Slice 1 authority is not service-role-only';
  END IF;

  INSERT INTO auth.users(id,email)
  VALUES (v_user,'issue4637-amendment@example.test');
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  INSERT INTO public.creator_accounts(id,email)
  VALUES (v_user,'issue4637-amendment@example.test');
  INSERT INTO public.agent_conversations(id,user_id,title)
  VALUES
    (v_chat_supersede,v_user,'Supersede fixture'),
    (v_chat_backstop,v_user,'Backstop fixture'),
    (v_chat_affirm,v_user,'Affirm fixture'),
    (v_chat_failure,v_user,'Failure fixture'),
    (v_chat_replay,v_user,'Replay fixture'),
    (v_chat_race,v_user,'Slow turn race fixture');

  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,created_at,expires_at
  ) VALUES (
    v_pending_supersede,v_user,v_chat_supersede,'create_discount',
    '{"scope_kind":"listings","targets":[{"target_kind":"event","target_id":"46371000-0000-4000-8700-000000000001"}]}'::jsonb,
    'pending','ari','2026-01-01 10:00:00+00','2026-01-01 10:00:00+00',
    now() + interval '1 hour'
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,created_at
  ) VALUES (
    v_message_supersede,v_chat_supersede,v_user,'user',
    '{"text":"Only for Regular tickets"}'::jsonb,
    '2026-01-01 10:01:00+00'
  );
  PERFORM * FROM public.ari_supersede_pending_on_owner_turn(
    v_user,v_chat_supersede,v_message_supersede
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE id=v_pending_supersede AND status='superseded'
      AND failure_reason='OWNER_AMENDED'
      AND owner_amended_message_id=v_message_supersede
  ) THEN
    RAISE EXCEPTION 'owner amendment did not supersede and bind the message';
  END IF;

  -- Backstop alone: no supersede RPC call. The claim itself must close it.
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,created_at,expires_at
  ) VALUES (
    v_pending_backstop,v_user,v_chat_backstop,'create_discount',
    '{"scope_kind":"brand","targets":[]}'::jsonb,
    'pending','ari','2026-01-01 11:00:00+00','2026-01-01 11:00:00+00',
    now() + interval '1 hour'
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,tool_calls,created_at
  ) VALUES (
    v_backstop_proposal,v_chat_backstop,v_user,'assistant',
    '{"text":"Review this discount. Confirm to save it."}'::jsonb,
    jsonb_build_object(
      'tool_name','create_discount',
      'args','{"scope_kind":"brand","targets":[]}'::jsonb,
      'pending_action_id',v_pending_backstop::text
    ),
    '2026-01-01 11:00:00+00'
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,created_at
  ) VALUES (
    v_message_backstop,v_chat_backstop,v_user,'user',
    '{"text":"Actually, Regular tickets only"}'::jsonb,
    '2026-01-01 11:01:00+00'
  );
  v_result := public.agent_pending_action_claim_for_confirm(
    v_pending_backstop,v_user,NULL,true
  );
  IF v_result <> 'stale_amended' OR NOT EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE id=v_pending_backstop AND status='superseded'
      AND failure_reason='OWNER_AMENDED'
  ) THEN
    RAISE EXCEPTION 'confirm-time amendment backstop did not fail closed: %',v_result;
  END IF;
  IF (SELECT tool_calls->'args' FROM public.agent_messages
      WHERE id=v_backstop_proposal) <>
       '{"scope_kind":"brand","targets":[]}'::jsonb THEN
    RAISE EXCEPTION 'stale edited confirm mutated durable proposal history';
  END IF;

  -- A client-authored JSON marker cannot forge the bare-affirmation exception.
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,created_at,expires_at
  ) VALUES (
    v_pending_affirm,v_user,v_chat_affirm,'create_discount',
    '{"scope_kind":"brand","targets":[]}'::jsonb,
    'pending','ari','2026-01-01 12:00:00+00','2026-01-01 12:00:00+00',
    now() + interval '1 hour'
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,created_at
  ) VALUES (
    v_message_affirm,v_chat_affirm,v_user,'user',
    jsonb_build_object('text','yes','affirmation_of',v_pending_affirm::text),
    '2026-01-01 12:01:00+00'
  );
  v_result := public.agent_pending_action_claim_for_confirm(
    v_pending_affirm,v_user,'{"scope_kind":"brand","targets":[]}'::jsonb,false
  );
  IF v_result <> 'stale_amended' OR NOT EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE id=v_pending_affirm AND status='superseded'
  ) THEN
    RAISE EXCEPTION 'client-forged affirmation bypassed the backstop: %',v_result;
  END IF;

  -- The service-bound exact affirmation for an older proposal is accepted.
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,created_at,expires_at
  ) VALUES (
    v_pending_affirm_bound,v_user,v_chat_affirm,'create_discount',
    '{"scope_kind":"brand","targets":[]}'::jsonb,
    'pending','ari','2026-01-01 13:00:00+00','2026-01-01 13:00:00+00',
    now() + interval '1 hour'
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,created_at
  ) VALUES (
    v_message_affirm_bound,v_chat_affirm,v_user,'user','{"text":"yes"}'::jsonb,
    '2026-01-01 13:01:00+00'
  );
  IF public.ari_bind_pending_affirmation(
       v_user,v_chat_affirm,v_message_affirm_bound,v_pending_affirm_bound
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'service could not bind an exact bare affirmation';
  END IF;
  v_result := public.agent_pending_action_claim_for_confirm(
    v_pending_affirm_bound,v_user,
    '{"scope_kind":"brand","targets":[]}'::jsonb,false
  );
  IF v_result <> 'claimed' OR NOT EXISTS (
    SELECT 1 FROM public.agent_pending_actions
    WHERE id=v_pending_affirm_bound AND status='executing'
  ) THEN
    RAISE EXCEPTION 'service-bound bare affirmation was blocked: %',v_result;
  END IF;

  -- Replaying an old owner turn cannot supersede a proposal created later.
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,created_at
  ) VALUES (
    v_message_replay,v_chat_replay,v_user,'user',
    '{"text":"Only Regular tickets"}'::jsonb,'2026-01-01 14:00:00+00'
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,client_turn_id,created_at
  ) VALUES (
    v_message_replay_origin,v_chat_replay,v_user,'user',
    '{"text":"Create a new discount"}'::jsonb,v_replay_origin_turn,
    '2026-01-01 14:05:00+00'
  );
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,created_at,expires_at,origin_client_turn_id
  ) VALUES (
    v_pending_replay,v_user,v_chat_replay,'create_discount','{}'::jsonb,
    'pending','ari','2026-01-01 14:10:00+00','2026-01-01 14:10:00+00',
    now() + interval '1 hour',v_replay_origin_turn
  );
  PERFORM * FROM public.ari_supersede_pending_on_owner_turn(
    v_user,v_chat_replay,v_message_replay
  );
  IF (SELECT status FROM public.agent_pending_actions WHERE id=v_pending_replay)
       <> 'pending' THEN
    RAISE EXCEPTION 'old replay superseded a newer proposal';
  END IF;

  -- A newer amendment can arrive while the originating turn is still slow.
  -- It must stale the card even when the card was inserted after the amendment.
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,client_turn_id,created_at
  ) VALUES
    (
      v_message_race_origin,v_chat_race,v_user,'user',
      '{"text":"Create a discount"}'::jsonb,v_race_origin_turn,
      '2026-01-01 15:00:00+00'
    ),
    (
      v_message_race_amendment,v_chat_race,v_user,'user',
      '{"text":"Only Regular tickets"}'::jsonb,NULL,
      '2026-01-01 15:01:00+00'
    );
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,created_at,expires_at,origin_client_turn_id
  ) VALUES (
    v_pending_race,v_user,v_chat_race,'create_discount','{}'::jsonb,
    'pending','ari','2026-01-01 15:02:00+00','2026-01-01 15:02:00+00',
    now() + interval '1 hour',v_race_origin_turn
  );
  v_result := public.replace_agent_pending_action_for_edit(
    v_pending_race,v_user,v_pending_race_replacement,'{}'::jsonb,
    'ari-v1','fixture'
  );
  IF v_result <> 'stale_amended' OR
     (SELECT owner_amended_message_id FROM public.agent_pending_actions
      WHERE id=v_pending_race) <> v_message_race_amendment OR
     EXISTS (
       SELECT 1 FROM public.agent_pending_actions
       WHERE id=v_pending_race_replacement
     ) THEN
    RAISE EXCEPTION 'slow originating turn escaped a newer amendment: %',v_result;
  END IF;

  -- A valid edited replacement cancels and inserts atomically after the same
  -- final stale-amendment claim used by ordinary confirmation.
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,created_at,expires_at
  ) VALUES (
    v_pending_replace,v_user,v_chat_failure,'create_event','{"title":"Old"}'::jsonb,
    'pending','ari',now(),now(),now() + interval '1 hour'
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,created_at
  ) VALUES (
    v_message_replace_affirm,v_chat_failure,v_user,'user','{"text":"yes"}'::jsonb,
    clock_timestamp()
  );
  IF public.ari_bind_pending_affirmation(
       v_user,v_chat_failure,v_message_replace_affirm,v_pending_replace
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'replacement fixture affirmation did not bind';
  END IF;
  v_result := public.replace_agent_pending_action_for_edit(
    v_pending_replace,v_user,v_pending_replace_next,'{"title":"Edited"}'::jsonb,
    'ari-v1','fixture'
  );
  IF v_result <> 'replaced'
     OR (SELECT status FROM public.agent_pending_actions
         WHERE id=v_pending_replace) <> 'cancelled'
     OR (SELECT status FROM public.agent_pending_actions
         WHERE id=v_pending_replace_next) <> 'pending'
     OR (SELECT tool_args FROM public.agent_pending_actions
         WHERE id=v_pending_replace_next) <> '{"title":"Edited"}'::jsonb
     OR (SELECT server_proposed_at FROM public.agent_pending_actions
         WHERE id=v_pending_replace_next) IS DISTINCT FROM
        (SELECT server_proposed_at FROM public.agent_pending_actions
         WHERE id=v_pending_replace)
     OR (SELECT pending_action_id FROM public.ari_pending_affirmation_bindings
         WHERE user_message_id=v_message_replace_affirm) <>
        v_pending_replace_next
     OR NOT EXISTS (
       SELECT 1 FROM public.agent_pending_action_terminal_receipts
       WHERE pending_action_id=v_pending_replace
         AND outcome='cancelled'
         AND failure_reason=
           'EDITED_REPLACEMENT:' || v_pending_replace_next::text
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.agent_messages
       WHERE conversation_id=v_chat_failure
         AND role='tool'
         AND tool_results->>'pending_action_id'=v_pending_replace::text
         AND tool_results->>'outcome'='cancelled'
         AND tool_results->>'reason'=
           'EDITED_REPLACEMENT:' || v_pending_replace_next::text
     ) THEN
    RAISE EXCEPTION 'edited replacement was not atomic: %',v_result;
  END IF;

  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,client_turn_id,
    prompt_version,model_version
  ) VALUES (
    v_message_failure,v_chat_failure,v_user,'user','{"text":"hello"}'::jsonb,
    v_client_turn,'tenant-v1','fixture'
  );
  INSERT INTO public.agent_turn_attempts(
    id,user_id,conversation_id,user_message_id,client_turn_id,
    request_digest,manifest_digest,attempt_number,status,
    accepted_at,started_at,updated_at
  ) VALUES (
    v_attempt,v_user,v_chat_failure,v_message_failure,v_client_turn,
    repeat('a',64),repeat('b',64),1,'running',now(),now(),now()
  );
  v_won := public.commit_agent_chat_failure_turn(
    v_attempt,1,v_user,v_chat_failure,v_client_turn,v_failure_reply,
    '{"text":"I could not finish that. Nothing was changed.","structured":{"failure":{"v":1,"class":"internal","retryable":true,"changed_anything":false}}}'::jsonb,
    'TURN_ABORTED','ari-v1','fixture','running'
  );
  IF v_won IS DISTINCT FROM true
     OR (SELECT status FROM public.agent_turn_attempts WHERE id=v_attempt) <> 'failed'
     OR (SELECT count(*) FROM public.agent_messages WHERE id=v_failure_reply) <> 1 THEN
    RAISE EXCEPTION 'failure reply and terminal status were not committed atomically';
  END IF;
  IF public.commit_agent_chat_failure_turn(
    v_attempt,1,v_user,v_chat_failure,v_client_turn,gen_random_uuid(),
    '{"text":"Second reply","structured":{"failure":{"v":1,"class":"internal","retryable":true,"changed_anything":false}}}'::jsonb,
    'TURN_ABORTED','ari-v1','fixture','running'
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'terminal attempt accepted a second failure reply';
  END IF;

  -- A confirm failure terminalizes and writes its later assistant reply in one
  -- transaction. Invalid reply content rolls both sides back.
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,origin_client_turn_id,execution_attested_at
  ) VALUES (
    v_pending_confirm_failure,v_user,v_chat_failure,'create_discount','{}'::jsonb,
    'executing','ari',now(),v_confirm_client_turn,now()
  );
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,client_turn_id,
    prompt_version,model_version
  ) VALUES (
    v_proposal_reply,v_chat_failure,v_user,'assistant',
    '{"text":"Review this discount. Confirm to save it."}'::jsonb,
    v_confirm_client_turn,'ari-v1','fixture'
  );
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  BEGIN
    PERFORM * FROM public.terminalize_agent_pending_failure(
      v_pending_confirm_failure,v_user,'executing','EXECUTION_FAILED',
      '{"text":""}'::jsonb,'ari-v1','fixture'
    );
    RAISE EXCEPTION 'invalid failure reply terminalized the action';
  EXCEPTION WHEN sqlstate '22023' THEN
    NULL;
  END;
  IF (SELECT status FROM public.agent_pending_actions
      WHERE id=v_pending_confirm_failure) <> 'executing'
     OR EXISTS (
       SELECT 1 FROM public.agent_pending_action_terminal_receipts
       WHERE pending_action_id=v_pending_confirm_failure
     ) THEN
    RAISE EXCEPTION 'invalid failure reply did not roll back terminalization';
  END IF;

  SELECT failure_message_id INTO v_pending_failure_reply
  FROM public.terminalize_agent_pending_failure(
    v_pending_confirm_failure,v_user,'executing','EXECUTION_FAILED',
    '{"text":"I could not finish that. Nothing was changed.","structured":{"failure":{"v":1,"class":"tool_failed","retryable":true,"changed_anything":false}}}'::jsonb,
    'ari-v1','fixture'
  );
  SELECT failure_message_id INTO v_replayed_failure_reply
  FROM public.terminalize_agent_pending_failure(
    v_pending_confirm_failure,v_user,'executing','EXECUTION_FAILED',
    '{"text":"I could not finish that. Nothing was changed.","structured":{"failure":{"v":1,"class":"tool_failed","retryable":true,"changed_anything":false}}}'::jsonb,
    'ari-v1','fixture'
  );
  IF v_pending_failure_reply IS NULL
     OR (SELECT status FROM public.agent_pending_actions
         WHERE id=v_pending_confirm_failure) <> 'failed'
     OR (SELECT client_turn_id FROM public.agent_messages
         WHERE id=v_pending_failure_reply) IS NOT NULL
     OR v_replayed_failure_reply <> v_pending_failure_reply
     OR (SELECT count(*) FROM public.agent_messages
         WHERE content->>'failure_for_pending_action_id'=
           v_pending_confirm_failure::text) <> 1 THEN
    RAISE EXCEPTION 'confirm failure reply was not durable and idempotent';
  END IF;

  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,batch_items
  ) VALUES (
    v_pending_batch,v_user,v_chat_failure,'create_discount','{}'::jsonb,
    'pending','ari',now(),
    '[{"args":{"code":"A1"}},{"args":{"code":"A2"}}]'::jsonb
  );
  IF NOT has_function_privilege(
       'service_role','public.ari_batch_items_valid(jsonb)','EXECUTE'
     ) THEN
    RAISE EXCEPTION 'service role cannot evaluate the batch CHECK';
  END IF;
  BEGIN
    UPDATE public.agent_pending_actions
    SET batch_items='[{"args":{}}]'::jsonb
    WHERE id=v_pending_batch;
    RAISE EXCEPTION 'one-item batch passed the CHECK';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.agent_pending_actions
    SET batch_items='[{"args":{}},{"no_args":true}]'::jsonb
    WHERE id=v_pending_batch;
    RAISE EXCEPTION 'batch item without args object passed the CHECK';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.agent_messages(
      conversation_id,user_id,role,content,tool_calls
    ) VALUES (
      v_chat_failure,v_user,'assistant','{"text":""}'::jsonb,
      '{"tool_name":"create_discount"}'::jsonb
    );
    RAISE EXCEPTION 'empty proposal prose passed the database guard';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$test$;

ROLLBACK;

-- A legacy card has no origin turn id. Hold terminal-receipt persistence after
-- the replacement RPC's stale check, commit a newer owner message, then let
-- replacement finish. The replacement must retain the original ancestry
-- cutoff so the normal owner-turn supersede pass still closes it.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DROP FUNCTION IF EXISTS public.issue_4637_hold_terminal_receipt_lock(numeric);
CREATE FUNCTION public.issue_4637_hold_terminal_receipt_lock(p_seconds numeric)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  LOCK TABLE public.agent_pending_action_terminal_receipts
    IN ACCESS EXCLUSIVE MODE;
  PERFORM pg_sleep(p_seconds);
  RETURN 1;
END;
$function$;

DROP FUNCTION IF EXISTS public.issue_4637_replace_for_test(uuid,uuid,uuid,jsonb);
CREATE FUNCTION public.issue_4637_replace_for_test(
  p_pending_action_id uuid,
  p_user_id uuid,
  p_replacement_pending_action_id uuid,
  p_tool_args jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  RETURN public.replace_agent_pending_action_for_edit(
    p_pending_action_id,p_user_id,p_replacement_pending_action_id,p_tool_args,
    'ari-v1','fixture'
  );
END;
$function$;

DO $cleanup$
DECLARE
  v_user uuid := '46371000-0000-4000-8000-000000000101';
  v_chat uuid := '46371000-0000-4000-8100-000000000101';
  v_old uuid := '46371000-0000-4000-8200-000000000101';
  v_new uuid := '46371000-0000-4000-8200-000000000102';
BEGIN
  DELETE FROM public.agent_pending_action_terminal_receipts
  WHERE pending_action_id IN (v_old,v_new);
  DELETE FROM public.agent_messages WHERE conversation_id=v_chat;
  DELETE FROM public.agent_pending_actions WHERE id IN (v_old,v_new);
  DELETE FROM public.agent_conversations WHERE id=v_chat;
  DELETE FROM public.creator_accounts WHERE id=v_user;
  DELETE FROM auth.users WHERE id=v_user;
END;
$cleanup$;

INSERT INTO auth.users(id,email)
VALUES (
  '46371000-0000-4000-8000-000000000101',
  'issue4637-replacement-race@example.test'
);
INSERT INTO public.creator_accounts(id,email)
VALUES (
  '46371000-0000-4000-8000-000000000101',
  'issue4637-replacement-race@example.test'
);
INSERT INTO public.agent_conversations(id,user_id,title)
VALUES (
  '46371000-0000-4000-8100-000000000101',
  '46371000-0000-4000-8000-000000000101',
  'Replacement race fixture'
);
INSERT INTO public.agent_pending_actions(
  id,user_id,conversation_id,tool_name,tool_args,status,source,
  server_proposed_at,created_at,expires_at,origin_client_turn_id
) VALUES (
  '46371000-0000-4000-8200-000000000101',
  '46371000-0000-4000-8000-000000000101',
  '46371000-0000-4000-8100-000000000101',
  'create_event','{"title":"Before"}'::jsonb,'pending','ari',
  clock_timestamp() - interval '5 minutes',
  clock_timestamp() - interval '5 minutes',
  clock_timestamp() + interval '1 hour',NULL
);

SELECT extensions.dblink_connect(
  'issue4637_terminal_lock',
  format(
    'host=127.0.0.1 port=%s dbname=%L user=%L password=%L',
    current_setting('port'),current_database(),current_user,
    :'issue_4637_dblink_password'
  )
);
SELECT extensions.dblink_connect(
  'issue4637_replacement_waiter',
  format(
    'host=127.0.0.1 port=%s dbname=%L user=%L password=%L',
    current_setting('port'),current_database(),current_user,
    :'issue_4637_dblink_password'
  )
);
SELECT extensions.dblink_send_query(
  'issue4637_terminal_lock',
  $$SELECT public.issue_4637_hold_terminal_receipt_lock(1.5)$$
);
SELECT pg_sleep(0.2);
SELECT extensions.dblink_send_query(
  'issue4637_replacement_waiter',
  $$SELECT public.issue_4637_replace_for_test(
    '46371000-0000-4000-8200-000000000101',
    '46371000-0000-4000-8000-000000000101',
    '46371000-0000-4000-8200-000000000102',
    '{"title":"After"}'::jsonb
  )$$
);
SELECT pg_sleep(0.3);
INSERT INTO public.agent_messages(
  id,conversation_id,user_id,role,content,created_at
) VALUES (
  '46371000-0000-4000-8300-000000000101',
  '46371000-0000-4000-8100-000000000101',
  '46371000-0000-4000-8000-000000000101',
  'user','{"text":"Actually, Regular tickets only"}'::jsonb,
  clock_timestamp()
);
SELECT * FROM extensions.dblink_get_result('issue4637_terminal_lock')
  AS lock_result(value integer);
SELECT * FROM extensions.dblink_get_result('issue4637_replacement_waiter')
  AS replacement_result(answer text);
SELECT extensions.dblink_disconnect('issue4637_terminal_lock');
SELECT extensions.dblink_disconnect('issue4637_replacement_waiter');

SELECT * FROM public.ari_supersede_pending_on_owner_turn(
  '46371000-0000-4000-8000-000000000101',
  '46371000-0000-4000-8100-000000000101',
  '46371000-0000-4000-8300-000000000101'
);

DO $assert$
DECLARE
  v_old uuid := '46371000-0000-4000-8200-000000000101';
  v_new uuid := '46371000-0000-4000-8200-000000000102';
  v_owner uuid := '46371000-0000-4000-8300-000000000101';
BEGIN
  IF (SELECT status FROM public.agent_pending_actions WHERE id=v_old)
       <> 'cancelled'
     OR (SELECT status FROM public.agent_pending_actions WHERE id=v_new)
       <> 'superseded'
     OR (SELECT failure_reason FROM public.agent_pending_actions WHERE id=v_new)
       <> 'OWNER_AMENDED'
     OR (SELECT owner_amended_message_id FROM public.agent_pending_actions
         WHERE id=v_new) <> v_owner
     OR (SELECT server_proposed_at FROM public.agent_pending_actions
         WHERE id=v_new) IS DISTINCT FROM
        (SELECT server_proposed_at FROM public.agent_pending_actions
         WHERE id=v_old)
     OR (SELECT created_at FROM public.agent_messages WHERE id=v_owner) <=
        (SELECT server_proposed_at FROM public.agent_pending_actions
         WHERE id=v_new) THEN
    RAISE EXCEPTION 'concurrent legacy amendment escaped replacement ancestry';
  END IF;
END;
$assert$;

DO $cleanup$
DECLARE
  v_user uuid := '46371000-0000-4000-8000-000000000101';
  v_chat uuid := '46371000-0000-4000-8100-000000000101';
  v_old uuid := '46371000-0000-4000-8200-000000000101';
  v_new uuid := '46371000-0000-4000-8200-000000000102';
BEGIN
  DELETE FROM public.agent_pending_action_terminal_receipts
  WHERE pending_action_id IN (v_old,v_new);
  DELETE FROM public.agent_messages WHERE conversation_id=v_chat;
  DELETE FROM public.agent_pending_actions WHERE id IN (v_old,v_new);
  DELETE FROM public.agent_conversations WHERE id=v_chat;
  DELETE FROM public.creator_accounts WHERE id=v_user;
  DELETE FROM auth.users WHERE id=v_user;
END;
$cleanup$;

DROP FUNCTION public.issue_4637_replace_for_test(uuid,uuid,uuid,jsonb);
DROP FUNCTION public.issue_4637_hold_terminal_receipt_lock(numeric);
