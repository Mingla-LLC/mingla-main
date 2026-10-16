-- Issue #3720 — expose narrowly scoped Community & Support capabilities to the
-- Mingla Admin client without widening any team role or full-admin authority.
--
-- Existing support_staff/community_staff rows become effective immediately;
-- there is no data backfill. A person must also be an active Admin team member.
-- is_admin_user(), admin_team_role_areas(), and admin_team_my_access() are not
-- replaced or changed by this migration.
--
BEGIN;
SET LOCAL lock_timeout = '10s';

SELECT set_config(
  'issue3720_access.is_admin_user_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure),
  true
);
SELECT set_config(
  'issue3720_access.role_areas_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_role_areas(text)'::regprocedure),
  true
);
SELECT set_config(
  'issue3720_access.my_access_md5',
  (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_access()'::regprocedure),
  true
);

CREATE OR REPLACE FUNCTION public.admin_team_my_operational_areas()
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_areas text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL OR public.admin_team_role() IS NULL THEN
    RETURN v_areas;
  END IF;

  IF public.is_admin_user() THEN
    RETURN ARRAY[
      'community_support',
      'community_support_support',
      'community_support_community'
    ];
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.support_staff s
     WHERE s.user_id = auth.uid()
       AND s.enabled = true
  ) THEN
    v_areas := v_areas || ARRAY['community_support', 'community_support_support'];
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.community_staff s
     WHERE s.user_id = auth.uid()
       AND s.enabled = true
  ) THEN
    IF NOT ('community_support' = ANY(v_areas)) THEN
      v_areas := array_append(v_areas, 'community_support');
    END IF;
    v_areas := array_append(v_areas, 'community_support_community');
  END IF;

  RETURN v_areas;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_team_my_operational_areas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_my_operational_areas() TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_team_my_operational_areas() IS
  'Issue #3720. Server-owned Community and Support capabilities for active Admin team members. Never returns admin_console and never replaces admin_team_role_areas().';

DO $guard$
BEGIN
  IF current_setting('issue3720_access.is_admin_user_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.is_admin_user()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_is_admin_user_changed';
  END IF;
  IF current_setting('issue3720_access.role_areas_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_role_areas(text)'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_admin_team_role_areas_changed';
  END IF;
  IF current_setting('issue3720_access.my_access_md5') IS DISTINCT FROM
     (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.admin_team_my_access()'::regprocedure) THEN
    RAISE EXCEPTION 'issue3720_admin_team_my_access_changed';
  END IF;
  IF has_function_privilege('anon', 'public.admin_team_my_operational_areas()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_team_my_operational_areas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3720_operational_access_acl_invalid';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
COMMIT;
