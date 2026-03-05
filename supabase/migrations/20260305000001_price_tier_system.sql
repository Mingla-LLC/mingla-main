-- Migration: 20260305000001_price_tier_system.sql
-- Description: Add price_tiers array column to preferences, price_tier to card_pool/place_pool,
--              backfill from existing data, rewrite query_pool_cards RPC with CTEs + tier filtering.
-- Fixes: HF-001 (triple SQL filter), HF-006 (budgetMin ignored), budget leak gap-fill

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 1: preferences — add price_tiers column
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS price_tiers TEXT[] NOT NULL DEFAULT ARRAY['chill', 'comfy', 'bougie', 'lavish'];

-- Backfill from existing budget_max
UPDATE public.preferences SET price_tiers =
  CASE
    WHEN budget_max <= 50 THEN ARRAY['chill']
    WHEN budget_max <= 150 THEN ARRAY['chill', 'comfy']
    WHEN budget_max <= 300 THEN ARRAY['chill', 'comfy', 'bougie']
    ELSE ARRAY['chill', 'comfy', 'bougie', 'lavish']
  END;

-- Do NOT drop budget_min/budget_max — keep for rollback safety.
COMMENT ON COLUMN public.preferences.price_tiers IS 'User-selected price tiers: chill, comfy, bougie, lavish. Default is all tiers.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 2: card_pool — add price_tier column
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.card_pool
  ADD COLUMN IF NOT EXISTS price_tier TEXT DEFAULT NULL;

-- Backfill from price_level
UPDATE public.card_pool SET price_tier =
  CASE
    WHEN price_level IN ('PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE') THEN 'chill'
    WHEN price_level = 'PRICE_LEVEL_MODERATE' THEN 'comfy'
    WHEN price_level = 'PRICE_LEVEL_EXPENSIVE' THEN 'bougie'
    WHEN price_level = 'PRICE_LEVEL_VERY_EXPENSIVE' THEN 'lavish'
    ELSE 'chill'
  END
  WHERE price_level IS NOT NULL;

-- Index for tier-based queries
CREATE INDEX IF NOT EXISTS idx_card_pool_price_tier ON public.card_pool(price_tier);

COMMENT ON COLUMN public.card_pool.price_tier IS 'Canonical price tier: chill, comfy, bougie, lavish';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 3: place_pool — add price_tier column
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS price_tier TEXT DEFAULT NULL;

UPDATE public.place_pool SET price_tier =
  CASE
    WHEN price_level IN ('PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE') THEN 'chill'
    WHEN price_level = 'PRICE_LEVEL_MODERATE' THEN 'comfy'
    WHEN price_level = 'PRICE_LEVEL_EXPENSIVE' THEN 'bougie'
    WHEN price_level = 'PRICE_LEVEL_VERY_EXPENSIVE' THEN 'lavish'
    ELSE 'chill'
  END
  WHERE price_level IS NOT NULL;

COMMENT ON COLUMN public.place_pool.price_tier IS 'Canonical price tier: chill, comfy, bougie, lavish';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 4: Rewrite query_pool_cards — CTE + tier filtering
-- FIXES: HF-001 (triple filter → single CTE), HF-006 (budgetMin irrelevant with tiers)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id UUID,
  p_categories TEXT[],
  p_lat_min DOUBLE PRECISION,
  p_lat_max DOUBLE PRECISION,
  p_lng_min DOUBLE PRECISION,
  p_lng_max DOUBLE PRECISION,
  p_budget_max INTEGER DEFAULT 1000,
  p_card_type TEXT DEFAULT 'single',
  p_experience_type TEXT DEFAULT NULL,
  p_pref_updated_at TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z',
  p_exclude_card_ids UUID[] DEFAULT '{}',
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_price_tiers TEXT[] DEFAULT '{}'
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
  v_use_tiers BOOLEAN := (array_length(p_price_tiers, 1) IS NOT NULL AND array_length(p_price_tiers, 1) > 0);
BEGIN
  -- ── CTE: Single pass through card_pool with ALL filters applied ONCE ──
  -- Then deduplicate by google_place_id, keeping highest popularity_score per place.
  -- Then count + paginate from the already-filtered, already-deduped set.

  WITH
  -- Step 1: Exclude card IDs the caller wants skipped (passed as parameter)
  excluded AS (
    SELECT unnest(p_exclude_card_ids) AS card_id
  ),
  -- Step 2: Get impression card IDs for this user since pref reset boundary
  seen AS (
    SELECT uci.card_pool_id AS card_id
    FROM public.user_card_impressions uci
    WHERE uci.user_id = p_user_id
      AND uci.created_at >= p_pref_updated_at
  ),
  -- Step 3: Apply ALL filters exactly once
  filtered AS (
    SELECT cp.*
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (p_categories = '{}' OR cp.categories && p_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        (v_use_tiers AND cp.price_tier = ANY(p_price_tiers))
        OR
        (NOT v_use_tiers AND cp.price_min <= p_budget_max)
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id NOT IN (SELECT card_id FROM excluded)
      AND cp.id NOT IN (SELECT card_id FROM seen)
  ),
  -- Step 4: Deduplicate by google_place_id, keeping highest popularity_score
  deduped AS (
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
    FROM filtered f
    ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  )
  -- Step 5: Count total unseen (from deduped set)
  SELECT COUNT(*) INTO v_total_unseen FROM deduped;

  -- Step 6: Return paginated results from the same CTE logic
  RETURN QUERY
  WITH
  excluded AS (
    SELECT unnest(p_exclude_card_ids) AS card_id
  ),
  seen AS (
    SELECT uci.card_pool_id AS card_id
    FROM public.user_card_impressions uci
    WHERE uci.user_id = p_user_id
      AND uci.created_at >= p_pref_updated_at
  ),
  filtered AS (
    SELECT cp.*
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      AND (p_categories = '{}' OR cp.categories && p_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        (v_use_tiers AND cp.price_tier = ANY(p_price_tiers))
        OR
        (NOT v_use_tiers AND cp.price_min <= p_budget_max)
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id NOT IN (SELECT card_id FROM excluded)
      AND cp.id NOT IN (SELECT card_id FROM seen)
  ),
  deduped AS (
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
    FROM filtered f
    ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  )
  SELECT
    to_jsonb(d.*) AS card,
    v_total_unseen AS total_unseen
  FROM deduped d
  ORDER BY d.popularity_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
