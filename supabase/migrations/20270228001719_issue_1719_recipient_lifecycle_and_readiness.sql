-- #1719 amendment: one server truth for conversation lifecycle, recipient
-- eligibility, deterministic activity order, and scoped lifecycle mutations.
-- Additive follow-up: 20270227001719 is deployed and intentionally untouched.
BEGIN;

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

COMMENT ON COLUMN public.conversation_participants.hidden_at IS
  '#1719 per-user remove-chat state. A qualifying incoming human message may clear it; never inferred from old clients.';
COMMENT ON COLUMN public.conversation_participants.archived_at IS
  '#1719 per-user archive state. Never auto-cleared by messages.';

CREATE INDEX IF NOT EXISTS conversation_participants_user_lifecycle_idx
  ON public.conversation_participants(user_id, conversation_id)
  INCLUDE (hidden_at, archived_at);
CREATE INDEX IF NOT EXISTS messages_meaningful_activity_idx
  ON public.messages(conversation_id, created_at DESC)
  WHERE deleted_at IS NULL AND sender_id IS NOT NULL;

-- This is the sole eligibility and ordering owner. It is internal-only: public
-- callers reach it through the zero-argument list/Connections RPCs, while the
-- delivery RPC reuses it transactionally for authorization.
CREATE OR REPLACE FUNCTION public.content_share_recipient_candidates(
  p_user_id uuid,
  p_include_archived boolean DEFAULT false,
  p_include_hidden boolean DEFAULT false
) RETURNS TABLE(
  key text,
  target_kind text,
  target_id uuid,
  person_user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  conversation_id uuid,
  meaningful_activity_at timestamptz,
  conversation_created_at timestamptz,
  participant_count integer,
  recipient_tier integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH
  blocks AS (
    SELECT blocker_id, blocked_id
    FROM public.blocked_users
    WHERE blocker_id=p_user_id OR blocked_id=p_user_id
  ),
  eligible_conversations AS (
    SELECT c.*, mine.archived_at,
      activity.meaningful_activity_at,
      (SELECT count(DISTINCT member.user_id)::integer
       FROM public.conversation_participants member WHERE member.conversation_id=c.id) AS member_count
    FROM public.conversation_participants mine
    JOIN public.conversations c ON c.id=mine.conversation_id
    LEFT JOIN LATERAL (
      SELECT max(m.created_at) AS meaningful_activity_at
      FROM public.messages m
      WHERE m.conversation_id=c.id AND m.deleted_at IS NULL AND m.sender_id IS NOT NULL
    ) activity ON true
    WHERE mine.user_id=p_user_id
      AND (p_include_hidden OR mine.hidden_at IS NULL)
      AND (p_include_archived OR mine.archived_at IS NULL)
      AND c.is_enabled IS TRUE
      AND (
        (c.type='direct' AND c.linked_entity_type='direct'
          AND (SELECT count(DISTINCT cp.user_id) FROM public.conversation_participants cp WHERE cp.conversation_id=c.id)=2)
        OR
        (c.type='group' AND (
          (c.linked_entity_type='session' AND EXISTS (
            SELECT 1
            FROM public.collaboration_sessions cs
            JOIN public.session_participants sp ON sp.session_id=cs.id
            WHERE cs.id=c.session_id AND sp.user_id=p_user_id AND sp.has_accepted IS TRUE
              AND cs.is_active IS TRUE AND cs.archived_at IS NULL
              AND cs.status IN ('active','voting','locked')
          ))
          OR (c.linked_entity_type IN ('event','trip') AND EXISTS (
            SELECT 1
            FROM public.events e
            JOIN public.orders o ON o.event_id=e.id
            WHERE e.id=c.event_id AND e.deleted_at IS NULL AND e.status IN ('scheduled','live')
              AND o.buyer_user_id=p_user_id AND o.payment_status IN ('paid','partial_refund')
          ))
          OR (c.linked_entity_type='direct' AND public.can_insert_message_into_conversation(c.id,p_user_id))
        ))
      )
  ),
  direct_candidates AS (
    SELECT c.id AS conversation_id, other.user_id AS person_user_id,
      c.meaningful_activity_at, c.created_at,
      row_number() OVER (
        PARTITION BY other.user_id
        ORDER BY c.meaningful_activity_at DESC NULLS LAST,c.created_at DESC,c.id
      ) AS direct_rank
    FROM eligible_conversations c
    JOIN public.conversation_participants other
      ON other.conversation_id=c.id AND other.user_id<>p_user_id
    WHERE c.type='direct'
  ),
  direct_rows AS (
    SELECT ('person:'||p.id)::text AS key,'direct'::text AS target_kind,
      d.conversation_id AS target_id,p.id AS person_user_id,
      COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(p.username),'')) AS display_name,
      p.username,p.avatar_url,d.conversation_id,d.meaningful_activity_at,d.created_at,
      2::integer AS participant_count,
      CASE WHEN d.meaningful_activity_at IS NULL THEN 2 ELSE 1 END::integer AS recipient_tier
    FROM direct_candidates d
    JOIN public.profiles p ON p.id=d.person_user_id
    WHERE d.direct_rank=1 AND p.active IS TRUE AND p.visibility_mode IN ('public','friends')
      AND COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(p.username),'')) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id=p_user_id AND b.blocked_id=p.id)
           OR (b.blocker_id=p.id AND b.blocked_id=p_user_id)
      )
  ),
  group_rows AS (
    SELECT ('group:'||c.id)::text,'group'::text,c.id,NULL::uuid,
      NULLIF(btrim(c.name),''),NULL::text,NULL::text,c.id,
      c.meaningful_activity_at,c.created_at,c.member_count,
      CASE WHEN c.meaningful_activity_at IS NULL THEN 2 ELSE 1 END::integer
    FROM eligible_conversations c
    WHERE c.type='group' AND NULLIF(btrim(c.name),'') IS NOT NULL
      AND public.can_insert_message_into_conversation(c.id,p_user_id)
  ),
  relationship_people AS (
    SELECT CASE WHEN f.user_id=p_user_id THEN f.friend_user_id ELSE f.user_id END AS person_user_id
    FROM public.friends f
    WHERE f.status='accepted' AND f.deleted_at IS NULL
      AND (f.user_id=p_user_id OR f.friend_user_id=p_user_id)
    UNION
    SELECT CASE WHEN pairing.user_a_id=p_user_id THEN pairing.user_b_id ELSE pairing.user_a_id END
    FROM public.pairings pairing
    WHERE pairing.user_a_id=p_user_id OR pairing.user_b_id=p_user_id
  ),
  person_rows AS (
    SELECT ('person:'||p.id)::text,'friend'::text,p.id,p.id,
      COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(p.username),'')),
      p.username,p.avatar_url,NULL::uuid,NULL::timestamptz,NULL::timestamptz,NULL::integer,3::integer
    FROM relationship_people rel
    JOIN public.profiles p ON p.id=rel.person_user_id
    WHERE p.id<>p_user_id AND p.active IS TRUE AND p.visibility_mode IN ('public','friends')
      AND COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(p.username),'')) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM direct_rows d WHERE d.person_user_id=p.id)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id=p_user_id AND b.blocked_id=p.id)
           OR (b.blocker_id=p.id AND b.blocked_id=p_user_id)
      )
  ),
  recipients AS (
    SELECT * FROM direct_rows
    UNION ALL SELECT * FROM group_rows
    UNION ALL SELECT * FROM person_rows
  )
  SELECT * FROM recipients
  ORDER BY recipient_tier,
    CASE WHEN recipient_tier=1 THEN meaningful_activity_at END DESC NULLS LAST,
    CASE WHEN recipient_tier=2 THEN conversation_created_at END DESC NULLS LAST,
    lower(display_name),target_kind,key;
$function$;

REVOKE ALL ON FUNCTION public.content_share_recipient_candidates(uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.content_share_recipient_candidates(uuid,boolean,boolean) TO service_role;

DROP FUNCTION IF EXISTS public.list_content_share_recipients();
CREATE FUNCTION public.list_content_share_recipients()
RETURNS TABLE(
  key text,target_kind text,target_id uuid,person_user_id uuid,
  display_name text,username text,avatar_url text,conversation_id uuid,
  meaningful_activity_at timestamptz,conversation_created_at timestamptz,
  participant_count integer,recipient_tier integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
  SELECT * FROM public.content_share_recipient_candidates(auth.uid(),false,false);
$function$;
REVOKE ALL ON FUNCTION public.list_content_share_recipients() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_content_share_recipients() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_connection_conversation_access()
RETURNS TABLE(conversation_id uuid,archived_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
  SELECT DISTINCT c.conversation_id,cp.archived_at
  FROM public.content_share_recipient_candidates(auth.uid(),true,false) c
  JOIN public.conversation_participants cp
    ON cp.conversation_id=c.conversation_id AND cp.user_id=auth.uid()
  WHERE c.target_kind IN ('direct','group') AND c.conversation_id IS NOT NULL
  UNION
  SELECT conversation.id,mine.archived_at
  FROM public.conversation_participants mine
  JOIN public.conversations conversation ON conversation.id=mine.conversation_id
  JOIN public.collaboration_sessions session ON session.id=conversation.session_id
  WHERE mine.user_id=auth.uid() AND mine.hidden_at IS NULL
    AND conversation.type='group' AND conversation.linked_entity_type='session'
    AND conversation.is_enabled IS TRUE AND session.created_by=auth.uid()
    AND session.is_active IS TRUE AND session.archived_at IS NULL
    AND session.status='pending';
$function$;
REVOKE ALL ON FUNCTION public.list_connection_conversation_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_connection_conversation_access() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.set_conversation_lifecycle(
  p_conversation_id uuid,p_action text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_user uuid:=auth.uid();v_row public.conversation_participants%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
  IF p_action NOT IN ('archive','unarchive','hide') THEN RAISE EXCEPTION 'invalid_lifecycle_action' USING ERRCODE='22023';END IF;
  UPDATE public.conversation_participants
  SET archived_at=CASE WHEN p_action='archive' THEN now() WHEN p_action='unarchive' THEN NULL ELSE archived_at END,
      hidden_at=CASE WHEN p_action='hide' THEN now() ELSE hidden_at END
  WHERE conversation_id=p_conversation_id AND user_id=v_user
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('conversationId',p_conversation_id,'hiddenAt',v_row.hidden_at,'archivedAt',v_row.archived_at);
END;$function$;
REVOKE ALL ON FUNCTION public.set_conversation_lifecycle(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_lifecycle(uuid,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.leave_group_conversation(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_user uuid:=auth.uid();v_conversation public.conversations%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501';END IF;
  SELECT * INTO v_conversation FROM public.conversations
  WHERE id=p_conversation_id AND type='group' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id=p_conversation_id AND user_id=v_user
  ) THEN RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';END IF;
  IF v_conversation.linked_entity_type='session' THEN
    DELETE FROM public.session_participants WHERE session_id=v_conversation.session_id AND user_id=v_user;
  END IF;
  DELETE FROM public.conversation_participants
  WHERE conversation_id=p_conversation_id AND user_id=v_user;
END;$function$;
REVOKE ALL ON FUNCTION public.leave_group_conversation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.leave_group_conversation(uuid) TO authenticated,service_role;

-- Locked reopen law: only another human participant's new, non-deleted message
-- clears hidden state. Archived state is untouched. Ineligible groups remain
-- hidden because the canonical session/event/order conditions are rechecked.
CREATE OR REPLACE FUNCTION public.tg_reopen_hidden_conversation_on_human_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
BEGIN
  IF NEW.sender_id IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW;END IF;
  UPDATE public.conversation_participants cp
  SET hidden_at=NULL
  WHERE cp.conversation_id=NEW.conversation_id AND cp.user_id<>NEW.sender_id
    AND cp.hidden_at IS NOT NULL AND cp.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.content_share_recipient_candidates(cp.user_id,false,true) candidate
      WHERE candidate.conversation_id=NEW.conversation_id
    );
  RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS reopen_hidden_conversation_on_human_message ON public.messages;
CREATE TRIGGER reopen_hidden_conversation_on_human_message
  AFTER INSERT ON public.messages FOR EACH ROW
  EXECUTE FUNCTION public.tg_reopen_hidden_conversation_on_human_message();

-- Delivery authorization consumes the same rows returned by the list RPC.
-- Replace only the target-resolution fragment by introducing a guard trigger:
-- this executes in the delivery transaction before the message row can commit.
CREATE OR REPLACE FUNCTION public.tg_guard_content_share_delivery_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.content_share_recipient_candidates(NEW.sender_id,false,false) c
    WHERE (c.target_kind=NEW.target_kind AND c.target_id=NEW.target_id)
       OR (NEW.target_kind='friend' AND c.person_user_id=NEW.target_id)
  ) THEN RAISE EXCEPTION 'target_unavailable' USING ERRCODE='42501';END IF;
  RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS guard_content_share_delivery_target ON public.content_share_message_deliveries;
CREATE TRIGGER guard_content_share_delivery_target
  BEFORE INSERT ON public.content_share_message_deliveries FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_content_share_delivery_target();

COMMIT;
