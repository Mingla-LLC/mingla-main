-- Issue #1985 tester adversarial proof: task state is server-owned.
-- An authenticated PostgREST caller must not be able to bypass the reducer/CAS
-- boundary by updating authoritative state columns directly.

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000001985',
  'authenticated',
  'authenticated',
  'issue1985-authority@example.invalid',
  now(),
  now()
);

INSERT INTO public.agent_conversations (id, user_id, title)
VALUES (
  '00000000-0000-4000-8000-000000001986',
  '00000000-0000-4000-8000-000000001985',
  'authority fixture'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000001985',
  true
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    UPDATE public.agent_conversations
    SET task_state = '{"schema_version":1,"status":"gathering","active_task":{"task_id":"forged-task","intent":"create_event","brand_id":"forged-brand","stage":"gathering","origin_message_id":"forged-message","slots":{},"brief":{"concepts":[],"food":[],"music":[],"experience":[],"notes":[]}},"interruption_stack":[],"pending_question":null,"last_completed_step":null}'::jsonb,
        task_state_revision = 999
    WHERE id = '00000000-0000-4000-8000-000000001986';

    RAISE EXCEPTION
      'issue_1985_task_state_authority: authenticated direct task-state overwrite was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
END;
$$;

ROLLBACK;
