-- issue #1020 [city-browse-geo-fallback] — SQL happy-path contract test (§8a).
--
-- Proves the geo-radius OR-fallback in pg_discover_business_events (migration
-- 20270117001020_issue_1020_discover_city_geo_fallback.sql):
--   A1 = FAILS-ON-REVERT SENTINEL. Browsing "Brussels" WITH the metro center +
--        50km radius RETURNS a venue whose city label is "Zaventem" but whose
--        pin sits ~9km from Brussels center. Deleting the OR-branch (reverting
--        the predicate to bare `e.city = ANY(p_cities)`) drops the row → A1 FAILS.
--   A2 = Browsing "Brussels" with NULL center/radius does NOT return the Zaventem
--        event — proves the geo branch is what surfaces it AND that city-only
--        behavior is unchanged. Also exercises the 8-positional-arg backward-compat
--        call path (trailing DEFAULT NULL geo params).
--   A3 = Browsing "Zaventem" (exact city), NULL geo, STILL returns it — the
--        exact-city path is untouched.
--
-- USAGE (this repo's SQL probe convention — apply the migration to a pg17 target
-- first, then pipe this file into psql; each block is BEGIN … ROLLBACK so it
-- leaves NO fixture rows):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/__tests__/issue_1020_discover_geo_fallback.test.sql
--
-- RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL (non-zero exit in CI/scripts).
-- NOTE: the RPC returns jsonb_build_object('total', …, 'rows', […]) — assertions
-- read `result->'rows'`, NOT the whole object (the older orch_1150_rsvp.test.sql
-- predates the {total,rows} shape and must not be used as the extraction model).

-- ===========================================================================
-- A1 / A2 / A3 — one shared fixture: a scheduled ticketed event geocoded to
-- Zaventem, pin ~9km from Brussels center, master date in-window.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_account uuid := gen_random_uuid();
  v_brand   uuid;
  v_event   uuid := gen_random_uuid();
  v_result  jsonb;
  v_found   boolean;
  -- Brussels center (browse center) and the Zaventem venue pin (city label
  -- differs from the browsed city, but the pin is inside the 50km metro radius).
  v_bru_lng double precision := 4.3517;
  v_bru_lat double precision := 50.8503;
  v_zav_lng double precision := 4.4699;
  v_zav_lat double precision := 50.8797;
BEGIN
  -- Owner chain: brands.account_id -> creator_accounts.id -> auth.users.id.
  -- Seed the auth user and the creator account (same id) before the brand.
  INSERT INTO auth.users (id) VALUES (v_account);
  INSERT INTO public.creator_accounts (id, created_at, updated_at)
  VALUES (v_account, now(), now());

  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (gen_random_uuid(), v_account, 'issue1020-brand', 'ISSUE1020', 'USD', now(), now())
  RETURNING id INTO v_brand;

  -- Ticketed event; city='Zaventem' (a Brussels sub-municipality); venue pin set
  -- to the Zaventem coordinates. point(x, y) = point(lng, lat), matching the RPC's
  -- ST_MakePoint(p_center_lng, p_center_lat) and location_geo::geometry (POINT(lng lat)).
  INSERT INTO public.events (id, brand_id, event_type, title, slug, description,
    status, visibility, currency, timezone, city, location_geo,
    published_at, created_at, updated_at)
  VALUES (v_event, v_brand, 'event', 'Zaventem Warehouse', 'zaventem-warehouse-1020', 'd',
    'scheduled', 'public', 'USD', 'UTC', 'Zaventem', point(v_zav_lng, v_zav_lat),
    now(), now(), now());
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master)
  VALUES (gen_random_uuid(), v_event, now() + interval '5 day',
    now() + interval '5 day' + interval '3 hour', 'UTC', true);

  -- ── A1 (fails-on-revert sentinel): browse Brussels WITH center + 50km radius.
  v_result := public.pg_discover_business_events(
    ARRAY['Brussels'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 50,
    p_center_lng => v_bru_lng, p_center_lat => v_bru_lat, p_radius_km => 50);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_event
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'A1 FAIL: Zaventem event NOT returned when browsing Brussels with center+radius (geo OR-fallback missing/reverted)';
  END IF;

  -- ── A2: browse Brussels with NULL center/radius (8-arg backward-compat call).
  v_result := public.pg_discover_business_events(
    ARRAY['Brussels'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 50);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_event
  ) INTO v_found;
  IF v_found THEN
    RAISE EXCEPTION 'A2 FAIL: Zaventem event leaked into a Brussels city-only browse (no geo) — city-only behavior changed';
  END IF;

  -- ── A3: browse Zaventem (exact city), NULL geo — exact-city path unchanged.
  v_result := public.pg_discover_business_events(
    ARRAY['Zaventem'], now() - interval '1 day', now() + interval '30 day',
    NULL, NULL, NULL, 0, 50);
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'rows') elem
     WHERE (elem->>'id')::uuid = v_event
  ) INTO v_found;
  IF NOT v_found THEN
    RAISE EXCEPTION 'A3 FAIL: exact-city browse (Zaventem) did NOT return the Zaventem event (regression)';
  END IF;

  RAISE NOTICE 'issue #1020 PASS: geo OR-fallback surfaces the sub-municipality venue for a metro browse (A1), city-only excludes it (A2), exact-city still returns it (A3)';
END$$;
ROLLBACK;
