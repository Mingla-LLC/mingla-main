-- Migration: 20260303100003_profiles_add_birthday_gender.sql
-- Description: Adds birthday and gender fields to profiles for linked friend
-- auto-pull. Note: push_token already exists as expo_push_token.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birthday DATE,
  ADD COLUMN IF NOT EXISTS gender TEXT
    CHECK (gender IN ('man', 'woman', 'non-binary', 'transgender', 'genderqueer', 'genderfluid', 'agender', 'prefer-not-to-say'));
