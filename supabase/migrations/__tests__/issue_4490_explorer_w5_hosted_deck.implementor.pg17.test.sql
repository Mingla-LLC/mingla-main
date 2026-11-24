-- #4490 Explorer W5 (20281203454490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-DECK-HOSTED-NO-FILTER-EXEMPTION-SQL | issue #4490 | the hosted deck wrappers return only rows the base servable RPCs return for the same arguments (same mood floor, radius or circles, exclusions and place checks; no row cap inside), restricted to bookable verified venues of live, non-internal brands, at most 6, ordered signal score DESC, review_count DESC NULLS LAST, place id ASC; they are callable by the service role only.
--
-- H hosted solo wrapper. I intersection wrapper. A authority. D determinism.
--
-- FAILS-ON-REVERT: without 20281203454490 every block fails (the wrappers do not exist).
-- TEST-MOD-APPROVED #4490 (06-W5 fix 1): the wrappers take every (signal, floor) of a request in
-- one call (W5-N2); calls were rewritten to that shape, A-2 checks the place rule instead of a
-- base call with no row cap, and E / M were added.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490w5_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490W5 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490w5_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;
CREATE FUNCTION public.t4490w5_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490w5_ok(boolean, text), public.t4490w5_as(uuid), public.t4490w5_reset() TO PUBLIC;

-- ---------------------------------------------------------------------------
-- Fixture. Signal 't4490w5' (floor 120). 510 organic places score 190 (so every
-- hosted venue ranks below the 500th base row). Hosted (tables reservable):
-- g1..g3 score 130 (tie: place id decides), g4 129, g5 128, g6 127, g7 121.
-- Never hosted: x_low (score 100, below the floor), x_far (117 km away),
-- x_paused (only a paused entry offer), x_rooms (Stay with rooms only),
-- x_internal (internal brand), x_pending (unverified).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44946000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'w5owner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44946000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at) VALUES
  ('44946000-0000-4000-9000-000000000010', '44946000-0000-4000-8000-000000000001', 'Hosted W5 4490', 'hosted-w5-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now()),
  ('44946000-0000-4000-9000-000000000020', '44946000-0000-4000-8000-000000000001', 'Internal W5 4490', 'internal-w5-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.admin_internal_brands (brand_id, is_internal, reason, marked_by) VALUES
  ('44946000-0000-4000-9000-000000000010', false, 'W5 suite: a real venue brand', 'w5-suite'),
  ('44946000-0000-4000-9000-000000000020', true, 'W5 suite: an internal test brand', 'w5-suite');

CREATE TEMP TABLE t4490w5_fx (k text PRIMARY KEY, place uuid, venue uuid, brand uuid, score numeric,
  lat float8, category text, status text, reviews int) ON COMMIT DROP;
INSERT INTO t4490w5_fx VALUES
  ('g1', '44946000-0000-4000-a000-0000000000a1', '44946000-0000-4000-b000-0000000000a1', '44946000-0000-4000-9000-000000000010', 130, 6.45, 'restaurant', 'verified', 50),
  ('g2', '44946000-0000-4000-a000-0000000000a2', '44946000-0000-4000-b000-0000000000a2', '44946000-0000-4000-9000-000000000010', 130, 6.45, 'bar_lounge', 'verified', 50),
  ('g3', '44946000-0000-4000-a000-0000000000a3', '44946000-0000-4000-b000-0000000000a3', '44946000-0000-4000-9000-000000000010', 130, 6.45, 'club', 'verified', 50),
  ('g4', '44946000-0000-4000-a000-0000000000a4', '44946000-0000-4000-b000-0000000000a4', '44946000-0000-4000-9000-000000000010', 129, 6.45, 'cafe', 'verified', NULL),
  ('g5', '44946000-0000-4000-a000-0000000000a5', '44946000-0000-4000-b000-0000000000a5', '44946000-0000-4000-9000-000000000010', 128, 6.45, 'restaurant', 'verified', 10),
  ('g6', '44946000-0000-4000-a000-0000000000a6', '44946000-0000-4000-b000-0000000000a6', '44946000-0000-4000-9000-000000000010', 127, 6.45, 'restaurant', 'verified', 10),
  ('g7', '44946000-0000-4000-a000-0000000000a7', '44946000-0000-4000-b000-0000000000a7', '44946000-0000-4000-9000-000000000010', 121, 6.45, 'restaurant', 'verified', 10),
  ('x_low', '44946000-0000-4000-a000-0000000000b1', '44946000-0000-4000-b000-0000000000b1', '44946000-0000-4000-9000-000000000010', 100, 6.45, 'restaurant', 'verified', 10),
  ('x_far', '44946000-0000-4000-a000-0000000000b2', '44946000-0000-4000-b000-0000000000b2', '44946000-0000-4000-9000-000000000010', 150, 7.50, 'restaurant', 'verified', 10),
  ('x_paused', '44946000-0000-4000-a000-0000000000b3', '44946000-0000-4000-b000-0000000000b3', '44946000-0000-4000-9000-000000000010', 150, 6.45, 'play', 'verified', 10),
  ('x_rooms', '44946000-0000-4000-a000-0000000000b4', '44946000-0000-4000-b000-0000000000b4', '44946000-0000-4000-9000-000000000010', 150, 6.45, 'stay', 'verified', 10),
  ('x_internal', '44946000-0000-4000-a000-0000000000b5', '44946000-0000-4000-b000-0000000000b5', '44946000-0000-4000-9000-000000000020', 150, 6.45, 'restaurant', 'verified', 10),
  ('x_pending', '44946000-0000-4000-a000-0000000000b6', '44946000-0000-4000-b000-0000000000b6', '44946000-0000-4000-9000-000000000010', 150, 6.45, 'restaurant', 'pending_review', 10);
GRANT SELECT ON t4490w5_fx TO PUBLIC;

INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable, stored_photo_urls, review_count)
SELECT place, 'W5 ' || k, lat, 3.40, true, true, ARRAY['https://example.test/w5.jpg'], reviews FROM t4490w5_fx;
INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable, stored_photo_urls, review_count)
SELECT ('44946000-0000-4000-c000-' || lpad(n::text, 12, '0'))::uuid, 'W5 organic ' || n, 6.45, 3.40, true, true,
  ARRAY['https://example.test/w5o.jpg'], 1000
FROM generate_series(1, 510) n;
INSERT INTO public.place_scores (place_id, signal_id, score)
SELECT place, 't4490w5', score FROM t4490w5_fx
UNION ALL
SELECT ('44946000-0000-4000-c000-' || lpad(n::text, 12, '0'))::uuid, 't4490w5', 190 FROM generate_series(1, 510) n;

INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code, place_pool_id)
SELECT venue, brand, 'w5' || replace(k, '_', ''), 'W5 ' || k, lat, 3.40, category, status, 'NG', place FROM t4490w5_fx;

SELECT public.t4490w5_as('44946000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  r record;
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_paused uuid := '44946000-0000-4000-b000-0000000000b3';
BEGIN
  FOR r IN SELECT * FROM t4490w5_fx WHERE k NOT IN ('x_paused', 'x_rooms', 'x_internal') LOOP
    PERFORM public.issue_4490_set_venue_feature(r.venue, 'table_reservations', true, NULL, NULL, NULL, 'w5-tables-' || r.k);
  END LOOP;
  -- x_paused: an entry offer, published then paused.
  PERFORM public.issue_4490_set_venue_feature(v_paused, 'entry', true, NULL, NULL, NULL, 'w5-paused-entry');
  v := public.issue_4490_manage_capacity_pool('create', v_paused,
    jsonb_build_object('name', 'Pool W5', 'dailyLimit', 50, 'keptForWalkIns', 0), NULL, 'w5-pool-paused');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', v_paused,
    jsonb_build_object('kind', 'entry', 'name', 'Entry W5', 'entryStyle', 'walk_in'), NULL, 'w5-offer-step-1');
  v_offer := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('set_pool', v_paused, jsonb_build_object('offerId', v_offer, 'poolId', v_pool),
    (v->>'version')::bigint, 'w5-offer-step-2');
  v := public.issue_4490_manage_offer('upsert_price_option', v_paused, jsonb_build_object('offerId', v_offer, 'name', 'Walk-in',
    'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 300000), (v->>'version')::bigint, 'w5-offer-step-3');
  v := public.issue_4490_manage_offer('set_policy', v_paused, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'w5-offer-step-4');
  v := public.issue_4490_manage_offer('set_schedule', v_paused, jsonb_build_object('offerId', v_offer,
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '09:00', 'endTime', '21:00'), (v->>'version')::bigint, 'w5-offer-step-5');
  v := public.issue_4490_manage_offer('publish', v_paused, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'w5-offer-step-6');
  v := public.issue_4490_manage_offer('pause', v_paused, jsonb_build_object('offerId', v_offer),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w5-offer-step-7');
END
$fx$;
SELECT public.t4490w5_reset();

-- Tables reservable through the existing switch (internal-brand venue too: it must still be absent).
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
SELECT brand, venue, true FROM t4490w5_fx WHERE k NOT IN ('x_paused', 'x_rooms')
ON CONFLICT (venue_id) DO UPDATE SET reservations_enabled = true;
-- x_internal: the feature switch as the brand's owner too.
SELECT public.t4490w5_as('44946000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature('44946000-0000-4000-b000-0000000000b5', 'table_reservations', true, NULL, NULL, NULL, 'w5-tables-internal');
SELECT public.t4490w5_reset();
-- x_rooms: a Stay venue whose only inventory is a live room.
INSERT INTO public.stay_settings (venue_id, brand_id, booking_state)
VALUES ('44946000-0000-4000-b000-0000000000b4', '44946000-0000-4000-9000-000000000010', 'draft');
INSERT INTO public.stay_offerings (venue_id, brand_id, kind, name, status, confirmation_mode, inventory_basis, quantity, max_adults, max_children)
VALUES ('44946000-0000-4000-b000-0000000000b4', '44946000-0000-4000-9000-000000000010', 'room', 'Garden room', 'live', 'instant', 'pooled_units', 3, 2, 0);

-- Sanity: the fixture's bookability is what the cases below assume.
SELECT public.t4490w5_ok(
  (SELECT bool_and(public.issue_4490_venue_is_bookable(venue)) FROM t4490w5_fx WHERE k LIKE 'g%' OR k IN ('x_low', 'x_far', 'x_internal'))
  AND NOT public.issue_4490_venue_is_bookable('44946000-0000-4000-b000-0000000000b3')
  AND NOT public.issue_4490_venue_is_bookable('44946000-0000-4000-b000-0000000000b4')
  AND NOT public.issue_4490_venue_is_bookable('44946000-0000-4000-b000-0000000000b6'),
  'H-0 fixture: g1..g7, x_low, x_far, x_internal bookable; x_paused, x_rooms, x_pending not');

CREATE TEMP TABLE t4490w5_out ON COMMIT DROP AS
SELECT 1 AS call_no, ordinality AS pos, h.*
FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120}]', 6.45, 3.40, 50000) WITH ORDINALITY h;
INSERT INTO t4490w5_out
SELECT 2, ordinality, h.* FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120}]', 6.45, 3.40, 50000) WITH ORDINALITY h;
INSERT INTO t4490w5_out
SELECT 3, ordinality, h.* FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120}]', 6.45, 3.40, 50000) WITH ORDINALITY h;

SELECT public.t4490w5_ok(
  (SELECT array_agg(f.k ORDER BY o.pos) FROM t4490w5_out o JOIN t4490w5_fx f ON f.place = o.place_id WHERE o.call_no = 1)
    = ARRAY['g1', 'g2', 'g3', 'g4', 'g5', 'g6'],
  'H-1 six hosted rows: score DESC, then reviews, then place id (g1..g3 tie on both), g7 beyond the cap');
SELECT public.t4490w5_ok(
  (SELECT count(*) FROM public.issue_1384_query_servable_places_by_signal('t4490w5', 120, 6.45, 3.40, 50000, '{}', 500)
   WHERE place_id IN (SELECT place FROM t4490w5_fx)) = 0
  AND (SELECT count(*) FROM t4490w5_out WHERE call_no = 1) = 6,
  'H-2 every hosted venue ranks below the first 500 base rows and is still returned (no row cap inside)');
SELECT public.t4490w5_ok(NOT EXISTS (
  SELECT 1 FROM t4490w5_out o
  WHERE NOT EXISTS (SELECT 1 FROM public.issue_1384_query_servable_places_by_signal('t4490w5', 120, 6.45, 3.40, 50000, '{}', NULL) b
                    WHERE b.place_id = o.place_id AND b.signal_score = o.signal_score AND b.name = o.name)),
  'H-3 hosted rows are a subset of the base rows for the same arguments (p_limit NULL)');
SELECT public.t4490w5_ok(NOT EXISTS (
  SELECT 1 FROM t4490w5_out o JOIN t4490w5_fx f ON f.place = o.place_id WHERE f.k LIKE 'x%'),
  'H-4 below the floor, out of radius, paused-only, rooms-only, internal brand and unverified venues are absent');
SELECT public.t4490w5_ok((SELECT bool_and(o.venue_id = f.venue) FROM t4490w5_out o JOIN t4490w5_fx f ON f.place = o.place_id),
  'H-5 each row carries its venue id');
SELECT public.t4490w5_ok(
  (SELECT array_agg(place_id ORDER BY pos) FROM t4490w5_out WHERE call_no = 1)
  = (SELECT array_agg(place_id ORDER BY pos) FROM t4490w5_out WHERE call_no = 2)
  AND (SELECT array_agg(place_id ORDER BY pos) FROM t4490w5_out WHERE call_no = 2)
  = (SELECT array_agg(place_id ORDER BY pos) FROM t4490w5_out WHERE call_no = 3),
  'D-1 the same order across three calls with tied scores');
SELECT public.t4490w5_ok(
  (SELECT array_agg(f.k ORDER BY h.ord) FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120}]', 6.45, 3.40, 50000,
     ARRAY['44946000-0000-4000-a000-0000000000a1'::uuid]) WITH ORDINALITY h(place_id, google_place_id, name, address, lat, lng,
     rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, photos,
     stored_photo_urls, types, primary_type, generative_summary, signal_score, signal_contributions, ai_reasoning,
     ai_score_raw, venue_id, signal_id, filter_min, ord) JOIN t4490w5_fx f ON f.place = h.place_id)
  = ARRAY['g2', 'g3', 'g4', 'g5', 'g6', 'g7'],
  'H-6 exclusions apply (g1 excluded, g7 moves up)');
SELECT public.t4490w5_ok(NOT EXISTS (
  SELECT 1 FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":131}]', 6.45, 3.40, 50000)),
  'H-7 the mood floor applies (floor 131 leaves no hosted venue)');
SELECT public.t4490w5_ok(
  (SELECT count(*) FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120}]', 7.50, 3.40, 5000)) = 1
  AND (SELECT place_id FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120}]', 7.50, 3.40, 5000))
      = '44946000-0000-4000-a000-0000000000b2',
  'H-8 the radius applies (only x_far inside a 5 km circle around it)');

-- Intersection wrapper.
CREATE TEMP TABLE t4490w5_circles ON COMMIT DROP AS
SELECT '[{"lat":6.45,"lng":3.40,"radius_m":20000},{"lat":6.46,"lng":3.41,"radius_m":20000}]'::jsonb AS c;
SELECT public.t4490w5_ok(
  (SELECT array_agg(f.k ORDER BY h.ord) FROM public.issue_4490_hosted_servable_places_intersection('[{"signal_id":"t4490w5","filter_min":120}]',
     (SELECT c FROM t4490w5_circles), '{}') WITH ORDINALITY h(place_id, google_place_id, name, address, lat, lng,
     rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, photos,
     stored_photo_urls, types, primary_type, generative_summary, signal_score, signal_contributions, ai_reasoning,
     ai_score_raw, venue_id, signal_id, filter_min, ord) JOIN t4490w5_fx f ON f.place = h.place_id)
  = ARRAY['g1', 'g2', 'g3', 'g4', 'g5', 'g6'],
  'I-1 intersection: six hosted rows in the same order (x_far outside every circle)');
SELECT public.t4490w5_ok(NOT EXISTS (
  SELECT 1 FROM public.issue_4490_hosted_servable_places_intersection('[{"signal_id":"t4490w5","filter_min":120}]', (SELECT c FROM t4490w5_circles), '{}') h
  WHERE NOT EXISTS (SELECT 1 FROM public.query_servable_places_by_signal_intersection('t4490w5', 120,
                      (SELECT c FROM t4490w5_circles), '{}', NULL) b WHERE b.place_id = h.place_id)),
  'I-2 intersection hosted rows are a subset of the base rows (p_limit NULL)');
SELECT public.t4490w5_ok(
  (SELECT count(*) FROM public.issue_4490_hosted_servable_places_intersection('[{"signal_id":"t4490w5","filter_min":120}]', (SELECT c FROM t4490w5_circles),
     ARRAY(SELECT place FROM t4490w5_fx WHERE k IN ('g1', 'g2', 'g3', 'g4', 'g5', 'g6')))) = 1,
  'I-3 intersection exclusions apply (only g7 left)');

-- Authority and source shape.
SELECT public.t4490w5_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_hosted_servable_places(jsonb,double precision,double precision,double precision,uuid[],bigint,bigint,character,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_hosted_servable_places(jsonb,double precision,double precision,double precision,uuid[],bigint,bigint,character,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_hosted_servable_places(jsonb,double precision,double precision,double precision,uuid[],bigint,bigint,character,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_hosted_servable_places_intersection(jsonb,jsonb,uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_hosted_servable_places_intersection(jsonb,jsonb,uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_hosted_servable_places_intersection(jsonb,jsonb,uuid[])', 'EXECUTE'),
  'A-1 both wrappers: service role only');
SELECT public.t4490w5_ok(
  (SELECT bool_and(p.prosecdef
     AND position('now()' IN lower(p.prosrc)) = 0
     AND position('issue_4490_venue_is_bookable' IN p.prosrc) > 0
     AND position('admin_brand_is_internal' IN p.prosrc) > 0
     AND position('issue_4490_place_is_servable' IN p.prosrc) > 0)
   FROM pg_proc p WHERE p.proname IN ('issue_4490_hosted_servable_places', 'issue_4490_hosted_servable_places_intersection'))
  AND (SELECT count(*) FROM pg_proc WHERE proname IN ('issue_4490_hosted_servable_places', 'issue_4490_hosted_servable_places_intersection')) = 2,
  'A-2 wrappers: definer, no clock in the order, bookable + internal + place-rule checks, one overload each');

-- ---------------------------------------------------------------------------
-- E (fix round 1, W5-N2): the wrappers now start from the bookable venues near
-- the request instead of running the base RPC with no row cap. E-1 / E-2 prove
-- the rows are EXACTLY "base RPC with no row cap, restricted to bookable verified
-- venues of live non-internal brands, ordered score DESC, reviews DESC NULLS
-- LAST, place id ASC, top 6" (the former wrapper body) over a grid of arguments.
-- FAILS-ON-REVERT: a wrapper that drops a guardrail (floor, radius / circles,
-- exclusions, place rule, price filter) differs from the reference somewhere on
-- the grid.
-- ---------------------------------------------------------------------------
-- More hosted venues with mixed place quality and a price range, so the grid
-- exercises the place rule and the price filter.
INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable, stored_photo_urls, review_count)
VALUES
  ('44946000-0000-4000-a000-0000000000c1', 'W5 not servable', 6.45, 3.40, true, false, ARRAY['https://example.test/c1.jpg'], 5),
  ('44946000-0000-4000-a000-0000000000c2', 'W5 failed photo', 6.45, 3.40, true, true, ARRAY['__backfill_failed__'], 5),
  ('44946000-0000-4000-a000-0000000000c3', 'W5 inactive', 6.45, 3.40, false, true, ARRAY['https://example.test/c3.jpg'], 5),
  ('44946000-0000-4000-a000-0000000000c4', 'W5 no photos', 6.45, 3.40, true, true, NULL, 5);
INSERT INTO public.place_scores (place_id, signal_id, score)
SELECT p, s, 160 FROM unnest(ARRAY['44946000-0000-4000-a000-0000000000c1', '44946000-0000-4000-a000-0000000000c2',
  '44946000-0000-4000-a000-0000000000c3', '44946000-0000-4000-a000-0000000000c4']::uuid[]) p,
  unnest(ARRAY['t4490w5', 't4490w5b']) s;
INSERT INTO public.place_scores (place_id, signal_id, score)
SELECT place, 't4490w5b', 300 - score FROM t4490w5_fx;
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code, place_pool_id)
SELECT ('44946000-0000-4000-b000-0000000000c' || n)::uuid, '44946000-0000-4000-9000-000000000010', 'w5c' || n, 'W5 c' || n,
  6.45, 3.40, 'restaurant', 'verified', 'NG', ('44946000-0000-4000-a000-0000000000c' || n)::uuid
FROM generate_series(1, 4) n;
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
SELECT '44946000-0000-4000-9000-000000000010', ('44946000-0000-4000-b000-0000000000c' || n)::uuid, true FROM generate_series(1, 4) n
ON CONFLICT (venue_id) DO UPDATE SET reservations_enabled = true;
SELECT public.t4490w5_as('44946000-0000-4000-8000-000000000001');
SELECT public.issue_4490_set_venue_feature(('44946000-0000-4000-b000-0000000000c' || n)::uuid, 'table_reservations', true,
  NULL, NULL, NULL, 'w5-tables-c' || n) FROM generate_series(1, 4) n;
SELECT public.t4490w5_reset();

-- The former wrapper body, kept here as the reference.
CREATE FUNCTION pg_temp.t4490w5_ref_solo(p_signal text, p_floor numeric, p_lat float8, p_lng float8, p_radius float8,
  p_exclude uuid[], p_min bigint, p_max bigint, p_currency character)
RETURNS TABLE (place_id uuid, signal_score numeric, venue_id uuid, ord bigint) LANGUAGE sql AS $f$
  SELECT s.place_id, s.signal_score, v.id, row_number() OVER (ORDER BY s.signal_score DESC, s.review_count DESC NULLS LAST, s.place_id ASC)
  FROM public.issue_1384_query_servable_places_by_signal(p_signal, p_floor, p_lat, p_lng, p_radius, p_exclude,
    NULL::integer, p_min, p_max, p_currency, NULL) s
  JOIN public.venue_listings v ON v.place_pool_id = s.place_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE NOT public.admin_brand_is_internal(b.id) AND public.issue_4490_venue_is_bookable(v.id)
  ORDER BY s.signal_score DESC, s.review_count DESC NULLS LAST, s.place_id ASC
  LIMIT 6
$f$;
CREATE FUNCTION pg_temp.t4490w5_ref_inter(p_signal text, p_floor numeric, p_circles jsonb, p_exclude uuid[])
RETURNS TABLE (place_id uuid, signal_score numeric, venue_id uuid, ord bigint) LANGUAGE sql AS $f$
  SELECT s.place_id, s.signal_score, v.id, row_number() OVER (ORDER BY s.signal_score DESC, s.review_count DESC NULLS LAST, s.place_id ASC)
  FROM public.query_servable_places_by_signal_intersection(p_signal, p_floor, p_circles, COALESCE(p_exclude, '{}'::uuid[]), NULL::integer) s
  JOIN public.venue_listings v ON v.place_pool_id = s.place_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE NOT public.admin_brand_is_internal(b.id) AND public.issue_4490_venue_is_bookable(v.id)
  ORDER BY s.signal_score DESC, s.review_count DESC NULLS LAST, s.place_id ASC
  LIMIT 6
$f$;

DO $e$
DECLARE
  g record;
  v_ref text;
  v_new text;
  v_calls integer := 0;
  v_nonempty integer := 0;
BEGIN
  FOR g IN
    SELECT sig.v AS signal, fl.v AS floor, ctr.lat, ctr.lng, rad.v AS radius, ex.v AS exclude, pr.mn, pr.mx, pr.cur
    FROM (VALUES ('t4490w5'), ('t4490w5b')) sig(v)
    CROSS JOIN (VALUES (0::numeric), (120), (128), (131), (170)) fl(v)
    CROSS JOIN (VALUES (6.45::float8, 3.40::float8), (7.50, 3.40), (30.0, 30.0)) ctr(lat, lng)
    CROSS JOIN (VALUES (100::float8), (5000), (50000), (200000)) rad(v)
    CROSS JOIN (VALUES ('{}'::uuid[]), (NULL::uuid[]), (ARRAY['44946000-0000-4000-a000-0000000000a1'::uuid, '44946000-0000-4000-a000-0000000000a4'::uuid])) ex(v)
    CROSS JOIN (VALUES (NULL::bigint, NULL::bigint, NULL::character), (0, 100000000, 'NGN'), (NULL, NULL, 'GBP')) pr(mn, mx, cur)
  LOOP
    SELECT COALESCE(string_agg(place_id::text || '/' || signal_score || '/' || venue_id, ',' ORDER BY ord), '') INTO v_ref
    FROM pg_temp.t4490w5_ref_solo(g.signal, g.floor, g.lat, g.lng, g.radius, g.exclude, g.mn, g.mx, g.cur);
    SELECT COALESCE(string_agg(h.place_id::text || '/' || h.signal_score || '/' || h.venue_id, ',' ORDER BY h.ord), '') INTO v_new
    FROM public.issue_4490_hosted_servable_places(jsonb_build_array(jsonb_build_object('signal_id', g.signal, 'filter_min', g.floor)),
      g.lat, g.lng, g.radius, g.exclude, g.mn, g.mx, g.cur, NULL) WITH ORDINALITY h(place_id, google_place_id, name, address, lat, lng,
      rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, photos,
      stored_photo_urls, types, primary_type, generative_summary, signal_score, signal_contributions, ai_reasoning,
      ai_score_raw, venue_id, signal_id, filter_min, ord);
    IF v_ref IS DISTINCT FROM v_new THEN
      RAISE EXCEPTION 'T4490W5 FAIL: E-1 solo differs at %: ref=% new=%', row_to_json(g), v_ref, v_new;
    END IF;
    v_calls := v_calls + 1;
    IF v_ref <> '' THEN v_nonempty := v_nonempty + 1; END IF;
  END LOOP;
  IF v_nonempty < 20 THEN RAISE EXCEPTION 'T4490W5 FAIL: E-1 grid too thin (% non-empty)', v_nonempty; END IF;
  RAISE NOTICE 'PASS  E-1 solo wrapper equals the former base-RPC wrapper over % argument sets (% non-empty)', v_calls, v_nonempty;

  v_calls := 0; v_nonempty := 0;
  FOR g IN
    SELECT sig.v AS signal, fl.v AS floor, ci.v AS circles, ex.v AS exclude
    FROM (VALUES ('t4490w5'), ('t4490w5b')) sig(v)
    CROSS JOIN (VALUES (0::numeric), (120), (128), (131), (170)) fl(v)
    CROSS JOIN (VALUES ('[{"lat":6.45,"lng":3.40,"radius_m":20000},{"lat":6.46,"lng":3.41,"radius_m":20000}]'::jsonb),
                       ('[{"lat":6.45,"lng":3.40,"radius_m":500}]'),
                       ('[{"lat":7.50,"lng":3.40,"radius_m":5000}]'),
                       ('[{"lat":6.45,"lng":3.40,"radius_m":20000},{"lat":7.50,"lng":3.40,"radius_m":20000}]'),
                       ('[{"lat":6.45,"lng":3.40}]'),
                       ('[]'), (NULL::jsonb)) ci(v)
    CROSS JOIN (VALUES ('{}'::uuid[]), (NULL::uuid[]), (ARRAY['44946000-0000-4000-a000-0000000000a2'::uuid])) ex(v)
  LOOP
    SELECT COALESCE(string_agg(place_id::text || '/' || signal_score || '/' || venue_id, ',' ORDER BY ord), '') INTO v_ref
    FROM pg_temp.t4490w5_ref_inter(g.signal, g.floor, g.circles, g.exclude);
    SELECT COALESCE(string_agg(h.place_id::text || '/' || h.signal_score || '/' || h.venue_id, ',' ORDER BY h.ord), '') INTO v_new
    FROM public.issue_4490_hosted_servable_places_intersection(jsonb_build_array(jsonb_build_object('signal_id', g.signal, 'filter_min', g.floor)),
      g.circles, g.exclude) WITH ORDINALITY h(place_id, google_place_id, name, address, lat, lng,
      rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, photos,
      stored_photo_urls, types, primary_type, generative_summary, signal_score, signal_contributions, ai_reasoning,
      ai_score_raw, venue_id, signal_id, filter_min, ord);
    IF v_ref IS DISTINCT FROM v_new THEN
      RAISE EXCEPTION 'T4490W5 FAIL: E-2 intersection differs at %: ref=% new=%', row_to_json(g), v_ref, v_new;
    END IF;
    v_calls := v_calls + 1;
    IF v_ref <> '' THEN v_nonempty := v_nonempty + 1; END IF;
  END LOOP;
  IF v_nonempty < 20 THEN RAISE EXCEPTION 'T4490W5 FAIL: E-2 grid too thin (% non-empty)', v_nonempty; END IF;
  RAISE NOTICE 'PASS  E-2 intersection wrapper equals the former base-RPC wrapper over % argument sets (% non-empty)', v_calls, v_nonempty;
END
$e$;

-- M (fix round 1, W5-N2 c): one call answers every (signal, floor) of a request;
-- each pair's rows equal a call for that pair alone, and a bad entry is ignored.
SELECT public.t4490w5_ok(
  (SELECT string_agg(signal_id || ':' || filter_min || ':' || place_id, ',' ORDER BY signal_id, filter_min, ord)
   FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120},{"signal_id":"t4490w5b","filter_min":150},{"signal_id":"t4490w5","filter_min":120},{"filter_min":1},"x"]',
     6.45, 3.40, 50000) WITH ORDINALITY h(place_id, google_place_id, name, address, lat, lng,
      rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, photos,
      stored_photo_urls, types, primary_type, generative_summary, signal_score, signal_contributions, ai_reasoning,
      ai_score_raw, venue_id, signal_id, filter_min, ord))
  = (SELECT string_agg(x, ',' ORDER BY k, ord) FROM (
       SELECT 1 k, ord, 't4490w5:120:' || place_id x FROM pg_temp.t4490w5_ref_solo('t4490w5', 120, 6.45, 3.40, 50000, '{}', NULL, NULL, NULL)
       UNION ALL
       SELECT 2, ord, 't4490w5b:150:' || place_id FROM pg_temp.t4490w5_ref_solo('t4490w5b', 150, 6.45, 3.40, 50000, '{}', NULL, NULL, NULL)) r)
  AND NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_servable_places('{}'::jsonb, 6.45, 3.40, 50000))
  AND NOT EXISTS (SELECT 1 FROM public.issue_4490_hosted_servable_places('[{"signal_id":"t4490w5","filter_min":120}]', 30.0, 30.0, 50000)),
  'M-1 one call answers every (signal, floor) pair, deduped, each equal to that pair alone; bad entries and an area with no venue give nothing');

SELECT public.t4490w5_ok(
  (SELECT NOT is_enabled FROM public.feature_flags WHERE flag_key = 'VENUE_DECK_HOSTED_FIRST'),
  'A-3 VENUE_DECK_HOSTED_FIRST exists and is off');

ROLLBACK;
