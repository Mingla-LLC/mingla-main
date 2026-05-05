-- ADD USERNAME CHECK FUNCTION MIGRATION
-- Creates a function to check username availability that bypasses RLS
-- This allows unauthenticated users to check if a username is taken

-- Create function to check username availability
-- Uses SECURITY DEFINER to bypass RLS policies
CREATE OR REPLACE FUNCTION public.check_username_availability(check_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  username_exists BOOLEAN;
BEGIN
  -- Check if username exists (case-insensitive)
  -- Only check non-null usernames
  SELECT EXISTS(
    SELECT 1 
    FROM public.profiles 
    WHERE LOWER(TRIM(username)) = LOWER(TRIM(check_username))
    AND username IS NOT NULL
  ) INTO username_exists;
  
  -- Return false if username exists (not available), true if available
  RETURN NOT username_exists;
END;
$$;

-- Add comment to explain the function
COMMENT ON FUNCTION public.check_username_availability IS 'Checks if a username is available. Returns true if available, false if taken. Bypasses RLS to allow unauthenticated checks.';

-- Grant execute permission to all users (including anonymous)
GRANT EXECUTE ON FUNCTION public.check_username_availability(TEXT) TO anon, authenticated;

