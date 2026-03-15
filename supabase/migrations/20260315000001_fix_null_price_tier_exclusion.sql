-- Migration: fix_null_price_tier_exclusion
-- Combines two fixes:
--   Change 6: NULL price_tier cards were silently excluded when filtering by tiers.
--             Cards with price_tier IS NULL should match any tier filter (they simply
--             haven't been classified yet).
--     6B: Set DEFAULT 'comfy' so future inserts get a sensible value.
--     6C: Backfill existing NULL rows.
--     6A: Adjust the query to include NULL price_tier alongside the ANY() check.
--
--   Change 8: Impression rotation fallback. When every matching card has already been
--             seen (v_total_unseen = 0), instead of returning nothing, serve the
--             least-recently-seen cards so users always have something to swipe.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 1: Backfill existing NULL price_tiers + add DEFAULT (Changes 6C, 6B)
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE public.card_pool
SET price_tier = 'comfy'
WHERE price_tier IS NULL AND is_active = true;

ALTER TABLE public.card_pool
  ALTER COLUMN price_tier SET DEFAULT 'comfy';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Part 2: Rewrite query_pool_cards (Changes 6A + 8)
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
  -- ── Step 1: Count total unseen cards ──────────────────────────────────────
  -- Same filter chain as the return query, used to populate total_unseen.

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
        -- Change 6A: Include cards with NULL price_tier so they aren't silently dropped
        (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
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
  SELECT COUNT(*) INTO v_total_unseen FROM deduped;

  -- ── Step 2: Branch on whether unseen cards exist ──────────────────────────

  IF v_total_unseen > 0 THEN
    -- ── Primary path: return unseen cards (ordered by popularity) ──────────
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
          -- Change 6A: Include cards with NULL price_tier
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
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
    -- LEFT JOIN place_pool to fill in missing website (existing behaviour)
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

  ELSE
    -- ── Change 8: Fallback — impression rotation ────────────────────────────
    -- When all matching cards have been seen, remove the impression exclusion
    -- and serve the least-recently-seen cards first so users always have
    -- something to swipe.
    RETURN QUERY
    WITH
    excluded AS (
      SELECT unnest(p_exclude_card_ids) AS card_id
    ),
    filtered_no_impressions AS (
      SELECT cp.*
      FROM public.card_pool cp
      WHERE cp.is_active = true
        AND cp.card_type = p_card_type
        AND (p_categories = '{}' OR cp.categories && p_categories)
        AND cp.lat BETWEEN p_lat_min AND p_lat_max
        AND cp.lng BETWEEN p_lng_min AND p_lng_max
        AND (
          -- Change 6A: Include cards with NULL price_tier
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        -- NOTE: no impression exclusion here — that's the whole point of the fallback
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
      FROM filtered_no_impressions f
      ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
    ),
    with_impression_age AS (
      SELECT
        d.*,
        COALESCE(uci.created_at, '1970-01-01'::TIMESTAMPTZ) AS last_seen_at,
        COALESCE(
          NULLIF(d.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website
      FROM deduped d
      LEFT JOIN public.user_card_impressions uci
        ON uci.card_pool_id = d.id AND uci.user_id = p_user_id
      LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
      ORDER BY last_seen_at ASC, d.popularity_score DESC
      LIMIT p_limit
      OFFSET p_offset
    )
    SELECT
      CASE
        WHEN w.resolved_website IS NOT NULL AND (w.website IS NULL OR w.website = '')
        THEN to_jsonb(w.*) - 'resolved_website' - 'last_seen_at' || jsonb_build_object('website', w.resolved_website)
        ELSE to_jsonb(w.*) - 'resolved_website' - 'last_seen_at'
      END AS card,
      -- NOTE: In rotation mode, total_unseen = total matching cards (all seen).
      -- Callers use this to decide hasMore (non-zero → keep requesting batches).
      -- This is intentional: rotated cards should keep flowing.
      (SELECT COUNT(*) FROM deduped)::BIGINT AS total_unseen
    FROM with_impression_age w;

  END IF;
END;
$$;
