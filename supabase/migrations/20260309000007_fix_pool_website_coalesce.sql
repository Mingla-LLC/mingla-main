-- Migration: fix_pool_website_coalesce
-- Problem: Many card_pool rows have NULL website because they were inserted before
--          the website column was added, or the backfill didn't cover all rows.
-- Fix:     1) Rewrite query_pool_cards to COALESCE website from place_pool
--          2) Backfill card_pool.website from place_pool for remaining NULL rows

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 1: Backfill card_pool.website from place_pool (catch any rows the
--         previous backfill migrations or trigger missed)
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.card_pool cp
SET website = pp.website
FROM public.place_pool pp
WHERE cp.place_pool_id = pp.id
  AND cp.website IS NULL
  AND pp.website IS NOT NULL
  AND pp.website != '';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 2: Rewrite query_pool_cards — LEFT JOIN place_pool to COALESCE website
--         so cards always inherit website from place_pool even if card_pool is NULL
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

  -- Step 6: Return paginated results, with website coalesced from place_pool
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
  ),
  -- Step 6a: LEFT JOIN place_pool to fill in missing website
  enriched AS (
    SELECT
      d.*,
      COALESCE(
        NULLIF(d.website, ''),
        NULLIF(pp.website, '')
      ) AS resolved_website
    FROM deduped d
    LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
  )
  SELECT
    -- Build the JSONB with the resolved website overriding the card_pool value
    CASE
      WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
      THEN to_jsonb(e.*) - 'resolved_website' || jsonb_build_object('website', e.resolved_website)
      ELSE to_jsonb(e.*) - 'resolved_website'
    END AS card,
    v_total_unseen AS total_unseen
  FROM enriched e
  ORDER BY e.popularity_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
