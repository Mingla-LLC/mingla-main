\set ON_ERROR_STOP on
-- #4453 milestone 5: executable PostgreSQL 17 proof of the stay feed kind
-- (20280726014453) and the nights read (20280726004453). BEGIN ... ROLLBACK.
-- MINGLA-INVARIANT: I-SITES-STAY-ROWS-NEED-STAY-FLAGS | issue #4453 | the Sites feed carries stay rows, and the nights read answers, only while STAY_PUBLIC_PAGES and STAY_RESERVE_WRITES are on.
--
-- T-1  the feed stays service-role only.
-- T-2  SC-B6 flags on: the live room is a `stay` row linking to /b/{brand}/v/{venue}?tab=stay&room={id};
--      "from" is the lowest sellable night; a draft room and another brand's room are not there.
-- T-3  SC-B6 either stay flag off: no stay rows (trips, events and experiences unchanged).
-- T-4  nights: one slot per sellable night in the window (the room's zone), the night's own price,
--      stop-sell and sold-out nights are text (no link), checkout = check-in + minimum nights; no total.
--
-- T-5  P1-1 rooms LEFT, never the night's total: partly booked (2 of 4 booked + 1 held -> 1 left, few),
--      fully booked (full, no link), blocked (stop-sell: full), a released booking and an expired hold
--      do not count; the "from" price and the stay target skip a night with no room left.
--
-- FAILS-ON-REVERT: drop 20280726014453 -> T-2 (no stay rows); drop brand_site_stay_flags_on() from the feed -> T-3.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 stay feed FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

SELECT pg_temp.p_assert(NOT has_function_privilege('anon', 'public.brand_site_offerings_feed(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.brand_site_offerings_feed(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.brand_site_offerings_feed(uuid)', 'EXECUTE'),
  'T-1 the feed is service-role only');

UPDATE public.feature_flags SET is_enabled = true WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES');

CREATE TEMP TABLE m5s (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO m5s VALUES ('owner', gen_random_uuid()), ('brand', gen_random_uuid()), ('other', gen_random_uuid()),
  ('site', gen_random_uuid()), ('venue', gen_random_uuid()), ('venue_other', gen_random_uuid()),
  ('room', gen_random_uuid()), ('draft', gen_random_uuid()), ('room_other', gen_random_uuid());

DO $fixture$
DECLARE
  v_owner uuid := (SELECT v FROM m5s WHERE k = 'owner');
  v_brand uuid := (SELECT v FROM m5s WHERE k = 'brand');
  v_other uuid := (SELECT v FROM m5s WHERE k = 'other');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_i integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'm5-stay@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'M5 Lagoon', 'm5-lagoon', 'NGN'), (v_other, v_owner, 'M5 Other', 'm5-other', 'NGN');
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES ((SELECT v FROM m5s WHERE k = 'site'), v_brand, 'provisioning', v_owner);
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
    ((SELECT v FROM m5s WHERE k = 'venue'), v_brand, 'lagoonstay', 'Lagoon Stay', 6.45, 3.47, 'stay', 'verified'),
    ((SELECT v FROM m5s WHERE k = 'venue_other'), v_other, 'otherstay', 'Other Stay', 6.46, 3.48, 'stay', 'verified');
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state) VALUES
    ((SELECT v FROM m5s WHERE k = 'venue'), v_brand, 'resort', 'Africa/Lagos', 'instant', 'active'),
    ((SELECT v FROM m5s WHERE k = 'venue_other'), v_other, 'resort', 'Africa/Lagos', 'instant', 'active');
  INSERT INTO public.stay_offerings(id, venue_id, brand_id, kind, name, summary, status, confirmation_mode,
      inventory_basis, unit_naming_mode, quantity, min_guests, max_guests, max_adults, max_children) VALUES
    ((SELECT v FROM m5s WHERE k = 'room'), (SELECT v FROM m5s WHERE k = 'venue'), v_brand, 'room', 'Lagoon Room', 'A quiet room on the water.', 'live', 'instant', 'pooled_units', 'interchangeable', 4, 1, 4, 4, 2),
    ((SELECT v FROM m5s WHERE k = 'draft'), (SELECT v FROM m5s WHERE k = 'venue'), v_brand, 'room', 'Draft Room', '', 'draft', 'instant', 'pooled_units', 'interchangeable', 1, 1, 2, 2, 1),
    ((SELECT v FROM m5s WHERE k = 'room_other'), (SELECT v FROM m5s WHERE k = 'venue_other'), v_other, 'room', 'Other Room', '', 'live', 'instant', 'pooled_units', 'interchangeable', 1, 1, 2, 2, 1);
  INSERT INTO public.stay_price_versions(offering_id, brand_id, venue_id, version_number, amount_minor, currency_code, pricing_unit)
  SELECT o.id, o.brand_id, o.venue_id, 1, 12500000, 'NGN', 'room_night' FROM public.stay_offerings o
  WHERE o.id IN ((SELECT v FROM m5s WHERE k = 'room'), (SELECT v FROM m5s WHERE k = 'draft'), (SELECT v FROM m5s WHERE k = 'room_other'));
  FOR v_i IN 0..9 LOOP
    INSERT INTO public.stay_room_nights(offering_id, local_date, brand_id, venue_id, sellable_quantity, price_override_minor, currency_code, stop_sell, minimum_nights)
    VALUES ((SELECT v FROM m5s WHERE k = 'room'), v_today + v_i, v_brand, (SELECT v FROM m5s WHERE k = 'venue'),
      CASE v_i WHEN 1 THEN 0 WHEN 2 THEN 2 ELSE 4 END,
      CASE WHEN v_i = 3 THEN 9900000 END, CASE WHEN v_i = 3 THEN 'NGN' END,
      v_i = 4, CASE WHEN v_i = 0 THEN 2 ELSE 1 END)
    ON CONFLICT (offering_id, local_date) DO UPDATE SET sellable_quantity = EXCLUDED.sellable_quantity,
      price_override_minor = EXCLUDED.price_override_minor, currency_code = EXCLUDED.currency_code,
      stop_sell = EXCLUDED.stop_sell, minimum_nights = EXCLUDED.minimum_nights;
  END LOOP;
END
$fixture$;

DO $t2$
DECLARE
  v_feed jsonb := public.brand_site_offerings_feed((SELECT v FROM m5s WHERE k = 'site'));
  v_row jsonb;
BEGIN
  SELECT o INTO v_row FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'kind' = 'stay';
  PERFORM pg_temp.p_assert((SELECT count(*) FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'kind' = 'stay') = 1
    AND v_row->>'title' = 'Lagoon Room' AND v_row->>'destination_text' = 'Lagoon Stay'
    AND v_row->>'public_url' = 'https://host.usemingla.com/b/m5-lagoon/v/lagoonstay?tab=stay&room=' || (SELECT v FROM m5s WHERE k = 'room'),
    'T-2a SC-B6 the live room is one stay row on the venue page''s stay tab (draft and other-brand rooms absent)');
  PERFORM pg_temp.p_assert((v_row->>'min_price_minor')::bigint = 9900000 AND v_row->>'currency' = 'NGN'
    AND v_row->>'status' = 'scheduled' AND v_row->'start_at' = 'null'::jsonb,
    'T-2b "from" is the lowest sellable night (the override), never a stay total');
END
$t2$;

UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'STAY_RESERVE_WRITES';
SELECT pg_temp.p_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_site_offerings_feed((SELECT v FROM m5s WHERE k = 'site'))->'offerings') o
  WHERE o->>'kind' = 'stay'), 'T-3 SC-B6 a stay flag off: no stay rows');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'STAY_RESERVE_WRITES';

DO $t4$
DECLARE
  v_site uuid := (SELECT v FROM m5s WHERE k = 'site');
  v_room uuid := (SELECT v FROM m5s WHERE k = 'room');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_feed jsonb := public.brand_site_stay_nights(v_site, v_room, 7);
  v_states text[];
BEGIN
  SELECT array_agg(d->'slots'->0->>'state' ORDER BY ord) INTO v_states FROM jsonb_array_elements(v_feed->'days') WITH ORDINALITY AS x(d, ord);
  PERFORM pg_temp.p_assert(v_feed->>'source' = 'stay_nights' AND v_feed->>'timezone' = 'Africa/Lagos'
    AND jsonb_array_length(v_feed->'days') = 7 AND v_states = ARRAY['open', 'full', 'few', 'open', 'full', 'open', 'open'],
    'T-4a one slot per night in the window: sold out and stop-sell nights are full, two left is few');
  PERFORM pg_temp.p_assert(v_feed->'days'->1->'slots'->0->'href' = 'null'::jsonb AND v_feed->'days'->4->'slots'->0->'href' = 'null'::jsonb
    AND v_feed->'days'->0->'slots'->0->>'href' = 'https://host.usemingla.com/b/m5-lagoon/v/lagoonstay?tab=stay&checkin='
      || to_char(v_today, 'YYYY-MM-DD') || '&checkout=' || to_char(v_today + 2, 'YYYY-MM-DD') || '&room=' || v_room,
    'T-4b full nights are text; an open night pre-fills check-in and check-out (its minimum nights) and the room');
  PERFORM pg_temp.p_assert((v_feed->'days'->3->'slots'->0->>'price_minor')::bigint = 9900000
    AND (v_feed->'days'->0->'slots'->0->>'price_minor')::bigint = 12500000,
    'T-4c each night''s own price (override, else the current price version)');
  PERFORM pg_temp.p_assert(public.brand_site_stay_nights(v_site, (SELECT v FROM m5s WHERE k = 'room_other'), 7) IS NULL
    AND public.brand_site_stay_nights(v_site, (SELECT v FROM m5s WHERE k = 'draft'), 7) IS NULL,
    'T-4d another brand''s room and a draft room are NULL');
  PERFORM pg_temp.p_assert((public.brand_site_booking_target(v_site, 'stay', v_room)->>'min_price_minor')::bigint = 9900000,
    'T-4e the stay target carries the lowest live night as its "from"');
END
$t4$;

-- T-5 writes holds and bookings without a whole paid reservation: inside this
-- transaction only, their reservation foreign keys and scope guards are set
-- aside (the tester's adversarial proof does the same; all rolled back).
ALTER TABLE public.stay_inventory_commitments
  DROP CONSTRAINT stay_inventory_commitments_group_id_fkey,
  DROP CONSTRAINT stay_inventory_commitments_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_commitments DISABLE TRIGGER stay_inventory_commitments_scope_guard;
ALTER TABLE public.stay_inventory_holds DROP CONSTRAINT stay_inventory_holds_group_id_fkey;
ALTER TABLE public.stay_inventory_holds DISABLE TRIGGER stay_inventory_holds_scope_guard;
ALTER TABLE public.stay_inventory_hold_slices DROP CONSTRAINT stay_inventory_hold_slices_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_hold_slices DISABLE TRIGGER stay_inventory_hold_slices_scope_guard;

DO $t5$
DECLARE
  v_site uuid := (SELECT v FROM m5s WHERE k = 'site');
  v_room uuid := (SELECT v FROM m5s WHERE k = 'room');
  v_brand uuid := (SELECT v FROM m5s WHERE k = 'brand');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_hold uuid := gen_random_uuid();
  v_old uuid := gen_random_uuid();
  v_feed jsonb;
  v_row jsonb;
BEGIN
  -- Night 0 (4 sellable, min 2 nights): fully booked. Night 5: 2 booked + 1 live hold.
  -- Night 6: a released booking and an expired hold only. Night 3 (the cheap override): fully booked.
  INSERT INTO public.stay_inventory_commitments(group_id, reservation_line_id, resource_type, offering_id, room_date, quantity, state, released_at) VALUES
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today, 4, 'active', NULL),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 5, 2, 'active', NULL),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 6, 4, 'released', now()),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 3, 4, 'active', NULL);
  INSERT INTO public.stay_inventory_holds(id, group_id, state, expires_at) VALUES
    (v_hold, gen_random_uuid(), 'active', now() + interval '10 minutes'),
    (v_old, gen_random_uuid(), 'active', now() - interval '10 minutes');
  INSERT INTO public.stay_inventory_hold_slices(hold_id, reservation_line_id, resource_type, offering_id, room_date, quantity) VALUES
    (v_hold, gen_random_uuid(), 'room_night', v_room, v_today + 5, 1),
    (v_old, gen_random_uuid(), 'room_night', v_room, v_today + 6, 4);
  v_feed := public.brand_site_stay_nights(v_site, v_room, 7);
  PERFORM pg_temp.p_assert(v_feed->'days'->0->'slots'->0->>'state' = 'full' AND v_feed->'days'->0->'slots'->0->'href' = 'null'::jsonb
    AND (v_feed->'days'->0->'slots'->0->>'left')::int = 0, 'T-5a fully booked: full, 0 left, no link');
  PERFORM pg_temp.p_assert(v_feed->'days'->5->'slots'->0->>'state' = 'few' AND (v_feed->'days'->5->'slots'->0->>'left')::int = 1,
    'T-5b partly booked (2 booked, 1 held of 4): 1 left, few');
  PERFORM pg_temp.p_assert(v_feed->'days'->6->'slots'->0->>'state' = 'open' AND (v_feed->'days'->6->'slots'->0->>'left')::int = 4,
    'T-5c a released booking and an expired hold do not count');
  PERFORM pg_temp.p_assert(v_feed->'days'->4->'slots'->0->>'state' = 'full' AND v_feed->'days'->4->'slots'->0->'href' = 'null'::jsonb,
    'T-5d a blocked (stop-sell) night: full, no link');
  SELECT o INTO v_row FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site)->'offerings') o WHERE o->>'kind' = 'stay';
  PERFORM pg_temp.p_assert((v_row->>'min_price_minor')::bigint = 12500000
    AND (public.brand_site_booking_target(v_site, 'stay', v_room)->>'min_price_minor')::bigint = 12500000,
    'T-5e the "from" price skips the cheap night that is fully booked (feed and target)');
END
$t5$;

ROLLBACK;
