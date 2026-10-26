-- #4111 Wave C — the Brand-group enquiry card: privacy and badge math.
--
-- (a) Mingla staff and scanner-only members can read Brand groups, but D8 keeps
--     them blind to enquiries. The team-group card therefore never names the
--     guest: it reads "New customer enquiry · {topic}" and its payload carries
--     only the enquiry id and topic. The guest's name appears after Open, which
--     goes through enquiry access (brand_enquiry_get_thread / RLS).
-- (b) The card is not a chat message. It never counts toward a Brand group's
--     unread badge, so the Host speech-bubble badge (Brand-group unread plus
--     enquiries in new|waiting) never counts the same enquiry twice.
-- (c) The Host app needs the card's enquiry id to render "Open enquiry", so the
--     Brand-group message list returns card_payload for enquiry cards only.
--
-- INVARIANT: {"id":"I-4111-ENQUIRY-CARD-NO-GUEST-NAME","rule":"brand_enquiry_card messages in a Brand group never carry the guest name in content or card_payload."}
-- INVARIANT: {"id":"I-4111-ENQUIRY-CARD-NOT-UNREAD","rule":"issue_3720_list_brand_groups never counts brand_enquiry_card messages as unread."}

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. New cards: no guest name. Same body as 20271221014111 except the card.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4111_open_enquiry(
  p_brand_id uuid,
  p_source text,
  p_origin text,
  p_entry text,
  p_context_kind text,
  p_context_id uuid,
  p_offering_kind text,
  p_reason text,
  p_body text,
  p_guest_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_ok_to_call boolean,
  p_email_confirmed boolean,
  p_spam_flag boolean,
  p_moderation_categories text[],
  p_disclosure_text text,
  p_disclosure_version text,
  p_ip_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_body text := btrim(COALESCE(p_body, ''));
  v_name text := btrim(COALESCE(p_guest_name, ''));
  v_label text;
  v_conversation uuid;
  v_enquiry uuid;
  v_message uuid;
  v_group uuid;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.issue_4111_brand_takes_enquiries(p_brand_id) THEN
    RAISE EXCEPTION 'enquiries_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_body) NOT BETWEEN 10 AND 2000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  v_label := public.issue_4111_reason_label(p_reason, v_brand.name);
  IF v_label IS NULL THEN RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.conversations(
    type, linked_entity_type, brand_id, name, created_by, is_enabled, is_broadcast_only
  ) VALUES (
    'group', 'brand_enquiry', p_brand_id, left(v_brand.name || ' · ' || v_name, 200),
    p_guest_user_id, true, false
  ) RETURNING id INTO v_conversation;

  IF p_guest_user_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants(conversation_id, user_id)
    VALUES (v_conversation, p_guest_user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  INSERT INTO public.brand_enquiries(
    brand_id, conversation_id, source, origin, entry, context_kind, context_id,
    offering_kind, reason, topic_label, guest_user_id, guest_name, guest_email,
    guest_email_confirmed_at, guest_phone_e164, ok_to_call, disclosure_text,
    disclosure_version, ip_hash, spam_flag, moderation_categories
  ) VALUES (
    p_brand_id, v_conversation, p_source, NULLIF(btrim(COALESCE(p_origin, '')), ''), p_entry,
    p_context_kind, p_context_id, p_offering_kind, p_reason, v_label, p_guest_user_id,
    v_name, lower(btrim(p_guest_email)),
    CASE WHEN p_email_confirmed THEN now() END,
    NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
    COALESCE(p_ok_to_call, false) AND NULLIF(btrim(COALESCE(p_guest_phone, '')), '') IS NOT NULL,
    p_disclosure_text, p_disclosure_version, p_ip_hash,
    COALESCE(p_spam_flag, false), COALESCE(p_moderation_categories, '{}'::text[])
  ) RETURNING id INTO v_enquiry;

  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type, sender_kind, sender_display_name_snapshot, created_at
  ) VALUES (
    v_conversation, p_guest_user_id, v_body, 'text', 'guest', v_name, clock_timestamp()
  ) RETURNING id INTO v_message;

  -- One system card in the team's own Brand group. It is a plain insert, not
  -- issue_3720_send_brand_group_message, so the Brand-group push fan-out does
  -- not fire: the enquiry notice below is the notification.
  -- #4111 Wave C: the card never names the guest. Staff and scanners can read
  -- Brand groups; the name only appears after Open, behind enquiry access.
  IF NOT COALESCE(p_spam_flag, false) THEN
    SELECT c.id INTO v_group FROM public.conversations c
    WHERE c.linked_entity_type = 'brand' AND c.brand_id = p_brand_id;
    IF v_group IS NULL THEN
      v_group := public.issue_3720_ensure_official_brand_group(p_brand_id);
    END IF;
    IF v_group IS NOT NULL THEN
      INSERT INTO public.messages(
        conversation_id, sender_id, content, message_type, sender_kind,
        sender_display_name_snapshot, card_payload, created_at
      ) VALUES (
        v_group, NULL, left('New customer enquiry · ' || v_label, 300),
        'brand_enquiry_card', 'system', 'Customer enquiry',
        jsonb_build_object('kind', 'brand_enquiry_card', 'enquiry_id', v_enquiry,
          'topic_label', v_label),
        clock_timestamp()
      );
    END IF;
    PERFORM public.issue_4111_enqueue_team_notice(v_enquiry, 'business.brand_enquiry_new', v_message, v_body);
  END IF;

  RETURN jsonb_build_object(
    'enquiry_id', v_enquiry, 'conversation_id', v_conversation,
    'brand_id', p_brand_id, 'brand_name', v_brand.name, 'brand_slug', v_brand.slug,
    'topic_label', v_label
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4111_open_enquiry(uuid,text,text,text,text,uuid,text,text,text,uuid,text,text,text,boolean,boolean,boolean,text[],text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4111_open_enquiry(uuid,text,text,text,text,uuid,text,text,text,uuid,text,text,text,boolean,boolean,boolean,text[],text,text,text)
  TO service_role;

-- Cards written before this migration lose the name too.
UPDATE public.messages m
SET content = left('New customer enquiry · ' || COALESCE(NULLIF(btrim(m.card_payload->>'topic_label'), ''), 'Enquiry'), 300),
    card_payload = COALESCE(m.card_payload, '{}'::jsonb) - 'guest_name'
WHERE m.message_type::text = 'brand_enquiry_card'
  AND (m.card_payload ? 'guest_name' OR m.content NOT LIKE 'New customer enquiry · %');

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Brand-group list: enquiry cards are never unread. Same body as
--    20271210003988 plus the message_type filter on the unread join.
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
  muted boolean
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
    COALESCE(read_state.muted, false)
  FROM caller
  JOIN public.conversations c ON c.linked_entity_type='brand' AND c.is_enabled IS TRUE
  JOIN public.brands b ON b.id=c.brand_id AND b.deleted_at IS NULL
  LEFT JOIN public.brand_group_reads read_state
    ON read_state.conversation_id=c.id AND read_state.user_id=caller.user_id
  LEFT JOIN LATERAL (
    SELECT m.content FROM public.messages m
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
    last_message.content,read_state.push_enabled,read_state.muted,caller.user_id,caller.is_support
  ORDER BY c.last_message_at DESC NULLS LAST, lower(b.name), b.id;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_list_brand_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_groups()
  TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Brand-group messages: append card_payload, for enquiry cards only. Same
--    body as 20271030003720 plus the last column.
-- ───────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.issue_3720_list_brand_group_messages(uuid, integer, timestamptz);
CREATE FUNCTION public.issue_3720_list_brand_group_messages(
  p_conversation_id uuid,p_limit integer DEFAULT 80,p_before timestamptz DEFAULT NULL
) RETURNS TABLE(
  id uuid,conversation_id uuid,sender_id uuid,content text,created_at timestamptz,
  reply_to_id uuid,related_message_ids uuid[],sender_display_name text,sender_role text,
  reply_content text,reply_sender_display_name text,message_type text,file_id uuid,
  file_name text,file_size bigint,file_mime text,card_payload jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
BEGIN
  IF NOT public.issue_3720_brand_group_can_access(p_conversation_id,auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT m.id,m.conversation_id,m.sender_id,m.content,m.created_at,m.reply_to_id,m.related_message_ids,
    COALESCE(NULLIF(btrim(m.sender_display_name_snapshot),''),NULLIF(btrim(p.display_name),''),
      NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''),NULLIF(btrim(p.username),''),'Mingla member'),
    NULLIF(btrim(m.sender_role_snapshot),''),reply.content,
    COALESCE(NULLIF(btrim(reply.sender_display_name_snapshot),''),NULLIF(btrim(reply_profile.display_name),''),
      NULLIF(btrim(concat_ws(' ',reply_profile.first_name,reply_profile.last_name)),''),
      NULLIF(btrim(reply_profile.username),''),'Mingla member'),
    m.message_type::text,f.id,f.original_filename,f.verified_size_bytes,f.verified_mime,
    CASE WHEN m.message_type::text = 'brand_enquiry_card'
      THEN jsonb_build_object(
        'kind', 'brand_enquiry_card',
        'enquiry_id', m.card_payload->>'enquiry_id',
        'topic_label', m.card_payload->>'topic_label')
    END
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id=m.sender_id
  LEFT JOIN public.messages reply ON reply.id=m.reply_to_id AND reply.conversation_id=m.conversation_id
  LEFT JOIN public.profiles reply_profile ON reply_profile.id=reply.sender_id
  LEFT JOIN public.brand_group_files f ON f.message_id=m.id AND f.state='ready'
  WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
    AND (p_before IS NULL OR m.created_at<p_before)
  ORDER BY m.created_at DESC,m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,80),1),200);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz) TO authenticated,service_role;

COMMIT;
