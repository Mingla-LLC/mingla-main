-- Issue #1985 implementor happy path: normal owner metadata edits remain
-- available while every authoritative task-state transition is service-owned,
-- explicitly user-scoped, and revision-CAS protected.

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  (
    '00000000-0000-4000-8000-000000001981',
    'authenticated',
    'authenticated',
    'issue1985-happy-owner@example.invalid',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001982',
    'authenticated',
    'authenticated',
    'issue1985-happy-other@example.invalid',
    now(),
    now()
  );

INSERT INTO public.agent_conversations (id, user_id, title)
VALUES (
  '00000000-0000-4000-8000-000000001983',
  '00000000-0000-4000-8000-000000001981',
  'before metadata edit'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000001981',
  true
);
SET LOCAL ROLE authenticated;

UPDATE public.agent_conversations
SET title = 'after metadata edit',
    summary = 'owner-visible context remains editable'
WHERE id = '00000000-0000-4000-8000-000000001983';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_conversations
    WHERE id = '00000000-0000-4000-8000-000000001983'
      AND title = 'after metadata edit'
      AND summary = 'owner-visible context remains editable'
  ) THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: legitimate owner metadata update failed';
  END IF;

  BEGIN
    PERFORM public.commit_agent_task_assistant_turn(
      '00000000-0000-4000-8000-000000001981'::uuid,
      '00000000-0000-4000-8000-000000001983'::uuid,
      0,
      '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
      'forged authenticated state transition',
      '00000000-0000-4000-8000-000000001984'::uuid,
      '{"text":"forged"}'::jsonb,
      NULL,
      '00000000-0000-4000-8000-000000001985'::uuid,
      'tenant-v1',
      'test-model',
      now()
    );
    RAISE EXCEPTION
      'issue_1985_task_state_authority: authenticated state RPC execution was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public.get_agent_pending_terminal_message_id(
      '00000000-0000-4000-8000-000000001981'::uuid,
      '00000000-0000-4000-8000-000000001983'::uuid,
      '00000000-0000-4000-8000-000000001988'::uuid,
      'cancelled'
    );
    RAISE EXCEPTION
      'issue_1985_task_state_authority: authenticated terminal lookup execution was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_committed boolean;
BEGIN
  SELECT public.commit_agent_task_assistant_turn(
    '00000000-0000-4000-8000-000000001981'::uuid,
    '00000000-0000-4000-8000-000000001983'::uuid,
    0,
    '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
    'service-owned assistant CAS',
    '00000000-0000-4000-8000-000000001984'::uuid,
    '{"text":"committed once"}'::jsonb,
    NULL,
    '00000000-0000-4000-8000-000000001985'::uuid,
    'tenant-v1',
    'test-model',
    now()
  ) INTO v_committed;
  IF v_committed IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: service assistant CAS did not commit';
  END IF;

  SELECT public.commit_agent_task_assistant_turn(
    '00000000-0000-4000-8000-000000001982'::uuid,
    '00000000-0000-4000-8000-000000001983'::uuid,
    1,
    '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
    'wrong owner',
    '00000000-0000-4000-8000-000000001986'::uuid,
    '{"text":"must not commit"}'::jsonb,
    NULL,
    '00000000-0000-4000-8000-000000001987'::uuid,
    'tenant-v1',
    'test-model',
    now()
  ) INTO v_committed;
  IF v_committed IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: mismatched service user scope committed';
  END IF;

  SELECT public.commit_agent_task_outcome(
    '00000000-0000-4000-8000-000000001981'::uuid,
    '00000000-0000-4000-8000-000000001983'::uuid,
    1,
    '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
    'service-owned confirmation CAS',
    NULL,
    now()
  ) INTO v_committed;
  IF v_committed IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: service outcome CAS did not commit';
  END IF;

  SELECT public.commit_agent_task_outcome(
    '00000000-0000-4000-8000-000000001981'::uuid,
    '00000000-0000-4000-8000-000000001983'::uuid,
    1,
    '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
    'stale revision',
    NULL,
    now()
  ) INTO v_committed;
  IF v_committed IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: stale service outcome CAS committed';
  END IF;

  INSERT INTO public.agent_messages(
    id, conversation_id, user_id, role, content, tool_results,
    prompt_version, model_version
  ) VALUES (
    '00000000-0000-4000-8000-000000001989'::uuid,
    '00000000-0000-4000-8000-000000001983'::uuid,
    '00000000-0000-4000-8000-000000001981'::uuid,
    'tool',
    '{"text":""}'::jsonb,
    '{"pending_action_id":"00000000-0000-4000-8000-000000001988","outcome":"cancelled"}'::jsonb,
    'tenant-v1',
    'test-model'
  );

  IF public.get_agent_pending_terminal_message_id(
    '00000000-0000-4000-8000-000000001981'::uuid,
    '00000000-0000-4000-8000-000000001983'::uuid,
    '00000000-0000-4000-8000-000000001988'::uuid,
    'cancelled'
  ) IS DISTINCT FROM '00000000-0000-4000-8000-000000001989'::uuid THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: canonical terminal message was not found';
  END IF;

  IF public.get_agent_pending_terminal_message_id(
    '00000000-0000-4000-8000-000000001982'::uuid,
    '00000000-0000-4000-8000-000000001983'::uuid,
    '00000000-0000-4000-8000-000000001988'::uuid,
    'cancelled'
  ) IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: terminal message lookup escaped user scope';
  END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_conversations
    WHERE id = '00000000-0000-4000-8000-000000001983'
      AND user_id = '00000000-0000-4000-8000-000000001981'
      AND task_state_revision = 2
      AND summary = 'service-owned confirmation CAS'
  ) THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: final owner-scoped revision is incorrect';
  END IF;
  IF (
    SELECT count(*)
    FROM public.agent_messages
    WHERE conversation_id = '00000000-0000-4000-8000-000000001983'
      AND role = 'assistant'
  ) <> 1 THEN
    RAISE EXCEPTION
      'issue_1985_task_state_authority: assistant terminal row was not exactly once';
  END IF;
END;
$$;

ROLLBACK;
