-- ==========================================================================
-- AUTO-CREATE notification_preferences ROW ON USER SIGN-UP
-- Fixes: Root Cause 1 — notification_preferences row never created,
-- so AccountSettings .update() silently matches 0 rows and user preference
-- toggles do nothing.
--
-- Strategy: Database trigger on auth.users INSERT that automatically creates
-- a default notification_preferences row. This is more reliable than
-- client-side creation because it works regardless of which client path
-- (onboarding, social login, phone auth) creates the user.
-- ==========================================================================

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION public.create_default_notification_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Create the trigger on auth.users
-- AFTER INSERT ensures the user row exists before we reference it.
-- FOR EACH ROW ensures one preferences row per user.
DROP TRIGGER IF EXISTS trg_create_notification_preferences ON auth.users;
CREATE TRIGGER trg_create_notification_preferences
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_notification_preferences();

-- 3. Backfill: create rows for existing users who don't have preferences yet.
-- This is idempotent (ON CONFLICT DO NOTHING) and safe to run multiple times.
INSERT INTO public.notification_preferences (user_id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.notification_preferences)
ON CONFLICT (user_id) DO NOTHING;
