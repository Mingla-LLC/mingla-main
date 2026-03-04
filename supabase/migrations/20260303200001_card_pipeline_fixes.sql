-- ============================================================
-- Card Pipeline Fixes Migration
-- Date: 2026-03-03
-- Fixes: CF-001 (unique constraint), HF-005 (stale defaults),
--        RC-002 (SQL-level impression exclusion function)
-- ============================================================

-- ── CF-001: Add unique constraint on card_pool.google_place_id ──────────────
-- Step 1: Remove duplicates, keeping the row with highest popularity_score
DELETE FROM public.card_pool a
USING public.card_pool b
WHERE a.google_place_id IS NOT NULL
  AND a.google_place_id = b.google_place_id
  AND (a.popularity_score < b.popularity_score
       OR (a.popularity_score = b.popularity_score AND a.id < b.id));

-- Step 2: Add the unique index (partial — only where google_place_id is not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_pool_unique_google_place_id
  ON public.card_pool (google_place_id)
  WHERE google_place_id IS NOT NULL;

-- ── HF-005: Update default categories for new users ────────────────────────
ALTER TABLE public.preferences
  ALTER COLUMN categories SET DEFAULT ARRAY['Nature', 'Casual Eats', 'Drink'];

-- ── RC-002: SQL function for pool query with impression exclusion ───────────
-- This function performs the pool query entirely in SQL:
--   1. Filters card_pool by category, geo bounding box, budget, card_type
--   2. Excludes cards the user has already seen (via user_card_impressions)
--   3. Deduplicates by google_place_id (keeps highest popularity_score)
--   4. Applies LIMIT + OFFSET server-side
--   5. Returns both the page of cards AND the total unseen count
CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id UUID,
  p_categories TEXT[],
  p_lat_min DOUBLE PRECISION,
  p_lat_max DOUBLE PRECISION,
  p_lng_min DOUBLE PRECISION,
  p_lng_max DOUBLE PRECISION,
  p_budget_max INTEGER,
  p_card_type TEXT DEFAULT 'single',
  p_experience_type TEXT DEFAULT NULL,
  p_pref_updated_at TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z',
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  card JSONB,
  total_unseen BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_unseen BIGINT;
BEGIN
  -- Count total unseen cards matching filters (for hasMore calculation)
  SELECT COUNT(*) INTO v_total_unseen
  FROM (
    SELECT DISTINCT ON (COALESCE(cp.google_place_id, cp.id::TEXT)) cp.id
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (p_categories = '{}' OR cp.categories && p_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND cp.price_min <= p_budget_max
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
      AND cp.id NOT IN (
        SELECT uci.card_pool_id
        FROM public.user_card_impressions uci
        WHERE uci.user_id = p_user_id
          AND uci.created_at >= p_pref_updated_at
      )
    ORDER BY COALESCE(cp.google_place_id, cp.id::TEXT), cp.popularity_score DESC
  ) sub;

  -- Return the page of cards + the total unseen count
  RETURN QUERY
  SELECT
    to_jsonb(cp.*) AS card,
    v_total_unseen AS total_unseen
  FROM public.card_pool cp
  WHERE cp.is_active = true
    AND cp.card_type = p_card_type
    AND (p_categories = '{}' OR cp.categories && p_categories)
    AND cp.lat BETWEEN p_lat_min AND p_lat_max
    AND cp.lng BETWEEN p_lng_min AND p_lng_max
    AND cp.price_min <= p_budget_max
    AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
    AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
    AND cp.id NOT IN (
      SELECT uci.card_pool_id
      FROM public.user_card_impressions uci
      WHERE uci.user_id = p_user_id
        AND uci.created_at >= p_pref_updated_at
    )
    -- Dedup by google_place_id: DISTINCT ON keeps first row per group,
    -- ordered by popularity_score DESC
    AND cp.id IN (
      SELECT DISTINCT ON (COALESCE(cp2.google_place_id, cp2.id::TEXT)) cp2.id
      FROM public.card_pool cp2
      WHERE cp2.is_active = true
        AND cp2.card_type = p_card_type
        AND (p_categories = '{}' OR cp2.categories && p_categories)
        AND cp2.lat BETWEEN p_lat_min AND p_lat_max
        AND cp2.lng BETWEEN p_lng_min AND p_lng_max
        AND cp2.price_min <= p_budget_max
        AND (p_experience_type IS NULL OR cp2.experience_type = p_experience_type)
        AND cp2.id NOT IN (SELECT unnest(p_exclude_card_ids))
        AND cp2.id NOT IN (
          SELECT uci.card_pool_id
          FROM public.user_card_impressions uci
          WHERE uci.user_id = p_user_id
            AND uci.created_at >= p_pref_updated_at
        )
      ORDER BY COALESCE(cp2.google_place_id, cp2.id::TEXT), cp2.popularity_score DESC
    )
  ORDER BY cp.popularity_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- ── Security: Restrict query_pool_cards to service_role only ─────────────────
-- Prevent end users from calling this function directly via PostgREST
REVOKE EXECUTE ON FUNCTION public.query_pool_cards FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.query_pool_cards TO service_role;
