-- ORCH-0734 — RLS-RETURNING-OWNER-GAP fix for public.brands
--
-- Closes RC-0728 (proven 2026-05-06 after 13 forensic passes).
-- Two new permissive policies that admit the brand's account_owner via a
-- direct `account_id = auth.uid()` predicate (no SECURITY DEFINER helper),
-- bypassing both:
--   (a) The Postgres SECURITY DEFINER + STABLE function snapshot quirk that
--       prevents `biz_brand_effective_rank` from seeing a just-INSERTed brand
--       in the SELECT-for-RETURNING phase (BUG #1: brand-create 42501).
--   (b) The helper's `b.deleted_at IS NULL` gate that excludes a brand whose
--       deleted_at is being SET in the same UPDATE statement (BUG #2:
--       brand-delete 42501 at WITH CHECK time).
--
-- Permissive policies are OR'd in Postgres RLS. The existing
-- `Brand admin plus can update brands` policy continues to govern
-- non-owner brand admins exactly as before. The existing
-- `Brand members can select brands` and `Public can read brands with
-- public events` policies continue to govern collaborators and
-- public-page consumers exactly as before. This migration is purely
-- additive.
--
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md
-- Spec:          Mingla_Artifacts/specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md
-- Invariant:     I-PROPOSED-H (RLS-RETURNING-OWNER-GAP-PREVENTED)

-- =============================================================
-- Policy 1 of 2 — owner can SELECT own brand (any deleted_at state)
-- =============================================================
-- Direct predicate: no helper function, no in-transaction snapshot dependency.
-- Admits the just-INSERTed brand via SELECT-for-RETURNING because the new
-- row's account_id matches auth.uid() and Postgres RLS evaluates the policy
-- expression directly against NEW row columns.
--
-- We deliberately do NOT gate on `deleted_at IS NULL` here. Reasons:
--   1. Owners need to see soft-deleted brands in admin/recovery UI flows.
--   2. The brand-delete UPDATE...RETURNING (if .select() ever chained) needs
--      a SELECT policy that admits the post-delete row state.
--   3. Existing `"Brand members"` SELECT policy still gates on deleted_at
--      IS NULL for the brand-team flows that should not see tombstones.

CREATE POLICY "Account owner can select own brands"
ON public.brands
FOR SELECT
TO authenticated
USING (account_id = auth.uid());

COMMENT ON POLICY "Account owner can select own brands" ON public.brands IS
  'ORCH-0734 RC-0728-A fix: direct-predicate owner-SELECT bypasses SECURITY DEFINER helper that empirically failed to admit just-INSERTed brand row in RETURNING context. No deleted_at gate so owners can see tombstones for recovery / audit and so soft-delete UPDATE...RETURNING (if ever wired) admits the post-mutation row.';

-- =============================================================
-- Policy 2 of 2 — owner can UPDATE own brand (incl. soft-delete)
-- =============================================================
-- Direct predicate for both USING (find old row) and WITH CHECK (admit new
-- row). The brand's account_id is enforced immutable by trg_brands_immutable_account_id
-- BEFORE UPDATE trigger, so this WITH CHECK is safe (new account_id ALWAYS
-- equals old account_id ALWAYS equals auth.uid() for the owner).
--
-- Critically: WITH CHECK has no `deleted_at IS NULL` gate. This is the fix
-- for BUG #2: when the UPDATE sets deleted_at = now(), the post-mutation
-- row's account_id still equals auth.uid() so WITH CHECK passes. The
-- existing helper-based "Brand admin plus can update brands" policy still
-- governs non-owner admins for non-soft-delete updates.

CREATE POLICY "Account owner can update own brand"
ON public.brands
FOR UPDATE
TO authenticated
USING (account_id = auth.uid())
WITH CHECK (account_id = auth.uid());

COMMENT ON POLICY "Account owner can update own brand" ON public.brands IS
  'ORCH-0734 RC-0728-B fix: direct-predicate owner-UPDATE bypasses SECURITY DEFINER helper whose `b.deleted_at IS NULL` gate excluded the post-mutation row state during soft-delete UPDATE WITH CHECK evaluation. account_id immutability is enforced by trg_brands_immutable_account_id BEFORE UPDATE trigger.';

-- =============================================================
-- Verification probes (read-only; do NOT modify state)
-- =============================================================
-- These probes run inline after the policies are created so a `supabase
-- db push` failure surfaces immediately if anything is wrong. They do not
-- modify state. Implementor + tester rely on `supabase db push` exit code +
-- `supabase migration list` to confirm migration was applied; these probes
-- are belt-and-suspenders.

DO $$
DECLARE
  expected_count int := 7;  -- original 5 + 2 new = 7 policies on brands
  actual_count   int;
BEGIN
  SELECT count(*) INTO actual_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'brands';

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'ORCH-0734 verification probe failed: brands has % policies, expected %', actual_count, expected_count;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND policyname = 'Account owner can select own brands'
      AND cmd = 'SELECT'
      AND qual = '(account_id = auth.uid())'
  ) THEN
    RAISE EXCEPTION 'ORCH-0734 verification probe failed: SELECT policy not registered correctly';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND policyname = 'Account owner can update own brand'
      AND cmd = 'UPDATE'
      AND qual = '(account_id = auth.uid())'
      AND with_check = '(account_id = auth.uid())'
  ) THEN
    RAISE EXCEPTION 'ORCH-0734 verification probe failed: UPDATE policy not registered correctly';
  END IF;
END$$;
