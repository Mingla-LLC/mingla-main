-- Fix RC-001: query_person_hero_cards checks person_id only for impression dedup,
-- but paired user impressions are stored in paired_user_id column.
-- Fix: OR on both columns in all 5 NOT EXISTS clauses.
-- Also adds covering indexes for fast impression lookups.

-- ── Drop old index, create covering indexes ────────────────────────────────────

DROP INDEX IF EXISTS idx_person_card_impressions_lookup;

CREATE INDEX IF NOT EXISTS idx_person_card_impressions_person_card
  ON person_card_impressions (user_id, person_id, card_pool_id);

CREATE INDEX IF NOT EXISTS idx_person_card_impressions_paired_card
  ON person_card_impressions (user_id, paired_user_id, card_pool_id)
  WHERE paired_user_id IS NOT NULL;

-- ── Replace function with fixed NOT EXISTS (OR on person_id / paired_user_id) ──

CREATE OR REPLACE FUNCTION public.query_person_hero_cards(
  p_user_id UUID,
  p_person_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_categories TEXT[],
  p_curated_experience_type TEXT DEFAULT NULL,
  p_initial_radius_meters INT DEFAULT 15000,
  p_max_radius_meters INT DEFAULT 100000,
  p_exclude_card_ids UUID[] DEFAULT '{}'
)
RETURNS TABLE(card JSONB, card_type TEXT, total_available BIGINT)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_radius INT := p_initial_radius_meters;
  v_lat_delta DOUBLE PRECISION;
  v_lng_delta DOUBLE PRECISION;
  v_curated_count INT := 0;
  v_single_count INT := 0;
  v_slug_categories TEXT[];
BEGIN
  -- ── SLUG NORMALIZATION ─────────────────────────────────────────────────
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
        WHEN 'picnic'           THEN 'picnic_park'
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

  -- Progressive radius expansion loop
  WHILE v_radius <= p_max_radius_meters LOOP
    v_lat_delta := v_radius::DOUBLE PRECISION / 111320.0;
    v_lng_delta := v_radius::DOUBLE PRECISION / (111320.0 * COS(p_lat * PI() / 180.0));

    SELECT COUNT(*) INTO v_curated_count
    FROM card_pool cp
    WHERE cp.card_type = 'curated'
      AND cp.is_active = true
      AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
      AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type)
      AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
      AND NOT EXISTS (
        SELECT 1 FROM person_card_impressions pci
        WHERE pci.user_id = p_user_id
          AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
          AND pci.card_pool_id = cp.id
      );

    SELECT COUNT(*) INTO v_single_count
    FROM card_pool cp
    WHERE cp.card_type = 'single'
      AND cp.is_active = true
      AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
      AND cp.category = ANY(v_slug_categories)
      AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
      AND NOT EXISTS (
        SELECT 1 FROM person_card_impressions pci
        WHERE pci.user_id = p_user_id
          AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
          AND pci.card_pool_id = cp.id
      );

    IF v_curated_count >= 3 AND v_single_count >= 3 THEN
      RETURN QUERY
      SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, (v_curated_count + v_single_count)::BIGINT AS total_available
      FROM card_pool cp
      WHERE cp.card_type = 'curated'
        AND cp.is_active = true
        AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
        AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
        AND (p_curated_experience_type IS NULL OR cp.experience_type = p_curated_experience_type)
        AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
        AND NOT EXISTS (
          SELECT 1 FROM person_card_impressions pci
          WHERE pci.user_id = p_user_id
            AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
            AND pci.card_pool_id = cp.id
        )
      ORDER BY RANDOM()
      LIMIT 3;

      RETURN QUERY
      SELECT to_jsonb(cp.*) AS card, cp.card_type::TEXT, (v_curated_count + v_single_count)::BIGINT AS total_available
      FROM card_pool cp
      WHERE cp.card_type = 'single'
        AND cp.is_active = true
        AND cp.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
        AND cp.lng BETWEEN (p_lng - v_lng_delta) AND (p_lng + v_lng_delta)
        AND cp.category = ANY(v_slug_categories)
        AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
        AND NOT EXISTS (
          SELECT 1 FROM person_card_impressions pci
          WHERE pci.user_id = p_user_id
            AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
            AND pci.card_pool_id = cp.id
        )
      ORDER BY RANDOM()
      LIMIT 3;

      RETURN;
    END IF;

    v_radius := (v_radius * 1.5)::INT;
  END LOOP;

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
      (cp.card_type = 'single' AND cp.category = ANY(v_slug_categories))
    )
    AND cp.id NOT IN (SELECT unnest(p_exclude_card_ids))
    AND NOT EXISTS (
      SELECT 1 FROM person_card_impressions pci
      WHERE pci.user_id = p_user_id
        AND (pci.person_id = p_person_id OR pci.paired_user_id = p_person_id)
        AND pci.card_pool_id = cp.id
    )
  ORDER BY cp.card_type ASC, RANDOM()
  LIMIT 6;
END;
$function$;
