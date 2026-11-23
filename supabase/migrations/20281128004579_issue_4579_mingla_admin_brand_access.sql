-- #4579: every active Mingla admin is a full Brand admin on every live brand.
--
-- What this file does (spec v1 B.3/B.4, v2, v3 delta on issue #4579):
--   1. brand_team_members gains granted_via ('invite' | 'mingla_admin'),
--      granted_admin_user_id and removal_reason. Every existing row is 'invite'.
--   2. Two opt-out tables: brand_mingla_team_optouts (the brand removed
--      "Mingla Team"; no sweep re-adds anyone) and brand_mingla_admin_optouts
--      (a host removed a Mingla admin they had invited themselves).
--   3. Grant / revoke helpers, driven by triggers on brands (new brand) and
--      admin_users (activation, revoke, role or email change), plus the host's
--      remove / owner-only restore / state RPCs for the one "Mingla Team" entry.
--   4. Host-facing readers: the Team & permissions reader collapses auto rows into
--      ONE "Mingla Team" entry (no names, emails, avatars, ids or count). Every
--      other reader shows an auto-admin by issue_4579_admin_public_name (never an
--      email or handle) with an is_mingla_team flag.
--   5. An idempotent backfill at the end.
--
-- Parity: auto rows are ordinary brand_admin rows. Pushes, chats, terms, Till and
-- every recipient path treat them exactly as invited Brand admins; nothing here
-- filters recipients. Payouts stay owner-only (rank 60; auto rows are 50).
--
-- No staff names are written by this migration.

-- ---------------------------------------------------------------------------
-- 0. Drift guard: every body re-emitted below must still be the one in the repo
--    (md5 of prosrc), or already be this file's own body (a local re-run).
-- ---------------------------------------------------------------------------
DO $drift_guard$
DECLARE r record; v_src text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.biz_brand_team_members(uuid)', '5dcfd64b74ed596a25204ee8a55258e8'),
      ('public.issue_4173_list_brand_group_members(uuid)', 'bde23277f147dc05330e35de06da022d'),
      ('public.issue_3988_list_brand_group_mention_candidates(uuid,text,integer)', '0cea44db128c93cbe356366d266450f8'),
      ('public.issue_3720_list_brand_group_messages(uuid,integer,timestamp with time zone)', '2b7ffa8b66706d439027db6837a15795'),
      ('public.issue_4304_list_brand_group_read_state(uuid)', '60bb7eaf2379dd00c36935ca2b0de496'),
      ('public.issue_3720_list_brand_groups()', 'fe2d4c8c367870daf5f2f2dce1d2708e'),
      ('public.issue_3988_list_brand_group_media(uuid,text,timestamp with time zone,uuid,integer)', '631cfd2afe6809d8174f3593aea6bfad'),
      ('public.issue_3720_list_team_mentions(integer,timestamp with time zone)', 'eaccb77a3a6890ae19b73a978107f8df'),
      ('public.biz_brand_form_door_reads(uuid,integer,timestamp with time zone)', 'dff56f95e5041c10280927bfc957a73b')
    ) AS v(sig, expected_md5)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'issue #4579 drift: % is missing', r.sig;
    END IF;
    IF md5(v_src) IS DISTINCT FROM r.expected_md5 AND position('issue_4579_' IN v_src) = 0 THEN
      RAISE EXCEPTION 'issue #4579 drift: % no longer matches its repository definition', r.sig;
    END IF;
  END LOOP;
END;
$drift_guard$;

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_team_members
  ADD COLUMN IF NOT EXISTS granted_via text NOT NULL DEFAULT 'invite',
  ADD COLUMN IF NOT EXISTS granted_admin_user_id uuid NULL,
  ADD COLUMN IF NOT EXISTS removal_reason text NULL;

DO $schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_team_members_granted_via_check') THEN
    ALTER TABLE public.brand_team_members
      ADD CONSTRAINT brand_team_members_granted_via_check
      CHECK (granted_via IN ('invite', 'mingla_admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_team_members_granted_admin_user_id_fkey') THEN
    ALTER TABLE public.brand_team_members
      ADD CONSTRAINT brand_team_members_granted_admin_user_id_fkey
      FOREIGN KEY (granted_admin_user_id) REFERENCES public.admin_users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_team_members_granted_admin_shape') THEN
    ALTER TABLE public.brand_team_members
      ADD CONSTRAINT brand_team_members_granted_admin_shape
      CHECK ((granted_via = 'mingla_admin') = (granted_admin_user_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_team_members_removal_reason_check') THEN
    ALTER TABLE public.brand_team_members
      ADD CONSTRAINT brand_team_members_removal_reason_check
      CHECK (removal_reason IS NULL OR removal_reason IN ('mingla_admin_revoked', 'mingla_team_removed'));
  END IF;
END;
$schema$;

CREATE INDEX IF NOT EXISTS idx_brand_team_members_issue_4579_auto_active
  ON public.brand_team_members (granted_admin_user_id)
  WHERE granted_via = 'mingla_admin' AND removed_at IS NULL;

COMMENT ON COLUMN public.brand_team_members.granted_via IS
  '#4579: invite = a normal membership; mingla_admin = added automatically because the user is an active Mingla admin. Clients cannot change it.';
COMMENT ON COLUMN public.brand_team_members.granted_admin_user_id IS
  '#4579: the admin_users row an automatic (mingla_admin) membership belongs to.';
COMMENT ON COLUMN public.brand_team_members.removal_reason IS
  '#4579: why an automatic membership ended (admin revoked, or the brand removed Mingla Team).';

-- The brand removed "Mingla Team": no automatic path adds any Mingla admin here.
CREATE TABLE IF NOT EXISTS public.brand_mingla_team_optouts (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  removed_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid NULL
);
ALTER TABLE public.brand_mingla_team_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_mingla_team_optouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.brand_mingla_team_optouts TO authenticated;
GRANT ALL ON public.brand_mingla_team_optouts TO service_role;
DROP POLICY IF EXISTS "issue_4579 brand team reads its Mingla Team opt-out" ON public.brand_mingla_team_optouts;
CREATE POLICY "issue_4579 brand team reads its Mingla Team opt-out"
  ON public.brand_mingla_team_optouts FOR SELECT TO authenticated
  USING (public.is_admin_user() OR public.biz_brand_effective_rank(brand_id, auth.uid()) > 0);
COMMENT ON TABLE public.brand_mingla_team_optouts IS
  '#4579: brands that removed Mingla Team. Written only by issue_4579_* functions; cleared only by the owner''s restore.';

-- A host removed a Mingla admin they had invited themselves: that person stays off
-- this brand until an accepted invite.
CREATE TABLE IF NOT EXISTS public.brand_mingla_admin_optouts (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  removed_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid NULL,
  PRIMARY KEY (brand_id, user_id)
);
ALTER TABLE public.brand_mingla_admin_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_mingla_admin_optouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.brand_mingla_admin_optouts TO authenticated;
GRANT ALL ON public.brand_mingla_admin_optouts TO service_role;
DROP POLICY IF EXISTS "issue_4579 admins read per-person opt-outs" ON public.brand_mingla_admin_optouts;
CREATE POLICY "issue_4579 admins read per-person opt-outs"
  ON public.brand_mingla_admin_optouts FOR SELECT TO authenticated
  USING (public.is_admin_user());
COMMENT ON TABLE public.brand_mingla_admin_optouts IS
  '#4579: a Mingla admin a host invited and then removed. No automatic grant re-adds them; an accepted invite clears it.';

-- Hosts never read auto rows straight from the table (their user ids would lead to
-- profiles). A RESTRICTIVE policy, so the #4423-pinned permissive policy
-- "Members and admins read brand_team_members" keeps its text; the effect is the
-- spec's: own row OR (brand admin+ AND not automatic) OR a Mingla admin. SELECT
-- policies also bound UPDATE/DELETE row reads, so a host cannot reach an auto row
-- with a direct write either.
DROP POLICY IF EXISTS "issue_4579 hosts never read automatic rows" ON public.brand_team_members;
CREATE POLICY "issue_4579 hosts never read automatic rows"
  ON public.brand_team_members AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    granted_via <> 'mingla_admin'
    OR user_id = (SELECT auth.uid())
    OR (SELECT public.is_admin_user())
  );

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- The auth user an admin_users row stands for, when that row qualifies
-- (role admin/owner, status active). NULL otherwise.
CREATE OR REPLACE FUNCTION public.issue_4579_qualifying_admin_uid(p_admin_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT u.id
    FROM public.admin_users au
    JOIN auth.users u ON lower(btrim(u.email::text)) = lower(btrim(au.email))
   WHERE au.id = p_admin_id
     AND au.role IN ('admin', 'owner')
     AND au.status = 'active'
   ORDER BY u.created_at, u.id
   LIMIT 1;
$function$;

-- An active automatic membership.
CREATE OR REPLACE FUNCTION public.issue_4579_is_auto_member(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.brand_team_members m
     WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
       AND m.granted_via = 'mingla_admin'
       AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
  );
$function$;

-- Shown with the Mingla mark: the user has ever had an automatic membership on
-- this brand (active or removed, so old messages keep the rule) and has no
-- active invited membership there.
CREATE OR REPLACE FUNCTION public.issue_4579_is_mingla_team_member(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_brand_id IS NOT NULL AND p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.brand_team_members m
        WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
          AND m.granted_via = 'mingla_admin'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.brand_team_members m
        WHERE m.brand_id = p_brand_id AND m.user_id = p_user_id
          AND m.granted_via = 'invite'
          AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
     );
$function$;

-- The only name hosts ever see for an auto-admin (spec v3 section 2). Reads
-- profiles.display_name, and the auth email only to refuse a handle. Falls back to
-- "Mingla Team"; never returns an email, handle or username.
CREATE OR REPLACE FUNCTION public.issue_4579_admin_public_name(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_d text;
  v_e text;
  v_h text;
BEGIN
  SELECT btrim(p.display_name), lower(btrim(u.email::text))
    INTO v_d, v_e
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.id = p_user_id;
  v_h := split_part(coalesce(v_e, ''), '@', 1);

  IF v_d IS NULL OR v_d = ''
     OR char_length(v_d) > 40
     OR v_d ~ '[[:cntrl:]]'
     OR position('@' IN v_d) > 0
     OR lower(v_d) = coalesce(v_e, '')
     OR v_d = v_h
     OR (position(' ' IN v_d) = 0
         AND v_d = lower(v_d)
         AND regexp_replace(lower(v_d), '[^a-z0-9]', '', 'g') = regexp_replace(v_h, '[^a-z0-9]', '', 'g'))
  THEN
    RETURN 'Mingla Team';
  END IF;
  RETURN v_d;
END;
$function$;

-- A brand-chat name: the public name for a Mingla Team member, else the fallback.
CREATE OR REPLACE FUNCTION public.issue_4579_brand_member_name(p_brand_id uuid, p_user_id uuid, p_fallback text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE WHEN public.issue_4579_is_mingla_team_member(p_brand_id, p_user_id)
              THEN public.issue_4579_admin_public_name(p_user_id)
              ELSE p_fallback END;
$function$;

-- Internal: the trigger guard flag. Automatic writers set it so the member
-- triggers below do not treat them as a host removal or an invite.
CREATE OR REPLACE FUNCTION public.issue_4579_auto_flag_on()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce(current_setting('app.issue_4579_auto', true), '') = 'on';
$function$;

-- Internal: an audit actor email for admin_audit_log (NOT NULL column).
CREATE OR REPLACE FUNCTION public.issue_4579_audit_actor()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT coalesce(
    (SELECT lower(btrim(u.email::text)) FROM auth.users u WHERE u.id = auth.uid()),
    'system:issue_4579'
  );
$function$;

-- Grant one admin on every live brand that has room for them.
CREATE OR REPLACE FUNCTION public.issue_4579_grant_admin(p_admin_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := public.issue_4579_qualifying_admin_uid(p_admin_id);
  v_prev text := coalesce(current_setting('app.issue_4579_auto', true), '');
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.issue_4579_auto', 'on', true);

  INSERT INTO public.brand_team_members
    (brand_id, user_id, role, invited_at, accepted_at, granted_via, granted_admin_user_id)
  SELECT b.id, v_uid, 'brand_admin', now(), now(), 'mingla_admin', p_admin_id
    FROM public.brands b
   WHERE b.deleted_at IS NULL
     AND b.account_id IS DISTINCT FROM v_uid
     AND NOT EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts t WHERE t.brand_id = b.id)
     AND NOT EXISTS (SELECT 1 FROM public.brand_mingla_admin_optouts o
                      WHERE o.brand_id = b.id AND o.user_id = v_uid)
     -- Any existing role is kept: never a downgrade, upgrade or marker change.
     AND NOT EXISTS (SELECT 1 FROM public.brand_team_members m
                      WHERE m.brand_id = b.id AND m.user_id = v_uid AND m.removed_at IS NULL)
  ON CONFLICT (brand_id, user_id) WHERE removed_at IS NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('app.issue_4579_auto', v_prev, true);

  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata, actor_uid)
  VALUES (public.issue_4579_audit_actor(), 'brand_access.auto_grant', 'admin_user', p_admin_id::text,
          jsonb_build_object('brands_granted', v_count), auth.uid());
  RETURN v_count;
END;
$function$;

-- Remove one admin's automatic memberships. Invited memberships are untouched.
CREATE OR REPLACE FUNCTION public.issue_4579_revoke_admin(p_admin_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_prev text := coalesce(current_setting('app.issue_4579_auto', true), '');
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.issue_4579_auto', 'on', true);

  -- A brand whose ownership has since passed to this person is theirs now: the
  -- row becomes an ordinary membership (removing a brand account is refused).
  UPDATE public.brand_team_members m
     SET granted_via = 'invite', granted_admin_user_id = NULL
    FROM public.brands b
   WHERE b.id = m.brand_id
     AND m.granted_admin_user_id = p_admin_id
     AND m.granted_via = 'mingla_admin'
     AND m.removed_at IS NULL
     AND b.account_id = m.user_id;

  UPDATE public.brand_team_members m
     SET removed_at = now(), removal_reason = 'mingla_admin_revoked'
   WHERE m.granted_admin_user_id = p_admin_id
     AND m.granted_via = 'mingla_admin'
     AND m.removed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('app.issue_4579_auto', v_prev, true);

  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata, actor_uid)
  VALUES (public.issue_4579_audit_actor(), 'brand_access.auto_revoke', 'admin_user', p_admin_id::text,
          jsonb_build_object('brands_revoked', v_count), auth.uid());
  RETURN v_count;
END;
$function$;

-- Grant every qualifying admin on one brand (a new brand, or the owner's restore).
CREATE OR REPLACE FUNCTION public.issue_4579_grant_brand(p_brand_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_prev text := coalesce(current_setting('app.issue_4579_auto', true), '');
  v_count integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts t WHERE t.brand_id = p_brand_id) THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.issue_4579_auto', 'on', true);

  INSERT INTO public.brand_team_members
    (brand_id, user_id, role, invited_at, accepted_at, granted_via, granted_admin_user_id)
  SELECT b.id, q.uid, 'brand_admin', now(), now(), 'mingla_admin', q.admin_id
    FROM public.brands b
    CROSS JOIN LATERAL (
      SELECT DISTINCT ON (uid) uid, admin_id FROM (
        SELECT au.id AS admin_id, public.issue_4579_qualifying_admin_uid(au.id) AS uid
          FROM public.admin_users au
         WHERE au.role IN ('admin', 'owner') AND au.status = 'active'
      ) s
      WHERE s.uid IS NOT NULL
      ORDER BY uid, admin_id
    ) q
   WHERE b.id = p_brand_id
     AND b.deleted_at IS NULL
     AND b.account_id IS DISTINCT FROM q.uid
     AND NOT EXISTS (SELECT 1 FROM public.brand_mingla_admin_optouts o
                      WHERE o.brand_id = b.id AND o.user_id = q.uid)
     AND NOT EXISTS (SELECT 1 FROM public.brand_team_members m
                      WHERE m.brand_id = b.id AND m.user_id = q.uid AND m.removed_at IS NULL)
  ON CONFLICT (brand_id, user_id) WHERE removed_at IS NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('app.issue_4579_auto', v_prev, true);
  RETURN v_count;
END;
$function$;

-- Internal: remove every automatic membership on a brand and write its tombstone.
CREATE OR REPLACE FUNCTION public.issue_4579_apply_mingla_team_removal(p_brand_id uuid, p_by uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_prev text := coalesce(current_setting('app.issue_4579_auto', true), '');
  v_count integer := 0;
BEGIN
  PERFORM set_config('app.issue_4579_auto', 'on', true);
  UPDATE public.brand_team_members m
     SET removed_at = now(), removal_reason = 'mingla_team_removed'
   WHERE m.brand_id = p_brand_id
     AND m.granted_via = 'mingla_admin'
     AND m.removed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.brand_mingla_team_optouts (brand_id, removed_at, removed_by)
  VALUES (p_brand_id, now(), p_by)
  ON CONFLICT (brand_id) DO NOTHING;
  PERFORM set_config('app.issue_4579_auto', v_prev, true);
  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Host RPCs for the one "Mingla Team" entry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4579_mingla_team_state(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rank integer;
  v_optout timestamptz;
  v_active_since timestamptz;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_uid);
  IF v_rank <= 0 THEN
    RAISE EXCEPTION 'brand_access_denied' USING ERRCODE = '42501';
  END IF;

  SELECT t.removed_at INTO v_optout FROM public.brand_mingla_team_optouts t WHERE t.brand_id = p_brand_id;
  SELECT min(m.accepted_at) INTO v_active_since
    FROM public.brand_team_members m
   WHERE m.brand_id = p_brand_id AND m.granted_via = 'mingla_admin'
     AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL;

  v_status := CASE WHEN v_optout IS NOT NULL THEN 'removed'
                   WHEN v_active_since IS NOT NULL THEN 'active'
                   ELSE 'none' END;
  RETURN jsonb_build_object(
    'status', v_status,
    'since', CASE v_status WHEN 'removed' THEN v_optout WHEN 'active' THEN v_active_since END,
    'can_remove', v_status = 'active' AND v_rank >= public.biz_role_rank('brand_admin'),
    'can_restore', v_status = 'removed' AND v_rank >= public.biz_role_rank('brand_owner')
  );
END;
$function$;

-- Anyone with remove-member rights (brand admin and up). Removes every automatic
-- membership and keeps Mingla off this brand. Never returns a head count.
CREATE OR REPLACE FUNCTION public.issue_4579_remove_mingla_team(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rank integer;
  v_removed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_uid);
  IF v_rank < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.brands b WHERE b.id = p_brand_id FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.brand_mingla_team_optouts t WHERE t.brand_id = p_brand_id)
     AND NOT EXISTS (SELECT 1 FROM public.brand_team_members m
                      WHERE m.brand_id = p_brand_id AND m.granted_via = 'mingla_admin'
                        AND m.removed_at IS NULL) THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  v_removed := public.issue_4579_apply_mingla_team_removal(p_brand_id, v_uid);
  IF v_removed > 0 THEN
    INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
    VALUES (v_uid, p_brand_id, 'mingla_team_removed', 'brand', p_brand_id::text,
            jsonb_build_object('by_rank', v_rank));
  END IF;
  RETURN jsonb_build_object('status', 'removed');
END;
$function$;

-- The brand owner only (so Mingla can never re-add itself).
CREATE OR REPLACE FUNCTION public.issue_4579_restore_mingla_team(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rank integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0001';
  END IF;
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_uid);
  IF v_rank < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.brands b WHERE b.id = p_brand_id FOR UPDATE;

  DELETE FROM public.brand_mingla_team_optouts t WHERE t.brand_id = p_brand_id;
  PERFORM public.issue_4579_grant_brand(p_brand_id);
  INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
  VALUES (v_uid, p_brand_id, 'mingla_team_restored', 'brand', p_brand_id::text, '{}'::jsonb);

  RETURN jsonb_build_object(
    'status',
    CASE WHEN EXISTS (SELECT 1 FROM public.brand_team_members m
                       WHERE m.brand_id = p_brand_id AND m.granted_via = 'mingla_admin'
                         AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)
         THEN 'active' ELSE 'none' END
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

-- New brand: every qualifying admin (never its owner; the owner row exists first,
-- biz_brand_owner_team_member_after_insert sorts before this trigger).
CREATE OR REPLACE FUNCTION public.issue_4579_tg_brand_auto_admins()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.issue_4579_grant_brand(NEW.id);
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS issue_4579_brand_auto_admins ON public.brands;
CREATE TRIGGER issue_4579_brand_auto_admins
  AFTER INSERT ON public.brands
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.issue_4579_tg_brand_auto_admins();

-- Admin status follows into brands. Errors propagate: an activation must fail
-- loudly rather than half-grant.
CREATE OR REPLACE FUNCTION public.issue_4579_tg_admin_status_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old_q boolean := false;
  v_new_q boolean := NEW.role IN ('admin', 'owner') AND NEW.status = 'active';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_q := OLD.role IN ('admin', 'owner') AND OLD.status = 'active';
  END IF;
  IF NOT v_old_q AND v_new_q THEN
    PERFORM public.issue_4579_grant_admin(NEW.id);
  ELSIF v_old_q AND NOT v_new_q THEN
    PERFORM public.issue_4579_revoke_admin(NEW.id);
  ELSIF v_old_q AND v_new_q AND TG_OP = 'UPDATE'
        AND lower(btrim(OLD.email)) IS DISTINCT FROM lower(btrim(NEW.email)) THEN
    PERFORM public.issue_4579_revoke_admin(NEW.id);
    PERFORM public.issue_4579_grant_admin(NEW.id);
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS issue_4579_admin_status_sync ON public.admin_users;
CREATE TRIGGER issue_4579_admin_status_sync
  AFTER INSERT OR UPDATE OF status, role, email ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.issue_4579_tg_admin_status_sync();

-- Clients never set the new columns. An invite accepted onto an automatic row
-- (accept_invite_and_transfer_brand_ownership reuses the newest row) turns it
-- into an ordinary membership, so a later admin revoke leaves it alone.
CREATE OR REPLACE FUNCTION public.issue_4579_tg_member_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.granted_via IS DISTINCT FROM OLD.granted_via
          OR NEW.granted_admin_user_id IS DISTINCT FROM OLD.granted_admin_user_id
          OR NEW.removal_reason IS DISTINCT FROM OLD.removal_reason) THEN
    RAISE EXCEPTION 'permission denied: how a membership was granted is set by Mingla only'
      USING ERRCODE = '42501';
  END IF;

  -- The flag is read inline: this trigger runs as the caller, who cannot
  -- execute the internal helpers.
  IF coalesce(current_setting('app.issue_4579_auto', true), '') <> 'on'
     AND OLD.granted_via = 'mingla_admin'
     AND NEW.granted_via = 'mingla_admin'
     AND (NEW.role IS DISTINCT FROM OLD.role
          OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
          OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)) THEN
    NEW.granted_via := 'invite';
    NEW.granted_admin_user_id := NULL;
    NEW.removal_reason := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS issue_4579_member_source ON public.brand_team_members;
CREATE TRIGGER issue_4579_member_source
  BEFORE UPDATE ON public.brand_team_members
  FOR EACH ROW EXECUTE FUNCTION public.issue_4579_tg_member_source();

-- Removal sticks; an accepted invite clears a per-person opt-out.
--   * an automatic row removed by any other path (biz_remove_brand_team_member,
--     a direct RLS update, admin_remove_team_member) removes all of Mingla Team
--     on that brand and writes the brand tombstone (hosts see one entry);
--   * a Mingla admin's invited row removed writes the per-person opt-out;
--   * a row becoming an active invited membership deletes that opt-out (never
--     the brand tombstone).
CREATE OR REPLACE FUNCTION public.issue_4579_tg_member_after()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF public.issue_4579_auto_flag_on() THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN
    IF NEW.granted_via = 'mingla_admin' THEN
      PERFORM public.issue_4579_apply_mingla_team_removal(NEW.brand_id, auth.uid());
      PERFORM set_config('app.issue_4579_auto', 'on', true);
      UPDATE public.brand_team_members m
         SET removal_reason = 'mingla_team_removed'
       WHERE m.id = NEW.id AND m.removal_reason IS NULL;
      PERFORM set_config('app.issue_4579_auto', '', true);
    ELSIF EXISTS (
      SELECT 1 FROM public.admin_users au
        JOIN auth.users u ON lower(btrim(u.email::text)) = lower(btrim(au.email))
       WHERE u.id = NEW.user_id
    ) THEN
      INSERT INTO public.brand_mingla_admin_optouts (brand_id, user_id, removed_at, removed_by)
      VALUES (NEW.brand_id, NEW.user_id, now(), auth.uid())
      ON CONFLICT (brand_id, user_id) DO NOTHING;
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.granted_via = 'invite'
     AND NEW.accepted_at IS NOT NULL AND NEW.removed_at IS NULL
     AND (TG_OP = 'INSERT'
          OR OLD.accepted_at IS NULL OR OLD.removed_at IS NOT NULL
          OR OLD.granted_via IS DISTINCT FROM 'invite') THEN
    DELETE FROM public.brand_mingla_admin_optouts o
     WHERE o.brand_id = NEW.brand_id AND o.user_id = NEW.user_id;
  END IF;
  RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS issue_4579_member_after ON public.brand_team_members;
CREATE TRIGGER issue_4579_member_after
  AFTER INSERT OR UPDATE ON public.brand_team_members
  FOR EACH ROW EXECUTE FUNCTION public.issue_4579_tg_member_after();

-- ---------------------------------------------------------------------------
-- 5. Host-facing readers (latest bodies from origin/main; only the #4579 lines change)
-- ---------------------------------------------------------------------------

-- Team & permissions (latest 20280404004271). Per-person rows exclude automatic
-- rows; ONE synthetic "Mingla Team" row stands for them (no id, email, avatar
-- or count).
DROP FUNCTION IF EXISTS public.biz_brand_team_members(uuid);
CREATE FUNCTION public.biz_brand_team_members(p_brand_id uuid)
 RETURNS TABLE(member_id uuid, user_id uuid, role text, display_name text, email text, avatar_url text, joined_at timestamp with time zone, entry_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.biz_brand_effective_rank(p_brand_id, auth.uid()) <= 0 THEN
    RAISE EXCEPTION 'brand_access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT entries.member_id, entries.user_id, entries.role, entries.display_name,
         entries.email, entries.avatar_url, entries.joined_at, entries.entry_kind
  FROM (
    SELECT m.id AS member_id,
           m.user_id,
           m.role,
           coalesce(
             nullif(btrim(ca.display_name), ''),
             nullif(btrim(p.display_name), ''),
             nullif(btrim(concat_ws(' ', nullif(btrim(p.first_name), ''),
                                         nullif(btrim(p.last_name), ''))), '')
           )::text AS display_name,
           coalesce(
             nullif(btrim(ca.email), ''),
             nullif(btrim(p.email), ''),
             nullif(btrim(u.email::text), '')
           )::text AS email,
           coalesce(nullif(btrim(ca.avatar_url), ''), nullif(btrim(p.avatar_url), ''))::text AS avatar_url,
           m.accepted_at AS joined_at,
           'member'::text AS entry_kind,
           0 AS sort_group
      FROM public.brand_team_members m
      LEFT JOIN public.creator_accounts ca ON ca.id = m.user_id AND ca.deleted_at IS NULL
      LEFT JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN auth.users u ON u.id = m.user_id
     WHERE m.brand_id = p_brand_id
       AND m.accepted_at IS NOT NULL
       AND m.removed_at IS NULL
       AND m.granted_via <> 'mingla_admin'
    UNION ALL
    -- issue_4579_: one entry however many Mingla admins are on the brand.
    SELECT NULL::uuid, NULL::uuid, 'brand_admin'::text, 'Mingla Team'::text,
           NULL::text, NULL::text, min(m.accepted_at), 'mingla_team'::text, 1
      FROM public.brand_team_members m
     WHERE m.brand_id = p_brand_id
       AND m.granted_via = 'mingla_admin'
       AND m.accepted_at IS NOT NULL
       AND m.removed_at IS NULL
    HAVING count(*) > 0
  ) entries
  ORDER BY entries.sort_group, entries.joined_at, entries.member_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_brand_team_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_brand_team_members(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.biz_brand_team_members(uuid) IS
  '#4271: accepted brand members with readable names and emails, for any accepted member of the brand. #4579: automatic Mingla admin rows appear only as one entry_kind=mingla_team row named "Mingla Team" (no id, email, avatar or count).';

-- Brand group People list (latest 20280207004173).
DROP FUNCTION IF EXISTS public.issue_4173_list_brand_group_members(uuid);
CREATE FUNCTION public.issue_4173_list_brand_group_members(p_conversation_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, email text, role text, is_mingla_team boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  SELECT roster.user_id, roster.display_name, roster.email, roster.role, roster.is_mingla_team
  FROM (
    SELECT
      member.user_id,
      CASE WHEN mt.is_mingla_team THEN public.issue_4579_admin_public_name(member.user_id)
      ELSE COALESCE(
        NULLIF(btrim(profile.display_name), ''),
        NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        NULLIF(btrim(profile.username), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'full_name'), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'name'), ''),
        split_part(identity.email, '@', 1),
        'Brand teammate'
      ) END::text AS display_name,
      CASE WHEN mt.is_mingla_team THEN NULL ELSE identity.email END::text AS email,
      member.role::text AS role,
      mt.is_mingla_team,
      CASE member.role
        WHEN 'brand_owner' THEN 0
        WHEN 'brand_admin' THEN 1
        WHEN 'event_manager' THEN 2
        WHEN 'finance_manager' THEN 3
        WHEN 'marketing_manager' THEN 4
        ELSE 5
      END AS role_order
    FROM public.brand_team_members member
    JOIN auth.users identity ON identity.id = member.user_id
    LEFT JOIN public.profiles profile ON profile.id = member.user_id
    CROSS JOIN LATERAL (
      SELECT public.issue_4579_is_mingla_team_member(v_brand_id, member.user_id) AS is_mingla_team
    ) mt
    WHERE member.brand_id = v_brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  ) roster
  ORDER BY roster.role_order, lower(roster.display_name), roster.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4173_list_brand_group_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4173_list_brand_group_members(uuid) TO authenticated, service_role;

-- @mention candidates (latest 20271218013988). Auto-admins stay mentionable.
DROP FUNCTION IF EXISTS public.issue_3988_list_brand_group_mention_candidates(uuid, text, integer);
CREATE FUNCTION public.issue_3988_list_brand_group_mention_candidates(p_conversation_id uuid, p_query text DEFAULT ''::text, p_limit integer DEFAULT 8)
 RETURNS TABLE(user_id uuid, display_name text, username text, is_mingla_team boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
      CASE WHEN mt.is_mingla_team THEN public.issue_4579_admin_public_name(member.user_id)
      ELSE COALESCE(
        NULLIF(btrim(profile.display_name), ''),
        NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        NULLIF(btrim(profile.username), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'full_name'), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'name'), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'display_name'), ''),
        'Brand teammate'
      ) END::text AS display_name,
      CASE WHEN mt.is_mingla_team THEN NULL ELSE NULLIF(btrim(profile.username), '') END::text AS username,
      mt.is_mingla_team
    FROM public.brand_team_members member
    JOIN auth.users identity ON identity.id = member.user_id
    LEFT JOIN public.profiles profile ON profile.id = member.user_id
    CROSS JOIN LATERAL (
      SELECT public.issue_4579_is_mingla_team_member(v_brand_id, member.user_id) AS is_mingla_team
    ) mt
    WHERE member.brand_id = v_brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
      AND member.user_id IS DISTINCT FROM v_actor
  )
  SELECT candidate.user_id, candidate.display_name, candidate.username, candidate.is_mingla_team
  FROM candidates candidate
  WHERE v_query = ''
     OR lower(candidate.display_name) LIKE '%' || v_query || '%'
     OR lower(COALESCE(candidate.username, '')) LIKE '%' || v_query || '%'
  ORDER BY lower(candidate.display_name), candidate.user_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3988_list_brand_group_mention_candidates(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3988_list_brand_group_mention_candidates(uuid, text, integer) TO authenticated, service_role;

-- Messages (latest 20271223004111). A support reply ("Mingla Support" role
-- snapshot) keeps its stored name; any other message from a Mingla Team member
-- shows the public name, never the send-time snapshot (which can be a handle).
DROP FUNCTION IF EXISTS public.issue_3720_list_brand_group_messages(uuid, integer, timestamp with time zone);
CREATE FUNCTION public.issue_3720_list_brand_group_messages(p_conversation_id uuid, p_limit integer DEFAULT 80, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, conversation_id uuid, sender_id uuid, content text, created_at timestamp with time zone, reply_to_id uuid, related_message_ids uuid[], sender_display_name text, sender_role text, reply_content text, reply_sender_display_name text, message_type text, file_id uuid, file_name text, file_size bigint, file_mime text, card_payload jsonb, sender_is_mingla_team boolean, reply_sender_is_mingla_team boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand_id uuid;
BEGIN
  IF NOT public.issue_3720_brand_group_can_access(p_conversation_id,auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE='42501';
  END IF;
  SELECT c.brand_id INTO v_brand_id FROM public.conversations c WHERE c.id = p_conversation_id;
  RETURN QUERY
  SELECT m.id,m.conversation_id,m.sender_id,m.content,m.created_at,m.reply_to_id,m.related_message_ids,
    CASE WHEN sender_mt.is_mingla_team THEN public.issue_4579_admin_public_name(m.sender_id)
    ELSE COALESCE(NULLIF(btrim(m.sender_display_name_snapshot),''),NULLIF(btrim(p.display_name),''),
      NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''),NULLIF(btrim(p.username),''),'Mingla member') END,
    NULLIF(btrim(m.sender_role_snapshot),''),reply.content,
    CASE WHEN reply_mt.is_mingla_team THEN public.issue_4579_admin_public_name(reply.sender_id)
    ELSE COALESCE(NULLIF(btrim(reply.sender_display_name_snapshot),''),NULLIF(btrim(reply_profile.display_name),''),
      NULLIF(btrim(concat_ws(' ',reply_profile.first_name,reply_profile.last_name)),''),
      NULLIF(btrim(reply_profile.username),''),'Mingla member') END,
    m.message_type::text,f.id,f.original_filename,f.verified_size_bytes,f.verified_mime,
    CASE WHEN m.message_type::text = 'brand_enquiry_card'
      THEN jsonb_build_object(
        'kind', 'brand_enquiry_card',
        'enquiry_id', m.card_payload->>'enquiry_id',
        'topic_label', m.card_payload->>'topic_label')
    END,
    sender_mt.is_mingla_team,
    coalesce(reply_mt.is_mingla_team, false)
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id=m.sender_id
  LEFT JOIN public.messages reply ON reply.id=m.reply_to_id AND reply.conversation_id=m.conversation_id
  LEFT JOIN public.profiles reply_profile ON reply_profile.id=reply.sender_id
  LEFT JOIN public.brand_group_files f ON f.message_id=m.id AND f.state='ready'
  CROSS JOIN LATERAL (
    SELECT coalesce(m.sender_role_snapshot, '') <> 'Mingla Support'
       AND public.issue_4579_is_mingla_team_member(v_brand_id, m.sender_id) AS is_mingla_team
  ) sender_mt
  LEFT JOIN LATERAL (
    SELECT coalesce(reply.sender_role_snapshot, '') <> 'Mingla Support'
       AND public.issue_4579_is_mingla_team_member(v_brand_id, reply.sender_id) AS is_mingla_team
     WHERE reply.id IS NOT NULL
  ) reply_mt ON true
  WHERE m.conversation_id=p_conversation_id AND m.deleted_at IS NULL
    AND (p_before IS NULL OR m.created_at<p_before)
  ORDER BY m.created_at DESC,m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,80),1),200);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_list_brand_group_messages(uuid, integer, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_group_messages(uuid, integer, timestamp with time zone) TO authenticated, service_role;

-- Read receipts (latest 20280426004304).
DROP FUNCTION IF EXISTS public.issue_4304_list_brand_group_read_state(uuid);
CREATE FUNCTION public.issue_4304_list_brand_group_read_state(p_conversation_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, last_read_at timestamp with time zone, is_mingla_team boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    CASE WHEN mt.is_mingla_team THEN public.issue_4579_admin_public_name(read_state.user_id)
    ELSE COALESCE(
      NULLIF(btrim(profile.display_name), ''),
      NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      NULLIF(btrim(profile.username), ''),
      'Brand teammate'
    ) END::text,
    read_state.last_read_at,
    mt.is_mingla_team
  FROM public.brand_group_reads read_state
  JOIN public.brand_team_members member
    ON member.brand_id = v_brand_id
   AND member.user_id = read_state.user_id
   AND member.accepted_at IS NOT NULL
   AND member.removed_at IS NULL
  LEFT JOIN public.profiles profile ON profile.id = read_state.user_id
  CROSS JOIN LATERAL (
    SELECT public.issue_4579_is_mingla_team_member(v_brand_id, read_state.user_id) AS is_mingla_team
  ) mt
  WHERE read_state.conversation_id = p_conversation_id
    AND read_state.user_id <> v_actor
    AND read_state.last_read_at > 'epoch'::timestamptz
  ORDER BY read_state.last_read_at DESC, read_state.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4304_list_brand_group_read_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4304_list_brand_group_read_state(uuid) TO authenticated, service_role;

-- Group list preview (latest 20280426004304). member_count counts each person.
DROP FUNCTION IF EXISTS public.issue_3720_list_brand_groups();
CREATE FUNCTION public.issue_3720_list_brand_groups()
 RETURNS TABLE(conversation_id uuid, brand_id uuid, brand_name text, brand_slug text, brand_photo_url text, last_message_at timestamp with time zone, last_message_preview text, unread_count bigint, member_count bigint, access_kind text, push_enabled boolean, muted boolean, last_message_sender_id uuid, last_message_sender_name text, last_message_type text, last_message_sender_is_mingla_team boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
    last_message.message_type,
    COALESCE(last_message.is_mingla_team, false)
  FROM caller
  JOIN public.conversations c ON c.linked_entity_type='brand' AND c.is_enabled IS TRUE
  JOIN public.brands b ON b.id=c.brand_id AND b.deleted_at IS NULL
  LEFT JOIN public.brand_group_reads read_state
    ON read_state.conversation_id=c.id AND read_state.user_id=caller.user_id
  LEFT JOIN LATERAL (
    SELECT m.content, m.sender_id, m.message_type::text AS message_type,
      CASE WHEN mt.is_mingla_team THEN public.issue_4579_admin_public_name(m.sender_id)
      ELSE COALESCE(NULLIF(btrim(m.sender_display_name_snapshot),''),
        NULLIF(btrim(p.display_name),''),
        NULLIF(btrim(concat_ws(' ',p.first_name,p.last_name)),''),
        NULLIF(btrim(p.username),''),
        CASE WHEN m.sender_id IS NULL THEN NULL ELSE 'Mingla member' END) END AS sender_name,
      mt.is_mingla_team
    FROM public.messages m
    LEFT JOIN public.profiles p ON p.id=m.sender_id
    CROSS JOIN LATERAL (
      SELECT coalesce(m.sender_role_snapshot, '') <> 'Mingla Support'
         AND public.issue_4579_is_mingla_team_member(c.brand_id, m.sender_id) AS is_mingla_team
    ) mt
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
    last_message.is_mingla_team,
    read_state.push_enabled,read_state.muted,caller.user_id,caller.is_support
  ORDER BY c.last_message_at DESC NULLS LAST, lower(b.name), b.id;
$function$;
REVOKE ALL ON FUNCTION public.issue_3720_list_brand_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_list_brand_groups() TO authenticated, service_role;

-- Media and files (latest 20271216003988). Same output shape plus is_mingla_team.
CREATE OR REPLACE FUNCTION public.issue_3988_list_brand_group_media(p_conversation_id uuid, p_kind text, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 60), 1), 100);
  v_result jsonb;
  v_brand_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.issue_3720_brand_group_can_access(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('media', 'files') THEN
    RAISE EXCEPTION 'media_kind_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_cursor_created_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'media_cursor_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT c.brand_id INTO v_brand_id FROM public.conversations c WHERE c.id = p_conversation_id;

  WITH base AS MATERIALIZED (
    SELECT
      f.id,
      f.message_id,
      f.original_filename,
      f.verified_mime,
      f.verified_size_bytes,
      f.created_at,
      f.media_duration_ms,
      f.media_width,
      f.media_height,
      f.thumb_state,
      CASE WHEN mt.is_mingla_team THEN public.issue_4579_admin_public_name(m.sender_id)
      ELSE COALESCE(
        NULLIF(btrim(m.sender_display_name_snapshot), ''),
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
        NULLIF(btrim(p.username), ''),
        'Mingla member'
      ) END AS sender_display_name,
      NULLIF(btrim(m.sender_role_snapshot), '') AS sender_role,
      mt.is_mingla_team,
      CASE
        WHEN f.verified_mime LIKE 'image/%' THEN 'image'
        WHEN f.verified_mime LIKE 'video/%' THEN 'video'
        ELSE 'file'
      END AS media_kind
    FROM public.brand_group_files f
    JOIN public.messages m
      ON m.id = f.message_id
     AND m.conversation_id = p_conversation_id
     AND m.deleted_at IS NULL
    LEFT JOIN public.profiles p ON p.id = m.sender_id
    CROSS JOIN LATERAL (
      SELECT coalesce(m.sender_role_snapshot, '') <> 'Mingla Support'
         AND public.issue_4579_is_mingla_team_member(v_brand_id, m.sender_id) AS is_mingla_team
    ) mt
    WHERE f.conversation_id = p_conversation_id
      AND f.state = 'ready'
  ), candidates AS MATERIALIZED (
    SELECT
      base.*,
      row_number() OVER (ORDER BY base.created_at DESC, base.id DESC) AS ordinal
    FROM base
    WHERE (
      (p_kind = 'media' AND media_kind IN ('image', 'video'))
      OR (p_kind = 'files' AND media_kind = 'file')
    )
      AND (
        p_cursor_created_at IS NULL
        OR (base.created_at, base.id) < (p_cursor_created_at, p_cursor_id)
      )
    ORDER BY base.created_at DESC, base.id DESC
    LIMIT v_limit + 1
  ), page_rows AS (
    SELECT * FROM candidates WHERE ordinal <= v_limit
  ), page AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'fileId', id,
          'messageId', message_id,
          'name', original_filename,
          'mime', verified_mime,
          'sizeBytes', verified_size_bytes,
          'createdAt', created_at,
          'senderDisplayName', sender_display_name,
          'senderRole', sender_role,
          'is_mingla_team', is_mingla_team,
          'kind', media_kind,
          'durationMs', media_duration_ms,
          'width', media_width,
          'height', media_height,
          'thumbState', thumb_state
        ) ORDER BY created_at DESC, id DESC
      ),
      '[]'::jsonb
    ) AS rows
    FROM page_rows
  ), next_cursor AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM candidates WHERE ordinal > v_limit) THEN (
        SELECT jsonb_build_object('createdAt', created_at, 'id', id)
        FROM page_rows
        ORDER BY ordinal DESC
        LIMIT 1
      )
      ELSE NULL
    END AS value
  ), totals AS (
    SELECT
      count(*) FILTER (WHERE media_kind IN ('image', 'video'))::integer AS media,
      count(*) FILTER (WHERE media_kind = 'file')::integer AS files
    FROM base
  )
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'totals', jsonb_build_object('media', totals.media, 'files', totals.files),
    'rows', page.rows,
    'nextCursor', next_cursor.value
  )
  INTO v_result
  FROM totals CROSS JOIN page CROSS JOIN next_cursor;

  RETURN v_result;
END;
$function$;

-- Mingla's internal mentions feed (latest 20271102003720). Only Mingla's own team
-- can call it, and team_mentions carry no brand, so the name stays the internal
-- one; the is_mingla_team key marks an actor who is an active Mingla admin.
CREATE OR REPLACE FUNCTION public.issue_3720_list_team_mentions(p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        'is_mingla_team', public.issue_4579_is_active_mingla_admin_email(page.actor_email),
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
$function$;

-- Door-read log (latest 20281122004541).
CREATE OR REPLACE FUNCTION public.biz_brand_form_door_reads(p_event_id uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_brand uuid;
BEGIN
  SELECT e.brand_id INTO v_brand FROM public.events e WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF v_brand IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.brand_form_require_rank(v_brand, 'event_manager');
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'limit_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'at', d.created_at,
             'actorName', CASE WHEN mt.is_mingla_team
               THEN public.issue_4579_admin_public_name(d.actor_id)
               ELSE public.brand_form_short_name(COALESCE(
                 NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.display_name)) END,
             'actorIsMinglaTeam', mt.is_mingla_team,
             'guestName', public.brand_form_short_name(
               public.brand_form_subject_contact(d.subject_kind, d.subject_id)->>'name'),
             'via', d.via, 'result', d.result)
           ORDER BY d.created_at DESC, d.id DESC)
      FROM (SELECT * FROM public.brand_form_door_reads d0
             WHERE d0.event_id = p_event_id AND (p_before IS NULL OR d0.created_at < p_before)
             ORDER BY d0.created_at DESC, d0.id DESC LIMIT p_limit) d
      LEFT JOIN public.profiles pr ON pr.id = d.actor_id
      CROSS JOIN LATERAL (
        SELECT public.issue_4579_is_mingla_team_member(v_brand, d.actor_id) AS is_mingla_team
      ) mt), '[]'::jsonb);
END;
$function$;

-- Guest chat: the team's view of who wrote a brand post. Replaces the client's
-- direct profiles read (which returned handles), keyed by message id.
CREATE OR REPLACE FUNCTION public.issue_4579_brand_guest_post_authors(p_conversation_id uuid, p_message_ids uuid[])
RETURNS TABLE(message_id uuid, author_id uuid, author_name text, is_mingla_team boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4459_rls_i_run_guest_chat(p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT c.brand_id INTO v_brand_id FROM public.conversations c WHERE c.id = p_conversation_id;
  RETURN QUERY
  SELECT a.message_id, a.author_id,
         CASE WHEN mt.is_mingla_team THEN public.issue_4579_admin_public_name(a.author_id)
         ELSE coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.first_name), ''),
                       nullif(btrim(p.username), ''), 'A teammate') END::text,
         mt.is_mingla_team
    FROM public.brand_guest_post_authors a
    LEFT JOIN public.profiles p ON p.id = a.author_id
    CROSS JOIN LATERAL (
      SELECT public.issue_4579_is_mingla_team_member(v_brand_id, a.author_id) AS is_mingla_team
    ) mt
   WHERE a.conversation_id = p_conversation_id
     AND a.message_id = ANY (coalesce(p_message_ids, ARRAY[]::uuid[]))
     AND a.author_id IS NOT NULL;
END;
$function$;

-- Internal: whether an email is an active Mingla admin (the internal mentions feed).
CREATE OR REPLACE FUNCTION public.issue_4579_is_active_mingla_admin_email(p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.admin_users au
     WHERE lower(btrim(au.email)) = lower(btrim(p_email))
       AND au.role IN ('admin', 'owner') AND au.status = 'active'
  );
$function$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Internal helpers are not callable by clients.
-- ---------------------------------------------------------------------------
DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname LIKE 'issue\_4579\_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF r.proname IN (
      'issue_4579_is_auto_member', 'issue_4579_is_mingla_team_member',
      'issue_4579_admin_public_name', 'issue_4579_brand_member_name',
      'issue_4579_mingla_team_state', 'issue_4579_remove_mingla_team',
      'issue_4579_restore_mingla_team', 'issue_4579_brand_guest_post_authors'
    ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END;
$grants$;

-- ---------------------------------------------------------------------------
-- 7. Backfill: every qualifying admin on every live brand. Idempotent: a re-run
--    inserts nothing (an active row of any role, an opt-out or a tombstone
--    always skips).
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE r record; v_total integer := 0;
BEGIN
  FOR r IN SELECT au.id FROM public.admin_users au
            WHERE au.role IN ('admin', 'owner') AND au.status = 'active'
            ORDER BY au.created_at, au.id
  LOOP
    v_total := v_total + public.issue_4579_grant_admin(r.id);
  END LOOP;
  RAISE NOTICE 'issue #4579 backfill: % automatic memberships added', v_total;
END;
$backfill$;
