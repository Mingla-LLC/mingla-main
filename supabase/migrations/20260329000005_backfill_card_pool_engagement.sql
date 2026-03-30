-- ============================================================================
-- One-time backfill of card_pool engagement counters from existing data
-- ============================================================================
-- After this, the triggers from 20260329000004 maintain counters in real-time.
-- Safe to re-run (idempotent — overwrites with recomputed values).
-- Uses served_count (pre-existing column) instead of impression_count.
-- ============================================================================

-- Backfill from user_card_impressions
UPDATE public.card_pool cp SET
  save_count = COALESCE(stats.saved, 0),
  skip_count = COALESCE(stats.skipped, 0),
  expand_count = COALESCE(stats.expanded, 0),
  served_count = COALESCE(stats.served, 0)
FROM (
  SELECT
    card_pool_id,
    COUNT(*) FILTER (WHERE impression_type = 'served') AS served,
    COUNT(*) FILTER (WHERE impression_type IN ('saved', 'swiped_right')) AS saved,
    COUNT(*) FILTER (WHERE impression_type = 'swiped_left') AS skipped,
    COUNT(*) FILTER (WHERE impression_type = 'expanded') AS expanded
  FROM public.user_card_impressions
  GROUP BY card_pool_id
) stats
WHERE cp.id = stats.card_pool_id;

-- Backfill from place_reviews
UPDATE public.card_pool cp SET
  review_count_local = COALESCE(stats.cnt, 0),
  avg_rating_local = stats.avg_r
FROM (
  SELECT place_pool_id, COUNT(*) AS cnt, AVG(rating) AS avg_r
  FROM public.place_reviews
  WHERE place_pool_id IS NOT NULL
  GROUP BY place_pool_id
) stats
WHERE cp.place_pool_id = stats.place_pool_id;

-- Backfill from user_visits
UPDATE public.card_pool cp SET
  visit_count = COALESCE(stats.cnt, 0)
FROM (
  SELECT experience_id, COUNT(*) AS cnt
  FROM public.user_visits
  GROUP BY experience_id
) stats
WHERE cp.google_place_id = stats.experience_id;

-- Compute engagement_score for all cards (uses served_count as denominator)
UPDATE public.card_pool SET
  engagement_score = CASE
    WHEN served_count > 0
    THEN (save_count * 3.0 + visit_count * 5.0 + expand_count * 1.0 - skip_count * 1.0)
         / GREATEST(served_count, 1)
    ELSE 0
  END;
