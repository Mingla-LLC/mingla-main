-- #4435 M-B: any human message (the sender's included) brings a removed chat back;
-- a per-user Clear chat cutoff. Peers are never affected.
--
-- Invariants (declared in supabase/migrations/__tests__/issue_4435_chat_reopen_and_clear.implementor.pg17.test.sql):
--   I-4435-REOPEN-EITHER-SENDER, I-4435-CLEAR-IS-PRIVATE.
-- Adversarial twin: issue_4435_chat_reopen_and_clear.tester.adversarial.pg17.test.sql.
--
-- Why a new cleared_at and not history_visible_from: that column is the
-- join-time cutoff owned by tg_4261_set_history_visible_from (frozen on UPDATE,
-- NULL for direct chats). conversation_participant_lifecycle is already the
-- private, per-user, owner-read-only, RPC-written "my view of this chat" row.

ALTER TABLE public.conversation_participant_lifecycle ADD COLUMN IF NOT EXISTS cleared_at timestamptz NULL;
COMMENT ON COLUMN public.conversation_participant_lifecycle.cleared_at IS
  '#4435 per-user clear-chat cutoff: messages created at or before it are hidden from this user only. Set by set_conversation_lifecycle(clear); never cleared by messages.';
COMMENT ON COLUMN public.conversation_participant_lifecycle.hidden_at IS
  '#4435 per-user remove-chat state. Any new human message in the chat, the user''s own included, clears it.';

-- B1. set_conversation_lifecycle (copy of 20270228001719) gains the clear action
-- and returns clearedAt. Old apps never send 'clear'; the extra key is ignored.
CREATE OR REPLACE FUNCTION public.set_conversation_lifecycle(
  p_conversation_id uuid,p_action text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_user uuid:=auth.uid();
  v_hidden_at timestamptz;
  v_archived_at timestamptz;
  v_cleared_at timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
  IF p_action NOT IN ('archive','unarchive','hide','clear') THEN RAISE EXCEPTION 'invalid_lifecycle_action' USING ERRCODE='22023';END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id=p_conversation_id AND user_id=v_user
  ) THEN RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';END IF;
  INSERT INTO public.conversation_participant_lifecycle(
    conversation_id,user_id,hidden_at,archived_at,cleared_at
  ) VALUES (
    p_conversation_id,v_user,
    CASE WHEN p_action='hide' THEN now() ELSE NULL END,
    CASE WHEN p_action='archive' THEN now() ELSE NULL END,
    CASE WHEN p_action='clear' THEN now() ELSE NULL END
  )
  ON CONFLICT (conversation_id,user_id) DO UPDATE
  SET hidden_at=CASE WHEN p_action='hide' THEN now() ELSE conversation_participant_lifecycle.hidden_at END,
      archived_at=CASE
        WHEN p_action='archive' THEN now()
        WHEN p_action='unarchive' THEN NULL
        ELSE conversation_participant_lifecycle.archived_at
      END,
      cleared_at=CASE WHEN p_action='clear' THEN now()
        ELSE conversation_participant_lifecycle.cleared_at
      END
  RETURNING hidden_at,archived_at,cleared_at INTO v_hidden_at,v_archived_at,v_cleared_at;
  RETURN jsonb_build_object('conversationId',p_conversation_id,'hiddenAt',v_hidden_at,'archivedAt',v_archived_at,'clearedAt',v_cleared_at);
END;$function$;
REVOKE ALL ON FUNCTION public.set_conversation_lifecycle(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_lifecycle(uuid,text) TO authenticated,service_role;

-- B2. Reopen law: either person's new human message brings a removed chat back.
-- Archive is never undone by a message: an archived and removed chat returns to
-- the Archived list, still archived (candidates include archived rows).
CREATE OR REPLACE FUNCTION public.tg_reopen_hidden_conversation_on_human_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.sender_id IS NULL OR NEW.deleted_at IS NOT NULL OR NEW.message_type = 'system' THEN RETURN NEW; END IF;
  UPDATE public.conversation_participant_lifecycle lifecycle
     SET hidden_at = NULL
   WHERE lifecycle.conversation_id = NEW.conversation_id
     AND lifecycle.hidden_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.content_share_recipient_candidates(lifecycle.user_id, true, true) candidate
                  WHERE candidate.conversation_id = NEW.conversation_id);
  RETURN NEW;
END; $function$;

-- B3. Clear chat, enforced for every message read under RLS (thread, list
-- preview, unread anti-join, realtime postgres_changes, list search).
DROP POLICY IF EXISTS messages_cleared_for_me ON public.messages;
CREATE POLICY messages_cleared_for_me ON public.messages AS RESTRICTIVE FOR SELECT
  USING (NOT EXISTS (
    SELECT 1 FROM public.conversation_participant_lifecycle l
     WHERE l.conversation_id = messages.conversation_id AND l.user_id = (SELECT auth.uid())
       AND l.cleared_at IS NOT NULL AND messages.created_at <= l.cleared_at));

-- B4. Lifecycle changes reach the owner live (owner-only RLS limits each
-- subscriber to their own rows).
DO $realtime$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                      AND schemaname = 'public' AND tablename = 'conversation_participant_lifecycle') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participant_lifecycle;
  END IF;
END $realtime$;
