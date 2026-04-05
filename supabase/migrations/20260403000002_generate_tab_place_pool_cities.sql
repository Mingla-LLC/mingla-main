-- ─── Generate Tab: Place-pool-sourced country + city lists ──────────────────
-- The Generate Cards tab needs to show cities from place_pool (seeded places),
-- not card_pool (already-generated cards). Without this, new cities with seeded
-- places but zero cards are invisible and can't have cards generated.

-- ─── RPC: admin_place_pool_country_list ─────────────────────────────────────
-- Returns distinct countries that have approved, active places in place_pool.
CREATE OR REPLACE FUNCTION public.admin_place_pool_country_list()
RETURNS TABLE (
  country        TEXT,
  approved_places BIGINT,
  with_photos     BIGINT,
  existing_cards  BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(pp.country, 'Unknown') AS country,
    COUNT(*) FILTER (WHERE pp.ai_approved = TRUE)                           AS approved_places,
    COUNT(*) FILTER (WHERE pp.ai_approved = TRUE
                       AND pp.stored_photo_urls IS NOT NULL
                       AND array_length(pp.stored_photo_urls, 1) > 0)       AS with_photos,
    (SELECT COUNT(*) FROM public.card_pool cp
     WHERE cp.country = pp.country AND cp.is_active = TRUE)                 AS existing_cards
  FROM public.place_pool pp
  WHERE pp.is_active = TRUE
  GROUP BY pp.country
  ORDER BY approved_places DESC;
END;
$$;

-- ─── RPC: admin_place_pool_city_list ────────────────────────────────────────
-- Returns cities within a country from place_pool, with stats useful for the
-- Generate tab: how many approved places, how many have photos, how many
-- already have cards in card_pool.
CREATE OR REPLACE FUNCTION public.admin_place_pool_city_list(p_country TEXT)
RETURNS TABLE (
  city_name        TEXT,
  approved_places  BIGINT,
  with_photos      BIGINT,
  existing_cards   BIGINT,
  ready_to_generate BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(pp.city, 'Unknown City')                                       AS city_name,
    COUNT(*) FILTER (WHERE pp.ai_approved = TRUE)                           AS approved_places,
    COUNT(*) FILTER (WHERE pp.ai_approved = TRUE
                       AND pp.stored_photo_urls IS NOT NULL
                       AND array_length(pp.stored_photo_urls, 1) > 0)       AS with_photos,
    -- Count single cards already in card_pool for this city
    (SELECT COUNT(*) FROM public.card_pool cp
     WHERE cp.city = pp.city AND cp.country = p_country
       AND cp.is_active = TRUE AND cp.card_type = 'single')                 AS existing_cards,
    -- Ready = approved + has photos - already has a card
    COUNT(*) FILTER (
      WHERE pp.ai_approved = TRUE
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.card_pool cp
          WHERE cp.google_place_id = pp.google_place_id AND cp.is_active = TRUE
        )
    )                                                                        AS ready_to_generate
  FROM public.place_pool pp
  WHERE pp.is_active = TRUE
    AND pp.country = p_country
  GROUP BY pp.city
  ORDER BY approved_places DESC;
END;
$$;
