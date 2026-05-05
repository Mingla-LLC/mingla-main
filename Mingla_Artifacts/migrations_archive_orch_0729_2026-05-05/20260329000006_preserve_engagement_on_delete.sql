-- ============================================================================
-- Preserve engagement data on user deletion
-- ============================================================================
-- Change user_card_impressions and user_visits from CASCADE to SET NULL.
-- These tables contain no PII — just "someone interacted with this card."
-- Rows survive with user_id = NULL, engagement counters stay accurate.
-- ============================================================================

-- ── user_card_impressions ──
ALTER TABLE public.user_card_impressions
  DROP CONSTRAINT IF EXISTS user_card_impressions_user_id_fkey;
ALTER TABLE public.user_card_impressions
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.user_card_impressions
  ADD CONSTRAINT user_card_impressions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fix unique constraint: NULL user_id must not conflict
-- PostgreSQL treats NULL != NULL so multiple NULLs are allowed,
-- but the old UNIQUE(user_id, card_pool_id) constraint won't work
-- for active users if we don't scope it properly.
ALTER TABLE public.user_card_impressions
  DROP CONSTRAINT IF EXISTS user_card_impressions_user_id_card_pool_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_card_impressions_unique_active
  ON public.user_card_impressions(user_id, card_pool_id)
  WHERE user_id IS NOT NULL;

-- ── user_visits ──
ALTER TABLE public.user_visits
  DROP CONSTRAINT IF EXISTS user_visits_user_id_fkey;
ALTER TABLE public.user_visits
  ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.user_visits
  ADD CONSTRAINT user_visits_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fix unique constraint
ALTER TABLE public.user_visits
  DROP CONSTRAINT IF EXISTS user_visits_unique;
CREATE UNIQUE INDEX IF NOT EXISTS user_visits_unique_active
  ON public.user_visits(user_id, experience_id)
  WHERE user_id IS NOT NULL;
