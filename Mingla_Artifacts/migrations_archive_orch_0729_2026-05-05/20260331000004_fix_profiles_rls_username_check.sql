-- ============================================================
-- EMERGENCY FIX: ORCH-0253
-- Drop the USING(true) SELECT policy on profiles that exposes
-- ALL columns of ALL profiles to ANY caller (including anon).
-- Replace with a SECURITY DEFINER function that returns boolean only.
-- ============================================================

-- 1. Drop the dangerous policy
DROP POLICY IF EXISTS "Anyone can check username availability" ON public.profiles;

-- 2. Create a safe username availability check (returns boolean, not rows)
CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF p_username IS NULL OR length(trim(p_username)) < 3 THEN
    RETURN FALSE;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(trim(p_username))
  );
END;
$$;

-- Grant to anon so unauthenticated users can check during signup
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO authenticated;
