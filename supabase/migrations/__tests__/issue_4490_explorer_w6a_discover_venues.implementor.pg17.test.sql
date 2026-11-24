-- #4490 Explorer W6a (20281203464490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-DISCOVER-VENUE-TYPE-ONLY-WITH-SUPPLY | issue #4490 | the Discover Venues kind lists only bookable hosted venues (verified, live non-internal brand, a live switched-on offer, plan or reservable tables; a Stay with live rooms only under Stays) in the city or within 50 km, and a venue-type chip exists only when its unfiltered count in the city is above zero; with VENUE_DISCOVER off the kind is empty, its chips are absent and the facets answer has no 'venues' key.
--
-- K kind and listing. F facets (chips). O order. C city context / nearest city. X flag off. A authority.
--
-- FAILS-ON-REVERT: without 20281203464490 every block fails (invalid_kind / functions absent).
-- Fix round 1: K-9 / K-10 fail if a stay venue is dropped from Venues on "has a live room"
-- instead of "the Stays kind lists it" (W6-N3); F-5 fails if a Venues count builds the items
-- page again or a chip count drifts from the list (W6-N6).
-- TEST-MOD-APPROVED #4490 (06-W6 fix 1): stayboth is now a stay the Stays kind really lists
-- (price, policy, cover, nights, STAY_PUBLIC_PAGES on); stayhidden (a live room the Stays kind
-- does not list) is new and listed under Venues, so K-1, K-2 and F-3 count it.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION public.t4490w6a_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490W6A FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490w6a_expect(p_sql text, p_state text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state THEN
      RAISE EXCEPTION 'T4490W6A FAIL: % (expected %, got % %)', p_label, p_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490W6A FAIL: % (expected %, no error)', p_label, p_state;
END
$f$;
CREATE FUNCTION public.t4490w6a_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490w6a_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490w6a_ok(boolean, text), public.t4490w6a_expect(text, text, text),
  public.t4490w6a_as(uuid), public.t4490w6a_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

-- ---------------------------------------------------------------------------
-- Fixture around (6.45, 3.40), city 'W6 City'. Bookable by reservable tables
-- unless said otherwise.
--   rest     restaurant, in the city (oldest)
--   club40   club, 40 km away, another city name (inside the 50 km radius)
--   clubnow  club, in the city, an event starting in an hour (on today)
--   far      restaurant, 120 km away, another city (absent)
--   pending  restaurant, unverified (absent)
--   internal restaurant of an internal brand (absent)
--   paused   play, only a paused entry offer (absent)
--   rooms    stay, a live room only (absent everywhere: not bookable)
--   stayboth stay, a live day pass AND a live room the Stays kind lists (Stays only)
--   staypass stay, a live day pass, no rooms (Venues, unfiltered only)
--   stayhidden stay, a live day pass AND active settings with a live room that the
--            Stays kind does NOT list (no price, cover or nights): Venues (fix 1, W6-N3)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44947000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'w6aowner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44947000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44947000-0000-4000-9000-000000000010', '44947000-0000-4000-8000-000000000001', 'Discover W6 4490', 'discover-w6-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44947000-0000-4000-9000-000000000020', '44947000-0000-4000-8000-000000000001', 'Internal W6 4490', 'internal-w6-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.admin_internal_brands (brand_id, is_internal, reason, marked_by) VALUES
  ('44947000-0000-4000-9000-000000000010', false, 'W6a suite: a real venue brand', 'w6a-suite'),
  ('44947000-0000-4000-9000-000000000020', true, 'W6a suite: an internal test brand', 'w6a-suite');

CREATE TEMP TABLE t4490w6a_fx (k text PRIMARY KEY, venue uuid, place uuid, brand uuid, category text, status text,
  city text, lat float8, created timestamptz) ON COMMIT DROP;
INSERT INTO t4490w6a_fx VALUES
  ('rest', '44947000-0000-4000-b000-000000000001', '44947000-0000-4000-a000-000000000001', '44947000-0000-4000-9000-000000000010', 'restaurant', 'verified', 'W6 City', 6.45, now() - interval '30 days'),
  ('club40', '44947000-0000-4000-b000-000000000002', '44947000-0000-4000-a000-000000000002', '44947000-0000-4000-9000-000000000010', 'club', 'verified', 'W6 Elsewhere', 6.81, now() - interval '20 days'),
  ('clubnow', '44947000-0000-4000-b000-000000000003', '44947000-0000-4000-a000-000000000003', '44947000-0000-4000-9000-000000000010', 'club', 'verified', 'W6 City', 6.45, now() - interval '40 days'),
  ('far', '44947000-0000-4000-b000-000000000004', '44947000-0000-4000-a000-000000000004', '44947000-0000-4000-9000-000000000010', 'restaurant', 'verified', 'W6 Far', 7.53, now() - interval '10 days'),
  ('pending', '44947000-0000-4000-b000-000000000005', '44947000-0000-4000-a000-000000000005', '44947000-0000-4000-9000-000000000010', 'restaurant', 'pending_review', 'W6 City', 6.45, now() - interval '10 days'),
  ('internal', '44947000-0000-4000-b000-000000000006', '44947000-0000-4000-a000-000000000006', '44947000-0000-4000-9000-000000000020', 'restaurant', 'verified', 'W6 City', 6.45, now() - interval '10 days'),
  ('paused', '44947000-0000-4000-b000-000000000007', '44947000-0000-4000-a000-000000000007', '44947000-0000-4000-9000-000000000010', 'play', 'verified', 'W6 City', 6.45, now() - interval '10 days'),
  ('rooms', '44947000-0000-4000-b000-000000000008', '44947000-0000-4000-a000-000000000008', '44947000-0000-4000-9000-000000000010', 'stay', 'verified', 'W6 City', 6.45, now() - interval '10 days'),
  ('stayboth', '44947000-0000-4000-b000-000000000009', '44947000-0000-4000-a000-000000000009', '44947000-0000-4000-9000-000000000010', 'stay', 'verified', 'W6 City', 6.45, now() - interval '10 days'),
  ('staypass', '44947000-0000-4000-b000-00000000000a', '44947000-0000-4000-a000-00000000000a', '44947000-0000-4000-9000-000000000010', 'stay', 'verified', 'W6 City', 6.45, now() - interval '5 days'),
  ('stayhidden', '44947000-0000-4000-b000-00000000000b', '44947000-0000-4000-a000-00000000000b', '44947000-0000-4000-9000-000000000010', 'stay', 'verified', 'W6 City', 6.45, now() - interval '3 days');
GRANT SELECT ON t4490w6a_fx TO PUBLIC;

INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable)
SELECT place, 'W6a ' || k, lat, 3.40, true, true FROM t4490w6a_fx;
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, city, venue_category, claim_status, country_code, place_pool_id, created_at)
SELECT venue, brand, 'w6a' || k, 'W6a ' || k, lat, 3.40, city, category, status, 'NG', place, created FROM t4490w6a_fx;

CREATE FUNCTION pg_temp.t4490w6a_entry(p_venue uuid, p_key text, p_pause boolean)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', p_venue,
    jsonb_build_object('name', 'Pool ' || p_key, 'dailyLimit', 50, 'keptForWalkIns', 0), NULL, 'w6a-pool-' || p_key);
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', p_venue,
    jsonb_build_object('kind', 'entry', 'name', 'Entry ' || p_key, 'entryStyle', 'walk_in'), NULL, 'w6a-o1-' || p_key);
  v_offer := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('set_pool', p_venue, jsonb_build_object('offerId', v_offer, 'poolId', v_pool),
    (v->>'version')::bigint, 'w6a-o2-' || p_key);
  v := public.issue_4490_manage_offer('upsert_price_option', p_venue, jsonb_build_object('offerId', v_offer, 'name', 'Walk-in',
    'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 400000), (v->>'version')::bigint, 'w6a-o3-' || p_key);
  v := public.issue_4490_manage_offer('set_policy', p_venue, jsonb_build_object('offerId', v_offer),
    (v->>'version')::bigint, 'w6a-o4-' || p_key);
  v := public.issue_4490_manage_offer('set_schedule', p_venue, jsonb_build_object('offerId', v_offer,
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '09:00', 'endTime', '21:00'),
    (v->>'version')::bigint, 'w6a-o5-' || p_key);
  v := public.issue_4490_manage_offer('publish', p_venue, jsonb_build_object('offerId', v_offer),
    (v->>'version')::bigint, 'w6a-o6-' || p_key);
  IF p_pause THEN
    v := public.issue_4490_manage_offer('pause', p_venue, jsonb_build_object('offerId', v_offer),
      (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w6a-o7-' || p_key);
  END IF;
  RETURN v_offer;
END
$f$;

SELECT public.t4490w6a_as('44947000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM t4490w6a_fx WHERE k IN ('rest', 'club40', 'clubnow', 'far', 'pending', 'internal') LOOP
    PERFORM public.issue_4490_set_venue_feature(r.venue, 'table_reservations', true, NULL, NULL, NULL, 'w6a-tables-' || r.k);
  END LOOP;
  PERFORM public.issue_4490_set_venue_feature('44947000-0000-4000-b000-000000000003', 'events_here', true, NULL, NULL, NULL, 'w6a-clubnow-events');
  PERFORM public.issue_4490_set_venue_feature('44947000-0000-4000-b000-000000000007', 'entry', true, NULL, NULL, NULL, 'w6a-paused-entry');
  PERFORM pg_temp.t4490w6a_entry('44947000-0000-4000-b000-000000000007', 'paused', true);
  PERFORM public.issue_4490_set_venue_feature('44947000-0000-4000-b000-000000000009', 'entry', true, NULL, NULL, NULL, 'w6a-stayboth-entry');
  PERFORM pg_temp.t4490w6a_entry('44947000-0000-4000-b000-000000000009', 'stayboth', false);
  PERFORM public.issue_4490_set_venue_feature('44947000-0000-4000-b000-00000000000a', 'entry', true, NULL, NULL, NULL, 'w6a-staypass-entry');
  PERFORM pg_temp.t4490w6a_entry('44947000-0000-4000-b000-00000000000a', 'staypass', false);
  PERFORM public.issue_4490_set_venue_feature('44947000-0000-4000-b000-00000000000b', 'entry', true, NULL, NULL, NULL, 'w6a-stayhidden-entry');
  PERFORM pg_temp.t4490w6a_entry('44947000-0000-4000-b000-00000000000b', 'stayhidden', false);
END
$fx$;
SELECT public.t4490w6a_reset();

INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
SELECT brand, venue, true FROM t4490w6a_fx WHERE k IN ('rest', 'club40', 'clubnow', 'far', 'pending', 'internal')
ON CONFLICT (venue_id) DO UPDATE SET reservations_enabled = true;
-- rooms: a live room, settings still a draft. stayboth: active settings and a live room.
INSERT INTO public.stay_settings (venue_id, brand_id, booking_state) VALUES
  ('44947000-0000-4000-b000-000000000008', '44947000-0000-4000-9000-000000000010', 'draft');
INSERT INTO public.stay_offerings (id, venue_id, brand_id, kind, name, status, confirmation_mode, inventory_basis, quantity, min_guests, max_guests, max_adults, max_children) VALUES
  ('44947000-0000-4000-d000-000000000008', '44947000-0000-4000-b000-000000000008', '44947000-0000-4000-9000-000000000010', 'room', 'Garden room', 'live', 'instant', 'pooled_units', 3, 1, 2, 2, 0),
  ('44947000-0000-4000-d000-000000000009', '44947000-0000-4000-b000-000000000009', '44947000-0000-4000-9000-000000000010', 'room', 'Sea room', 'live', 'instant', 'pooled_units', 3, 1, 2, 2, 0),
  ('44947000-0000-4000-d000-00000000000b', '44947000-0000-4000-b000-00000000000b', '44947000-0000-4000-9000-000000000010', 'room', 'Hidden room', 'live', 'instant', 'pooled_units', 3, 1, 2, 2, 0);
-- stay_settings for stayboth and stayhidden are written straight to 'active' (activation
-- checks are not under test here).
ALTER TABLE public.stay_settings DISABLE TRIGGER USER;
INSERT INTO public.stay_settings (venue_id, brand_id, booking_state, property_kind, timezone) VALUES
  ('44947000-0000-4000-b000-000000000009', '44947000-0000-4000-9000-000000000010', 'active', 'resort', 'Africa/Lagos'),
  ('44947000-0000-4000-b000-00000000000b', '44947000-0000-4000-9000-000000000010', 'active', 'resort', 'Africa/Lagos');
ALTER TABLE public.stay_settings ENABLE TRIGGER USER;
-- stayboth's room is complete (price, policy, ready cover, open nights), so the Stays kind
-- lists it; stayhidden's room has none of these, so the Stays kind does not.
INSERT INTO storage.objects (id, bucket_id, name, owner, metadata) VALUES
  ('44947000-0000-4000-f000-000000000009', 'brand_covers', '44947000-0000-4000-9000-000000000010/stay/sea.jpg',
   '44947000-0000-4000-8000-000000000001', '{"mimetype":"image/jpeg","size":1024,"width":1600,"height":900}'::jsonb);
INSERT INTO public.stay_offering_media (offering_id, brand_id, venue_id, storage_object_id, storage_bucket_id, storage_object_name,
  mime_type, byte_size, width, height, alt_text, sort_order, is_cover, status) VALUES
  ('44947000-0000-4000-d000-000000000009', '44947000-0000-4000-9000-000000000010', '44947000-0000-4000-b000-000000000009',
   '44947000-0000-4000-f000-000000000009', 'brand_covers', '44947000-0000-4000-9000-000000000010/stay/sea.jpg',
   'image/jpeg', 1024, 1600, 900, 'Sea room', 0, true, 'ready');
INSERT INTO public.stay_price_versions (offering_id, brand_id, venue_id, version_number, amount_minor, currency_code, pricing_unit) VALUES
  ('44947000-0000-4000-d000-000000000009', '44947000-0000-4000-9000-000000000010', '44947000-0000-4000-b000-000000000009', 1, 5000000, 'NGN', 'room_night');
INSERT INTO public.stay_policy_versions (offering_id, brand_id, venue_id, version_number, cancellation_policy) VALUES
  ('44947000-0000-4000-d000-000000000009', '44947000-0000-4000-9000-000000000010', '44947000-0000-4000-b000-000000000009', 1, 'Flexible policy');
INSERT INTO public.stay_room_nights (offering_id, local_date, brand_id, venue_id, sellable_quantity)
SELECT '44947000-0000-4000-d000-000000000009', (now() AT TIME ZONE 'Africa/Lagos')::date + d, '44947000-0000-4000-9000-000000000010',
  '44947000-0000-4000-b000-000000000009', 3
FROM generate_series(1, 5) d;
-- Stays stays off until the Venues switch is on (X-1 reads the city context with no supply).
INSERT INTO public.feature_flags (flag_key, is_enabled) VALUES ('STAY_PUBLIC_PAGES', false)
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = false;
-- clubnow: a public event starting in an hour.
INSERT INTO public.events (id, brand_id, title, slug, event_type, visibility, status, timezone, currency, venue_id)
VALUES ('44947000-0000-4000-e000-000000000001', '44947000-0000-4000-9000-000000000010', 'Club night W6a', 'w6a-club-night',
        'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN', '44947000-0000-4000-b000-000000000003');
INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
VALUES ('44947000-0000-4000-e000-000000000001', now() + interval '1 hour', now() + interval '5 hours', 'Africa/Lagos', true);

SELECT public.t4490w6a_ok(
  (SELECT bool_and(public.issue_4490_venue_is_bookable(venue)) FROM t4490w6a_fx WHERE k IN ('rest', 'club40', 'clubnow', 'far', 'internal', 'stayboth', 'staypass', 'stayhidden'))
  AND NOT public.issue_4490_venue_is_bookable('44947000-0000-4000-b000-000000000005')
  AND NOT public.issue_4490_venue_is_bookable('44947000-0000-4000-b000-000000000007')
  AND NOT public.issue_4490_venue_is_bookable('44947000-0000-4000-b000-000000000008'),
  'K-0 fixture bookability as described');
-- ---------------------------------------------------------------------------
-- Switch off first: nothing changes.
-- ---------------------------------------------------------------------------
SELECT public.t4490w6a_ok(
  (public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', '{}'::jsonb, 0, 20)->>'total')::int = 0
  AND NOT (public.discover_v2_facets_exact(ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', 'events', '{}'::jsonb, 'NGN')->'kinds' ? 'venues')
  AND public.discover_v2_facets_exact(ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', 'venues', '{}'::jsonb, 'NGN')->'groups' = '[]'::jsonb
  AND public.discover_v2_city_context(ARRAY['W6 City'], 6.45, 3.40, 50, 'UTC')->>'majorityCurrency' IS NULL,
  'X-1 VENUE_DISCOVER off: total 0, no venues key in kinds, no venueType group, no venue in the city context');
CREATE TEMP TABLE t4490w6a_nearest_off ON COMMIT DROP AS
SELECT public.discover_v2_nearest_city(7.35, 3.40) AS n;

UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_DISCOVER';
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'STAY_PUBLIC_PAGES';
SELECT public.t4490w6a_ok(
  (SELECT array_agg(item->>'id') FROM jsonb_array_elements(
     public.discover_v2_items('stays', ARRAY['W6 City'], 6.45, 3.40, 100, 'Africa/Lagos', '{}'::jsonb, 0, 50)->'items') item)
  = ARRAY['44947000-0000-4000-b000-000000000009'],
  'K-0b the Stays kind lists stayboth and not stayhidden (its room has no price, cover or nights) nor rooms (draft settings)');


CREATE FUNCTION pg_temp.t4490w6a_keys(p_filters jsonb) RETURNS text[] LANGUAGE sql AS $f$
  SELECT array_agg(f.k ORDER BY i.ord)
  FROM jsonb_array_elements(public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', p_filters, 0, 50)->'items')
    WITH ORDINALITY i(item, ord)
  JOIN t4490w6a_fx f ON f.venue = (i.item->>'id')::uuid
$f$;

SELECT public.t4490w6a_ok(
  pg_temp.t4490w6a_keys('{}'::jsonb) = ARRAY['clubnow', 'stayhidden', 'staypass', 'club40', 'rest'],
  'K-1/O-1 listed: on-today first, then newest verified (stayhidden, staypass, club40, rest); absent: far, pending, internal, paused, rooms, stayboth');
SELECT public.t4490w6a_ok(
  (public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', '{}'::jsonb, 0, 1)->>'total')::int = 5,
  'K-2 total counts every listed venue (page of 1)');
SELECT public.t4490w6a_ok(
  pg_temp.t4490w6a_keys('{}'::jsonb) = pg_temp.t4490w6a_keys('{}'::jsonb)
  AND pg_temp.t4490w6a_keys('{}'::jsonb) = pg_temp.t4490w6a_keys('{}'::jsonb),
  'O-2 the order is stable across calls');
SELECT public.t4490w6a_ok(
  pg_temp.t4490w6a_keys('{"venueTypes":["club"]}'::jsonb) = ARRAY['clubnow', 'club40']
  AND pg_temp.t4490w6a_keys('{"venueTypes":["restaurant","club"]}'::jsonb) = ARRAY['clubnow', 'club40', 'rest']
  AND pg_temp.t4490w6a_keys('{"venueTypes":["cafe"]}'::jsonb) IS NULL,
  'K-3 venueTypes filters; a Stay with a day pass is in the unfiltered list only');
SELECT public.t4490w6a_ok(
  'stayhidden' = ANY(pg_temp.t4490w6a_keys('{}'::jsonb)) AND NOT ('stayboth' = ANY(pg_temp.t4490w6a_keys('{}'::jsonb))),
  'K-9 a venue appears once: a stay the Stays kind lists is not in Venues; a stay with a live room the Stays kind does not list stays in Venues (bookable through its day pass)');
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'STAY_PUBLIC_PAGES';
SELECT public.t4490w6a_ok(
  (public.discover_v2_items('stays', ARRAY['W6 City'], 6.45, 3.40, 100, 'Africa/Lagos', '{}'::jsonb, 0, 50)->>'total')::int = 0
  AND pg_temp.t4490w6a_keys('{}'::jsonb) = ARRAY['clubnow', 'stayhidden', 'staypass', 'stayboth', 'club40', 'rest'],
  'K-10 Stays switched off: Stays lists nothing, so stayboth (bookable by its day pass) is back in Venues; the rule follows the Stays kind itself');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'STAY_PUBLIC_PAGES';
SELECT public.t4490w6a_ok(
  (SELECT bool_and(item->>'kind' = 'venue' AND item->'price' = 'null'::jsonb AND item->'venue'->>'venueId' = item->>'id'
     AND item->'venue' ? 'priceFrom' AND item->'route'->'params'->>'venueSlug' IS NOT NULL
     AND item->'brand'->>'slug' = 'discover-w6-4490')
   FROM jsonb_array_elements(public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', '{}'::jsonb, 0, 50)->'items') item),
  'K-4 a venue item: kind venue, no price, the card facts, the venue slug and brand');
SELECT public.t4490w6a_ok(
  (SELECT (item->'venue'->>'onTodayStartsAt') IS NOT NULL
   FROM jsonb_array_elements(public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', '{}'::jsonb, 0, 1)->'items') item),
  'K-5 the first card carries its on-today start');
SELECT public.t4490w6a_ok(
  (SELECT count(*) FROM jsonb_array_elements(public.discover_v2_items('venues', ARRAY['Nowhere'], 9.0, 9.0, 50, 'Africa/Lagos', '{}'::jsonb, 0, 50)->'items')) = 0,
  'K-6 a city with no supply lists nothing');
SELECT public.t4490w6a_expect(
  $q$SELECT public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', '{"venueTypes":["stay"]}'::jsonb, 0, 20)$q$,
  '22023', 'K-7 an unknown venue type (stay is not a chip) is refused');
SELECT public.t4490w6a_expect(
  $q$SELECT public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', '{"venueTypes":"club"}'::jsonb, 0, 20)$q$,
  '22023', 'K-8 venueTypes must be a list');

-- Facets.
SELECT public.t4490w6a_ok(
  (public.discover_v2_facets_exact(ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', 'venues', '{}'::jsonb, 'NGN')->'groups')
  = '[{"id": "venueType", "multi": true, "options": [{"id": "restaurant", "count": 1}, {"id": "club", "count": 2}]}]'::jsonb,
  'F-1 chips only for types with supply, in chip order (restaurant 1, club 2; no cafe, play or stay chip)');
SELECT public.t4490w6a_ok(
  (public.discover_v2_facets_exact(ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', 'venues', '{"venueTypes":["club"]}'::jsonb, 'NGN')->'selected'->>'total')::int = 2
  AND (public.discover_v2_facets_exact(ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', 'venues', '{"venueTypes":["club"]}'::jsonb, 'NGN')->'groups'->0->'options')
      = '[{"id": "restaurant", "count": 1}, {"id": "club", "count": 2}]'::jsonb,
  'F-2 with Club selected: selected total 2 and each chip keeps its own count');
SELECT public.t4490w6a_ok(
  (public.discover_v2_facets_exact(ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', 'events', '{}'::jsonb, 'NGN')->'kinds'->'venues')
  = '{"total": 5, "available": true}'::jsonb,
  'F-3 kinds.venues.total is the listed count');
DO $f5$
DECLARE
  v_filters jsonb;
  v_facets jsonb;
  v_items jsonb;
  v_opt jsonb;
BEGIN
  FOREACH v_filters IN ARRAY ARRAY['{}'::jsonb, '{"venueTypes":["club"]}', '{"venueTypes":["restaurant","club"]}', '{"venueTypes":["cafe"]}'] LOOP
    v_facets := public.discover_v2_facets_exact(ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', 'venues', v_filters, 'NGN');
    v_items := public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', v_filters, 0, 50);
    IF (v_facets->'selected'->>'total')::int IS DISTINCT FROM (v_items->>'total')::int
       OR (v_facets->'kinds'->'venues'->>'total')::int IS DISTINCT FROM
          (public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos', '{}'::jsonb, 0, 1)->>'total')::int THEN
      RAISE EXCEPTION 'T4490W6A FAIL: F-5 totals differ for %: facets % items %', v_filters, v_facets->'selected', v_items->>'total';
    END IF;
    FOR v_opt IN SELECT * FROM jsonb_array_elements(COALESCE(v_facets->'groups'->0->'options', '[]'::jsonb)) LOOP
      IF (v_opt->>'count')::int IS DISTINCT FROM (public.discover_v2_items('venues', ARRAY['W6 City'], 6.45, 3.40, 50, 'Africa/Lagos',
            jsonb_build_object('venueTypes', jsonb_build_array(v_opt->>'id')), 0, 1)->>'total')::int THEN
        RAISE EXCEPTION 'T4490W6A FAIL: F-5 chip % count % differs from its list', v_opt->>'id', v_opt->>'count';
      END IF;
    END LOOP;
  END LOOP;
  IF position('discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,''venueTypes''' IN
       pg_get_functiondef('public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)'::regprocedure)) > 0
     OR position('issue_4490_discover_venues_filtered' IN
       pg_get_functiondef('public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'T4490W6A FAIL: F-5 Venues facets still build the items page per chip';
  END IF;
  RAISE NOTICE 'PASS  F-5 Venues counts are plain counts that equal the list (selected total, kinds total, every chip) for 4 filter sets';
END
$f5$;
SELECT public.t4490w6a_ok(
  public.discover_v2_facets_exact(ARRAY['Nowhere'], 9.0, 9.0, 50, 'Africa/Lagos', 'venues', '{}'::jsonb, 'NGN')->'groups' = '[]'::jsonb
  AND public.discover_v2_facets_exact(ARRAY['Nowhere'], 9.0, 9.0, 50, 'Africa/Lagos', 'events', '{}'::jsonb, 'NGN')->'kinds'->'venues'
      = '{"total": 0, "available": false}'::jsonb,
  'F-4 a city with none: no chips, venues total 0');

-- City context and nearest city.
SELECT public.t4490w6a_ok(
  public.discover_v2_city_context(ARRAY['W6 City'], 6.45, 3.40, 50, 'UTC')->>'majorityCurrency' = 'NGN',
  'C-1 venue supply sets the city context (currency NGN)');
SELECT public.t4490w6a_ok(
  public.discover_v2_nearest_city(7.35, 3.40)->>'label' = 'W6 Far, NG'
  AND (SELECT n FROM t4490w6a_nearest_off) IS DISTINCT FROM public.discover_v2_nearest_city(7.35, 3.40),
  'C-2 a city whose nearest supply is a venue is suggested (only with the switch on)');

-- Authority.
SELECT public.t4490w6a_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_discover_venue_candidates(text[],double precision,double precision,double precision)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_discover_venue_candidates(text[],double precision,double precision,double precision)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_venue_type_chip_keys()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)', 'EXECUTE'),
  'A-1 the venue helpers and the patched readers stay service-role only');
SELECT public.t4490w6a_ok(
  public.issue_4490_venue_type_chip_keys() = ARRAY['restaurant','bar_lounge','club','cafe','play','coworking','event_space','creative_and_arts']
  AND NOT ('stay' = ANY(public.issue_4490_venue_type_chip_keys()))
  AND (SELECT bool_and(k = ANY(ARRAY['restaurant','play','creative_and_arts','stay','bar_lounge','club','cafe','event_space','coworking']))
       FROM unnest(public.issue_4490_venue_type_chip_keys()) k),
  'A-2 the chip keys are the taxonomy without stay, in chip order');

ROLLBACK;
