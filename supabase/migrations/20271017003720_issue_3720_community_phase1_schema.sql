-- #3720 Phase 1 / Slice E — Community schema + outbox category + preferences
-- + community roles + support_is_online().
--
-- No Host UGC (ideas/votes/Q&A = Phase 2). No admin/Host UI (Slices F/G).
-- Announcement delivery reuses notification_outbox + can_send() + notify-outbox-drain.
-- Publish authority = is_admin_user() only. Community staff roles are moderator/agent
-- only (Admin is not stored in community_staff — same pattern as #3802 team roles).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- A. Announcements
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  body_md text NOT NULL
    CHECK (char_length(btrim(body_md)) >= 1),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_announcements_published_at_ck CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published')
  )
);

CREATE INDEX IF NOT EXISTS community_announcements_status_published_idx
  ON public.community_announcements (status, published_at DESC)
  WHERE status = 'published';

ALTER TABLE public.community_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_announcements FROM PUBLIC, anon;
GRANT SELECT ON public.community_announcements TO authenticated;
GRANT ALL ON public.community_announcements TO service_role;

-- Hosts (and any signed-in user): published only. Admins: all.
DROP POLICY IF EXISTS community_announcements_host_read ON public.community_announcements;
CREATE POLICY community_announcements_host_read
  ON public.community_announcements FOR SELECT TO authenticated
  USING (status = 'published' OR public.is_admin_user());

-- No client INSERT/UPDATE/DELETE policies — writes go through DEFINER RPCs.

COMMENT ON TABLE public.community_announcements IS
  '#3720 Phase 1 — admin-authored Host Community announcements. Hosts read published only.';

-- ───────────────────────────────────────────────────────────────────────────
-- B. Roadmap cards (public vs internal; published/archived; reorder)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_roadmap_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_title text NOT NULL
    CHECK (char_length(btrim(public_title)) BETWEEN 1 AND 200),
  public_body text,
  internal_note text,
  lane text NOT NULL DEFAULT 'now'
    CHECK (lane IN ('now', 'next', 'later')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_roadmap_cards_status_sort_idx
  ON public.community_roadmap_cards (status, sort_order, id);

ALTER TABLE public.community_roadmap_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_roadmap_cards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_roadmap_cards TO service_role;

-- Base table has no client SELECT policy (deny). Hosts read via the public view.
COMMENT ON TABLE public.community_roadmap_cards IS
  '#3720 Phase 1 — roadmap cards. internal_note never exposed to hosts.';

-- Hosts read published cards via the base-table RLS policy below. The view
-- strips internal_note so a host SELECT * through the view cannot leak notes
-- even if a wider policy is added later.
CREATE OR REPLACE VIEW public.community_roadmap_public
WITH (security_invoker = true)
AS
SELECT
  c.id,
  c.public_title,
  c.public_body,
  c.lane,
  c.status,
  c.sort_order,
  c.created_at,
  c.updated_at
FROM public.community_roadmap_cards c
WHERE c.status = 'published';

GRANT SELECT ON public.community_roadmap_cards TO authenticated;
DROP POLICY IF EXISTS community_roadmap_cards_host_read ON public.community_roadmap_cards;
CREATE POLICY community_roadmap_cards_host_read
  ON public.community_roadmap_cards FOR SELECT TO authenticated
  USING (status = 'published' OR public.is_admin_user());

GRANT SELECT ON public.community_roadmap_public TO authenticated, anon;

COMMENT ON VIEW public.community_roadmap_public IS
  '#3720 Phase 1 — host-safe roadmap projection (no internal_note).';

-- ───────────────────────────────────────────────────────────────────────────
-- C. Per-host read receipts
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_read_receipts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL
    REFERENCES public.community_announcements(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);

ALTER TABLE public.community_read_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_read_receipts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.community_read_receipts TO authenticated;
GRANT ALL ON public.community_read_receipts TO service_role;

DROP POLICY IF EXISTS community_read_receipts_own ON public.community_read_receipts;
CREATE POLICY community_read_receipts_own
  ON public.community_read_receipts FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ───────────────────────────────────────────────────────────────────────────
-- D. Notification category (email default-on = transactional)
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES (
  'community_announcement',
  'community',
  true,
  'normal',
  ARRAY['inapp', 'push', 'email']::text[],
  'reach_once',
  true
)
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────────
-- E. Community audit log
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_audit_log_entity_idx
  ON public.community_audit_log (entity_type, entity_id, created_at DESC);

ALTER TABLE public.community_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_audit_log TO service_role;
-- Staff/admin read via policy (writes only from DEFINER RPCs / service role).
GRANT SELECT ON public.community_audit_log TO authenticated;
DROP POLICY IF EXISTS community_audit_log_staff_read ON public.community_audit_log;
CREATE POLICY community_audit_log_staff_read
  ON public.community_audit_log FOR SELECT TO authenticated
  USING (public.is_admin_user() OR public.is_support_staff(auth.uid()));

-- ───────────────────────────────────────────────────────────────────────────
-- F. Community staff (moderator / agent only — Admin = is_admin_user())
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_staff (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('moderator', 'agent')),
  enabled boolean NOT NULL DEFAULT true,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.community_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_staff FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.community_staff TO service_role;

COMMENT ON TABLE public.community_staff IS
  '#3720 Phase 1 — community moderator/agent only. Full Admin is is_admin_user(), never stored here.';

CREATE OR REPLACE FUNCTION public.community_role(p_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_users au
    JOIN auth.users u ON lower(u.email) = lower(au.email)
    WHERE u.id = p_user_id AND au.status = 'active'
  ) THEN
    RETURN 'admin';
  END IF;
  RETURN (
    SELECT s.role FROM public.community_staff s
    WHERE s.user_id = p_user_id AND s.enabled = true
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_can(p_area text, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_user_id IS NULL OR p_area IS NULL OR btrim(p_area) = '' THEN
    RETURN false;
  END IF;
  v_role := public.community_role(p_user_id);
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  -- Only Admins publish announcements / mutate roadmap.
  IF p_area IN ('publish_announcement', 'manage_roadmap', 'manage_community_staff') THEN
    RETURN v_role = 'admin';
  END IF;
  -- Moderators (and admins) can moderate once Phase 2 exists; Agents cannot.
  IF p_area = 'moderate' THEN
    RETURN v_role IN ('admin', 'moderator');
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.community_can(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_can(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_set_staff(
  p_user_id uuid,
  p_role text,
  p_enabled boolean DEFAULT true,
  p_display_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('moderator', 'agent') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.admin_users au
    JOIN auth.users u ON lower(u.email) = lower(au.email)
    WHERE u.id = p_user_id AND au.status = 'active'
  ) THEN
    RAISE EXCEPTION 'admin_use_is_admin_user' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.community_staff AS s (user_id, role, enabled, display_name, updated_at)
  VALUES (
    p_user_id,
    p_role,
    COALESCE(p_enabled, true),
    NULLIF(btrim(COALESCE(p_display_name, '')), ''),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        enabled = EXCLUDED.enabled,
        display_name = COALESCE(EXCLUDED.display_name, s.display_name),
        updated_at = now();

  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'set_staff',
    'community_staff',
    p_user_id,
    jsonb_build_object('role', p_role, 'enabled', COALESCE(p_enabled, true))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_set_staff(uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_set_staff(uuid, text, boolean, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- G. support_is_online() — derives from support_staff.available (no new state)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_is_online()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_staff s
    WHERE s.enabled = true AND s.available = true
  );
$$;

REVOKE ALL ON FUNCTION public.support_is_online() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.support_is_online() TO authenticated, anon;

COMMENT ON FUNCTION public.support_is_online() IS
  '#3720 Phase 1 — true when any enabled support_staff row is available.';

-- ───────────────────────────────────────────────────────────────────────────
-- H. Announcement CRUD + publish → outbox fan-out
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_upsert_announcement(
  p_id uuid,
  p_title text,
  p_body_md text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_title text := btrim(COALESCE(p_title, ''));
  v_body text := btrim(COALESCE(p_body_md, ''));
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_title) < 1 OR char_length(v_title) > 200 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) < 1 THEN
    RAISE EXCEPTION 'invalid_body' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.community_announcements (title, body_md, author_user_id)
    VALUES (v_title, v_body, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.community_announcements
       SET title = v_title,
           body_md = v_body,
           updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN p_id IS NULL THEN 'create_announcement' ELSE 'update_announcement' END,
    'community_announcement',
    v_id,
    jsonb_build_object('title', v_title)
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.community_upsert_announcement(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_upsert_announcement(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_publish_announcement(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.community_announcements%ROWTYPE;
  v_enqueued integer := 0;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.community_announcements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status = 'archived' THEN
    RAISE EXCEPTION 'archived' USING ERRCODE = '22023';
  END IF;

  UPDATE public.community_announcements
     SET status = 'published',
         published_at = COALESCE(published_at, now()),
         updated_at = now()
   WHERE id = p_id;

  -- Fan out one outbox row per active Host (brand team member). Idempotent.
  WITH hosts AS (
    SELECT DISTINCT btm.user_id
      FROM public.brand_team_members btm
     WHERE btm.accepted_at IS NOT NULL
       AND btm.removed_at IS NULL
  ),
  inserted AS (
    INSERT INTO public.notification_outbox AS o (
      category_key, user_id, payload, idempotency_key, status
    )
    SELECT
      'community_announcement',
      h.user_id,
      jsonb_build_object(
        'announcement_id', p_id,
        'title', v_row.title,
        'body_md', v_row.body_md
      ),
      'community_announcement:' || p_id::text || ':' || h.user_id::text,
      'pending'
    FROM hosts h
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_enqueued FROM inserted;

  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'publish_announcement',
    'community_announcement',
    p_id,
    jsonb_build_object('enqueued', v_enqueued)
  );

  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION public.community_publish_announcement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_publish_announcement(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_archive_announcement(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.community_announcements
     SET status = 'archived', updated_at = now()
   WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'archive_announcement', 'community_announcement', p_id, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.community_archive_announcement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_archive_announcement(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- I. Roadmap upsert / archive / reorder
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_upsert_roadmap_card(
  p_id uuid,
  p_public_title text,
  p_public_body text,
  p_internal_note text,
  p_lane text,
  p_status text DEFAULT 'draft'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_title text := btrim(COALESCE(p_public_title, ''));
  v_lane text := COALESCE(NULLIF(btrim(COALESCE(p_lane, '')), ''), 'now');
  v_status text := COALESCE(NULLIF(btrim(COALESCE(p_status, '')), ''), 'draft');
  v_sort integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_title) < 1 OR char_length(v_title) > 200 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023';
  END IF;
  IF v_lane NOT IN ('now', 'next', 'later') THEN
    RAISE EXCEPTION 'invalid_lane' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('draft', 'published', 'archived') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    SELECT COALESCE(max(sort_order), -1) + 1 INTO v_sort FROM public.community_roadmap_cards;
    INSERT INTO public.community_roadmap_cards (
      public_title, public_body, internal_note, lane, status, sort_order
    ) VALUES (
      v_title,
      NULLIF(btrim(COALESCE(p_public_body, '')), ''),
      NULLIF(btrim(COALESCE(p_internal_note, '')), ''),
      v_lane,
      v_status,
      v_sort
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.community_roadmap_cards
       SET public_title = v_title,
           public_body = NULLIF(btrim(COALESCE(p_public_body, '')), ''),
           internal_note = NULLIF(btrim(COALESCE(p_internal_note, '')), ''),
           lane = v_lane,
           status = v_status,
           updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN p_id IS NULL THEN 'create_roadmap_card' ELSE 'update_roadmap_card' END,
    'community_roadmap_card',
    v_id,
    jsonb_build_object('lane', v_lane, 'status', v_status)
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.community_upsert_roadmap_card(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_upsert_roadmap_card(uuid, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_reorder_roadmap(p_ordered_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected integer;
  v_got integer;
  i integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_ordered_ids IS NULL OR array_length(p_ordered_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ordered_ids_required' USING ERRCODE = '22023';
  END IF;

  -- Lock all cards; require the ordered set to match exactly (no stale partial).
  PERFORM 1 FROM public.community_roadmap_cards ORDER BY id FOR UPDATE;
  SELECT count(*) INTO v_expected FROM public.community_roadmap_cards;
  SELECT count(DISTINCT x) INTO v_got FROM unnest(p_ordered_ids) AS t(x);
  IF v_got <> v_expected OR array_length(p_ordered_ids, 1) <> v_expected THEN
    RAISE EXCEPTION 'stale_reorder_set' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_ordered_ids) AS t(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.community_roadmap_cards c WHERE c.id = t.id)
  ) THEN
    RAISE EXCEPTION 'stale_reorder_set' USING ERRCODE = '40001';
  END IF;

  FOR i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE public.community_roadmap_cards
       SET sort_order = i - 1, updated_at = now()
     WHERE id = p_ordered_ids[i];
  END LOOP;

  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'reorder_roadmap',
    'community_roadmap',
    NULL,
    jsonb_build_object('count', v_expected)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_reorder_roadmap(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_reorder_roadmap(uuid[]) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- J. Host email preference toggle (default ON via transactional category)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.community_set_email_pref(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_channel_prefs AS p (
    user_id, category_key, channel, enabled, updated_at
  ) VALUES (
    auth.uid(), 'community_announcement', 'email', p_enabled, now()
  )
  ON CONFLICT (user_id, category_key, channel) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.community_set_email_pref(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_set_email_pref(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_mark_announcement_read(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_announcement_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.community_announcements a
    WHERE a.id = p_announcement_id AND a.status = 'published'
  ) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.community_read_receipts (user_id, announcement_id, read_at)
  VALUES (auth.uid(), p_announcement_id, now())
  ON CONFLICT (user_id, announcement_id) DO UPDATE
    SET read_at = EXCLUDED.read_at;
END;
$$;

REVOKE ALL ON FUNCTION public.community_mark_announcement_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_mark_announcement_read(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- Self-check (fails closed on apply if shape drifts)
-- ───────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.community_announcements') IS NULL
     OR to_regclass('public.community_roadmap_cards') IS NULL
     OR to_regclass('public.community_read_receipts') IS NULL
     OR to_regclass('public.community_staff') IS NULL
     OR to_regclass('public.community_audit_log') IS NULL THEN
    RAISE EXCEPTION 'self-check: community tables missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_categories WHERE key = 'community_announcement'
  ) THEN
    RAISE EXCEPTION 'self-check: community_announcement category missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'support_is_online' AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION 'self-check: support_is_online() missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'community_staff'
      AND column_name = 'role'
  ) THEN
    -- role CHECK must not admit 'admin'
    SELECT c.conname INTO v_missing
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = 'community_staff'
       AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ILIKE '%moderator%'
       AND pg_get_constraintdef(c.oid) ILIKE '%agent%'
       AND pg_get_constraintdef(c.oid) NOT ILIKE '%''admin''%'
     LIMIT 1;
    IF v_missing IS NULL THEN
      RAISE EXCEPTION 'self-check: community_staff.role must admit only moderator/agent';
    END IF;
  END IF;
END;
$check$;

COMMIT;
