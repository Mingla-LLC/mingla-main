-- Issue #2013 — a conversation's tenant scope is write-once.
--
-- Authenticated users own their conversation rows and may update titles and
-- summaries under RLS. That must never let a client relabel existing message
-- history from one accessible brand to another. The Edge Function validates
-- the selected brand, while this trigger closes the direct PostgREST path.

BEGIN;

CREATE OR REPLACE FUNCTION public.preserve_agent_conversation_brand_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'agent conversation brand scope is immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_agent_conversation_brand_scope()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS agent_conversations_brand_scope_immutable
  ON public.agent_conversations;
CREATE TRIGGER agent_conversations_brand_scope_immutable
BEFORE UPDATE OF brand_id ON public.agent_conversations
FOR EACH ROW
EXECUTE FUNCTION public.preserve_agent_conversation_brand_scope();

COMMENT ON FUNCTION public.preserve_agent_conversation_brand_scope() IS
  'Issue #2013: rejects every post-insert agent_conversations.brand_id change so prior chat history cannot be relabelled into another brand tenant.';

COMMIT;
