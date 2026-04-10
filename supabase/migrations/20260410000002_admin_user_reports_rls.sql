-- Enable admin access to user_reports for moderation.
-- The admin SELECT policy was commented out in the original migration
-- (20250205000002). This adds it using is_admin_user(), consistent with
-- other admin RLS policies (profiles, beta_feedback, admin_users).

-- Admin can read ALL reports
CREATE POLICY "Admins can view all reports"
  ON public.user_reports FOR SELECT
  USING (is_admin_user());

-- Admin can update report status, severity, resolution
CREATE POLICY "Admins can update reports"
  ON public.user_reports FOR UPDATE
  USING (is_admin_user())
  WITH CHECK (is_admin_user());
