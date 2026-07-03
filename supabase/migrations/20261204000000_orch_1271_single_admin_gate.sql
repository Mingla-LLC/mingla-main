-- ORCH-1271 [Admin authorization & audit FOUNDATION] — (1) Single-gate standardization.
--
-- Canonical decision (DEC — single admin gate): public.is_admin_user() is THE
-- admin-identity gate for every META-ORCH-1237 in-scope table. The split gate
-- profiles.account_type = 'admin' is RETIRED from all in-scope RLS.
--
-- Evidence the split is small + safe to flip (verified against live PROD
-- gqnoajqerqhnvulmnyvv, 2026-07-03): EXACTLY TWO policies in the entire public
-- schema reference account_type = 'admin', both SELECT-only, each an OR-branch
-- alongside a self-access branch:
--   * partner_splits / partner_splits_partner_self_select
--   * partner_stripe_connect_accounts / partner_stripe_self_select
-- profiles.account_type = 'admin' currently has exactly 1 row (Seth) — so the
-- split gate works today only by accident of Seth's dual flag. The moment a new
-- admin_users admin lacks account_type='admin' on their profile they silently
-- lose partner-money read. Flipping to is_admin_user() removes that drift.
--
-- This migration ONLY reconciles the two existing split-gate SELECT policies;
-- it adds NO admin RLS to any new business table (that is domain work — ORCH
-- 1272/1273/1274). The self-access branches are preserved VERBATIM; only the
-- profiles.account_type='admin' EXISTS(...) branch is replaced by
-- public.is_admin_user().
--
-- Enforces: I-PROPOSED-1271-ADMIN-SINGLE-GATE.

--------------------------------------------------------------------------------
-- 1. partner_stripe_connect_accounts — SELF (account_id) OR is_admin_user().
--    Prior admin-branch: EXISTS(profiles WHERE id=auth.uid() AND account_type='admin').
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS partner_stripe_self_select
  ON public.partner_stripe_connect_accounts;
CREATE POLICY partner_stripe_self_select
  ON public.partner_stripe_connect_accounts
  FOR SELECT
  USING (
    account_id = auth.uid()
    OR public.is_admin_user()
  );

--------------------------------------------------------------------------------
-- 2. partner_splits — SELF (partner_account_id) OR brand-team-member EXISTS
--    (preserved verbatim) OR is_admin_user().
--    Prior admin-branch: EXISTS(profiles WHERE id=auth.uid() AND account_type='admin').
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS partner_splits_partner_self_select
  ON public.partner_splits;
CREATE POLICY partner_splits_partner_self_select
  ON public.partner_splits
  FOR SELECT
  USING (
    partner_account_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.brand_team_members btm
       WHERE btm.brand_id = partner_splits.brand_id
         AND btm.user_id = auth.uid()
         AND btm.role IN ('brand_owner', 'brand_admin')
         AND btm.accepted_at IS NOT NULL
         AND btm.removed_at IS NULL
    )
    OR public.is_admin_user()
  );

--------------------------------------------------------------------------------
-- 3. Self-assert (I-ADMIN-SINGLE-GATE): apply FAILS if any policy in the public
--    schema still references the split gate account_type = 'admin'.
--------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND (
         COALESCE(qual, '')       ILIKE '%account_type%''admin''%'
         OR COALESCE(with_check, '') ILIKE '%account_type%''admin''%'
       )
  ) THEN
    RAISE EXCEPTION 'I-ADMIN-SINGLE-GATE violated: account_type=admin policy still present';
  END IF;
END $$;
