-- =====================================================================
-- Cycle 13b Q5 — audit_log brand_admin+ SELECT policy
-- =====================================================================
-- Today's RLS scopes audit_log SELECT to user_id = auth.uid() only.
-- Brand admins want to see all team members' actions on brands they belong to.
-- This new policy STACKS on the existing self-only policy via PostgreSQL
-- multi-policy OR-merge (caller passes if ANY SELECT policy returns true).
--
-- Helper biz_is_brand_admin_plus_for_caller exists at PR #59 line 327
-- (SECURITY DEFINER; reads brand_team_members.role + biz_role_rank threshold).
--
-- Per Cycle 13b SPEC §4.1.2.

CREATE POLICY "Brand admin plus reads brand audit_log"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (public.biz_is_brand_admin_plus_for_caller(brand_id));
