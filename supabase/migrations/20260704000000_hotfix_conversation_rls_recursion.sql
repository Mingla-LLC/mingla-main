-- HOTFIX: break conversations <-> conversation_participants/messages RLS recursion.
--
-- Symptom:
--   PostgREST/Supabase returns:
--     infinite recursion detected in policy for relation "conversations"
--   when the consumer app fetches conversations with embedded participants and
--   last_message rows.
--
-- Root cause:
--   conversations SELECT policies queried conversation_participants directly.
--   Newer brand-team policies on conversation_participants/messages queried
--   conversations back. When Postgres evaluated embedded selects, the policy
--   graph became conversations -> conversation_participants/messages ->
--   conversations.
--
-- Fix:
--   Keep the same access contract, but move cross-table predicates behind
--   SECURITY DEFINER helpers with an explicit search_path so policy evaluation
--   does not recursively re-enter the protected relation.

CREATE OR REPLACE FUNCTION public.is_direct_conversation(
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.type = 'direct'
  );
$$;

COMMENT ON FUNCTION public.is_direct_conversation(uuid) IS
  'HOTFIX: RLS-safe direct-conversation check for conversation_participants INSERT policies. SECURITY DEFINER prevents conversations <-> conversation_participants policy recursion.';

CREATE OR REPLACE FUNCTION public.is_conversation_brand_team_member(
  p_conversation_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.events e ON e.id = c.event_id
    JOIN public.brand_team_members btm ON btm.brand_id = e.brand_id
    WHERE c.id = p_conversation_id
      AND c.linked_entity_type = ANY (ARRAY['trip'::text, 'event'::text])
      AND c.event_id IS NOT NULL
      AND btm.user_id = p_user_id
      AND btm.accepted_at IS NOT NULL
      AND btm.removed_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.is_conversation_brand_team_member(uuid, uuid) IS
  'HOTFIX: RLS-safe trip/event conversation brand-team membership check. SECURITY DEFINER prevents policies on conversation_participants/messages from querying conversations under conversations RLS.';

CREATE OR REPLACE FUNCTION public.can_insert_message_into_conversation(
  p_conversation_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND (
        c.linked_entity_type <> ALL (ARRAY['trip'::text, 'event'::text])
        OR c.is_broadcast_only IS NOT TRUE
        OR public.is_conversation_brand_team_member(p_conversation_id, p_user_id)
      )
  );
$$;

COMMENT ON FUNCTION public.can_insert_message_into_conversation(uuid, uuid) IS
  'HOTFIX: RLS-safe broadcast-only insert gate. Non-trip/event and non-broadcast conversations allow normal member inserts; broadcast trip/event conversations require brand-team membership.';

GRANT EXECUTE ON FUNCTION public.is_direct_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_brand_team_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_message_into_conversation(uuid, uuid) TO authenticated;

-- Conversations: use the existing SECURITY DEFINER participant helper instead
-- of directly querying conversation_participants from a conversations policy.
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON public.conversations;
CREATE POLICY "Users can view conversations they participate in"
  ON public.conversations
  FOR SELECT
  USING (
    created_by = auth.uid()
    OR public.is_conversation_participant(conversations.id, auth.uid())
  );

DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations"
  ON public.conversations
  FOR SELECT
  USING (
    public.is_conversation_participant(conversations.id, auth.uid())
  );

-- conversation_participants: remove direct conversations reads from policies.
DROP POLICY IF EXISTS conversation_participants_brand_team_member_read ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_team_member_read
  ON public.conversation_participants
  FOR SELECT
  USING (
    public.is_conversation_brand_team_member(conversation_participants.conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS conversation_participants_brand_team_member_delete ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_team_member_delete
  ON public.conversation_participants
  FOR DELETE
  USING (
    public.is_conversation_brand_team_member(conversation_participants.conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS conversation_participants_direct_self_add ON public.conversation_participants;
CREATE POLICY conversation_participants_direct_self_add
  ON public.conversation_participants
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_direct_conversation(conversation_participants.conversation_id)
  );

-- messages: remove direct conversations reads from brand-team and broadcast
-- policies. The existing participant-based user policies remain unchanged.
DROP POLICY IF EXISTS messages_brand_team_member_read ON public.messages;
CREATE POLICY messages_brand_team_member_read
  ON public.messages
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND public.is_conversation_brand_team_member(messages.conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS messages_brand_team_member_insert ON public.messages;
CREATE POLICY messages_brand_team_member_insert
  ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_brand_team_member(messages.conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS messages_brand_team_member_update ON public.messages;
CREATE POLICY messages_brand_team_member_update
  ON public.messages
  FOR UPDATE
  USING (
    public.is_conversation_brand_team_member(messages.conversation_id, auth.uid())
  )
  WITH CHECK (
    public.is_conversation_brand_team_member(messages.conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS messages_broadcast_only_enforcement ON public.messages;
CREATE POLICY messages_broadcast_only_enforcement
  ON public.messages
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    public.can_insert_message_into_conversation(messages.conversation_id, auth.uid())
  );
