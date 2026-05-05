-- Add is_seed flag to profiles for demo/seed data identification
-- Allows clean separation and bulk cleanup of seeded fake users
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_profiles_is_seed ON public.profiles(is_seed) WHERE is_seed = true;
