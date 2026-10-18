-- Issue #3720 Completion Wave 6 — team collaboration and role-complete access.
--
-- All active Mingla Admin teammates may work Support, receive in-app mentions,
-- and explicitly opt in to mention email. Owner/Admin/Partner may enter the
-- private Data room through the broker Edge Function; only Owner/Admin may
-- inspect its content-free access ledger. No role gains admin_console,
-- team_manage, money, publish, promotion, or send authority here.

BEGIN;
SET LOCAL lock_timeout = '10s';

SELECT set_config(
  'issue3720_wave6.is_admin_user_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure),
  true
);
SELECT set_config(
  'issue3720_wave6.role_areas_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_role_areas(text)'::regprocedure),
  true
);
SELECT set_config(
  'issue3720_wave6.my_access_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_access()'::regprocedure),
  true
);

-- I-3720-TEAM-ACTIVE-IDENTITY: collaboration privileges are derived from an
-- active named team record matched to the signed-in auth identity. This helper
-- never turns a Growth/Partner teammate into a full admin.
CREATE OR REPLACE FUNCTION public.issue_3720_active_team_member(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM auth.users identity
    WHERE identity.id = p_user_id
      AND btrim(COALESCE(identity.email, '')) <> ''
      AND (
        EXISTS (
          SELECT 1 FROM public.admin_users full_member
          WHERE lower(btrim(full_member.email)) = lower(btrim(identity.email))
            AND full_member.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM public.admin_team_members scoped_member
          WHERE scoped_member.email = lower(btrim(identity.email))
            AND scoped_member.status = 'active'
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_active_team_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_active_team_member(uuid) TO service_role;

-- I-3720-SUPPORT-ALL-ACTIVE-ROLES: Support's existing RLS and Edge gates all
-- converge on is_support_staff(). Widen that one authority to every active
-- named teammate while preserving the explicit support_staff roster.
CREATE OR REPLACE FUNCTION public.is_support_staff(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.support_staff staff
      WHERE staff.user_id = p_user_id AND staff.enabled = true
    )
    OR public.issue_3720_active_team_member(p_user_id)
  );
$function$;
REVOKE ALL ON FUNCTION public.is_support_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_support_staff(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_team_my_operational_areas()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_areas text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN v_areas; END IF;
  v_role := public.admin_team_role();
  IF v_role IS NULL THEN RETURN v_areas; END IF;

  -- Every active role can work Support and see its own team notifications.
  v_areas := ARRAY[
    'community_support',
    'community_support_support',
    'team_notifications'
  ];

  IF v_role IN ('owner', 'admin') OR EXISTS (
    SELECT 1 FROM public.community_staff staff
    WHERE staff.user_id = auth.uid() AND staff.enabled = true
  ) THEN
    v_areas := array_append(v_areas, 'community_support_community');
  END IF;

  IF v_role IN ('owner', 'admin', 'partner') THEN
    v_areas := array_append(v_areas, 'data_room');
  END IF;

  RETURN v_areas;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_team_my_operational_areas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_my_operational_areas() TO authenticated, service_role;

INSERT INTO public.notification_categories(
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES (
  'admin.team_mention', 'team', true, 'normal',
  ARRAY['inapp', 'email']::text[], 'reach_once', true
)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

-- I-3720-MENTION-EMAIL-OPT-IN: in-app mention delivery is transactional and
-- default-on, but email for the same event requires an explicit true preference.
-- All other category/channel semantics stay byte-for-byte equivalent in intent.
CREATE OR REPLACE FUNCTION public.can_send(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cat public.notification_categories%ROWTYPE;
  v_pref_enabled boolean;
  v_category_scope text;
  v_suppressed boolean;
BEGIN
  SELECT * INTO v_cat FROM public.notification_categories WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN RETURN false; END IF;
  IF NOT (p_channel = ANY(v_cat.default_channels)) THEN RETURN false; END IF;

  v_pref_enabled := NULL;
  IF p_user_id IS NOT NULL THEN
    SELECT enabled INTO v_pref_enabled
    FROM public.notification_channel_prefs
    WHERE user_id = p_user_id
      AND category_key = p_category_key
      AND channel = p_channel;
  END IF;

  IF p_category_key = 'admin.team_mention' AND p_channel = 'email' THEN
    IF v_pref_enabled IS DISTINCT FROM true THEN RETURN false; END IF;
  ELSIF v_cat.is_transactional THEN
    IF v_pref_enabled IS NOT NULL AND v_pref_enabled = false THEN RETURN false; END IF;
  ELSE
    IF v_pref_enabled IS DISTINCT FROM true THEN RETURN false; END IF;
  END IF;

  IF p_channel IN ('email', 'sms') THEN
    v_category_scope := CASE WHEN v_cat.is_transactional THEN 'transactional' ELSE 'marketing' END;
    SELECT EXISTS (
      SELECT 1 FROM public.channel_suppressions suppression
      WHERE suppression.channel = p_channel
        AND suppression.scope IN (v_category_scope, 'all')
        AND (
          (p_user_id IS NOT NULL AND suppression.user_id = p_user_id)
          OR (p_contact IS NOT NULL AND suppression.contact = lower(p_contact))
          OR (p_contact IS NOT NULL AND suppression.contact = p_contact)
        )
    ) INTO v_suppressed;
    IF v_suppressed THEN RETURN false; END IF;
  END IF;

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.can_send(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send(uuid, text, text, text) TO authenticated, service_role;

-- Keep the shared #3720 dispatcher diagnostic truthful for the new opt-in
-- category. This code is bounded and never returns an address or message body.
CREATE OR REPLACE FUNCTION public.issue_3720_notification_denial_reason(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat public.notification_categories%ROWTYPE;
  v_suppression_reason text;
BEGIN
  IF p_category_key NOT IN (
    'business.community_announcement',
    'business.community_roadmap_updated',
    'business.support_new_ticket',
    'business.brand_group_message',
    'admin.team_mention'
  ) THEN
    RETURN 'policy_denied';
  END IF;

  SELECT * INTO v_cat
  FROM public.notification_categories
  WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN RETURN 'category_inactive'; END IF;
  IF NOT (p_channel = ANY(v_cat.default_channels)) THEN RETURN 'channel_inactive'; END IF;

  IF p_category_key = 'admin.team_mention' AND p_channel = 'email'
     AND NOT EXISTS (
       SELECT 1 FROM public.notification_channel_prefs pref
       WHERE pref.user_id = p_user_id
         AND pref.category_key = p_category_key
         AND pref.channel = p_channel
         AND pref.enabled = true
     ) THEN
    RETURN 'preference_off';
  END IF;
  IF p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notification_channel_prefs pref
    WHERE pref.user_id = p_user_id
      AND pref.category_key = p_category_key
      AND pref.channel = p_channel
      AND pref.enabled = false
  ) THEN
    RETURN 'preference_off';
  END IF;

  IF p_channel IN ('email', 'sms') THEN
    SELECT suppression.reason INTO v_suppression_reason
    FROM public.channel_suppressions suppression
    WHERE suppression.channel = p_channel
      AND suppression.scope IN (
        CASE WHEN v_cat.is_transactional THEN 'transactional' ELSE 'marketing' END,
        'all'
      )
      AND (
        (p_user_id IS NOT NULL AND suppression.user_id = p_user_id)
        OR (p_contact IS NOT NULL AND lower(suppression.contact) = lower(p_contact))
      )
    ORDER BY CASE suppression.reason
      WHEN 'complaint' THEN 1
      WHEN 'bounce' THEN 2
      ELSE 3
    END, suppression.created_at DESC
    LIMIT 1;

    IF v_suppression_reason = 'complaint' THEN RETURN 'complaint'; END IF;
    IF v_suppression_reason = 'bounce' THEN RETURN 'hard_bounce'; END IF;
    IF v_suppression_reason IS NOT NULL THEN RETURN 'legal_suppression'; END IF;
  END IF;

  RETURN 'policy_denied';
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_notification_denial_reason(uuid, text, text, text)
  TO service_role;

CREATE TABLE public.team_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('content_calendar_comment')),
  source_id uuid NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body_excerpt text NOT NULL CHECK (char_length(body_excerpt) BETWEEN 1 AND 280),
  deep_link text NOT NULL CHECK (char_length(deep_link) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (source_kind, source_id, target_user_id)
);
CREATE INDEX team_mentions_target_unread_idx
  ON public.team_mentions(target_user_id, created_at DESC)
  WHERE read_at IS NULL;
ALTER TABLE public.team_mentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_mentions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_mentions TO authenticated;
GRANT ALL ON public.team_mentions TO service_role;
CREATE POLICY team_mentions_recipient_read ON public.team_mentions
  FOR SELECT TO authenticated USING (target_user_id = auth.uid());

DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'team_mentions'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_mentions;
  END IF;
END;
$realtime$;

CREATE TABLE public.team_data_room_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL,
  role_snapshot text NOT NULL CHECK (role_snapshot IN ('owner', 'admin', 'partner')),
  action text NOT NULL CHECK (action IN ('room_open', 'document_open')),
  document_key text CHECK (document_key IS NULL OR document_key ~ '^[A-Za-z0-9._/-]{1,200}$'),
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_data_room_access_log_created_idx
  ON public.team_data_room_access_log(created_at DESC);
ALTER TABLE public.team_data_room_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_data_room_access_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.team_data_room_access_log TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_team_my_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_access jsonb;
  v_role text;
  v_areas text[];
BEGIN
  v_access := public.admin_team_my_access();
  IF v_access IS NULL OR v_access->>'status' <> 'active' THEN RETURN NULL; END IF;
  v_role := v_access->>'role';
  v_areas := COALESCE(public.admin_team_my_operational_areas(), ARRAY[]::text[]);
  RETURN v_access || jsonb_build_object(
    'operational_areas', to_jsonb(v_areas),
    'permissions', jsonb_build_object(
      'support_read_reply_assign', true,
      'support_money_or_account_changes', false,
      'mentions', true,
      'data_room', v_role IN ('owner', 'admin', 'partner'),
      'data_room_audit', v_role IN ('owner', 'admin'),
      'team_roles', v_role = 'owner'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_team_notification_preferences()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.issue_3720_active_team_member(auth.uid()) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'mention_inapp', true,
    'mention_email', COALESCE((
      SELECT pref.enabled FROM public.notification_channel_prefs pref
      WHERE pref.user_id = auth.uid()
        AND pref.category_key = 'admin.team_mention'
        AND pref.channel = 'email'
    ), false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_set_team_mention_email(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.issue_3720_active_team_member(auth.uid()) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.notification_channel_prefs AS pref(
    user_id, category_key, channel, enabled, updated_at
  ) VALUES (auth.uid(), 'admin.team_mention', 'email', p_enabled, now())
  ON CONFLICT(user_id, category_key, channel) DO UPDATE
  SET enabled = EXCLUDED.enabled, updated_at = now();
  RETURN jsonb_build_object('mention_inapp', true, 'mention_email', p_enabled);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_list_team_mentions(
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.issue_3720_active_team_member(auth.uid()) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object(
    'mentions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page.id,
        'source_kind', page.source_kind,
        'source_id', page.source_id,
        'actor_name', public.crm_display_name(page.actor_email),
        'body_excerpt', page.body_excerpt,
        'deep_link', page.deep_link,
        'created_at', page.created_at,
        'read_at', page.read_at
      ) ORDER BY page.created_at DESC, page.id DESC)
      FROM (
        SELECT mention.*, lower(btrim(identity.email)) actor_email
        FROM public.team_mentions mention
        LEFT JOIN auth.users identity ON identity.id = mention.actor_user_id
        WHERE mention.target_user_id = auth.uid()
          AND (p_before IS NULL OR mention.created_at < p_before)
        ORDER BY mention.created_at DESC, mention.id DESC
        LIMIT p_limit
      ) page
    ), '[]'::jsonb),
    'unread', (
      SELECT count(*) FROM public.team_mentions mention
      WHERE mention.target_user_id = auth.uid() AND mention.read_at IS NULL
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_mark_team_mention_read(p_mention_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.issue_3720_active_team_member(auth.uid()) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.team_mentions
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_mention_id AND target_user_id = auth.uid();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.content_calendar_comment_add_with_mentions(
  p_id uuid,
  p_body text,
  p_mention_emails text[] DEFAULT ARRAY[]::text[],
  p_request_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_comment_id uuid;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_email text;
  v_user_id uuid;
  v_clean_emails text[];
  v_mention_ids jsonb := '[]'::jsonb;
  v_deep_link text;
  v_mention_id uuid;
BEGIN
  IF NOT public.issue_3720_active_team_member(v_actor) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(email))) FILTER (WHERE btrim(email) <> ''), ARRAY[]::text[])
  INTO v_clean_emails FROM unnest(COALESCE(p_mention_emails, ARRAY[]::text[])) email;
  IF cardinality(v_clean_emails) > 20 THEN RAISE EXCEPTION 'too_many_mentions' USING ERRCODE = '22023'; END IF;

  v_result := public.content_calendar_comment_add(p_id, p_body, p_request_key);
  v_comment_id := (v_result->'comment'->>'id')::uuid;
  v_deep_link := 'https://admin.usemingla.com/#/content-calendar?card=' || p_id::text;
  SELECT public.crm_display_name(lower(btrim(identity.email))) INTO v_actor_name
  FROM auth.users identity WHERE identity.id = v_actor;
  v_actor_name := COALESCE(NULLIF(btrim(v_actor_name), ''), 'A teammate');

  FOREACH v_email IN ARRAY v_clean_emails LOOP
    SELECT identity.id INTO v_user_id
    FROM auth.users identity
    WHERE lower(btrim(identity.email)) = v_email
      AND public.issue_3720_active_team_member(identity.id)
    LIMIT 1;
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'invalid_mention_recipient' USING ERRCODE = '22023';
    END IF;
    IF v_user_id = v_actor THEN CONTINUE; END IF;

    INSERT INTO public.team_mentions(
      source_kind, source_id, actor_user_id, target_user_id,
      body_excerpt, deep_link
    ) VALUES (
      'content_calendar_comment', v_comment_id, v_actor, v_user_id,
      left(btrim(p_body), 280), v_deep_link
    ) ON CONFLICT(source_kind, source_id, target_user_id) DO UPDATE
      SET body_excerpt = EXCLUDED.body_excerpt
    RETURNING id INTO v_mention_id;

    INSERT INTO public.notification_outbox(
      category_key, user_id, payload, idempotency_key, status
    ) VALUES (
      'admin.team_mention', v_user_id,
      jsonb_build_object(
        'title', v_actor_name || ' mentioned you',
        'body', left(btrim(p_body), 180),
        'mention_id', v_mention_id,
        'source_kind', 'content_calendar_comment',
        'source_id', v_comment_id,
        'deep_link', v_deep_link
      ),
      'admin.team_mention:' || v_mention_id::text,
      'pending'
    ) ON CONFLICT(idempotency_key) DO NOTHING;
    v_mention_ids := v_mention_ids || to_jsonb(v_mention_id);
  END LOOP;

  RETURN v_result || jsonb_build_object('mention_ids', v_mention_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_log_data_room_access(
  p_user_id uuid,
  p_action text,
  p_document_key text DEFAULT NULL,
  p_succeeded boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_role text;
  v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('room_open', 'document_open') OR p_succeeded IS NULL
     OR (p_action = 'room_open' AND p_document_key IS NOT NULL)
     OR (p_action = 'document_open' AND (p_document_key IS NULL OR p_document_key !~ '^[A-Za-z0-9._/-]{1,200}$')) THEN
    RAISE EXCEPTION 'invalid_access_event' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(identity.email)), COALESCE(full_member.role, scoped_member.role)
  INTO v_email, v_role
  FROM auth.users identity
  LEFT JOIN public.admin_users full_member
    ON lower(btrim(full_member.email)) = lower(btrim(identity.email)) AND full_member.status = 'active'
  LEFT JOIN public.admin_team_members scoped_member
    ON scoped_member.email = lower(btrim(identity.email)) AND scoped_member.status = 'active'
  WHERE identity.id = p_user_id;
  IF v_role NOT IN ('owner', 'admin', 'partner') THEN RAISE EXCEPTION 'data_room_access_denied' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.team_data_room_access_log(user_id, actor_email, role_snapshot, action, document_key, succeeded)
  VALUES (p_user_id, v_email, v_role, p_action, p_document_key, p_succeeded)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_list_data_room_access(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.admin_team_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', page.id,
      'actor_email', page.actor_email,
      'role', page.role_snapshot,
      'action', page.action,
      'document_key', page.document_key,
      'succeeded', page.succeeded,
      'created_at', page.created_at
    ) ORDER BY page.created_at DESC, page.id DESC)
    FROM (
      SELECT * FROM public.team_data_room_access_log
      ORDER BY created_at DESC, id DESC LIMIT p_limit
    ) page
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3720_team_my_permissions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3720_team_notification_preferences() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3720_set_team_mention_email(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3720_list_team_mentions(integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3720_mark_team_mention_read(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_calendar_comment_add_with_mentions(uuid, text, text[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3720_log_data_room_access(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3720_list_data_room_access(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_team_my_permissions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_team_notification_preferences() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_set_team_mention_email(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_team_mentions(integer, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_mark_team_mention_read(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_calendar_comment_add_with_mentions(uuid, text, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_log_data_room_access(uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_data_room_access(integer) TO authenticated, service_role;

DO $guard$
BEGIN
  IF current_setting('issue3720_wave6.is_admin_user_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_is_admin_user_changed';
  END IF;
  IF current_setting('issue3720_wave6.role_areas_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_role_areas(text)'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_admin_team_role_areas_changed';
  END IF;
  IF current_setting('issue3720_wave6.my_access_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_access()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_admin_team_my_access_changed';
  END IF;
  IF public.admin_team_role_areas('growth') && ARRAY['admin_console', 'team_manage']::text[]
     OR public.admin_team_role_areas('partner') && ARRAY['admin_console', 'team_manage']::text[] THEN
    RAISE EXCEPTION 'issue3720_nonadmin_privilege_drift';
  END IF;
  IF has_function_privilege('anon', 'public.issue_3720_team_my_permissions()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3720_log_data_room_access(uuid,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3720_wave6_acl_invalid';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
COMMIT;
