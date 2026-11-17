-- #4420 migration 20280724004420: while an event hides its address until booking, its
-- stored theme carries no street, map place id, pin or combined label, and no host
-- draft blob; the brand team, booked guests and the service role still read the exact
-- location; the Host editor's load and save keep the street. Runs on the fully
-- replayed PG17 schema; every read below runs as the real caller role; everything
-- rolls back.
--
-- MINGLA-INVARIANT: I-4420-EVENT-LOCATION-FOLLOWS-ADDRESS-RULE | issue #4420 | event location detail follows the address visibility rule: while hidden, only the brand team, booked guests and the service role read the exact location; a visible-address event is unchanged; the Host editor load and save keep the street (A-*, U-*, O-*, T-*, B-*, V-*, H-*, N-*, D-*, G-*)
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4420l_check(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    PERFORM set_config('t4420l.failures',
      COALESCE(NULLIF(current_setting('t4420l.failures', true), ''), '') || E'\n  - ' || p_message, true);
  END IF;
END
$$;

-- A payload leaks when it carries the street, the map place id, or the pin (5+ decimals).
CREATE FUNCTION pg_temp.t4420l_leaks(p_payload text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_payload, '') ~ '(Hidden Lane|ChIJ4420|40\.70663|74\.01137|Draft Street)'
$$;

-- The theme each fixture event stored before the fix: the whole location, plus a
-- leftover host draft blob on a published row.
CREATE FUNCTION pg_temp.t4420l_fixture_theme(p_slug text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'coverHue', 25,
    'business_event', jsonb_strip_nulls(jsonb_build_object(
      'format', 'in_person',
      'hideAddressUntilTicket', CASE p_slug WHEN 'i4420l-hid' THEN 'true'::jsonb
                                            WHEN 'i4420l-vis' THEN 'false'::jsonb END,
      'clientRevision', 0,
      'location', jsonb_build_object('venueName', 'Loft Hall', 'address', '12 Hidden Lane, New York, NY 10005, USA'),
      'locationProviderPlaceId', 'ChIJ4420placeid',
      'location_text', 'Loft Hall · 12 Hidden Lane, New York, NY 10005, USA',
      'location_geo', '(-74.0113798,40.7066336)',
      'settings', jsonb_build_object('requireApproval', false))),
    'business_draft', jsonb_build_object('location', jsonb_build_object('address', '7 Draft Street'),
      'locationGeo', jsonb_build_object('lat', 40.7066336, 'lng', -74.0113798)))
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: one brand, three published events.
--   hid  hideAddressUntilTicket = true
--   leg  no hideAddressUntilTicket key (withheld, fail closed)
--   vis  hideAddressUntilTicket = false
-- Users: owner (brand account), team (accepted scanner), guest (paid order on hid and
-- leg), other (signed in, only a cancelled order on hid).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner uuid := '44240000-0000-4000-8000-0000000000a1';
  v_team  uuid := '44240000-0000-4000-8000-0000000000a2';
  v_guest uuid := '44240000-0000-4000-8000-0000000000a3';
  v_other uuid := '44240000-0000-4000-8000-0000000000a4';
  v_brand uuid := '44240000-0000-4000-8000-0000000000b1';
  v_street text := '12 Hidden Lane, New York, NY 10005, USA';
  u uuid;
  r record;
BEGIN
  FOREACH u IN ARRAY ARRAY[v_owner, v_team, v_guest, v_other] LOOP
    INSERT INTO auth.users(id, email) VALUES (u, 'i4420l-' || u || '@example.test');
    INSERT INTO public.profiles(id, email) VALUES (u, 'i4420l-' || u || '@example.test') ON CONFLICT (id) DO NOTHING;
  END LOOP;
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
    VALUES (v_brand, v_owner, 'Event location brand', 'i4420l-brand', 'USD', now(), now());
  INSERT INTO public.admin_internal_brands(brand_id, is_internal, reason, marked_by)
    VALUES (v_brand, false, 'i4420l fixture', v_owner);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
    VALUES (v_brand, v_team, 'scanner', now());

  FOR r IN SELECT * FROM (VALUES
      ('hid', '44240000-0000-4000-8000-000000000e01'::uuid),
      ('leg', '44240000-0000-4000-8000-000000000e02'::uuid),
      ('vis', '44240000-0000-4000-8000-000000000e03'::uuid)
    ) AS t(k, id)
  LOOP
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
        currency, published_at, city, location_text, location_geo, theme, created_at, updated_at)
      VALUES (r.id, v_brand, v_owner, 'Location ' || r.k, 'i4420l-' || r.k, 'event', 'scheduled',
        'public', 'UTC', 'USD', now(), 'New York', 'Loft Hall · ' || v_street, point(-74.0113798, 40.7066336),
        pg_temp.t4420l_fixture_theme('i4420l-' || r.k),
        now(), now());
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (r.id, now() + interval '2 days', now() + interval '2 days 3 hours', 'UTC', true);
    INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, is_unlimited,
        available_online, display_order)
      VALUES (r.id, 'Free', 0, 'USD', true, true, true, 0);
  END LOOP;

  -- Rows written before the fix stored the whole location in theme. Put it back with
  -- the #4420 trigger off, then run the one-time backfill (absent before the fix).
  IF to_regclass('public.event_withheld_location') IS NOT NULL THEN
    ALTER TABLE public.events DISABLE TRIGGER issue_4420_withhold_event_location;
    DELETE FROM public.event_withheld_location w WHERE w.event_id IN (
      '44240000-0000-4000-8000-000000000e01', '44240000-0000-4000-8000-000000000e02',
      '44240000-0000-4000-8000-000000000e03');
    UPDATE public.events e SET theme = pg_temp.t4420l_fixture_theme(e.slug) WHERE e.brand_id = v_brand;
    ALTER TABLE public.events ENABLE TRIGGER issue_4420_withhold_event_location;
    PERFORM public.issue_4420_backfill_event_withheld_location();
  END IF;

  INSERT INTO public.orders(event_id, buyer_user_id, payment_status, source)
    VALUES ('44240000-0000-4000-8000-000000000e01', v_guest, 'paid', 'manual_import'),
           ('44240000-0000-4000-8000-000000000e02', v_guest, 'paid', 'manual_import'),
           ('44240000-0000-4000-8000-000000000e01', v_other, 'cancelled', 'manual_import');
END
$$;

-- ---------------------------------------------------------------------------
-- Observe every path as each caller.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t4420l_obs(who text, path text, k text, payload text);
GRANT ALL ON t4420l_obs TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.t4420l_observe(p_who text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  k text;
  v_id uuid;
BEGIN
  FOREACH k IN ARRAY ARRAY['hid', 'leg', 'vis'] LOOP
    v_id := CASE k WHEN 'hid' THEN '44240000-0000-4000-8000-000000000e01'::uuid
                   WHEN 'leg' THEN '44240000-0000-4000-8000-000000000e02'::uuid
                   ELSE '44240000-0000-4000-8000-000000000e03'::uuid END;
    -- The base relation's theme, as a client select.
    INSERT INTO pg_temp.t4420l_obs
      SELECT p_who, 'theme', k, e.theme::text FROM public.events e WHERE e.id = v_id;
    -- The theme as a search oracle: a WHERE on the street or the place id.
    INSERT INTO pg_temp.t4420l_obs
      SELECT p_who, 'filter', k, count(*)::text FROM public.events e
       WHERE e.id = v_id
         AND (e.theme::text LIKE '%Hidden Lane%' OR e.theme::text LIKE '%ChIJ4420%'
              OR e.theme #>> '{business_event,location,address}' LIKE '12 %');
    -- The public read paths.
    INSERT INTO pg_temp.t4420l_obs
      SELECT p_who, 'by_slug', k, public.pg_public_event_by_slug('i4420l-brand', 'i4420l-' || k)::text;
    INSERT INTO pg_temp.t4420l_obs
      SELECT p_who, 'public_view', k, v.theme::text FROM public.events_public_view v WHERE v.id = v_id;
    INSERT INTO pg_temp.t4420l_obs
      SELECT p_who, 'business_public_view', k, v.public_theme::text
        FROM public.business_public_events_view v WHERE v.id = v_id;
    IF current_user <> 'anon' THEN
      -- The Host editor's read model and the private store.
      INSERT INTO pg_temp.t4420l_obs
        SELECT p_who, 'management', k, m.management_theme::text
          FROM public.business_management_events_view m WHERE m.id = v_id;
      IF to_regclass('public.event_withheld_location') IS NOT NULL THEN
        EXECUTE format($q$INSERT INTO pg_temp.t4420l_obs
          SELECT %L, 'store', %L, COALESCE(json_agg(w.business_event)::text, '[]')
            FROM public.event_withheld_location w WHERE w.event_id = %L$q$, p_who, k, v_id);
      END IF;
    END IF;
  END LOOP;
END
$$;

SET LOCAL ROLE anon;
SELECT pg_temp.t4420l_observe('anon');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a4', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a4', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420l_observe('other');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a1', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420l_observe('owner');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a2', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a2', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420l_observe('team');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a3', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a3', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t4420l_observe('guest');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);

-- A-* / U-*: anon and the signed-in caller who did not book.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM t4420l_obs
            WHERE who IN ('anon', 'other') AND k IN ('hid', 'leg')
              AND path IN ('theme', 'by_slug', 'public_view', 'business_public_view', 'management', 'store')
  LOOP
    PERFORM pg_temp.t4420l_check(NOT pg_temp.t4420l_leaks(r.payload),
      format('%s %s %s leaks the exact location: %s', CASE r.who WHEN 'anon' THEN 'A' ELSE 'U' END,
             r.path, r.k, left(r.payload, 400)));
  END LOOP;
  FOR r IN SELECT * FROM t4420l_obs WHERE who IN ('anon', 'other') AND k IN ('hid', 'leg') AND path = 'filter' LOOP
    PERFORM pg_temp.t4420l_check(r.payload = '0',
      format('%s-FILTER %s a WHERE on events.theme finds the hidden street or place id (%s row)',
             CASE r.who WHEN 'anon' THEN 'A' ELSE 'U' END, r.k, r.payload));
  END LOOP;
  -- The host draft blob is never readable on a published row, hidden or not.
  FOR r IN SELECT * FROM t4420l_obs WHERE who IN ('anon', 'other') AND path = 'theme' LOOP
    PERFORM pg_temp.t4420l_check(NOT (r.payload::jsonb ? 'business_draft'),
      format('%s-DRAFT %s events.theme carries the host draft blob',
             CASE r.who WHEN 'anon' THEN 'A' ELSE 'U' END, r.k));
  END LOOP;
  -- The public bits stay: venue name and the hide flag.
  PERFORM pg_temp.t4420l_check(
    (SELECT payload::jsonb #>> '{business_event,location,venueName}' FROM t4420l_obs
      WHERE who = 'anon' AND path = 'theme' AND k = 'hid') = 'Loft Hall'
    AND (SELECT payload::jsonb #>> '{business_event,hideAddressUntilTicket}' FROM t4420l_obs
      WHERE who = 'anon' AND path = 'theme' AND k = 'hid') = 'true',
    'A-PUBLIC a hidden event keeps its venue name and hide flag in theme');
  PERFORM pg_temp.t4420l_check(
    (SELECT payload FROM t4420l_obs WHERE who = 'other' AND path = 'store' AND k = 'hid') IS NOT DISTINCT FROM '[]'
    OR (SELECT payload FROM t4420l_obs WHERE who = 'other' AND path = 'store' AND k = 'hid') IS NULL,
    'U-STORE a signed-in caller who did not book reads no private location row');
END
$$;

-- O-* / T-* / B-*: the owner, a team member and a booked guest read the exact location.
DO $$
DECLARE
  w text;
  v_k text;
BEGIN
  FOREACH w IN ARRAY ARRAY['owner', 'team', 'guest'] LOOP
    FOREACH v_k IN ARRAY ARRAY['hid', 'leg'] LOOP
      PERFORM pg_temp.t4420l_check(
        (SELECT payload::jsonb #>> '{business_event,location,address}' FROM t4420l_obs o
          WHERE who = w AND path = 'management' AND o.k = v_k) = '12 Hidden Lane, New York, NY 10005, USA'
        AND (SELECT payload::jsonb #>> '{business_event,locationProviderPlaceId}' FROM t4420l_obs o
          WHERE who = w AND path = 'management' AND o.k = v_k) = 'ChIJ4420placeid',
        format('%s-MANAGEMENT %s the %s reads the street and place id in management_theme',
               upper(left(w, 1)), v_k, w));
      PERFORM pg_temp.t4420l_check(
        (SELECT payload FROM t4420l_obs o WHERE who = w AND path = 'store' AND o.k = v_k) LIKE '%Hidden Lane%',
        format('%s-STORE %s the %s reads the private location row', upper(left(w, 1)), v_k, w));
    END LOOP;
  END LOOP;
END
$$;

-- V-*: a visible address is unchanged everywhere.
SELECT pg_temp.t4420l_check(
  (SELECT payload::jsonb #>> '{business_event,location,address}' FROM t4420l_obs
    WHERE who = 'anon' AND path = 'theme' AND k = 'vis') = '12 Hidden Lane, New York, NY 10005, USA'
  AND (SELECT payload::jsonb #>> '{business_event,locationProviderPlaceId}' FROM t4420l_obs
    WHERE who = 'anon' AND path = 'theme' AND k = 'vis') = 'ChIJ4420placeid',
  'V-THEME a visible event keeps its street and place id in theme');
SELECT pg_temp.t4420l_check(
  (SELECT payload::json ->> 'address' FROM t4420l_obs WHERE who = 'anon' AND path = 'by_slug' AND k = 'vis')
    = '12 Hidden Lane, New York, NY 10005, USA',
  'V-SLUG a visible event''s public page still shows its street');

-- ---------------------------------------------------------------------------
-- H-*: the Host editor round trip on a hidden event, through the live-edit RPC the app
-- calls (business_update_live_event_atomic) and the read model it loads from.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t4420l_save(step text, response jsonb);
GRANT ALL ON t4420l_save TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a1', true);
SET LOCAL ROLE authenticated;
-- 1. Rename the venue only: the stored street must survive the save.
INSERT INTO t4420l_save SELECT 'venue', public.business_update_live_event_atomic(
  '44240000-0000-4000-8000-000000000e01',
  jsonb_build_object('core', jsonb_build_object('venueName', 'Renamed Hall')),
  'Renaming the venue for guests', 1);
RESET ROLE;

SELECT pg_temp.t4420l_check(
  (SELECT e.location_text FROM public.events e WHERE e.id = '44240000-0000-4000-8000-000000000e01')
    = 'Renamed Hall · 12 Hidden Lane, New York, NY 10005, USA',
  'H-LABEL a venue-only save keeps the street in the location label, got '
  || COALESCE((SELECT e.location_text FROM public.events e WHERE e.id = '44240000-0000-4000-8000-000000000e01'), 'NULL'));
SELECT pg_temp.t4420l_check(
  (SELECT response #>> '{event,theme,business_event,location,address}' FROM t4420l_save WHERE step = 'venue')
    = '12 Hidden Lane, New York, NY 10005, USA',
  'H-RESPONSE the save response gives the host the street');

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a1', true);
SET LOCAL ROLE authenticated;
INSERT INTO t4420l_obs SELECT 'owner', 'reload1', 'hid', m.management_theme::text
  FROM public.business_management_events_view m WHERE m.id = '44240000-0000-4000-8000-000000000e01';
-- 2. Edit the street.
INSERT INTO t4420l_save SELECT 'street', public.business_update_live_event_atomic(
  '44240000-0000-4000-8000-000000000e01',
  jsonb_build_object('core', jsonb_build_object('venueName', 'Renamed Hall', 'address', '98 Hidden Lane, New York, NY 10006, USA')),
  'Moving to the new address', 2);
INSERT INTO t4420l_obs SELECT 'owner', 'reload2', 'hid', m.management_theme::text
  FROM public.business_management_events_view m WHERE m.id = '44240000-0000-4000-8000-000000000e01';
RESET ROLE;

SELECT pg_temp.t4420l_check(
  (SELECT payload::jsonb #>> '{business_event,location,address}' FROM t4420l_obs WHERE path = 'reload1')
    = '12 Hidden Lane, New York, NY 10005, USA'
  AND (SELECT payload::jsonb #>> '{business_event,location,venueName}' FROM t4420l_obs WHERE path = 'reload1')
    = 'Renamed Hall',
  'H-RELOAD1 reopening after a venue-only save shows the new venue and the same street');
SELECT pg_temp.t4420l_check(
  (SELECT payload::jsonb #>> '{business_event,location,address}' FROM t4420l_obs WHERE path = 'reload2')
    = '98 Hidden Lane, New York, NY 10006, USA',
  'H-RELOAD2 reopening after a street edit shows the new street');
SELECT pg_temp.t4420l_check(
  NOT pg_temp.t4420l_leaks((SELECT e.theme::text FROM public.events e WHERE e.id = '44240000-0000-4000-8000-000000000e01')),
  'H-STORED the saved theme of a hidden event still stores no street');

-- N-*: the guest notice snapshot still sees the real street (an address change notifies).
SELECT pg_temp.t4420l_check(
  (public.business_event_notice_snapshot('44240000-0000-4000-8000-000000000e01') ->> 'address_fp')
    = md5('98 Hidden Lane, New York, NY 10006, USA'),
  'N-SNAPSHOT the edit-notice snapshot fingerprints the real street');

-- 3. Show the address: the street returns to the public theme. 4. Hide it again.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a1', true);
SET LOCAL ROLE authenticated;
SELECT public.business_update_live_event_atomic('44240000-0000-4000-8000-000000000e01',
  jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', false)),
  'Showing the address to everyone', 3) IS NOT NULL;
RESET ROLE;
SET LOCAL ROLE anon;
INSERT INTO t4420l_obs SELECT 'anon', 'shown', 'hid', e.theme::text
  FROM public.events e WHERE e.id = '44240000-0000-4000-8000-000000000e01';
RESET ROLE;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a1', true);
SET LOCAL ROLE authenticated;
SELECT public.business_update_live_event_atomic('44240000-0000-4000-8000-000000000e01',
  jsonb_build_object('core', jsonb_build_object('hideAddressUntilTicket', true)),
  'Hiding the address until booking', 4) IS NOT NULL;
RESET ROLE;
SET LOCAL ROLE anon;
INSERT INTO t4420l_obs SELECT 'anon', 'rehidden', 'hid', e.theme::text
  FROM public.events e WHERE e.id = '44240000-0000-4000-8000-000000000e01';
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);

SELECT pg_temp.t4420l_check(
  (SELECT payload::jsonb #>> '{business_event,location,address}' FROM t4420l_obs WHERE path = 'shown')
    = '98 Hidden Lane, New York, NY 10006, USA',
  'H-SHOW showing the address puts the street back in the public theme');
SELECT pg_temp.t4420l_check(
  NOT pg_temp.t4420l_leaks((SELECT payload FROM t4420l_obs WHERE path = 'rehidden')),
  'H-HIDE hiding it again takes the street out of the public theme');

-- D-*: duplicating a hidden event (the unpublish path builds the same draft) keeps the
-- street: the draft's location is the stored label, as before this change (#3827).
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '44240000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true),
  set_config('request.jwt.claim.sub', '44240000-0000-4000-8000-0000000000a1', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE t4420l_dup AS
  SELECT public.business_duplicate_event_as_draft('44240000-0000-4000-8000-000000000e02') AS r;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.t4420l_check(
  (SELECT e.theme #>> '{business_draft,location,venueName}' FROM public.events e
    WHERE e.id = (SELECT (r #>> '{event,id}')::uuid FROM t4420l_dup))
    = 'Loft Hall · 12 Hidden Lane, New York, NY 10005, USA'
  AND NOT ((SELECT e.theme FROM public.events e
    WHERE e.id = (SELECT (r #>> '{event,id}')::uuid FROM t4420l_dup))::text LIKE '%Draft Street%'),
  'D-DUPLICATE a duplicate of a hidden event keeps the street and not the stale draft blob');

-- G-*: grants.
SELECT pg_temp.t4420l_check(
  to_regclass('public.event_withheld_location') IS NOT NULL
  AND NOT has_table_privilege('anon', 'public.event_withheld_location', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_withheld_location', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_withheld_location', 'UPDATE')
  AND has_table_privilege('service_role', 'public.event_withheld_location', 'SELECT'),
  'G-STORE the private location table is closed to anon and read-only to signed-in callers');
SELECT pg_temp.t4420l_check(
  to_regprocedure('public.issue_4420_event_theme_full(uuid,jsonb)') IS NOT NULL
  AND NOT has_function_privilege('anon', 'public.issue_4420_event_theme_full(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4420_event_theme_full(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4420_event_theme_for_caller(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4420_backfill_event_withheld_location()', 'EXECUTE'),
  'G-HELPERS the #4420 location helpers are not callable by anon (the merge without a check by no client)');

DO $$
DECLARE v_failures text := NULLIF(current_setting('t4420l.failures', true), '');
BEGIN
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'I-4420-EVENT-LOCATION-FOLLOWS-ADDRESS-RULE failed:%', v_failures;
  END IF;
  RAISE NOTICE 'I-4420-EVENT-LOCATION-FOLLOWS-ADDRESS-RULE: PASS';
END
$$;

ROLLBACK;
