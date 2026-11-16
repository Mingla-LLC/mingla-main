-- #4420 migration 20280722004420: an experience's stop street, exact pin and map place
-- id reach only the host, the brand team, admins, booked guests and the service role
-- while the host hides the address until booking. Runs on the fully replayed PG17
-- schema; every read below runs as the real caller role; everything rolls back.
--
-- MINGLA-INVARIANT: I-4420-EXPERIENCE-STOP-DETAIL-VISIBILITY | issue #4420 | while an experience hides its address (hideAddressUntilTicket true or absent), anon and a signed-in caller who did not book get no stop street, exact pin or map place id through experience_stops (rows and WHERE filters), pg_eligible_experiences_for_deck (payload and radius filter), links_page_week, events.theme, pg_public_experience_by_slug, pg_public_experiences_by_brand or pg_brand_experiences_for_place; the owner, a team member and a booked guest still read the exact stop rows; a visible address is unchanged; the experience writers store the area line, not the street (A-DECK, A-RADIUS, A-TABLE, A-FILTER, A-THEME, A-PUBLIC, A-LINKS, U-*, O-TABLE, T-TABLE, B-TABLE, B-OTHER, V-*, W-CREATE, G-ACL)
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4420s_check(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    PERFORM set_config('t4420s.failures',
      COALESCE(NULLIF(current_setting('t4420s.failures', true), ''), '') || E'\n  - ' || p_message, true);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: one brand on a verified venue, three bookable experiences.
--   hid  hideAddressUntilTicket = true
--   leg  no hideAddressUntilTicket key (a legacy row: withheld, fail closed)
--   vis  hideAddressUntilTicket = false
-- Each stores the first stop's street in venue_text, as the writers did before.
-- Users: owner (brand account), team (accepted scanner), guest (paid order on hid),
-- other (signed in, only a cancelled order on hid).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner uuid := '44220000-0000-4000-8000-0000000000a1';
  v_team  uuid := '44220000-0000-4000-8000-0000000000a2';
  v_guest uuid := '44220000-0000-4000-8000-0000000000a3';
  v_other uuid := '44220000-0000-4000-8000-0000000000a4';
  v_brand uuid := '44220000-0000-4000-8000-0000000000b1';
  v_place uuid := '44220000-0000-4000-8000-0000000000c1';
  v_street text := '12 Hidden Lane, Raleigh, NC 27601, USA';
  u uuid;
  r record;
BEGIN
  FOREACH u IN ARRAY ARRAY[v_owner, v_team, v_guest, v_other] LOOP
    INSERT INTO auth.users(id, email) VALUES (u, 'i4420s-' || u || '@example.test');
    INSERT INTO public.profiles(id, email) VALUES (u, 'i4420s-' || u || '@example.test') ON CONFLICT (id) DO NOTHING;
  END LOOP;
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
    VALUES (v_brand, v_owner, 'Stop detail brand', 'i4420s-brand', 'USD', now(), now());
  -- A real host brand (example.test accounts read as internal and Explorer hides them).
  INSERT INTO public.admin_internal_brands(brand_id, is_internal, reason, marked_by)
    VALUES (v_brand, false, 'i4420s fixture', v_owner);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
    VALUES (v_brand, v_team, 'scanner', now());
  INSERT INTO public.place_pool(id, name, lat, lng) VALUES (v_place, 'i4420s place', 35.78, -78.64);
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status, place_pool_id)
    VALUES ('44220000-0000-4000-8000-0000000000d1', v_brand, 'i4420svenue', 'i4420s venue', 35.78, -78.64,
            'restaurant', 'verified', v_place);

  FOR r IN SELECT * FROM (VALUES
      ('hid', '44220000-0000-4000-8000-000000000e01'::uuid,
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true),
                           'experience_meta', jsonb_build_object('venue_text', v_street))),
      ('leg', '44220000-0000-4000-8000-000000000e02'::uuid,
        jsonb_build_object('experience_meta', jsonb_build_object('venue_text', v_street))),
      ('vis', '44220000-0000-4000-8000-000000000e03'::uuid,
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false),
                           'experience_meta', jsonb_build_object('venue_text', v_street)))
    ) AS t(k, id, theme)
  LOOP
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
        currency, published_at, experience_intents, theme, created_at, updated_at)
      VALUES (r.id, v_brand, v_owner, 'Stop detail ' || r.k, 'i4420s-' || r.k, 'experience', 'scheduled',
        'public', 'UTC', 'USD', now(), ARRAY['group-fun'], r.theme, now(), now());
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (r.id, now() + interval '2 days', now() + interval '2 days 3 hours', 'UTC', true);
    INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, is_unlimited,
        available_online, display_order)
      VALUES (r.id, 'Free', 0, 'USD', true, true, true, 0);
    INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, city, region,
        country_code, lat, lng, image_urls, ai_description)
      VALUES (r.id, 0, 'gplace-' || r.k, 'First stop ' || r.k, v_street, 'Raleigh', NULL, 'US',
              35.7796123, -78.6382456, ARRAY['https://example.test/a.jpg'], 'Start here'),
             (r.id, 1, 'gplace2-' || r.k, 'Second stop ' || r.k, '99 Other Rd, Raleigh, NC', 'Raleigh', NULL, 'US',
              35.7811111, -78.6399999, ARRAY[]::text[], 'Then here');
  END LOOP;

  INSERT INTO public.orders(event_id, buyer_user_id, payment_status, source)
    VALUES ('44220000-0000-4000-8000-000000000e01', v_guest, 'paid', 'manual_import'),
           ('44220000-0000-4000-8000-000000000e01', v_other, 'cancelled', 'manual_import');
END
$$;

-- Rows that existed before the fix keep the street in venue_text until the backfill.
DO $$
BEGIN
  IF to_regprocedure('public.issue_4420_backfill_experience_venue_text()') IS NOT NULL THEN
    PERFORM public.issue_4420_backfill_experience_venue_text();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Observe every path as each caller.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t4420s_obs(who text, path text, k text, payload text);
GRANT ALL ON t4420s_obs TO anon, authenticated, service_role;

-- The deck reader at the exact pin: a wide radius (payload) and a 100 m one (filter).
-- 20280723004420: anon holds no EXECUTE on it; for a signed-out caller the
-- discover-cards edge function calls it with the service role (see the anon run below).
CREATE FUNCTION pg_temp.t4420s_observe_deck(p_who text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.t4420s_obs
    SELECT p_who, 'deck', replace(d.event_slug, 'i4420s-', ''), row_to_json(d)::text
      FROM public.pg_eligible_experiences_for_deck(35.7796123, -78.6382456, 50000, ARRAY['group-fun'],
             now(), ARRAY[]::uuid[], 30) d
     WHERE d.event_slug LIKE 'i4420s-%';
  INSERT INTO pg_temp.t4420s_obs
    SELECT p_who, 'deck_tight', replace(d.event_slug, 'i4420s-', ''), d.event_id::text
      FROM public.pg_eligible_experiences_for_deck(35.7796123, -78.6382456, 100, ARRAY['group-fun'],
             now(), ARRAY[]::uuid[], 30) d
     WHERE d.event_slug LIKE 'i4420s-%';
END
$$;

CREATE FUNCTION pg_temp.t4420s_observe(p_who text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  k text;
BEGIN
  IF current_user <> 'anon' THEN
    PERFORM pg_temp.t4420s_observe_deck(p_who);
  END IF;

  FOREACH k IN ARRAY ARRAY['hid', 'leg', 'vis'] LOOP
    -- The table, as a client select and as a WHERE filter on the pin.
    INSERT INTO pg_temp.t4420s_obs
      SELECT p_who, 'table', k, COALESCE(json_agg(row_to_json(s) ORDER BY s.stop_order)::text, '[]')
        FROM public.experience_stops s
       WHERE s.event_id = (SELECT e.id FROM public.events e WHERE e.slug = 'i4420s-' || k);
    INSERT INTO pg_temp.t4420s_obs
      SELECT p_who, 'filter', k, count(*)::text
        FROM public.experience_stops s
       WHERE s.event_id = (SELECT e.id FROM public.events e WHERE e.slug = 'i4420s-' || k)
         AND s.lat BETWEEN 35.77 AND 35.79 AND s.address LIKE '%Hidden%';
    -- The theme column on the base relation.
    INSERT INTO pg_temp.t4420s_obs
      SELECT p_who, 'theme', k, e.theme::text FROM public.events e WHERE e.slug = 'i4420s-' || k;
    -- The public page reader.
    INSERT INTO pg_temp.t4420s_obs
      SELECT p_who, 'slug', k, public.pg_public_experience_by_slug('i4420s-brand', 'i4420s-' || k)::text;
  END LOOP;

  INSERT INTO pg_temp.t4420s_obs
    SELECT p_who, 'brand', replace(b.experience_slug, 'i4420s-', ''), row_to_json(b)::text
      FROM public.pg_public_experiences_by_brand('i4420s-brand') b;
  INSERT INTO pg_temp.t4420s_obs
    SELECT p_who, 'place', replace(p.experience_slug, 'i4420s-', ''), row_to_json(p)::text
      FROM public.pg_brand_experiences_for_place('44220000-0000-4000-8000-0000000000c1') p;
  INSERT INTO pg_temp.t4420s_obs
    SELECT p_who, 'links', replace(l.item_slug, 'i4420s-', ''), row_to_json(l)::text
      FROM public.links_page_week() l
     WHERE l.brand_slug = 'i4420s-brand';
END
$$;

SET LOCAL ROLE anon;
SELECT pg_temp.t4420s_observe('anon');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.t4420s_observe_deck('anon');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44220000-0000-4000-8000-0000000000a4', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420s_observe('other');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44220000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420s_observe('owner');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44220000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420s_observe('team');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44220000-0000-4000-8000-0000000000a3', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420s_observe('guest');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- A payload leaks when it carries a street, the exact pin (35.7796123 / -78.6382456 /
-- 35.7811111 / -78.6399999, any 3+ decimals of them) or a map place id.
CREATE FUNCTION pg_temp.t4420s_leaks(p text) RETURNS boolean LANGUAGE sql AS $$
  SELECT p LIKE '%Hidden Lane%' OR p LIKE '%Other Rd%' OR p LIKE '%gplace%'
      OR p LIKE '%35.779%' OR p LIKE '%78.638%' OR p LIKE '%35.781%' OR p LIKE '%78.639%'
$$;

-- Non-vacuity: every public path returned the fixture to anon.
SELECT pg_temp.t4420s_check(
  (SELECT count(DISTINCT path) FROM t4420s_obs WHERE who = 'anon' AND k = 'vis'
     AND path IN ('deck', 'table', 'theme', 'slug', 'brand', 'place', 'links')) = 7,
  'NON-VACUOUS anon reaches the visible fixture through all seven paths, got '
  || (SELECT string_agg(DISTINCT path, ',') FROM t4420s_obs WHERE who = 'anon' AND k = 'vis'));
SELECT pg_temp.t4420s_check(
  (SELECT count(DISTINCT k) FROM t4420s_obs WHERE who = 'anon' AND path = 'deck') = 3,
  'NON-VACUOUS the deck returns all three experiences at a wide radius');

-- A-* / U-*: anon and the signed-in caller who did not book.
SELECT pg_temp.t4420s_check(
  NOT EXISTS (SELECT 1 FROM t4420s_obs WHERE who = w.who AND k IN ('hid', 'leg')
               AND path IN ('deck', 'table', 'theme', 'slug', 'brand', 'place', 'links')
               AND pg_temp.t4420s_leaks(payload)),
  w.who || ': no path carries a hidden experience''s street, exact pin or map place id; leaking: '
  || COALESCE((SELECT string_agg(path || '/' || k, ', ' ORDER BY path, k) FROM t4420s_obs
                WHERE who = w.who AND k IN ('hid', 'leg') AND pg_temp.t4420s_leaks(payload)
                  AND path IN ('deck', 'table', 'theme', 'slug', 'brand', 'place', 'links')), 'none'))
FROM (VALUES ('anon'), ('other')) AS w(who);

SELECT pg_temp.t4420s_check(
  NOT EXISTS (SELECT 1 FROM t4420s_obs WHERE who = w.who AND path = 'deck_tight' AND k IN ('hid', 'leg')),
  w.who || ': a 100 m deck search at the exact pin does not find a hidden experience (RADIUS)')
FROM (VALUES ('anon'), ('other')) AS w(who);

SELECT pg_temp.t4420s_check(
  (SELECT bool_and(payload = '0') FROM t4420s_obs WHERE who = w.who AND path = 'filter' AND k IN ('hid', 'leg')),
  w.who || ': a WHERE on a hidden stop''s pin or street matches nothing (FILTER)')
FROM (VALUES ('anon'), ('other')) AS w(who);

SELECT pg_temp.t4420s_check(
  (SELECT bool_and(payload::jsonb #>> '{experience_meta,venue_text}' = 'Raleigh, US')
     FROM t4420s_obs WHERE who = 'anon' AND path = 'theme' AND k IN ('hid', 'leg')),
  'A-THEME a hidden experience''s stored venue_text is the area line "Raleigh, US"');

-- The deck keeps an approximate area for the map, distance and weather.
SELECT pg_temp.t4420s_check(
  (SELECT bool_and((s->>'lat')::numeric = 35.8 AND (s->>'lng')::numeric = -78.6
                   AND s->'address' = 'null'::jsonb AND s->>'place_name' LIKE '% stop hid')
     FROM t4420s_obs, jsonb_array_elements(payload::jsonb->'stops') AS s
    WHERE who = 'anon' AND path = 'deck' AND k = 'hid'),
  'A-DECK a hidden stop keeps its name and a one-decimal point, with no street');
SELECT pg_temp.t4420s_check(
  (SELECT payload::jsonb->>'city' FROM t4420s_obs WHERE who = 'anon' AND path = 'deck' AND k = 'hid') = 'Raleigh',
  'A-DECK the deck keeps the city line');

-- O / T / B: the owner, a team member and the booked guest read the exact stop rows.
SELECT pg_temp.t4420s_check(
  (SELECT payload LIKE '%Hidden Lane%' AND payload LIKE '%35.7796123%' AND payload LIKE '%gplace-hid%'
     FROM t4420s_obs WHERE who = w.who AND path = 'table' AND k = 'hid'),
  w.who || ': reads the hidden experience''s exact stops (street, pin, place id)')
FROM (VALUES ('owner'), ('team'), ('guest')) AS w(who);
SELECT pg_temp.t4420s_check(
  (SELECT payload LIKE '%Hidden Lane%' FROM t4420s_obs WHERE who = w.who AND path = 'table' AND k = 'leg'),
  w.who || ': reads the legacy hidden experience''s exact stops')
FROM (VALUES ('owner'), ('team')) AS w(who);
SELECT pg_temp.t4420s_check(
  (SELECT payload = '[]' FROM t4420s_obs WHERE who = 'guest' AND path = 'table' AND k = 'leg'),
  'B-OTHER a booking on one experience does not reveal another');

-- V-*: a visible address is unchanged on every path.
SELECT pg_temp.t4420s_check(
  (SELECT payload LIKE '%Hidden Lane%' AND payload LIKE '%35.7796123%' AND payload LIKE '%gplace-vis%'
     FROM t4420s_obs WHERE who = 'anon' AND path = 'table' AND k = 'vis'),
  'V-TABLE anon still reads a visible experience''s stops');
SELECT pg_temp.t4420s_check(
  (SELECT payload LIKE '%Hidden Lane%' AND payload LIKE '%35.7796123%' AND payload LIKE '%gplace-vis%'
     FROM t4420s_obs WHERE who = 'anon' AND path = 'deck' AND k = 'vis'),
  'V-DECK a visible experience keeps street, pin and place id in the deck');
SELECT pg_temp.t4420s_check(
  EXISTS (SELECT 1 FROM t4420s_obs WHERE who = 'anon' AND path = 'deck_tight' AND k = 'vis'),
  'V-RADIUS a visible experience is still found at 100 m');
SELECT pg_temp.t4420s_check(
  (SELECT payload::jsonb #>> '{experience_meta,venue_text}' FROM t4420s_obs
    WHERE who = 'anon' AND path = 'theme' AND k = 'vis') = '12 Hidden Lane, Raleigh, NC 27601, USA',
  'V-THEME a visible experience keeps the street in venue_text');
SELECT pg_temp.t4420s_check(
  (SELECT payload LIKE '%35.7796123%' FROM t4420s_obs WHERE who = 'anon' AND path = 'links' AND k = 'vis'),
  'V-LINKS a visible experience keeps its exact point on the links page');

-- W-CREATE: a new experience stores the area line, not the street.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44220000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t4420s_created AS
  SELECT public.biz_create_experience('44220000-0000-4000-8000-0000000000b1', jsonb_build_object(
    'title', 'Stop detail created', 'experience_intents', jsonb_build_array('group-fun'), 'currency', 'USD',
    'stops', jsonb_build_array(jsonb_build_object(
      'place_name', 'Created stop', 'address', '7 New Street, Raleigh, NC', 'city', 'Raleigh',
      'country_code', 'us', 'place_id', 'gplace-new', 'lat', 35.7, 'lng', -78.6))), false) AS r;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT pg_temp.t4420s_check(
  (SELECT e.theme #>> '{experience_meta,venue_text}' FROM public.events e
    WHERE e.brand_id = '44220000-0000-4000-8000-0000000000b1' AND e.title = 'Stop detail created') = 'Raleigh, US',
  'W-CREATE a new experience stores the area line "Raleigh, US", got '
  || COALESCE((SELECT e.theme #>> '{experience_meta,venue_text}' FROM public.events e
    WHERE e.brand_id = '44220000-0000-4000-8000-0000000000b1' AND e.title = 'Stop detail created'), 'NULL'));

-- G-ACL: the helpers are not callable by app clients; the readers keep their grants.
SELECT pg_temp.t4420s_check(
  to_regprocedure('public.issue_4420_caller_reads_exact_stops(uuid)') IS NOT NULL
  AND NOT has_function_privilege('anon', 'public.issue_4420_caller_reads_exact_stops(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4420_stop_coordinate(jsonb,double precision)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4420_stored_venue_text(jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4420_backfill_experience_venue_text()', 'EXECUTE'),
  'G-ACL the #4420 helpers are not callable by app clients');
SELECT pg_temp.t4420s_check(
  NOT has_function_privilege('anon', 'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.links_page_week()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.biz_create_experience(uuid,jsonb,boolean)', 'EXECUTE'),
  'G-ACL the readers and writers keep their grants (the deck reader is service-role and authenticated only, 20280723004420)');

DO $$
DECLARE v_failures text := NULLIF(current_setting('t4420s.failures', true), '');
BEGIN
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'I-4420-EXPERIENCE-STOP-DETAIL-VISIBILITY failed:%', v_failures;
  END IF;
  RAISE NOTICE 'I-4420-EXPERIENCE-STOP-DETAIL-VISIBILITY: PASS';
END
$$;

ROLLBACK;
