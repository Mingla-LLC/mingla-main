-- ORCH-0526 M4.1 — admin_get_feature_flags(p_keys TEXT[])
--
-- SECURITY DEFINER wrapper that lets authenticated admin users read a scoped
-- subset of admin_config flags. Without this, admin UI can't read the table
-- because admin_config RLS only allows service_role.
--
-- Scoped to an explicit key list to keep the surface narrow — admin_config
-- can hold operational/cost flags unrelated to feature-gating and we don't
-- want wildcard reads through this RPC.
--
-- Mirrors the admin_users gate used by all 12 rules-engine admin RPCs.

CREATE OR REPLACE FUNCTION public.admin_get_feature_flags(p_keys TEXT[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = lower(auth.email()) AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_result
  FROM public.admin_config
  WHERE key = ANY(p_keys);

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_get_feature_flags(TEXT[]) TO authenticated;

-- Verification probe (uncomment in Supabase SQL editor to test):
-- SELECT public.admin_get_feature_flags(ARRAY['enable_rules_filter_tab']);
-- → expect {"enable_rules_filter_tab": false} for an active admin,
--   {"code":"P0001", "message":"Admin access required"} for a non-admin.
