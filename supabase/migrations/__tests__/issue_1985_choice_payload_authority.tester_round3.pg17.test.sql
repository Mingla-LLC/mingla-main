-- Issue #1985 independent tester round 3: the persisted assistant choice
-- payload is server-authoritative input to applyStoredChoice(). An ordinary
-- authenticated owner must not be able to rewrite that payload after Ari has
-- bound its question/option IDs.

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-0000000019a1',
  'authenticated',
  'authenticated',
  'issue1985-choice-authority@example.invalid',
  now(),
  now()
);

INSERT INTO public.agent_conversations (id, user_id, title)
VALUES (
  '00000000-0000-4000-8000-0000000019a2',
  '00000000-0000-4000-8000-0000000019a1',
  'choice authority fixture'
);

INSERT INTO public.agent_messages (
  id,
  conversation_id,
  user_id,
  role,
  content,
  prompt_version,
  model_version
)
VALUES (
  '00000000-0000-4000-8000-0000000019a3',
  '00000000-0000-4000-8000-0000000019a2',
  '00000000-0000-4000-8000-0000000019a1',
  'assistant',
  '{"text":"Choose a title","structured":{"choices":{"schema_version":2,"question_id":"question-1","kind":"clarifying","prompt":"Choose a title","required_slot_keys":["title"],"options":[{"id":"title-1","label":"Original","payload":{"type":"slot_patch","slot_updates":{"title":"Original"}}}]}}}'::jsonb,
  'tenant-v1',
  'test-model'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-0000000019a1',
  true
);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    UPDATE public.agent_messages
    SET content = '{"text":"Choose a title","structured":{"choices":{"schema_version":2,"question_id":"question-1","kind":"clarifying","prompt":"Choose a title","required_slot_keys":["title"],"options":[{"id":"title-1","label":"Original","payload":{"type":"slot_patch","slot_updates":{"title":"FORGED BY CLIENT"}}}]}}}'::jsonb
    WHERE id = '00000000-0000-4000-8000-0000000019a3';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION
      'issue_1985_choice_payload_authority: authenticated assistant choice payload overwrite was accepted';
  END IF;
END;
$$;

ROLLBACK;
