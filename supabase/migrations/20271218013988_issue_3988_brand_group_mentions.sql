-- #3988 — Brand-group @mentions: member discovery, durable message metadata,
-- and direct-recipient notification even when the mentioned thread is muted.
-- INVARIANT: {"id":"I-3988-BRAND-GROUP-MENTIONS","rule":"Only active members of the message's Brand group may be mentioned; mentioned members receive one durable Brand-group notification even when that thread is muted, while the global channel preference remains authoritative."}

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_3988_list_brand_group_mention_candidates(
  p_conversation_id uuid,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 8
) RETURNS TABLE(
  user_id uuid,
  display_name text,
  username text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_brand_id uuid;
  v_query text := lower(btrim(COALESCE(p_query, '')));
BEGIN
  IF v_actor IS NULL OR NOT public.issue_3720_brand_group_can_access(p_conversation_id, v_actor) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT conversation.brand_id INTO STRICT v_brand_id
  FROM public.conversations conversation
  WHERE conversation.id = p_conversation_id
    AND conversation.linked_entity_type = 'brand'
    AND conversation.is_enabled IS TRUE;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      member.user_id,
      COALESCE(
        NULLIF(btrim(profile.display_name), ''),
        NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        NULLIF(btrim(profile.username), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'full_name'), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'name'), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'display_name'), ''),
        'Brand teammate'
      )::text AS display_name,
      NULLIF(btrim(profile.username), '')::text AS username
    FROM public.brand_team_members member
    JOIN auth.users identity ON identity.id = member.user_id
    LEFT JOIN public.profiles profile ON profile.id = member.user_id
    WHERE member.brand_id = v_brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
      AND member.user_id IS DISTINCT FROM v_actor
  )
  SELECT candidate.user_id, candidate.display_name, candidate.username
  FROM candidates candidate
  WHERE v_query = ''
     OR lower(candidate.display_name) LIKE '%' || v_query || '%'
     OR lower(COALESCE(candidate.username, '')) LIKE '%' || v_query || '%'
  ORDER BY lower(candidate.display_name), candidate.user_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_list_brand_group_mention_candidates(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3988_list_brand_group_mention_candidates(uuid, text, integer)
  TO authenticated, service_role;

DROP FUNCTION public.issue_3720_send_brand_group_message(uuid, text, uuid, uuid[], text);
CREATE FUNCTION public.issue_3720_send_brand_group_message(
  p_conversation_id uuid,
  p_content text,
  p_reply_to_id uuid DEFAULT NULL,
  p_related_message_ids uuid[] DEFAULT '{}'::uuid[],
  p_actor_mode text DEFAULT NULL,
  p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_conversation public.conversations%ROWTYPE;
  v_is_member boolean;
  v_is_support boolean;
  v_mode text;
  v_message_id uuid;
  v_display_name text;
  v_role text;
  v_brand_name text;
  v_related uuid[] := COALESCE(p_related_message_ids, '{}'::uuid[]);
  v_mentions uuid[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_content, ''))) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE = '22023';
  END IF;
  IF cardinality(COALESCE(p_mentioned_user_ids, '{}'::uuid[])) > 10 THEN
    RAISE EXCEPTION 'too_many_mentions' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(mention_id ORDER BY mention_id), '{}'::uuid[])
  INTO v_mentions
  FROM (
    SELECT DISTINCT mention_id
    FROM unnest(COALESCE(p_mentioned_user_ids, '{}'::uuid[])) AS mention_id
  ) unique_mentions;

  SELECT * INTO v_conversation
  FROM public.conversations
  WHERE id = p_conversation_id
    AND linked_entity_type = 'brand'
    AND is_enabled IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_brand_name
  FROM public.brands
  WHERE id = v_conversation.brand_id AND deleted_at IS NULL;
  IF v_brand_name IS NULL THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.brand_team_members member
    WHERE member.brand_id = v_conversation.brand_id
      AND member.user_id = v_actor
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  ) INTO v_is_member;
  v_is_support := public.is_support_staff(v_actor) OR public.is_admin_user();
  IF NOT v_is_member AND NOT v_is_support THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  v_mode := COALESCE(p_actor_mode, CASE WHEN v_is_member THEN 'brand' ELSE 'support' END);
  IF v_mode NOT IN ('brand', 'support')
     OR (v_mode = 'brand' AND NOT v_is_member)
     OR (v_mode = 'support' AND NOT v_is_support) THEN
    RAISE EXCEPTION 'invalid_actor_mode' USING ERRCODE = '42501';
  END IF;

  IF p_reply_to_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.messages
    WHERE id = p_reply_to_id
      AND conversation_id = p_conversation_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_reply' USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_related) > 20 OR EXISTS(
    SELECT 1 FROM unnest(v_related) related_id
    WHERE NOT EXISTS(
      SELECT 1 FROM public.messages message
      WHERE message.id = related_id
        AND message.conversation_id = p_conversation_id
        AND message.deleted_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'invalid_related_messages' USING ERRCODE = '22023';
  END IF;

  IF v_actor = ANY(v_mentions) OR EXISTS(
    SELECT 1 FROM unnest(v_mentions) mention_id
    WHERE NOT EXISTS(
      SELECT 1 FROM public.brand_team_members member
      WHERE member.brand_id = v_conversation.brand_id
        AND member.user_id = mention_id
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'invalid_mention' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    NULLIF(btrim(CASE WHEN v_mode = 'support' THEN staff.display_name END), ''),
    NULLIF(btrim(profile.display_name), ''),
    NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
    NULLIF(btrim(profile.username), ''),
    NULLIF(btrim(identity.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(identity.raw_user_meta_data->>'name'), ''),
    NULLIF(btrim(identity.raw_user_meta_data->>'display_name'), ''),
    'Mingla teammate'
  )
  INTO v_display_name
  FROM auth.users identity
  LEFT JOIN public.profiles profile ON profile.id = identity.id
  LEFT JOIN public.support_staff staff ON staff.user_id = identity.id
  WHERE identity.id = v_actor;
  v_display_name := COALESCE(v_display_name, 'Mingla teammate');
  v_role := CASE WHEN v_mode = 'support' THEN 'Mingla Support' ELSE NULL END;

  INSERT INTO public.messages(
    conversation_id, sender_id, content, message_type, reply_to_id,
    related_message_ids, mentions, sender_display_name_snapshot,
    sender_role_snapshot
  ) VALUES (
    p_conversation_id, v_actor, btrim(p_content), 'text', p_reply_to_id,
    v_related, to_jsonb(v_mentions), v_display_name, v_role
  ) RETURNING id INTO v_message_id;

  UPDATE public.conversations
  SET last_message_at = now(), updated_at = now()
  WHERE id = p_conversation_id;

  INSERT INTO public.brand_group_reads(conversation_id, user_id, last_read_at, updated_at)
  VALUES(p_conversation_id, v_actor, now(), now())
  ON CONFLICT(conversation_id, user_id) DO UPDATE
  SET last_read_at = now(), updated_at = now();

  INSERT INTO public.brand_group_audit_log(
    conversation_id, brand_id, actor_user_id, action, message_id, metadata
  ) VALUES (
    p_conversation_id, v_conversation.brand_id, v_actor, 'message_sent', v_message_id,
    jsonb_build_object(
      'actor_mode', v_mode,
      'reply_to_id', p_reply_to_id,
      'related_count', cardinality(v_related),
      'mention_count', cardinality(v_mentions)
    )
  );

  WITH roster AS (
    SELECT participant.user_id
    FROM public.conversation_participants participant
    JOIN public.brand_team_members member
      ON member.brand_id = v_conversation.brand_id
     AND member.user_id = participant.user_id
     AND member.accepted_at IS NOT NULL
     AND member.removed_at IS NULL
    WHERE participant.conversation_id = p_conversation_id
  ), enabled_support AS (
    SELECT staff.user_id
    FROM public.support_staff staff
    WHERE public.is_support_staff(staff.user_id)
  ), active_admins AS (
    SELECT identity.id AS user_id
    FROM public.admin_users admin_user
    JOIN auth.users identity ON lower(admin_user.email) = lower(identity.email)
    WHERE admin_user.status = 'active'
  ), reply_recipient AS (
    SELECT sender_id AS user_id
    FROM public.messages
    WHERE id = p_reply_to_id
  ), mentioned_recipients AS (
    SELECT mention_id AS user_id
    FROM unnest(v_mentions) mention_id
  ), candidates AS (
    SELECT user_id FROM roster
    UNION ALL SELECT user_id FROM enabled_support
    UNION ALL SELECT user_id FROM active_admins
    UNION ALL SELECT user_id FROM reply_recipient
    UNION ALL SELECT user_id FROM mentioned_recipients
  ), recipients AS (
    SELECT DISTINCT candidate.user_id
    FROM candidates candidate
    LEFT JOIN public.brand_group_reads reads
      ON reads.conversation_id = p_conversation_id
     AND reads.user_id = candidate.user_id
    WHERE candidate.user_id IS NOT NULL
      AND candidate.user_id IS DISTINCT FROM v_actor
      AND (
        COALESCE(reads.muted, false) IS NOT TRUE
        OR candidate.user_id = ANY(v_mentions)
      )
      AND public.issue_3720_brand_group_can_access(p_conversation_id, candidate.user_id)
  )
  INSERT INTO public.notification_outbox(
    category_key, user_id, brand_id, country_code, payload, idempotency_key, status
  )
  SELECT
    'business.brand_group_message',
    recipient.user_id,
    v_conversation.brand_id,
    NULL,
    jsonb_build_object(
      'message_id', v_message_id,
      'conversation_id', p_conversation_id,
      'brand_id', v_conversation.brand_id,
      'brand_name', v_brand_name,
      'sender_name', v_display_name,
      'body', left(btrim(p_content), 180),
      'mentioned', recipient.user_id = ANY(v_mentions),
      'deep_link', 'mingla-business://messages/' || p_conversation_id::text
    ),
    'business.brand_group_message:' || v_message_id::text || ':' || recipient.user_id::text,
    'pending'
  FROM recipients recipient
  ON CONFLICT(idempotency_key) DO NOTHING;

  RETURN v_message_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_send_brand_group_message(uuid, text, uuid, uuid[], text, uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_send_brand_group_message(uuid, text, uuid, uuid[], text, uuid[])
  TO authenticated, service_role;

COMMIT;
