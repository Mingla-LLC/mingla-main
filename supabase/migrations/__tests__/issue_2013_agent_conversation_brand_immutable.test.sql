\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id)
VALUES ('20130000-0000-4000-8000-000000000001');

INSERT INTO public.agent_conversations(id, user_id, brand_id, title)
VALUES (
  '20130000-0000-4000-8000-000000000010',
  '20130000-0000-4000-8000-000000000001',
  NULL,
  'Original title'
);

-- Ordinary mutable metadata stays editable.
UPDATE public.agent_conversations
SET title = 'Updated title'
WHERE id = '20130000-0000-4000-8000-000000000010';

DO $test$
BEGIN
  IF (SELECT title FROM public.agent_conversations
      WHERE id = '20130000-0000-4000-8000-000000000010') <> 'Updated title' THEN
    RAISE EXCEPTION 'T-2013-IMMUTABLE-01 non-scope update was blocked';
  END IF;

  BEGIN
    UPDATE public.agent_conversations
    SET brand_id = '20130000-0000-4000-8000-000000000099'
    WHERE id = '20130000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'T-2013-IMMUTABLE-02 brand scope rewrite was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'agent conversation brand scope is immutable' THEN
      RAISE EXCEPTION 'T-2013-IMMUTABLE-03 unsafe error contract: %', SQLERRM;
    END IF;
  END;

  IF (SELECT brand_id FROM public.agent_conversations
      WHERE id = '20130000-0000-4000-8000-000000000010') IS NOT NULL THEN
    RAISE EXCEPTION 'T-2013-IMMUTABLE-04 rejected rewrite changed stored scope';
  END IF;

  IF has_function_privilege('anon', 'public.preserve_agent_conversation_brand_scope()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.preserve_agent_conversation_brand_scope()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-2013-IMMUTABLE-05 trigger helper is directly executable';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'issue_2013_agent_conversation_brand_immutable: PASS' AS result;
