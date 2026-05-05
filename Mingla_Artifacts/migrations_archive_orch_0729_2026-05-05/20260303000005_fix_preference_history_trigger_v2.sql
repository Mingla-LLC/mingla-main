-- Migration: fix_preference_history_trigger_v2
-- Description: Restores the correct JSONB-based trigger logic from 20250204000005
-- and adds the EXCEPTION handler from 20260303000003. The previous migration
-- (20260303000003) incorrectly referenced 17 individual columns that do not exist
-- in the preference_history table, which uses a JSONB schema (old_data/new_data).
-- This migration replaces it with the correct column references.

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
    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.create_preference_history() IS
  'Creates preference history entries as JSONB snapshots. Handles INSERT/UPDATE/DELETE. '
  'Exception handler prevents history failures from rolling back preference saves.';
