-- Migration: 20260303200002_onboarding_v2_intents.sql
-- Description: Add intents column to preferences for separate intent storage.
-- Previously intents were mixed into the categories array. V2 stores them separately.

ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS intents TEXT[] DEFAULT '{}'::TEXT[];

COMMENT ON COLUMN public.preferences.intents IS 'User-selected intent IDs from onboarding (e.g., adventurous, romantic). Separate from categories.';

-- Reset in-progress onboarding users on old flow (step > 5) to step 1
-- so they experience the new 5-step flow.
UPDATE public.profiles
  SET onboarding_step = 1
  WHERE has_completed_onboarding = false
    AND onboarding_step IS NOT NULL
    AND onboarding_step > 5;
