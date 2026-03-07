-- Migration: 20260310000003_profiles_add_photos.sql
-- Description: Adds a photos array column for up to 3 additional profile photos
-- beyond the avatar. Stored as public URLs from Supabase Storage.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT '{}'::TEXT[];

COMMENT ON COLUMN public.profiles.photos IS 'Up to 3 additional profile photo URLs beyond avatar_url';
