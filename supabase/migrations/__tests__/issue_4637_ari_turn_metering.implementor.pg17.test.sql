-- MINGLA-INVARIANT: I-ARI-ACTIVITY-SEQUENCE-ORDER | issue #4637 | Activity created_at is non-decreasing in sequence order and assistant message time is assigned by the database wall clock, never an early caller timestamp.
-- MINGLA-INVARIANT: I-ARI-TURN-ATTEMPT-HISTORY | issue #4637 | Every terminal attempt number is retained append-only even when the mutable attempt row is reused by a retry.
\set ON_ERROR_STOP on
\getenv issue_4637_dblink_password PGPASSWORD
BEGIN;

DO $test$
DECLARE
  v_user uuid := '46370000-0000-4000-8000-000000000001';
  v_brand uuid := '46370000-0000-4000-8100-000000000001';
  v_chat uuid := '46370000-0000-4000-8200-000000000001';
  v_user_message uuid := '46370000-0000-4000-8300-000000000001';
  v_assistant_message uuid := '46370000-0000-4000-8400-000000000001';
  v_task_message uuid := '46370000-0000-4000-8400-000000000002';
  v_attempt uuid := '46370000-0000-4000-8500-000000000001';
  v_client_turn uuid := '46370000-0000-4000-8600-000000000001';
  v_pending uuid := '46370000-0000-4000-8700-000000000001';
  v_chained_pending uuid := '46370000-0000-4000-8700-000000000002';
  v_newer_client_turn uuid := '46370000-0000-4000-8600-000000000002';
  v_newer_user_message uuid := '46370000-0000-4000-8300-000000000002';
  v_newer_assistant_message uuid := '46370000-0000-4000-8400-000000000003';
  v_committed boolean;
  v_old timestamptz := '2000-01-01T00:00:00Z';
BEGIN
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ari_training_turns'
      AND column_name = ANY(ARRAY[
        'cached_input_tokens', 'thinking_tokens', 'model_calls', 'route_tier',
        'stream_mode', 'runtime_keys', 'phase_ms', 'first_progress_ms',
        'first_text_ms', 'complete_ms', 'pricing_version', 'attempt_status',
        'answer_ready_ms', 'first_word_shown_ms', 'pace_tier', 'held_ms'
      ])
  ) <> 16 THEN
    RAISE EXCEPTION 'M1 metering columns are missing';
  END IF;
  IF NOT public.ari_phase_ms_is_valid('{"intent":12,"commit":0}'::jsonb)
     OR public.ari_phase_ms_is_valid('{"intent":-1}'::jsonb)
     OR public.ari_phase_ms_is_valid('{"intent":1.5}'::jsonb)
     OR public.ari_phase_ms_is_valid('{"intent":"12"}'::jsonb)
     OR public.ari_phase_ms_is_valid('{"intent":{"nested":12}}'::jsonb) THEN
    RAISE EXCEPTION 'phase_ms accepts a value other than non-negative integers';
  END IF;
  IF has_table_privilege('authenticated', 'public.agent_turn_attempt_history', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.agent_turn_attempt_history', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.agent_turn_attempt_history', 'INSERT')
     OR has_table_privilege('service_role', 'public.agent_turn_attempt_history', 'UPDATE')
     OR has_table_privilege('service_role', 'public.agent_turn_attempt_history', 'DELETE') THEN
    RAISE EXCEPTION 'attempt history grants are not service-role-only';
  END IF;
  IF has_table_privilege('authenticated', 'public.ari_pending_action_metering_ledger', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.ari_pending_action_metering_ledger', 'SELECT')
     OR has_function_privilege(
       'authenticated',
       'public.add_ari_pending_action_turn_metering(uuid,uuid,integer,integer,integer,integer,smallint,jsonb,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.add_ari_pending_action_turn_metering(uuid,uuid,integer,integer,integer,integer,smallint,jsonb,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'pending-action metering authority is not service-role-only';
  END IF;

  INSERT INTO auth.users(id,email)
  VALUES (v_user,'issue4637-meter@example.test');
  INSERT INTO public.creator_accounts(id,email)
  VALUES (v_user,'issue4637-meter@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider,payment_country,
    pricing_region,pricing_currency
  ) VALUES (
    v_brand,v_user,'Issue 4637 meter','issue-4637-meter','USD','stripe','US','US','USD'
  );
  INSERT INTO public.agent_conversations(id,user_id,brand_id,title)
  VALUES (v_chat,v_user,v_brand,'Metering fixture');
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,client_turn_id,
    prompt_version,model_version
  ) VALUES (
    v_user_message,v_chat,v_user,'user','{"text":"hello"}'::jsonb,
    v_client_turn,'tenant-v1','fixture'
  );
  INSERT INTO public.agent_turn_attempts(
    id,user_id,brand_id,conversation_id,user_message_id,client_turn_id,
    request_digest,manifest_digest,attempt_number,status,origin,
    accepted_at,started_at,updated_at
  ) VALUES (
    v_attempt,v_user,v_brand,v_chat,v_user_message,v_client_turn,
    repeat('a',64),repeat('b',64),1,'running','owner',
    clock_timestamp(),clock_timestamp(),clock_timestamp()
  );

  UPDATE public.agent_turn_attempts
  SET status='failed',error_code='FIXTURE_FIRST_FAILED',
      terminal_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=v_attempt;
  IF (SELECT count(*) FROM public.agent_turn_attempt_history
      WHERE attempt_id=v_attempt AND attempt_number=1 AND status='failed'
        AND error_code='FIXTURE_FIRST_FAILED') <> 1 THEN
    RAISE EXCEPTION 'failed attempt 1 was not recorded';
  END IF;

  UPDATE public.agent_turn_attempts
  SET attempt_number=2,status='accepted',error_code=NULL,
      accepted_at=clock_timestamp(),started_at=NULL,terminal_at=NULL,
      updated_at=clock_timestamp()
  WHERE id=v_attempt;
  UPDATE public.agent_turn_attempts
  SET status='running',started_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=v_attempt;
  PERFORM public.append_agent_activity_event(
    v_attempt,v_user,2,'finalizing_started',v_old,NULL
  );

  v_committed := public.commit_agent_chat_assistant_turn(
    v_attempt,2,v_user,v_chat,0,
    '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
    '[task-v1] Fixture completed.',v_assistant_message,
    '{"text":"Hello."}'::jsonb,
    jsonb_build_object('pending_action_id',v_pending),v_client_turn,
    'tenant-v1','fixture',v_old
  );
  IF NOT v_committed THEN
    RAISE EXCEPTION 'chat commit fixture did not commit';
  END IF;
  IF (SELECT created_at FROM public.agent_messages WHERE id=v_assistant_message) <= v_old THEN
    RAISE EXCEPTION 'assistant message trusted the caller timestamp';
  END IF;

  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,origin_client_turn_id,tool_name,tool_args,
    status,source,server_proposed_at
  ) VALUES (
    v_pending,v_user,v_chat,v_client_turn,'update_brand','{}'::jsonb,
    'executed','ari',clock_timestamp()
  );
  INSERT INTO public.ari_training_turns(
    archive_conversation_key,source_user_id,source_conversation_id,
    source_user_message_id,source_assistant_message_id,sanitized_user_text,
    sanitized_assistant_text,prompt_version,model_version,input_tokens,
    output_tokens,cached_input_tokens,thinking_tokens,model_calls,
    estimated_cost_micros,phase_ms,pricing_version,attempt_status
  ) VALUES (
    v_chat,v_user,v_chat,v_user_message,v_assistant_message,'hello','Hello.',
    'ari-system-fixture','fixture',10,20,3,4,2,98,
    '{"followup_call":5,"tools":6,"claim_check":0}'::jsonb,
    'gemini-3.6-flash-2026-09-01','completed'
  );
  IF NOT public.add_ari_pending_action_turn_metering(
    v_pending,v_user,100,30,7,5,2::smallint,
    '{"followup_call":11,"tools":13,"claim_check":17}'::jsonb,
    'gemini-3.6-flash-2026-09-01'
  ) THEN
    RAISE EXCEPTION 'post-approval metering delta was not applied';
  END IF;
  IF public.add_ari_pending_action_turn_metering(
    v_pending,v_user,100,30,7,5,2::smallint,
    '{"followup_call":11,"tools":13,"claim_check":17}'::jsonb,
    'gemini-3.6-flash-2026-09-01'
  ) THEN
    RAISE EXCEPTION 'post-approval metering replay was applied twice';
  END IF;
  IF (
    SELECT NOT (
      input_tokens = 110 AND output_tokens = 50
      AND cached_input_tokens = 10 AND thinking_tokens = 9
      AND model_calls = 4
      -- ceil((110 * .75) + ((50 + 9) * 3.75)) = 304
      AND estimated_cost_micros = 304
      AND phase_ms->>'followup_call' = '16'
      AND phase_ms->>'tools' = '19'
      AND phase_ms->>'claim_check' = '17'
    )
    FROM public.ari_training_turns
    WHERE source_assistant_message_id = v_assistant_message
  ) OR (SELECT count(*) FROM public.ari_pending_action_metering_ledger
        WHERE pending_action_id=v_pending) <> 1 THEN
    RAISE EXCEPTION 'post-approval usage was not aggregated exactly once';
  END IF;

  -- A later owner turn must not steal usage from a chained proposal whose
  -- assistant row has no client_turn_id. The pending lineage remains exact.
  INSERT INTO public.agent_messages(
    id,conversation_id,user_id,role,content,client_turn_id,
    prompt_version,model_version
  ) VALUES
    (v_newer_user_message,v_chat,v_user,'user','{"text":"newer"}'::jsonb,
     v_newer_client_turn,'tenant-v1','fixture'),
    (v_newer_assistant_message,v_chat,v_user,'assistant',
     '{"text":"Newer answer."}'::jsonb,v_newer_client_turn,
     'tenant-v1','fixture');
  INSERT INTO public.ari_training_turns(
    archive_conversation_key,source_user_id,source_conversation_id,
    source_user_message_id,source_assistant_message_id,sanitized_user_text,
    sanitized_assistant_text,prompt_version,model_version,input_tokens,
    output_tokens,cached_input_tokens,thinking_tokens,model_calls,
    estimated_cost_micros,phase_ms,pricing_version,attempt_status
  ) VALUES (
    v_chat,v_user,v_chat,v_newer_user_message,v_newer_assistant_message,
    'newer','Newer answer.','ari-system-fixture','fixture',900,90,0,0,1,
    1013,'{}'::jsonb,'gemini-3.6-flash-2026-09-01','completed'
  );
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,origin_client_turn_id,tool_name,tool_args,
    status,source,server_proposed_at
  ) VALUES (
    v_chained_pending,v_user,v_chat,v_client_turn,'update_brand','{}'::jsonb,
    'executed','ari',clock_timestamp()
  );
  INSERT INTO public.agent_messages(
    conversation_id,user_id,role,content,tool_calls,prompt_version,model_version
  ) VALUES (
    v_chat,v_user,'assistant','{"text":"Review this change. Confirm to save it."}'::jsonb,
    jsonb_build_object('pending_action_id',v_chained_pending),
    'tenant-v1','fixture'
  );
  IF NOT public.add_ari_pending_action_turn_metering(
    v_chained_pending,v_user,1,1,1,1,1::smallint,
    '{"followup_call":2,"tools":3,"claim_check":4}'::jsonb,
    'gemini-3.6-flash-2026-09-01'
  ) THEN
    RAISE EXCEPTION 'chained post-approval metering delta was not applied';
  END IF;
  IF (SELECT input_tokens FROM public.ari_training_turns
      WHERE source_assistant_message_id=v_assistant_message) <> 111
     OR (SELECT model_calls FROM public.ari_training_turns
         WHERE source_assistant_message_id=v_assistant_message) <> 5
     OR (SELECT input_tokens FROM public.ari_training_turns
         WHERE source_assistant_message_id=v_newer_assistant_message) <> 900 THEN
    RAISE EXCEPTION 'chained proposal metering lost exact owner-turn lineage';
  END IF;

  v_committed := public.commit_agent_task_assistant_turn(
    v_user,v_chat,1,
    '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
    '[task-v1] Fixture completed.','46370000-0000-4000-8400-000000000002',
    '{"text":"Task helper."}'::jsonb,'{}'::jsonb,NULL,
    'tenant-v1','fixture',v_old
  );
  IF NOT v_committed OR
     (SELECT created_at FROM public.agent_messages WHERE id=v_task_message) <= v_old THEN
    RAISE EXCEPTION 'task assistant commit trusted the caller timestamp';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT created_at, lag(created_at) OVER (ORDER BY sequence) AS prior
      FROM public.agent_activity_events
      WHERE attempt_id=v_attempt AND attempt_number=2
    ) ordered
    WHERE prior IS NOT NULL AND created_at < prior
  ) THEN
    RAISE EXCEPTION 'activity timestamps decreased in sequence order';
  END IF;

  IF (SELECT count(*) FROM public.agent_turn_attempt_history
      WHERE attempt_id=v_attempt AND attempt_number=2 AND status='completed') <> 1 THEN
    RAISE EXCEPTION 'completed attempt 2 was not recorded';
  END IF;
  IF (SELECT count(*) FROM public.agent_turn_attempt_history
      WHERE attempt_id=v_attempt) <> 2 THEN
    RAISE EXCEPTION 'retry overwrote terminal history';
  END IF;
END;
$test$;

ROLLBACK;

-- A blocked appender must read clock_timestamp() after the attempt-row lock.
-- This proof uses two real database sessions so the old pre-lock assignment
-- deterministically produces sequence 2 with an earlier timestamp.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DROP FUNCTION IF EXISTS public.issue_4637_hold_activity_lock(
  uuid, uuid, integer
);
CREATE FUNCTION public.issue_4637_hold_activity_lock(
  p_attempt_id uuid,
  p_user_id uuid,
  p_attempt_number integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event public.agent_activity_events%ROWTYPE;
BEGIN
  v_event := public.append_agent_activity_event(
    p_attempt_id, p_user_id, p_attempt_number, 'finalizing_started', now(), NULL
  );
  PERFORM pg_sleep(1.5);
  RETURN v_event.sequence;
END;
$function$;

DO $cleanup$
DECLARE
  v_user uuid := '46370000-0000-4000-8000-000000000101';
  v_brand uuid := '46370000-0000-4000-8100-000000000101';
  v_chat uuid := '46370000-0000-4000-8200-000000000101';
  v_user_message uuid := '46370000-0000-4000-8300-000000000101';
  v_attempt uuid := '46370000-0000-4000-8500-000000000101';
BEGIN
  DELETE FROM public.agent_activity_events WHERE attempt_id=v_attempt;
  DELETE FROM public.agent_turn_attempt_history WHERE attempt_id=v_attempt;
  DELETE FROM public.agent_turn_attempts WHERE id=v_attempt;
  DELETE FROM public.agent_messages WHERE conversation_id=v_chat;
  DELETE FROM public.agent_conversations WHERE id=v_chat;
  DELETE FROM public.brands WHERE id=v_brand;
  DELETE FROM public.creator_accounts WHERE id=v_user;
  DELETE FROM auth.users WHERE id=v_user;
END;
$cleanup$;

INSERT INTO auth.users(id,email)
VALUES ('46370000-0000-4000-8000-000000000101','issue4637-race@example.test');
INSERT INTO public.creator_accounts(id,email)
VALUES ('46370000-0000-4000-8000-000000000101','issue4637-race@example.test');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payment_provider,payment_country,
  pricing_region,pricing_currency
) VALUES (
  '46370000-0000-4000-8100-000000000101',
  '46370000-0000-4000-8000-000000000101',
  'Issue 4637 race','issue-4637-race','USD','stripe','US','US','USD'
);
INSERT INTO public.agent_conversations(id,user_id,brand_id,title)
VALUES (
  '46370000-0000-4000-8200-000000000101',
  '46370000-0000-4000-8000-000000000101',
  '46370000-0000-4000-8100-000000000101','Race fixture'
);
INSERT INTO public.agent_messages(
  id,conversation_id,user_id,role,content,client_turn_id,
  prompt_version,model_version
) VALUES (
  '46370000-0000-4000-8300-000000000101',
  '46370000-0000-4000-8200-000000000101',
  '46370000-0000-4000-8000-000000000101','user','{"text":"race"}'::jsonb,
  '46370000-0000-4000-8600-000000000101','tenant-v1','fixture'
);
INSERT INTO public.agent_turn_attempts(
  id,user_id,brand_id,conversation_id,user_message_id,client_turn_id,
  request_digest,manifest_digest,attempt_number,status,origin,
  accepted_at,started_at,updated_at
) VALUES (
  '46370000-0000-4000-8500-000000000101',
  '46370000-0000-4000-8000-000000000101',
  '46370000-0000-4000-8100-000000000101',
  '46370000-0000-4000-8200-000000000101',
  '46370000-0000-4000-8300-000000000101',
  '46370000-0000-4000-8600-000000000101',
  repeat('c',64),repeat('d',64),1,'running','owner',
  clock_timestamp(),clock_timestamp(),clock_timestamp()
);

SELECT extensions.dblink_connect(
  'issue4637_lock_owner',
  format(
    'host=127.0.0.1 port=%s dbname=%L user=%L password=%L',
    current_setting('port'), current_database(), current_user,
    :'issue_4637_dblink_password'
  )
);
SELECT extensions.dblink_connect(
  'issue4637_lock_waiter',
  format(
    'host=127.0.0.1 port=%s dbname=%L user=%L password=%L',
    current_setting('port'), current_database(), current_user,
    :'issue_4637_dblink_password'
  )
);
SELECT extensions.dblink_send_query(
  'issue4637_lock_owner',
  $$SELECT public.issue_4637_hold_activity_lock(
    '46370000-0000-4000-8500-000000000101',
    '46370000-0000-4000-8000-000000000101',1
  )$$
);
SELECT pg_sleep(0.3);
SELECT extensions.dblink_send_query(
  'issue4637_lock_waiter',
  $$SELECT (public.append_agent_activity_event(
    '46370000-0000-4000-8500-000000000101',
    '46370000-0000-4000-8000-000000000101',1,
    'response_ready',now(),NULL
  )).sequence$$
);
SELECT * FROM extensions.dblink_get_result('issue4637_lock_owner')
  AS owner_result(sequence integer);
SELECT * FROM extensions.dblink_get_result('issue4637_lock_waiter')
  AS waiter_result(sequence integer);
SELECT extensions.dblink_disconnect('issue4637_lock_owner');
SELECT extensions.dblink_disconnect('issue4637_lock_waiter');

DO $assert$
DECLARE
  v_attempt uuid := '46370000-0000-4000-8500-000000000101';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT created_at, lag(created_at) OVER (ORDER BY sequence) AS prior
      FROM public.agent_activity_events
      WHERE attempt_id=v_attempt AND attempt_number=1
    ) ordered
    WHERE prior IS NOT NULL AND created_at < prior
  ) THEN
    RAISE EXCEPTION 'blocked appender captured its timestamp before the sequence lock';
  END IF;
END;
$assert$;

DO $cleanup$
DECLARE
  v_user uuid := '46370000-0000-4000-8000-000000000101';
  v_brand uuid := '46370000-0000-4000-8100-000000000101';
  v_chat uuid := '46370000-0000-4000-8200-000000000101';
  v_attempt uuid := '46370000-0000-4000-8500-000000000101';
BEGIN
  DELETE FROM public.agent_activity_events WHERE attempt_id=v_attempt;
  DELETE FROM public.agent_turn_attempt_history WHERE attempt_id=v_attempt;
  DELETE FROM public.agent_turn_attempts WHERE id=v_attempt;
  DELETE FROM public.agent_messages WHERE conversation_id=v_chat;
  DELETE FROM public.agent_conversations WHERE id=v_chat;
  DELETE FROM public.brands WHERE id=v_brand;
  DELETE FROM public.creator_accounts WHERE id=v_user;
  DELETE FROM auth.users WHERE id=v_user;
END;
$cleanup$;

DROP FUNCTION public.issue_4637_hold_activity_lock(uuid, uuid, integer);
