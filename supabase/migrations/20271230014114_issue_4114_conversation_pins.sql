-- Issue #4114 Wave 2a: pin up to 3 chats, and mark a chat unread.
--
-- Both are private, per-member list state. They live on the per-member
-- lifecycle table #1719 created (conversation_participant_lifecycle), next to
-- archived_at and hidden_at, because that table already has the right shape:
--   * one row per (conversation, member), tied to membership by a foreign key
--     to conversation_participants (leaving a chat deletes the row);
--   * RLS lets a member SELECT only their own row (user_id = auth.uid());
--   * authenticated has SELECT only. Every write goes through a SECURITY
--     DEFINER RPC that writes auth.uid()'s row, so nobody can pin, unpin or
--     mark unread another member's copy of a chat.
--
-- "Mark unread" is a flag, not a change to read receipts. The existing read
-- state is message_reads, which the sender sees as "seen". Deleting a receipt
-- to fake unread would tell the other person their message was un-seen, so the
-- flag stays private and is cleared when the member opens the chat.
--
-- The 3-pin limit is a trigger on the table, so it holds for every writer
-- (the RPC, service role, future code), with a per-user advisory lock so two
-- pins at once cannot both pass the count.
--
-- list_connection_conversation_access() is the one read the chat list already
-- makes for eligibility and archive state. It is recreated with the same body
-- and two more columns, so pins arrive with no extra round trip. Old app builds
-- read only conversation_id and archived_at and ignore the new columns.

BEGIN;

ALTER TABLE public.conversation_participant_lifecycle
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS marked_unread_at timestamptz NULL;

COMMENT ON COLUMN public.conversation_participant_lifecycle.pinned_at IS
  'Issue #4114: when this member pinned the chat to the top of their list. At most 3 pinned rows per member (enforced by trigger). Private to the member.';
COMMENT ON COLUMN public.conversation_participant_lifecycle.marked_unread_at IS
  'Issue #4114: this member marked the chat unread. Private; cleared when they open the chat. Never touches message_reads.';

CREATE INDEX IF NOT EXISTS conversation_participant_lifecycle_user_pins_idx
  ON public.conversation_participant_lifecycle(user_id)
  WHERE pinned_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_conversation_pin_limit()
RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_pinned integer;
BEGIN
  IF NEW.pinned_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.pinned_at IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4114_pins:'||NEW.user_id::text,0));
  SELECT count(*) INTO v_pinned
  FROM public.conversation_participant_lifecycle lifecycle
  WHERE lifecycle.user_id=NEW.user_id
    AND lifecycle.pinned_at IS NOT NULL
    AND lifecycle.conversation_id<>NEW.conversation_id;
  IF v_pinned>=3 THEN
    RAISE EXCEPTION 'pin_limit_reached' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;$function$;

DROP TRIGGER IF EXISTS conversation_pin_limit ON public.conversation_participant_lifecycle;
CREATE TRIGGER conversation_pin_limit
  BEFORE INSERT OR UPDATE OF pinned_at ON public.conversation_participant_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.tg_conversation_pin_limit();

CREATE OR REPLACE FUNCTION public.set_conversation_list_state(
  p_conversation_id uuid,p_action text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_user uuid:=auth.uid();
  v_pinned_at timestamptz;
  v_marked_unread_at timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
  IF p_action NOT IN ('pin','unpin','mark_unread','mark_read') THEN
    RAISE EXCEPTION 'invalid_list_state_action' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id=p_conversation_id AND user_id=v_user
  ) THEN RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';END IF;
  INSERT INTO public.conversation_participant_lifecycle(
    conversation_id,user_id,pinned_at,marked_unread_at
  ) VALUES (
    p_conversation_id,v_user,
    CASE WHEN p_action='pin' THEN now() ELSE NULL END,
    CASE WHEN p_action='mark_unread' THEN now() ELSE NULL END
  )
  ON CONFLICT (conversation_id,user_id) DO UPDATE
  SET pinned_at=CASE
        WHEN p_action='pin' THEN COALESCE(conversation_participant_lifecycle.pinned_at,now())
        WHEN p_action='unpin' THEN NULL
        ELSE conversation_participant_lifecycle.pinned_at
      END,
      marked_unread_at=CASE
        WHEN p_action='mark_unread' THEN now()
        WHEN p_action='mark_read' THEN NULL
        ELSE conversation_participant_lifecycle.marked_unread_at
      END
  RETURNING pinned_at,marked_unread_at INTO v_pinned_at,v_marked_unread_at;
  RETURN jsonb_build_object(
    'conversationId',p_conversation_id,
    'pinnedAt',v_pinned_at,
    'markedUnreadAt',v_marked_unread_at
  );
END;$function$;
REVOKE ALL ON FUNCTION public.set_conversation_list_state(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_list_state(uuid,text) TO authenticated,service_role;

-- Same body as 20270228001719, plus pinned_at and marked_unread_at.
DROP FUNCTION IF EXISTS public.list_connection_conversation_access();
CREATE FUNCTION public.list_connection_conversation_access()
RETURNS TABLE(conversation_id uuid,archived_at timestamptz,pinned_at timestamptz,marked_unread_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
  SELECT DISTINCT c.conversation_id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
  FROM public.content_share_recipient_candidates(auth.uid(),true,false) c
  LEFT JOIN public.conversation_participant_lifecycle lifecycle
    ON lifecycle.conversation_id=c.conversation_id AND lifecycle.user_id=auth.uid()
  WHERE c.target_kind IN ('direct','group') AND c.conversation_id IS NOT NULL
  UNION
  SELECT conversation.id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
  FROM public.conversation_participants mine
  JOIN public.conversations conversation ON conversation.id=mine.conversation_id
  JOIN public.collaboration_sessions session ON session.id=conversation.session_id
  LEFT JOIN public.conversation_participant_lifecycle lifecycle
    ON lifecycle.conversation_id=mine.conversation_id AND lifecycle.user_id=mine.user_id
  WHERE mine.user_id=auth.uid() AND lifecycle.hidden_at IS NULL
    AND conversation.type='group' AND conversation.linked_entity_type='session'
    AND conversation.is_enabled IS TRUE AND session.created_by=auth.uid()
    AND session.is_active IS TRUE AND session.archived_at IS NULL
    AND session.status='pending';
$function$;
REVOKE ALL ON FUNCTION public.list_connection_conversation_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_connection_conversation_access() TO authenticated,service_role;

COMMIT;
