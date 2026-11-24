\set ON_ERROR_STOP on
-- #4453 milestone 5: executable PostgreSQL 17 proof of the live booking reads
-- (20280807044453). BEGIN ... ROLLBACK: every fixture, and the slot-engine
-- stand-in below, rolls back.
-- MINGLA-INVARIANT: I-SITES-BOOKING-READS-SERVICE-ONLY | issue #4453 | every booking read is static SQL, SECURITY DEFINER with an explicit search_path, and executable by the service role only.
-- MINGLA-INVARIANT: I-SITES-RATINGS-MINGLA-ONLY | issue #4453 | the rating is approved Mingla place reviews of the brand's verified venues, at least 20; Google data never.
-- MINGLA-INVARIANT: I-SITES-ACTIONS-RESOLVE-TO-MINGLA | issue #4453 | every link a booking read returns is this brand's own host.usemingla.com page; a full slot has none.
--
-- T-1  grants and shape: service role only; SECURITY DEFINER; search_path set; no EXECUTE in any body.
-- T-2  SITES_BOOKING_BLOCKS is seeded OFF and read by brand_site_booking_blocks_enabled().
-- T-3  venue slots (SC-B1): the engine's slots only, in the venue's zone; open/few/full; a full slot has no link;
--      an open one pre-fills date, time and party; bad party/days, an unverified venue, reservations off and
--      ANOTHER brand's venue all answer NULL.
-- T-4  ticket tiers (SC-B2): Mingla's order; hidden, disabled, password, door-only and link-only tiers never;
--      a not-yet tier has no link; an on-sale tier links to this event's checkout with the tier seeded;
--      another brand's event is NULL; an ended event comes back 'ended' (the site renders nothing).
-- T-5  rating (SC-B3): 19 approved reviews -> NULL; 20 -> 1-decimal mean; pending/rejected reviews, an
--      unverified venue's place and the Google place rating are never counted.
-- T-6  booking target: a verified venue with reservations on and an upcoming experience; another brand's -> NULL.
-- T-7  offering dates: an event's dates in the window, each linking to its own date; an experience pre-fills date and slot.
-- T-8  stays: with the stay flags off, nights and the stay target are NULL.
--
-- FAILS-ON-REVERT: drop 20280807044453 -> T-1 (functions missing); drop the claim_status filter -> T-3c;
-- drop the ticket_type_links exclusion -> T-4b; drop the 20-review floor -> T-5a.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 booking reads FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- T-1 grants and shape
SELECT pg_temp.p_assert(bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'T-1a every booking read is service-role only')
FROM unnest(ARRAY[
  'public.brand_site_booking_blocks_enabled()', 'public.brand_site_stay_flags_on()',
  'public.brand_site_zone_or_utc(text)', 'public.brand_site_booking_brand(uuid)',
  'public.brand_site_venue_slots(uuid,uuid,integer,integer)', 'public.brand_site_stay_nights(uuid,uuid,integer)',
  'public.brand_site_offering_dates(uuid,uuid,text,integer)', 'public.brand_site_ticket_tiers(uuid,uuid)',
  'public.brand_site_booking_target(uuid,text,uuid)', 'public.brand_site_mingla_rating(uuid)',
  'public.brand_site_date_places_left(uuid,uuid)', 'public.stay_room_night_available(uuid,date)']) AS f;
SELECT pg_temp.p_assert(count(*) = 12 AND bool_and(p.prosecdef)
    AND bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
    AND bool_and(p.prosrc !~* '\mEXECUTE\M'),
  'T-1b SECURITY DEFINER, explicit search_path, static SQL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('brand_site_booking_blocks_enabled', 'brand_site_stay_flags_on',
  'brand_site_zone_or_utc', 'brand_site_booking_brand', 'brand_site_venue_slots', 'brand_site_stay_nights',
  'brand_site_offering_dates', 'brand_site_ticket_tiers', 'brand_site_booking_target', 'brand_site_mingla_rating',
  'brand_site_date_places_left', 'stay_room_night_available');

-- T-2 flag
SELECT pg_temp.p_assert((SELECT NOT is_enabled FROM public.feature_flags WHERE flag_key = 'SITES_BOOKING_BLOCKS')
  AND NOT public.brand_site_booking_blocks_enabled(), 'T-2a SITES_BOOKING_BLOCKS seeded off');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_BOOKING_BLOCKS';
SELECT pg_temp.p_assert(public.brand_site_booking_blocks_enabled(), 'T-2b the flag reads on when on');

-- The slot engine is CALLED, never changed by the migration. For this proof
-- only (rolled back), a stand-in with the engine's exact signature returns a
-- known day: 18:00 six left, 18:30 two left, 19:00 full, all Lagos time.
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
  SELECT ((p_date + t.at) AT TIME ZONE 'Africa/Lagos'), to_char(t.at, 'HH24:MI'), t.left_n, t.full_flag
  FROM (VALUES (time '18:00', 6, false), (time '18:30', 2, false), (time '19:00', 0, true)) AS t(at, left_n, full_flag)
  WHERE p_party_size <= 8;
$stub$;

CREATE TEMP TABLE m5_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;

DO $fixture$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_place uuid := gen_random_uuid();
  v_place_b uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'm5-owner@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_a, v_owner, 'M5 Alpha', 'm5-alpha', 'NGN'), (v_b, v_owner, 'M5 Beta', 'm5-beta', 'NGN');
  INSERT INTO m5_ids VALUES ('brand_a', v_a), ('brand_b', v_b), ('owner', v_owner),
    ('site_a', gen_random_uuid()), ('site_b', gen_random_uuid()),
    ('venue_a', gen_random_uuid()), ('venue_unverified', gen_random_uuid()), ('venue_off', gen_random_uuid()),
    ('venue_b', gen_random_uuid()), ('place_a', v_place), ('place_b', v_place_b),
    ('event_a', gen_random_uuid()), ('event_b', gen_random_uuid()), ('event_ended', gen_random_uuid()),
    ('exp_a', gen_random_uuid());
  INSERT INTO public.brand_sites(id, brand_id, status, created_by)
  SELECT (SELECT v FROM m5_ids WHERE k = 'site_a'), v_a, 'provisioning', v_owner
  UNION ALL SELECT (SELECT v FROM m5_ids WHERE k = 'site_b'), v_b, 'provisioning', v_owner;
  INSERT INTO public.place_pool(id, google_place_id, name, lat, lng) VALUES
    (v_place, 'm5-google-a', 'M5 Alpha Kitchen', 6.45, 3.39), (v_place_b, 'm5-google-b', 'M5 Unverified', 6.46, 3.40);
  INSERT INTO public.venue_listings(id, brand_id, place_pool_id, slug, name, lat, lng, venue_category, claim_status) VALUES
    ((SELECT v FROM m5_ids WHERE k = 'venue_a'), v_a, v_place, 'alphakitchen', 'Alpha Kitchen', 6.45, 3.39, 'restaurant', 'verified'),
    ((SELECT v FROM m5_ids WHERE k = 'venue_unverified'), v_a, v_place_b, 'alphapending', 'Alpha Pending', 6.46, 3.40, 'restaurant', 'pending_review'),
    ((SELECT v FROM m5_ids WHERE k = 'venue_off'), v_a, NULL, 'alphaoff', 'Alpha Off', 6.47, 3.41, 'restaurant', 'verified'),
    ((SELECT v FROM m5_ids WHERE k = 'venue_b'), v_b, NULL, 'betakitchen', 'Beta Kitchen', 6.48, 3.42, 'restaurant', 'verified');
  INSERT INTO public.venue_reservation_settings(brand_id, venue_id, reservations_enabled)
  SELECT v_a, (SELECT v FROM m5_ids WHERE k = 'venue_a'), true
  UNION ALL SELECT v_a, (SELECT v FROM m5_ids WHERE k = 'venue_unverified'), true
  UNION ALL SELECT v_a, (SELECT v FROM m5_ids WHERE k = 'venue_off'), false
  UNION ALL SELECT v_b, (SELECT v FROM m5_ids WHERE k = 'venue_b'), true;
  INSERT INTO public.venue_availability_config(brand_id, venue_id, iana_timezone)
  VALUES (v_a, (SELECT v FROM m5_ids WHERE k = 'venue_a'), 'Africa/Lagos');
END
$fixture$;

-- T-3 venue slots
DO $t3$
DECLARE
  v_site uuid := (SELECT v FROM m5_ids WHERE k = 'site_a');
  v_feed jsonb;
  v_day jsonb;
  v_today text := to_char((now() AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD');
BEGIN
  v_feed := public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_a'), 2, 7);
  PERFORM pg_temp.p_assert(v_feed->>'source' = 'venue_slots' AND v_feed->>'timezone' = 'Africa/Lagos'
    AND jsonb_array_length(v_feed->'days') = 7 AND v_feed->'days'->0->>'local_date' = v_today
    AND v_feed->>'title' = 'Alpha Kitchen', 'T-3a seven days from the venue''s local today, in its zone');
  v_day := v_feed->'days'->0;
  PERFORM pg_temp.p_assert(
    (SELECT array_agg(s->>'state' ORDER BY ord) FROM jsonb_array_elements(v_day->'slots') WITH ORDINALITY AS x(s, ord)) = ARRAY['open', 'few', 'full']
    AND v_day->'slots'->0->>'start_local' = v_today || 'T18:00'
    AND v_day->'slots'->0->>'label' = '18:00'
    AND (v_day->'slots'->1->>'left')::int = 2,
    'T-3b open, few (2 left) and full, at Lagos wall time');
  PERFORM pg_temp.p_assert(v_day->'slots'->2->'href' = 'null'::jsonb
    AND v_day->'slots'->0->>'href' = 'https://host.usemingla.com/b/m5-alpha/v/alphakitchen?tab=book&date=' || v_today || '&time=18:00&party=2',
    'T-3c a full slot is text; an open slot pre-fills date, time and party on the venue page');
  PERFORM pg_temp.p_assert(public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_b'), 2, 7) IS NULL,
    'T-3d another brand''s venue is NULL (no cross-brand read)');
  PERFORM pg_temp.p_assert(public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_unverified'), 2, 7) IS NULL
    AND public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_off'), 2, 7) IS NULL,
    'T-3e an unverified venue and one with reservations off are NULL');
  PERFORM pg_temp.p_assert(public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_a'), 21, 7) IS NULL
    AND public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_a'), 2, 2) IS NULL
    AND public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_a'), 2, 15) IS NULL
    AND public.brand_site_venue_slots(gen_random_uuid(), (SELECT v FROM m5_ids WHERE k = 'venue_a'), 2, 7) IS NULL,
    'T-3f party 21, 2 or 15 days, and an unknown site are NULL');
  v_feed := public.brand_site_venue_slots(v_site, (SELECT v FROM m5_ids WHERE k = 'venue_a'), 9, 3);
  PERFORM pg_temp.p_assert(jsonb_array_length(v_feed->'days') = 3 AND jsonb_array_length(v_feed->'days'->0->'slots') = 0,
    'T-3g only the slots the engine returns (none for a party it cannot seat)');
END
$t3$;

-- T-4 ticket tiers
DO $t4$
DECLARE
  v_site uuid := (SELECT v FROM m5_ids WHERE k = 'site_a');
  v_event uuid := (SELECT v FROM m5_ids WHERE k = 'event_a');
  v_ended uuid := (SELECT v FROM m5_ids WHERE k = 'event_ended');
  v_ga uuid := gen_random_uuid();
  v_link uuid := gen_random_uuid();
  v_feed jsonb;
BEGIN
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency) VALUES
    (v_event, (SELECT v FROM m5_ids WHERE k = 'brand_a'), 'Alpha Night', 'alpha-night', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN'),
    ((SELECT v FROM m5_ids WHERE k = 'event_b'), (SELECT v FROM m5_ids WHERE k = 'brand_b'), 'Beta Night', 'beta-night', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN'),
    (v_ended, (SELECT v FROM m5_ids WHERE k = 'brand_a'), 'Alpha Past', 'alpha-past', 'event', 'public', 'ended', 'Africa/Lagos', 'NGN');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_event, now() + interval '10 days', now() + interval '10 days 4 hours', 'Africa/Lagos', true),
    ((SELECT v FROM m5_ids WHERE k = 'event_b'), now() + interval '10 days', now() + interval '10 days 4 hours', 'Africa/Lagos', true),
    (v_ended, now() - interval '10 days', now() - interval '10 days' + interval '4 hours', 'Africa/Lagos', true);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, display_order, sale_start_at, sale_end_at,
      is_hidden, is_disabled, password_protected, available_online) VALUES
    (v_ga, v_event, 'General', 500000, 'NGN', false, 100, 1, NULL, NULL, false, false, false, true),
    (gen_random_uuid(), v_event, 'Early', 300000, 'NGN', false, 50, 0, now() + interval '2 days', NULL, false, false, false, true),
    (gen_random_uuid(), v_event, 'Closed', 400000, 'NGN', false, 50, 2, now() - interval '9 days', now() - interval '1 day', false, false, false, true),
    (gen_random_uuid(), v_event, 'Hidden', 100000, 'NGN', false, 10, 3, NULL, NULL, true, false, false, true),
    (gen_random_uuid(), v_event, 'Disabled', 100000, 'NGN', false, 10, 4, NULL, NULL, false, true, false, true),
    (gen_random_uuid(), v_event, 'Door', 100000, 'NGN', false, 10, 6, NULL, NULL, false, false, false, false),
    (v_link, v_event, 'Guest list', 0, 'NGN', true, 10, 7, NULL, NULL, false, false, false, true),
    (gen_random_uuid(), v_ended, 'Past GA', 100000, 'NGN', false, 10, 0, NULL, NULL, false, false, false, true);
  INSERT INTO public.ticket_type_links(event_id, brand_id, ticket_type_id, kind, label, token_nonce, token_hash, created_by)
  VALUES (v_event, (SELECT v FROM m5_ids WHERE k = 'brand_a'), v_link, 'guest_list', 'Friends', gen_random_bytes(16),
    encode(sha256(convert_to('m5-link', 'UTF8')), 'hex'), (SELECT v FROM m5_ids WHERE k = 'owner'));

  v_feed := public.brand_site_ticket_tiers(v_site, v_event);
  PERFORM pg_temp.p_assert(
    (SELECT array_agg(t->>'name' ORDER BY ord) FROM jsonb_array_elements(v_feed->'tiers') WITH ORDINALITY AS x(t, ord)) = ARRAY['Early', 'General', 'Closed'],
    'T-4a Mingla''s order (display_order)');
  PERFORM pg_temp.p_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_feed->'tiers') t
      WHERE t->>'name' IN ('Hidden', 'Disabled', 'Door', 'Guest list')),
    'T-4b hidden, disabled, door-only and link-only tiers never show (password tiers are retired; still filtered)');
  PERFORM pg_temp.p_assert(
    (SELECT t->>'state' = 'not_yet' AND t->'href' = 'null'::jsonb AND t->>'sale_starts_at' IS NOT NULL
       FROM jsonb_array_elements(v_feed->'tiers') t WHERE t->>'name' = 'Early')
    AND (SELECT t->>'state' = 'ended' AND t->'href' = 'null'::jsonb FROM jsonb_array_elements(v_feed->'tiers') t WHERE t->>'name' = 'Closed')
    AND (SELECT t->>'state' = 'on_sale' AND t->>'href' = 'https://host.usemingla.com/checkout/' || v_event || '?seed=' || v_ga || ':1'
           AND (t->>'price_minor')::bigint = 500000 AND t->>'currency' = 'NGN'
         FROM jsonb_array_elements(v_feed->'tiers') t WHERE t->>'name' = 'General'),
    'T-4c only an on-sale tier links, to this event''s checkout with the tier seeded');
  PERFORM pg_temp.p_assert(v_feed->'event'->>'public_url' = 'https://host.usemingla.com/e/m5-alpha/alpha-night'
    AND v_feed->'event'->>'status' = 'scheduled', 'T-4d the event page is this brand''s');
  PERFORM pg_temp.p_assert(public.brand_site_ticket_tiers(v_site, (SELECT v FROM m5_ids WHERE k = 'event_b')) IS NULL,
    'T-4e another brand''s event is NULL');
  PERFORM pg_temp.p_assert(public.brand_site_ticket_tiers(v_site, v_ended)->'event'->>'status' = 'ended',
    'T-4f an ended event comes back ended (the site renders nothing for it)');
END
$t4$;

-- T-5 rating
DO $t5$
DECLARE
  v_site uuid := (SELECT v FROM m5_ids WHERE k = 'site_a');
  v_rating jsonb;
BEGIN
  -- The Google rating on the place is never read.
  UPDATE public.place_pool SET rating = 1.0, review_count = 9999 WHERE id = (SELECT v FROM m5_ids WHERE k = 'place_a');
  INSERT INTO public.place_reviews(place_pool_id, place_name, rating, moderation_status)
  SELECT (SELECT v FROM m5_ids WHERE k = 'place_a'), 'Alpha Kitchen', CASE WHEN g % 2 = 0 THEN 5 ELSE 4 END, 'approved'
  FROM generate_series(1, 19) g;
  INSERT INTO public.place_reviews(place_pool_id, place_name, rating, moderation_status)
  SELECT (SELECT v FROM m5_ids WHERE k = 'place_a'), 'Alpha Kitchen', 1, s
  FROM unnest(ARRAY['pending', 'rejected', 'flagged', 'pending', 'rejected']) s;
  INSERT INTO public.place_reviews(place_pool_id, place_name, rating, moderation_status)
  SELECT (SELECT v FROM m5_ids WHERE k = 'place_b'), 'Alpha Pending', 1, 'approved' FROM generate_series(1, 30);
  PERFORM pg_temp.p_assert(public.brand_site_mingla_rating(v_site) IS NULL,
    'T-5a 19 approved reviews: no rating (pending, rejected, an unverified venue''s place not counted)');
  INSERT INTO public.place_reviews(place_pool_id, place_name, rating, moderation_status)
  VALUES ((SELECT v FROM m5_ids WHERE k = 'place_a'), 'Alpha Kitchen', 3, 'approved');
  v_rating := public.brand_site_mingla_rating(v_site);
  -- 9 fives + 10 fours + 1 three = 88 / 20 = 4.4
  PERFORM pg_temp.p_assert(v_rating = jsonb_build_object('source', 'mingla_place_reviews', 'score', 4.4, 'count', 20),
    'T-5b 20 approved reviews: their mean to one decimal, never the Google 1.0');
  PERFORM pg_temp.p_assert(public.brand_site_mingla_rating((SELECT v FROM m5_ids WHERE k = 'site_b')) IS NULL,
    'T-5c another brand''s site does not see these reviews');
END
$t5$;

-- T-6 booking target, T-7 offering dates
DO $t6$
DECLARE
  v_site uuid := (SELECT v FROM m5_ids WHERE k = 'site_a');
  v_exp uuid := (SELECT v FROM m5_ids WHERE k = 'exp_a');
  v_event uuid := (SELECT v FROM m5_ids WHERE k = 'event_a');
  v_target jsonb;
  v_feed jsonb;
  v_lagos_noon timestamptz := (((now() AT TIME ZONE 'Africa/Lagos')::date + 2) + time '12:00') AT TIME ZONE 'Africa/Lagos';
BEGIN
  v_target := public.brand_site_booking_target(v_site, 'venue_table', (SELECT v FROM m5_ids WHERE k = 'venue_a'));
  PERFORM pg_temp.p_assert(v_target->>'base_url' = 'https://host.usemingla.com/b/m5-alpha/v/alphakitchen'
    AND v_target->>'timezone' = 'Africa/Lagos' AND v_target->>'kind' = 'venue_table',
    'T-6a a verified venue with reservations on: its Mingla page, no query');
  PERFORM pg_temp.p_assert(public.brand_site_booking_target(v_site, 'venue_table', (SELECT v FROM m5_ids WHERE k = 'venue_b')) IS NULL
    AND public.brand_site_booking_target(v_site, 'venue_table', (SELECT v FROM m5_ids WHERE k = 'venue_off')) IS NULL
    AND public.brand_site_booking_target(v_site, 'nonsense', (SELECT v FROM m5_ids WHERE k = 'venue_a')) IS NULL,
    'T-6b another brand''s venue, reservations off, or an unknown kind: NULL');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency) VALUES
    (v_exp, (SELECT v FROM m5_ids WHERE k = 'brand_a'), 'Alpha Workshop', 'alpha-workshop', 'experience', 'public', 'scheduled', 'Africa/Lagos', 'NGN');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_exp, v_lagos_noon, v_lagos_noon + interval '2 hours', 'Africa/Lagos', false),
    (v_exp, v_lagos_noon + interval '4 hours', v_lagos_noon + interval '6 hours', 'Africa/Lagos', false),
    (v_exp, v_lagos_noon + interval '30 days', v_lagos_noon + interval '30 days 2 hours', 'Africa/Lagos', false);
  PERFORM pg_temp.p_assert(public.brand_site_booking_target(v_site, 'experience', v_exp)->>'base_url'
      = 'https://host.usemingla.com/exp/m5-alpha/alpha-workshop', 'T-6c an upcoming public experience');
  v_feed := public.brand_site_offering_dates(v_site, v_exp, 'experience_slots', 7);
  PERFORM pg_temp.p_assert(jsonb_array_length(v_feed->'days') = 1 AND jsonb_array_length(v_feed->'days'->0->'slots') = 2
    AND v_feed->'days'->0->'slots'->0->>'label' = '12:00'
    AND v_feed->'days'->0->'slots'->1->>'href' = 'https://host.usemingla.com/exp/m5-alpha/alpha-workshop?date='
      || to_char((now() AT TIME ZONE 'Africa/Lagos')::date + 2, 'YYYY-MM-DD') || '&slot=16:00',
    'T-7a an experience''s slots in the window (its zone) pre-fill date and slot; the one 30 days out is left out');
  v_feed := public.brand_site_offering_dates(v_site, v_event, 'event_dates', 14);
  PERFORM pg_temp.p_assert(jsonb_array_length(v_feed->'days') = 1
    AND v_feed->'days'->0->'slots'->0->>'href' LIKE 'https://host.usemingla.com/e/m5-alpha/alpha-night?eventDateId=%',
    'T-7b an event''s date links to its own date on the event page');
  PERFORM pg_temp.p_assert(public.brand_site_offering_dates(v_site, v_exp, 'event_dates', 7) IS NULL
    AND public.brand_site_offering_dates(v_site, (SELECT v FROM m5_ids WHERE k = 'event_b'), 'event_dates', 7) IS NULL
    AND public.brand_site_offering_dates(v_site, (SELECT v FROM m5_ids WHERE k = 'event_ended'), 'event_dates', 7) IS NULL,
    'T-7c the wrong source, another brand''s event and an ended event are NULL');
END
$t6$;

-- T-7d places left: Mingla's real count, else nothing; a cancelled date never shows
DO $t7d$
DECLARE
  v_site uuid := (SELECT v FROM m5_ids WHERE k = 'site_a');
  v_exp uuid := (SELECT v FROM m5_ids WHERE k = 'exp_a');
  v_feed jsonb;
  v_tt uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, is_free, quantity_total, display_order)
  VALUES (v_tt, v_exp, 'Workshop place', 1500000, 'NGN', false, 2, 0);
  v_feed := public.brand_site_offering_dates(v_site, v_exp, 'experience_slots', 7);
  PERFORM pg_temp.p_assert((v_feed->'days'->0->'slots'->0->>'left')::int = 2 AND v_feed->'days'->0->'slots'->0->>'state' = 'few',
    'T-7d a counted tier: 2 places left, shown as few');
  UPDATE public.ticket_types SET held_count = 1 WHERE id = v_tt;
  v_feed := public.brand_site_offering_dates(v_site, v_exp, 'experience_slots', 7);
  PERFORM pg_temp.p_assert((v_feed->'days'->0->'slots'->0->>'left')::int = 1,
    'T-7d2 a place held in a live checkout counts as taken (1 left)');
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, is_unlimited, display_order)
  VALUES (v_exp, 'Walk-in', 1000000, 'NGN', false, true, 1);
  v_feed := public.brand_site_offering_dates(v_site, v_exp, 'experience_slots', 7);
  PERFORM pg_temp.p_assert(v_feed->'days'->0->'slots'->0->'left' = 'null'::jsonb AND v_feed->'days'->0->'slots'->0->>'state' = 'open',
    'T-7e an unlimited tier: no count is shown (never invented)');
  UPDATE public.event_dates SET cancelled_at = now() WHERE event_id = v_exp
    AND start_at = (SELECT min(start_at) FROM public.event_dates WHERE event_id = v_exp);
  v_feed := public.brand_site_offering_dates(v_site, v_exp, 'experience_slots', 7);
  PERFORM pg_temp.p_assert(jsonb_array_length(v_feed->'days'->0->'slots') = 1, 'T-7f a cancelled date is left out');
END
$t7d$;

-- T-8 stays with the stay flags off
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'STAY_PUBLIC_PAGES';
SELECT pg_temp.p_assert(NOT public.brand_site_stay_flags_on()
  AND public.brand_site_stay_nights((SELECT v FROM m5_ids WHERE k = 'site_a'), gen_random_uuid(), 7) IS NULL
  AND public.brand_site_booking_target((SELECT v FROM m5_ids WHERE k = 'site_a'), 'stay', gen_random_uuid()) IS NULL,
  'T-8 stay flags off: no nights and no stay target');

ROLLBACK;
