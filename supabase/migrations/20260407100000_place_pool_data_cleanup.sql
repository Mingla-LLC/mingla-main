-- ═══════════════════════════════════════════════════════════════════════════════
-- Phase 1: Place Pool Data Cleanup
-- Normalizes country data, cleans city names, assigns orphaned places.
-- No RPC changes, no UI changes — data cleanup only.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Step 1: Normalize country data on seeding_cities ────────────────────────

-- Standardize all US cities to "United States" + "US"
UPDATE public.seeding_cities SET country = 'United States', country_code = 'US'
WHERE country IN ('USA', 'United States', 'US');

-- Fill in missing country_codes for non-US cities
UPDATE public.seeding_cities SET country_code = 'FR' WHERE country = 'France' AND (country_code IS NULL OR country_code = '');
UPDATE public.seeding_cities SET country_code = 'GB' WHERE country = 'UK' AND (country_code IS NULL OR country_code = '');
UPDATE public.seeding_cities SET country_code = 'DE' WHERE country = 'Germany' AND (country_code IS NULL OR country_code = '');
UPDATE public.seeding_cities SET country_code = 'ES' WHERE country = 'Spain' AND (country_code IS NULL OR country_code = '');
UPDATE public.seeding_cities SET country_code = 'CA' WHERE country = 'Canada' AND (country_code IS NULL OR country_code = '');
UPDATE public.seeding_cities SET country_code = 'BE' WHERE country = 'Belgium' AND (country_code IS NULL OR country_code = '');
UPDATE public.seeding_cities SET country_code = 'NG' WHERE country = 'Nigeria' AND (country_code IS NULL OR country_code = '');

-- ── Step 2: Clean dirty city names ──────────────────────────────────────────

UPDATE public.seeding_cities SET name = 'London' WHERE name = 'London E15 2RU';

-- ── Step 3: Cary and Durham preserved — no changes needed ───────────────────
-- They are distinct cities. Their approximate bboxes from the center+radius
-- backfill are sufficient until the admin re-geocodes them manually.

-- ── Step 4: Assign orphaned places via bbox lookup ──────────────────────────

-- 603 places have no city_id. For each one, check if its coordinates
-- fall inside any city's bounding box. If multiple match, pick nearest center.
UPDATE public.place_pool pp
SET city_id = matched.city_id
FROM (
  SELECT DISTINCT ON (pp2.id)
    pp2.id AS place_id,
    sc.id AS city_id
  FROM public.place_pool pp2
  JOIN public.seeding_cities sc ON
    pp2.lat BETWEEN sc.bbox_sw_lat AND sc.bbox_ne_lat
    AND pp2.lng BETWEEN sc.bbox_sw_lng AND sc.bbox_ne_lng
  WHERE pp2.city_id IS NULL
    AND pp2.is_active
    AND pp2.lat IS NOT NULL
    AND pp2.lng IS NOT NULL
  ORDER BY pp2.id,
    (pp2.lat - sc.center_lat) * (pp2.lat - sc.center_lat) +
    (pp2.lng - sc.center_lng) * (pp2.lng - sc.center_lng)
) matched
WHERE pp.id = matched.place_id;
