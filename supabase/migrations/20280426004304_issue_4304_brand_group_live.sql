-- #4304 part 2 — Brand groups feel like the Explorer chats.
--
-- 1. issue_3720_list_brand_groups also returns who sent the last message and
--    its type, so the inbox can say "Ada: …" / "You: …" / "Photo". The body is
--    the #4111 body unchanged plus three trailing columns; enquiry cards are
--    still never unread (I-4111-ENQUIRY-CARD-NOT-UNREAD).
-- 2. Reactions on Brand-group messages reuse public.direct_message_reactions
--    (already in the realtime publication since #4114). Members could already
--    read them through conversation_participants; Support staff and admins,
--    who reach a Brand group without a roster row, could not. A permissive
--    read policy adds exactly the people who can read the message, and a
--    restrictive insert policy stops anyone outside the group reacting to a
--    Brand-group message and limits Brand-group reactions to the six emoji
--    the app offers.
-- 3. issue_4304_list_brand_group_read_state lets a person who can read a
--    Brand group see how far each active teammate has read it, so the thread
--    can say "Seen by Ada, Kim +1". Only active accepted teammates are listed
--    (Support staff reading a group is never shown), never the caller.
--
-- Typing indicators use realtime broadcast on the conversation channel and
-- store nothing.
--
-- INVARIANT: {"id":"I-4304-BRAND-GROUP-REACTIONS-SCOPED","rule":"A reaction on a Brand-group message can be read or written only by someone who can access that Brand group, and only with an offered emoji."}
-- INVARIANT: {"id":"I-4304-BRAND-GROUP-SEEN-BY-ROSTER","rule":"Brand-group read state is returned only to someone who can access the group, and lists only active accepted teammates other than the caller."}

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Inbox: last speaker and message type.
-- ───────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.issue_3720_list_brand_groups();
CREATE FUNCTION public.issue_3720_list_brand_groups()
RETURNS TABLE(
  conversation_id uuid,
  brand_id uuid,
  brand_name text,
  brand_slug text,
  brand_photo_url text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count bigint,
  member_count bigint,
  access_kind text,
  push_enabled boolean,
  muted boolean,
  last_message_sender_id uuid,
  last_message_sender_name text,
  last_message_type text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH caller AS (
    SELECT auth.uid() user_id,
      public.is_support_staff(auth.uid()) OR public.is_admin_user() AS is_support
  )
  SELECT c.id, b.id, b.name, b.slug, b.profile_photo_url,
    c.last_message_at,
    left(COALESCE(last_message.content, ''), 180),
    count(unread.id) FILTER (WHERE unread.id IS NOT NULL),
    (SELECT count(*) FROM public.brand_team_members member
      WHERE member.brand_id=b.id AND member.accepted_at IS NOT NULL AND member.removed_at IS NULL),
    CASE WHEN EXISTS (
      SELECT 1 FROM public.brand_team_members mine
      WHERE mine.brand_id=b.id AND mine.user_id=caller.user_id
        AND mine.accepted_at IS NOT NULL AND mine.removed_at IS NULL
    ) THEN 'brand' ELSE 'support' END,
    COALESCE(read_state.push_enabled, false),
    COALESCE(read_state.muted, false),
    last_message.sender_id,
    last_message.sender_name,
    last_message.message_type
  FROM caller
  JOIN public.conversations c ON c.linked_entity_type='brand' AND c.is_enabled IS TRUE
  JOIN public.brands b ON b.id=c.brand_id AND b.deleted_at IS NULL
  LEFT JOIN public.brand_group_reads read_state
    ON read_state.conversation_id=c.id AND read_state.user_id=caller.user_id
  LEFT JOIN LATERAL (
    SELECT m.content, m.sender_id, m.message_type::text AS message_type,
      COALESCE(NULLIF(btrim(m.sender_display_name_snapshot),''),
        NULLIF(btrim(p.display_name),''),
        NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''),
        NULLIF(btrim(p.username),''),
        CASE WHEN m.sender_id IS NULL THEN NULL ELSE 'Mingla member' END) AS sender_name
    FROM public.messages m
    LEFT JOIN public.profiles p ON p.id=m.sender_id
    WHERE m.conversation_id=c.id AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) last_message ON true
  LEFT JOIN public.messages unread
    ON unread.conversation_id=c.id AND unread.deleted_at IS NULL
   AND unread.sender_id IS DISTINCT FROM caller.user_id
   AND unread.created_at > COALESCE(read_state.last_read_at, 'epoch'::timestamptz)
   AND unread.message_type::text <> 'brand_enquiry_card'
  WHERE caller.user_id IS NOT NULL
    AND (caller.is_support OR EXISTS (
      SELECT 1 FROM public.brand_team_members mine
      WHERE mine.brand_id=b.id AND mine.user_id=caller.user_id
        AND mine.accepted_at IS NOT NULL AND mine.removed_at IS NULL
    ))
  GROUP BY c.id,b.id,b.name,b.slug,b.profile_photo_url,c.last_message_at,
    last_message.content,last_message.sender_id,last_message.sender_name,last_message.message_type,
    read_state.push_enabled,read_state.muted,caller.user_id,caller.is_support
  ORDER BY c.last_message_at DESC NULLS LAST, lower(b.name), b.id;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_list_brand_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_groups()
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Reactions on Brand-group messages.
-- ───────────────────────────────────────────────────────────────────────────
-- The Brand group a message belongs to, or NULL when it is not in one.
CREATE OR REPLACE FUNCTION public.issue_4304_brand_group_of_message(p_message_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT c.id
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE m.id = p_message_id
    AND c.linked_entity_type = 'brand';
$function$;
REVOKE ALL ON FUNCTION public.issue_4304_brand_group_of_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4304_brand_group_of_message(uuid)
  TO authenticated, service_role;

DROP POLICY IF EXISTS brand_group_reactions_read ON public.direct_message_reactions;
CREATE POLICY brand_group_reactions_read ON public.direct_message_reactions
  FOR SELECT TO authenticated
  USING (
    public.issue_3720_brand_group_can_access(
      public.issue_4304_brand_group_of_message(message_id), auth.uid())
  );

DROP POLICY IF EXISTS brand_group_reactions_scoped_insert ON public.direct_message_reactions;
CREATE POLICY brand_group_reactions_scoped_insert ON public.direct_message_reactions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.issue_4304_brand_group_of_message(message_id) IS NULL
    OR (
      public.issue_3720_brand_group_can_access(
        public.issue_4304_brand_group_of_message(message_id), auth.uid())
      AND emoji = ANY (ARRAY['❤️','👍','😂','😮','😢','🔥']::text[])
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Seen-by: how far each active teammate has read.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4304_list_brand_group_read_state(
  p_conversation_id uuid
) RETURNS TABLE(
  user_id uuid,
  display_name text,
  last_read_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_brand_id uuid;
BEGIN
  IF v_actor IS NULL
     OR NOT public.issue_3720_brand_group_can_access(p_conversation_id, v_actor) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT conversation.brand_id INTO STRICT v_brand_id
  FROM public.conversations conversation
  WHERE conversation.id = p_conversation_id
    AND conversation.linked_entity_type = 'brand'
    AND conversation.is_enabled IS TRUE;

  RETURN QUERY
  SELECT read_state.user_id,
    COALESCE(
      NULLIF(btrim(profile.display_name), ''),
      NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      NULLIF(btrim(profile.username), ''),
      'Brand teammate'
    )::text,
    read_state.last_read_at
  FROM public.brand_group_reads read_state
  JOIN public.brand_team_members member
    ON member.brand_id = v_brand_id
   AND member.user_id = read_state.user_id
   AND member.accepted_at IS NOT NULL
   AND member.removed_at IS NULL
  LEFT JOIN public.profiles profile ON profile.id = read_state.user_id
  WHERE read_state.conversation_id = p_conversation_id
    AND read_state.user_id <> v_actor
    AND read_state.last_read_at > 'epoch'::timestamptz
  ORDER BY read_state.last_read_at DESC, read_state.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4304_list_brand_group_read_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4304_list_brand_group_read_state(uuid)
  TO authenticated, service_role;

COMMIT;
