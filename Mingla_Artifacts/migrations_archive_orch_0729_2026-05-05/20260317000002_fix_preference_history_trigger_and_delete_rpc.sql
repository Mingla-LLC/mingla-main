-- ============================================
-- Fix 1: Restore preference_history trigger to use correct table schema
-- ============================================
-- Migration 20260303000009 rewrote this function to INSERT into 17 individual
-- columns (profile_id, mode, budget_min, ...) that DO NOT EXIST on the
-- preference_history table. The table uses JSONB columns: user_id, preference_id,
-- old_data, new_data, change_type. Every preference change has been silently
-- failing since that migration — no history recorded.
--
-- This restores the working JSONB approach from 20250204000005, adds the
-- EXCEPTION safety net from 20260303000009, and properly handles DELETE
-- (uses OLD instead of NEW).
-- ============================================

CREATE OR REPLACE FUNCTION public.create_preference_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.preference_history (
            user_id,
            preference_id,
            old_data,
            new_data,
            change_type
        ) VALUES (
            OLD.profile_id,
            OLD.profile_id,
            to_jsonb(OLD),
            '{}'::jsonb,
            TG_OP
        );
        RETURN OLD;
    ELSE
        INSERT INTO public.preference_history (
            user_id,
            preference_id,
            old_data,
            new_data,
            change_type
        ) VALUES (
            NEW.profile_id,
            NEW.profile_id,
            CASE
                WHEN TG_OP = 'INSERT' THEN '{}'::jsonb
                ELSE to_jsonb(OLD)
            END,
            to_jsonb(NEW),
            TG_OP
        );
        RETURN NEW;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'preference_history insert failed: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

-- ============================================
-- Fix 2: delete_user_profile RPC disables triggers on wrong table
-- ============================================
-- The old version disabled triggers on `profiles`, but the problematic
-- trigger (trigger_preference_history) is on the `preferences` table.
-- Fix: disable triggers on BOTH tables.
-- ============================================

CREATE OR REPLACE FUNCTION public.delete_user_profile(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Disable user triggers on preferences (where preference_history trigger lives)
  -- and profiles (where on_profile_delete_cleanup lives)
  BEGIN
    ALTER TABLE public.preferences DISABLE TRIGGER USER;
    ALTER TABLE public.profiles DISABLE TRIGGER USER;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not disable triggers: %', SQLERRM;
  END;

  -- Delete preferences first (triggers disabled, no history fires),
  -- then preference_history, then profile
  DELETE FROM public.preferences WHERE profile_id = target_user_id;
  DELETE FROM public.preference_history WHERE user_id = target_user_id;
  DELETE FROM public.profiles WHERE id = target_user_id;

  -- Re-enable triggers
  BEGIN
    ALTER TABLE public.preferences ENABLE TRIGGER USER;
    ALTER TABLE public.profiles ENABLE TRIGGER USER;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not re-enable triggers: %', SQLERRM;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_profile(UUID) TO service_role;
