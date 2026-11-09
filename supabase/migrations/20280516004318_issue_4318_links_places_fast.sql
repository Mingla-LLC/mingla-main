-- #4318 follow-up — /links places reads stop timing out in big cities.
--
-- Production measured 2026-11-08 (read-only EXPLAIN): links_page_places for
-- London bitmap-scanned the 60 km box and fetched 10 678 wide place_pool rows
-- (8 580 buffers) to keep the top 3; links_page_cities counted every photo
-- place of every live city (33 927 rows, 29 439 buffers) every 5 minutes.
-- Under load both reached the 57014 statement timeout.
--
-- 1. place_pool_links_city_top_idx: (city_id, review_count DESC NULLS LAST, id)
--    over exactly the servable rows the readers keep. Both readers walk it in
--    order in LIMIT 50 pages and stop early (the photo-path rules defeat the
--    planner's row estimate, so a single unlimited query scans and sorts).
-- 2. links_page_places gains p_city_id uuid DEFAULT NULL. With it, the city's
--    top places under the same rules, by review_count then id (index order).
--    Without it, the lat/lng path is unchanged and 4-argument calls still work.
-- 3. links_page_cities returns has_places boolean instead of place_count: the
--    page only ever asked "any?", answered at the first passing row.
--
-- Both functions are re-emitted from their CURRENT definitions
-- (20280508004318, 20280514004318) with only these changes. Neither reads the
-- #2489 address gate. The index follows this repository's convention for
-- place_pool indexes (a plain CREATE INDEX inside the migration, as #4276 did):
-- a short SHARE lock on place_pool while the partial index builds.
-- Static SQL only (#1860 C7). No 40001 (#4134).

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE INDEX IF NOT EXISTS place_pool_links_city_top_idx
  ON public.place_pool (city_id, review_count DESC NULLS LAST, id)
  WHERE is_servable AND is_active AND business_status = 'OPERATIONAL'
    AND deleted_at IS NULL AND thumbs_backfilled_at IS NOT NULL;
COMMENT ON INDEX public.place_pool_links_city_top_idx IS
  '#4318: per-city top places for links_page_places(p_city_id) and links_page_cities.has_places; predicate = their first five rules.';

DROP FUNCTION IF EXISTS public.links_page_places(double precision, double precision, integer, integer);
CREATE OR REPLACE FUNCTION public.links_page_places(
  p_lat double precision,
  p_lng double precision,
  p_radius_km integer DEFAULT 60,
  p_limit integer DEFAULT 3,
  p_city_id uuid DEFAULT NULL
)
RETURNS TABLE (
  place_id text, name text, category text, area_label text,
  lat double precision, lng double precision, photo_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_radius constant double precision := LEAST(GREATEST(COALESCE(p_radius_km, 60), 1), 100);
  v_limit constant integer := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 6);
  v_prefix constant text := '/storage/v1/object/public/place-photos/';
  v_lat_span double precision;
  v_lng_span double precision;
  v_place record;
  v_thumb text;
  v_found integer := 0;
  v_page integer;
  v_offset integer := 0;
BEGIN
  -- #4318 follow-up: one live city by id. Pages of 50 walk
  -- place_pool_links_city_top_idx (city_id, review_count DESC NULLS LAST, id),
  -- whose predicate is exactly the five rules in this WHERE, in index order,
  -- and stop once v_limit rows pass the remaining rules. Small LIMIT pages,
  -- not one query: the planner cannot estimate the photo-path rules, and
  -- without a small LIMIT it scans the whole table and sorts.
  IF p_city_id IS NOT NULL THEN
    LOOP
    v_page := 0;
    FOR v_place IN
      SELECT pp.id, pp.name, pp.primary_type_display_name, pp.city, pp.lat, pp.lng,
        pp.serving_hold, pp.stored_photo_urls
      FROM public.place_pool pp
      WHERE pp.city_id = p_city_id
        AND pp.is_servable
        AND pp.is_active
        AND pp.business_status = 'OPERATIONAL'
        AND pp.deleted_at IS NULL
        AND pp.thumbs_backfilled_at IS NOT NULL
      ORDER BY pp.review_count DESC NULLS LAST, pp.id
      LIMIT 50 OFFSET v_offset
    LOOP
      v_page := v_page + 1;
      CONTINUE WHEN v_place.serving_hold IS TRUE
        OR v_place.stored_photo_urls IS NULL
        OR COALESCE(array_length(v_place.stored_photo_urls, 1), 0) = 0
        OR (array_length(v_place.stored_photo_urls, 1) = 1 AND v_place.stored_photo_urls[1] = '__backfill_failed__')
        OR position(v_prefix IN v_place.stored_photo_urls[1]) = 0
        OR v_place.lat IS NULL OR v_place.lng IS NULL
        OR NULLIF(btrim(v_place.name), '') IS NULL;
      -- <dir>/<stem>.<ext> -> <dir>/<stem>_thumb.jpg; query and fragment dropped.
      v_thumb := regexp_replace(split_part(split_part(split_part(v_place.stored_photo_urls[1], v_prefix, 2), '?', 1), '#', 1),
        '\.[^./]*$', '') || '_thumb.jpg';
      CONTINUE WHEN v_thumb !~ '^[^/]+/.*[^/]_thumb\.jpg$' OR v_thumb ~ '_thumb_thumb\.jpg$';
      place_id := v_place.id::text;
      name := v_place.name;
      category := v_place.primary_type_display_name;
      area_label := v_place.city;
      lat := v_place.lat;
      lng := v_place.lng;
      photo_path := v_thumb;
      RETURN NEXT;
      v_found := v_found + 1;
      EXIT WHEN v_found >= v_limit;
    END LOOP;
    EXIT WHEN v_found >= v_limit OR v_page < 50;
    v_offset := v_offset + 50;
    END LOOP;
    RETURN;
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision THEN
    RETURN;
  END IF;
  -- A cheap box around the circle first; the exact distance decides.
  v_lat_span := v_radius / 111.0;
  v_lng_span := v_radius / GREATEST(111.0 * cos(radians(p_lat)), 1.0);

  RETURN QUERY
  WITH candidates AS (
    SELECT pp.id, pp.name, pp.primary_type_display_name, pp.city, pp.lat, pp.lng, pp.review_count,
      split_part(pp.stored_photo_urls[1], v_prefix, 2) AS object_path,
      6371.0 * 2.0 * asin(sqrt(
        power(sin(radians(pp.lat - p_lat) / 2.0), 2)
        + cos(radians(p_lat)) * cos(radians(pp.lat)) * power(sin(radians(pp.lng - p_lng) / 2.0), 2)
      )) AS distance_km
    FROM public.place_pool pp
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.business_status = 'OPERATIONAL'
      AND pp.deleted_at IS NULL
      AND pp.serving_hold IS NOT TRUE
      AND pp.thumbs_backfilled_at IS NOT NULL
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0
      AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
      AND position(v_prefix IN pp.stored_photo_urls[1]) > 0
      AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL
      AND pp.lat BETWEEN p_lat - v_lat_span AND p_lat + v_lat_span
      AND pp.lng BETWEEN p_lng - v_lng_span AND p_lng + v_lng_span
      AND NULLIF(btrim(pp.name), '') IS NOT NULL
  ), thumbs AS (
    SELECT c.*,
      -- <dir>/<stem>.<ext> -> <dir>/<stem>_thumb.jpg; query and fragment dropped.
      regexp_replace(split_part(split_part(c.object_path, '?', 1), '#', 1), '\.[^./]*$', '') || '_thumb.jpg' AS thumb
    FROM candidates c
    WHERE c.distance_km <= v_radius
  )
  SELECT t.id::text, t.name, t.primary_type_display_name, t.city, t.lat, t.lng, t.thumb
  FROM thumbs t
  WHERE t.thumb ~ '^[^/]+/.*[^/]_thumb\.jpg$'
    AND t.thumb !~ '_thumb_thumb\.jpg$'
  ORDER BY t.review_count DESC NULLS LAST, t.distance_km, t.id
  LIMIT v_limit;
END;
$function$;
REVOKE ALL ON FUNCTION public.links_page_places(double precision, double precision, integer, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_page_places(double precision, double precision, integer, integer, uuid)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_page_places(double precision, double precision, integer, integer, uuid) IS
  '#4318: up to 6 real, servable, operational places with a stored thumb, either in one live city (p_city_id, by review count) or within 100 km of a point (by review count, then distance), for a /links quiet week. Explorer''s serving gate; no address (area label = city), no private columns; photo_path is the place-photos <dir>/<stem>_thumb.jpg object, never a /render/image URL.';

DROP FUNCTION IF EXISTS public.links_page_cities();
CREATE OR REPLACE FUNCTION public.links_page_cities()
RETURNS TABLE (
  city_id uuid,
  name text,
  country_code text,
  center_lat double precision,
  center_lng double precision,
  has_places boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_prefix constant text := '/storage/v1/object/public/place-photos/';
  v_city record;
  v_place record;
  v_thumb text;
  v_page integer;
  v_offset integer;
BEGIN
  FOR v_city IN
    SELECT sc.id, btrim(sc.name) AS name, upper(btrim(sc.country_code)) AS country_code,
      sc.center_lat, sc.center_lng
    FROM public.seeding_cities sc
    WHERE sc.is_live_for_consumers = true
      AND NULLIF(btrim(sc.name), '') IS NOT NULL
      AND sc.center_lat BETWEEN -90 AND 90
      AND sc.center_lng BETWEEN -180 AND 180
    ORDER BY btrim(sc.name), sc.id
  LOOP
    city_id := v_city.id;
    name := v_city.name;
    country_code := v_city.country_code;
    center_lat := v_city.center_lat;
    center_lng := v_city.center_lng;
    -- has_places: does links_page_places(..., p_city_id) have anything to
    -- show? The same index walk and rules as its city path, stopping at the
    -- first place that passes instead of counting the whole city.
    has_places := false;
    v_offset := 0;
    LOOP
    v_page := 0;
    FOR v_place IN
      SELECT pp.name, pp.lat, pp.lng, pp.serving_hold, pp.stored_photo_urls
      FROM public.place_pool pp
      WHERE pp.city_id = v_city.id
        AND pp.is_servable
        AND pp.is_active
        AND pp.business_status = 'OPERATIONAL'
        AND pp.deleted_at IS NULL
        AND pp.thumbs_backfilled_at IS NOT NULL
      ORDER BY pp.review_count DESC NULLS LAST, pp.id
      LIMIT 50 OFFSET v_offset
    LOOP
      v_page := v_page + 1;
      CONTINUE WHEN v_place.serving_hold IS TRUE
        OR v_place.stored_photo_urls IS NULL
        OR COALESCE(array_length(v_place.stored_photo_urls, 1), 0) = 0
        OR (array_length(v_place.stored_photo_urls, 1) = 1 AND v_place.stored_photo_urls[1] = '__backfill_failed__')
        OR position(v_prefix IN v_place.stored_photo_urls[1]) = 0
        OR v_place.lat IS NULL OR v_place.lng IS NULL
        OR NULLIF(btrim(v_place.name), '') IS NULL;
      v_thumb := regexp_replace(split_part(split_part(split_part(v_place.stored_photo_urls[1], v_prefix, 2), '?', 1), '#', 1),
        '\.[^./]*$', '') || '_thumb.jpg';
      CONTINUE WHEN v_thumb !~ '^[^/]+/.*[^/]_thumb\.jpg$' OR v_thumb ~ '_thumb_thumb\.jpg$';
      has_places := true;
      EXIT;
    END LOOP;
    EXIT WHEN has_places OR v_page < 50;
    v_offset := v_offset + 50;
    END LOOP;
    RETURN NEXT;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.links_page_cities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_page_cities() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_page_cities() IS
  '#4318: the cities live for consumers in Explorer (seeding_cities.is_live_for_consumers), for the usemingla.com/links city list: id, name, country code, centre and whether links_page_places has places for it. No other column.';

NOTIFY pgrst, 'reload schema';

COMMIT;
