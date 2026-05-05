-- Migration: 20260305000002_profiles_add_country_language.sql
-- Description: Adds country (ISO 3166-1 alpha-2) and preferred_language (ISO 639-1)
-- to profiles for onboarding identity/details collection.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'en';

-- Index: country for potential geo-based queries
CREATE INDEX IF NOT EXISTS idx_profiles_country ON public.profiles(country)
  WHERE country IS NOT NULL;

COMMENT ON COLUMN public.profiles.country IS 'ISO 3166-1 alpha-2 country code (e.g., US, GB, NG)';
COMMENT ON COLUMN public.profiles.preferred_language IS 'ISO 639-1 language code (e.g., en, es, fr)';
