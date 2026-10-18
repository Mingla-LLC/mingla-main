-- Issue #3697 v1.4 — cache-safe Host Ads action authority.
--
-- This authority is additive and intentionally lands after the immutable plan
-- schema but before the caller-bound Ari adapter. PR migration snapshots apply
-- new filenames rather than replaying an amended filename, so keeping the
-- function in its own migration makes both a fresh database and a previously
-- cached PR database converge on the same fail-closed role contract.
--
-- Do NOT auto-apply. Release only through the reviewed governed migration lane.

BEGIN;

-- Reusing the payout/bank predicate collapsed unrelated authority (planning,
-- funding, launch, pause and end) into one boolean and excluded marketing
-- managers from read access. Keep this service-role-only: edge functions
-- authenticate the user and pass the exact actor id; clients only mirror it
-- for UX.
CREATE OR REPLACE FUNCTION public.ad_can_host_action(
  p_brand_id uuid,
  p_user_id uuid,
  p_action text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_permissions jsonb := '{}'::jsonb;
  v_is_owner boolean := false;
BEGIN
  IF p_brand_id IS NULL OR p_user_id IS NULL
     OR p_action NOT IN ('read','plan','fund','launch','pause','end') THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.account_id = p_user_id
      AND b.deleted_at IS NULL
  ) INTO v_is_owner;
  IF v_is_owner THEN RETURN true; END IF;

  SELECT m.role, coalesce(m.permissions_override, '{}'::jsonb)
    INTO v_role, v_permissions
  FROM public.brand_team_members m
  JOIN public.brands b ON b.id = m.brand_id
  WHERE m.brand_id = p_brand_id
    AND m.user_id = p_user_id
    AND m.removed_at IS NULL
    AND m.accepted_at IS NOT NULL
    AND b.deleted_at IS NULL
  ORDER BY public.biz_role_rank(m.role) DESC, m.id
  LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;

  RETURN CASE p_action
    WHEN 'read' THEN
      v_role IN ('brand_admin','marketing_manager','finance_manager')
      OR v_permissions->'ads_view' = 'true'::jsonb
    WHEN 'plan' THEN
      v_role IN ('brand_admin','marketing_manager')
      OR v_permissions->'ads_plan' = 'true'::jsonb
    WHEN 'fund' THEN
      v_role = 'finance_manager'
      OR v_permissions->'ads_fund' = 'true'::jsonb
      OR v_permissions->'ads_spend' = 'true'::jsonb
    WHEN 'launch' THEN
      (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_launch' = 'true'::jsonb
    WHEN 'pause' THEN
      (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_pause' = 'true'::jsonb
    WHEN 'end' THEN false
    ELSE false
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  TO service_role;
COMMENT ON FUNCTION public.ad_can_host_action(uuid,uuid,text) IS
  'Issue #3697 v1.4: independent Host Ads read/plan/fund/launch/pause/end authority. Brand owner may do all; finance can fund; marketing can plan and launch/pause only with ads_spend; direct end remains owner-only.';

COMMIT;
