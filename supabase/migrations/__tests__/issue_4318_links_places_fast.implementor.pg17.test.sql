\set ON_ERROR_STOP on
-- #4318 follow-up: /links places without the big-city timeout. PostgreSQL 17 proof.
--
-- F1 links_page_places(..., p_city_id) returns the same top 3 as the point
--    path for a seeded city, never another city's place, never a hidden one.
-- F2 the 4-argument call still works and p_city_id needs no coordinates.
-- F3 links_page_cities.has_places matches whether the city path returns rows.
-- F4 the per-city query is served by place_pool_links_city_top_idx in index
--    order with no Sort (the early stop), and the function runs that query.
-- F5 catalog: the old 4-argument signature is gone, grants and modes hold.
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

-- Centres in open ocean, so nothing else is in range.
INSERT INTO public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
  bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status, is_live_for_consumers) VALUES
  ('4318f000-0000-4000-c000-000000000001', 'issue4318-fast-big', 'Issue 4318 Bigton', 'Testland', 'TB',
   -30.0, -20.0, -30.5, -20.5, -29.5, -19.5, 'launched', true),
  ('4318f000-0000-4000-c000-000000000002', 'issue4318-fast-empty', 'Issue 4318 Emptyton', 'Testland', 'TE',
   -31.0, -21.0, -31.5, -21.5, -30.5, -20.5, 'launched', true);

-- 200 good Bigton places with distinct review counts within ~5 km.
INSERT INTO public.place_pool (id, google_place_id, name, address, lat, lng, city, city_id, review_count,
  primary_type_display_name, business_status, is_active, is_servable, stored_photo_urls, thumbs_backfilled_at)
SELECT ('4318f000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'i4318-fast-' || g, 'Bigton place ' || g,
  'SECRET ' || g, -30.0 + (g % 10) * 0.004, -20.0 + (g / 10) * 0.002, 'Bigton',
  '4318f000-0000-4000-c000-000000000001', g * 10, 'Cafe', 'OPERATIONAL', true, true,
  ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJfast' || g || '/0.jpg'], now()
FROM generate_series(1, 200) g;
-- Hidden Bigton places with huge review counts: a leak would top the list.
INSERT INTO public.place_pool (id, google_place_id, name, address, lat, lng, city, city_id, review_count,
  primary_type_display_name, business_status, is_active, is_servable, stored_photo_urls, thumbs_backfilled_at) VALUES
  ('4318f000-0000-4000-8100-000000000001', 'i4318-fast-closed', 'LEAK closed', 'X', -30.0, -20.0, 'Bigton', '4318f000-0000-4000-c000-000000000001', 9000001, 'Cafe', 'CLOSED_PERMANENTLY', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJleak1/0.jpg'], now()),
  ('4318f000-0000-4000-8100-000000000002', 'i4318-fast-unserved', 'LEAK unservable', 'X', -30.0, -20.0, 'Bigton', '4318f000-0000-4000-c000-000000000001', 9000002, 'Cafe', 'OPERATIONAL', true, false, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJleak2/0.jpg'], now()),
  ('4318f000-0000-4000-8100-000000000003', 'i4318-fast-nothumb', 'LEAK no thumb', 'X', -30.0, -20.0, 'Bigton', '4318f000-0000-4000-c000-000000000001', 9000003, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJleak3/0.jpg'], NULL),
  ('4318f000-0000-4000-8100-000000000004', 'i4318-fast-google', 'LEAK google photo', 'X', -30.0, -20.0, 'Bigton', '4318f000-0000-4000-c000-000000000001', 9000004, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://lh3.googleusercontent.com/p/abc'], now()),
  ('4318f000-0000-4000-8100-000000000005', 'i4318-fast-inactive', 'LEAK inactive', 'X', -30.0, -20.0, 'Bigton', '4318f000-0000-4000-c000-000000000001', 9000005, 'Cafe', 'OPERATIONAL', false, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJleak5/0.jpg'], now()),
  ('4318f000-0000-4000-8100-000000000007', 'i4318-fast-root', 'LEAK bucket-root photo', 'X', -30.0, -20.0, 'Bigton', '4318f000-0000-4000-c000-000000000001', 9000007, 'Cafe', 'OPERATIONAL', true, true, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/0.jpg'], now()),
  -- Another city's star, far away: never in Bigton's list.
  ('4318f000-0000-4000-8100-000000000006', 'i4318-fast-other', 'Other city star', 'X', -31.0, -21.0, 'Emptyton', '4318f000-0000-4000-c000-000000000002', 9000006, 'Cafe', 'OPERATIONAL', true, false, ARRAY['https://x.supabase.co/storage/v1/object/public/place-photos/ChIJother/0.jpg'], now());
ANALYZE public.place_pool;

SET LOCAL ROLE anon;
DO $test$
DECLARE
  v_by_city text[];
  v_by_point text[];
  v_rows jsonb;
BEGIN
  -- F1: the same top 3 by both paths.
  SELECT array_agg(p.name ORDER BY o) INTO v_by_city
  FROM public.links_page_places(NULL, NULL, 60, 3, '4318f000-0000-4000-c000-000000000001') WITH ORDINALITY AS p(place_id, name, category, area_label, lat, lng, photo_path, o);
  SELECT array_agg(p.name ORDER BY o) INTO v_by_point
  FROM public.links_page_places(-30.0, -20.0, 60, 3) WITH ORDINALITY AS p(place_id, name, category, area_label, lat, lng, photo_path, o);
  IF v_by_city IS DISTINCT FROM ARRAY['Bigton place 200', 'Bigton place 199', 'Bigton place 198'] THEN
    RAISE EXCEPTION 'F1: city path top 3 wrong: %', v_by_city;
  END IF;
  IF v_by_city IS DISTINCT FROM v_by_point THEN
    RAISE EXCEPTION 'F1: city path % differs from point path %', v_by_city, v_by_point;
  END IF;
  -- Limit cap and the thumb path hold on the city path too.
  SELECT jsonb_agg(to_jsonb(p)) INTO v_rows FROM public.links_page_places(NULL, NULL, 60, 50, '4318f000-0000-4000-c000-000000000001') p;
  IF jsonb_array_length(v_rows) <> 6 OR v_rows->0->>'photo_path' <> 'ChIJfast200/0_thumb.jpg'
     OR v_rows->0->>'area_label' <> 'Bigton' OR v_rows::text LIKE '%SECRET%' OR v_rows::text LIKE '%LEAK%' THEN
    RAISE EXCEPTION 'F1: city path rows wrong: %', v_rows;
  END IF;

  -- F2: the empty city returns nothing (its only place is unservable); the
  -- 4-argument call is unchanged.
  IF EXISTS (SELECT 1 FROM public.links_page_places(NULL, NULL, 60, 3, '4318f000-0000-4000-c000-000000000002')) THEN
    RAISE EXCEPTION 'F2: an unservable place showed for Emptyton';
  END IF;
  IF (SELECT count(*) FROM public.links_page_places(-30.0, -20.0)) <> 3 THEN
    RAISE EXCEPTION 'F2: the 2-argument point call broke';
  END IF;

  -- F3: has_places agrees with the city path.
  IF NOT (SELECT c.has_places FROM public.links_page_cities() c WHERE c.city_id = '4318f000-0000-4000-c000-000000000001')
     OR (SELECT c.has_places FROM public.links_page_cities() c WHERE c.city_id = '4318f000-0000-4000-c000-000000000002') THEN
    RAISE EXCEPTION 'F3: has_places disagrees with links_page_places';
  END IF;
END
$test$;
RESET ROLE;

-- F4: the per-city query is an index-ordered early stop.
DO $test$
DECLARE
  v_plan text;
  v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE oid = 'public.links_page_places(double precision,double precision,integer,integer,uuid)'::regprocedure;
  IF position('WHERE pp.city_id = p_city_id' IN v_src) = 0
     OR position('ORDER BY pp.review_count DESC NULLS LAST, pp.id' IN v_src) = 0 THEN
    RAISE EXCEPTION 'F4: links_page_places no longer runs the index-ordered city query';
  END IF;

  SET LOCAL enable_seqscan = off;
  SET LOCAL enable_bitmapscan = off;
  EXECUTE $q$EXPLAIN (FORMAT JSON)
    SELECT pp.id FROM public.place_pool pp
    WHERE pp.city_id = '4318f000-0000-4000-c000-000000000001'
      AND pp.is_servable AND pp.is_active AND pp.business_status = 'OPERATIONAL'
      AND pp.deleted_at IS NULL AND pp.thumbs_backfilled_at IS NOT NULL
      AND pp.serving_hold IS NOT TRUE
    ORDER BY pp.review_count DESC NULLS LAST, pp.id
    LIMIT 3$q$ INTO v_plan;
  IF position('place_pool_links_city_top_idx' IN v_plan) = 0 OR position('"Sort"' IN v_plan) > 0 THEN
    RAISE EXCEPTION 'F4: the city top-N is not an index-ordered scan of place_pool_links_city_top_idx: %', v_plan;
  END IF;
  RESET enable_seqscan;
  RESET enable_bitmapscan;

  IF (SELECT pg_get_expr(i.indpred, i.indrelid) FROM pg_index i WHERE i.indexrelid = 'public.place_pool_links_city_top_idx'::regclass)
     IS DISTINCT FROM '(is_servable AND is_active AND (business_status = ''OPERATIONAL''::text) AND (deleted_at IS NULL) AND (thumbs_backfilled_at IS NOT NULL))' THEN
    RAISE EXCEPTION 'F4: index predicate drifted: %',
      (SELECT pg_get_expr(i.indpred, i.indrelid) FROM pg_index i WHERE i.indexrelid = 'public.place_pool_links_city_top_idx'::regclass);
  END IF;
END
$test$;

-- F5: catalog.
DO $test$
BEGIN
  IF to_regprocedure('public.links_page_places(double precision,double precision,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'F5: the old 4-argument signature still exists';
  END IF;
  IF NOT has_function_privilege('anon', 'public.links_page_places(double precision,double precision,integer,integer,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.links_page_cities()', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.links_page_places(double precision,double precision,integer,integer,uuid)'::regprocedure)
     OR pg_get_function_result('public.links_page_cities()'::regprocedure) <>
        'TABLE(city_id uuid, name text, country_code text, center_lat double precision, center_lng double precision, has_places boolean)' THEN
    RAISE EXCEPTION 'F5: grants, mode or result shape drifted';
  END IF;
END
$test$;

ROLLBACK;
