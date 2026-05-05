-- ═══════════════════════════════════════════════════════════════════════════════
-- Fix Exclusion Logic Bug + Missing Index (Block 2 Regression Fix)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- BUG 1 (Logic — causes 0 results for multi-category queries):
-- The 3 NOT EXISTS per-category exclusion clauses used ANY(v_slug_categories)
-- (the USER's selected categories) instead of ANY(cp.categories) (the CARD's
-- own categories). This caused cross-category contamination: selecting
-- Nature + Watch made Nature's ban list kill Watch cards and vice versa.
-- FIX: Change to ANY(cp.categories) so each card is only checked against
-- exclusions for the categories IT belongs to.
--
-- BUG 2 (Performance — causes 15s timeout):
-- card_pool.place_pool_id had no index despite being used in 6 NOT EXISTS
-- correlated subqueries (3 global + 3 per-category) per query_pool_cards call.
-- FIX: Partial index on active cards only — inactive cards are never queried.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Part A: Add the missing index ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_card_pool_place_pool_id_active
  ON public.card_pool (place_pool_id)
  WHERE is_active = true;

-- ── Part B: Replace query_pool_cards with corrected exclusion logic ───────────

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
  -- Globally excluded place types — must match GLOBAL_EXCLUDED_PLACE_TYPES in categoryPlaceTypes.ts
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park'];
  -- Hidden categories: cards tagged ONLY with these are excluded from regular queries
  v_hidden_categories TEXT[] := ARRAY['groceries'];
  -- Normalized slug version of p_categories (built in the normalization block below)
  v_slug_categories TEXT[];
BEGIN
  -- STRICT CATEGORY NORMALIZATION
  -- card_pool.categories stores slugs (e.g., 'nature_views', 'casual_eats').
  -- Callers send display names (e.g., 'Nature & Views') or slugs.
  -- Only known categories are accepted. Unknown values are dropped.
  -- This is intentional: broken callers fail visibly (too many cards), not silently (zero cards).
  -- To add a new category: add WHEN branches for both display name AND slug.
  IF p_categories = '{}' THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(slug), '{}')
    INTO v_slug_categories
    FROM (
      SELECT CASE val
        -- Display name → slug
        WHEN 'Nature & Views'   THEN 'nature_views'
        WHEN 'First Meet'       THEN 'first_meet'
        WHEN 'Picnic Park'      THEN 'picnic_park'
        WHEN 'Drink'            THEN 'drink'
        WHEN 'Casual Eats'      THEN 'casual_eats'
        WHEN 'Fine Dining'      THEN 'fine_dining'
        WHEN 'Watch'            THEN 'watch'
        WHEN 'Live Performance' THEN 'live_performance'
        WHEN 'Creative & Arts'  THEN 'creative_arts'
        WHEN 'Play'             THEN 'play'
        WHEN 'Wellness'         THEN 'wellness'
        WHEN 'Flowers'          THEN 'flowers'
        WHEN 'Groceries'        THEN 'groceries'
        -- Slug passthrough: if already a known slug, keep it
        WHEN 'nature_views'     THEN 'nature_views'
        WHEN 'first_meet'       THEN 'first_meet'
        WHEN 'picnic_park'      THEN 'picnic_park'
        WHEN 'drink'            THEN 'drink'
        WHEN 'casual_eats'      THEN 'casual_eats'
        WHEN 'fine_dining'      THEN 'fine_dining'
        WHEN 'watch'            THEN 'watch'
        WHEN 'live_performance' THEN 'live_performance'
        WHEN 'creative_arts'    THEN 'creative_arts'
        WHEN 'play'             THEN 'play'
        WHEN 'wellness'         THEN 'wellness'
        WHEN 'flowers'          THEN 'flowers'
        WHEN 'groceries'        THEN 'groceries'
        ELSE NULL  -- Unknown value → dropped
      END AS slug
      FROM unnest(p_categories) AS val
    ) sub
    WHERE slug IS NOT NULL;
  END IF;

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
        (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
        OR
        (NOT v_use_tiers AND cp.price_min <= p_budget_max)
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id NOT IN (SELECT card_id FROM excluded)
      AND cp.id NOT IN (SELECT card_id FROM seen)
      -- Exclude globally banned place types (gym, fitness_center, dog_park)
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp
        WHERE pp.id = cp.place_pool_id
          AND pp.types && v_excluded_types
      )
      -- PER-CATEGORY EXCLUSION (Block 2 — corrected 2026-03-21)
      -- Each card is checked against exclusions for ITS OWN categories only.
      -- Uses cp.categories (card's tags), NOT v_slug_categories (user's query).
      -- A Watch card at a movie_theater is fine (Watch doesn't ban movie_theater).
      -- A Nature card at a movie_theater is killed (Nature bans movie_theater).
      -- This prevents cross-category contamination when multiple categories are selected.
      AND NOT EXISTS (
        SELECT 1
        FROM public.place_pool pp,
             public.category_type_exclusions cte
        WHERE pp.id = cp.place_pool_id
          AND cte.category_slug = ANY(cp.categories)
          AND cte.excluded_type = ANY(pp.types)
      )
      -- Exclude cards that are ONLY tagged with hidden categories
      AND NOT (cp.categories <@ v_hidden_categories)
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
        AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
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
        -- Exclude globally banned place types
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
        -- PER-CATEGORY EXCLUSION (Block 2 — corrected 2026-03-21)
        -- Each card is checked against exclusions for ITS OWN categories only.
        -- Uses cp.categories (card's tags), NOT v_slug_categories (user's query).
        -- A Watch card at a movie_theater is fine (Watch doesn't ban movie_theater).
        -- A Nature card at a movie_theater is killed (Nature bans movie_theater).
        -- This prevents cross-category contamination when multiple categories are selected.
        AND NOT EXISTS (
          SELECT 1
          FROM public.place_pool pp,
               public.category_type_exclusions cte
          WHERE pp.id = cp.place_pool_id
            AND cte.category_slug = ANY(cp.categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        -- Exclude cards that are ONLY tagged with hidden categories
        AND NOT (cp.categories <@ v_hidden_categories)
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
        AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
        AND cp.lat BETWEEN p_lat_min AND p_lat_max
        AND cp.lng BETWEEN p_lng_min AND p_lng_max
        AND (
          (v_use_tiers AND (cp.price_tier = ANY(p_price_tiers) OR cp.price_tier IS NULL))
          OR
          (NOT v_use_tiers AND cp.price_min <= p_budget_max)
        )
        AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
        AND cp.id NOT IN (SELECT card_id FROM excluded)
        -- Exclude globally banned place types
        AND NOT EXISTS (
          SELECT 1 FROM public.place_pool pp
          WHERE pp.id = cp.place_pool_id
            AND pp.types && v_excluded_types
        )
        -- PER-CATEGORY EXCLUSION (Block 2 — corrected 2026-03-21)
        -- Each card is checked against exclusions for ITS OWN categories only.
        -- Uses cp.categories (card's tags), NOT v_slug_categories (user's query).
        -- A Watch card at a movie_theater is fine (Watch doesn't ban movie_theater).
        -- A Nature card at a movie_theater is killed (Nature bans movie_theater).
        -- This prevents cross-category contamination when multiple categories are selected.
        AND NOT EXISTS (
          SELECT 1
          FROM public.place_pool pp,
               public.category_type_exclusions cte
          WHERE pp.id = cp.place_pool_id
            AND cte.category_slug = ANY(cp.categories)
            AND cte.excluded_type = ANY(pp.types)
        )
        -- Exclude cards that are ONLY tagged with hidden categories
        AND NOT (cp.categories <@ v_hidden_categories)
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
      (SELECT COUNT(*) FROM deduped)::BIGINT AS total_unseen
    FROM with_impression_age w;

  END IF;
END;
$$;
