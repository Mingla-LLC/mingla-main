-- Add email_verified column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

-- Add has_completed_onboarding column if it doesn't exist
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS has_completed_onboarding BOOLEAN DEFAULT false;

-- Update existing profiles to have email_verified based on auth.users email confirmation
UPDATE public.profiles 
SET email_verified = COALESCE(
  (SELECT email_confirmed_at IS NOT NULL 
   FROM auth.users 
   WHERE auth.users.id = profiles.id),
  false
);

-- Create index for email_verified for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_email_verified ON public.profiles(email_verified);
CREATE INDEX IF NOT EXISTS idx_profiles_has_completed_onboarding ON public.profiles(has_completed_onboarding);
