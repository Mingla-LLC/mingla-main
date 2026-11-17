-- #4420 migration 20280723004420: Discover measures an offering that hides its address
-- at its coarse point (one decimal), never its exact pin; the deck reader is not
-- anon-callable; anon cannot read events.venue_tax_address. Runs on the fully replayed
-- PG17 schema; each reader runs as the role that really calls it (service_role for the
-- discover-merged-events and discover-cards edge functions, anon for
-- pg_discover_business_events); everything rolls back.
--
-- MINGLA-INVARIANT: I-4420-DISCOVERY-COARSE-POINTS | issue #4420 | while an experience or event hides its address (hideAddressUntilTicket true or absent), discover_v2_items, discover_v2_city_context, discover_v2_event_base (and pg_discover_business_events through it) filter and order it at its one-decimal point and discover_v2_nearest_city returns that point, never the exact pin; a visible address is still measured and returned exactly; anon holds no EXECUTE on pg_eligible_experiences_for_deck and no SELECT on events.venue_tax_address, while service_role, authenticated and the base-table readers keep theirs (D-ITEMS, D-CTX, D-EVENTS, D-NEAREST, V-*, G-DECK, G-TAX, O-EXACT)
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4420d_check(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    PERFORM set_config('t4420d.failures',
      COALESCE(NULLIF(current_setting('t4420d.failures', true), ''), '') || E'\n  - ' || p_message, true);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Fixtures, each far from any other supply (open ocean), so a reader's answer
-- is decided by these rows alone:
--   exp_hid  experience, hideAddressUntilTicket true, stops at (-45.749, 170.649)
--   exp_vis  experience, hideAddressUntilTicket false, stops at (-40.749, 175.649)
--   ev_hid   event, no hideAddressUntilTicket key (withheld, fail closed), pin (-30.749, -120.149)
--   ev_vis   event, hideAddressUntilTicket false, pin (-25.749, -110.149)
-- A coarse point is one decimal: (-45.7, 170.6), (-30.7, -120.1); about 5-7 km
-- from the exact pin.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner uuid := '44230000-0000-4000-8000-0000000000a1';
  v_team  uuid := '44230000-0000-4000-8000-0000000000a2';
  v_guest uuid := '44230000-0000-4000-8000-0000000000a3';
  v_brand uuid := '44230000-0000-4000-8000-0000000000b1';
  u uuid;
  r record;
BEGIN
  FOREACH u IN ARRAY ARRAY[v_owner, v_team, v_guest] LOOP
    INSERT INTO auth.users(id, email) VALUES (u, 'i4420d-' || u || '@example.test');
    INSERT INTO public.profiles(id, email) VALUES (u, 'i4420d-' || u || '@example.test') ON CONFLICT (id) DO NOTHING;
  END LOOP;
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, country_code, created_at, updated_at)
    VALUES (v_brand, v_owner, 'Coarse point brand', 'i4420d-brand', 'USD', 'US', now(), now());
  -- A real host brand (example.test accounts read as internal and Explorer hides them).
  INSERT INTO public.admin_internal_brands(brand_id, is_internal, reason, marked_by)
    VALUES (v_brand, false, 'i4420d fixture', v_owner);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
    VALUES (v_brand, v_team, 'scanner', now());

  FOR r IN SELECT * FROM (VALUES
      ('exp_hid', '44230000-0000-4000-8000-000000000e01'::uuid, 'experience', 'I4420d Hidx',
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true)),
        -45.749::float8, 170.649::float8),
      ('exp_vis', '44230000-0000-4000-8000-000000000e02'::uuid, 'experience', 'I4420d Visx',
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false)),
        -40.749::float8, 175.649::float8),
      ('ev_hid', '44230000-0000-4000-8000-000000000e03'::uuid, 'event', 'I4420d Hide',
        jsonb_build_object('business_event', jsonb_build_object(
          'location', jsonb_build_object('address', '1 Withheld Quay'))),
        -30.749::float8, -120.149::float8),
      ('ev_vis', '44230000-0000-4000-8000-000000000e04'::uuid, 'event', 'I4420d Vise',
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false,
          'location', jsonb_build_object('address', '2 Open Quay'))),
        -25.749::float8, -110.149::float8)
    ) AS t(k, id, kind, city, theme, lat, lng)
  LOOP
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
        currency, published_at, experience_intents, theme, city, location_text, location_geo, venue_tax_address,
        created_at, updated_at)
      VALUES (r.id, v_brand, v_owner, 'Coarse ' || r.k, 'i4420d-' || replace(r.k, '_', '-'), r.kind, 'scheduled',
        'public', 'UTC', 'USD', now(),
        CASE WHEN r.kind = 'experience' THEN ARRAY['group-fun'] ELSE ARRAY[]::text[] END,
        r.theme, r.city,
        CASE WHEN r.kind = 'event' THEN 'Quay venue · ' || (r.theme #>> '{business_event,location,address}') END,
        CASE WHEN r.kind = 'event' THEN point(r.lng, r.lat) END,
        CASE WHEN r.kind = 'event' THEN jsonb_build_object('line1', 'Tax ' || r.k) END,
        now(), now());
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (r.id, now() + interval '2 days', now() + interval '2 days 3 hours', 'UTC', true);
    INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, is_unlimited,
        available_online, display_order)
      VALUES (r.id, 'Free', 0, 'USD', true, true, true, 0);
    IF r.kind = 'experience' THEN
      INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, city, region,
          country_code, lat, lng, image_urls, ai_description)
        VALUES (r.id, 0, 'gplace-' || r.k, 'First stop ' || r.k, '9 Pier Rd', r.city, NULL, 'NZ',
                r.lat, r.lng, ARRAY[]::text[], 'Start here');
    END IF;
  END LOOP;

  INSERT INTO public.orders(event_id, buyer_user_id, payment_status, source)
    VALUES ('44230000-0000-4000-8000-000000000e03', v_guest, 'paid', 'manual_import'),
           ('44230000-0000-4000-8000-000000000e01', v_guest, 'paid', 'manual_import');
END
$$;

CREATE TEMP TABLE t4420d_obs(path text, k text, payload text);
GRANT ALL ON t4420d_obs TO anon, authenticated, service_role;

-- A center 49.5 km due south of an exact pin: inside the 50 km experience radius of
-- the pin, about 55 km from its coarse point (which lies north of it).
CREATE FUNCTION pg_temp.t4420d_south(p_lat double precision) RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$ SELECT p_lat - 49.5 / 111.195 $$;

-- ---------------------------------------------------------------------------
-- D-ITEMS / D-CTX / D-NEAREST: the discover-merged-events edge function calls these
-- with the service role on behalf of anyone, signed in or not.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.t4420d_obs
  SELECT 'items', w.k, public.discover_v2_items('experiences', ARRAY['i4420d-nowhere'],
           pg_temp.t4420d_south(w.lat), w.lng, 50, 'UTC', '{}'::jsonb, 0, 50)::text
    FROM (VALUES ('exp_hid', -45.749::float8, 170.649::float8),
                 ('exp_vis', -40.749::float8, 175.649::float8)) AS w(k, lat, lng);
INSERT INTO pg_temp.t4420d_obs
  SELECT 'ctx', w.k, public.discover_v2_city_context(ARRAY['i4420d-nowhere'],
           pg_temp.t4420d_south(w.lat), w.lng, 50, 'Etc/GMT+12')::text
    FROM (VALUES ('exp_hid', -45.749::float8, 170.649::float8),
                 ('exp_vis', -40.749::float8, 175.649::float8)) AS w(k, lat, lng);
INSERT INTO pg_temp.t4420d_obs
  SELECT 'nearest', w.k, COALESCE(public.discover_v2_nearest_city(w.lat - 0.05, w.lng)::text, 'null')
    FROM (VALUES ('exp_hid', -45.749::float8, 170.649::float8),
                 ('exp_vis', -40.749::float8, 175.649::float8),
                 ('ev_hid', -30.749::float8, -120.149::float8),
                 ('ev_vis', -25.749::float8, -110.149::float8)) AS w(k, lat, lng);
RESET ROLE;

-- D-EVENTS: pg_discover_business_events is anon-callable and takes the radius from the
-- caller: a 500 m search at the exact pin.
SET LOCAL ROLE anon;
INSERT INTO pg_temp.t4420d_obs
  SELECT 'events_tight', w.k, public.pg_discover_business_events(ARRAY['i4420d-nowhere'], now(), NULL,
           NULL, NULL, NULL, 0, 50, w.lng, w.lat, 0.5)::text
    FROM (VALUES ('ev_hid', -30.749::float8, -120.149::float8),
                 ('ev_vis', -25.749::float8, -110.149::float8)) AS w(k, lat, lng);
-- The same search 30 km away still finds both (the coarse point is in range).
INSERT INTO pg_temp.t4420d_obs
  SELECT 'events_wide', w.k, public.pg_discover_business_events(ARRAY['i4420d-nowhere'], now(), NULL,
           NULL, NULL, NULL, 0, 50, w.lng, w.lat - 0.27, 50)::text
    FROM (VALUES ('ev_hid', -30.749::float8, -120.149::float8),
                 ('ev_vis', -25.749::float8, -110.149::float8)) AS w(k, lat, lng);
-- G-TAX: an ordinary anon read of the base relation still works.
INSERT INTO pg_temp.t4420d_obs
  SELECT 'anon_base', 'ev_vis', count(*)::text FROM public.events e
   WHERE e.id = '44230000-0000-4000-8000-000000000e04' AND e.theme IS NOT NULL;
RESET ROLE;

-- O-EXACT: the owner, a team member and the booked guest still read the exact pins.
CREATE FUNCTION pg_temp.t4420d_exact(p_who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.t4420d_obs
    SELECT 'exact_event', p_who, (e.location_geo)[1]::text FROM public.events e
     WHERE e.id = '44230000-0000-4000-8000-000000000e03';
  INSERT INTO pg_temp.t4420d_obs
    SELECT 'exact_stop', p_who, s.lat::text FROM public.experience_stops s
     WHERE s.event_id = '44230000-0000-4000-8000-000000000e01';
END
$$;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44230000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44230000-0000-4000-8000-0000000000a1', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420d_exact('owner');
RESET ROLE;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44230000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44230000-0000-4000-8000-0000000000a2', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420d_exact('team');
RESET ROLE;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44230000-0000-4000-8000-0000000000a3', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44230000-0000-4000-8000-0000000000a3', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420d_exact('guest');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);

-- ---------------------------------------------------------------------------
-- Verdicts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.t4420d_payload(p_path text, p_k text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT payload::jsonb FROM pg_temp.t4420d_obs WHERE path = p_path AND k = p_k
$$;
CREATE FUNCTION pg_temp.t4420d_has_item(p_items jsonb, p_id text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i WHERE i->>'id' = p_id)
$$;

-- D-ITEMS: 49.5 km from the pin, 55 km from the coarse point.
SELECT pg_temp.t4420d_check(
  NOT pg_temp.t4420d_has_item(pg_temp.t4420d_payload('items', 'exp_hid')->'items', '44230000-0000-4000-8000-000000000e01'),
  'D-ITEMS a hidden experience is radius-tested at its coarse point (not found 49.5 km from its exact pin)');
SELECT pg_temp.t4420d_check(
  pg_temp.t4420d_has_item(pg_temp.t4420d_payload('items', 'exp_vis')->'items', '44230000-0000-4000-8000-000000000e02'),
  'V-ITEMS a visible experience is still found 49.5 km from its exact pin (non-vacuous)');

-- D-CTX: the hidden experience is not a candidate there, so the device zone wins.
SELECT pg_temp.t4420d_check(
  pg_temp.t4420d_payload('ctx', 'exp_hid')->>'tzSource' = 'device',
  'D-CTX city context does not count a hidden experience beyond its coarse radius, got '
  || COALESCE(pg_temp.t4420d_payload('ctx', 'exp_hid')::text, 'NULL'));
SELECT pg_temp.t4420d_check(
  pg_temp.t4420d_payload('ctx', 'exp_vis')->>'tzSource' = 'supply',
  'V-CTX city context still counts a visible experience at its exact pin, got '
  || COALESCE(pg_temp.t4420d_payload('ctx', 'exp_vis')::text, 'NULL'));

-- D-EVENTS: a 500 m search at the exact pin.
SELECT pg_temp.t4420d_check(
  NOT pg_temp.t4420d_has_item(pg_temp.t4420d_payload('events_tight', 'ev_hid')->'rows', '44230000-0000-4000-8000-000000000e03'),
  'D-EVENTS a withheld event is not found by a 500 m search at its exact pin');
SELECT pg_temp.t4420d_check(
  pg_temp.t4420d_has_item(pg_temp.t4420d_payload('events_tight', 'ev_vis')->'rows', '44230000-0000-4000-8000-000000000e04'),
  'V-EVENTS a visible event is still found by a 500 m search at its exact pin (non-vacuous)');
SELECT pg_temp.t4420d_check(
  pg_temp.t4420d_has_item(pg_temp.t4420d_payload('events_wide', 'ev_hid')->'rows', '44230000-0000-4000-8000-000000000e03')
  AND pg_temp.t4420d_has_item(pg_temp.t4420d_payload('events_wide', 'ev_vis')->'rows', '44230000-0000-4000-8000-000000000e04'),
  'D-EVENTS both events stay discoverable by area (a 50 km search 30 km away)');
SELECT pg_temp.t4420d_check(
  NOT EXISTS (SELECT 1 FROM t4420d_obs WHERE path LIKE 'events_%' AND k = 'ev_hid'
               AND (payload LIKE '%Withheld Quay%' OR payload LIKE '%30.749%' OR payload LIKE '%120.149%')),
  'D-EVENTS the withheld event payload carries no street and no exact pin');

-- D-NEAREST: the hint's point is coarse while withheld, exact while visible.
SELECT pg_temp.t4420d_check(
  (pg_temp.t4420d_payload('nearest', 'exp_hid')->>'lat')::numeric = -45.7
  AND (pg_temp.t4420d_payload('nearest', 'exp_hid')->>'lng')::numeric = 170.6,
  'D-NEAREST a hidden experience''s nearest-city point is coarse, got '
  || COALESCE(pg_temp.t4420d_payload('nearest', 'exp_hid')::text, 'NULL'));
SELECT pg_temp.t4420d_check(
  (pg_temp.t4420d_payload('nearest', 'ev_hid')->>'lat')::numeric = -30.7
  AND (pg_temp.t4420d_payload('nearest', 'ev_hid')->>'lng')::numeric = -120.1,
  'D-NEAREST a withheld event''s nearest-city point is coarse, got '
  || COALESCE(pg_temp.t4420d_payload('nearest', 'ev_hid')::text, 'NULL'));
SELECT pg_temp.t4420d_check(
  (pg_temp.t4420d_payload('nearest', 'exp_vis')->>'lat')::numeric = -40.749
  AND (pg_temp.t4420d_payload('nearest', 'ev_vis')->>'lat')::numeric = -25.749
  AND pg_temp.t4420d_payload('nearest', 'exp_vis')->>'label' = 'I4420d Visx, NZ',
  'V-NEAREST visible offerings keep their exact nearest-city point');

-- O-EXACT: owner, team and booked guest read the exact pins.
SELECT pg_temp.t4420d_check(
  (SELECT count(*) FROM t4420d_obs WHERE path = 'exact_event' AND k = w.who AND payload::numeric = -30.749) = 1
  AND (SELECT count(*) FROM t4420d_obs WHERE path = 'exact_stop' AND k = w.who AND payload::numeric = -45.749) = 1,
  'O-EXACT ' || w.who || ' still reads the exact event pin and stop pin')
FROM (VALUES ('owner'), ('team'), ('guest')) AS w(who);

-- G-DECK / G-TAX.
SELECT pg_temp.t4420d_check(
  NOT has_function_privilege('anon', 'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)', 'EXECUTE'),
  'G-DECK the deck reader is not anon-callable; service_role and authenticated keep EXECUTE');
SELECT pg_temp.t4420d_check(
  NOT has_function_privilege('anon', 'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.discover_v2_nearest_city(double precision,double precision)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.discover_v2_nearest_city(double precision,double precision)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.pg_discover_business_events(text[],timestamp with time zone,timestamp with time zone,text[],text[],text[],integer,integer,double precision,double precision,double precision)', 'EXECUTE'),
  'G-DECK the discover readers keep their grants');
SELECT pg_temp.t4420d_check(
  NOT has_column_privilege('anon', 'public.events', 'venue_tax_address', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.events', 'SELECT')
  AND has_column_privilege('anon', 'public.events', 'theme', 'SELECT')
  AND has_column_privilege('authenticated', 'public.events', 'venue_tax_address', 'SELECT')
  AND has_column_privilege('service_role', 'public.events', 'venue_tax_address', 'SELECT')
  AND (SELECT payload FROM t4420d_obs WHERE path = 'anon_base') = '1',
  'G-TAX anon cannot select events.venue_tax_address; other readers and anon browsing are unchanged');

DO $$
DECLARE v_failures text := NULLIF(current_setting('t4420d.failures', true), '');
BEGIN
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'I-4420-DISCOVERY-COARSE-POINTS failed:%', v_failures;
  END IF;
  RAISE NOTICE 'I-4420-DISCOVERY-COARSE-POINTS: PASS';
END
$$;

ROLLBACK;
