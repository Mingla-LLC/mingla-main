-- ISSUE #1403 — adversarial SQL contract proof.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_definition text;
  v_false_missing jsonb;
  v_false_mismatch jsonb;
  v_false_outsider jsonb;
BEGIN
  SELECT lower(pg_catalog.pg_get_functiondef(
    'public.reservation_metrics_rollup(uuid,uuid)'::regprocedure
  ))
  INTO v_definition;

  IF v_definition NOT LIKE '%reservation.brand_id = p_brand_id%'
    OR v_definition NOT LIKE '%reservation.venue_id = p_venue_id%'
    OR v_definition NOT LIKE '%availability.brand_id = p_brand_id%'
    OR v_definition NOT LIKE '%availability.venue_id = p_venue_id%'
    OR v_definition NOT LIKE '%venue.place_pool_id%'
    OR v_definition LIKE '%from public.events%'
    OR v_definition LIKE '%execute %'
  THEN
    RAISE EXCEPTION 'A-1 FAIL: exact-venue/static-SQL contract missing';
  END IF;

  IF public.reservation_metrics_rollup(NULL, gen_random_uuid()) IS NOT NULL
    OR public.reservation_metrics_rollup(gen_random_uuid(), NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'A-2 FAIL: null required input must be unavailable/null';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '00000000-1403-4000-8000-000000000999',
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1403-4000-8000-000000000999',
    true
  );
  v_false_missing := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000901',
    '00000000-1403-4000-8000-000000000902'
  );
  v_false_mismatch := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000903',
    '00000000-1403-4000-8000-000000000902'
  );
  v_false_outsider := public.reservation_metrics_rollup(
    '00000000-1403-4000-8000-000000000901',
    '00000000-1403-4000-8000-000000000902'
  );
  IF (v_false_missing - 'brand_id' - 'venue_id')
      IS DISTINCT FROM (v_false_mismatch - 'brand_id' - 'venue_id')
    OR (v_false_missing - 'brand_id' - 'venue_id')
      IS DISTINCT FROM (v_false_outsider - 'brand_id' - 'venue_id')
    OR (v_false_missing->>'authorized')::boolean IS DISTINCT FROM false
    OR (v_false_missing->>'covers_lifetime')::bigint <> 0
    OR v_false_missing->'by_source' <> '[]'::jsonb
  THEN
    RAISE EXCEPTION 'A-3 FAIL: denied envelopes disclose existence or data';
  END IF;
END;
$test$;

ROLLBACK;
