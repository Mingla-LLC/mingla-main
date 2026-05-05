-- Place-level AI gate for query_pool_cards
-- Replaces COALESCE(cp.ai_override, cp.ai_approved, true) = true
-- with place_pool.ai_approved JOIN checks.
-- Single cards: parent place must be AI-approved
-- Curated cards: ALL stops' places must be AI-approved
-- Admin override (ai_override = true) still bypasses

-- Drop old signature (13 params — p_offset was removed in prior migration)
DROP FUNCTION IF EXISTS public.query_pool_cards(UUID, TEXT[], DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TEXT, TEXT, TIMESTAMPTZ, UUID[], INTEGER, TEXT[]);

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
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park', 'school', 'primary_school', 'secondary_school', 'university', 'preschool'];
  v_hidden_categories TEXT[] := ARRAY['groceries'];
  v_slug_categories TEXT[];
  v_num_categories INTEGER;
  v_per_category_cap INTEGER;
BEGIN
  -- STRICT CATEGORY NORMALIZATION
  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(DISTINCT slug), '{}') INTO v_slug_categories
    FROM (
      SELECT CASE lower(trim(val))
        WHEN 'nature'           THEN 'nature_views'
        WHEN 'nature & views'   THEN 'nature_views'
        WHEN 'nature_views'     THEN 'nature_views'
        WHEN 'first meet'       THEN 'first_meet'
        WHEN 'first_meet'       THEN 'first_meet'
        WHEN 'picnic park'      THEN 'picnic_park'
        WHEN 'picnic_park'      THEN 'picnic_park'
        WHEN 'drink'            THEN 'drink'
        WHEN 'casual eats'      THEN 'casual_eats'
        WHEN 'casual_eats'      THEN 'casual_eats'
        WHEN 'fine dining'      THEN 'fine_dining'
        WHEN 'fine_dining'      THEN 'fine_dining'
        WHEN 'watch'            THEN 'watch'
        WHEN 'live performance' THEN 'live_performance'
        WHEN 'live_performance' THEN 'live_performance'
        WHEN 'creative & arts'  THEN 'creative_arts'
        WHEN 'creative arts'    THEN 'creative_arts'
        WHEN 'creative_arts'    THEN 'creative_arts'
        WHEN 'play'             THEN 'play'
        WHEN 'wellness'         THEN 'wellness'
        WHEN 'flowers'          THEN 'flowers'
        WHEN 'groceries'        THEN 'groceries'
        ELSE NULL
      END AS slug
      FROM unnest(p_categories) AS val
    ) sub
    WHERE slug IS NOT NULL;
  END IF;

  v_num_categories := GREATEST(COALESCE(array_length(v_slug_categories, 1), 0), 1);
  v_per_category_cap := CEIL(p_limit::float / v_num_categories);

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
      AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
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
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp
        WHERE pp.id = cp.place_pool_id
          AND pp.types && v_excluded_types
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.card_pool_stops cps
        JOIN public.place_pool pp ON pp.id = cps.place_pool_id
        WHERE cps.card_pool_id = cp.id
          AND cp.place_pool_id IS NULL
          AND pp.types && v_excluded_types
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.place_pool pp,
             public.category_type_exclusions cte
        WHERE pp.id = cp.place_pool_id
          AND cte.category_slug = ANY(cp.categories)
          AND cte.excluded_type = ANY(pp.types)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.card_pool_stops cps
        JOIN public.place_pool pp ON pp.id = cps.place_pool_id,
             public.category_type_exclusions cte
        WHERE cps.card_pool_id = cp.id
          AND cp.place_pool_id IS NULL
          AND cte.category_slug = ANY(cp.categories)
          AND cte.excluded_type = ANY(pp.types)
      )
      AND NOT (cp.categories <@ v_hidden_categories)
      AND (
        cp.ai_override = true
        OR (cp.card_type = 'single' AND EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id AND pp.ai_approved = true
        ))
        OR (cp.card_type = 'curated' AND NOT EXISTS (
          SELECT 1 FROM public.card_pool_stops cps
          JOIN public.place_pool pp ON pp.id = cps.place_pool_id
          WHERE cps.card_pool_id = cp.id
            AND (pp.ai_approved IS NULL OR pp.ai_approved = false)
        ))
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
    -- ── Primary path: unseen cards (balanced + interleaved by category) ──────
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
        AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
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
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.card_pool_stops cps
          JOIN public.place_pool pp ON pp.id = cps.place_pool_id
          WHERE cps.card_pool_id = cp.id
            AND cp.place_pool_id IS NULL
            AND pp.types && v_excluded_types
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.place_pool pp,
               public.category_type_exclusions cte
          WHERE pp.id = cp.place_pool_id
            AND cte.category_slug = ANY(cp.categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.card_pool_stops cps
          JOIN public.place_pool pp ON pp.id = cps.place_pool_id,
               public.category_type_exclusions cte
          WHERE cps.card_pool_id = cp.id
            AND cp.place_pool_id IS NULL
            AND cte.category_slug = ANY(cp.categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        AND NOT (cp.categories <@ v_hidden_categories)
        AND (
          cp.ai_override = true
          OR (cp.card_type = 'single' AND EXISTS (
            SELECT 1 FROM public.place_pool pp
            WHERE pp.id = cp.place_pool_id AND pp.ai_approved = true
          ))
          OR (cp.card_type = 'curated' AND NOT EXISTS (
            SELECT 1 FROM public.card_pool_stops cps
            JOIN public.place_pool pp ON pp.id = cps.place_pool_id
            WHERE cps.card_pool_id = cp.id
              AND (pp.ai_approved IS NULL OR pp.ai_approved = false)
          ))
        )
    ),
    deduped AS (
      SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
      FROM filtered f
      ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
    ),
    ranked AS (
      SELECT
        d.*,
        ROW_NUMBER() OVER (
          PARTITION BY d.category
          ORDER BY d.popularity_score DESC
        ) AS cat_rank,
        ROW_NUMBER() OVER (
          PARTITION BY d.category
          ORDER BY d.popularity_score DESC
        ) AS cat_position
      FROM deduped d
    ),
    enriched AS (
      SELECT
        r.*,
        pp.stored_photo_urls,
        pp.photos,
        COALESCE(
          NULLIF(r.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website
      FROM ranked r
      LEFT JOIN public.place_pool pp ON pp.id = r.place_pool_id
      WHERE r.cat_rank <= v_per_category_cap
    )
    SELECT
      CASE
        WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
        THEN to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' || jsonb_build_object('website', e.resolved_website)
        ELSE to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position'
      END AS card,
      v_total_unseen AS total_unseen
    FROM enriched e
    ORDER BY e.cat_position ASC, e.popularity_score DESC
    LIMIT p_limit;

  ELSE
    -- ── Fallback: impression rotation (balanced + interleaved) ───────────────
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
        AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
        AND cp.lat BETWEEN p_lat_min AND p_lat_max
        AND cp.lng BETWEEN p_lng_min AND p_lng_max
        AND (
          (v_use_tiers AND cp.price_tier = ANY(p_price_tiers))
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
        AND NOT EXISTS (
          SELECT 1
          FROM public.card_pool_stops cps
          JOIN public.place_pool pp ON pp.id = cps.place_pool_id
          WHERE cps.card_pool_id = cp.id
            AND cp.place_pool_id IS NULL
            AND pp.types && v_excluded_types
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.place_pool pp,
               public.category_type_exclusions cte
          WHERE pp.id = cp.place_pool_id
            AND cte.category_slug = ANY(cp.categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.card_pool_stops cps
          JOIN public.place_pool pp ON pp.id = cps.place_pool_id,
               public.category_type_exclusions cte
          WHERE cps.card_pool_id = cp.id
            AND cp.place_pool_id IS NULL
            AND cte.category_slug = ANY(cp.categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        AND NOT (cp.categories <@ v_hidden_categories)
        AND (
          cp.ai_override = true
          OR (cp.card_type = 'single' AND EXISTS (
            SELECT 1 FROM public.place_pool pp
            WHERE pp.id = cp.place_pool_id AND pp.ai_approved = true
          ))
          OR (cp.card_type = 'curated' AND NOT EXISTS (
            SELECT 1 FROM public.card_pool_stops cps
            JOIN public.place_pool pp ON pp.id = cps.place_pool_id
            WHERE cps.card_pool_id = cp.id
              AND (pp.ai_approved IS NULL OR pp.ai_approved = false)
          ))
        )
    ),
    with_last_seen AS (
      SELECT
        d.*,
        COALESCE(
          (SELECT MAX(uci.created_at) FROM public.user_card_impressions uci
           WHERE uci.card_pool_id = d.id AND uci.user_id = p_user_id),
          '1970-01-01T00:00:00Z'::timestamptz
        ) AS last_seen_at
      FROM filtered_no_impressions d
    ),
    ranked AS (
      SELECT
        w.*,
        ROW_NUMBER() OVER (
          PARTITION BY w.category
          ORDER BY w.last_seen_at ASC, w.popularity_score DESC
        ) AS cat_rank,
        ROW_NUMBER() OVER (
          PARTITION BY w.category
          ORDER BY w.last_seen_at ASC, w.popularity_score DESC
        ) AS cat_position
      FROM with_last_seen w
    ),
    enriched AS (
      SELECT
        r.*,
        pp.stored_photo_urls,
        pp.photos,
        COALESCE(
          NULLIF(r.website, ''),
          NULLIF(pp.website, '')
        ) AS resolved_website
      FROM ranked r
      LEFT JOIN public.place_pool pp ON pp.id = r.place_pool_id
      WHERE r.cat_rank <= v_per_category_cap
    )
    SELECT
      CASE
        WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
        THEN to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' - 'last_seen_at'
            || jsonb_build_object('website', e.resolved_website)
        ELSE to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' - 'last_seen_at'
      END AS card,
      v_total_unseen AS total_unseen
    FROM enriched e
    ORDER BY e.cat_position ASC, e.last_seen_at ASC, e.popularity_score DESC
    LIMIT p_limit;
  END IF;
END;
$$;
