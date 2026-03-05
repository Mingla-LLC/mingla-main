-- Migration: unified_pipeline_phase1
-- Description: Add price_tiers to board_session_preferences, add rotation
-- tracking to collaboration_sessions, add lock-in support columns.

-- 1. Add price_tiers to board_session_preferences
ALTER TABLE public.board_session_preferences
  ADD COLUMN IF NOT EXISTS price_tiers TEXT[]
    DEFAULT ARRAY['chill','comfy','bougie','lavish'];

-- Backfill existing rows that have NULL price_tiers
UPDATE public.board_session_preferences
SET price_tiers = ARRAY['chill','comfy','bougie','lavish']
WHERE price_tiers IS NULL;

-- 2. Add preference rotation columns to collaboration_sessions
ALTER TABLE public.collaboration_sessions
  ADD COLUMN IF NOT EXISTS active_preference_owner_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rotation_order UUID[]
    DEFAULT ARRAY[]::UUID[];

-- 3. Add date_option to board_session_preferences (missing column)
ALTER TABLE public.board_session_preferences
  ADD COLUMN IF NOT EXISTS date_option TEXT DEFAULT NULL;
