\set ON_ERROR_STOP on
-- #4453 milestone 5, tester's adversarial proof of the live booking reads
-- (20280807044453, 20280807054453). A different angle from the implementor's
-- suites: rooms already BOOKED or HELD (sellable_quantity is the room-night's
-- total, not what is left), one stay flag off on a REAL live room, a venue
-- with no or a broken timezone (UTC), and a key and value scan of every
-- answer for guest or staff data. BEGIN ... ROLLBACK: every fixture, the
-- dropped foreign keys and the disabled scope guards roll back.
-- MINGLA-INVARIANT: I-SITES-BOOKING-FACTS-FROM-MINGLA | issue #4453 | a night a site shows as open, and the number left, are what Mingla's own quote would still sell (sellable minus live holds and live commitments).
--
-- A-1  a night whose every unit is committed is FULL with no link.
-- A-2  a night with 3 of 4 units committed or held shows 1 left ("few").
-- A-3  a released commitment and an expired hold do not count.
-- A-4  one stay flag off: a real live room answers NULL (nights and target).
-- A-5  a venue with no availability config reads in UTC; an unknown zone falls back to UTC.
-- A-6  no answer carries an email, phone, user id or reviewer field.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 booking reads (tester) FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- Every key anywhere in a jsonb value.
CREATE OR REPLACE FUNCTION pg_temp.p_keys(p jsonb) RETURNS SETOF text LANGUAGE sql AS $k$
  WITH RECURSIVE walk(v) AS (
    SELECT p
    UNION ALL
    SELECT c FROM walk, LATERAL (
      SELECT e.value FROM jsonb_each(CASE WHEN jsonb_typeof(walk.v) = 'object' THEN walk.v ELSE '{}'::jsonb END) e
      UNION ALL
      SELECT a FROM jsonb_array_elements(CASE WHEN jsonb_typeof(walk.v) = 'array' THEN walk.v ELSE '[]'::jsonb END) a
    ) AS x(c)
  )
  SELECT DISTINCT e.key FROM walk, jsonb_each(CASE WHEN jsonb_typeof(walk.v) = 'object' THEN walk.v ELSE '{}'::jsonb END) e;
$k$;

UPDATE public.feature_flags SET is_enabled = true WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES');

-- The proof writes holds and commitments without building a whole paid
-- reservation: inside this transaction only, their foreign keys to the
-- reservation tables and their scope guards are set aside (rolled back).
ALTER TABLE public.stay_inventory_commitments
  DROP CONSTRAINT stay_inventory_commitments_group_id_fkey,
  DROP CONSTRAINT stay_inventory_commitments_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_commitments DISABLE TRIGGER stay_inventory_commitments_scope_guard;
ALTER TABLE public.stay_inventory_holds DROP CONSTRAINT stay_inventory_holds_group_id_fkey;
ALTER TABLE public.stay_inventory_holds DISABLE TRIGGER stay_inventory_holds_scope_guard;
ALTER TABLE public.stay_inventory_hold_slices DROP CONSTRAINT stay_inventory_hold_slices_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_hold_slices DISABLE TRIGGER stay_inventory_hold_slices_scope_guard;

CREATE TEMP TABLE t5 (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO t5 VALUES ('owner', gen_random_uuid()), ('brand', gen_random_uuid()), ('site', gen_random_uuid()),
  ('venue', gen_random_uuid()), ('room', gen_random_uuid()), ('kitchen', gen_random_uuid()), ('kitchen_bad', gen_random_uuid()),
  ('hold', gen_random_uuid()), ('hold_old', gen_random_uuid());

-- The slot engine is CALLED, never changed. For this proof only (rolled
-- back), a stand-in: 18:00 UTC with 5 left, every day.
-- [TEST-MOD-APPROVED #4490] #4490 (20281203164490, carried by
-- 20281203214490) added a fifth parameter, p_space_id uuid DEFAULT NULL, to
-- the engine (a floor/space filter for table slots). The stand-in keeps the
-- engine's exact signature, so it replaces the engine instead of adding a
-- second overload that makes named calls ambiguous.
CREATE OR REPLACE FUNCTION public.pg_venue_available_slots(
  p_date date, p_party_size int, p_venue_id uuid DEFAULT NULL, p_brand_id uuid DEFAULT NULL,
  p_space_id uuid DEFAULT NULL)
RETURNS TABLE (slot_start_utc timestamptz, slot_local_label text, remaining int, is_full boolean)
LANGUAGE sql STABLE AS $stub$
  SELECT ((p_date + time '18:00') AT TIME ZONE 'UTC'), '18:00', 5, false;
$stub$;

DO $fixture$
DECLARE
  v_owner uuid := (SELECT v FROM t5 WHERE k = 'owner');
  v_brand uuid := (SELECT v FROM t5 WHERE k = 'brand');
  v_venue uuid := (SELECT v FROM t5 WHERE k = 'venue');
  v_room uuid := (SELECT v FROM t5 WHERE k = 'room');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_i integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 't5-owner@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, contact_email, contact_phone)
  VALUES (v_brand, v_owner, 'T5 Lagoon', 't5-lagoon', 'NGN', 'owner-private@4453.invalid', '+2348000004453');
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES ((SELECT v FROM t5 WHERE k = 'site'), v_brand, 'provisioning', v_owner);
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
    (v_venue, v_brand, 't5stay', 'T5 Stay', 6.45, 3.47, 'stay', 'verified'),
    ((SELECT v FROM t5 WHERE k = 'kitchen'), v_brand, 't5kitchen', 'T5 Kitchen', 6.45, 3.47, 'restaurant', 'verified'),
    ((SELECT v FROM t5 WHERE k = 'kitchen_bad'), v_brand, 't5kitchenbad', 'T5 Kitchen Bad Zone', 6.45, 3.47, 'restaurant', 'verified');
  INSERT INTO public.venue_reservation_settings(brand_id, venue_id, reservations_enabled) VALUES
    (v_brand, (SELECT v FROM t5 WHERE k = 'kitchen'), true), (v_brand, (SELECT v FROM t5 WHERE k = 'kitchen_bad'), true);
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state)
  VALUES (v_venue, v_brand, 'resort', 'Africa/Lagos', 'instant', 'active');
  INSERT INTO public.stay_offerings(id, venue_id, brand_id, kind, name, summary, status, confirmation_mode,
      inventory_basis, unit_naming_mode, quantity, min_guests, max_guests, max_adults, max_children)
  VALUES (v_room, v_venue, v_brand, 'room', 'T5 Room', 'Four rooms on the water.', 'live', 'instant', 'pooled_units', 'interchangeable', 4, 1, 4, 4, 2);
  INSERT INTO public.stay_price_versions(offering_id, brand_id, venue_id, version_number, amount_minor, currency_code, pricing_unit)
  VALUES (v_room, v_brand, v_venue, 1, 12500000, 'NGN', 'room_night');
  FOR v_i IN 0..6 LOOP
    INSERT INTO public.stay_room_nights(offering_id, local_date, brand_id, venue_id, sellable_quantity, stop_sell, minimum_nights)
    VALUES (v_room, v_today + v_i, v_brand, v_venue, 4, false, 1)
    ON CONFLICT (offering_id, local_date) DO UPDATE SET sellable_quantity = 4, stop_sell = false, minimum_nights = 1,
      price_override_minor = NULL, currency_code = NULL;
  END LOOP;
  -- Night 0: all four units committed (booked). Night 1: two committed plus
  -- one held (live hold). Night 2: a released commitment and an expired hold
  -- (neither counts).
  INSERT INTO public.stay_inventory_commitments(group_id, reservation_line_id, resource_type, offering_id, room_date, quantity, state, released_at)
  VALUES (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today, 4, 'active', NULL),
         (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 1, 2, 'active', NULL),
         (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 2, 4, 'released', now());
  INSERT INTO public.stay_inventory_holds(id, group_id, state, expires_at) VALUES
    ((SELECT v FROM t5 WHERE k = 'hold'), gen_random_uuid(), 'active', now() + interval '10 minutes'),
    ((SELECT v FROM t5 WHERE k = 'hold_old'), gen_random_uuid(), 'active', now() - interval '10 minutes');
  INSERT INTO public.stay_inventory_hold_slices(hold_id, reservation_line_id, resource_type, offering_id, room_date, quantity) VALUES
    ((SELECT v FROM t5 WHERE k = 'hold'), gen_random_uuid(), 'room_night', v_room, v_today + 1, 1),
    ((SELECT v FROM t5 WHERE k = 'hold_old'), gen_random_uuid(), 'room_night', v_room, v_today + 2, 4);
END
$fixture$;

DO $a$
DECLARE
  v_site uuid := (SELECT v FROM t5 WHERE k = 'site');
  v_room uuid := (SELECT v FROM t5 WHERE k = 'room');
  v_feed jsonb := public.brand_site_stay_nights(v_site, v_room, 7);
  v_night0 jsonb := v_feed->'days'->0->'slots'->0;
  v_night1 jsonb := v_feed->'days'->1->'slots'->0;
  v_night2 jsonb := v_feed->'days'->2->'slots'->0;
BEGIN
  PERFORM pg_temp.p_assert(v_feed IS NOT NULL AND jsonb_array_length(v_feed->'days') = 7, 'A-0 the room answers seven nights');
  PERFORM pg_temp.p_assert(v_night0->>'state' = 'full' AND v_night0->'href' = 'null'::jsonb AND (v_night0->>'left')::int = 0,
    'A-1 a night whose every unit is booked is full, with no link (got ' || v_night0::text || ')');
  PERFORM pg_temp.p_assert(v_night1->>'state' = 'few' AND (v_night1->>'left')::int = 1,
    'A-2 two booked and one held of four: 1 left, few (got ' || v_night1::text || ')');
  PERFORM pg_temp.p_assert(v_night2->>'state' = 'open' AND (v_night2->>'left')::int = 4,
    'A-3 a released booking and an expired hold do not count (got ' || v_night2::text || ')');
END
$a$;

-- A-4 one stay flag off, on a REAL live room
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'STAY_RESERVE_WRITES';
SELECT pg_temp.p_assert(public.brand_site_stay_nights((SELECT v FROM t5 WHERE k = 'site'), (SELECT v FROM t5 WHERE k = 'room'), 7) IS NULL
  AND public.brand_site_booking_target((SELECT v FROM t5 WHERE k = 'site'), 'stay', (SELECT v FROM t5 WHERE k = 'room')) IS NULL,
  'A-4 STAY_RESERVE_WRITES off: a live room answers no nights and no target');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'STAY_RESERVE_WRITES';

-- A-5 UTC
DO $utc$
DECLARE
  v_site uuid := (SELECT v FROM t5 WHERE k = 'site');
  v_today text := to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD');
  v_none jsonb := public.brand_site_venue_slots(v_site, (SELECT v FROM t5 WHERE k = 'kitchen'), 2, 3);
BEGIN
  PERFORM pg_temp.p_assert(v_none->>'timezone' = 'UTC' AND v_none->'days'->0->>'local_date' = v_today
    AND v_none->'days'->0->'slots'->0->>'start_local' = v_today || 'T18:00'
    AND v_none->'days'->0->'slots'->0->>'href' LIKE '%&time=18:00&party=2',
    'A-5a no availability config: the venue reads in UTC, at UTC wall time');
  PERFORM pg_temp.p_assert(public.brand_site_booking_target(v_site, 'venue_table', (SELECT v FROM t5 WHERE k = 'kitchen'))->>'timezone' = 'UTC'
    AND public.brand_site_zone_or_utc('Mars/Olympus_Mons') = 'UTC' AND public.brand_site_zone_or_utc('  ') = 'UTC'
    AND public.brand_site_zone_or_utc(' Africa/Lagos ') = 'Africa/Lagos',
    'A-5b its hero target is in UTC; an unknown or blank zone reads UTC (unknown zones cannot be stored: venue_availability_config refuses them)');
END
$utc$;

-- A-6 no guest, owner or staff data in any answer
DO $pii$
DECLARE
  v_site uuid := (SELECT v FROM t5 WHERE k = 'site');
  v_all jsonb := jsonb_build_array(
    public.brand_site_stay_nights(v_site, (SELECT v FROM t5 WHERE k = 'room'), 7),
    public.brand_site_booking_target(v_site, 'stay', (SELECT v FROM t5 WHERE k = 'room')),
    public.brand_site_venue_slots(v_site, (SELECT v FROM t5 WHERE k = 'kitchen'), 2, 3),
    public.brand_site_booking_target(v_site, 'venue_table', (SELECT v FROM t5 WHERE k = 'kitchen')),
    public.brand_site_offerings_feed(v_site));
  v_bad text[];
BEGIN
  SELECT array_agg(k) INTO v_bad FROM pg_temp.p_keys(v_all) k
  WHERE k ~* '(email|phone|user|guest|owner|account|staff|reviewer|created_by|token|secret|password)';
  PERFORM pg_temp.p_assert(v_bad IS NULL, 'A-6a no answer has a guest, owner or staff field (found ' || COALESCE(array_to_string(v_bad, ','), '') || ')');
  PERFORM pg_temp.p_assert(position('4453.invalid' in v_all::text) = 0 AND position('2348000004453' in v_all::text) = 0,
    'A-6b the brand''s private email and phone never appear');
END
$pii$;

ROLLBACK;
