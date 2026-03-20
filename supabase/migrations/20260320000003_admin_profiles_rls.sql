-- Admin-bypass RLS policies for profiles table.
-- Allows admin users (verified via is_admin_user()) to SELECT and UPDATE
-- all profiles without the expensive is_blocked_by() per-row check.

-- SELECT: admins can read all profiles
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (is_admin_user());

-- UPDATE: admins can update any profile (for beta toggle, banning, etc.)
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (is_admin_user())
  WITH CHECK (is_admin_user());
