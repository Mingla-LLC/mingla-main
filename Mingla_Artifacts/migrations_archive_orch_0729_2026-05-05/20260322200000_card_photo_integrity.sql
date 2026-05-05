-- CARD PHOTO INTEGRITY FIX (Block 5b — 2026-03-22)
-- Step 1: Backfill curated card hero images from first stop's place photos
-- Step 2: Link 6 orphaned single cards by google_place_id match
-- Step 3: Delete 29 true orphan single cards (no matching place exists)
-- Step 4: Add card_image_pct to cross-city RPCs
-- Step 5: Clean 14 dirty city values in card_pool.city column

-- ── Op 1: Backfill curated card hero images from first stop's place ──────────
-- Curated cards reference places via card_pool_stops (normalized child table).
-- The card-level image_url is for the swipe deck preview only.
-- Each stop already has its own photos in the JSONB stops data.
--
-- EDGE CASE: "First Date" and "Romantic" experience types can have an optional
-- Flowers stop at stop_order = 0. The generator uses mainStops[0] (first
-- NON-optional stop) for the hero image. Since card_pool_stops does not store
-- an `optional` flag, we use MIN(stop_order) which may select the Flowers stop
-- for those types. This is acceptable — a photo of a flower shop is better than
-- no photo, and these cards will get the correct hero on next regeneration.
--
-- Safety: UPDATE only, idempotent, no schema changes.

UPDATE card_pool cp
SET
  image_url = pp.stored_photo_urls[1],
  images = pp.stored_photo_urls[1:5]
FROM (
  SELECT DISTINCT ON (cps.card_pool_id)
    cps.card_pool_id,
    cps.place_pool_id
  FROM card_pool_stops cps
  ORDER BY cps.card_pool_id, cps.stop_order ASC
) first_stop
JOIN place_pool pp ON pp.id = first_stop.place_pool_id
WHERE cp.id = first_stop.card_pool_id
  AND cp.card_type = 'curated'
  AND cp.image_url IS NULL
  AND cp.is_active = true
  AND pp.stored_photo_urls IS NOT NULL
  AND array_length(pp.stored_photo_urls, 1) > 0;

-- ── Op 2: Link orphaned single cards by google_place_id ──────────────────────
-- 6 single cards have place_pool_id = NULL but their google_place_id matches
-- an active place in place_pool. Set the FK and copy photos.
--
-- Safety: UPDATE only, idempotent.

UPDATE card_pool cp
SET
  place_pool_id = pp.id,
  image_url = COALESCE(cp.image_url, pp.stored_photo_urls[1]),
  images = CASE
    WHEN cp.image_url IS NULL THEN pp.stored_photo_urls[1:5]
    ELSE cp.images
  END
FROM place_pool pp
WHERE cp.card_type = 'single'
  AND cp.is_active = true
  AND cp.place_pool_id IS NULL
  AND cp.google_place_id = pp.google_place_id
  AND pp.is_active = true;

-- ── Op 3: Delete true orphan single cards ────────────────────────────────────
-- Single cards where place_pool_id IS NULL and no matching google_place_id
-- exists in place_pool. These cards have no parent place, no photos, and can
-- never be repaired. Permanent deletion is correct.
--
-- FK cascades on card_pool handle cleanup:
--   card_pool_stops: ON DELETE CASCADE (from card_pool_stops FK to card_pool)
--   user_card_impressions: any FK to card_pool cascades
--
-- Safety: DELETE. Count should be ~29. Run with verification query after.

DELETE FROM card_pool
WHERE card_type = 'single'
  AND is_active = true
  AND place_pool_id IS NULL
  AND (google_place_id IS NULL OR google_place_id NOT IN (
    SELECT google_place_id
    FROM place_pool
    WHERE google_place_id IS NOT NULL
  ));

-- ── Op 4a: Update admin_country_overview to include card_image_pct ───────────
-- Must DROP first because we're adding a new OUT parameter (card_image_pct),
-- which changes the return type. PostgreSQL forbids that with CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.admin_country_overview();

CREATE OR REPLACE FUNCTION public.admin_country_overview()
RETURNS TABLE (
  country TEXT,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  category_coverage INTEGER,
  total_cards BIGINT,
  uncategorized_count BIGINT,
  city_count BIGINT,
  card_image_pct INTEGER
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
  WITH card_counts AS (
    SELECT
      COALESCE(cp.country, 'Unknown') AS c_country,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE cp.image_url IS NOT NULL) AS with_images
    FROM public.card_pool cp
    WHERE cp.is_active
    GROUP BY COALESCE(cp.country, 'Unknown')
  )
  SELECT
    COALESCE(pp.country, 'Unknown') AS country,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    COUNT(*) FILTER (WHERE pp.is_active
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE pp.is_active
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(DISTINCT pp.seeding_category) FILTER (
      WHERE pp.is_active AND pp.seeding_category IS NOT NULL
    )::INTEGER AS category_coverage,
    COALESCE(cc.cnt, 0) AS total_cards,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.seeding_category IS NULL) AS uncategorized_count,
    COUNT(DISTINCT pp.city) FILTER (WHERE pp.city IS NOT NULL) AS city_count,
    CASE WHEN COALESCE(cc.cnt, 0) > 0
      THEN ROUND(COALESCE(cc.with_images, 0) * 100.0 / cc.cnt)::INTEGER
      ELSE 0
    END AS card_image_pct
  FROM public.place_pool pp
  LEFT JOIN card_counts cc ON cc.c_country = COALESCE(pp.country, 'Unknown')
  GROUP BY COALESCE(pp.country, 'Unknown'), cc.cnt, cc.with_images
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active) DESC;
END;
$$;

-- ── Op 4b: Update admin_country_city_overview to include card_image_pct ──────
-- Must DROP first — same reason as Op 4a.

DROP FUNCTION IF EXISTS public.admin_country_city_overview(TEXT);

CREATE OR REPLACE FUNCTION public.admin_country_city_overview(p_country TEXT)
RETURNS TABLE (
  city_name TEXT,
  total_places BIGINT,
  active_places BIGINT,
  with_photos BIGINT,
  photo_pct INTEGER,
  category_coverage INTEGER,
  total_cards BIGINT,
  avg_rating NUMERIC,
  freshness_pct INTEGER,
  uncategorized_count BIGINT,
  card_image_pct INTEGER
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
  WITH card_counts AS (
    SELECT
      COALESCE(cp.city, 'Unknown City') AS c_city,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE cp.image_url IS NOT NULL) AS with_images
    FROM public.card_pool cp
    WHERE cp.country = p_country AND cp.is_active
    GROUP BY COALESCE(cp.city, 'Unknown City')
  )
  SELECT
    COALESCE(pp.city, 'Unknown City') AS city_name,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE pp.is_active) AS active_places,
    COUNT(*) FILTER (WHERE pp.is_active
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE pp.is_active
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0) * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(DISTINCT pp.seeding_category) FILTER (
      WHERE pp.is_active AND pp.seeding_category IS NOT NULL
    )::INTEGER AS category_coverage,
    COALESCE(cc.cnt, 0) AS total_cards,
    ROUND((AVG(pp.rating) FILTER (WHERE pp.is_active AND pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating,
    CASE WHEN COUNT(*) FILTER (WHERE pp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE pp.is_active
        AND pp.last_detail_refresh > NOW() - INTERVAL '7 days') * 100.0
        / COUNT(*) FILTER (WHERE pp.is_active))::INTEGER
      ELSE 0
    END AS freshness_pct,
    COUNT(*) FILTER (WHERE pp.is_active AND pp.seeding_category IS NULL) AS uncategorized_count,
    CASE WHEN COALESCE(cc.cnt, 0) > 0
      THEN ROUND(COALESCE(cc.with_images, 0) * 100.0 / cc.cnt)::INTEGER
      ELSE 0
    END AS card_image_pct
  FROM public.place_pool pp
  LEFT JOIN card_counts cc ON cc.c_city = COALESCE(pp.city, 'Unknown City')
  WHERE pp.country = p_country
  GROUP BY COALESCE(pp.city, 'Unknown City'), cc.cnt, cc.with_images
  ORDER BY COUNT(*) FILTER (WHERE pp.is_active) DESC;
END;
$$;

-- ── Op 5: Fix dirty city values in card_pool ─────────────────────────────────
-- These are admin grouping values only. The card's `address` field (what users
-- see for navigation) is NOT changed.
--
-- Mappings verified from lat/lng coordinates in the investigation:
--   "4415 Beryl Rd" → Raleigh (Beryl Rd is in Raleigh, NC)
--   "NC 27513" → Cary (zip 27513 = Cary, NC)
--   "102" → unknown context, but coordinates place it in Raleigh area
--   "359 Blackwell St" → Durham (Blackwell St is in Durham, NC)
--   "North Hills" → Raleigh (North Hills is a neighborhood in Raleigh)

UPDATE card_pool SET city = 'Raleigh'
WHERE city = '4415 Beryl Rd' AND is_active = true;

UPDATE card_pool SET city = 'Cary'
WHERE city = 'NC 27513' AND is_active = true;

UPDATE card_pool SET city = 'Raleigh'
WHERE city = '102' AND is_active = true;

UPDATE card_pool SET city = 'Durham'
WHERE city = '359 Blackwell St' AND is_active = true;

UPDATE card_pool SET city = 'Raleigh'
WHERE city = 'North Hills' AND is_active = true;
