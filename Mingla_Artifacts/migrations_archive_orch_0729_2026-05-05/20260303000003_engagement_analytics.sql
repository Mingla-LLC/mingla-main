-- Engagement Analytics Migration
-- Date: 2026-03-03
-- Creates: user_engagement_stats table
-- Modifies: place_pool (adds analytics columns)
-- Creates: RPC functions for atomic counter increments

-- ============================================================
-- 1. USER ENGAGEMENT STATS — Per-user lifetime totals
-- Completely separate from user_card_impressions (session filtering).
-- This table ONLY tracks aggregate counts for analytics.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_engagement_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  total_cards_seen INTEGER NOT NULL DEFAULT 0,
  total_cards_saved INTEGER NOT NULL DEFAULT 0,
  total_cards_scheduled INTEGER NOT NULL DEFAULT 0,
  total_reviews_given INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.user_engagement_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_stats"
  ON public.user_engagement_stats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "service_role_all_stats"
  ON public.user_engagement_stats FOR ALL
  USING (auth.role() = 'service_role');

-- Updated_at trigger (reuse existing function)
CREATE TRIGGER update_user_engagement_stats_updated_at
  BEFORE UPDATE ON public.user_engagement_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. PLACE POOL — Add analytics columns
-- Global engagement metrics visible to recommendation scoring.
-- ============================================================

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS total_impressions INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_saves INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_schedules INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mingla_review_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mingla_avg_rating DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mingla_positive_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mingla_negative_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mingla_top_themes TEXT[] NOT NULL DEFAULT '{}';

-- ============================================================
-- 3. RPC FUNCTIONS — Atomic counter increments
-- These are called from edge functions and mobile services.
-- Using RPCs ensures atomic increments (no race conditions).
-- ============================================================

-- Increment a single field on user_engagement_stats.
-- Auto-creates the row if it doesn't exist (upsert pattern).
CREATE OR REPLACE FUNCTION increment_user_engagement(
  p_user_id UUID,
  p_field TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS void AS $$
BEGIN
  -- Ensure row exists
  INSERT INTO public.user_engagement_stats (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Increment the specified field
  EXECUTE format(
    'UPDATE public.user_engagement_stats SET %I = %I + $1, updated_at = now() WHERE user_id = $2',
    p_field, p_field
  ) USING p_amount, p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment a single field on place_pool by google_place_id.
CREATE OR REPLACE FUNCTION increment_place_engagement(
  p_google_place_id TEXT,
  p_field TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS void AS $$
BEGIN
  EXECUTE format(
    'UPDATE public.place_pool SET %I = %I + $1 WHERE google_place_id = $2',
    p_field, p_field
  ) USING p_amount, p_google_place_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
