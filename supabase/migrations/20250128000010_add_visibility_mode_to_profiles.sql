-- Add visibility_mode column to profiles (friends, everyone=public, nobody=private)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS visibility_mode text
  CHECK (visibility_mode IN ('public', 'friends', 'private'))
  DEFAULT 'friends';

COMMENT ON COLUMN public.profiles.visibility_mode IS 'Profile visibility: public (everyone), friends, private (nobody)';
