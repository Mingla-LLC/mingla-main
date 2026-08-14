-- Issue #1985 — durable, versioned Ari task state and idempotent client turns.
--
-- Task state is private conversation data protected by the existing owner RLS
-- policies. This migration is additive: legacy summaries/messages remain
-- intact and existing conversations start from an explicit idle state.

BEGIN;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS task_state jsonb NOT NULL DEFAULT
    '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
  ADD COLUMN IF NOT EXISTS task_state_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_state_updated_at timestamptz;

ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_task_state_revision_nonnegative;
ALTER TABLE public.agent_conversations
  ADD CONSTRAINT agent_conversations_task_state_revision_nonnegative
  CHECK (task_state_revision >= 0);

ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_task_state_v1_object;
ALTER TABLE public.agent_conversations
  ADD CONSTRAINT agent_conversations_task_state_v1_object
  CHECK (
    jsonb_typeof(task_state) = 'object'
    AND task_state ->> 'schema_version' = '1'
  );

UPDATE public.agent_conversations
SET task_state =
      '{"schema_version":1,"status":"idle","active_task":null,"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
    task_state_revision = 0,
    task_state_updated_at = NULL
WHERE task_state IS NULL
   OR jsonb_typeof(task_state) IS DISTINCT FROM 'object'
   OR task_state ->> 'schema_version' IS DISTINCT FROM '1';

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS client_turn_id uuid;

CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation_client_turn
  ON public.agent_messages (conversation_id, client_turn_id)
  WHERE client_turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_messages_user_client_turn
  ON public.agent_messages (user_id, client_turn_id)
  WHERE role = 'user' AND client_turn_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_messages_user_client_turn
  ON public.agent_messages (user_id, client_turn_id)
  WHERE role = 'user' AND client_turn_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_messages_assistant_client_turn
  ON public.agent_messages (conversation_id, client_turn_id)
  WHERE role = 'assistant' AND client_turn_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_agent_first_turn(
  p_brand_id uuid,
  p_client_turn_id uuid,
  p_content jsonb,
  p_prompt_version text,
  p_model_version text
)
RETURNS TABLE(conversation_id uuid, message_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_message_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_client_turn_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'client_turn_id required';
  END IF;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.brands brand
    WHERE brand.id = p_brand_id
      AND brand.deleted_at IS NULL
      AND (
        brand.account_id = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.brand_team_members member
          WHERE member.brand_id = brand.id
            AND member.user_id = v_user_id
            AND member.accepted_at IS NOT NULL
            AND member.removed_at IS NULL
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'brand access denied';
  END IF;

  BEGIN
    INSERT INTO public.agent_conversations(user_id, brand_id, title)
    VALUES (v_user_id, p_brand_id, NULL)
    RETURNING id INTO v_conversation_id;

    INSERT INTO public.agent_messages(
      conversation_id, user_id, role, content, client_turn_id,
      prompt_version, model_version
    )
    VALUES (
      v_conversation_id, v_user_id, 'user', p_content, p_client_turn_id,
      p_prompt_version, p_model_version
    )
    RETURNING id INTO v_message_id;

    RETURN QUERY SELECT v_conversation_id, v_message_id, true;
    RETURN;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  SELECT message.conversation_id, message.id
  INTO v_conversation_id, v_message_id
  FROM public.agent_messages message
  WHERE message.user_id = v_user_id
    AND message.role = 'user'
    AND message.client_turn_id = p_client_turn_id
  LIMIT 1;

  IF v_conversation_id IS NULL OR v_message_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'first turn claim conflicted';
  END IF;
  RETURN QUERY SELECT v_conversation_id, v_message_id, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_agent_first_turn(uuid, uuid, jsonb, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_agent_first_turn(uuid, uuid, jsonb, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.commit_agent_task_assistant_turn(
  p_conversation_id uuid,
  p_expected_revision bigint,
  p_task_state jsonb,
  p_summary text,
  p_assistant_message_id uuid,
  p_content jsonb,
  p_tool_calls jsonb,
  p_client_turn_id uuid,
  p_prompt_version text,
  p_model_version text,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  UPDATE public.agent_conversations
  SET task_state = p_task_state,
      task_state_revision = p_expected_revision + 1,
      task_state_updated_at = p_now,
      updated_at = p_now,
      summary = p_summary,
      summary_through_message_id = p_assistant_message_id,
      summary_updated_at = p_now
  WHERE id = p_conversation_id
    AND user_id = v_user_id
    AND task_state_revision = p_expected_revision;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.agent_messages(
    id, conversation_id, user_id, role, content, tool_calls,
    client_turn_id, prompt_version, model_version
  )
  VALUES (
    p_assistant_message_id, p_conversation_id, v_user_id, 'assistant',
    p_content, p_tool_calls, p_client_turn_id, p_prompt_version, p_model_version
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_agent_task_assistant_turn(
  uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, text, text, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_agent_task_assistant_turn(
  uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, text, text, timestamptz
) TO authenticated;

COMMENT ON COLUMN public.agent_conversations.task_state IS
  'Issue #1985: private server-validated TaskStateV1; authoritative for Ari goals, slots, questions, interruptions, and confirmation reconciliation.';
COMMENT ON COLUMN public.agent_conversations.task_state_revision IS
  'Issue #1985: optimistic-concurrency revision. Every terminal turn advances exactly once through a compare-and-set update.';
COMMENT ON COLUMN public.agent_conversations.task_state_updated_at IS
  'Issue #1985: server timestamp of the latest successful task-state transition.';
COMMENT ON COLUMN public.agent_messages.client_turn_id IS
  'Issue #1985: caller-generated UUID reused across retry; globally unique per user turn and unique per assistant terminal response.';

COMMENT ON FUNCTION public.claim_agent_first_turn(uuid, uuid, jsonb, text, text) IS
  'Issue #1985: atomically creates or recovers the caller-owned first conversation/user turn, serializing same client_turn_id retries across conversations.';
COMMENT ON FUNCTION public.commit_agent_task_assistant_turn(
  uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, text, text, timestamptz
) IS
  'Issue #1985: atomically commits task-state CAS, cumulative summary, and the matching assistant terminal row so state never references a missing response.';

COMMIT;
