-- ============================================================================
-- Add engagement counters to card_pool
-- ============================================================================
-- These counters live on the card itself (no user FK) so they survive
-- user deletion. Maintained by triggers on user_card_impressions,
-- place_reviews, and user_visits.
-- ============================================================================

-- Note: served_count already exists on card_pool (used as impression count).
-- impression_count and dismiss_count removed — no matching data source.
ALTER TABLE public.card_pool
  ADD COLUMN IF NOT EXISTS save_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skip_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expand_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visit_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count_local INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating_local DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS engagement_score DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Sort by engagement (hot cards first)
CREATE INDEX IF NOT EXISTS idx_card_pool_engagement
  ON public.card_pool (engagement_score DESC)
  WHERE is_active = true;

-- Sort by popularity + engagement combined
CREATE INDEX IF NOT EXISTS idx_card_pool_popularity
  ON public.card_pool (popularity_score DESC, engagement_score DESC)
  WHERE is_active = true;
