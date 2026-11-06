\set ON_ERROR_STOP on

-- Issue #4275 Part C — the batched ranked lookup and the hydrate RPC.
--
--   T-C11  the batch returns exactly what direct calls to the single-lookup
--          function return, by input index and in the same order, including the
--          required-types and flowers primary-type gates.
--   T-C9   more than 12 requests or more than 1000 ids raise.
--   T-C10  anon and authenticated cannot run either function; service_role can.
--   T-C6   the hydrate returns every curated column and no photos column.
--
-- FAILS-ON-REVERT: replay the chain without 20280406004275 and the first call
-- fails (function does not exist). Grant the batch to authenticated and T-C10
-- fails. Raise the 12 cap and T-C9 fails.
--
-- Everything rolls back.

BEGIN;

CREATE TEMP TABLE t4275b_ids (tag text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_row record;
  v_id uuid;
BEGIN
  FOR v_row IN
    SELECT * FROM (VALUES
      ('a',  10::numeric, 90::numeric, ARRAY['park'],             'park',        true),
      ('b', 130::numeric, 80::numeric, ARRAY['museum'],           'museum',      true),
      ('c', 140::numeric, 70::numeric, ARRAY['museum','park'],    'park',        true),
      ('d', 150::numeric, 60::numeric, ARRAY['cafe'],             'cafe',        true),
      ('e',   5::numeric, 50::numeric, ARRAY['florist'],          'florist',     true),
      ('f',   5::numeric, 40::numeric, ARRAY['florist','store'],  'supermarket', true),
      ('g',   5::numeric, 30::numeric, ARRAY['florist'],          'event_venue', true)
    ) AS t(tag, filter_score, rank_score, place_types, place_primary, active)
  LOOP
    INSERT INTO public.place_pool (google_place_id, name, lat, lng, types, primary_type, stored_photo_urls, photos,
                                   is_active, is_servable, city, country, ai_signal_scores)
    VALUES ('t4275b-' || v_row.tag, 'T4275 ' || v_row.tag, 71.5, -150.5, v_row.place_types, v_row.place_primary,
            ARRAY['https://example.test/' || v_row.tag || '.jpg'], '[{"big":"payload"}]'::jsonb,
            true, true, 'T4275 City', 'T4275 Country', '{"t4275_rank":{"reasoning":"why"}}'::jsonb)
    RETURNING id INTO v_id;
    INSERT INTO t4275b_ids VALUES (v_row.tag, v_id);
    INSERT INTO public.place_scores (place_id, signal_id, score) VALUES
      (v_id, 't4275_filter', v_row.filter_score),
      (v_id, 't4275_rank', v_row.rank_score);
  END LOOP;
END;
$fixture$;

-- T-C11: three requests with different gates, against direct calls.
DO $t_c11$
DECLARE
  v_box jsonb := jsonb_build_object('p_lat_min', 71, 'p_lat_max', 72, 'p_lng_min', -151, 'p_lng_max', -150);
  v_batch text;
  v_direct text;
BEGIN
  SELECT string_agg(request_index || ':' || place_id || ':' || rank_score, ',' ORDER BY ordinality)
    INTO v_batch
    FROM public.fetch_local_signal_ranked_batch(jsonb_build_array(
      v_box || jsonb_build_object('p_filter_signal','t4275_filter','p_filter_min',120,'p_rank_signal','t4275_rank','p_limit',2),
      v_box || jsonb_build_object('p_filter_signal','t4275_filter','p_filter_min',0,'p_rank_signal','t4275_rank','p_limit',100,
                                  'p_required_types', jsonb_build_array('museum'),
                                  'p_primary_type_required', null, 'p_grocery_floral_tag', false),
      v_box || jsonb_build_object('p_filter_signal','t4275_filter','p_filter_min',0,'p_rank_signal','t4275_rank','p_limit',100,
                                  'p_required_types', null,
                                  'p_primary_type_required', jsonb_build_array('florist'), 'p_grocery_floral_tag', true)
    )) WITH ORDINALITY;

  SELECT string_agg(i || ':' || place_id || ':' || rank_score, ',' ORDER BY i, n) INTO v_direct FROM (
    SELECT 0 AS i, n, place_id, rank_score FROM public.fetch_local_signal_ranked(
      't4275_filter', 120, 't4275_rank', 71, 72, -151, -150, NULL, 2, NULL, false) WITH ORDINALITY AS r(place_id, rank_score, n)
    UNION ALL
    SELECT 1, n, place_id, rank_score FROM public.fetch_local_signal_ranked(
      't4275_filter', 0, 't4275_rank', 71, 72, -151, -150, ARRAY['museum'], 100, NULL, false) WITH ORDINALITY AS r(place_id, rank_score, n)
    UNION ALL
    SELECT 2, n, place_id, rank_score FROM public.fetch_local_signal_ranked(
      't4275_filter', 0, 't4275_rank', 71, 72, -151, -150, NULL, 100, ARRAY['florist'], true) WITH ORDINALITY AS r(place_id, rank_score, n)
  ) direct;

  IF v_batch IS NULL OR v_batch IS DISTINCT FROM v_direct THEN
    RAISE EXCEPTION 'T-C11 FAIL: batch % differs from direct %', v_batch, v_direct;
  END IF;
  -- Request 0 is 2 rows, request 1 is b and c (museum), request 2 is e and f, never g.
  IF (SELECT count(*) FROM regexp_split_to_table(v_batch, ',')) <> 6 THEN
    RAISE EXCEPTION 'T-C11 FAIL: expected 6 rows, got %', v_batch;
  END IF;
  IF position((SELECT id::text FROM t4275b_ids WHERE tag = 'g') IN v_batch) > 0 THEN
    RAISE EXCEPTION 'T-C11 FAIL: the flowers gate let an event venue through';
  END IF;
  RAISE NOTICE 'T-C11 PASS';
END;
$t_c11$;

-- T-C9: the caps raise.
DO $t_c9$
DECLARE
  v_raised boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.fetch_local_signal_ranked_batch('[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'T-C9 FAIL: an empty batch returns rows';
  END IF;
  BEGIN
    PERFORM * FROM public.fetch_local_signal_ranked_batch(
      (SELECT jsonb_agg(jsonb_build_object('p_filter_signal','x','p_filter_min',0,'p_rank_signal','x',
         'p_lat_min',0,'p_lat_max',0,'p_lng_min',0,'p_lng_max',0,'p_limit',1)) FROM generate_series(1, 13)));
  EXCEPTION WHEN raise_exception THEN
    v_raised := SQLERRM LIKE '%cap of 12%';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'T-C9 FAIL: 13 requests did not raise'; END IF;

  -- Twelve is allowed.
  PERFORM * FROM public.fetch_local_signal_ranked_batch(
    (SELECT jsonb_agg(jsonb_build_object('p_filter_signal','x','p_filter_min',0,'p_rank_signal','x',
       'p_lat_min',0,'p_lat_max',0,'p_lng_min',0,'p_lng_max',0,'p_limit',1)) FROM generate_series(1, 12)));

  v_raised := false;
  BEGIN
    PERFORM * FROM public.fetch_feed_places_by_ids(
      (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 1001)));
  EXCEPTION WHEN raise_exception THEN
    v_raised := SQLERRM LIKE '%cap of 1000%';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'T-C9 FAIL: 1001 ids did not raise'; END IF;

  PERFORM * FROM public.fetch_feed_places_by_ids((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 1000)));
  RAISE NOTICE 'T-C9 PASS';
END;
$t_c9$;

-- T-C10: service role only.
DO $t_c10$
DECLARE
  v_role text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.fetch_local_signal_ranked_batch(jsonb)', 'public.fetch_feed_places_by_ids(uuid[])'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'T-C10 FAIL: % can run %', v_role, v_fn;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'T-C10 FAIL: service_role cannot run %', v_fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'T-C10 PASS';
END;
$t_c10$;

SET LOCAL ROLE authenticated;
DO $t_c10_live$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM public.fetch_local_signal_ranked_batch('[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'T-C10 FAIL: authenticated ran the batch'; END IF;
END;
$t_c10_live$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $t_c10_service$
BEGIN
  PERFORM * FROM public.fetch_local_signal_ranked_batch('[]'::jsonb);
  PERFORM * FROM public.fetch_feed_places_by_ids(ARRAY[]::uuid[]);
END;
$t_c10_service$;
RESET ROLE;

-- T-C6: every curated column present, photos absent.
DO $t_c6$
DECLARE
  v_row jsonb;
  v_col text;
BEGIN
  SELECT to_jsonb(p) INTO v_row
    FROM public.fetch_feed_places_by_ids(ARRAY[(SELECT id FROM t4275b_ids WHERE tag = 'a')]) p;
  IF v_row IS NULL THEN RAISE EXCEPTION 'T-C6 FAIL: no row hydrated'; END IF;
  IF v_row ? 'photos' THEN RAISE EXCEPTION 'T-C6 FAIL: photos is back in the hydrate'; END IF;
  FOREACH v_col IN ARRAY ARRAY['id','google_place_id','name','address','lat','lng','rating','review_count','price_level',
    'price_range_start_cents','price_range_end_cents','opening_hours','website','stored_photo_urls','types','primary_type',
    'utc_offset_minutes','city_id','city','country','ai_signal_scores'] LOOP
    IF NOT v_row ? v_col THEN RAISE EXCEPTION 'T-C6 FAIL: % missing', v_col; END IF;
  END LOOP;
  IF v_row->>'google_place_id' <> 't4275b-a' OR v_row->'ai_signal_scores'->'t4275_rank'->>'reasoning' <> 'why' THEN
    RAISE EXCEPTION 'T-C6 FAIL: wrong values %', v_row;
  END IF;
  RAISE NOTICE 'T-C6 PASS';
END;
$t_c6$;

ROLLBACK;
