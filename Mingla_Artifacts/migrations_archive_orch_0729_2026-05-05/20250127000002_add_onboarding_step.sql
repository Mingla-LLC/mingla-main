-- Add onboarding_step column to profiles table
-- This tracks which onboarding step the user is currently on
-- 0 = completed onboarding, 2-10 = current step number
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT NULL;

-- Set onboarding_step to 0 for users who have completed onboarding
UPDATE public.profiles
SET onboarding_step = 0
WHERE has_completed_onboarding = true AND onboarding_step IS NULL;

-- Set onboarding_step to 2 (Intent Selection - first tracked step) for users who haven't completed onboarding
-- This ensures existing users in onboarding resume at step 2
UPDATE public.profiles
SET onboarding_step = 2
WHERE has_completed_onboarding = false AND onboarding_step IS NULL;

-- Create index for onboarding_step for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_step ON public.profiles(onboarding_step);

-- Add comment to explain the column
COMMENT ON COLUMN public.profiles.onboarding_step IS 'Tracks current onboarding step: 0 = completed, 2 = Intent Selection (first tracked step), 3-10 = subsequent steps';

