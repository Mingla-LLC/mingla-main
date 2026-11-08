\set ON_ERROR_STOP on
-- #4318 follow-up: links_page_cities(), executable PostgreSQL 17 proof.
--
-- LC1 anon gets exactly the cities whose is_live_for_consumers is on, every
--     one of them, and no other (compared with the table itself, so cities a
--     replayed migration seeds are covered too).
-- LC2 the column allow-list is exactly city_id, name, country_code,
--     center_lat, center_lng, place_count.
-- LC3 place_count counts the city's own places under the links_page_places
--     rules (servable, active, OPERATIONAL, thumbs backfilled, a well-formed
--     place-photos object), and agrees with links_page_places itself; a quiet
--     city with no photo places is listed with 0.
-- LC4 flipping a city live puts it on the list; switching it off removes it.
-- LC5 catalog: anon may execute, SECURITY DEFINER, search_path pinned.
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

-- Centres in open ocean, so no other fixture or seeded place is in range.
INSERT INTO public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
  bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status, is_live_for_consumers) VALUES
  ('43181000-0000-4000-c000-000000000001', 'i4318c-live', 'Issue 4318 Liveton', 'Testland', 'tl',
   41.0, -45.0, 40.9, -45.1, 41.1, -44.9, 'launched', true),
  ('43181000-0000-4000-c000-000000000002', 'i4318c-dark', 'Issue 4318 Darkton', 'Testland', 'TL',
   42.0, -45.0, 41.9, -45.1, 42.1, -44.9, 'seeded', false),
  ('43181000-0000-4000-c000-000000000003', 'i4318c-quiet', 'Issue 4318 Quietton', 'Testland', 'TL',
   43.0, -45.0, 42.9, -45.1, 43.1, -44.9, 'launched', true);

-- Liveton: 2 photo places, then one of each thing the rules refuse.
-- Darkton: a photo place (counted only once the city is live).
INSERT INTO public.place_pool (id, google_place_id, name, address, lat, lng, city, city_id, review_count,
  primary_type_display_name, business_status, is_active, is_servable, stored_photo_urls, thumbs_backfilled_at) VALUES
  ('43181000-0000-4000-8000-000000000001', 'i4318c-ok1', 'Issue 4318 Photo Cafe', 'A', 41.01, -45.0, 'Liveton',
   '43181000-0000-4000-c000-000000000001', 10, 'Cafe', 'OPERATIONAL', true, true,
   ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJi4318cok1/0.jpg?v=1'], now()),
  ('43181000-0000-4000-8000-000000000002', 'i4318c-ok2', 'Issue 4318 Photo Park', 'B', 41.02, -45.0, 'Liveton',
   '43181000-0000-4000-c000-000000000001', 20, 'Park', 'OPERATIONAL', true, true,
   ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJi4318cok2/2.webp'], now()),
  ('43181000-0000-4000-8000-000000000003', 'i4318c-unserved', 'Issue 4318 Unserved', 'C', 41.0, -45.0, 'Liveton',
   '43181000-0000-4000-c000-000000000001', 30, 'Cafe', 'OPERATIONAL', true, false,
   ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJi4318cuns/0.jpg'], now()),
  ('43181000-0000-4000-8000-000000000004', 'i4318c-nothumb', 'Issue 4318 No Thumb', 'D', 41.0, -45.0, 'Liveton',
   '43181000-0000-4000-c000-000000000001', 30, 'Cafe', 'OPERATIONAL', true, true,
   ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJi4318cnot/0.jpg'], NULL),
  ('43181000-0000-4000-8000-000000000005', 'i4318c-closed', 'Issue 4318 Closed', 'E', 41.0, -45.0, 'Liveton',
   '43181000-0000-4000-c000-000000000001', 30, 'Cafe', 'CLOSED_PERMANENTLY', true, true,
   ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJi4318ccls/0.jpg'], now()),
  ('43181000-0000-4000-8000-000000000006', 'i4318c-foreign', 'Issue 4318 Foreign Photo', 'F', 41.0, -45.0, 'Liveton',
   '43181000-0000-4000-c000-000000000001', 30, 'Cafe', 'OPERATIONAL', true, true,
   ARRAY['https://lh3.googleusercontent.com/p/abc=s800'], now()),
  ('43181000-0000-4000-8000-000000000007', 'i4318c-failed', 'Issue 4318 Failed Backfill', 'G', 41.0, -45.0, 'Liveton',
   '43181000-0000-4000-c000-000000000001', 30, 'Cafe', 'OPERATIONAL', true, true,
   ARRAY['__backfill_failed__'], now()),
  ('43181000-0000-4000-8000-000000000008', 'i4318c-dark1', 'Issue 4318 Dark Photo', 'H', 42.0, -45.0, 'Darkton',
   '43181000-0000-4000-c000-000000000002', 30, 'Cafe', 'OPERATIONAL', true, true,
   ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJi4318cdark/0.jpg'], now());

SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_rows jsonb;
  v_live uuid[];
  v_listed uuid[];
BEGIN
  SELECT jsonb_agg(to_jsonb(c)) INTO v_rows FROM public.links_page_cities() c;
  SELECT array_agg((elem->>'city_id')::uuid ORDER BY elem->>'city_id') INTO v_listed
  FROM jsonb_array_elements(v_rows) elem;
  RESET ROLE;
  SELECT array_agg(sc.id ORDER BY sc.id::text) INTO v_live FROM public.seeding_cities sc WHERE sc.is_live_for_consumers;
  SET LOCAL ROLE anon;

  -- LC1: exactly the live cities.
  IF v_listed IS DISTINCT FROM v_live THEN
    RAISE EXCEPTION 'LC1: listed % but live %', v_listed, v_live;
  END IF;
  IF NOT ('43181000-0000-4000-c000-000000000001'::uuid = ANY (v_listed))
     OR NOT ('43181000-0000-4000-c000-000000000003'::uuid = ANY (v_listed))
     OR '43181000-0000-4000-c000-000000000002'::uuid = ANY (v_listed) THEN
    RAISE EXCEPTION 'LC1: fixture cities wrong: %', v_listed;
  END IF;

  -- LC2: the column allow-list.
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(v_rows->0) AS key)
     IS DISTINCT FROM ARRAY['center_lat', 'center_lng', 'city_id', 'country_code', 'name', 'place_count'] THEN
    RAISE EXCEPTION 'LC2: column allow-list drifted: %', v_rows->0;
  END IF;

  -- LC3: Liveton counts its 2 photo places; Quietton is listed with 0.
  IF (SELECT elem FROM jsonb_array_elements(v_rows) elem WHERE elem->>'city_id' = '43181000-0000-4000-c000-000000000001')
     IS DISTINCT FROM jsonb_build_object('city_id', '43181000-0000-4000-c000-000000000001', 'name', 'Issue 4318 Liveton',
       'country_code', 'TL', 'center_lat', 41.0, 'center_lng', -45.0, 'place_count', 2) THEN
    RAISE EXCEPTION 'LC3: Liveton row wrong: %', v_rows;
  END IF;
  IF (SELECT (elem->>'place_count')::integer FROM jsonb_array_elements(v_rows) elem
      WHERE elem->>'city_id' = '43181000-0000-4000-c000-000000000003') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'LC3: Quietton must be listed with 0 places: %', v_rows;
  END IF;
  -- The count and the quiet-week reader agree on the same rules.
  IF (SELECT count(*) FROM public.links_page_places(41.0, -45.0, 100, 6)) <> 2 THEN
    RAISE EXCEPTION 'LC3: links_page_places disagrees with place_count';
  END IF;
END
$test$;
RESET ROLE;

-- LC4: flip Darkton live and Liveton off.
UPDATE public.seeding_cities SET is_live_for_consumers = true WHERE id = '43181000-0000-4000-c000-000000000002';
UPDATE public.seeding_cities SET is_live_for_consumers = false WHERE id = '43181000-0000-4000-c000-000000000001';
SET LOCAL ROLE anon;
DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.links_page_cities() c
                 WHERE c.city_id = '43181000-0000-4000-c000-000000000002' AND c.place_count = 1) THEN
    RAISE EXCEPTION 'LC4: a city switched live did not appear with its place';
  END IF;
  IF EXISTS (SELECT 1 FROM public.links_page_cities() c WHERE c.city_id = '43181000-0000-4000-c000-000000000001') THEN
    RAISE EXCEPTION 'LC4: a city switched off is still listed';
  END IF;
END
$test$;
RESET ROLE;

-- LC5: catalog.
DO $test$
DECLARE
  v_proc pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO v_proc FROM pg_proc WHERE oid = 'public.links_page_cities()'::regprocedure;
  IF NOT has_function_privilege('anon', 'public.links_page_cities()', 'EXECUTE') THEN
    RAISE EXCEPTION 'LC5: anon cannot call links_page_cities';
  END IF;
  IF NOT v_proc.prosecdef THEN
    RAISE EXCEPTION 'LC5: links_page_cities must be SECURITY DEFINER';
  END IF;
  IF NOT (v_proc.proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'LC5: search_path is not pinned: %', v_proc.proconfig;
  END IF;
  IF v_proc.provolatile <> 's' THEN
    RAISE EXCEPTION 'LC5: links_page_cities must be STABLE';
  END IF;
END
$test$;

ROLLBACK;
