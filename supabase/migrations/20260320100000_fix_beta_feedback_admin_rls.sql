-- ============================================================
-- Fix: beta_feedback + storage admin RLS policies
--
-- Problem: Three policies check profiles.is_admin (never set to true)
-- instead of is_admin_user() (the canonical admin identity function).
-- Result: Admin dashboard sees 0 feedback rows despite data existing.
--
-- Fix: Replace all three with is_admin_user().
-- ============================================================

-- 1. Fix beta_feedback SELECT policy for admins
DROP POLICY IF EXISTS "Admins can read all feedback" ON beta_feedback;
CREATE POLICY "Admins can read all feedback"
  ON beta_feedback FOR SELECT
  USING (is_admin_user());

-- 2. Fix beta_feedback UPDATE policy for admins
DROP POLICY IF EXISTS "Admins can update feedback" ON beta_feedback;
CREATE POLICY "Admins can update feedback"
  ON beta_feedback FOR UPDATE
  USING (is_admin_user());

-- 3. Fix storage SELECT policy for admin audio access
DROP POLICY IF EXISTS "Admins can read all feedback audio" ON storage.objects;
CREATE POLICY "Admins can read all feedback audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'beta-feedback'
    AND is_admin_user()
  );
