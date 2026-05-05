-- Add active column to profiles table (default TRUE for new and existing accounts)
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true NOT NULL;

-- Ensure all existing profiles are marked active
UPDATE public.profiles SET active = true WHERE active IS NULL;
