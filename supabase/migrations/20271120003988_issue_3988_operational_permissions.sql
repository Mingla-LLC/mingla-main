-- Issue #3988 — Community & Support permissions: one role per teammate.
--
-- Each teammate has ONE Community & Support role: Off, Support teammate or
-- Support lead, stored only in public.support_staff (enabled, role staff|lead).
-- A Support teammate works both Support and Community moderation. Owners and
-- Admins are included and may opt into the Support rota for alerts and
-- availability.
--
-- What this migration does:
--   A. Staff rows are admin-write only. The signed-in user changes only their
--      own availability, through support_set_available().
--   B. Support and Community powers require current Mingla team membership
--      plus an enabled support_staff row (Owners/Admins are included). The
--      community_staff table stops being a grant source.
--   C. Presence, "Support is online" and new-ticket alerts follow the same rule.
--   D. The Admin areas that show Community & Support tabs are computed from
--      the same predicates the tab RPCs use as guards.
--   E. Admin RPCs to list people and set each person's role.
--   F. Backfill by role and status predicates only.
--
-- Invariants enforced here (declared in the #3988 pg17 tests):
--   I-3988-TAB-AREA-EQUALS-RPC-GUARD (issue_3988_capabilities,
--     admin_team_my_operational_areas)
--   I-3988-OPERATIONAL-ACCESS-REQUIRES-ACTIVE-TEAM (is_support_staff,
--     community_role)
--   I-3988-STAFF-ROWS-ADMIN-WRITE-ONLY (support_staff grants and policy)
--
-- is_admin_user(), admin_team_role_areas(text), admin_team_my_access() and
-- team_agent_product_truth_call(text,text,jsonb,text) are NOT changed here.
-- Their bodies are snapshotted at apply time and compared at the end.

BEGIN;
SET LOCAL lock_timeout = '10s';

SELECT set_config(
  'issue3988.is_admin_user_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure),
  true
);
SELECT set_config(
  'issue3988.role_areas_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_role_areas(text)'::regprocedure),
  true
);
SELECT set_config(
  'issue3988.my_access_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_access()'::regprocedure),
  true
);
SELECT set_config(
  'issue3988.product_truth_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p
    WHERE p.oid = 'public.team_agent_product_truth_call(text,text,jsonb,text)'::regprocedure),
  true
);

-- ───────────────────────────────────────────────────────────────────────────
-- A. Staff rows are admin-write only (I-3988-STAFF-ROWS-ADMIN-WRITE-ONLY).
--    Every write goes through a SECURITY DEFINER function or the service role.
-- ───────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS support_staff_admin_update ON public.support_staff;
CREATE POLICY support_staff_admin_update ON public.support_staff FOR UPDATE
  USING (public.is_admin_user())
  WITH CHECK (public.is_admin_user());

REVOKE ALL ON TABLE public.support_staff FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.support_staff FROM authenticated;
GRANT SELECT ON TABLE public.support_staff TO authenticated;
GRANT ALL ON TABLE public.support_staff TO service_role;

COMMENT ON TABLE public.community_staff IS
  '#3988: no longer a grant source. Community moderation follows Support (support_staff). Rows kept for audit only.';

-- ───────────────────────────────────────────────────────────────────────────
-- B. Who is on Support (I-3988-OPERATIONAL-ACCESS-REQUIRES-ACTIVE-TEAM).
--    Current team member AND (enabled support_staff row OR Owner/Admin).
--    A staff row alone grants nothing.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_support_staff(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL
    AND public.issue_3720_active_team_member(p_user_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.support_staff staff
        WHERE staff.user_id = p_user_id AND staff.enabled = true
      )
      OR EXISTS (
        SELECT 1
        FROM auth.users identity
        JOIN public.admin_users full_member
          ON lower(btrim(full_member.email)) = lower(btrim(identity.email))
        WHERE identity.id = p_user_id
          AND full_member.status = 'active'
      )
    );
$function$;
REVOKE ALL ON FUNCTION public.is_support_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_support_staff(uuid) TO authenticated, service_role;

-- Community role: 'admin' for Owners/Admins (unchanged), otherwise
-- 'moderator' exactly when the person is effective Support staff.
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
  IF public.is_support_staff(p_user_id) THEN
    RETURN 'moderator';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.community_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_role(uuid) TO authenticated, service_role;

-- The separate Community role is retired. Kept for one release so an old
-- client fails loudly instead of silently writing a row that grants nothing.
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
  RAISE EXCEPTION 'role_retired' USING ERRCODE = '22023',
    HINT = 'Use issue_3988_set_permissions.';
END;
$$;
REVOKE ALL ON FUNCTION public.community_set_staff(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_set_staff(uuid, text, boolean, text) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- C. Presence, online state and alerts.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_set_available(p_available boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enabled boolean;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Owners and Admins are included: their first toggle puts them on the rota.
  IF public.is_admin_user() THEN
    SELECT NULLIF(btrim(p.display_name), '') INTO v_name
    FROM public.profiles p WHERE p.id = auth.uid();
    INSERT INTO public.support_staff AS s (user_id, enabled, available, role, display_name, updated_at)
    VALUES (auth.uid(), true, COALESCE(p_available, false), 'staff', v_name, now())
    ON CONFLICT (user_id) DO UPDATE
      SET enabled = true,
          available = COALESCE(p_available, false),
          updated_at = now();
    RETURN COALESCE(p_available, false);
  END IF;

  SELECT enabled INTO v_enabled FROM public.support_staff WHERE user_id = auth.uid();
  IF v_enabled IS NOT TRUE OR NOT public.is_support_staff(auth.uid()) THEN
    RAISE EXCEPTION 'not_support_staff' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_staff
    SET available = COALESCE(p_available, false), updated_at = now()
    WHERE user_id = auth.uid();
  RETURN COALESCE(p_available, false);
END;
$function$;
REVOKE ALL ON FUNCTION public.support_set_available(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_set_available(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.support_is_online()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.support_staff s
    WHERE s.enabled = true
      AND s.available = true
      AND public.is_support_staff(s.user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.support_is_online() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_is_online() TO authenticated, service_role;

-- Reply-alert recipients for notify-support: available, effective staff only.
CREATE OR REPLACE FUNCTION public.issue_3988_support_alert_recipients()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.user_id
  FROM public.support_staff s
  WHERE s.enabled = true
    AND s.available = true
    AND public.is_support_staff(s.user_id)
  ORDER BY s.user_id;
$$;
REVOKE ALL ON FUNCTION public.issue_3988_support_alert_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_support_alert_recipients() TO service_role;

-- Same body as the #3720 version except the new-ticket fan-out reaches only
-- effective Support staff.
CREATE OR REPLACE FUNCTION public.create_support_ticket(p_subject text, p_brand_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conv uuid;
  v_ticket uuid;
  v_seg text;
  v_subject text := left(btrim(COALESCE(p_subject, '')), 200);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_subject = '' THEN
    RAISE EXCEPTION 'subject_required' USING ERRCODE = 'P0001';
  END IF;

  v_seg := public.derive_user_segment(auth.uid());
  IF v_seg = 'admin' THEN v_seg := 'business'; END IF;
  IF v_seg NOT IN ('business', 'explorer') THEN v_seg := 'business'; END IF;

  INSERT INTO public.conversations(type, linked_entity_type, name, created_by)
  VALUES ('group', 'support', v_subject, auth.uid())
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  VALUES (v_conv, auth.uid());

  INSERT INTO public.support_tickets(
    requester_user_id, requester_segment, subject, conversation_id, brand_id
  ) VALUES (
    auth.uid(), v_seg, v_subject, v_conv, p_brand_id
  ) RETURNING id INTO v_ticket;

  -- Support-ticket alerts are bell + push + email only. Country remains NULL
  -- because no SMS channel is eligible for this category.
  INSERT INTO public.notification_outbox (
    category_key, user_id, brand_id, country_code, payload,
    idempotency_key, status
  )
  SELECT
    'business.support_new_ticket',
    s.user_id,
    p_brand_id,
    NULL,
    jsonb_build_object(
      'ticket_id', v_ticket,
      'subject', v_subject,
      'deep_link', 'mingla-business://support/' || v_ticket::text
    ),
    'business.support_new_ticket:' || v_ticket::text || ':' || s.user_id::text,
    'pending'
  FROM public.support_staff s
  JOIN auth.users u ON u.id = s.user_id
  WHERE s.enabled = true
    AND public.is_support_staff(s.user_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_ticket;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_support_ticket(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- D. Areas = guards (I-3988-TAB-AREA-EQUALS-RPC-GUARD).
--    Each capability is the exact predicate its tab's RPCs check:
--      community.moderate  community_can('moderate')  Ideas, Questions, Moderation
--      community.publish   community_can('publish_announcement')
--      support.work        is_support_staff() OR is_admin_user()
--                          Tickets, Brand groups, Feature Guide
--      support.presence    support_set_available() succeeds
--      team.permissions    is_admin_user()           issue_3988_* admin RPCs
--      team.invite         admin_team_role() = 'owner'
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3988_capabilities()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caps text[] := ARRAY[]::text[];
  v_admin boolean;
  v_support boolean;
BEGIN
  IF v_uid IS NULL OR public.admin_team_role() IS NULL THEN
    RETURN v_caps;
  END IF;
  v_admin := public.is_admin_user();
  v_support := public.is_support_staff(v_uid) OR v_admin;

  IF public.community_can('moderate', v_uid) THEN
    v_caps := array_append(v_caps, 'community.moderate');
  END IF;
  IF public.community_can('publish_announcement', v_uid) THEN
    v_caps := array_append(v_caps, 'community.publish');
  END IF;
  IF v_support THEN
    v_caps := v_caps || ARRAY['support.work', 'support.presence'];
  END IF;
  IF v_admin THEN
    v_caps := array_append(v_caps, 'team.permissions');
  END IF;
  IF public.admin_team_role() = 'owner' THEN
    v_caps := array_append(v_caps, 'team.invite');
  END IF;
  RETURN v_caps;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3988_capabilities() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_capabilities() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_team_my_operational_areas()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_caps text[];
  v_areas text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN RETURN v_areas; END IF;
  v_role := public.admin_team_role();
  IF v_role IS NULL THEN RETURN v_areas; END IF;

  -- Derived ONLY from the capability set, never from a staff row directly.
  v_caps := public.issue_3988_capabilities();

  IF cardinality(v_caps) > 0 THEN
    v_areas := array_append(v_areas, 'community_support');
  END IF;
  IF 'support.work' = ANY(v_caps) THEN
    v_areas := array_append(v_areas, 'community_support_support');
  END IF;
  -- Every current role sees its own team notifications.
  v_areas := array_append(v_areas, 'team_notifications');
  IF 'community.moderate' = ANY(v_caps) THEN
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

-- ───────────────────────────────────────────────────────────────────────────
-- E. People and roles (Owner/Admin only).
-- ───────────────────────────────────────────────────────────────────────────
-- Team membership is read through admin_team_directory() (current and
-- invited people, Owners/Admins included) so this file adds no new reader of
-- the membership tables.
CREATE OR REPLACE FUNCTION public.issue_3988_admin_people()
RETURNS TABLE(
  user_id uuid,
  email text,
  display_name text,
  team_role text,
  team_status text,
  has_signed_in boolean,
  role text,
  available boolean,
  effective boolean,
  last_active timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH team AS (
    SELECT d.email AS key_email, d.role AS t_role, d.status AS t_status,
      (SELECT u.id FROM auth.users u
        WHERE lower(btrim(u.email)) = d.email
        ORDER BY u.created_at LIMIT 1) AS uid
    FROM public.admin_team_directory() d
    WHERE d.status IN ('active', 'invited')
  ),
  leftover AS (
    -- Enabled staff rows on people who are not on the team.
    SELECT u.id AS uid, lower(btrim(u.email)) AS key_email,
      NULL::text AS t_role, 'none'::text AS t_status
    FROM auth.users u
    WHERE (
        EXISTS (SELECT 1 FROM public.support_staff ss WHERE ss.user_id = u.id AND ss.enabled)
        OR EXISTS (SELECT 1 FROM public.community_staff cs WHERE cs.user_id = u.id AND cs.enabled)
      )
      AND NOT EXISTS (SELECT 1 FROM team t WHERE t.uid = u.id AND t.t_status = 'active')
  ),
  everyone AS (
    SELECT t.uid, t.key_email, t.t_role, t.t_status FROM team t
    UNION ALL
    SELECT l.uid, l.key_email, l.t_role, l.t_status FROM leftover l
  )
  SELECT
    e.uid,
    e.key_email,
    COALESCE(
      NULLIF(btrim(p.display_name), ''),
      NULLIF(btrim(ss.display_name), ''),
      split_part(e.key_email, '@', 1)
    ),
    e.t_role,
    e.t_status,
    (e.uid IS NOT NULL AND e.t_status = 'active'),
    CASE
      WHEN e.t_status = 'active' AND e.t_role IN ('owner', 'admin') THEN
        CASE WHEN ss.enabled IS TRUE THEN 'included_rota' ELSE 'included' END
      WHEN e.uid IS NOT NULL AND public.is_support_staff(e.uid) THEN
        CASE WHEN ss.role = 'lead' THEN 'lead' ELSE 'teammate' END
      ELSE 'off'
    END,
    COALESCE(ss.enabled AND ss.available AND public.is_support_staff(e.uid), false),
    NOT (
      e.t_status <> 'active'
      AND (COALESCE(ss.enabled, false) OR COALESCE(cs.enabled, false))
    ),
    GREATEST(u.last_sign_in_at, ss.updated_at)
  FROM everyone e
  LEFT JOIN auth.users u ON u.id = e.uid
  LEFT JOIN public.profiles p ON p.id = e.uid
  LEFT JOIN public.support_staff ss ON ss.user_id = e.uid
  LEFT JOIN public.community_staff cs ON cs.user_id = e.uid
  ORDER BY
    CASE WHEN e.t_status = 'active' THEN 0 WHEN e.t_status = 'invited' THEN 1 ELSE 2 END,
    CASE e.t_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    lower(COALESCE(NULLIF(btrim(p.display_name), ''), e.key_email));
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3988_admin_people() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_admin_people() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3988_set_permissions(
  p_user_id uuid,
  p_role text,
  p_display_name text DEFAULT NULL
)
RETURNS TABLE(
  user_id uuid,
  email text,
  display_name text,
  team_role text,
  team_status text,
  has_signed_in boolean,
  role text,
  available boolean,
  effective boolean,
  last_active timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_name text := NULLIF(btrim(COALESCE(p_display_name, '')), '');
  v_profile_name text;
  v_was_enabled boolean;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22023';
  END IF;
  IF v_role IN ('agent', 'moderator') THEN
    RAISE EXCEPTION 'role_retired' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('off', 'teammate', 'lead') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_3720_active_team_member(p_user_id) THEN
    RAISE EXCEPTION 'not_on_team' USING ERRCODE = '22023';
  END IF;

  SELECT s.enabled INTO v_was_enabled FROM public.support_staff s WHERE s.user_id = p_user_id;

  IF v_role = 'off' THEN
    UPDATE public.support_staff s
      SET enabled = false, available = false,
          display_name = COALESCE(v_name, s.display_name),
          updated_at = now()
      WHERE s.user_id = p_user_id;
  ELSE
    SELECT NULLIF(btrim(p.display_name), '') INTO v_profile_name
    FROM public.profiles p WHERE p.id = p_user_id;
    INSERT INTO public.support_staff AS s (user_id, enabled, available, role, display_name, updated_at)
    VALUES (
      p_user_id, true, false,
      CASE WHEN v_role = 'lead' THEN 'lead' ELSE 'staff' END,
      COALESCE(v_name, v_profile_name),
      now()
    )
    ON CONFLICT ON CONSTRAINT support_staff_pkey DO UPDATE
      SET enabled = true,
          role = EXCLUDED.role,
          display_name = COALESCE(v_name, s.display_name, EXCLUDED.display_name),
          updated_at = now();
  END IF;

  -- The retired Community row never grants anything; keep it switched off.
  UPDATE public.community_staff c
    SET enabled = false, updated_at = now()
    WHERE c.user_id = p_user_id AND c.enabled;

  INSERT INTO public.support_audit_log (actor_user_id, action, ticket_id, metadata)
  VALUES (
    auth.uid(),
    CASE WHEN v_role = 'off' THEN 'staff_revoked' ELSE 'staff_granted' END,
    NULL,
    jsonb_build_object('user_id', p_user_id, 'role', v_role, 'was_enabled', COALESCE(v_was_enabled, false))
  );
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'set_permissions', 'support_staff', p_user_id, jsonb_build_object('role', v_role));

  RETURN QUERY SELECT * FROM public.issue_3988_admin_people() people WHERE people.user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3988_set_permissions(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_set_permissions(uuid, text, text) TO authenticated, service_role;

-- Switch off staff rows left on someone who is no longer on the team.
CREATE OR REPLACE FUNCTION public.issue_3988_remove_orphan_staff(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_support integer;
  v_community integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22023';
  END IF;
  IF public.issue_3720_active_team_member(p_user_id) THEN
    RAISE EXCEPTION 'still_on_team' USING ERRCODE = '22023';
  END IF;

  UPDATE public.support_staff s
    SET enabled = false, available = false, updated_at = now()
    WHERE s.user_id = p_user_id AND (s.enabled OR s.available);
  GET DIAGNOSTICS v_support = ROW_COUNT;
  UPDATE public.community_staff c
    SET enabled = false, updated_at = now()
    WHERE c.user_id = p_user_id AND c.enabled;
  GET DIAGNOSTICS v_community = ROW_COUNT;

  INSERT INTO public.support_audit_log (actor_user_id, action, ticket_id, metadata)
  VALUES (auth.uid(), 'staff_revoked', NULL,
    jsonb_build_object('user_id', p_user_id, 'reason', 'not_on_team'));
  INSERT INTO public.community_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'remove_orphan_staff', 'support_staff', p_user_id,
    jsonb_build_object('support_rows', v_support, 'community_rows', v_community));

  RETURN v_support + v_community;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3988_remove_orphan_staff(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_remove_orphan_staff(uuid) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- F. Backfill by role and status predicates only.
-- ───────────────────────────────────────────────────────────────────────────
-- The backfill is a function so the pg17 suite can prove it on fixtures.
-- It is idempotent and names nobody: role and status predicates only.
CREATE OR REPLACE FUNCTION public.issue_3988_backfill_permissions()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team integer;
  v_mapped integer;
  v_community_off integer;
  v_orphans_off integer;
BEGIN
  -- F1. Every current scoped teammate (growth / partner, status active) is a
  --     Support teammate. An existing row keeps its role and availability.
  INSERT INTO public.support_staff AS s (user_id, enabled, available, role, display_name, updated_at)
  SELECT DISTINCT ON (u.id)
    u.id, true, false, 'staff', NULLIF(btrim(p.display_name), ''), now()
  FROM public.admin_team_directory() d
  JOIN auth.users u ON lower(btrim(u.email)) = d.email
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE d.status = 'active'
    AND d.role IN ('growth', 'partner')
  ORDER BY u.id
  ON CONFLICT (user_id) DO UPDATE
    SET enabled = true,
        display_name = COALESCE(s.display_name, EXCLUDED.display_name),
        updated_at = now();
  GET DIAGNOSTICS v_team = ROW_COUNT;

  -- F2. Any enabled Community row (agent or moderator) on a current teammate
  --     maps to Support teammate. Owners/Admins are already included.
  INSERT INTO public.support_staff AS s (user_id, enabled, available, role, display_name, updated_at)
  SELECT c.user_id, true, false, 'staff', NULLIF(btrim(c.display_name), ''), now()
  FROM public.community_staff c
  WHERE c.enabled = true
    AND public.issue_3720_active_team_member(c.user_id)
    AND public.community_role(c.user_id) IS DISTINCT FROM 'admin'
  ON CONFLICT (user_id) DO UPDATE
    SET enabled = true,
        display_name = COALESCE(s.display_name, EXCLUDED.display_name),
        updated_at = now();
  GET DIAGNOSTICS v_mapped = ROW_COUNT;

  -- F3. Community rows stop being a grant source.
  UPDATE public.community_staff c
    SET enabled = false, updated_at = now()
    WHERE c.enabled = true;
  GET DIAGNOSTICS v_community_off = ROW_COUNT;

  -- F4. Enabled Support rows on anyone not on the team are switched off.
  UPDATE public.support_staff s
    SET enabled = false, available = false, updated_at = now()
    WHERE s.enabled = true
      AND NOT public.issue_3720_active_team_member(s.user_id);
  GET DIAGNOSTICS v_orphans_off = ROW_COUNT;

  RETURN jsonb_build_object(
    'team_rows', v_team,
    'community_rows_mapped', v_mapped,
    'community_rows_off', v_community_off,
    'non_team_rows_off', v_orphans_off
  );
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3988_backfill_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3988_backfill_permissions() TO service_role;

SELECT public.issue_3988_backfill_permissions();

-- ───────────────────────────────────────────────────────────────────────────
-- Guards.
-- ───────────────────────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF current_setting('issue3988.is_admin_user_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3988_is_admin_user_changed';
  END IF;
  IF current_setting('issue3988.role_areas_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_role_areas(text)'::regprocedure) THEN
    RAISE EXCEPTION 'issue3988_admin_team_role_areas_changed';
  END IF;
  IF current_setting('issue3988.my_access_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_access()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3988_admin_team_my_access_changed';
  END IF;
  IF current_setting('issue3988.product_truth_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p
       WHERE p.oid = 'public.team_agent_product_truth_call(text,text,jsonb,text)'::regprocedure) THEN
    RAISE EXCEPTION 'issue3988_team_agent_product_truth_call_changed';
  END IF;

  IF has_table_privilege('authenticated', 'public.support_staff', 'INSERT')
     OR has_table_privilege('authenticated', 'public.support_staff', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.support_staff', 'DELETE')
     OR has_table_privilege('anon', 'public.support_staff', 'SELECT') THEN
    RAISE EXCEPTION 'issue3988_support_staff_acl_invalid';
  END IF;

  IF has_function_privilege('anon', 'public.issue_3988_capabilities()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3988_admin_people()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3988_set_permissions(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3988_remove_orphan_staff(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3988_support_alert_recipients()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3988_backfill_permissions()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_team_my_operational_areas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3988_function_acl_invalid';
  END IF;

  IF EXISTS (SELECT 1 FROM public.community_staff WHERE enabled = true) THEN
    RAISE EXCEPTION 'issue3988_community_rows_still_enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.support_staff s
    WHERE s.enabled = true AND NOT public.issue_3720_active_team_member(s.user_id)
  ) THEN
    RAISE EXCEPTION 'issue3988_non_team_support_rows_still_enabled';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
COMMIT;
