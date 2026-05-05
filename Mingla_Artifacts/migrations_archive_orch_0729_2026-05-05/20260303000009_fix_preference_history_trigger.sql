-- Migration: fix_preference_history_trigger
-- Description: Wrap preference_history trigger function in exception handler
-- so that a history insert failure does not roll back the preferences upsert.

CREATE OR REPLACE FUNCTION public.create_preference_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.preference_history (
        profile_id,
        mode,
        budget_min,
        budget_max,
        people_count,
        categories,
        intents,
        travel_mode,
        travel_constraint_type,
        travel_constraint_value,
        datetime_pref,
        date_option,
        time_slot,
        exact_time,
        custom_location,
        use_gps_location,
        changed_at
    ) VALUES (
        COALESCE(NEW.profile_id, OLD.profile_id),
        NEW.mode,
        NEW.budget_min,
        NEW.budget_max,
        NEW.people_count,
        NEW.categories,
        NEW.intents,
        NEW.travel_mode,
        NEW.travel_constraint_type,
        NEW.travel_constraint_value,
        NEW.datetime_pref,
        NEW.date_option,
        NEW.time_slot,
        NEW.exact_time,
        NEW.custom_location,
        NEW.use_gps_location,
        NOW()
    );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'preference_history insert failed: %', SQLERRM;
    RETURN NEW;
END;
$$;
