-- #4490 Explorer W3 (20281203434490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-DECK-FACTS-PUBLIC-ONLY | issue #4490 | pg_deck_venue_facts answers only for claimed places of verified venues of live, non-internal brands, refuses more than 100 ids, and carries no contact, owner or buyer field; the facts functions behind it are not callable by anon or authenticated.
-- MINGLA-INVARIANT: I-4490-VENUE-BOOKABLE-BY-FEATURE | issue #4490 | a venue is bookable only through a live offer of a switched-on kind (entry, group packages, private hire, by the hour), a live plan with Memberships on, or reservable tables with Table reservations on; rooms alone never count, and a venue offer on a Stay venue counts like any other.
-- MINGLA-INVARIANT: I-4490-CARD-PRICE-IS-PAGE-PRICE | issue #4490 | a card's "from" price per feature is the smallest live price the venue page itself lists; paused offers and paused plans never price a card.
--
-- MINGLA-INVARIANT: I-4490-PLAN-PRICE-WITH-PERIOD | issue #4490 | the card's and the page's plan price is the cheapest plan a guest can join today (an instant plan with room, or any request plan), carried with its own period; a card never prices a plan nobody can join.
--
-- F facts read. B bookable. P prices. O on today. E events owner (page payload unchanged). A authority.
-- N W3 fix round 1: N-3 yearly-only plans, N-4 plan period and joinable, N-5 event end times,
-- N-7 busy-time prices, N-8 no guessed zone, N-10 one failing venue keeps its row.
--
-- FAILS-ON-REVERT: without 20281203434490 every block fails (the functions do not exist).
-- Fix round 1: the 454490 body before the fix fails N-3a (no yearly plan price), N-4a (the
-- monthly plan priced a cheaper yearly one), N-5a (no end time), N-7a (base price only),
-- N-8a (UTC claimed) and N-10a (the whole batch raised).
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
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(5) IS NULL, 'F-3 a venue of an internal brand is absent (#4174)');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(6) IS NULL, 'F-4 a venue of a deleted brand is absent');
SELECT public.t4490w3_ok(pg_temp.t4490w3_f(14) IS NULL, 'F-5 a place with no venue is absent');
SELECT public.t4490w3_ok((SELECT count(*) FROM t4490w3_facts) = 10, 'F-6 exactly one row per answering place');
SELECT public.t4490w3_ok(
  (SELECT bool_and(NOT (facts ?| ARRAY['contactEmail', 'contactPhone', 'email', 'phone', 'accountId', 'ownerId', 'address']))
   FROM t4490w3_facts),
  'F-7 no contact, owner or address field on any row');
SELECT public.t4490w3_ok(
  (SELECT bool_and(facts ?& ARRAY['venueId', 'brandSlug', 'brandName', 'venueSlug', 'venueType', 'features', 'isBookable',
     'priceFrom', 'currencyCode', 'minorUnitExponent', 'onTodayStartsAt', 'onTodayLive',
     'onTodayEndsAt', 'onTodayLiveUntil', 'plansLive', 'membershipsPeriod']) FROM t4490w3_facts),
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
SELECT public.t4490w3_ok((pg_temp.t4490w3_f(1)->'priceFrom'->>'memberships')::bigint = 2500000
  AND pg_temp.t4490w3_f(1)->>'membershipsPeriod' = 'month',
  'P-3 plans from is the cheapest live plan a guest can join, with its period (the unpublished cheaper plan is ignored)');
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

-- ---------------------------------------------------------------------------
-- N: W3 fix round 1.
-- ---------------------------------------------------------------------------
INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable)
SELECT ('44945000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'W3 place ' || n, 6.45, 3.40, true, true
FROM generate_series(15, 20) n;
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code, place_pool_id) VALUES
  ('44945000-0000-4000-9000-0000000000b5', '44945000-0000-4000-9000-000000000010', 'w3yearonly', 'W3 Year Only', 6.45, 3.40, 'coworking', 'verified', 'NG', '44945000-0000-4000-a000-000000000015'),
  ('44945000-0000-4000-9000-0000000000b6', '44945000-0000-4000-9000-000000000010', 'w3yearcheap', 'W3 Year Cheap', 6.45, 3.40, 'coworking', 'verified', 'NG', '44945000-0000-4000-a000-000000000016'),
  ('44945000-0000-4000-9000-0000000000b7', '44945000-0000-4000-9000-000000000010', 'w3fullplan', 'W3 Full Plan', 6.45, 3.40, 'coworking', 'verified', 'NG', '44945000-0000-4000-a000-000000000017'),
  ('44945000-0000-4000-9000-0000000000b8', '44945000-0000-4000-9000-000000000010', 'w3allfull', 'W3 All Full', 6.45, 3.40, 'coworking', 'verified', 'NG', '44945000-0000-4000-a000-000000000018'),
  ('44945000-0000-4000-9000-0000000000b9', '44945000-0000-4000-9000-000000000010', 'w3busy', 'W3 Busy', 6.45, 3.40, 'play', 'verified', 'NG', '44945000-0000-4000-a000-000000000019'),
  ('44945000-0000-4000-9000-0000000000ba', '44945000-0000-4000-9000-000000000010', 'w3nozone', 'W3 No Zone', 6.45, 3.40, 'club', 'verified', 'ZZ', '44945000-0000-4000-a000-000000000020');

-- An entry offer with one price option carrying extra option fields (busy rules, weekdays).
CREATE FUNCTION pg_temp.t4490w3_entry2(p_venue uuid, p_key text, p_price bigint, p_option jsonb)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', p_venue,
    jsonb_build_object('name', 'Pool ' || p_key, 'dailyLimit', 50, 'keptForWalkIns', 0), NULL, 'w3n-pool-' || p_key);
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', p_venue,
    jsonb_build_object('kind', 'entry', 'name', 'Entry ' || p_key, 'entryStyle', 'walk_in'), NULL, 'w3n-o1-' || p_key);
  v_offer := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('set_pool', p_venue, jsonb_build_object('offerId', v_offer, 'poolId', v_pool),
    (v->>'version')::bigint, 'w3n-o2-' || p_key);
  v := public.issue_4490_manage_offer('upsert_price_option', p_venue, jsonb_build_object('offerId', v_offer, 'name', 'Walk-in',
    'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', p_price) || p_option, (v->>'version')::bigint, 'w3n-o3-' || p_key);
  v := public.issue_4490_manage_offer('set_policy', p_venue, jsonb_build_object('offerId', v_offer),
    (v->>'version')::bigint, 'w3n-o4-' || p_key);
  v := public.issue_4490_manage_offer('set_schedule', p_venue, jsonb_build_object('offerId', v_offer,
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '09:00', 'endTime', '21:00'),
    (v->>'version')::bigint, 'w3n-o5-' || p_key);
  v := public.issue_4490_manage_offer('publish', p_venue, jsonb_build_object('offerId', v_offer),
    (v->>'version')::bigint, 'w3n-o6-' || p_key);
  RETURN v_offer;
END
$f$;
CREATE FUNCTION pg_temp.t4490w3_plan(p_venue uuid, p_key text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_manage_membership_plan('create', p_venue,
    jsonb_build_object('name', 'Plan ' || p_key, 'inclusions', jsonb_build_array('Weekdays')) || p_payload, NULL, 'w3n-plan-' || p_key);
  v := public.issue_4490_manage_membership_plan('publish', p_venue, jsonb_build_object('planId', (v->>'id')::uuid), 1, 'w3n-pub-' || p_key);
  RETURN (v->>'id')::uuid;
END
$f$;
-- One just-joined member on a plan (an instant join holds its place while it waits for payment).
CREATE FUNCTION pg_temp.t4490w3_member(p_plan uuid, p_seed text)
RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.venue_membership_subscriptions (id, plan_id, brand_id, member_name, member_email, member_token_hash,
    qr_token_hash, status, start_on, terms, actor_key_hash, idempotency_key, request_hash)
  VALUES (gen_random_uuid(), p_plan, '44945000-0000-4000-9000-000000000010', 'Member ' || p_seed, p_seed || '@example.test',
    sha256(convert_to('w3n:' || p_seed, 'UTF8')), encode(sha256(convert_to('w3nqr:' || p_seed, 'UTF8')), 'hex'), 'pending',
    current_date, '{}'::jsonb, encode(sha256(convert_to('w3nactor:' || p_seed, 'UTF8')), 'hex'), 'w3n-member-' || p_seed,
    encode(sha256(convert_to('w3nreq:' || p_seed, 'UTF8')), 'hex'));
$f$;

SELECT public.t4490w3_as('44945000-0000-4000-8000-000000000001');
DO $nfx$
DECLARE
  b5 uuid := '44945000-0000-4000-9000-0000000000b5';
  b6 uuid := '44945000-0000-4000-9000-0000000000b6';
  b7 uuid := '44945000-0000-4000-9000-0000000000b7';
  b8 uuid := '44945000-0000-4000-9000-0000000000b8';
  b9 uuid := '44945000-0000-4000-9000-0000000000b9';
BEGIN
  PERFORM public.issue_4490_set_venue_feature(b5, 'memberships', true, NULL, NULL, NULL, 'w3n-b5-m');
  PERFORM pg_temp.t4490w3_plan(b5, 'b5-year', '{"priceMinor": 20000000, "period": "year"}');
  PERFORM public.issue_4490_set_venue_feature(b6, 'memberships', true, NULL, NULL, NULL, 'w3n-b6-m');
  PERFORM pg_temp.t4490w3_plan(b6, 'b6-month', '{"priceMinor": 2500000, "period": "month"}');
  PERFORM pg_temp.t4490w3_plan(b6, 'b6-year', '{"priceMinor": 1000000, "period": "year"}');
  PERFORM public.issue_4490_set_venue_feature(b7, 'memberships', true, NULL, NULL, NULL, 'w3n-b7-m');
  INSERT INTO t4490w3_ids VALUES ('b7_full', pg_temp.t4490w3_plan(b7, 'b7-full', '{"priceMinor": 500000, "maxMembers": 1}'));
  PERFORM pg_temp.t4490w3_plan(b7, 'b7-request', '{"priceMinor": 3000000, "period": "year", "joinMode": "request"}');
  PERFORM public.issue_4490_set_venue_feature(b8, 'memberships', true, NULL, NULL, NULL, 'w3n-b8-m');
  INSERT INTO t4490w3_ids VALUES ('b8_full', pg_temp.t4490w3_plan(b8, 'b8-full', '{"priceMinor": 600000, "maxMembers": 1}'));
  -- Busy times: a busy price below the base on every day; a second offer whose busy rule
  -- is on a day the option never sells (it can never apply); a third whose busy price is higher.
  PERFORM public.issue_4490_set_venue_feature(b9, 'entry', true, NULL, NULL, NULL, 'w3n-b9-e');
  PERFORM pg_temp.t4490w3_entry2(b9, 'b9-cheap-busy', 400000,
    '{"busyRules": [{"weekdays": [0,1,2,3,4,5,6], "from": "10:00", "to": "12:00", "amount_minor": 1000}]}');
  PERFORM pg_temp.t4490w3_entry2(b9, 'b9-never', 300000,
    '{"weekdays": [1], "busyRules": [{"weekdays": [0], "from": "10:00", "to": "12:00", "amount_minor": 10}]}');
  PERFORM pg_temp.t4490w3_entry2(b9, 'b9-dear-busy', 350000,
    '{"busyRules": [{"weekdays": [0,1,2,3,4,5,6], "from": "18:00", "to": "20:00", "amount_minor": 900000}]}');
  PERFORM public.issue_4490_set_venue_feature('44945000-0000-4000-9000-0000000000ba', 'events_here', true, NULL, NULL, NULL, 'w3n-ba-ev');
END
$nfx$;
SELECT public.t4490w3_reset();
SELECT pg_temp.t4490w3_member((SELECT v FROM t4490w3_ids WHERE k = 'b7_full'), 'b7-one');
SELECT pg_temp.t4490w3_member((SELECT v FROM t4490w3_ids WHERE k = 'b8_full'), 'b8-one');
SELECT pg_temp.t4490w3_event('44945000-0000-4000-9000-0000000000ba', 'w3n-nozone-soon', 'public',
  now() + interval '5 minutes', now() + interval '1 hour');

CREATE TEMP TABLE t4490w3_facts2 ON COMMIT DROP AS SELECT NULL::uuid AS place_pool_id, NULL::jsonb AS facts WHERE false;
GRANT ALL ON t4490w3_facts2 TO PUBLIC;
SELECT public.t4490w3_as(NULL);
INSERT INTO t4490w3_facts2
SELECT * FROM public.pg_deck_venue_facts(ARRAY(
  SELECT ('44945000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 20) n));
SELECT public.t4490w3_reset();
CREATE FUNCTION pg_temp.t4490w3_g(p_place int) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT facts FROM t4490w3_facts2 WHERE place_pool_id = ('44945000-0000-4000-a000-0000000000' || lpad(p_place::text, 2, '0'))::uuid
$f$;
CREATE FUNCTION pg_temp.t4490w3_page(p_venue text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.pg_public_venue_page('gameland-w3-4490', p_venue)
$f$;

-- N-3 a venue with only yearly plans prices its card with the yearly plan and its period.
SELECT public.t4490w3_ok((pg_temp.t4490w3_g(15)->'priceFrom'->>'memberships')::bigint = 20000000
  AND pg_temp.t4490w3_g(15)->>'membershipsPeriod' = 'year'
  AND (pg_temp.t4490w3_g(15)->>'plansLive')::boolean AND (pg_temp.t4490w3_g(15)->>'isBookable')::boolean,
  'N-3a only yearly plans: the card carries the yearly plan with period year');
SELECT public.t4490w3_ok((pg_temp.t4490w3_page('w3yearonly')->'memberships'->>'fromMinor')::bigint = 20000000
  AND pg_temp.t4490w3_page('w3yearonly')->'memberships'->>'interval' = 'year',
  'N-3b the page says the same plan and period');

-- N-4 the cheapest joinable plan leads, with its own period; page and card agree.
SELECT public.t4490w3_ok((pg_temp.t4490w3_g(16)->'priceFrom'->>'memberships')::bigint = 1000000
  AND pg_temp.t4490w3_g(16)->>'membershipsPeriod' = 'year',
  'N-4a a yearly plan cheaper than the monthly one leads the card, as a yearly price');
SELECT public.t4490w3_ok((pg_temp.t4490w3_page('w3yearcheap')->'memberships'->>'fromMinor')::bigint
    = (pg_temp.t4490w3_g(16)->'priceFrom'->>'memberships')::bigint
  AND pg_temp.t4490w3_page('w3yearcheap')->'memberships'->>'interval' = pg_temp.t4490w3_g(16)->>'membershipsPeriod',
  'N-4b the page''s plan price and period equal the card''s');
SELECT public.t4490w3_ok((pg_temp.t4490w3_g(17)->'priceFrom'->>'memberships')::bigint = 3000000
  AND pg_temp.t4490w3_g(17)->>'membershipsPeriod' = 'year'
  AND (pg_temp.t4490w3_page('w3fullplan')->'memberships'->>'fromMinor')::bigint = 3000000
  AND (pg_temp.t4490w3_page('w3fullplan')->'memberships'->>'fromJoinable')::boolean,
  'N-4c a full instant plan is skipped; a request plan counts as joinable (page and card)');
SELECT public.t4490w3_ok(pg_temp.t4490w3_g(18)->'priceFrom'->'memberships' = 'null'::jsonb
  AND (pg_temp.t4490w3_g(18)->>'plansLive')::boolean AND (pg_temp.t4490w3_g(18)->>'isBookable')::boolean
  AND NOT (pg_temp.t4490w3_page('w3allfull')->'memberships'->>'fromJoinable')::boolean,
  'N-4d every plan full: the card shows plans with no price; the page says nothing is joinable');

-- N-5 end times ride with the facts.
SELECT public.t4490w3_ok((pg_temp.t4490w3_g(9)->>'onTodayEndsAt')::timestamptz = (SELECT cut FROM t4490w3_cut) + interval '3 hours',
  'N-5a the next date''s end rides with its start');
SELECT public.t4490w3_ok((pg_temp.t4490w3_g(11)->>'onTodayLiveUntil')::timestamptz > now()
  AND (pg_temp.t4490w3_g(11)->>'onTodayLiveUntil')::timestamptz <= now() + interval '1 hour',
  'N-5b a running event says until when');
SELECT public.t4490w3_ok(pg_temp.t4490w3_g(9)->'onTodayLiveUntil' = 'null'::jsonb,
  'N-5c nothing running: no live end');

-- N-7 busy-time prices (W3 fix 2): a busy price counts only where checkout charges it, by the
-- slot's START. b9-cheap-busy's rule (10:00-12:00) holds no start (every window opens 09:00).
SELECT public.t4490w3_ok(
  (SELECT jsonb_object_agg(o->>'name', (o->>'fromMinor')::bigint) FROM jsonb_array_elements(pg_temp.t4490w3_page('w3busy')->'offers') o)
  = '{"Entry b9-cheap-busy": 400000, "Entry b9-never": 300000, "Entry b9-dear-busy": 350000}'::jsonb,
  'N-7a a busy rule that no slot starts in never prices the page; a rule that can never apply does not; a dearer one never raises the from');
SELECT public.t4490w3_ok((pg_temp.t4490w3_g(19)->'priceFrom'->>'entry')::bigint = 300000,
  'N-7b the card''s entry from is the cheapest reachable price (W3-N14: was 1,000, which no checkout charges)');
SELECT public.t4490w3_ok((pg_temp.t4490w3_g(19)->'priceFrom'->>'entry')::bigint =
  (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(pg_temp.t4490w3_page('w3busy')->'offers') o WHERE o->>'kind' = 'entry'),
  'N-7c the card''s entry price is the page''s');

-- ---------------------------------------------------------------------------
-- N-14 (W3 fix 2) "from" is a price checkout really charges. For every fixture offer,
-- the page's fromMinor equals the smallest unit price the REAL quote
-- (issue_4490_quote_offer, service role, smallest allowed party) returns over every slot in
-- the next 14 venue days, read here without the "from" code: windows from the table, and
-- for a flexible day every 15-minute start (off-step starts are refused by checkout itself).
-- Units: per-guest quotes win when the offer has any (W3-N17).
-- ---------------------------------------------------------------------------
INSERT INTO public.place_pool (id, name, lat, lng, is_active, is_servable)
SELECT ('44945000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'W3 place ' || n, 6.45, 3.40, true, true
FROM generate_series(21, 22) n;
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code, place_pool_id) VALUES
  ('44945000-0000-4000-9000-0000000000c1', '44945000-0000-4000-9000-000000000010', 'w3prices', 'W3 Prices', 6.45, 3.40, 'play', 'verified', 'NG', '44945000-0000-4000-a000-000000000021'),
  ('44945000-0000-4000-9000-0000000000c2', '44945000-0000-4000-9000-000000000010', 'w3groups', 'W3 Groups', 6.45, 3.40, 'play', 'verified', 'NG', '44945000-0000-4000-a000-000000000022');

-- One offer: draft, pool (entry and packages), options, policy, schedule step, publish.
CREATE FUNCTION pg_temp.t4490w3_offer(p_venue uuid, p_key text, p_draft jsonb, p_options jsonb, p_steps jsonb)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
  v_offer uuid;
  o jsonb;
  st jsonb;
  n int := 0;
BEGIN
  v := public.issue_4490_manage_offer('create_draft', p_venue, p_draft, NULL, 'w3p-d-' || p_key);
  v_offer := (v->>'id')::uuid;
  IF p_draft->>'kind' IN ('entry', 'group_package') THEN
    v := public.issue_4490_manage_capacity_pool('create', p_venue,
      jsonb_build_object('name', 'Pool ' || p_key, 'dailyLimit', 400, 'keptForWalkIns', 0), NULL, 'w3p-pool-' || p_key);
    v := public.issue_4490_manage_offer('set_pool', p_venue, jsonb_build_object('offerId', v_offer, 'poolId', (v->>'id')::uuid),
      (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-p-' || p_key);
  END IF;
  FOR st IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
    n := n + 1;
    IF st->>'fn' = 'hire' THEN
      v := public.issue_4490_manage_hire(st->>'action', p_venue, (st->'payload') || jsonb_build_object('offerId', v_offer),
        (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-s' || n || '-' || p_key);
    ELSIF st->>'fn' = 'hour' THEN
      v := public.issue_4490_manage_hour(st->>'action', p_venue, (st->'payload') || jsonb_build_object('offerId', v_offer),
        (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-s' || n || '-' || p_key);
    ELSIF st->>'fn' = 'package' THEN
      v := public.issue_4490_manage_package(st->>'action', p_venue, (st->'payload') || jsonb_build_object('offerId', v_offer),
        (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-s' || n || '-' || p_key);
    ELSE
      v := public.issue_4490_manage_offer(st->>'action', p_venue, (st->'payload') || jsonb_build_object('offerId', v_offer),
        (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-s' || n || '-' || p_key);
    END IF;
    IF st->>'action' = 'set_price_row' OR (st->>'action' = 'upsert_price_option') THEN NULL; END IF;
  END LOOP;
  FOR o IN SELECT value FROM jsonb_array_elements(p_options) LOOP
    n := n + 1;
    v := public.issue_4490_manage_offer('upsert_price_option', p_venue, o || jsonb_build_object('offerId', v_offer),
      (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-o' || n || '-' || p_key);
  END LOOP;
  v := public.issue_4490_manage_offer('set_policy', p_venue, jsonb_build_object('offerId', v_offer),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-pol-' || p_key);
  v := public.issue_4490_manage_offer('publish', p_venue, jsonb_build_object('offerId', v_offer),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'w3p-pub-' || p_key);
  IF v->>'status' <> 'live' THEN
    RAISE EXCEPTION 'w3 fixture % not live: %', p_key, v->'readiness';
  END IF;
  INSERT INTO t4490w3_ids VALUES ('px_' || p_key, v_offer);
  RETURN v_offer;
END
$f$;

SELECT public.t4490w3_as('44945000-0000-4000-8000-000000000001');
DO $pfx$
DECLARE
  c1 uuid := '44945000-0000-4000-9000-0000000000c1';
  c2 uuid := '44945000-0000-4000-9000-0000000000c2';
  every jsonb := '[0,1,2,3,4,5,6]'::jsonb;
  walkin jsonb := jsonb_build_array(jsonb_build_object('action', 'set_schedule', 'payload',
    jsonb_build_object('weekdays', '[0,1,2,3,4,5,6]'::jsonb, 'startTime', '09:00', 'endTime', '21:00')));
  v jsonb;
  v_space uuid;
  v_offer uuid;
  v_opt uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(c1, 'entry', true, NULL, NULL, NULL, 'w3p-c1-entry');
  PERFORM public.issue_4490_set_venue_feature(c1, 'private_hire', true, NULL, NULL, NULL, 'w3p-c1-hire');
  PERFORM public.issue_4490_set_venue_feature(c1, 'by_the_hour', true, NULL, NULL, NULL, 'w3p-c1-hour');
  PERFORM public.issue_4490_set_venue_feature(c2, 'group_packages', true, NULL, NULL, NULL, 'w3p-c2-groups');
  -- 1 a cheaper busy rule some sessions DO start in (timed sessions on the hour, 10:00-18:00).
  PERFORM pg_temp.t4490w3_offer(c1, 'hit', '{"kind":"entry","name":"Hit","entryStyle":"timed_session","sessionCapacity":25}',
    jsonb_build_array(jsonb_build_object('name', 'Adult', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 300000,
      'busyRules', jsonb_build_array(jsonb_build_object('weekdays', every, 'from', '12:00', 'to', '14:00', 'amount_minor', 150000)))),
    jsonb_build_array(jsonb_build_object('action', 'set_schedule', 'payload', jsonb_build_object('mode', 'sessions', 'weekdays', every,
      'startTime', '10:00', 'endTime', '18:00', 'sessionMinutes', 60, 'sessionEveryMinutes', 60))));
  -- 2 timed sessions with an option sold only 10:00-11:00 (cheaper) and a dearer evening peak.
  PERFORM pg_temp.t4490w3_offer(c1, 'hours', '{"kind":"entry","name":"Hours","entryStyle":"timed_session","sessionCapacity":25}',
    jsonb_build_array(
      jsonb_build_object('name', 'Any time', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 300000,
        'busyRules', jsonb_build_array(jsonb_build_object('weekdays', every, 'from', '16:00', 'to', '18:00', 'amount_minor', 450000))),
      jsonb_build_object('name', 'Early', 'unit', 'guest', 'guestMin', 1, 'guestMax', 6, 'priceMinor', 220000,
        'startTime', '10:00', 'endTime', '11:00')),
    jsonb_build_array(jsonb_build_object('action', 'set_schedule', 'payload', jsonb_build_object('mode', 'sessions', 'weekdays', every,
      'startTime', '10:00', 'endTime', '18:00', 'sessionMinutes', 30, 'sessionEveryMinutes', 30))));
  -- 3 a weekday-only cheaper option with an ID check (Gameland's Student & NYSC) beside Walk-in.
  PERFORM pg_temp.t4490w3_offer(c1, 'student', '{"kind":"entry","name":"Student","entryStyle":"walk_in"}',
    jsonb_build_array(
      jsonb_build_object('name', 'Walk-in', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 500000),
      jsonb_build_object('name', 'Student & NYSC', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 400000,
        'weekdays', '[0,1,2,3]'::jsonb, 'eligibility', jsonb_build_object('label', 'Student or NYSC ID', 'checkAtGate', true))),
    walkin);
  -- 4 a free option beside a paid one.
  PERFORM pg_temp.t4490w3_offer(c1, 'free', '{"kind":"entry","name":"Free","entryStyle":"walk_in"}',
    jsonb_build_array(
      jsonb_build_object('name', 'Paid', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 200000),
      jsonb_build_object('name', 'Under 5', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 0)),
    walkin);
  -- 5 price versions: the current price replaced by one that starts tomorrow; an old cheaper one expired.
  v_offer := pg_temp.t4490w3_offer(c1, 'versions', '{"kind":"entry","name":"Versions","entryStyle":"walk_in"}',
    jsonb_build_array(jsonb_build_object('name', 'Walk-in', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 500000)),
    walkin);
  -- 6 private hire rows by weekday, per booking, smallest party 50.
  v_space := (public.issue_4490_manage_space('create', c1, '{"name":"W3 Hall","setting":"indoor","capacity_standing":600}'::jsonb, NULL)->>'id')::uuid;
  v_offer := pg_temp.t4490w3_offer(c1, 'hire', '{"kind":"private_hire","name":"Hire"}', '[]'::jsonb, jsonb_build_array(
    jsonb_build_object('fn', 'hire', 'action', 'set_spaces', 'payload', jsonb_build_object('spaceIds', jsonb_build_array(v_space), 'combinationIds', '[]'::jsonb)),
    jsonb_build_object('fn', 'hire', 'action', 'set_price_row', 'payload', jsonb_build_object('name', 'Hall Mon to Thu', 'spaceId', v_space,
      'unit', 'booking', 'guestMin', 50, 'guestMax', 600, 'priceMinor', 350000000, 'weekdays', '[0,1,2,3]'::jsonb)),
    jsonb_build_object('fn', 'hire', 'action', 'set_price_row', 'payload', jsonb_build_object('name', 'Hall Fri and Sat', 'spaceId', v_space,
      'unit', 'booking', 'guestMin', 50, 'guestMax', 600, 'priceMinor', 420000000, 'weekdays', '[4,5]'::jsonb)),
    jsonb_build_object('fn', 'hire', 'action', 'set_sessions', 'payload', jsonb_build_object('sessions', jsonb_build_array(
      jsonb_build_object('label', 'Full day', 'startTime', '10:00', 'endTime', '22:00')), 'weekdays', every)),
    jsonb_build_object('fn', 'hire', 'action', 'set_terms', 'payload', jsonb_build_object('hireCharge', 'hire_fee', 'depositKind', 'percent',
      'depositValue', 5000, 'balanceDueDaysBefore', 14, 'setupMinutes', 60, 'cleanupMinutes', 60, 'damageDepositMinor', 0)),
    jsonb_build_object('fn', 'hire', 'action', 'set_booking', 'payload', jsonb_build_object('mode', 'request',
      'requestResponseHours', 48, 'approvedPaymentMinutes', 4320))));
  -- 7 by the hour 08:00-20:00, 30-minute step, 1 hour shortest: a cheaper rule from 19:30 holds no
  --   start (the last start is 19:00); a cheaper rule 18:00-19:00 does.
  v_space := (public.issue_4490_manage_space('create', c1, '{"name":"W3 Room","setting":"indoor","capacity_seated":10}'::jsonb, NULL)->>'id')::uuid;
  PERFORM pg_temp.t4490w3_offer(c1, 'hour', '{"kind":"by_the_hour","name":"Room"}',
    jsonb_build_array(jsonb_build_object('name', 'Per hour', 'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000,
      'busyRules', jsonb_build_array(
        jsonb_build_object('weekdays', every, 'from', '19:30', 'to', '20:00', 'amount_minor', 100),
        jsonb_build_object('weekdays', every, 'from', '18:00', 'to', '19:00', 'amount_minor', 900000)))),
    jsonb_build_array(
      jsonb_build_object('fn', 'hour', 'action', 'set_place', 'payload', jsonb_build_object('spaceIds', jsonb_build_array(v_space))),
      jsonb_build_object('fn', 'hour', 'action', 'set_hours', 'payload', jsonb_build_object('weekdays', every, 'startTime', '08:00', 'endTime', '20:00')),
      jsonb_build_object('fn', 'hour', 'action', 'set_length', 'payload', jsonb_build_object('stepMinutes', 30, 'minMinutes', 60, 'maxMinutes', 120))));
  -- 8 group packages: per-guest beside a CHEAPER per-booking price (never one minimum, W3-N17),
  --   smallest group 8; and a per-booking-only package.
  PERFORM pg_temp.t4490w3_offer(c2, 'mixed', '{"kind":"group_package","name":"Mixed"}',
    jsonb_build_array(
      jsonb_build_object('name', 'Per guest', 'unit', 'guest', 'guestMin', 8, 'guestMax', 20, 'priceMinor', 1200000),
      jsonb_build_object('name', 'Whole party', 'unit', 'booking', 'guestMin', 8, 'guestMax', 20, 'priceMinor', 1000000)),
    jsonb_build_array(jsonb_build_object('fn', 'package', 'action', 'set_start_times', 'payload',
      jsonb_build_object('startTimes', '["12:00","16:00"]'::jsonb, 'durationMinutes', 180, 'weekdays', every))));
  PERFORM pg_temp.t4490w3_offer(c2, 'party', '{"kind":"group_package","name":"Party"}',
    jsonb_build_array(jsonb_build_object('name', 'Party room', 'unit', 'booking', 'guestMin', 10, 'guestMax', 30, 'priceMinor', 6000000)),
    jsonb_build_array(jsonb_build_object('fn', 'package', 'action', 'set_start_times', 'payload',
      jsonb_build_object('startTimes', '["18:00"]'::jsonb, 'durationMinutes', 180, 'weekdays', every))));
END
$pfx$;
SELECT public.t4490w3_reset();
DO $pver$
DECLARE
  v_offer uuid := (SELECT v FROM t4490w3_ids WHERE k = 'px_versions');
  v_opt uuid;
BEGIN
  SELECT id INTO v_opt FROM public.venue_offer_price_options WHERE offering_id = v_offer;
  UPDATE public.stay_price_versions SET effective_to = now() WHERE price_option_id = v_opt AND effective_to IS NULL;
  INSERT INTO public.stay_price_versions (offering_id, brand_id, venue_id, version_number, amount_minor, currency_code,
    pricing_unit, effective_from, effective_to, price_option_id)
  SELECT p.offering_id, p.brand_id, p.venue_id, p.version_number + 1, 100, p.currency_code, p.pricing_unit,
         now() - interval '10 days', now() - interval '5 days', p.price_option_id
  FROM public.stay_price_versions p WHERE p.price_option_id = v_opt;
  INSERT INTO public.stay_price_versions (offering_id, brand_id, venue_id, version_number, amount_minor, currency_code,
    pricing_unit, effective_from, effective_to, price_option_id)
  SELECT p.offering_id, p.brand_id, p.venue_id, p.version_number + 2, 350000, p.currency_code, p.pricing_unit,
         now() + interval '1 day', NULL, p.price_option_id
  FROM public.stay_price_versions p WHERE p.price_option_id = v_opt AND p.amount_minor = 500000;
END
$pver$;
-- The tester's W3-N14 fixture joins the set.
INSERT INTO t4490w3_ids SELECT 'px_b9_' || o.name, o.id FROM public.stay_offerings o
WHERE o.venue_id = '44945000-0000-4000-9000-0000000000b9' AND o.status = 'live';

-- The real quote over every slot of the next 14 venue days (service role, as the edge calls it).
CREATE FUNCTION pg_temp.t4490w3_quoted(p_offer uuid)
RETURNS TABLE (unit text, price bigint, tries int, ok int)
LANGUAGE plpgsql AS $f$
DECLARE
  o public.stay_offerings%ROWTYPE;
  opt record;
  w record;
  t timestamptz;
  v_win uuid;
  q jsonb;
  n int := 0;
  k int := 0;
  today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
BEGIN
  SELECT * INTO o FROM public.stay_offerings WHERE id = p_offer;
  CREATE TEMP TABLE IF NOT EXISTS t4490w3_q (offer uuid, unit text, price bigint);
  FOR opt IN SELECT * FROM public.venue_offer_price_options x WHERE x.offering_id = p_offer AND x.status = 'active' LOOP
    FOR w IN
      SELECT pw.id, pw.starts_at, pw.ends_at, r.mode
      FROM public.stay_place_windows pw JOIN public.stay_place_schedule_rules r ON r.id = pw.schedule_rule_id
      WHERE pw.offering_id = p_offer AND NOT pw.booked_block AND pw.local_date BETWEEN today - 1 AND today + 14
      ORDER BY pw.starts_at
    LOOP
      FOR t IN SELECT g FROM generate_series(w.starts_at,
                 CASE WHEN w.mode = 'flexible' THEN w.ends_at ELSE w.starts_at END, interval '15 minutes') g LOOP
        n := n + 1;
        BEGIN
          v_win := CASE WHEN w.mode = 'flexible' THEN public.issue_4490_flexible_window(p_offer, t, 60) ELSE w.id END;
          q := public.issue_4490_quote_offer(p_offer, v_win,
            jsonb_build_array(jsonb_build_object('priceOptionId', opt.id, 'guests', opt.guest_min)),
            encode(sha256(convert_to('w3p-actor', 'UTF8')), 'hex'), NULL, 'w3p-q-' || n || '-' || p_offer,
            '[]'::jsonb, CASE WHEN o.kind = 'private_hire' THEN '{"occasion":"Wedding"}'::jsonb ELSE '{}'::jsonb END);
          INSERT INTO t4490w3_q VALUES (p_offer, opt.unit, (q->'lines'->0->>'unitPriceMinor')::bigint);
          k := k + 1;
        EXCEPTION WHEN OTHERS THEN
          NULL;  -- not bookable there (wrong day or time, off the step, too soon, too far, closed)
        END;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN QUERY
    SELECT CASE WHEN bool_or(x.unit = 'guest') THEN 'guest' ELSE (array_agg(x.unit ORDER BY x.price))[1] END,
           COALESCE(min(x.price) FILTER (WHERE x.unit = 'guest'), min(x.price)), n, k
    FROM t4490w3_q x WHERE x.offer = p_offer;
END
$f$;

SELECT public.t4490w3_reset();
SELECT set_config('request.jwt.claim.role', 'service_role', true), set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('role', 'service_role', true);
CREATE TEMP TABLE t4490w3_prop ON COMMIT DROP AS
SELECT i.k, i.v AS offer, q.unit AS q_unit, q.price AS q_min, q.tries, q.ok
FROM t4490w3_ids i CROSS JOIN LATERAL pg_temp.t4490w3_quoted(i.v) q
WHERE i.k LIKE 'px\_%';
SELECT public.t4490w3_reset();
GRANT SELECT ON t4490w3_prop TO PUBLIC;
CREATE TEMP TABLE t4490w3_pagefrom ON COMMIT DROP AS
SELECT (o->>'id')::uuid AS offer, (o->>'fromMinor')::bigint AS page_min, o->>'unit' AS page_unit
FROM (VALUES ('w3prices'), ('w3groups'), ('w3busy')) s(slug)
CROSS JOIN LATERAL jsonb_array_elements(public.pg_public_venue_page('gameland-w3-4490', s.slug)->'offers') o;
GRANT SELECT ON t4490w3_pagefrom TO PUBLIC;

DO $prop$
DECLARE
  r record;
  v_bad text;
BEGIN
  FOR r IN SELECT p.k, p.q_unit, p.q_min, p.tries, p.ok, f.page_min, f.page_unit
           FROM t4490w3_prop p LEFT JOIN t4490w3_pagefrom f ON f.offer = p.offer ORDER BY p.k LOOP
    RAISE NOTICE 'N-14 % : page % %, quotes min % % (% of % slot tries quoted)', r.k, r.page_min, r.page_unit, r.q_min, r.q_unit, r.ok, r.tries;
  END LOOP;
  SELECT string_agg(format('%s page=%s/%s quotes=%s/%s', p.k, f.page_min, f.page_unit, p.q_min, p.q_unit), '; ') INTO v_bad
  FROM t4490w3_prop p LEFT JOIN t4490w3_pagefrom f ON f.offer = p.offer
  WHERE p.ok = 0 OR f.page_min IS DISTINCT FROM p.q_min OR f.page_unit IS DISTINCT FROM p.q_unit;
  PERFORM public.t4490w3_ok(v_bad IS NULL AND (SELECT count(*) FROM t4490w3_prop) = 12,
    'N-14a every fixture''s page "from" (amount and unit) is the smallest unit price the real quote charges in the next 14 days'
    || COALESCE(' -- ' || v_bad, ''));
END
$prop$;
SELECT public.t4490w3_ok(
  (SELECT jsonb_object_agg(replace(p.k, 'px_', ''), f.page_min ORDER BY p.k) FROM t4490w3_prop p JOIN t4490w3_pagefrom f ON f.offer = p.offer)
  = '{"b9_Entry b9-cheap-busy": 400000, "b9_Entry b9-dear-busy": 350000, "b9_Entry b9-never": 300000, "free": 0, "hire": 350000000,
      "hit": 150000, "hour": 900000, "hours": 220000, "mixed": 1200000, "party": 6000000, "student": 400000, "versions": 350000}'::jsonb,
  'N-14b the values: busy rule some sessions start in counts (1,500), one no slot starts in does not (4,000), the option''s own hours, ID-checked weekday price (Student 4,000), free, newest price version, hire row by weekday, hour start rules');
SELECT public.t4490w3_ok(
  (SELECT f.page_unit FROM t4490w3_pagefrom f JOIN t4490w3_ids i ON i.v = f.offer WHERE i.k = 'px_mixed') = 'guest'
  AND (SELECT f.page_unit FROM t4490w3_pagefrom f JOIN t4490w3_ids i ON i.v = f.offer WHERE i.k = 'px_party') = 'booking'
  AND (SELECT f.page_unit FROM t4490w3_pagefrom f JOIN t4490w3_ids i ON i.v = f.offer WHERE i.k = 'px_hire') = 'booking'
  AND (SELECT f.page_unit FROM t4490w3_pagefrom f JOIN t4490w3_ids i ON i.v = f.offer WHERE i.k = 'px_hour') = 'hour',
  'N-17a the unit always belongs to the price: per guest wins over a cheaper per-booking price; a per-booking package says booking');
SELECT public.t4490w3_ok(
  (public.issue_4490_venue_card_facts('44945000-0000-4000-9000-0000000000c2')->'priceFrom'->>'group_packages')::bigint = 1200000
  AND (public.issue_4490_venue_card_facts('44945000-0000-4000-9000-0000000000c1')->'priceFrom'->>'entry')::bigint = 0
  AND (public.issue_4490_venue_card_facts('44945000-0000-4000-9000-0000000000c1')->'priceFrom'->>'by_the_hour')::bigint = 900000,
  'N-17b the card''s groups price is per guest when a per-guest package exists; entry and hour are the page''s');
-- N-16 the Host Offers list carries the same "from" for a live offer.
SELECT public.t4490w3_as('44945000-0000-4000-8000-000000000001');
SELECT public.t4490w3_ok(
  (SELECT bool_and((o->'guestFrom'->>'fromMinor')::bigint = f.page_min AND o->'guestFrom'->>'unit' = f.page_unit)
   FROM jsonb_array_elements(public.issue_4490_list_offers('44945000-0000-4000-9000-0000000000b9')->'offers') o
   JOIN t4490w3_pagefrom f ON f.offer = (o->>'id')::uuid)
  AND (SELECT count(*) FROM jsonb_array_elements(public.issue_4490_list_offers('44945000-0000-4000-9000-0000000000b9')->'offers') o
       WHERE o ? 'guestFrom') = 3,
  'N-16 the Host Offers list carries each live offer''s guest "from", the page''s own value');
SELECT public.t4490w3_reset();
-- The lifted helpers answer exactly as the per-window functions checkout calls.
SELECT public.t4490w3_ok(
  (SELECT bool_and(public.issue_4490_option_price_at(opt.id, w.id) = public.issue_4490_busy_price(opt.busy_rules, pv.amount_minor,
                     w.starts_at AT TIME ZONE r.timezone)
                   AND public.issue_4490_option_window_reason(opt.id, w.id) IS NOT DISTINCT FROM public.issue_4490_option_slot_reason(
                     opt.status, opt.weekdays, opt.local_start_time, opt.local_end_time, w.local_date, w.starts_at AT TIME ZONE r.timezone))
   FROM t4490w3_ids i JOIN public.venue_offer_price_options opt ON opt.offering_id = i.v
   JOIN public.stay_price_versions pv ON pv.price_option_id = opt.id AND pv.effective_to IS NULL
   JOIN public.stay_place_windows w ON w.offering_id = i.v JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
   WHERE i.k LIKE 'px\_%'),
  'N-14c the quote''s per-window price and reason are the lifted helpers'' answers');

-- N-8 no known zone: no "tonight"; the brand's zone is used when it has one.
SELECT public.t4490w3_ok(pg_temp.t4490w3_g(20)->'timezone' = 'null'::jsonb
  AND pg_temp.t4490w3_g(20)->'onTodayStartsAt' = 'null'::jsonb AND NOT (pg_temp.t4490w3_g(20)->>'onTodayLive')::boolean,
  'N-8a a venue with no zone claims nothing about today');
UPDATE public.brands SET default_timezone = 'Africa/Lagos' WHERE id = '44945000-0000-4000-9000-000000000010';
SELECT public.t4490w3_ok(public.issue_4490_venue_card_facts('44945000-0000-4000-9000-0000000000ba')->>'timezone' = 'Africa/Lagos'
  AND public.issue_4490_venue_card_facts('44945000-0000-4000-9000-0000000000ba')->>'onTodayStartsAt' IS NOT NULL,
  'N-8b the brand''s default zone is the fallback');
UPDATE public.brands SET default_timezone = NULL WHERE id = '44945000-0000-4000-9000-000000000010';

-- N-9 one owner for bookable: the card says what issue_4490_venue_is_bookable says.
SELECT public.t4490w3_ok((SELECT bool_and((f.facts->>'isBookable')::boolean = public.issue_4490_venue_is_bookable((f.facts->>'venueId')::uuid))
  FROM t4490w3_facts2 f),
  'N-9 every card''s isBookable equals issue_4490_venue_is_bookable');

-- N-10 one venue whose facts fail keeps its identity row; the rest of the batch is unchanged.
CREATE OR REPLACE FUNCTION public.issue_4490_venue_upcoming_events(p_venue_id uuid, p_until timestamptz)
RETURNS TABLE (event_id uuid, event_type text, title text, slug text, space_id uuid, starts_at timestamptz,
               ends_at timestamptz, live_now boolean, live_until timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  IF p_venue_id = '44945000-0000-4000-9000-0000000000a1' THEN
    RAISE EXCEPTION 'w3 suite: a broken venue';
  END IF;
END
$f$;
CREATE TEMP TABLE t4490w3_facts3 ON COMMIT DROP AS SELECT NULL::uuid AS place_pool_id, NULL::jsonb AS facts WHERE false;
GRANT ALL ON t4490w3_facts3 TO PUBLIC;
SET client_min_messages = error;
SELECT public.t4490w3_as(NULL);
INSERT INTO t4490w3_facts3
SELECT * FROM public.pg_deck_venue_facts(ARRAY(
  SELECT ('44945000-0000-4000-a000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 14) n));
SELECT public.t4490w3_reset();
RESET client_min_messages;
SELECT public.t4490w3_ok((SELECT count(*) FROM t4490w3_facts3) = 10,
  'N-10a the batch still answers every claimed place');
SELECT public.t4490w3_ok((SELECT f.facts->>'venueSlug' = 'w3entry' AND f.facts->>'brandSlug' = 'gameland-w3-4490'
    AND NOT (f.facts->>'isBookable')::boolean AND f.facts->'features' = '[]'::jsonb
    AND f.facts->'priceFrom'->'entry' = 'null'::jsonb
  FROM t4490w3_facts3 f WHERE f.place_pool_id = '44945000-0000-4000-a000-000000000001'),
  'N-10b the failing venue keeps its identity (still claimed) with no chips');
SELECT public.t4490w3_ok((SELECT (f.facts->>'isBookable')::boolean AND (f.facts->>'tablesReservable')::boolean
  FROM t4490w3_facts3 f WHERE f.place_pool_id = '44945000-0000-4000-a000-000000000003'),
  'N-10c a healthy venue in the same batch keeps its facts');

ROLLBACK;
