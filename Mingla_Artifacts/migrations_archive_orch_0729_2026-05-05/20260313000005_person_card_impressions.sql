-- Migration: person_card_impressions + query_person_hero_cards
-- Description: Tracks which card_pool cards have been shown to a specific person,
-- preventing repeats across holidays and shuffles. Also adds the DB function
-- for fast pool-first hero card queries with progressive radius expansion.

-- =====================================================
-- 1. person_card_impressions table
-- =====================================================

CREATE TABLE public.person_card_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.saved_people(id) ON DELETE CASCADE,
  card_pool_id UUID NOT NULL REFERENCES public.card_pool(id) ON DELETE CASCADE,
  holiday_key TEXT NOT NULL,
  served_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_person_card_impression UNIQUE (user_id, person_id, card_pool_id)
);

CREATE INDEX idx_person_card_impressions_lookup
  ON public.person_card_impressions(user_id, person_id);

ALTER TABLE public.person_card_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own person card impressions"
  ON public.person_card_impressions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own person card impressions"
  ON public.person_card_impressions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own person card impressions"
  ON public.person_card_impressions FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 2. query_person_hero_cards function
-- =====================================================

CREATE OR REPLACE FUNCTION public.query_person_hero_cards(
  p_user_id UUID,
  p_person_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_categories TEXT[],
  p_curated_experience_type TEXT DEFAULT NULL,
  p_initial_radius_meters INT DEFAULT 15000,
  p_max_radius_meters INT DEFAULT 100000
)
RETURNS TABLE (
  card JSONB,
  card_type TEXT,
  total_available BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_radius INT := p_initial_radius_meters;
  v_lat_delta DOUBLE PRECISION;
  v_lng_delta DOUBLE PRECISION;
  v_curated_count INT := 0;
  v_single_count INT := 0;
BEGIN
  -- Progressive radius expansion loop
  WHILE v_radius <= p_max_radius_meters LOOP
    v_lat_delta := v_radius::DOUBLE PRECISION / 111320.0;
    v_lng_delta := v_radius::DOUBLE PRECISION / (111320.0 * COS(p_lat * PI() / 180.0));

    -- Count available curated cards
    SELECT COUNT(*) INTO v_curated_count
    FROM card_pool cp
    WHERE cp.card_type = 'curated'
      AND cp.is_active = true
      AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
      AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type)
      AND NOT EXISTS (
        SELECT 1 FROM person_card_impressions pci
        WHERE pci.user_id = p_user_id
          AND pci.person_id = p_person_id
          AND pci.card_pool_id = cp.id
      );

    -- Count available single cards
    SELECT COUNT(*) INTO v_single_count
    FROM card_pool cp
    WHERE cp.card_type = 'single'
      AND cp.is_active = true
      AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
      AND cp.category = ANY(p_categories)
      AND NOT EXISTS (
        SELECT 1 FROM person_card_impressions pci
        WHERE pci.user_id = p_user_id
          AND pci.person_id = p_person_id
          AND pci.card_pool_id = cp.id
      );

    -- If we have enough cards, return them
    IF v_curated_count >= 3 AND v_single_count >= 3 THEN
      -- Return 3 curated cards (random order)
      RETURN QUERY
      SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, (v_curated_count + v_single_count)::BIGINT AS total_available
      FROM card_pool cp
      WHERE cp.card_type = 'curated'
        AND cp.is_active = true
        AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
        AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
        AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type)
        AND NOT EXISTS (
          SELECT 1 FROM person_card_impressions pci
          WHERE pci.user_id = p_user_id
            AND pci.person_id = p_person_id
            AND pci.card_pool_id = cp.id
        )
      ORDER BY RANDOM()
      LIMIT 3;

      -- Return 3 category cards (random order)
      RETURN QUERY
      SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, (v_curated_count + v_single_count)::BIGINT AS total_available
      FROM card_pool cp
      WHERE cp.card_type = 'single'
        AND cp.is_active = true
        AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
        AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
        AND cp.category = ANY(p_categories)
        AND NOT EXISTS (
          SELECT 1 FROM person_card_impressions pci
          WHERE pci.user_id = p_user_id
            AND pci.person_id = p_person_id
            AND pci.card_pool_id = cp.id
        )
      ORDER BY RANDOM()
      LIMIT 3;

      RETURN;
    END IF;

    -- Not enough — expand radius by 50%
    v_radius := (v_radius * 1.5)::INT;
  END LOOP;

  -- At max radius, return whatever we have (may be < 6)
  v_lat_delta := p_max_radius_meters::DOUBLE PRECISION / 111320.0;
  v_lng_delta := p_max_radius_meters::DOUBLE PRECISION / (111320.0 * COS(p_lat * PI() / 180.0));

  RETURN QUERY
  SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, 0::BIGINT AS total_available
  FROM card_pool cp
  WHERE cp.is_active = true
    AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
    AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
    AND (
      (cp.card_type = 'curated' AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type))
      OR
      (cp.card_type = 'single' AND cp.category = ANY(p_categories))
    )
    AND NOT EXISTS (
      SELECT 1 FROM person_card_impressions pci
      WHERE pci.user_id = p_user_id
        AND pci.person_id = p_person_id
        AND pci.card_pool_id = cp.id
    )
  ORDER BY cp.card_type DESC, RANDOM()
  LIMIT 6;
END;
$$;
