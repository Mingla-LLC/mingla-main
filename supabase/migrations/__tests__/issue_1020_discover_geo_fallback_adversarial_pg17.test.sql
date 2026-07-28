-- issue #1020 [city-browse-geo-fallback] — SQL ADVERSARIAL regression proof (§8b).
-- PostgreSQL 17 (supabase/postgres:17.4.1.075). TESTER-owned; a DIFFERENT ANGLE
-- than the implementor happy-path (issue_1020_discover_geo_fallback.test.sql),
-- which proves the forward "sub-municipality venue surfaces" flow once.
--
-- This suite attacks the FALSE-POSITIVE / NULL-SAFETY / SCHEMA-RESOLUTION surface
-- of the geo-radius OR-fallback in pg_discover_business_events (migration
-- 20270117001020_issue_1020_discover_city_geo_fallback.sql) — angles the
-- happy-path never exercises:
--
--   ADV-1  NO METRO FALSE-POSITIVE LEAK. An event geocoded "Liège" with a pin
--          ~90 km (89.77 km measured) from the Brussels center is EXCLUDED when
--          browsing ARRAY['Brussels'] at p_radius_km=50 WITH the center supplied.
--          Proves the geo branch is a bounded radius test, not an "admit every
--          event that has a pin" bug — the OR-fallback must not widen the deck
--          to the whole country.
--   ADV-2  PREDICATE NULL-SAFETY (location_geo IS NULL guard).
--          (2a) A NULL-pin event whose city does NOT match the browse does NOT
--               crash the RPC and is ABSENT (the `e.location_geo IS NOT NULL`
--               guard short-circuits before ST_DWithin ever sees a NULL geom).
--          (2b) A NULL-pin event whose city DOES match the browse STILL returns
--               (the city branch of the OR is untouched for pin-less rows).
--   ADV-3  GEO-ONLY MATCH RESOLVES AT RUNTIME (fails-on-revert SENTINEL). An
--          event whose city label is deliberate nonsense ("Faraway-1020", never
--          in p_cities) but whose pin sits ~1 km from the Brussels center RETURNS
--          when browsing ARRAY['Brussels'] with center+radius. This can ONLY be
--          true if public.ST_DWithin + public.ST_SetSRID + public.ST_MakePoint
--          and the public.geometry/public.geography types all RESOLVE under the
--          function's SET search_path='' (a bare ST_*/geometry/geography would
--          throw "function/type does not exist" and this assertion would error).
--          Reverting the OR-branch to bare `e.city = ANY(p_cities)` drops this
--          row → ADV-3 FAILS. (ADV-1/ADV-2 stay green on revert — they are
--          exclusion/city-branch checks — so ADV-3 is the true revert sentinel.)
--
-- USAGE (apply all migrations to a pg17 target first, then pipe this file in):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/__tests__/issue_1020_discover_geo_fallback_adversarial_pg17.test.sql
--
-- RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL (non-zero exit under ON_ERROR_STOP).
-- Single BEGIN … ROLLBACK — leaves NO fixture rows. The RPC returns
-- jsonb_build_object('total', …, 'rows', […]); assertions read result->'rows'.
-- ===========================================================================
BEGIN;
DO $test$
DECLARE
  v_account  uuid := gen_random_uuid();
  v_brand    uuid;
  v_liege    uuid := gen_random_uuid();  -- ADV-1: ~90 km, city 'Liège'
  v_nullfar  uuid := gen_random_uuid();  -- ADV-2a: NULL pin, non-matching city
  v_nullbru  uuid := gen_random_uuid();  -- ADV-2b: NULL pin, matching city
  v_geoonly  uuid := gen_random_uuid();  -- ADV-3: ~1 km pin, nonsense city
  v_result   jsonb;
  v_found    boolean;
  -- Brussels browse center.
  v_bru_lng  double precision := 4.3517;
  v_bru_lat  double precision := 50.8503;
BEGIN
  -- Owner chain: brands.account_id -> creator_accounts.id -> auth.users.id.
  INSERT INTO auth.users (id) VALUES (v_account);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
  VALUES (v_account, now(), now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), v_account, 'issue1020-adv-brand', 'ISSUE1020ADV', 'USD', now(), now())
  RETURNING id INTO v_brand;

  -- ADV-1 fixture: Liège, pin ~90 km out.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo,
    published_at, created_at, updated_at)
  VALUES (v_liege, v_brand, 'event', 'Liege Festival', 'liege-fest-1020', 'd',
    'scheduled', 'public', 'USD', 'UTC', 'Liège', point(5.5763, 50.6326),
    now(), now(), now());

  -- ADV-2a fixture: NULL pin, non-matching city (Antwerpen).
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo,
    published_at, created_at, updated_at)
  VALUES (v_nullfar, v_brand, 'event', 'Antwerp Nopin', 'antwerp-nopin-1020', 'd',
    'scheduled', 'public', 'USD', 'UTC', 'Antwerpen', NULL,
    now(), now(), now());

  -- ADV-2b fixture: NULL pin, MATCHING city (Brussels).
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo,
    published_at, created_at, updated_at)
  VALUES (v_nullbru, v_brand, 'event', 'Brussels Nopin', 'brussels-nopin-1020', 'd',
    'scheduled', 'public', 'USD', 'UTC', 'Brussels', NULL,
    now(), now(), now());

  -- ADV-3 fixture: nonsense city, pin ~1 km from Brussels center.
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo,
    published_at, created_at, updated_at)
  VALUES (v_geoonly, v_brand, 'event', 'Geo Only Venue', 'geo-only-1020', 'd',
    'scheduled', 'public', 'USD', 'UTC', 'Faraway-1020', point(4.3600, 50.8500),
    now(), now(), now());

  -- One in-window master date per event (end_at >= lower bound).
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  SELECT gen_random_uuid(), e, now() + interval '5 day',
         now() + interval '5 day' + interval '3 hour', 'UTC', true
  FROM (VALUES (v_liege), (v_nullfar), (v_nullbru), (v_geoonly)) AS t(e);

  -- Single browse: ARRAY['Brussels'] WITH the metro center + 50 km radius. The
  -- geo branch is ACTIVE for this whole call.
  v_result := public.pg_discover_business_events(
    ARRAY['Brussels'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 20,
    p_center_lng => v_bru_lng, p_center_lat => v_bru_lat, p_radius_km => 50);

  -- ── ADV-1: the ~90 km Liège pin must NOT leak in at radius 50.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_liege
  ) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'ADV-1 FAIL: Liège pin ~90km OUT leaked into a 50km Brussels browse (radius bound broken / metro false-positive)';
  END IF;

  -- ── ADV-2a: NULL-pin non-matching-city event is absent (and no crash — reaching
  --    this assertion at all proves the location_geo IS NULL guard held).
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_nullfar
  ) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'ADV-2a FAIL: NULL-geo non-matching-city event surfaced (NULL pin must not pass the geo branch)';
  END IF;

  -- ── ADV-2b: NULL-pin MATCHING-city event still returns via the city branch.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_nullbru
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'ADV-2b FAIL: NULL-geo city-matching event dropped (city branch must still admit pin-less rows)';
  END IF;

  -- ── ADV-3 (SENTINEL): geo-only match (nonsense city, in-radius pin) returns.
  --    Its very success proves public.ST_DWithin/ST_SetSRID/ST_MakePoint and the
  --    public.geometry/geography types resolve under search_path=''.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_geoonly
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'ADV-3 FAIL: geo-only match (nonsense city, in-radius pin) NOT returned — OR-branch reverted OR schema-qualification unresolved';
  END IF;

  RAISE NOTICE 'issue #1020 ADVERSARIAL PASS: ~90km Liège pin excluded (ADV-1); NULL-pin non-match absent + no crash (ADV-2a); NULL-pin city-match returns (ADV-2b); geo-only in-radius match resolves + returns (ADV-3 sentinel)';
END $test$;
ROLLBACK;
