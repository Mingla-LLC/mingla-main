-- ============================================
-- Fix preference_history trigger for DELETE operations
-- ============================================
-- The original trigger used NEW.profile_id for DELETE operations,
-- but NEW is NULL during DELETE. This fix uses OLD for DELETE.
-- ============================================

CREATE OR REPLACE FUNCTION public.create_preference_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- For DELETE, use OLD; for INSERT/UPDATE, use NEW
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
END;
$$;

COMMENT ON FUNCTION public.create_preference_history() IS 
  'Creates preference history entries. Fixed to properly handle DELETE operations by using OLD instead of NEW.';
