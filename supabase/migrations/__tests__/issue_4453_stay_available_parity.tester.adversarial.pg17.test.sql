\set ON_ERROR_STOP on
-- #4453 milestone 5, tester's money guard for the extracted rooms-left read
-- (stay_room_night_available, 20280726004453). BEGIN ... ROLLBACK.
-- MINGLA-INVARIANT: I-SITES-STAY-AVAILABLE-READ-ONLY | issue #4453 | stay_room_night_available is a website read: no quote, hold, booking or inventory function calls it, and its rooms-left agrees night for night with the availability rule Mingla already sells by.
--
-- P-1  only the website reads call it (the quote, group creation, staff
--      booking, inventory management and discovery do not), so extracting it
--      cannot change a price, a total, a hold or a refusal.
-- P-2  parity: across partly booked, fully booked, live-held, expired-hold,
--      reconciliation-held, released and stop-sell nights, for every check-in,
--      every stay of 1 to 3 nights and 1 to 4 rooms, "every night has at
--      least N rooms left" (stay_room_night_available) equals Mingla's own
--      discover_v2_stay_room_available answer.
-- P-3  stop-sell reads 0; a night with no row reads NULL (never invented).

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 stay available parity (tester) FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- P-1 the read is reached only from the website reads
SELECT pg_temp.p_assert(
  (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname <> 'stay_room_night_available' AND p.prosrc ~ '\mstay_room_night_available\M')
  -- brand_site_offerings_feed_for_brand (#4453 M10) holds the site feed's one body; its rooms-left
  -- read is proven equal to Mingla's own sell rule in issue_4453_plan_preview_feed.implementor (T-8).
  <@ ARRAY['brand_site_booking_target', 'brand_site_offerings_feed', 'brand_site_offerings_feed_for_brand', 'brand_site_stay_nights']::text[]
  AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc ~ '\mstay_room_night_available\M'
      AND p.proname ~ '^(issue_1388_|issue_4188_|biz_manage_stay_|discover_v2_|issue_1387_|issue_1389_)'),
  'P-1 no quote, booking, hold, inventory or discovery function calls stay_room_night_available');
SELECT pg_temp.p_assert(NOT has_function_privilege('anon', 'public.stay_room_night_available(uuid,date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.stay_room_night_available(uuid,date)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.stay_room_night_available(uuid,date)', 'EXECUTE'),
  'P-1b service role only');

-- Holds and commitments without a whole paid reservation: their reservation
-- foreign keys and scope guards are set aside inside this transaction only.
ALTER TABLE public.stay_inventory_commitments
  DROP CONSTRAINT stay_inventory_commitments_group_id_fkey,
  DROP CONSTRAINT stay_inventory_commitments_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_commitments DISABLE TRIGGER stay_inventory_commitments_scope_guard;
ALTER TABLE public.stay_inventory_holds DROP CONSTRAINT stay_inventory_holds_group_id_fkey;
ALTER TABLE public.stay_inventory_holds DISABLE TRIGGER stay_inventory_holds_scope_guard;
ALTER TABLE public.stay_inventory_hold_slices DROP CONSTRAINT stay_inventory_hold_slices_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_hold_slices DISABLE TRIGGER stay_inventory_hold_slices_scope_guard;

CREATE TEMP TABLE pv (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO pv VALUES ('owner', gen_random_uuid()), ('brand', gen_random_uuid()), ('venue', gen_random_uuid()), ('room', gen_random_uuid());

DO $fixture$
DECLARE
  v_owner uuid := (SELECT v FROM pv WHERE k = 'owner');
  v_brand uuid := (SELECT v FROM pv WHERE k = 'brand');
  v_venue uuid := (SELECT v FROM pv WHERE k = 'venue');
  v_room uuid := (SELECT v FROM pv WHERE k = 'room');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_i integer;
  v_hold uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'pv-owner@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES (v_brand, v_owner, 'PV Lagoon', 'pv-lagoon', 'NGN');
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status)
  VALUES (v_venue, v_brand, 'pvstay', 'PV Stay', 6.45, 3.47, 'stay', 'verified');
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state)
  VALUES (v_venue, v_brand, 'resort', 'Africa/Lagos', 'instant', 'active');
  INSERT INTO public.stay_offerings(id, venue_id, brand_id, kind, name, summary, status, confirmation_mode,
      inventory_basis, unit_naming_mode, quantity, min_guests, max_guests, max_adults, max_children)
  VALUES (v_room, v_venue, v_brand, 'room', 'PV Room', 'Four rooms.', 'live', 'instant', 'pooled_units', 'interchangeable', 4, 1, 4, 4, 2);
  UPDATE public.stay_offerings SET min_notice_minutes = 0 WHERE id = v_room;
  FOR v_i IN 0..11 LOOP
    INSERT INTO public.stay_room_nights(offering_id, local_date, brand_id, venue_id, sellable_quantity, stop_sell, minimum_nights)
    VALUES (v_room, v_today + v_i, v_brand, v_venue, 4, v_i = 7, 1)
    ON CONFLICT (offering_id, local_date) DO UPDATE SET sellable_quantity = 4, stop_sell = (v_i = 7), minimum_nights = 1,
      maximum_nights = NULL, price_override_minor = NULL, currency_code = NULL;
  END LOOP;
  -- Night +2 partly booked (1 of 4); +3 fully booked; +4 two booked and one live hold;
  -- +5 an expired hold of 4 and a released booking of 4 (neither counts);
  -- +6 a reconciliation hold of 3; +7 stop-sell; +8 three booked.
  INSERT INTO public.stay_inventory_commitments(group_id, reservation_line_id, resource_type, offering_id, room_date, quantity, state, released_at) VALUES
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 2, 1, 'active', NULL),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 3, 4, 'active', NULL),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 4, 2, 'active', NULL),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 5, 4, 'released', now()),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 8, 3, 'active', NULL);
  FOR v_i IN 1..3 LOOP
    v_hold := gen_random_uuid();
    INSERT INTO public.stay_inventory_holds(id, group_id, state, expires_at)
    VALUES (v_hold, gen_random_uuid(),
      CASE v_i WHEN 3 THEN 'reconciliation_required' ELSE 'active' END,
      CASE v_i WHEN 2 THEN now() - interval '5 minutes' ELSE now() + interval '10 minutes' END);
    INSERT INTO public.stay_inventory_hold_slices(hold_id, reservation_line_id, resource_type, offering_id, room_date, quantity)
    VALUES (v_hold, gen_random_uuid(), 'room_night', v_room,
      v_today + CASE v_i WHEN 1 THEN 4 WHEN 2 THEN 5 ELSE 6 END,
      CASE v_i WHEN 1 THEN 1 WHEN 2 THEN 4 ELSE 3 END);
  END LOOP;
END
$fixture$;

-- P-3 stop-sell and a missing night
SELECT pg_temp.p_assert(
  public.stay_room_night_available((SELECT v FROM pv WHERE k = 'room'), (now() AT TIME ZONE 'Africa/Lagos')::date + 7) = 0
  AND public.stay_room_night_available((SELECT v FROM pv WHERE k = 'room'), (now() AT TIME ZONE 'Africa/Lagos')::date + 40) IS NULL
  AND (SELECT array_agg(public.stay_room_night_available((SELECT v FROM pv WHERE k = 'room'), (now() AT TIME ZONE 'Africa/Lagos')::date + i) ORDER BY i)
       FROM generate_series(2, 8) i) = ARRAY[3, 0, 1, 4, 1, 0, 1],
  'P-3 rooms left per night: partly 3, full 0, booked+held 1, expired/released 4, reconciliation 1, stop-sell 0, 1; missing night NULL');

-- P-2 parity with the availability rule Mingla sells by
DO $parity$
DECLARE
  v_room uuid := (SELECT v FROM pv WHERE k = 'room');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_in integer; v_len integer; v_rooms integer;
  v_mingla boolean; v_site boolean; v_cases integer := 0; v_open integer := 0;
BEGIN
  FOR v_in IN 1..9 LOOP
    FOR v_len IN 1..3 LOOP
      FOR v_rooms IN 1..4 LOOP
        v_mingla := public.discover_v2_stay_room_available(v_room, v_today + v_in, v_today + v_in + v_len, v_rooms);
        SELECT bool_and(COALESCE(public.stay_room_night_available(v_room, v_today + v_in + d), -1) >= v_rooms) INTO v_site
        FROM generate_series(0, v_len - 1) d;
        IF v_mingla IS DISTINCT FROM v_site THEN
          RAISE EXCEPTION 'issue #4453 stay available parity (tester) FAIL: P-2 check-in +% for % nights, % rooms: Mingla says %, the site read says %',
            v_in, v_len, v_rooms, v_mingla, v_site;
        END IF;
        v_cases := v_cases + 1;
        IF v_mingla THEN v_open := v_open + 1; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.p_assert(v_cases = 108 AND v_open > 0 AND v_open < v_cases,
    format('P-2 parity on all %s stays (%s bookable, %s refused)', v_cases, v_open, v_cases - v_open));
END
$parity$;

ROLLBACK;
