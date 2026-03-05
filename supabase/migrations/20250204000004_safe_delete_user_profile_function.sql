-- ============================================
-- Safe User Profile Deletion Function
-- ============================================
-- This function safely deletes a user profile by:
-- 1. Disabling the preference_history trigger
-- 2. Deleting the profile
-- 3. Re-enabling the trigger
-- ============================================

CREATE OR REPLACE FUNCTION public.delete_user_profile(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Disable the preference_history trigger if it exists
  BEGIN
    ALTER TABLE public.profiles DISABLE TRIGGER ALL;
  EXCEPTION WHEN OTHERS THEN
    -- Trigger might not exist, continue
    RAISE NOTICE 'Could not disable triggers: %', SQLERRM;
  END;

  -- Delete the user's preference_history first
  DELETE FROM public.preference_history WHERE user_id = target_user_id;

  -- Delete the profile
  DELETE FROM public.profiles WHERE id = target_user_id;

  -- Re-enable triggers
  BEGIN
    ALTER TABLE public.profiles ENABLE TRIGGER ALL;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not re-enable triggers: %', SQLERRM;
  END;
END;
$$;

-- Grant execute to service role (used by edge functions)
GRANT EXECUTE ON FUNCTION public.delete_user_profile(UUID) TO service_role;

COMMENT ON FUNCTION public.delete_user_profile(UUID) IS 
  'Safely deletes a user profile by temporarily disabling triggers to avoid preference_history constraint violations.';
