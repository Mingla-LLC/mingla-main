\set ON_ERROR_STOP on

-- Issue #4275 tester adversarial — the batched lookup and hydrate as facts in the
-- catalog and under hostile input. The implementor's suite tests behaviour on clean
-- data with SET ROLE. This one reads the effective privileges, checks the declared
-- columns against the live table (plpgsql RETURN QUERY only fails at call time, so a
-- type mismatch would otherwise reach the first Home open), and feeds malformed input.
--
-- FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
--   - drop the REVOKE ... FROM PUBLIC: T1 fails (EXECUTE through PUBLIC).
--   - grant either function to anon or authenticated: T1 fails.
--   - remove SECURITY DEFINER's search_path: T2 fails.
--   - change a declared hydrate column's type: T3 fails.
--   - add `photos` to the hydrate: T3 fails.
--   - remove the array check: T4 fails on the scalar inputs.
--   - raise either cap: T5 fails.
--
-- Everything rolls back.

BEGIN;

DO $t1$
DECLARE
  v_fn regprocedure;
  v_role text;
  v_acl text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.fetch_local_signal_ranked_batch(jsonb)'::regprocedure,
    'public.fetch_feed_places_by_ids(uuid[])'::regprocedure
  ] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'T1: % can execute %', v_role, v_fn;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'T1: service_role cannot execute %', v_fn;
    END IF;
    SELECT proacl::text INTO v_acl FROM pg_proc WHERE oid = v_fn;
    IF v_acl IS NULL OR v_acl ~ '(^|[{,])=X' THEN
      RAISE EXCEPTION 'T1: % is open to PUBLIC: %', v_fn, COALESCE(v_acl, 'default acl');
    END IF;
  END LOOP;

  -- The single-lookup function keeps exactly the grants old edge versions rely on.
  IF NOT has_function_privilege('service_role', 'public.fetch_local_signal_ranked(text,numeric,text,numeric,numeric,numeric,numeric,text[],integer,text[],boolean)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'T1: the single lookup lost its service_role grant, which old edge versions use';
  END IF;
END;
$t1$;

DO $t2$
DECLARE
  r record;
BEGIN
  SELECT prosecdef, provolatile, proconfig INTO r FROM pg_proc
   WHERE oid = 'public.fetch_local_signal_ranked_batch(jsonb)'::regprocedure;
  IF NOT r.prosecdef OR r.provolatile <> 's' OR NOT COALESCE('search_path=public' = ANY(r.proconfig), false) THEN
    RAISE EXCEPTION 'T2: batch definer shape wrong: % % %', r.prosecdef, r.provolatile, r.proconfig;
  END IF;
  SELECT prosecdef, provolatile, proconfig INTO r FROM pg_proc
   WHERE oid = 'public.fetch_feed_places_by_ids(uuid[])'::regprocedure;
  IF r.prosecdef OR r.provolatile <> 's' OR NOT COALESCE('search_path=public' = ANY(r.proconfig), false) THEN
    RAISE EXCEPTION 'T2: hydrate shape wrong: % % %', r.prosecdef, r.provolatile, r.proconfig;
  END IF;
END;
$t2$;

-- T3 declared columns against the table. RETURN QUERY raises only when called, so
-- this is what catches a schema drift before the first Home open does.
DO $t3$
DECLARE
  v_mismatch text;
  v_count integer;
BEGIN
  WITH declared AS (
    SELECT a.name, format_type(a.oid_type, NULL) AS type_name
    FROM pg_proc p
    CROSS JOIN LATERAL unnest(p.proallargtypes, p.proargnames, p.proargmodes)
      AS a(oid_type, name, mode)
    WHERE p.oid = 'public.fetch_feed_places_by_ids(uuid[])'::regprocedure AND a.mode = 't'
  )
  SELECT string_agg(d.name || ':' || d.type_name || ' vs ' || COALESCE(format_type(c.atttypid, NULL), 'missing'), ', '),
         (SELECT count(*) FROM declared)
    INTO v_mismatch, v_count
  FROM declared d
  LEFT JOIN pg_attribute c
    ON c.attrelid = 'public.place_pool'::regclass AND c.attname = d.name AND NOT c.attisdropped
  WHERE c.attname IS NULL OR format_type(c.atttypid, NULL) <> d.type_name;
  IF v_mismatch IS NOT NULL THEN
    RAISE EXCEPTION 'T3: hydrate columns differ from place_pool: %', v_mismatch;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) AS a(name, mode)
  WHERE p.oid = 'public.fetch_feed_places_by_ids(uuid[])'::regprocedure AND a.mode = 't' AND a.name = 'photos';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'T3: the hydrate must not return photos';
  END IF;
END;
$t3$;

-- T4 malformed input. Scalars and objects raise; junk elements return nothing rather
-- than widening a lookup.
DO $t4$
DECLARE
  v_input jsonb;
  v_raised boolean;
  v_rows bigint;
BEGIN
  FOREACH v_input IN ARRAY ARRAY['{}'::jsonb, '"x"'::jsonb, '1'::jsonb, 'null'::jsonb, 'true'::jsonb] LOOP
    v_raised := false;
    BEGIN
      PERFORM * FROM public.fetch_local_signal_ranked_batch(v_input);
    EXCEPTION WHEN raise_exception THEN
      v_raised := true;
    END;
    IF NOT v_raised THEN
      RAISE EXCEPTION 'T4: % did not raise', v_input;
    END IF;
  END LOOP;

  v_raised := false;
  BEGIN
    PERFORM * FROM public.fetch_local_signal_ranked_batch(NULL);
  EXCEPTION WHEN raise_exception THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'T4: NULL did not raise';
  END IF;

  FOREACH v_input IN ARRAY ARRAY['[]'::jsonb, '[null]'::jsonb, '[{}]'::jsonb, '["x"]'::jsonb, '[1,2]'::jsonb] LOOP
    SELECT count(*) INTO v_rows FROM public.fetch_local_signal_ranked_batch(v_input);
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'T4: % returned % rows', v_input, v_rows;
    END IF;
  END LOOP;

  -- A hostile signal name is a value, not SQL.
  SELECT count(*) INTO v_rows FROM public.fetch_local_signal_ranked_batch(
    '[{"p_filter_signal":"x''; DROP TABLE public.place_pool; --","p_filter_min":0,"p_rank_signal":"x","p_lat_min":-90,"p_lat_max":90,"p_lng_min":-180,"p_lng_max":180,"p_limit":5}]'::jsonb);
  IF v_rows <> 0 OR to_regclass('public.place_pool') IS NULL THEN
    RAISE EXCEPTION 'T4: hostile signal name had an effect';
  END IF;

  SELECT count(*) INTO v_rows FROM public.fetch_feed_places_by_ids(NULL);
  IF v_rows <> 0 THEN RAISE EXCEPTION 'T4: NULL ids returned rows'; END IF;
  SELECT count(*) INTO v_rows FROM public.fetch_feed_places_by_ids(ARRAY[]::uuid[]);
  IF v_rows <> 0 THEN RAISE EXCEPTION 'T4: empty ids returned rows'; END IF;
END;
$t4$;

-- T5 exact edges of both caps.
DO $t5$
DECLARE
  v_raised boolean := false;
  v_rows bigint;
BEGIN
  SELECT count(*) INTO v_rows FROM public.fetch_local_signal_ranked_batch(
    (SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1, 12)));
  BEGIN
    PERFORM * FROM public.fetch_local_signal_ranked_batch((SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1, 13)));
  EXCEPTION WHEN raise_exception THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'T5: 13 requests did not raise'; END IF;

  SELECT count(*) INTO v_rows FROM public.fetch_feed_places_by_ids(
    ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 1000)));
  v_raised := false;
  BEGIN
    PERFORM * FROM public.fetch_feed_places_by_ids(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 1001)));
  EXCEPTION WHEN raise_exception THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'T5: 1001 ids did not raise'; END IF;
END;
$t5$;

-- T6 same request twice, at both ends of the array: positions stay, order stays, and
-- a duplicate id in the hydrate gives one row.
DO $t6$
DECLARE
  v_a uuid;
  v_b uuid;
  v_got text;
  v_rows bigint;
  v_req jsonb := '{"p_filter_signal":"t4275x_f","p_filter_min":0,"p_rank_signal":"t4275x_r","p_lat_min":70,"p_lat_max":72,"p_lng_min":-151,"p_lng_max":-149,"p_limit":5}'::jsonb;
BEGIN
  INSERT INTO public.place_pool (google_place_id, name, lat, lng, types, primary_type, stored_photo_urls, is_active, is_servable, city, country)
  VALUES ('t4275x-a', 'A', 71, -150, ARRAY['park'], 'park', ARRAY['https://example.test/a.jpg'], true, true, 'X', 'X') RETURNING id INTO v_a;
  INSERT INTO public.place_pool (google_place_id, name, lat, lng, types, primary_type, stored_photo_urls, is_active, is_servable, city, country)
  VALUES ('t4275x-b', 'B', 71, -150, ARRAY['park'], 'park', ARRAY['https://example.test/b.jpg'], true, true, 'X', 'X') RETURNING id INTO v_b;
  INSERT INTO public.place_scores (place_id, signal_id, score) VALUES
    (v_a, 't4275x_f', 10), (v_a, 't4275x_r', 20),
    (v_b, 't4275x_f', 10), (v_b, 't4275x_r', 90);

  SELECT string_agg(request_index::text || ':' || CASE place_id WHEN v_a THEN 'a' ELSE 'b' END, ',')
    INTO v_got
  FROM public.fetch_local_signal_ranked_batch(jsonb_build_array(v_req, '{}'::jsonb, v_req));
  IF v_got IS DISTINCT FROM '0:b,0:a,2:b,2:a' THEN
    RAISE EXCEPTION 'T6: positions or order wrong: %', v_got;
  END IF;

  SELECT count(*) INTO v_rows FROM public.fetch_feed_places_by_ids(ARRAY[v_a, v_a, v_b]);
  IF v_rows <> 2 THEN RAISE EXCEPTION 'T6: duplicate ids gave % rows', v_rows; END IF;
END;
$t6$;

-- T7 both run in a read-only transaction, as PostgREST runs a STABLE function.
SET TRANSACTION READ ONLY;
SELECT count(*) AS t7_read_only_batch FROM public.fetch_local_signal_ranked_batch('[{}]'::jsonb);
SELECT count(*) AS t7_read_only_hydrate FROM public.fetch_feed_places_by_ids(ARRAY[gen_random_uuid()]);

ROLLBACK;
