-- #4318 follow-up — usemingla.com/links lists exactly the cities that are live
-- in the Explorer app.
--
-- public.links_page_cities(): one row per seeding_cities row whose
-- is_live_for_consumers flag is on (the switch Explorer and Admin already use),
-- with its centre and how many photo places it has. The marketing site reads it
-- (cached 5 minutes under the `links` tag) instead of a hand-kept city list, so
-- flipping a city live in Admin puts it on /links and switching it off takes it
-- away, with no code change.
--
-- place_count counts the city's own places (place_pool.city_id) that pass
-- exactly the links_page_places rules: Explorer-servable, active, OPERATIONAL,
-- not deleted or held, thumbs backfilled, a stored place-photos object whose
-- <dir>/<stem>_thumb.jpg sibling is well formed, a point and a name.
--
-- Column allow-list only: id, name, country code, centre, count. No seeding,
-- bbox, coverage, cost or status column leaves the function. Reads no #2489
-- gated function, so it is not a #3081 carrier.
--
-- plpgsql (body not validated at CREATE, so the pre-#1931 replay lane needs no
-- skip entry). Static SQL only (#1860 C7).

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.links_page_cities()
RETURNS TABLE (
  city_id uuid,
  name text,
  country_code text,
  center_lat double precision,
  center_lng double precision,
  place_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_prefix constant text := '/storage/v1/object/public/place-photos/';
BEGIN
  RETURN QUERY
  WITH live AS (
    SELECT sc.id, btrim(sc.name) AS name, upper(btrim(sc.country_code)) AS country_code,
      sc.center_lat, sc.center_lng
    FROM public.seeding_cities sc
    WHERE sc.is_live_for_consumers = true
      AND NULLIF(btrim(sc.name), '') IS NOT NULL
      AND sc.center_lat BETWEEN -90 AND 90
      AND sc.center_lng BETWEEN -180 AND 180
  ), photo_places AS (
    SELECT pp.city_id,
      -- <dir>/<stem>.<ext> -> <dir>/<stem>_thumb.jpg; query and fragment dropped.
      regexp_replace(
        split_part(split_part(split_part(pp.stored_photo_urls[1], v_prefix, 2), '?', 1), '#', 1),
        '\.[^./]*$', ''
      ) || '_thumb.jpg' AS thumb
    FROM public.place_pool pp
    WHERE pp.city_id IN (SELECT live.id FROM live)
      AND pp.is_servable = true
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
      AND NULLIF(btrim(pp.name), '') IS NOT NULL
  ), counts AS (
    SELECT p.city_id, count(*)::integer AS n
    FROM photo_places p
    WHERE p.thumb ~ '^[^/]+/.*[^/]_thumb\.jpg$'
      AND p.thumb !~ '_thumb_thumb\.jpg$'
    GROUP BY p.city_id
  )
  SELECT live.id, live.name, live.country_code, live.center_lat, live.center_lng,
    COALESCE(counts.n, 0)
  FROM live
  LEFT JOIN counts ON counts.city_id = live.id
  ORDER BY live.name, live.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.links_page_cities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_page_cities() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_page_cities() IS
  '#4318: the cities live for consumers in Explorer (seeding_cities.is_live_for_consumers), for the usemingla.com/links city list: id, name, country code, centre and the count of the city''s photo places under the links_page_places rules. No other column.';

NOTIFY pgrst, 'reload schema';

COMMIT;
