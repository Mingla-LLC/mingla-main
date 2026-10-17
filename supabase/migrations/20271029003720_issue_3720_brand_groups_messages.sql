-- #3720 Completion Wave 2 — official Brand groups and unified Messages.
--
-- One conversation is derived from each active Brand. Active brand-team rows
-- are mirrored into the conversation roster; enabled Support staff and Admins
-- receive cross-brand access without being inserted into every Brand roster.
-- Brand-group sends are RPC-only so reply/quote validation, attribution,
-- unread state and durable notification fan-out cannot be skipped by a client.

BEGIN;

DO $guard$
DECLARE v_before text;
BEGIN
  SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure) INTO v_before;
  PERFORM set_config('issue_3720.is_admin_user_before', md5(v_before), true);
END;
$guard$;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sender_display_name_snapshot text,
  ADD COLUMN IF NOT EXISTS sender_role_snapshot text,
  ADD COLUMN IF NOT EXISTS related_message_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_linked_entity_type_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_linked_entity_type_check
  CHECK (linked_entity_type IN ('direct','session','trip','event','support','brand'));

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_linked_entity_coherent;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_linked_entity_coherent CHECK (
  (linked_entity_type = 'direct'  AND session_id IS NULL     AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'session' AND session_id IS NOT NULL AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'trip'    AND event_id   IS NOT NULL AND session_id IS NULL   AND brand_id IS NULL) OR
  (linked_entity_type = 'event'   AND event_id   IS NOT NULL AND session_id IS NULL   AND brand_id IS NULL) OR
  (linked_entity_type = 'support' AND session_id IS NULL     AND event_id IS NULL     AND brand_id IS NULL) OR
  (linked_entity_type = 'brand'   AND brand_id   IS NOT NULL AND session_id IS NULL   AND event_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_official_brand_group
  ON public.conversations(brand_id)
  WHERE linked_entity_type = 'brand' AND brand_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.brand_group_reads (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT 'epoch'::timestamptz,
  push_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS brand_group_reads_user_idx
  ON public.brand_group_reads(user_id, updated_at DESC);

-- Messages are already in the realtime publication. Add the per-user read /
-- watch state as well so unread badges and notification preferences converge
-- across a person's signed-in devices without polling.
DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'brand_group_reads'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.brand_group_reads;
  END IF;
END;
$realtime$;

CREATE TABLE IF NOT EXISTS public.brand_group_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brand_group_audit_log_brand_idx
  ON public.brand_group_audit_log(brand_id, created_at DESC);

ALTER TABLE public.brand_group_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_group_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_group_reads, public.brand_group_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.brand_group_reads TO authenticated;
GRANT ALL ON public.brand_group_reads, public.brand_group_audit_log TO service_role;

DROP POLICY IF EXISTS brand_group_reads_self ON public.brand_group_reads;
CREATE POLICY brand_group_reads_self ON public.brand_group_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS brand_group_audit_operator_read ON public.brand_group_audit_log;
CREATE POLICY brand_group_audit_operator_read ON public.brand_group_audit_log
  FOR SELECT TO authenticated
  USING (public.is_support_staff(auth.uid()) OR public.is_admin_user());
GRANT SELECT ON public.brand_group_audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_3720_brand_group_can_access(
  p_conversation_id uuid,
  p_user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.brands b ON b.id = c.brand_id AND b.deleted_at IS NULL
    WHERE c.id = p_conversation_id
      AND c.linked_entity_type = 'brand'
      AND c.is_enabled IS TRUE
      AND (
        public.is_support_staff(p_user_id)
        OR EXISTS (
          SELECT 1
          FROM auth.users admin_identity
          JOIN public.admin_users admin_user
            ON lower(admin_user.email) = lower(admin_identity.email)
          WHERE admin_identity.id = p_user_id
            AND admin_user.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM public.brand_team_members member
          WHERE member.brand_id = c.brand_id
            AND member.user_id = p_user_id
            AND member.accepted_at IS NOT NULL
            AND member.removed_at IS NULL
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_brand_group_can_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_brand_group_can_access(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_ensure_official_brand_group(p_brand_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_brand public.brands%ROWTYPE; v_conversation_id uuid;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.conversations(
    type, linked_entity_type, brand_id, name, created_by, is_enabled, is_broadcast_only
  ) VALUES (
    'group', 'brand', v_brand.id, v_brand.name || ' · Brand group',
    v_brand.account_id, v_brand.deleted_at IS NULL, false
  )
  ON CONFLICT (brand_id) WHERE linked_entity_type = 'brand' AND brand_id IS NOT NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now()
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  SELECT v_conversation_id, member.user_id
  FROM public.brand_team_members member
  WHERE member.brand_id = p_brand_id
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  DELETE FROM public.conversation_participants participant
  WHERE participant.conversation_id = v_conversation_id
    AND NOT EXISTS (
      SELECT 1 FROM public.brand_team_members member
      WHERE member.brand_id = p_brand_id
        AND member.user_id = participant.user_id
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    );

  RETURN v_conversation_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_ensure_official_brand_group(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_ensure_official_brand_group(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_sync_brand_group_from_brand()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.issue_3720_ensure_official_brand_group(NEW.id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_sync_brand_group_from_brand() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3720_sync_brand_group_from_brand ON public.brands;
CREATE TRIGGER issue_3720_sync_brand_group_from_brand
AFTER INSERT OR UPDATE OF name, deleted_at ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_3720_sync_brand_group_from_brand();

CREATE OR REPLACE FUNCTION public.issue_3720_sync_brand_group_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.issue_3720_ensure_official_brand_group(OLD.brand_id);
    RETURN OLD;
  END IF;
  PERFORM public.issue_3720_ensure_official_brand_group(NEW.brand_id);
  IF TG_OP = 'UPDATE' AND OLD.brand_id IS DISTINCT FROM NEW.brand_id THEN
    PERFORM public.issue_3720_ensure_official_brand_group(OLD.brand_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_sync_brand_group_member() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_3720_sync_brand_group_member ON public.brand_team_members;
CREATE TRIGGER issue_3720_sync_brand_group_member
AFTER INSERT OR UPDATE OF accepted_at, removed_at, user_id, brand_id OR DELETE
ON public.brand_team_members
FOR EACH ROW EXECUTE FUNCTION public.issue_3720_sync_brand_group_member();

SELECT public.issue_3720_ensure_official_brand_group(id)
FROM public.brands;

DROP POLICY IF EXISTS conversations_brand_group_read ON public.conversations;
CREATE POLICY conversations_brand_group_read ON public.conversations
  FOR SELECT TO authenticated
  USING (
    linked_entity_type = 'brand'
    AND public.issue_3720_brand_group_can_access(id, auth.uid())
  );

DROP POLICY IF EXISTS messages_brand_group_read ON public.messages;
CREATE POLICY messages_brand_group_read ON public.messages
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.issue_3720_brand_group_can_access(conversation_id, auth.uid())
  );

-- Brand-group writes must pass through the guarded RPC below. Existing direct,
-- session, event, trip and support paths remain unchanged.
DROP POLICY IF EXISTS messages_brand_group_rpc_only ON public.messages;
CREATE POLICY messages_brand_group_rpc_only ON public.messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.linked_entity_type = 'brand'
  ));

DROP POLICY IF EXISTS conversation_participants_brand_group_read ON public.conversation_participants;
CREATE POLICY conversation_participants_brand_group_read ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (public.issue_3720_brand_group_can_access(conversation_id, auth.uid()));

INSERT INTO public.notification_categories(
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES (
  'business.brand_group_message', 'support', true, 'normal',
  ARRAY['inapp','push']::text[], 'reach_once', true
)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

CREATE OR REPLACE FUNCTION public.issue_3720_list_brand_groups()
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
  push_enabled boolean
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
    COALESCE(read_state.push_enabled, false)
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
    last_message.content,read_state.push_enabled,caller.user_id,caller.is_support
  ORDER BY c.last_message_at DESC NULLS LAST, lower(b.name), b.id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_list_brand_group_messages(
  p_conversation_id uuid,
  p_limit integer DEFAULT 80,
  p_before timestamptz DEFAULT NULL
) RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  content text,
  created_at timestamptz,
  reply_to_id uuid,
  related_message_ids uuid[],
  sender_display_name text,
  sender_role text,
  reply_content text,
  reply_sender_display_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.issue_3720_brand_group_can_access(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT m.id,m.conversation_id,m.sender_id,m.content,m.created_at,m.reply_to_id,
    m.related_message_ids,
    COALESCE(NULLIF(btrim(m.sender_display_name_snapshot),''),
      NULLIF(btrim(p.display_name),''),
      NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''),
      NULLIF(btrim(p.username),''),'Mingla member'),
    NULLIF(btrim(m.sender_role_snapshot),''),
    reply.content,
    COALESCE(NULLIF(btrim(reply.sender_display_name_snapshot),''),
      NULLIF(btrim(reply_profile.display_name),''),
      NULLIF(btrim(concat_ws(' ',reply_profile.first_name,reply_profile.last_name)),''),
      NULLIF(btrim(reply_profile.username),''),'Mingla member')
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id=m.sender_id
  LEFT JOIN public.messages reply ON reply.id=m.reply_to_id AND reply.conversation_id=m.conversation_id
  LEFT JOIN public.profiles reply_profile ON reply_profile.id=reply.sender_id
  WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
    AND (p_before IS NULL OR m.created_at<p_before)
  ORDER BY m.created_at DESC,m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,80),1),200);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_mark_brand_group_read(p_conversation_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_now timestamptz:=now();
BEGIN
  IF NOT public.issue_3720_brand_group_can_access(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.brand_group_reads(conversation_id,user_id,last_read_at,updated_at)
  VALUES(p_conversation_id,auth.uid(),v_now,v_now)
  ON CONFLICT(conversation_id,user_id) DO UPDATE
  SET last_read_at=EXCLUDED.last_read_at,updated_at=EXCLUDED.updated_at;
  RETURN v_now;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3720_set_brand_group_watch(
  p_conversation_id uuid,p_enabled boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.issue_3720_brand_group_can_access(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.brand_group_reads(conversation_id,user_id,push_enabled,updated_at)
  VALUES(p_conversation_id,auth.uid(),p_enabled,now())
  ON CONFLICT(conversation_id,user_id) DO UPDATE
  SET push_enabled=EXCLUDED.push_enabled,updated_at=EXCLUDED.updated_at;
  RETURN p_enabled;
END;
$function$;

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

  WITH reply_recipient AS (
    SELECT sender_id user_id FROM public.messages WHERE id=p_reply_to_id AND sender_id IS DISTINCT FROM v_actor
  ), watched AS (
    SELECT reads.user_id FROM public.brand_group_reads reads
    WHERE reads.conversation_id=p_conversation_id AND reads.push_enabled IS TRUE
      AND reads.user_id<>v_actor
  ), recipients AS (
    SELECT user_id FROM reply_recipient UNION SELECT user_id FROM watched
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
  WHERE public.issue_3720_brand_group_can_access(p_conversation_id,recipient.user_id)
  ON CONFLICT(idempotency_key) DO NOTHING;

  RETURN v_message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3720_list_brand_groups() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_3720_mark_brand_group_read(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_3720_set_brand_group_watch(uuid,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_3720_send_brand_group_message(uuid,text,uuid,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_groups() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_group_messages(uuid,integer,timestamptz) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_mark_brand_group_read(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_set_brand_group_watch(uuid,boolean) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_send_brand_group_message(uuid,text,uuid,uuid[],text) TO authenticated,service_role;

ALTER TABLE public.support_product_signal_sources
  DROP CONSTRAINT IF EXISTS support_product_signal_sources_source_kind_check;
ALTER TABLE public.support_product_signal_sources
  ADD CONSTRAINT support_product_signal_sources_source_kind_check
  CHECK (source_kind IN ('support_ticket','internal_thread','brand_group_message'));

CREATE OR REPLACE FUNCTION public.issue_3720_create_brand_message_product_signal(
  p_client_request_id uuid,p_source_id uuid,p_signal_kind text,p_title text,
  p_problem_statement text,p_product_area text,p_user_journey text,
  p_impact_summary text,p_affected_people integer,p_priority text,
  p_next_update_at timestamptz,p_next_step text,p_customer_reply_draft text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_actor uuid:=auth.uid();v_existing uuid;v_id uuid;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE m.id=p_source_id AND m.deleted_at IS NULL AND c.linked_entity_type='brand') THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE='P0002';
  END IF;
  SELECT id INTO v_existing FROM public.support_product_signals
    WHERE created_by=v_actor AND client_request_id=p_client_request_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF EXISTS(SELECT 1 FROM public.support_product_signal_sources
    WHERE source_kind='brand_group_message' AND source_id=p_source_id) THEN
    RAISE EXCEPTION 'source_already_linked' USING ERRCODE='23505';
  END IF;
  IF p_signal_kind NOT IN ('question','account','bug','feature','trust_safety')
    OR p_priority NOT IN ('low','normal','high','urgent')
    OR p_affected_people IS NULL OR p_affected_people<1
    OR p_next_update_at IS NULL OR p_next_update_at<=now()+interval '14 minutes'
    OR btrim(COALESCE(p_title,''))='' OR btrim(COALESCE(p_problem_statement,''))=''
    OR btrim(COALESCE(p_product_area,''))='' OR btrim(COALESCE(p_user_journey,''))=''
    OR btrim(COALESCE(p_impact_summary,''))='' OR btrim(COALESCE(p_next_step,''))=''
    OR btrim(COALESCE(p_customer_reply_draft,''))='' THEN
    RAISE EXCEPTION 'signal_fields_required' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.support_product_signals(
    client_request_id,signal_kind,title,problem_statement,product_area,user_journey,
    impact_summary,affected_people,priority,owner_user_id,next_update_at,next_step,
    customer_reply_draft,created_by
  ) VALUES(
    p_client_request_id,p_signal_kind,left(btrim(p_title),200),left(btrim(p_problem_statement),8000),
    left(btrim(p_product_area),120),left(btrim(p_user_journey),1000),left(btrim(p_impact_summary),1000),
    p_affected_people,p_priority,v_actor,p_next_update_at,left(btrim(p_next_step),1000),
    left(btrim(p_customer_reply_draft),4000),v_actor
  ) RETURNING id INTO v_id;
  INSERT INTO public.support_product_signal_sources(signal_id,source_kind,source_id,linked_by)
  VALUES(v_id,'brand_group_message',p_source_id,v_actor);
  INSERT INTO public.support_product_workflow_audit(actor_user_id,action,entity_kind,entity_id,after_snapshot)
  VALUES(v_actor,'product_signal_created','product_signal',v_id,
    jsonb_build_object('signal_kind',p_signal_kind,'priority',p_priority,
      'source_kind','brand_group_message','next_update_at',p_next_update_at));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_create_brand_message_product_signal(uuid,uuid,text,text,text,text,text,text,integer,text,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_create_brand_message_product_signal(uuid,uuid,text,text,text,text,text,text,integer,text,timestamptz,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_link_brand_message_product_signal(
  p_signal_id uuid,
  p_expected_revision integer,
  p_source_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_actor uuid:=auth.uid();v_revision integer;
BEGIN
  PERFORM public.issue_3720_support_operator_required();
  IF NOT EXISTS(
    SELECT 1
    FROM public.messages message
    JOIN public.conversations conversation ON conversation.id=message.conversation_id
    WHERE message.id=p_source_id
      AND message.deleted_at IS NULL
      AND conversation.linked_entity_type='brand'
      AND public.issue_3720_brand_group_can_access(conversation.id,v_actor)
  ) THEN
    RAISE EXCEPTION 'source_not_found' USING ERRCODE='P0002';
  END IF;

  UPDATE public.support_product_signals
  SET affected_people=affected_people+1,updated_at=now(),revision=revision+1
  WHERE id=p_signal_id AND revision=p_expected_revision
  RETURNING revision INTO v_revision;
  IF v_revision IS NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.support_product_signals WHERE id=p_signal_id) THEN
      RAISE EXCEPTION 'signal_not_found' USING ERRCODE='P0002';
    END IF;
    RAISE EXCEPTION 'stale_revision' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.support_product_signal_sources(signal_id,source_kind,source_id,linked_by)
  VALUES(p_signal_id,'brand_group_message',p_source_id,v_actor);
  INSERT INTO public.support_product_workflow_audit(
    actor_user_id,action,entity_kind,entity_id,after_snapshot
  ) VALUES(
    v_actor,'product_signal_source_linked','product_signal',p_signal_id,
    jsonb_build_object('source_kind','brand_group_message','source_id',p_source_id,'revision',v_revision)
  );
  RETURN v_revision;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_link_brand_message_product_signal(uuid,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_link_brand_message_product_signal(uuid,integer,uuid) TO authenticated,service_role;

DO $guard$
DECLARE v_after text;v_before_md5 text:=current_setting('issue_3720.is_admin_user_before',true);
BEGIN
  SELECT pg_get_functiondef('public.is_admin_user()'::regprocedure) INTO v_after;
  IF v_before_md5 IS NULL OR md5(v_after)<>v_before_md5 THEN
    RAISE EXCEPTION 'is_admin_user_changed';
  END IF;
END;
$guard$;

COMMIT;
