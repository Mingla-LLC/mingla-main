-- ============================================================
-- ORCH-0258: Fix admin_users privilege escalation
--
-- Problem: INSERT/UPDATE/DELETE policies use USING(true) for
-- all authenticated users. Any mobile app user can modify or
-- delete admin accounts.
--
-- Fix:
--   1. Drop all permissive policies
--   2. Create admin-only policies via is_admin_user()
--   3. Create safe RPCs for the login and invite flows
--   4. Revoke anon access to get_admin_emails()
-- ============================================================

-- 1. Drop ALL existing policies on admin_users
DROP POLICY IF EXISTS "Allow anon read" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated insert" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated update" ON public.admin_users;
DROP POLICY IF EXISTS "Allow authenticated delete" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "admin_users_insert_policy" ON public.admin_users;
DROP POLICY IF EXISTS "admin_users_update_policy" ON public.admin_users;
DROP POLICY IF EXISTS "admin_users_delete_policy" ON public.admin_users;
DROP POLICY IF EXISTS "admin_users_select_policy" ON public.admin_users;

-- 2. Create restricted policies — admin-only for all operations
CREATE POLICY "Admins can read admin_users"
  ON public.admin_users FOR SELECT
  USING (is_admin_user());

CREATE POLICY "Admins can insert admin_users"
  ON public.admin_users FOR INSERT
  WITH CHECK (is_admin_user());

CREATE POLICY "Admins can update admin_users"
  ON public.admin_users FOR UPDATE
  USING (is_admin_user());

CREATE POLICY "Admins can delete admin_users"
  ON public.admin_users FOR DELETE
  USING (is_admin_user());

-- 3a. Safe boolean check for admin login flow (replaces anon SELECT)
-- Returns true if the email is in the admin allowlist (active or invited).
CREATE OR REPLACE FUNCTION public.is_admin_email(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE lower(email) = lower(trim(p_email))
      AND status IN ('active', 'invited')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_email(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin_email(TEXT) TO authenticated;

-- 3b. Check if an email belongs to an invited (not yet active) admin.
-- Used by the invite setup flow after magic link click.
CREATE OR REPLACE FUNCTION public.check_invited_admin(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE lower(email) = lower(trim(p_email))
      AND status = 'invited'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_invited_admin(TEXT) TO authenticated;

-- 3c. Self-activation for invited admins.
-- Only activates the row matching the caller's own auth.email().
-- Prevents any user from activating arbitrary admin accounts.
CREATE OR REPLACE FUNCTION public.activate_invited_admin()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := lower(coalesce(
    current_setting('request.jwt.claims', true)::json->>'email',
    ''
  ));

  IF v_email = '' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.admin_users
  SET status = 'active',
      accepted_at = now()
  WHERE lower(email) = v_email
    AND status = 'invited';
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_invited_admin() TO authenticated;

-- 4. Revoke anon access to get_admin_emails() — no longer needed
-- (login flow now uses is_admin_email() which returns boolean only)
REVOKE EXECUTE ON FUNCTION public.get_admin_emails() FROM anon;
