-- Price Tier Array Migration
-- Converts price_tier TEXT → price_tiers TEXT[] on place_pool and card_pool.
-- Keeps old price_tier column for backward compatibility.
-- Updates admin_edit_place and query_pool_cards RPCs.
-- Backfills from Google price_level and deterministic type mapping.


-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add price_tiers array columns
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS price_tiers TEXT[] DEFAULT '{}';
ALTER TABLE card_pool ADD COLUMN IF NOT EXISTS price_tiers TEXT[] DEFAULT '{}';


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Backfill from existing price_tier single value
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE place_pool
SET price_tiers = ARRAY[price_tier]
WHERE price_tier IS NOT NULL
  AND (price_tiers IS NULL OR price_tiers = '{}');

UPDATE card_pool
SET price_tiers = ARRAY[price_tier]
WHERE price_tier IS NOT NULL
  AND (price_tiers IS NULL OR price_tiers = '{}');


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Backfill from Google price_level (places with price_level but no tier)
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
WHERE price_level = 'PRICE_LEVEL_FREE' AND (price_tiers IS NULL OR price_tiers = '{}') AND is_active = true;

UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
WHERE price_level = 'PRICE_LEVEL_INEXPENSIVE' AND (price_tiers IS NULL OR price_tiers = '{}') AND is_active = true;

UPDATE place_pool SET price_tiers = ARRAY['comfy'], price_tier = 'comfy'
WHERE price_level = 'PRICE_LEVEL_MODERATE' AND (price_tiers IS NULL OR price_tiers = '{}') AND is_active = true;

UPDATE place_pool SET price_tiers = ARRAY['bougie'], price_tier = 'bougie'
WHERE price_level = 'PRICE_LEVEL_EXPENSIVE' AND (price_tiers IS NULL OR price_tiers = '{}') AND is_active = true;

UPDATE place_pool SET price_tiers = ARRAY['lavish'], price_tier = 'lavish'
WHERE price_level = 'PRICE_LEVEL_VERY_EXPENSIVE' AND (price_tiers IS NULL OR price_tiers = '{}') AND is_active = true;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Deterministic type-based backfill for places without Google price data
--    Only fills NULLs/empty arrays on active places.
-- ═══════════════════════════════════════════════════════════════════════════════

-- FREE / OUTDOOR — definitively free
UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN (
    'park', 'city_park', 'state_park', 'nature_preserve',
    'hiking_area', 'campground', 'camping_cabin',
    'garden', 'botanical_garden',
    'picnic_ground', 'playground', 'plaza',
    'sculpture', 'monument', 'historical_landmark', 'historical_place', 'cultural_landmark'
  );

-- BUDGET EATS — definitively cheap
UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN (
    'fast_food_restaurant',
    'sandwich_shop', 'hamburger_restaurant', 'hot_dog_restaurant', 'hot_dog_stand',
    'pizza_delivery',
    'taco_restaurant', 'chicken_restaurant', 'chicken_wings_restaurant',
    'breakfast_restaurant', 'diner'
  );

-- CAFES / FIRST MEET — definitively cheap
UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN (
    'cafe', 'coffee_shop', 'coffee_stand',
    'tea_house',
    'bakery', 'dessert_shop', 'donut_shop', 'ice_cream_shop',
    'juice_shop',
    'book_store'
  );

-- ARTS / CULTURE — mostly free
UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN (
    'art_gallery', 'art_museum', 'museum', 'history_museum',
    'cultural_center', 'community_center', 'library'
  );

-- GROCERY — budget
UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('grocery_store', 'supermarket', 'asian_grocery_store');

-- RESTAURANTS — no Google price, could be chill or comfy (range)
UPDATE place_pool SET price_tiers = ARRAY['chill', 'comfy'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN (
    'restaurant', 'american_restaurant', 'mexican_restaurant', 'chinese_restaurant',
    'vietnamese_restaurant', 'italian_restaurant', 'seafood_restaurant',
    'mediterranean_restaurant', 'indian_restaurant', 'asian_restaurant',
    'japanese_restaurant', 'korean_restaurant', 'thai_restaurant', 'ramen_restaurant',
    'greek_restaurant', 'latin_american_restaurant', 'peruvian_restaurant',
    'lebanese_restaurant', 'cuban_restaurant', 'colombian_restaurant',
    'caribbean_restaurant', 'spanish_restaurant', 'filipino_restaurant',
    'hawaiian_restaurant', 'british_restaurant', 'european_restaurant',
    'halal_restaurant', 'asian_fusion_restaurant', 'hot_pot_restaurant',
    'korean_barbecue_restaurant', 'vegetarian_restaurant', 'vegan_restaurant',
    'soul_food_restaurant', 'fondue_restaurant', 'fish_and_chips_restaurant',
    'family_restaurant', 'southwestern_us_restaurant', 'japanese_izakaya_restaurant',
    'bistro',
    'pizza_restaurant', 'brunch_restaurant', 'barbecue_restaurant', 'buffet_restaurant',
    'salad_shop', 'acai_shop'
  );

-- STEAK HOUSE — comfy to bougie
UPDATE place_pool SET price_tiers = ARRAY['comfy', 'bougie'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type = 'steak_house';

-- FINE DINING — bougie to lavish
UPDATE place_pool SET price_tiers = ARRAY['bougie', 'lavish'], price_tier = 'bougie'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type = 'fine_dining_restaurant';

-- BARS — chill to comfy
UPDATE place_pool SET price_tiers = ARRAY['chill', 'comfy'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('bar', 'pub', 'irish_pub', 'sports_bar', 'brewery', 'brewpub', 'beer_garden');

-- COCKTAIL / WINE / HOOKAH / NIGHTLIFE — comfy to bougie
UPDATE place_pool SET price_tiers = ARRAY['comfy', 'bougie'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('cocktail_bar', 'wine_bar', 'lounge_bar', 'hookah_bar', 'night_club', 'winery');

-- WELLNESS / SPA — comfy to bougie
UPDATE place_pool SET price_tiers = ARRAY['comfy', 'bougie'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('spa', 'massage_spa', 'massage', 'day_spa', 'sauna', 'wellness_center');

-- BEAUTY — chill to comfy
UPDATE place_pool SET price_tiers = ARRAY['chill', 'comfy'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('beauty_salon', 'hair_salon', 'nail_salon', 'barber_shop');

-- SKIN CARE / MAKEUP — comfy
UPDATE place_pool SET price_tiers = ARRAY['comfy'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('skin_care_clinic', 'makeup_artist');

-- ART STUDIO — comfy
UPDATE place_pool SET price_tiers = ARRAY['comfy'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type = 'art_studio';

-- RESORT — bougie to lavish
UPDATE place_pool SET price_tiers = ARRAY['bougie', 'lavish'], price_tier = 'bougie'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type = 'resort_hotel';

-- MOVIE THEATER — chill to comfy
UPDATE place_pool SET price_tiers = ARRAY['chill', 'comfy'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type = 'movie_theater';

-- PERFORMING ARTS / CONCERT — comfy to bougie
UPDATE place_pool SET price_tiers = ARRAY['comfy', 'bougie'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('performing_arts_theater', 'opera_house', 'concert_hall', 'amphitheatre');

-- COMEDY / LIVE MUSIC / DANCE — chill to comfy
UPDATE place_pool SET price_tiers = ARRAY['chill', 'comfy'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('comedy_club', 'live_music_venue', 'dance_hall');

-- ARENA / STADIUM — bougie to lavish
UPDATE place_pool SET price_tiers = ARRAY['bougie', 'lavish'], price_tier = 'bougie'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('arena', 'stadium');

-- AMUSEMENT / WATER PARK — comfy
UPDATE place_pool SET price_tiers = ARRAY['comfy'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN ('amusement_park', 'water_park');

-- ACTIVITIES — comfy
UPDATE place_pool SET price_tiers = ARRAY['comfy'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type IN (
    'amusement_center', 'bowling_alley', 'miniature_golf_course',
    'video_arcade', 'go_karting_venue', 'ice_skating_rink',
    'adventure_sports_center'
  );

-- CASINO — bougie
UPDATE place_pool SET price_tiers = ARRAY['bougie'], price_tier = 'bougie'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}')
  AND primary_type = 'casino';

-- REMAINING active places with null price_tiers: safe default comfy
UPDATE place_pool SET price_tiers = ARRAY['comfy'], price_tier = 'comfy'
WHERE is_active = true AND (price_tiers IS NULL OR price_tiers = '{}');


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Cascade price_tiers to card_pool from place_pool
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE card_pool cp
SET price_tiers = pp.price_tiers,
    price_tier = pp.price_tiers[1]
FROM place_pool pp
WHERE cp.place_pool_id = pp.id
  AND (cp.price_tiers IS NULL OR cp.price_tiers = '{}')
  AND pp.price_tiers IS NOT NULL
  AND pp.price_tiers != '{}';


-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Index for array overlap queries
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_place_pool_price_tiers ON place_pool USING GIN (price_tiers);
CREATE INDEX IF NOT EXISTS idx_card_pool_price_tiers ON card_pool USING GIN (price_tiers);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. Update admin_edit_place RPC — add p_price_tiers parameter
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_edit_place(UUID, TEXT, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.admin_edit_place(
  p_place_id UUID,
  p_name TEXT DEFAULT NULL,
  p_price_tier TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_seeding_category TEXT DEFAULT NULL,
  p_price_tiers TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_effective_tiers TEXT[];
BEGIN
  -- Admin auth check
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Determine effective price_tiers: explicit array wins, then fall back to single tier
  v_effective_tiers := COALESCE(
    p_price_tiers,
    CASE WHEN p_price_tier IS NOT NULL THEN ARRAY[p_price_tier] ELSE NULL END
  );

  UPDATE public.place_pool
  SET
    name = COALESCE(p_name, name),
    price_tier = COALESCE(p_price_tier, CASE WHEN v_effective_tiers IS NOT NULL THEN v_effective_tiers[1] ELSE price_tier END),
    price_tiers = COALESCE(v_effective_tiers, price_tiers),
    is_active = COALESCE(p_is_active, is_active),
    seeding_category = COALESCE(p_seeding_category, seeding_category),
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object(
    'id', id, 'name', name, 'price_tier', price_tier, 'price_tiers', price_tiers,
    'is_active', is_active, 'seeding_category', seeding_category
  )
  INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Place not found: %', p_place_id;
  END IF;

  -- Cascade changes to cards
  IF p_is_active IS NOT NULL THEN
    UPDATE public.card_pool
    SET is_active = p_is_active, updated_at = now()
    WHERE place_pool_id = p_place_id AND card_type = 'single';
  END IF;

  -- Cascade price_tiers to card_pool
  IF v_effective_tiers IS NOT NULL THEN
    UPDATE public.card_pool
    SET price_tiers = v_effective_tiers,
        price_tier = v_effective_tiers[1],
        updated_at = now()
    WHERE place_pool_id = p_place_id AND card_type = 'single';
  END IF;

  RETURN v_result;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Update query_pool_cards RPC — use array overlap for price_tiers
-- ═══════════════════════════════════════════════════════════════════════════════

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
        (v_use_tiers AND cp.price_tiers && p_price_tiers)
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
          (v_use_tiers AND cp.price_tiers && p_price_tiers)
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
          (v_use_tiers AND cp.price_tiers && p_price_tiers)
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
