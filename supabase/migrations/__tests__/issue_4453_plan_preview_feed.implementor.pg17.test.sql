\set ON_ERROR_STOP on
-- #4453 milestone 10: executable PostgreSQL 17 proof of the plan-preview
-- migration (20280807094453). BEGIN ... ROLLBACK: every fixture rolls back.
-- MINGLA-INVARIANT: I-SITES-PLAN-FEED-ONE-BODY | issue #4453 | brand_site_offerings_feed(site) resolves the site's brand and returns brand_site_offerings_feed_for_brand(brand): the two return equal rows; both are service-role only.
-- MINGLA-INVARIANT: I-SITES-PLAN-FACTS-ONE-BODY | issue #4453 | brand_site_compose_facts / venue_slots / offering_dates / ticket_tiers by site resolve the site's brand and return their _for_brand twin, so a plan preview before any site sees the facts Build sees; service role only.
-- MINGLA-INVARIANT: I-SITES-PLAN-PREVIEW-RATE | issue #4453 | brand_site_plan_preview_take refuses a 4th plan-preview request within a minute and a 21st within a day, per brand; the counter table is closed to clients.
--
-- T-1  grants and shape: service role only (inputs: authenticated through the plan gate); SECURITY DEFINER; search_path; static SQL; tables closed.
-- T-2  SITES_PLAN_PREVIEW seeded off; the allowlist is seeded empty; on for a listed brand only, then for all when the flag is on.
-- T-3  feed by brand equals the site feed (one body); an unknown site or brand raises sites_not_found; the site feed's body calls the brand feed.
-- T-4  inputs: gated at content rank 20 by brand_site_plan_gate; refused without a signed-in member; read only.
-- T-5  rate limit: 3 a minute then refused; 20 a day then refused; another brand is unaffected.
-- T-6  writes nothing to brand_sites (the preview reads only).
-- T-7  brand twins of the composer-fact reads: one body, equal answers by site and by brand, no cross-brand read (SC-PP4).
-- T-8  the brand feed's rooms-left read agrees with Mingla's own sell rule night by night (the 7b money guard's allowlist entry).
--
-- FAILS-ON-REVERT: drop 20280807094453 -> T-1 (functions missing); feed(site) keeps its own body -> T-3c;
-- drop the minute check -> T-5b; drop the day check -> T-5d; drop the gate -> T-4a;
-- a site read keeps its own body -> T-7c; drop the twins -> T-7a; drop the availability filter from the feed -> T-8.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 plan preview FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- T-1 grants and shape
SELECT pg_temp.p_assert(bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'T-1a feed, flag and rate limit are service-role only')
FROM unnest(ARRAY['public.brand_site_offerings_feed_for_brand(uuid)', 'public.brand_site_offerings_feed(uuid)',
  'public.brand_site_plan_preview_take(uuid)', 'public.brand_site_plan_preview_on(uuid)']) AS f;
SELECT pg_temp.p_assert(has_function_privilege('authenticated', 'public.brand_site_plan_preview_inputs(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.brand_site_plan_preview_inputs(uuid)', 'EXECUTE'),
  'T-1b inputs: signed-in members only (the plan gate decides)');
SELECT pg_temp.p_assert(count(*) = 5 AND bool_and(p.prosecdef)
    AND bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
    AND bool_and(p.prosrc !~* '\mEXECUTE\M'),
  'T-1c SECURITY DEFINER, explicit search_path, static SQL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('brand_site_offerings_feed_for_brand', 'brand_site_offerings_feed',
  'brand_site_plan_preview_inputs', 'brand_site_plan_preview_take', 'brand_site_plan_preview_on');
SELECT pg_temp.p_assert(bool_and(NOT has_table_privilege('authenticated', t, 'SELECT') AND NOT has_table_privilege('anon', t, 'SELECT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass)),
  'T-1d both tables closed to anon and authenticated, RLS on')
FROM unnest(ARRAY['public.brand_site_plan_preview_brands', 'public.brand_site_plan_preview_requests']) AS t;

-- Fixtures: two brands; only the first has a site.
INSERT INTO auth.users(id, email) VALUES ('00000000-0000-4000-8000-00000010a001', 'm10-owner@4453.invalid');
INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000010a001', now(), now());
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('00000000-0000-4000-8000-0000001b0001', '00000000-0000-4000-8000-00000010a001', 'M10 Alpha', 'm10-alpha', 'GBP'),
  ('00000000-0000-4000-8000-0000001b0002', '00000000-0000-4000-8000-00000010a001', 'M10 Beta', 'm10-beta', 'GBP');
INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
  ('00000000-0000-4000-8000-0000001c0001', '00000000-0000-4000-8000-0000001b0001', 'provisioning', '00000000-0000-4000-8000-00000010a001');

-- T-2 flag
SELECT pg_temp.p_assert((SELECT count(*) = 1 AND bool_and(NOT is_enabled) FROM public.feature_flags WHERE flag_key = 'SITES_PLAN_PREVIEW'),
  'T-2a SITES_PLAN_PREVIEW seeded off');
SELECT pg_temp.p_assert((SELECT count(*) = 0 FROM public.brand_site_plan_preview_brands), 'T-2b the allowlist is seeded empty');
SELECT pg_temp.p_assert(NOT public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0001'), 'T-2c off for an unlisted brand');
INSERT INTO public.brand_site_plan_preview_brands (brand_id) VALUES ('00000000-0000-4000-8000-0000001b0001');
SELECT pg_temp.p_assert(public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0001')
    AND NOT public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0002'), 'T-2d on for the listed brand only');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_PLAN_PREVIEW';
SELECT pg_temp.p_assert(public.brand_site_plan_preview_on('00000000-0000-4000-8000-0000001b0002'), 'T-2e on for every brand when the flag is on');
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'SITES_PLAN_PREVIEW';

-- T-3 one body
SELECT pg_temp.p_assert(
  (public.brand_site_offerings_feed('00000000-0000-4000-8000-0000001c0001') - 'generated_at')
    = (public.brand_site_offerings_feed_for_brand('00000000-0000-4000-8000-0000001b0001') - 'generated_at'),
  'T-3a the site feed and the brand feed return equal rows');
SELECT pg_temp.p_assert(
  public.brand_site_offerings_feed_for_brand('00000000-0000-4000-8000-0000001b0002') ? 'offerings',
  'T-3b a brand with no site still has a feed (the plan preview runs before a site exists)');
SELECT pg_temp.p_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_offerings_feed' AND pronamespace = 'public'::regnamespace)
    ~ 'RETURN public\.brand_site_offerings_feed_for_brand\(v_brand_id\)'
  AND (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_offerings_feed' AND pronamespace = 'public'::regnamespace) !~ 'pg_public_trips_by_brand',
  'T-3c the site feed has no body of its own');
DO $t$
BEGIN
  BEGIN
    PERFORM public.brand_site_offerings_feed('00000000-0000-4000-8000-0000001cffff');
    RAISE EXCEPTION 'issue #4453 plan preview FAIL: T-3d unknown site did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'sites_not_found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.brand_site_offerings_feed_for_brand('00000000-0000-4000-8000-0000001bffff');
    RAISE EXCEPTION 'issue #4453 plan preview FAIL: T-3d unknown brand did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'sites_not_found' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS  T-3d an unknown site or brand raises sites_not_found';
END
$t$;

-- T-4 inputs
SELECT pg_temp.p_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_plan_preview_inputs' AND pronamespace = 'public'::regnamespace)
    ~ 'PERFORM public\.brand_site_plan_gate\(p_brand_id, 20\)',
  'T-4a inputs are gated at content rank 20 by the plan gate');
DO $t$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.brand_site_plan_preview_inputs('00000000-0000-4000-8000-0000001b0001');
    RAISE EXCEPTION 'issue #4453 plan preview FAIL: T-4b inputs answered without a member';
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
    IF SQLERRM LIKE 'issue #4453%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS  T-4b inputs refuse a caller who is not a signed-in member';
END
$t$;
SELECT pg_temp.p_assert(
  (SELECT prosrc FROM pg_proc WHERE proname = 'brand_site_plan_preview_inputs' AND pronamespace = 'public'::regnamespace)
    !~* '\m(INSERT|UPDATE|DELETE)\M',
  'T-4c inputs write nothing');

-- T-5 rate limit
SELECT pg_temp.p_assert((public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')->>'allowed')::boolean
    AND (public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')->>'allowed')::boolean
    AND (public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')->>'allowed')::boolean,
  'T-5a three requests in a minute are allowed');
SELECT pg_temp.p_assert(public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')
    = '{"allowed": false, "reason": "minute"}'::jsonb, 'T-5b the 4th in a minute is refused');
SELECT pg_temp.p_assert((public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0002')->>'allowed')::boolean,
  'T-5c another brand is unaffected');
UPDATE public.brand_site_plan_preview_requests SET created_at = now() - interval '2 hours'
WHERE brand_id = '00000000-0000-4000-8000-0000001b0001';
INSERT INTO public.brand_site_plan_preview_requests (brand_id, created_at)
SELECT '00000000-0000-4000-8000-0000001b0001', now() - interval '3 hours' FROM generate_series(1, 17);
SELECT pg_temp.p_assert(public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0001')
    = '{"allowed": false, "reason": "day"}'::jsonb, 'T-5d the 21st in a day is refused');
INSERT INTO public.brand_site_plan_preview_requests (brand_id, created_at)
VALUES ('00000000-0000-4000-8000-0000001b0002', now() - interval '2 days');
SELECT public.brand_site_plan_preview_take('00000000-0000-4000-8000-0000001b0002');
SELECT pg_temp.p_assert((SELECT count(*) = 0 FROM public.brand_site_plan_preview_requests
    WHERE brand_id = '00000000-0000-4000-8000-0000001b0002' AND created_at < now() - interval '1 day'),
  'T-5e rows older than a day are pruned');

-- T-7 brand twins of the composer-fact reads (tester P1-2, SC-PP4): one body,
-- the site read only resolves the site's brand; equal answers by site and by brand.
SELECT pg_temp.p_assert(bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'T-7a every brand twin and re-issued site read is service-role only')
FROM unnest(ARRAY['public.brand_site_brand_by_id(uuid)', 'public.brand_site_compose_facts_for_brand(uuid)',
  'public.brand_site_compose_facts(uuid)', 'public.brand_site_venue_slots_for_brand(uuid,uuid,integer,integer)',
  'public.brand_site_venue_slots(uuid,uuid,integer,integer)', 'public.brand_site_offering_dates_for_brand(uuid,uuid,text,integer)',
  'public.brand_site_offering_dates(uuid,uuid,text,integer)', 'public.brand_site_ticket_tiers_for_brand(uuid,uuid)',
  'public.brand_site_ticket_tiers(uuid,uuid)']) AS f;
SELECT pg_temp.p_assert(count(*) = 9 AND bool_and(p.prosecdef)
    AND bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
    AND bool_and(p.prosrc !~* '\mEXECUTE\M') AND bool_and(p.prosrc !~* '\m(INSERT|UPDATE|DELETE)\M'),
  'T-7b SECURITY DEFINER, explicit search_path, static SQL, read only')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('brand_site_brand_by_id', 'brand_site_compose_facts_for_brand', 'brand_site_compose_facts',
  'brand_site_venue_slots_for_brand', 'brand_site_venue_slots', 'brand_site_offering_dates_for_brand', 'brand_site_offering_dates',
  'brand_site_ticket_tiers_for_brand', 'brand_site_ticket_tiers');
SELECT pg_temp.p_assert(bool_and(
    (SELECT prosrc FROM pg_proc WHERE proname = site_fn AND pronamespace = 'public'::regnamespace) ~ ('RETURN public\.' || site_fn || '_for_brand\(v_brand\.brand_id')
    AND (SELECT prosrc FROM pg_proc WHERE proname = site_fn AND pronamespace = 'public'::regnamespace) !~ '\m(venue_listings|event_dates|ticket_types|place_reviews)\M'),
  'T-7c each site read has no body of its own (it calls its brand twin)')
FROM unnest(ARRAY['brand_site_compose_facts', 'brand_site_venue_slots', 'brand_site_offering_dates', 'brand_site_ticket_tiers']) AS site_fn;

-- A stand-in slot engine (rolled back), as in the M5 booking-reads suite.
-- [TEST-MOD-APPROVED #4490] #4490 (20281203164490, carried by
-- 20281203214490) added a fifth parameter, p_space_id uuid DEFAULT NULL, to
-- the engine. The stand-in keeps the engine's exact signature, so it replaces
-- the engine instead of adding a second overload that makes named calls
-- ambiguous (the N152 fix in the booking-reads suites).
CREATE OR REPLACE FUNCTION public.pg_venue_available_slots(
  p_date date, p_party_size int, p_venue_id uuid DEFAULT NULL, p_brand_id uuid DEFAULT NULL,
  p_space_id uuid DEFAULT NULL)
RETURNS TABLE (slot_start_utc timestamptz, slot_local_label text, remaining int, is_full boolean)
LANGUAGE sql STABLE AS $stub$
  SELECT ((p_date + t.at) AT TIME ZONE 'Africa/Lagos'), to_char(t.at, 'HH24:MI'), t.left_n, t.full_flag
  FROM (VALUES (time '18:00', 6, false), (time '18:30', 2, false), (time '19:00', 0, true)) AS t(at, left_n, full_flag)
  WHERE p_party_size <= 8;
$stub$;

DO $t7$
DECLARE
  v_owner uuid := '00000000-0000-4000-8000-00000010a001';
  v_a uuid := '00000000-0000-4000-8000-0000001b0001';
  v_b uuid := '00000000-0000-4000-8000-0000001b0002';
  v_site uuid := '00000000-0000-4000-8000-0000001c0001';
  v_place uuid := gen_random_uuid();
  v_venue uuid := gen_random_uuid();
  v_venue_b uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_event_b uuid := gen_random_uuid();
  v_exp uuid := gen_random_uuid();
  v_site_ans jsonb;
  v_brand_ans jsonb;
BEGIN
  INSERT INTO public.place_pool(id, google_place_id, name, lat, lng) VALUES (v_place, 'm10-google-a', 'M10 Alpha Kitchen', 6.45, 3.39);
  INSERT INTO public.venue_listings(id, brand_id, place_pool_id, slug, name, lat, lng, venue_category, claim_status) VALUES
    (v_venue, v_a, v_place, 'm10kitchen', 'M10 Kitchen', 6.45, 3.39, 'restaurant', 'verified'),
    (v_venue_b, v_b, NULL, 'm10betakitchen', 'M10 Beta Kitchen', 6.46, 3.40, 'restaurant', 'verified');
  INSERT INTO public.venue_reservation_settings(brand_id, venue_id, reservations_enabled) VALUES (v_a, v_venue, true), (v_b, v_venue_b, true);
  INSERT INTO public.venue_availability_config(brand_id, venue_id, iana_timezone) VALUES (v_a, v_venue, 'Africa/Lagos');
  INSERT INTO public.place_reviews(place_pool_id, place_name, rating, moderation_status)
  SELECT v_place, 'M10 Alpha Kitchen', 5, 'approved' FROM generate_series(1, 3);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency) VALUES
    (v_event, v_a, 'M10 Night', 'm10-night', 'event', 'public', 'scheduled', 'Africa/Lagos', 'GBP'),
    (v_event_b, v_b, 'M10 Beta Night', 'm10-beta-night', 'event', 'public', 'scheduled', 'Africa/Lagos', 'GBP'),
    (v_exp, v_a, 'M10 Session', 'm10-session', 'experience', 'public', 'scheduled', 'Africa/Lagos', 'GBP');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_event, now() + interval '3 days', now() + interval '3 days 4 hours', 'Africa/Lagos', true),
    (v_event_b, now() + interval '3 days', now() + interval '3 days 4 hours', 'Africa/Lagos', true),
    (v_exp, now() + interval '2 days', now() + interval '2 days 2 hours', 'Africa/Lagos', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total, display_order, sale_start_at, sale_end_at,
      is_hidden, is_disabled, password_protected, available_online) VALUES
    (v_event, 'General', 500000, 'GBP', false, 100, 1, NULL, NULL, false, false, false, true),
    (v_event, 'Hidden', 100000, 'GBP', false, 10, 2, NULL, NULL, true, false, false, true),
    (v_event, 'Later', 300000, 'GBP', false, 50, 0, now() + interval '2 days', NULL, false, false, false, true);

  -- Compose facts: equal by site and by brand, and non-trivial (a verified venue, its reviews).
  v_site_ans := public.brand_site_compose_facts(v_site);
  v_brand_ans := public.brand_site_compose_facts_for_brand(v_a);
  PERFORM pg_temp.p_assert(v_site_ans = v_brand_ans AND (v_brand_ans->'venues'->'restaurant'->>'count')::int = 1
      AND v_brand_ans->'venues'->'restaurant'->>'venue_id' = v_venue::text AND (v_brand_ans->>'mingla_reviews')::int = 3,
    'T-7d compose facts: by brand equals by site (1 verified venue with reservations, 3 Mingla reviews)');
  PERFORM pg_temp.p_assert((public.brand_site_compose_facts_for_brand(v_b)->'venues'->'restaurant'->>'count')::int = 1
      AND (public.brand_site_compose_facts_for_brand(v_b)->>'mingla_reviews')::int = 0,
    'T-7e a brand with NO site gets its own facts (the plan preview case), never another brand''s');

  -- Venue slots, offering dates and ticket tiers: equal by site and by brand (generated_at aside).
  PERFORM pg_temp.p_assert(
    (public.brand_site_venue_slots(v_site, v_venue, 2, 7) - 'generated_at') = (public.brand_site_venue_slots_for_brand(v_a, v_venue, 2, 7) - 'generated_at')
    AND jsonb_array_length(public.brand_site_venue_slots_for_brand(v_a, v_venue, 2, 7)->'days') = 7,
    'T-7f venue slots: by brand equals by site');
  PERFORM pg_temp.p_assert(
    (public.brand_site_offering_dates(v_site, v_event, 'event_dates', 14) - 'generated_at')
      = (public.brand_site_offering_dates_for_brand(v_a, v_event, 'event_dates', 14) - 'generated_at')
    AND jsonb_array_length(public.brand_site_offering_dates_for_brand(v_a, v_event, 'event_dates', 14)->'days') = 1
    AND (public.brand_site_offering_dates(v_site, v_exp, 'experience_slots', 14) - 'generated_at')
      = (public.brand_site_offering_dates_for_brand(v_a, v_exp, 'experience_slots', 14) - 'generated_at'),
    'T-7g offering dates (event and experience): by brand equals by site');
  PERFORM pg_temp.p_assert(
    (public.brand_site_ticket_tiers(v_site, v_event) - 'generated_at') = (public.brand_site_ticket_tiers_for_brand(v_a, v_event) - 'generated_at')
    AND (SELECT array_agg(t->>'name' ORDER BY ord) FROM jsonb_array_elements(public.brand_site_ticket_tiers_for_brand(v_a, v_event)->'tiers') WITH ORDINALITY x(t, ord))
      = ARRAY['Later', 'General'],
    'T-7h ticket tiers: by brand equals by site (hidden tier still filtered)');
  PERFORM pg_temp.p_assert(public.brand_site_venue_slots_for_brand(v_a, v_venue_b, 2, 7) IS NULL
      AND public.brand_site_offering_dates_for_brand(v_a, v_event_b, 'event_dates', 14) IS NULL
      AND public.brand_site_ticket_tiers_for_brand(v_a, v_event_b) IS NULL
      AND public.brand_site_compose_facts_for_brand(gen_random_uuid()) IS NULL
      AND public.brand_site_compose_facts_for_brand(NULL) IS NULL,
    'T-7i no cross-brand read; an unknown or NULL brand is NULL');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES ('00000000-0000-4000-8000-0000001b0003', v_owner, 'M10 Gone', 'm10-gone', 'GBP');
  PERFORM pg_temp.p_assert(public.brand_site_compose_facts_for_brand('00000000-0000-4000-8000-0000001b0003') IS NOT NULL,
    'T-7j a live brand with nothing yet still reads (zeros)');
  UPDATE public.brands SET deleted_at = now() WHERE id = '00000000-0000-4000-8000-0000001b0003';
  PERFORM pg_temp.p_assert(public.brand_site_compose_facts_for_brand('00000000-0000-4000-8000-0000001b0003') IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.brand_site_brand_by_id('00000000-0000-4000-8000-0000001b0003')),
    'T-7k a deleted brand reads NULL (as the site read does)');
END
$t7$;

-- T-8 (tester P1-3) brand_site_offerings_feed_for_brand reads rooms left exactly
-- as Mingla sells them. The cheapest night a stay row shows is the cheapest
-- night Mingla's OWN sell rule (discover_v2_stay_room_available, 1 room, 1
-- night) would sell; fully booked, held and stop-sell nights never set it;
-- and the site feed (its other caller) agrees row for row. It is a website
-- read: it never quotes, holds or books (P-1 allowlist in the 7b money guard).
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES');
ALTER TABLE public.stay_inventory_commitments
  DROP CONSTRAINT stay_inventory_commitments_group_id_fkey,
  DROP CONSTRAINT stay_inventory_commitments_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_commitments DISABLE TRIGGER stay_inventory_commitments_scope_guard;
ALTER TABLE public.stay_inventory_holds DROP CONSTRAINT stay_inventory_holds_group_id_fkey;
ALTER TABLE public.stay_inventory_holds DISABLE TRIGGER stay_inventory_holds_scope_guard;
ALTER TABLE public.stay_inventory_hold_slices DROP CONSTRAINT stay_inventory_hold_slices_reservation_line_id_fkey;
ALTER TABLE public.stay_inventory_hold_slices DISABLE TRIGGER stay_inventory_hold_slices_scope_guard;
DO $t8$
DECLARE
  v_a uuid := '00000000-0000-4000-8000-0000001b0001';
  v_site uuid := '00000000-0000-4000-8000-0000001c0001';
  v_venue uuid := gen_random_uuid();
  v_room uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_hold uuid := gen_random_uuid();
  v_i integer;
  v_row jsonb;
  v_expected bigint;
  v_scenario integer;
BEGIN
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status)
  VALUES (v_venue, v_a, 'm10stay', 'M10 Stay', 6.45, 3.47, 'stay', 'verified');
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state)
  VALUES (v_venue, v_a, 'resort', 'Africa/Lagos', 'instant', 'active');
  INSERT INTO public.stay_offerings(id, venue_id, brand_id, kind, name, summary, status, confirmation_mode,
      inventory_basis, unit_naming_mode, quantity, min_guests, max_guests, max_adults, max_children)
  VALUES (v_room, v_venue, v_a, 'room', 'M10 Room', 'Two rooms.', 'live', 'instant', 'pooled_units', 'interchangeable', 2, 1, 4, 4, 2);
  UPDATE public.stay_offerings SET min_notice_minutes = 0 WHERE id = v_room;
  -- Nights +1..+10. Cheapest first: +1 (1000) fully booked, +2 (1100) stop-sell,
  -- +3 (1200) held to the last room by a live hold, +4 (1300) reconciliation-held,
  -- +5 (1400) one of two booked (sellable), +6..+10 at 5000.
  FOR v_i IN 1..10 LOOP
    INSERT INTO public.stay_room_nights(offering_id, local_date, brand_id, venue_id, sellable_quantity, stop_sell, minimum_nights, price_override_minor, currency_code)
    VALUES (v_room, v_today + v_i, v_a, v_venue, 2, v_i = 2, 1, CASE WHEN v_i <= 5 THEN 900 + v_i * 100 ELSE 5000 END, 'NGN')
    ON CONFLICT (offering_id, local_date) DO UPDATE SET sellable_quantity = 2, stop_sell = (v_i = 2), minimum_nights = 1,
      maximum_nights = NULL, price_override_minor = EXCLUDED.price_override_minor, currency_code = 'NGN';
  END LOOP;
  INSERT INTO public.stay_inventory_commitments(group_id, reservation_line_id, resource_type, offering_id, room_date, quantity, state, released_at) VALUES
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 1, 2, 'active', NULL),
    (gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + 5, 1, 'active', NULL);
  INSERT INTO public.stay_inventory_holds(id, group_id, state, expires_at) VALUES (v_hold, gen_random_uuid(), 'active', now() + interval '10 minutes');
  INSERT INTO public.stay_inventory_hold_slices(hold_id, reservation_line_id, resource_type, offering_id, room_date, quantity)
  VALUES (v_hold, gen_random_uuid(), 'room_night', v_room, v_today + 3, 2);
  v_hold := gen_random_uuid();
  INSERT INTO public.stay_inventory_holds(id, group_id, state, expires_at) VALUES (v_hold, gen_random_uuid(), 'reconciliation_required', now() - interval '1 minute');
  INSERT INTO public.stay_inventory_hold_slices(hold_id, reservation_line_id, resource_type, offering_id, room_date, quantity)
  VALUES (v_hold, gen_random_uuid(), 'room_night', v_room, v_today + 4, 2);

  -- Scenario 1 as above; scenario 2 frees night +3 (the live hold expires); scenario 3 books +5..+10 out.
  FOR v_scenario IN 1..3 LOOP
    IF v_scenario = 2 THEN
      UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 minute' WHERE state = 'active'
        AND id IN (SELECT hold_id FROM public.stay_inventory_hold_slices WHERE offering_id = v_room);
    ELSIF v_scenario = 3 THEN
      UPDATE public.stay_inventory_holds SET state = 'active', expires_at = now() + interval '10 minutes'
        WHERE id IN (SELECT hold_id FROM public.stay_inventory_hold_slices WHERE offering_id = v_room AND room_date = v_today + 3);
      INSERT INTO public.stay_inventory_commitments(group_id, reservation_line_id, resource_type, offering_id, room_date, quantity, state, released_at)
      SELECT gen_random_uuid(), gen_random_uuid(), 'room_night', v_room, v_today + d, CASE WHEN d = 5 THEN 1 ELSE 2 END, 'active', NULL
      FROM generate_series(5, 10) d;
    END IF;
    -- Mingla's own sell rule, night by night (independent of the website read).
    SELECT min(n.price_override_minor) INTO v_expected
    FROM public.stay_room_nights n
    WHERE n.offering_id = v_room AND n.local_date BETWEEN v_today AND v_today + 60
      AND public.discover_v2_stay_room_available(v_room, n.local_date, n.local_date + 1, 1);
    SELECT r INTO v_row FROM jsonb_array_elements(public.brand_site_offerings_feed_for_brand(v_a)->'offerings') r
    WHERE r->>'id' = v_room::text;
    PERFORM pg_temp.p_assert(
      v_row IS NOT NULL
      AND (v_row->>'min_price_minor')::bigint IS NOT DISTINCT FROM v_expected
      AND (public.brand_site_offerings_feed(v_site) - 'generated_at') = (public.brand_site_offerings_feed_for_brand(v_a) - 'generated_at'),
      format('T-8 scenario %s: the brand feed''s cheapest sellable night (%s) is the one Mingla''s sell rule allows (%s); the site feed agrees',
        v_scenario, v_row->>'min_price_minor', COALESCE(v_expected::text, 'none')));
  END LOOP;
  PERFORM pg_temp.p_assert(v_expected IS NULL, 'T-8d with every night sold, held or stopped, no night price is shown (never invented)');
END
$t8$;
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES');

-- T-6 reads only
SELECT pg_temp.p_assert((SELECT count(*) = 1 FROM public.brand_sites WHERE brand_id IN
    ('00000000-0000-4000-8000-0000001b0001', '00000000-0000-4000-8000-0000001b0002')),
  'T-6 the feeds and the rate limit created no site');

ROLLBACK;
