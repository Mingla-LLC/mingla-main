-- #4490 Explorer W3 (20280809454490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-DECK-FACTS-PUBLIC-ONLY | issue #4490 | pg_deck_venue_facts answers only for claimed places of verified venues of live, non-internal brands, refuses more than 100 ids, and carries no contact, owner or buyer field; the facts functions behind it are not callable by anon or authenticated.
-- MINGLA-INVARIANT: I-4490-VENUE-BOOKABLE-BY-FEATURE | issue #4490 | a venue is bookable only through a live offer of a switched-on kind (entry, group packages, private hire, by the hour), a live plan with Memberships on, or reservable tables with Table reservations on; rooms alone never count, and a venue offer on a Stay venue counts like any other.
-- MINGLA-INVARIANT: I-4490-CARD-PRICE-IS-PAGE-PRICE | issue #4490 | a card's "from" price per feature is the smallest live price the venue page itself lists; paused offers and paused plans never price a card.
--
-- F facts read. B bookable. P prices. O on today. E events owner (page payload unchanged). A authority.
--
-- FAILS-ON-REVERT: without 20280809454490 every block fails (the functions do not exist).
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490w3_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490W3 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490w3_expect(p_sql text, p_state text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state THEN
      RAISE EXCEPTION 'T4490W3 FAIL: % (expected %, got % %)', p_label, p_state, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490W3 FAIL: % (expected %, no error)', p_label, p_state;
END
$f$;
CREATE FUNCTION public.t4490w3_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;
CREATE FUNCTION public.t4490w3_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490w3_ok(boolean, text), public.t4490w3_expect(text, text, text),
  public.t4490w3_as(uuid), public.t4490w3_reset() TO PUBLIC;

-- ---------------------------------------------------------------------------
-- Fixture: one owner, a live brand (not internal), an internal brand and a
-- deleted brand; places for every venue.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44945000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'w3owner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44945000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at, deleted_at) VALUES
  ('44945000-0000-4000-9000-000000000010', '44945000-0000-4000-8000-000000000001', 'Gameland W3 4490', 'gameland-w3-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now(), NULL),
  ('44945000-0000-4000-9000-000000000020', '44945000-0000-4000-8000-000000000001', 'Staff test W3 4490', 'stafftest-w3-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now(), NULL),
  ('44945000-0000-4000-9000-000000000030', '44945000-0000-4000-8000-000000000001', 'Gone W3 4490', 'gone-w3-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now(), now());
INSERT INTO public.admin_internal_brands (brand_id, is_internal, reason, marked_by) VALUES
  ('44945000-0000-4000-9000-000000000010', false, 'W3 suite: a real venue brand', 'w3-suite'),
  ('44945000-0000-4000-9000-000000000020', true, 'W3 suite: an internal test brand', 'w3-suite'),
  ('44945000-0000-4000-9000-000000000030', false, 'W3 suite: a deleted brand', 'w3-suite');

INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable)
SELECT ('44945000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'W3 place ' || n, 6.45, 3.40, true, true
FROM generate_series(1, 14) n;

-- a1 entry (two live prices + a paused cheaper one) + plans; a2 paused only;
-- a3 tables; a4 unverified; a5 internal brand; a6 deleted brand; a7 stay with
-- a day pass; a8 stay with rooms only; a9..a12 on-today cases; a13 no features.
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code, place_pool_id) VALUES
  ('44945000-0000-4000-9000-0000000000a1', '44945000-0000-4000-9000-000000000010', 'w3entry', 'W3 Entry', 6.45, 3.40, 'play', 'verified', 'NG', '44945000-0000-4000-a000-000000000001'),
  ('44945000-0000-4000-9000-0000000000a2', '44945000-0000-4000-9000-000000000010', 'w3paused', 'W3 Paused', 6.45, 3.40, 'play', 'verified', 'NG', '44945000-0000-4000-a000-000000000002'),
  ('44945000-0000-4000-9000-0000000000a3', '44945000-0000-4000-9000-000000000010', 'w3tables', 'W3 Tables', 6.45, 3.40, 'restaurant', 'verified', 'NG', '44945000-0000-4000-a000-000000000003'),
  ('44945000-0000-4000-9000-0000000000a4', '44945000-0000-4000-9000-000000000010', 'w3pending', 'W3 Pending', 6.45, 3.40, 'play', 'pending_review', 'NG', '44945000-0000-4000-a000-000000000004'),
  ('44945000-0000-4000-9000-0000000000a5', '44945000-0000-4000-9000-000000000020', 'w3internal', 'W3 Internal', 6.45, 3.40, 'play', 'verified', 'NG', '44945000-0000-4000-a000-000000000005'),
  ('44945000-0000-4000-9000-0000000000a6', '44945000-0000-4000-9000-000000000030', 'w3gone', 'W3 Gone', 6.45, 3.40, 'play', 'verified', 'NG', '44945000-0000-4000-a000-000000000006'),
  ('44945000-0000-4000-9000-0000000000a7', '44945000-0000-4000-9000-000000000010', 'w3staypass', 'W3 Stay Pass', 6.45, 3.40, 'stay', 'verified', 'NG', '44945000-0000-4000-a000-000000000007'),
  ('44945000-0000-4000-9000-0000000000a8', '44945000-0000-4000-9000-000000000010', 'w3stayrooms', 'W3 Stay Rooms', 6.45, 3.40, 'stay', 'verified', 'NG', '44945000-0000-4000-a000-000000000008'),
  ('44945000-0000-4000-9000-0000000000a9', '44945000-0000-4000-9000-000000000010', 'w3ontonight', 'W3 On Tonight', 6.45, 3.40, 'club', 'verified', 'NG', '44945000-0000-4000-a000-000000000009'),
  ('44945000-0000-4000-9000-0000000000aa', '44945000-0000-4000-9000-000000000010', 'w3aftercut', 'W3 After Cut', 6.45, 3.40, 'club', 'verified', 'NG', '44945000-0000-4000-a000-000000000010'),
  ('44945000-0000-4000-9000-0000000000ab', '44945000-0000-4000-9000-000000000010', 'w3livenow', 'W3 Live Now', 6.45, 3.40, 'club', 'verified', 'NG', '44945000-0000-4000-a000-000000000011'),
  ('44945000-0000-4000-9000-0000000000ac', '44945000-0000-4000-9000-000000000010', 'w3eventsoff', 'W3 Events Off', 6.45, 3.40, 'club', 'verified', 'NG', '44945000-0000-4000-a000-000000000012'),
  ('44945000-0000-4000-9000-0000000000ad', '44945000-0000-4000-9000-000000000010', 'w3nothing', 'W3 Nothing', 6.45, 3.40, 'cafe', 'verified', 'NG', '44945000-0000-4000-a000-000000000013');

CREATE TEMP TABLE t4490w3_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490w3_ids TO PUBLIC;

-- An entry offer helper (owner context): pool, one price, every day, publish.
CREATE FUNCTION pg_temp.t4490w3_entry(p_venue uuid, p_key text, p_price bigint)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', p_venue,
    jsonb_build_object('name', 'Pool ' || p_key, 'dailyLimit', 50, 'keptForWalkIns', 0), NULL, 'w3-pool-' || p_key);
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', p_venue,
    jsonb_build_object('kind', 'entry', 'name', 'Entry ' || p_key, 'entryStyle', 'walk_in'), NULL, 'w3-o1-' || p_key);
  v_offer := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('set_pool', p_venue, jsonb_build_object('offerId', v_offer, 'poolId', v_pool),
    (v->>'version')::bigint, 'w3-o2-' || p_key);
  v := public.issue_4490_manage_offer('upsert_price_option', p_venue, jsonb_build_object('offerId', v_offer, 'name', 'Walk-in',
    'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', p_price), (v->>'version')::bigint, 'w3-o3-' || p_key);
  v := public.issue_4490_manage_offer('set_policy', p_venue, jsonb_build_object('offerId', v_offer),
    (v->>'version')::bigint, 'w3-o4-' || p_key);
  v := public.issue_4490_manage_offer('set_schedule', p_venue, jsonb_build_object('offerId', v_offer,
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '09:00', 'endTime', '21:00'),
    (v->>'version')::bigint, 'w3-o5-' || p_key);
  v := public.issue_4490_manage_offer('publish', p_venue, jsonb_build_object('offerId', v_offer),
    (v->>'version')::bigint, 'w3-o6-' || p_key);
  RETURN v_offer;
END
$f$;
CREATE FUNCTION pg_temp.t4490w3_event(p_venue uuid, p_slug text, p_visibility text, p_start timestamptz, p_end timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_ev uuid;
BEGIN
  INSERT INTO public.events (brand_id, title, slug, event_type, visibility, status, timezone, currency, venue_id)
  VALUES ('44945000-0000-4000-9000-000000000010', 'Night ' || p_slug, p_slug, 'event', p_visibility, 'scheduled',
          'Africa/Lagos', 'NGN', p_venue)
  RETURNING id INTO v_ev;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_ev, p_start, p_end, 'Africa/Lagos', true);
  RETURN v_ev;
END
$f$;

SELECT public.t4490w3_as('44945000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44945000-0000-4000-9000-0000000000a1';
  a2 uuid := '44945000-0000-4000-9000-0000000000a2';
  a7 uuid := '44945000-0000-4000-9000-0000000000a7';
  v jsonb;
  v_paused uuid;
  v_plan uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', true, NULL, NULL, NULL, 'w3-a1-entry');
  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'w3-a1-members');
  PERFORM public.issue_4490_set_venue_feature(a1, 'events_here', true, NULL, NULL, NULL, 'w3-a1-events');
  PERFORM pg_temp.t4490w3_entry(a1, 'a1-dear', 500000);
  PERFORM pg_temp.t4490w3_entry(a1, 'a1-cheap', 400000);
  v_paused := pg_temp.t4490w3_entry(a1, 'a1-paused', 100000);
  v := public.issue_4490_manage_offer('pause', a1, jsonb_build_object('offerId', v_paused),
    (SELECT version FROM public.stay_offerings WHERE id = v_paused), 'w3-a1-pause');
  INSERT INTO t4490w3_ids VALUES ('a1_paused', v_paused);
  -- Plans: a live monthly plan at 25,000, a cheaper one left paused.
  v := public.issue_4490_manage_membership_plan('create', a1, jsonb_build_object('name', 'Hot desk',
    'inclusions', jsonb_build_array('Every weekday'), 'priceMinor', 2500000), NULL, 'w3-plan-a');
  v := public.issue_4490_manage_membership_plan('publish', a1, jsonb_build_object('planId', (v->>'id')::uuid), 1, 'w3-plan-a-pub');
  v := public.issue_4490_manage_membership_plan('create', a1, jsonb_build_object('name', 'Cheap desk',
    'inclusions', jsonb_build_array('Weekends'), 'priceMinor', 900000), NULL, 'w3-plan-b');
  INSERT INTO t4490w3_ids VALUES ('a1_draft_plan', (v->>'id')::uuid);

  -- a2: the only offer is paused.
  PERFORM public.issue_4490_set_venue_feature(a2, 'entry', true, NULL, NULL, NULL, 'w3-a2-entry');
  v_paused := pg_temp.t4490w3_entry(a2, 'a2-only', 300000);
  v := public.issue_4490_manage_offer('pause', a2, jsonb_build_object('offerId', v_paused),
    (SELECT version FROM public.stay_offerings WHERE id = v_paused), 'w3-a2-pause');

  -- a7: a Stay venue with a day pass (features on Stay venues, 07 item J).
  PERFORM public.issue_4490_set_venue_feature(a7, 'entry', true, NULL, NULL, NULL, 'w3-a7-entry');
  PERFORM pg_temp.t4490w3_entry(a7, 'a7-pass', 1500000);

  -- a9..ac: Events here on (ac keeps it off).
  PERFORM public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000a9', 'events_here', true, NULL, NULL, NULL, 'w3-a9-ev');
  PERFORM public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000aa', 'events_here', true, NULL, NULL, NULL, 'w3-aa-ev');
  PERFORM public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000ab', 'events_here', true, NULL, NULL, NULL, 'w3-ab-ev');
  -- a3: Table reservations on.
  PERFORM public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000a3', 'table_reservations', true, NULL, NULL, NULL, 'w3-a3-tables');
  -- a4/a5/a6: an entry offer each (they must still never be listed).
  PERFORM public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000a5', 'entry', true, NULL, NULL, NULL, 'w3-a5-entry');
  PERFORM pg_temp.t4490w3_entry('44945000-0000-4000-9000-0000000000a5', 'a5', 200000);
END
$fx$;
SELECT public.t4490w3_reset();

-- Tables: reservable through the existing switch.
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
VALUES ('44945000-0000-4000-9000-000000000010', '44945000-0000-4000-9000-0000000000a3', true)
ON CONFLICT (venue_id) DO UPDATE SET reservations_enabled = true;

-- a8: a Stay venue whose only inventory is a live room.
INSERT INTO public.stay_settings (venue_id, brand_id, booking_state)
VALUES ('44945000-0000-4000-9000-0000000000a8', '44945000-0000-4000-9000-000000000010', 'draft');
INSERT INTO public.stay_offerings (venue_id, brand_id, kind, name, status, confirmation_mode, inventory_basis, quantity, max_adults, max_children)
VALUES ('44945000-0000-4000-9000-0000000000a8', '44945000-0000-4000-9000-000000000010', 'room', 'Garden room', 'live', 'instant', 'pooled_units', 3, 2, 0);

-- On today: the next 05:00 in Lagos after now, computed independently of the function.
CREATE TEMP TABLE t4490w3_cut ON COMMIT DROP AS
SELECT min(t AT TIME ZONE 'Africa/Lagos') AS cut
FROM generate_series(date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') - interval '1 day' + interval '5 hours',
                     date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') + interval '2 days' + interval '5 hours',
                     interval '1 day') t
WHERE (t AT TIME ZONE 'Africa/Lagos') > now();
GRANT SELECT ON t4490w3_cut TO PUBLIC;

-- a9: one public event one minute before the cut, one private event soon (ignored).
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000a9', 'w3-before-cut', 'public',
  (SELECT cut FROM t4490w3_cut) - interval '1 minute', (SELECT cut FROM t4490w3_cut) + interval '3 hours');
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000a9', 'w3-private-soon', 'private',
  now() + interval '2 minutes', now() + interval '1 hour');
-- aa: one public event one minute after the cut.
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000aa', 'w3-after-cut', 'public',
  (SELECT cut FROM t4490w3_cut) + interval '1 minute', (SELECT cut FROM t4490w3_cut) + interval '3 hours');
-- ab: an event running now (started an hour ago, ends in an hour).
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000ab', 'w3-live-now', 'public',
  now() - interval '1 hour', now() + interval '1 hour');
-- ac: Events here off, an event soon.
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000ac', 'w3-events-off', 'public',
  now() + interval '5 minutes', now() + interval '1 hour');
-- a1: six future events plus a past one (the page payload's events block).
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000a1', 'w3-a1-ev-' || n, 'public',
  now() + make_interval(days => n + 1), now() + make_interval(days => n + 1, hours => 3))
FROM generate_series(1, 7) n;
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000a1', 'w3-a1-past', 'public',
  now() - interval '2 days', now() - interval '2 days' + interval '3 hours');

-- Everything below reads as anon, as the deck does.
CREATE TEMP TABLE t4490w3_facts ON COMMIT DROP AS SELECT NULL::uuid AS place_pool_id, NULL::jsonb AS facts WHERE false;
GRANT ALL ON t4490w3_facts TO PUBLIC;
SELECT public.t4490w3_as(NULL);
INSERT INTO t4490w3_facts
SELECT * FROM public.pg_deck_venue_facts(ARRAY(
  SELECT ('44945000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 14) n));
SELECT public.t4490w3_reset();

CREATE FUNCTION pg_temp.t4490w3_f(p_place int) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT facts FROM t4490w3_facts WHERE place_pool_id = ('44945000-0000-4000-a000-0000000000' || lpad(p_place::text, 2, '0'))::uuid
$f$;

-- F: which places answer.
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(1) IS NOT NULL AND pg_temp.t4490w3_f(1)->>'venueSlug' = 'w3entry'
  AND pg_temp.t4490w3_f(1)->>'brandSlug' = 'gameland-w3-4490',
  'F-1 a verified venue of a live brand answers as anon with its slugs');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(4) IS NULL, 'F-2 an unverified venue is absent');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(5) IS NULL, 'F-3 a venue of an internal brand is absent (I-4174)');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(6) IS NULL, 'F-4 a venue of a deleted brand is absent');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(14) IS NULL, 'F-5 a place with no venue is absent');
SELECT public.t4490w3_ok((SELECT count(*) FROM t4490w3_facts) = 10, 'F-6 exactly one row per answering place');
SELECT public.t4490w3_ok(
  (SELECT bool_and(NOT (facts ?| ARRAY['contactEmail', 'contactPhone', 'email', 'phone', 'accountId', 'ownerId', 'address']))
   FROM t4490w3_facts),
  'F-7 no contact, owner or address field on any row');
SELECT public.t4490w3_ok(
  (SELECT bool_and(facts ?& ARRAY['venueId', 'brandSlug', 'brandName', 'venueSlug', 'venueType', 'features', 'isBookable',
     'priceFrom', 'currencyCode', 'minorUnitExponent', 'onTodayStartsAt', 'onTodayLive']) FROM t4490w3_facts),
  'F-8 every row carries the spec''s card facts');
SELECT public.t4490w3_as(NULL);
SELECT public.t4490w3_expect($q$SELECT * FROM public.pg_deck_venue_facts(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 101)))$q$,
  '22023', 'F-9 more than 100 ids are refused');
SELECT public.t4490w3_ok((SELECT count(*) FROM public.pg_deck_venue_facts(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 100)))) = 0,
  'F-10 exactly 100 unknown ids answer with no rows');
SELECT public.t4490w3_ok((SELECT count(*) FROM public.pg_deck_venue_facts(NULL)) = 0
  AND (SELECT count(*) FROM public.pg_deck_venue_facts('{}'::uuid[])) = 0,
  'F-11 no ids answer with no rows');
SELECT public.t4490w3_reset();

-- B: bookable per feature set.
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(1)->>'isBookable')::boolean, 'B-1 a live entry offer makes a venue bookable');
SELECT public.t4490w3_ok(NOT (pg_temp.t4490w3_f(2)->>'isBookable')::boolean, 'B-2 a paused offer alone does not');
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(3)->>'isBookable')::boolean AND (pg_temp.t4490w3_f(3)->>'tablesReservable')::boolean,
  'B-3 reservable tables with Table reservations on make a venue bookable');
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(7)->>'isBookable')::boolean AND pg_temp.t4490w3_f(7)->>'venueType' = 'stay',
  'B-4 a day pass on a Stay venue makes it bookable');
SELECT public.t4490w3_ok(NOT (pg_temp.t4490w3_f(8)->>'isBookable')::boolean,
  'B-5 a Stay with rooms only is not bookable (decision 2)');
SELECT public.t4490w3_ok(NOT (pg_temp.t4490w3_f(13)->>'isBookable')::boolean, 'B-6 a venue with nothing switched on is not bookable');
SELECT public.t4490w3_ok(public.issue_4490_venue_is_bookable('44945000-0000-4000-9000-0000000000a1')
  AND NOT public.issue_4490_venue_is_bookable('44945000-0000-4000-9000-0000000000a4')
  AND NOT public.issue_4490_venue_is_bookable('44945000-0000-4000-9000-0000000000a6')
  AND NOT public.issue_4490_venue_is_bookable(gen_random_uuid()),
  'B-7 unverified, deleted-brand and unknown venues are never bookable');
UPDATE public.venue_reservation_settings SET reservations_enabled = false WHERE venue_id = '44945000-0000-4000-9000-0000000000a3';
SELECT public.t4490w3_ok(NOT public.issue_4490_venue_is_bookable('44945000-0000-4000-9000-0000000000a3'),
  'B-8 tables that are switched off at the reservation switch do not count');
UPDATE public.venue_reservation_settings SET reservations_enabled = true WHERE venue_id = '44945000-0000-4000-9000-0000000000a3';
-- Memberships alone: switch entry off at a1, the live plan still makes it bookable.
SELECT public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000a1', 'entry', false, NULL, NULL, NULL, 'w3-a1-entry-off')
FROM (SELECT public.t4490w3_as('44945000-0000-4000-8000-000000000001')) s;
SELECT public.t4490w3_reset();
SELECT public.t4490w3_ok(public.issue_4490_venue_is_bookable('44945000-0000-4000-9000-0000000000a1')
  AND (public.issue_4490_venue_card_facts('44945000-0000-4000-9000-0000000000a1')->'priceFrom'->>'entry') IS NULL,
  'B-9 a live plan with Memberships on keeps a venue bookable; Entry off drops its price');
SELECT public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'w3-a1-entry-on')
FROM (SELECT public.t4490w3_as('44945000-0000-4000-8000-000000000001')) s;
SELECT public.t4490w3_reset();
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_OFFERS_READS';
SELECT public.t4490w3_ok(NOT public.issue_4490_venue_is_bookable('44945000-0000-4000-9000-0000000000a1')
  AND public.issue_4490_venue_is_bookable('44945000-0000-4000-9000-0000000000a3'),
  'B-10 with offer reads switched off offers and plans stop counting; tables still do');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_OFFERS_READS';

-- P: prices equal the page's own smallest live price per feature.
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(1)->'priceFrom'->>'entry')::bigint = 400000,
  'P-1 entry from is the smallest LIVE entry price (the paused 1,000 is ignored)');
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(1)->'priceFrom'->>'entry')::bigint =
  (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(
     public.pg_public_venue_page('gameland-w3-4490', 'w3entry')->'offers') o WHERE o->>'kind' = 'entry'),
  'P-2 the card''s entry price is the venue page''s own entry price');
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(1)->'priceFrom'->>'memberships')::bigint = 2500000,
  'P-3 plans from is the cheapest live monthly plan (the unpublished cheaper plan is ignored)');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(1)->'priceFrom'->'group_packages' = 'null'::jsonb
  AND pg_temp.t4490w3_f(1)->'priceFrom'->'private_hire' = 'null'::jsonb
  AND pg_temp.t4490w3_f(1)->'priceFrom'->'by_the_hour' = 'null'::jsonb,
  'P-4 a feature with no live offer has no price (never invented)');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(2)->'priceFrom'->'entry' = 'null'::jsonb,
  'P-5 a venue whose only offer is paused has no entry price');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(1)->>'currencyCode' = 'NGN' AND (pg_temp.t4490w3_f(1)->>'minorUnitExponent')::int = 2,
  'P-6 currency and exponent come from the brand');
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(7)->'priceFrom'->>'entry')::bigint = 1500000,
  'P-7 a Stay venue''s day pass prices its card');

-- O: on today / on tonight.
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(9)->>'onTodayStartsAt')::timestamptz = (SELECT cut FROM t4490w3_cut) - interval '1 minute'
  AND NOT (pg_temp.t4490w3_f(9)->>'onTodayLive')::boolean,
  'O-1 an event one minute before the next 05:00 (venue time) is on today; a private event sooner is ignored');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(10)->'onTodayStartsAt' = 'null'::jsonb AND NOT (pg_temp.t4490w3_f(10)->>'onTodayLive')::boolean,
  'O-2 an event one minute after the next 05:00 is not on today');
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(11)->>'onTodayLive')::boolean AND pg_temp.t4490w3_f(11)->'onTodayStartsAt' = 'null'::jsonb,
  'O-3 an event running now is live');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(12)->'onTodayStartsAt' = 'null'::jsonb AND NOT (pg_temp.t4490w3_f(12)->>'onTodayLive')::boolean,
  'O-4 with Events here off nothing is on today');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(9)->>'timezone' = 'Africa/Lagos', 'O-5 the venue''s zone rides with the facts');

-- E: the page payload's events block now reads the lifted owner and is unchanged.
CREATE TEMP TABLE t4490w3_page ON COMMIT DROP AS
SELECT public.pg_public_venue_page('gameland-w3-4490', 'w3entry') AS p;
SELECT public.t4490w3_ok(jsonb_array_length((SELECT p FROM t4490w3_page)->'events'->'upcoming') = 6,
  'E-1 the page lists at most 6 upcoming events');
SELECT public.t4490w3_ok(
  (SELECT array_agg(e->>'title' ORDER BY ord) FROM t4490w3_page, jsonb_array_elements(p->'events'->'upcoming') WITH ORDINALITY x(e, ord))
  = ARRAY['Night w3-a1-ev-1', 'Night w3-a1-ev-2', 'Night w3-a1-ev-3', 'Night w3-a1-ev-4', 'Night w3-a1-ev-5', 'Night w3-a1-ev-6'],
  'E-2 in start order, the past event left out');
SELECT public.t4490w3_ok(
  (SELECT bool_and(e->>'href' = '/e/gameland-w3-4490/' || replace(e->>'title', 'Night ', '')) FROM t4490w3_page, jsonb_array_elements(p->'events'->'upcoming') e),
  'E-3 each row keeps its public path');
SELECT public.t4490w3_ok(jsonb_array_length(public.pg_public_venue_page('gameland-w3-4490', 'w3livenow')->'events'->'upcoming') = 0,
  'E-4 an event running now with no later date is not listed on the page (unchanged)');
SELECT public.t4490w3_ok(
  (SELECT count(*) FROM public.issue_4490_venue_upcoming_events('44945000-0000-4000-9000-0000000000a9', NULL)) = 1,
  'E-5 the lifted owner applies the public predicate');

-- A: authority. Privileges are read from the catalogue (calling a refused
-- definer function from inside an exception block as anon crashed the local
-- PostgreSQL 17 backend once; the catalogue answer is the same fact).
SELECT public.t4490w3_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_venue_card_facts(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_venue_card_facts(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_venue_card_facts(uuid)', 'EXECUTE'),
  'A-1 the card facts function is service-only');
SELECT public.t4490w3_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_venue_is_bookable(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_venue_is_bookable(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.issue_4490_venue_is_bookable(uuid)', 'EXECUTE'),
  'A-2 the bookable function is service-only');
SELECT public.t4490w3_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_venue_upcoming_events(uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_venue_upcoming_events(uuid, timestamptz)', 'EXECUTE'),
  'A-3 the upcoming events function is service-only');
SELECT public.t4490w3_ok(
  NOT has_function_privilege('anon', 'public.issue_4490_venue_page_payload(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4490_venue_page_payload(uuid)', 'EXECUTE'),
  'A-4 the re-emitted page payload stays service-only');
SELECT public.t4490w3_as('44945000-0000-4000-8000-000000000001');
SELECT public.t4490w3_ok((SELECT count(*) FROM public.pg_deck_venue_facts(ARRAY['44945000-0000-4000-a000-000000000001'::uuid])) = 1,
  'A-5 a signed-in user reads the deck facts');
SELECT public.t4490w3_reset();
SELECT public.t4490w3_ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = 'public.pg_deck_venue_facts(uuid[])'::regprocedure),
  'A-6 the anon read is SECURITY DEFINER with an empty search path');

ROLLBACK;
