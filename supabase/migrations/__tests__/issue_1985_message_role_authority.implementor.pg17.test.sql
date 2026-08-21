-- Issue #1985 implementor happy path: authenticated callers retain the
-- legitimate untrusted user-message append lifecycle, while assistant/tool rows and
-- their persisted AgentChoicesV2 authority remain service-owned.

BEGIN;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-0000000019b1',
  'authenticated',
  'authenticated',
  'issue1985-message-owner@example.invalid',
  now(),
  now()
);

INSERT INTO public.agent_conversations (id, user_id, title)
VALUES (
  '00000000-0000-4000-8000-0000000019b2',
  '00000000-0000-4000-8000-0000000019b1',
  'message role authority fixture'
);

INSERT INTO public.agent_messages (
  id, conversation_id, user_id, role, content, prompt_version, model_version
) VALUES (
  '00000000-0000-4000-8000-0000000019b3',
  '00000000-0000-4000-8000-0000000019b2',
  '00000000-0000-4000-8000-0000000019b1',
  'assistant',
  '{"text":"Choose a title","structured":{"choices":{"schema_version":2,"question_id":"question-1","kind":"clarifying","prompt":"Choose a title","required_slot_keys":["title"],"options":[{"id":"title-1","label":"Original","payload":{"type":"slot_patch","slot_updates":{"title":"Original"}}}]}}}'::jsonb,
  'tenant-v1',
  'test-model'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-0000000019b1',
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO public.agent_messages (
  id, conversation_id, user_id, role, content, client_turn_id,
  prompt_version, model_version
) VALUES (
  '00000000-0000-4000-8000-0000000019b4',
  '00000000-0000-4000-8000-0000000019b2',
  '00000000-0000-4000-8000-0000000019b1',
  'user',
  '{"text":"first draft"}'::jsonb,
  '00000000-0000-4000-8000-0000000019b5',
  'tenant-v1',
  'test-model'
);

DO $$
DECLARE
  v_denied boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_messages
    WHERE id = '00000000-0000-4000-8000-0000000019b4'
      AND role = 'user'
      AND content = '{"text":"first draft"}'::jsonb
  ) THEN
    RAISE EXCEPTION
      'issue_1985_message_role_authority: legitimate user-message append failed';
  END IF;

  v_denied := false;
  BEGIN
    UPDATE public.agent_messages
    SET content = '{"text":"forged assistant"}'::jsonb
    WHERE id = '00000000-0000-4000-8000-0000000019b3';
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION
      'issue_1985_message_role_authority: authenticated assistant update was accepted';
  END IF;

  v_denied := false;
  BEGIN
    INSERT INTO public.agent_messages (
      conversation_id, user_id, role, content, prompt_version, model_version
    ) VALUES (
      '00000000-0000-4000-8000-0000000019b2',
      '00000000-0000-4000-8000-0000000019b1',
      'assistant',
      '{"text":"forged assistant insert"}'::jsonb,
      'tenant-v1',
      'test-model'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION
      'issue_1985_message_role_authority: authenticated assistant insert was accepted';
  END IF;

  v_denied := false;
  BEGIN
    DELETE FROM public.agent_messages
    WHERE id = '00000000-0000-4000-8000-0000000019b3';
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION
      'issue_1985_message_role_authority: authenticated assistant delete was accepted';
  END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE service_role;

UPDATE public.agent_messages
SET content = jsonb_set(content, '{text}', '"Service-owned choice"'::jsonb)
WHERE id = '00000000-0000-4000-8000-0000000019b3'
  AND user_id = '00000000-0000-4000-8000-0000000019b1'
  AND conversation_id = '00000000-0000-4000-8000-0000000019b2'
  AND role = 'assistant';

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_messages
    WHERE id = '00000000-0000-4000-8000-0000000019b3'
      AND content ->> 'text' = 'Service-owned choice'
      AND content #>> '{structured,choices,options,0,payload,slot_updates,title}' =
        'Original'
  ) THEN
    RAISE EXCEPTION
      'issue_1985_message_role_authority: service-owned assistant update lost canonical choice payload';
  END IF;

  IF (
    SELECT count(*)
    FROM public.agent_messages
    WHERE conversation_id = '00000000-0000-4000-8000-0000000019b2'
      AND role = 'assistant'
  ) <> 1 THEN
    RAISE EXCEPTION
      'issue_1985_message_role_authority: assistant authority was not exactly one row';
  END IF;
END;
$$;

ROLLBACK;
