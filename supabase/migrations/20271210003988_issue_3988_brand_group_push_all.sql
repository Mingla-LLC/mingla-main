-- #3988 — every official Brand-group message pushes to every eligible
-- participant, with per-thread mute and the existing global channel gate.

BEGIN;

ALTER TABLE public.brand_group_reads
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brand_group_reads.push_enabled IS
  '[TRANSITIONAL #3988] Retained for pre-OTA clients and issue_3720_set_brand_group_watch; Brand-group recipient fan-out no longer reads it.';

CREATE OR REPLACE FUNCTION public.issue_3988_set_brand_group_muted(
  p_conversation_id uuid,
  p_muted boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_brand_id uuid;
BEGIN
  IF NOT public.issue_3720_brand_group_can_access(p_conversation_id, v_actor) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT conversation.brand_id INTO STRICT v_brand_id
  FROM public.conversations conversation
  WHERE conversation.id = p_conversation_id;

  INSERT INTO public.brand_group_reads(
    conversation_id, user_id, last_read_at, muted, updated_at
  ) VALUES (
    p_conversation_id, v_actor, 'epoch'::timestamptz, p_muted, now()
  )
  ON CONFLICT(conversation_id, user_id) DO UPDATE
  SET muted = EXCLUDED.muted,
      updated_at = EXCLUDED.updated_at;

  INSERT INTO public.brand_group_audit_log(
    conversation_id, brand_id, actor_user_id, action, metadata
  ) VALUES (
    p_conversation_id,
    v_brand_id,
    v_actor,
    CASE WHEN p_muted THEN 'muted' ELSE 'unmuted' END,
    jsonb_build_object('muted', p_muted)
  );

  RETURN p_muted;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_set_brand_group_muted(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_set_brand_group_muted(uuid, boolean)
  TO authenticated, service_role;

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

-- MINGLA-INVARIANT: I-3988-BRAND-GROUP-PUSH-ALL-PARTICIPANTS | issue #3988 | Every access-holding Brand-group participant except the sender and muted users gets exactly one durable outbox row per message; notification_channel_prefs remains the single global channel gate.
CREATE OR REPLACE FUNCTION public.issue_3720_send_brand_group_message(
  p_conversation_id uuid,
  p_content text,
  p_reply_to_id uuid DEFAULT NULL,
  p_related_message_ids uuid[] DEFAULT '{}'::uuid[],
  p_actor_mode text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_conversation public.conversations%ROWTYPE;
  v_is_member boolean; v_is_support boolean; v_mode text; v_message_id uuid;
  v_display_name text; v_role text; v_brand_name text;
  v_related uuid[]:=COALESCE(p_related_message_ids,'{}'::uuid[]);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF char_length(btrim(COALESCE(p_content,''))) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'invalid_message' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_conversation FROM public.conversations
  WHERE id=p_conversation_id AND linked_entity_type='brand' AND is_enabled IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501'; END IF;
  SELECT name INTO v_brand_name FROM public.brands
  WHERE id=v_conversation.brand_id AND deleted_at IS NULL;
  IF v_brand_name IS NULL THEN RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.brand_team_members member
    WHERE member.brand_id=v_conversation.brand_id AND member.user_id=v_actor
      AND member.accepted_at IS NOT NULL AND member.removed_at IS NULL) INTO v_is_member;
  v_is_support:=public.is_support_staff(v_actor) OR public.is_admin_user();
  IF NOT v_is_member AND NOT v_is_support THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  v_mode:=COALESCE(p_actor_mode,CASE WHEN v_is_member THEN 'brand' ELSE 'support' END);
  IF v_mode NOT IN ('brand','support') OR (v_mode='brand' AND NOT v_is_member)
     OR (v_mode='support' AND NOT v_is_support) THEN
    RAISE EXCEPTION 'invalid_actor_mode' USING ERRCODE='42501';
  END IF;
  IF p_reply_to_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.messages
    WHERE id=p_reply_to_id AND conversation_id=p_conversation_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_reply' USING ERRCODE='22023';
  END IF;
  IF cardinality(v_related)>20 OR EXISTS(
    SELECT 1 FROM unnest(v_related) related_id
    WHERE NOT EXISTS(SELECT 1 FROM public.messages m
      WHERE m.id=related_id AND m.conversation_id=p_conversation_id AND m.deleted_at IS NULL)
  ) THEN RAISE EXCEPTION 'invalid_related_messages' USING ERRCODE='22023'; END IF;

  SELECT COALESCE(NULLIF(btrim(CASE WHEN v_mode='support' THEN staff.display_name END),''),
      NULLIF(btrim(profile.display_name),''),
      NULLIF(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),
      NULLIF(btrim(profile.username),''),
      NULLIF(btrim(identity.raw_user_meta_data->>'full_name'),''),
      NULLIF(btrim(identity.raw_user_meta_data->>'name'),''),
      NULLIF(btrim(identity.raw_user_meta_data->>'display_name'),''),
      'Mingla teammate')
  INTO v_display_name
  FROM auth.users identity
  LEFT JOIN public.profiles profile ON profile.id=identity.id
  LEFT JOIN public.support_staff staff ON staff.user_id=identity.id
  WHERE identity.id=v_actor;
  v_display_name:=COALESCE(v_display_name,'Mingla teammate');
  v_role:=CASE WHEN v_mode='support' THEN 'Mingla Support' ELSE NULL END;

  INSERT INTO public.messages(
    conversation_id,sender_id,content,message_type,reply_to_id,related_message_ids,
    sender_display_name_snapshot,sender_role_snapshot
  ) VALUES(
    p_conversation_id,v_actor,btrim(p_content),'text',p_reply_to_id,v_related,
    v_display_name,v_role
  ) RETURNING id INTO v_message_id;
  UPDATE public.conversations SET last_message_at=now(),updated_at=now() WHERE id=p_conversation_id;

  INSERT INTO public.brand_group_reads(conversation_id,user_id,last_read_at,updated_at)
  VALUES(p_conversation_id,v_actor,now(),now())
  ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_at=now(),updated_at=now();

  INSERT INTO public.brand_group_audit_log(
    conversation_id,brand_id,actor_user_id,action,message_id,metadata
  ) VALUES(
    p_conversation_id,v_conversation.brand_id,v_actor,'message_sent',v_message_id,
    jsonb_build_object('actor_mode',v_mode,'reply_to_id',p_reply_to_id,'related_count',cardinality(v_related))
  );

  WITH roster AS (
    SELECT participant.user_id
    FROM public.conversation_participants participant
    JOIN public.brand_team_members member
      ON member.brand_id=v_conversation.brand_id
     AND member.user_id=participant.user_id
     AND member.accepted_at IS NOT NULL
     AND member.removed_at IS NULL
    WHERE participant.conversation_id=p_conversation_id
  ), enabled_support AS (
    SELECT staff.user_id
    FROM public.support_staff staff
    WHERE public.is_support_staff(staff.user_id)
  ), active_admins AS (
    SELECT identity.id AS user_id
    FROM public.admin_users admin_user
    JOIN auth.users identity ON lower(admin_user.email)=lower(identity.email)
    WHERE admin_user.status='active'
  ), reply_recipient AS (
    SELECT sender_id AS user_id
    FROM public.messages
    WHERE id=p_reply_to_id
  ), candidates AS (
    SELECT user_id FROM roster
    UNION ALL SELECT user_id FROM enabled_support
    UNION ALL SELECT user_id FROM active_admins
    UNION ALL SELECT user_id FROM reply_recipient
  ), recipients AS (
    SELECT DISTINCT candidate.user_id
    FROM candidates candidate
    LEFT JOIN public.brand_group_reads reads
      ON reads.conversation_id=p_conversation_id
     AND reads.user_id=candidate.user_id
    WHERE candidate.user_id IS NOT NULL
      AND candidate.user_id IS DISTINCT FROM v_actor
      AND COALESCE(reads.muted,false) IS NOT TRUE
      AND public.issue_3720_brand_group_can_access(p_conversation_id,candidate.user_id)
  )
  INSERT INTO public.notification_outbox(
    category_key,user_id,brand_id,country_code,payload,idempotency_key,status
  )
  SELECT 'business.brand_group_message',recipient.user_id,v_conversation.brand_id,NULL,
    jsonb_build_object(
      'message_id',v_message_id,'conversation_id',p_conversation_id,
      'brand_id',v_conversation.brand_id,'brand_name',v_brand_name,
      'sender_name',v_display_name,'body',left(btrim(p_content),180),
      'deep_link','mingla-business://messages/'||p_conversation_id::text
    ),
    'business.brand_group_message:'||v_message_id::text||':'||recipient.user_id::text,'pending'
  FROM recipients recipient
  ON CONFLICT(idempotency_key) DO NOTHING;

  RETURN v_message_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_send_brand_group_message(uuid,text,uuid,uuid[],text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_send_brand_group_message(uuid,text,uuid,uuid[],text)
  TO authenticated, service_role;

-- MINGLA-INVARIANT: I-3988-BRAND-GROUP-PUSH-ALL-PARTICIPANTS | issue #3988 | File messages use the same distinct, access-checked, sender-excluded and mute-aware Brand-group fan-out as text messages.
CREATE OR REPLACE FUNCTION public.issue_3720_complete_brand_group_file(
  p_file_id uuid,p_provider_file_id text,p_verified_mime text,p_verified_size bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_file public.brand_group_files%ROWTYPE;v_message_id uuid;v_display_name text;v_role text;
  v_message_type text;v_brand_name text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_file FROM public.brand_group_files WHERE id=p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'file_unavailable' USING ERRCODE='P0002'; END IF;
  IF v_file.state='ready' AND v_file.message_id IS NOT NULL THEN RETURN v_file.message_id; END IF;
  IF NOT public.issue_3720_brand_group_can_access(v_file.conversation_id,v_file.uploader_user_id) THEN
    RAISE EXCEPTION 'file_access_removed' USING ERRCODE='42501';
  END IF;
  IF btrim(COALESCE(p_provider_file_id,''))='' OR p_verified_size<>v_file.declared_size_bytes THEN
    RAISE EXCEPTION 'provider_verification_failed' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(CASE WHEN v_file.actor_mode='support' THEN staff.display_name END),''),
    NULLIF(btrim(profile.display_name),''),NULLIF(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),
    NULLIF(btrim(profile.username),''),NULLIF(btrim(identity.raw_user_meta_data->>'full_name'),''),
    NULLIF(btrim(identity.raw_user_meta_data->>'name'),''),'Mingla teammate')
  INTO v_display_name
  FROM auth.users identity
  LEFT JOIN public.profiles profile ON profile.id=identity.id
  LEFT JOIN public.support_staff staff ON staff.user_id=identity.id
  WHERE identity.id=v_file.uploader_user_id;
  v_display_name:=COALESCE(v_display_name,'Mingla teammate');
  v_role:=CASE WHEN v_file.actor_mode='support' THEN 'Mingla Support' ELSE NULL END;
  v_message_type:=CASE
    WHEN p_verified_mime LIKE 'image/%' THEN 'image'
    WHEN p_verified_mime LIKE 'video/%' THEN 'video'
    ELSE 'file'
  END;

  INSERT INTO public.messages(
    conversation_id,sender_id,content,message_type,file_url,file_name,file_size,
    sender_display_name_snapshot,sender_role_snapshot
  ) VALUES(
    v_file.conversation_id,v_file.uploader_user_id,v_file.original_filename,v_message_type,
    NULL,v_file.original_filename,p_verified_size,v_display_name,v_role
  ) RETURNING id INTO v_message_id;

  UPDATE public.brand_group_files SET provider_file_id=p_provider_file_id,
    verified_mime=lower(split_part(p_verified_mime,';',1)),verified_size_bytes=p_verified_size,
    message_id=v_message_id,state='ready',lease_expires_at=NULL,last_error_code=NULL,
    completed_at=now(),updated_at=now()
  WHERE id=p_file_id;
  UPDATE public.conversations SET last_message_at=now(),updated_at=now() WHERE id=v_file.conversation_id;
  SELECT name INTO v_brand_name FROM public.brands WHERE id=v_file.brand_id;

  INSERT INTO public.brand_group_audit_log(conversation_id,brand_id,actor_user_id,action,message_id,metadata)
  VALUES(v_file.conversation_id,v_file.brand_id,v_file.uploader_user_id,'file_shared',v_message_id,
    jsonb_build_object('file_id',p_file_id,'actor_mode',v_file.actor_mode,'mime_type',p_verified_mime,'size_bytes',p_verified_size));

  WITH roster AS (
    SELECT participant.user_id
    FROM public.conversation_participants participant
    JOIN public.brand_team_members member
      ON member.brand_id=v_file.brand_id
     AND member.user_id=participant.user_id
     AND member.accepted_at IS NOT NULL
     AND member.removed_at IS NULL
    WHERE participant.conversation_id=v_file.conversation_id
  ), enabled_support AS (
    SELECT staff.user_id
    FROM public.support_staff staff
    WHERE public.is_support_staff(staff.user_id)
  ), active_admins AS (
    SELECT identity.id AS user_id
    FROM public.admin_users admin_user
    JOIN auth.users identity ON lower(admin_user.email)=lower(identity.email)
    WHERE admin_user.status='active'
  ), candidates AS (
    SELECT user_id FROM roster
    UNION ALL SELECT user_id FROM enabled_support
    UNION ALL SELECT user_id FROM active_admins
  ), recipients AS (
    SELECT DISTINCT candidate.user_id
    FROM candidates candidate
    LEFT JOIN public.brand_group_reads reads
      ON reads.conversation_id=v_file.conversation_id
     AND reads.user_id=candidate.user_id
    WHERE candidate.user_id IS NOT NULL
      AND candidate.user_id IS DISTINCT FROM v_file.uploader_user_id
      AND COALESCE(reads.muted,false) IS NOT TRUE
      AND public.issue_3720_brand_group_can_access(v_file.conversation_id,candidate.user_id)
  )
  INSERT INTO public.notification_outbox(category_key,user_id,brand_id,country_code,payload,idempotency_key,status)
  SELECT 'business.brand_group_message',recipient.user_id,v_file.brand_id,NULL,
    jsonb_build_object('message_id',v_message_id,'conversation_id',v_file.conversation_id,
      'brand_id',v_file.brand_id,'brand_name',v_brand_name,'sender_name',v_display_name,
      'body','Shared a file: '||v_file.original_filename,'deep_link','mingla-business://messages/'||v_file.conversation_id::text),
    'business.brand_group_message:'||v_message_id::text||':'||recipient.user_id::text,'pending'
  FROM recipients recipient
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN v_message_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_complete_brand_group_file(uuid,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_complete_brand_group_file(uuid,text,text,bigint)
  TO service_role;

COMMIT;
