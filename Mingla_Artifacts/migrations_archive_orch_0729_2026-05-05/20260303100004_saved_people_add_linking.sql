-- Migration: 20260303100004_saved_people_add_linking.sql
-- Description: Extends saved_people to support linked friends.

-- Expand gender options from the old 3-option set to the new 8-option set
ALTER TABLE public.saved_people
  DROP CONSTRAINT IF EXISTS saved_people_gender_check;

ALTER TABLE public.saved_people
  ADD CONSTRAINT saved_people_gender_check
    CHECK (gender IN ('man', 'woman', 'non-binary', 'transgender', 'genderqueer', 'genderfluid', 'agender', 'prefer-not-to-say'));

-- Migrate old gender values to new format
UPDATE public.saved_people SET gender = 'man' WHERE gender = 'male';
UPDATE public.saved_people SET gender = 'woman' WHERE gender = 'female';
UPDATE public.saved_people SET gender = 'non-binary' WHERE gender = 'other';

-- Add linking columns
ALTER TABLE public.saved_people
  ADD COLUMN IF NOT EXISTS linked_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_id UUID REFERENCES public.friend_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_linked BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast linked user lookup
CREATE INDEX IF NOT EXISTS idx_saved_people_linked_user
  ON public.saved_people (linked_user_id) WHERE is_linked = TRUE;

-- Make name nullable for linked persons (auto-pulled from profile)
ALTER TABLE public.saved_people ALTER COLUMN name DROP NOT NULL;
