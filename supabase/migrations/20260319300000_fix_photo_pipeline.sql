-- Fix photo pipeline: query_pool_cards must include stored_photo_urls and photos
-- from place_pool so that poolCardToApiCard can resolve photos at serve time.
--
-- RC-001: enriched CTE never JOINed stored_photo_urls → Unsplash fallback
-- RC-002: poolCardToApiCard read card.image_url instead of stored_photo_urls
-- (fixed in edge function code, but SQL must provide the data)

-- Drop the old overload (13-param version) if it still exists
DROP FUNCTION IF EXISTS public.query_pool_cards(
  UUID, TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, TEXT, TEXT, TIMESTAMPTZ, UUID[], INTEGER, INTEGER
);

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
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center'];
BEGIN
  -- ── Step 1: Count total unseen cards ──────────────────────────────────────

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
        (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
        OR
        (NOT v_use_tiers AND cp.price_min <= p_budget_max)
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id NOT IN (SELECT card_id FROM excluded)
      AND cp.id NOT IN (SELECT card_id FROM seen)
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp
        WHERE pp.id = cp.place_pool_id
          AND pp.types && v_excluded_types
      )
  ),
  deduped AS (
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
    FROM filtered f
    ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  )
  SELECT COUNT(*) INTO v_total_unseen FROM deduped;

  -- ── Step 2: Branch on whether unseen cards exist ──────────────────────────

  IF v_total_unseen > 0 THEN
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
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        AND cp.id NOT IN (SELECT card_id FROM seen)
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
      FROM filtered f
      ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
    ),
    enriched AS (
      SELECT
        d.*,
        COALESCE(
          NULLIF(d.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website,
        pp.stored_photo_urls AS pp_stored_photo_urls,
        pp.photos AS pp_photos
      FROM deduped d
      LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
    )
    SELECT
      to_jsonb(e.*) - 'resolved_website' - 'raw_google_data' - 'curated_pairing_key'
        - 'created_at' - 'updated_at' - 'pp_stored_photo_urls' - 'pp_photos'
        || jsonb_build_object(
          'stored_photo_urls', e.pp_stored_photo_urls,
          'photos', e.pp_photos
        )
        || CASE WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
             THEN jsonb_build_object('website', e.resolved_website)
             ELSE '{}'::jsonb
           END
      AS card,
      v_total_unseen AS total_unseen
    FROM enriched e
    ORDER BY e.popularity_score DESC
    LIMIT p_limit
    OFFSET p_offset;

  ELSE
    -- ── Fallback: impression rotation ────────────────────────────────────────
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
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
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
        ) AS resolved_website,
        pp.stored_photo_urls AS pp_stored_photo_urls,
        pp.photos AS pp_photos
      FROM deduped d
      LEFT JOIN public.user_card_impressions uci
        ON uci.card_pool_id = d.id AND uci.user_id = p_user_id
      LEFT JOIN public.place_pool pp ON pp.id = d.place_pool_id
      ORDER BY last_seen_at ASC, d.popularity_score DESC
      LIMIT p_limit
      OFFSET p_offset
    )
    SELECT
      to_jsonb(w.*) - 'resolved_website' - 'last_seen_at' - 'raw_google_data'
        - 'curated_pairing_key' - 'created_at' - 'updated_at'
        - 'pp_stored_photo_urls' - 'pp_photos'
        || jsonb_build_object(
          'stored_photo_urls', w.pp_stored_photo_urls,
          'photos', w.pp_photos
        )
        || CASE WHEN w.resolved_website IS NOT NULL AND (w.website IS NULL OR w.website = '')
             THEN jsonb_build_object('website', w.resolved_website)
             ELSE '{}'::jsonb
           END
      AS card,
      (SELECT COUNT(*) FROM deduped)::BIGINT AS total_unseen
    FROM with_impression_age w;

  END IF;
END;
$$;

-- Maintain security: service_role only
REVOKE EXECUTE ON FUNCTION public.query_pool_cards FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.query_pool_cards TO service_role;
