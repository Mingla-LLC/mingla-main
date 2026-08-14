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
  ON public.agent_messages (conversation_id, client_turn_id)
  WHERE role = 'user' AND client_turn_id IS NOT NULL;

COMMENT ON COLUMN public.agent_conversations.task_state IS
  'Issue #1985: private server-validated TaskStateV1; authoritative for Ari goals, slots, questions, interruptions, and confirmation reconciliation.';
COMMENT ON COLUMN public.agent_conversations.task_state_revision IS
  'Issue #1985: optimistic-concurrency revision. Every terminal turn advances exactly once through a compare-and-set update.';
COMMENT ON COLUMN public.agent_conversations.task_state_updated_at IS
  'Issue #1985: server timestamp of the latest successful task-state transition.';
COMMENT ON COLUMN public.agent_messages.client_turn_id IS
  'Issue #1985: caller-generated UUID reused across retry; unique for user turns inside one conversation.';

COMMIT;
