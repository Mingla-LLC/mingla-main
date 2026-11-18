-- Issue #4238 (ads roles, approved 18 Nov 2026): who can fund and who can
-- withdraw Host Ads credit.
--
-- 1. ad_can_host_action: 'fund' is also true for a brand admin, so an admin
--    who can launch can also hold the ad's budget and change a live ad's
--    budget. Every other answer is identical to 20280803004238.
-- 2. ad_can_withdraw_credit(brand, user): withdrawing Ads credit is for the
--    brand owner or an accepted, active finance_manager. ad-credit uses it
--    for quote_withdraw and apply_withdraw; top-up keeps
--    biz_can_manage_payments_for_brand, which is NOT changed here (refunds,
--    payouts, readiness and Ari money tools also use it).
--
-- Applied manually by Seth through the reviewed governed migration lane.
-- Do NOT auto-apply.

BEGIN;

-- ── 1. Host ad authority: brand admins also fund ───────────────────────────
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
  -- #4238 P3-1: a NULL action is refused before the owner shortcut
  -- (NULL NOT IN (...) is NULL, which skipped this guard).
  IF p_brand_id IS NULL OR p_user_id IS NULL OR p_action IS NULL
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

  -- Every answer is true or false (a missing permission key is false).
  RETURN COALESCE(CASE p_action
    WHEN 'read' THEN
      v_role IN ('brand_admin','marketing_manager','finance_manager')
      OR v_permissions->'ads_view' = 'true'::jsonb
    WHEN 'plan' THEN
      v_role IN ('brand_admin','marketing_manager')
      OR v_permissions->'ads_plan' = 'true'::jsonb
    WHEN 'fund' THEN
      -- #4238 ads roles: brand admins fund (launch holds the budget first).
      v_role IN ('brand_admin','finance_manager')
      OR v_permissions->'ads_fund' = 'true'::jsonb
      OR v_permissions->'ads_spend' = 'true'::jsonb
    WHEN 'launch' THEN
      v_role = 'brand_admin'
      OR (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_launch' = 'true'::jsonb
    WHEN 'pause' THEN
      v_role = 'brand_admin'
      OR (v_role = 'marketing_manager'
        AND v_permissions->'ads_spend' = 'true'::jsonb)
      OR v_permissions->'ads_pause' = 'true'::jsonb
    WHEN 'end' THEN false
    ELSE false
  END, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_can_host_action(uuid,uuid,text)
  TO service_role;
COMMENT ON FUNCTION public.ad_can_host_action(uuid,uuid,text) IS
  'Issue #3697 v1.4 + #4238: independent Host Ads read/plan/fund/launch/pause/end authority. Brand owner may do all; brand admins plan, fund, launch and pause; finance can fund; marketing can plan and fund/launch/pause only with ads_spend; direct end remains owner-only.';

-- ── 2. Withdrawing Ads credit: owner or Finance ────────────────────────────
CREATE OR REPLACE FUNCTION public.ad_can_withdraw_credit(
  p_brand_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    p_brand_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND b.account_id = p_user_id
          AND b.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.brand_team_members m
        JOIN public.brands b ON b.id = m.brand_id
        WHERE m.brand_id = p_brand_id
          AND m.user_id = p_user_id
          AND m.role = 'finance_manager'
          AND m.removed_at IS NULL
          AND m.accepted_at IS NOT NULL
          AND b.deleted_at IS NULL
      )
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.ad_can_withdraw_credit(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_can_withdraw_credit(uuid,uuid)
  TO service_role;
COMMENT ON FUNCTION public.ad_can_withdraw_credit(uuid,uuid) IS
  'Issue #4238 ads roles: withdrawing Host Ads credit is for the brand owner or an accepted, active finance_manager. Used by ad-credit quote_withdraw / apply_withdraw and the Host ad capabilities.';

COMMIT;
