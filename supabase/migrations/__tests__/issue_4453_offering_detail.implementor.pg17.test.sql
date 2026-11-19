\set ON_ERROR_STOP on
-- #4453 milestone 9: executable PostgreSQL 17 proof of the offering detail read
-- (20280807084453). BEGIN ... ROLLBACK: every fixture, and the feed stand-in
-- used for the trip and cross-brand cases, rolls back.
-- MINGLA-INVARIANT: I-SITES-DETAIL-READ-SERVICE-ONLY | issue #4453 | brand_site_offering_detail is static SQL, SECURITY DEFINER with an explicit search_path, executable by the service role only, and answers only for an offering in the site's own feed and of the site's own brand.
--
-- T-1  grants and shape: service role only; SECURITY DEFINER; search_path set; no EXECUTE in any body.
-- T-2  SITES_DETAIL_PAGES is seeded OFF; while off the read answers NULL for a real offering.
-- T-3  a live room through the REAL feed: guest limits, amenities (empty items dropped, at most 12),
--      accessibility, its own ready photos only (pending, failed and another room's never), cover first;
--      a draft room and another brand's room (not in this site's feed) are NULL; bad kind/slug NULL.
-- T-4  a trip (feed stand-in): days in order (at most 14, summary whitespace folded), included only (not
--      excluded, at most 12); no stay facts, no photos; an event has no days.
-- T-5  isolation: a feed row naming ANOTHER brand's trip id still answers NULL (the brand bind);
--      a cancelled row is NULL; an unknown site is NULL.
--
-- FAILS-ON-REVERT: drop 20280807084453 -> T-1 (function missing); drop the brand bind on events -> T-5a;
-- drop the flag check -> T-2b; drop the status='ready' media filter -> T-3c; restore the {1,900} cover pattern -> T-3g.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 offering detail FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- T-1 grants and shape
SELECT pg_temp.p_assert(bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'T-1a the detail read and its flag are service-role only')
FROM unnest(ARRAY['public.brand_site_offering_detail(uuid,text,text)', 'public.brand_site_detail_pages_enabled()']) AS f;
SELECT pg_temp.p_assert(count(*) = 2 AND bool_and(p.prosecdef)
    AND bool_and(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
    AND bool_and(p.prosrc !~* '\mEXECUTE\M'),
  'T-1b SECURITY DEFINER, explicit search_path, static SQL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('brand_site_offering_detail', 'brand_site_detail_pages_enabled');

UPDATE public.feature_flags SET is_enabled = true WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES');

CREATE TEMP TABLE m9 (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO m9 VALUES ('owner', gen_random_uuid()), ('brand', gen_random_uuid()), ('other', gen_random_uuid()),
  ('site', gen_random_uuid()), ('site_other', gen_random_uuid()), ('venue', gen_random_uuid()), ('venue_other', gen_random_uuid()),
  ('room', gen_random_uuid()), ('room2', gen_random_uuid()), ('draft', gen_random_uuid()), ('room_other', gen_random_uuid()),
  ('trip', gen_random_uuid()), ('trip_other', gen_random_uuid()), ('event', gen_random_uuid());

DO $fixture$
DECLARE
  v_owner uuid := (SELECT v FROM m9 WHERE k = 'owner');
  v_brand uuid := (SELECT v FROM m9 WHERE k = 'brand');
  v_other uuid := (SELECT v FROM m9 WHERE k = 'other');
  v_room uuid := (SELECT v FROM m9 WHERE k = 'room');
  v_today date := (now() AT TIME ZONE 'Africa/Lagos')::date;
  v_i integer;
  v_obj uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'm9-detail@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'M9 Lagoon', 'm9-lagoon', 'NGN'), (v_other, v_owner, 'M9 Other', 'm9-other', 'NGN');
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
    ((SELECT v FROM m9 WHERE k = 'site'), v_brand, 'provisioning', v_owner),
    ((SELECT v FROM m9 WHERE k = 'site_other'), v_other, 'provisioning', v_owner);
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
    ((SELECT v FROM m9 WHERE k = 'venue'), v_brand, 'm9lagoonstay', 'Lagoon Stay', 6.45, 3.47, 'stay', 'verified'),
    ((SELECT v FROM m9 WHERE k = 'venue_other'), v_other, 'm9otherstay', 'Other Stay', 6.46, 3.48, 'stay', 'verified');
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state) VALUES
    ((SELECT v FROM m9 WHERE k = 'venue'), v_brand, 'resort', 'Africa/Lagos', 'instant', 'active'),
    ((SELECT v FROM m9 WHERE k = 'venue_other'), v_other, 'resort', 'Africa/Lagos', 'instant', 'active');
  INSERT INTO public.stay_offerings(id, venue_id, brand_id, kind, name, summary, status, confirmation_mode,
      inventory_basis, unit_naming_mode, quantity, min_guests, max_guests, max_adults, max_children, amenities, accessibility_features) VALUES
    (v_room, (SELECT v FROM m9 WHERE k = 'venue'), v_brand, 'room', 'Lagoon Room', 'A quiet room on the water.', 'live', 'instant',
      'pooled_units', 'interchangeable', 4, 1, 4, 4, 2,
      ARRAY['Wi-Fi', ' ', 'Air conditioning', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12', 'a13'], ARRAY['Step-free entrance']),
    ((SELECT v FROM m9 WHERE k = 'room2'), (SELECT v FROM m9 WHERE k = 'venue'), v_brand, 'room', 'Garden Room', '', 'live', 'instant',
      'pooled_units', 'interchangeable', 2, 1, 2, 2, 0, '{}', '{}'),
    ((SELECT v FROM m9 WHERE k = 'draft'), (SELECT v FROM m9 WHERE k = 'venue'), v_brand, 'room', 'Draft Room', '', 'draft', 'instant',
      'pooled_units', 'interchangeable', 1, 1, 2, 2, 1, '{}', '{}'),
    ((SELECT v FROM m9 WHERE k = 'room_other'), (SELECT v FROM m9 WHERE k = 'venue_other'), v_other, 'room', 'Other Room', '', 'live', 'instant',
      'pooled_units', 'interchangeable', 1, 1, 2, 2, 1, '{}', '{}');
  -- Photos: two ready (one the cover, sorted after), one pending, one failed, and one of another room.
  FOR v_i IN 1..5 LOOP
    INSERT INTO storage.objects(id, bucket_id, name, metadata) VALUES (gen_random_uuid(), 'brand_covers', v_brand || '/room-' || v_i || '.jpg',
      jsonb_build_object('mimetype', 'image/jpeg', 'size', 1000))
    RETURNING id INTO v_obj;
    INSERT INTO public.stay_offering_media(offering_id, brand_id, venue_id, storage_object_id, storage_bucket_id,
        storage_object_name, mime_type, byte_size, alt_text, sort_order, is_cover, status)
    VALUES (CASE WHEN v_i = 5 THEN (SELECT v FROM m9 WHERE k = 'room2') ELSE v_room END, v_brand, (SELECT v FROM m9 WHERE k = 'venue'),
      v_obj, 'brand_covers', v_brand || '/room-' || v_i || '.jpg', 'image/jpeg', 1000,
      CASE WHEN v_i = 2 THEN 'The bed' END, v_i, v_i = 2,
      CASE v_i WHEN 3 THEN 'pending' WHEN 4 THEN 'failed' ELSE 'ready' END);
  END LOOP;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency) VALUES
    ((SELECT v FROM m9 WHERE k = 'trip'), v_brand, 'Lofoten Peaks', 'lofoten-peaks', 'trip', 'public', 'scheduled', 'Europe/Oslo', 'NGN'),
    ((SELECT v FROM m9 WHERE k = 'trip_other'), v_other, 'Other Trip', 'other-trip', 'trip', 'public', 'scheduled', 'Europe/Oslo', 'NGN'),
    ((SELECT v FROM m9 WHERE k = 'event'), v_brand, 'Harbour Night', 'harbour-night', 'event', 'public', 'scheduled', 'Africa/Lagos', 'NGN');
  FOR v_i IN 1..16 LOOP
    INSERT INTO public.trip_days(event_id, ordinal, title, narrative) VALUES
      ((SELECT v FROM m9 WHERE k = 'trip'), v_i, 'Day title ' || v_i, CASE WHEN v_i = 1 THEN E'Leknes  to\n Hamnøy' END);
  END LOOP;
  INSERT INTO public.trip_days(event_id, ordinal, title, narrative) VALUES ((SELECT v FROM m9 WHERE k = 'trip_other'), 1, 'Other day', 'Secret');
  FOR v_i IN 1..14 LOOP
    INSERT INTO public.trip_inclusions(event_id, kind, item, ordinal) VALUES ((SELECT v FROM m9 WHERE k = 'trip'), 'included', 'Included ' || v_i, v_i);
  END LOOP;
  INSERT INTO public.trip_inclusions(event_id, kind, item, ordinal) VALUES ((SELECT v FROM m9 WHERE k = 'trip'), 'excluded', 'Flights', 0);
END
$fixture$;

-- T-2 the flag
SELECT pg_temp.p_assert((SELECT NOT is_enabled FROM public.feature_flags WHERE flag_key = 'SITES_DETAIL_PAGES')
  AND NOT public.brand_site_detail_pages_enabled(), 'T-2a SITES_DETAIL_PAGES seeded off');
SELECT pg_temp.p_assert(public.brand_site_offering_detail((SELECT v FROM m9 WHERE k = 'site'), 'stay', (SELECT v FROM m9 WHERE k = 'room')::text) IS NULL,
  'T-2b flag off: no detail for a live room');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_DETAIL_PAGES';

-- T-3 a live room through the real feed
DO $t3$
DECLARE
  v_site uuid := (SELECT v FROM m9 WHERE k = 'site');
  v_room uuid := (SELECT v FROM m9 WHERE k = 'room');
  v_detail jsonb := public.brand_site_offering_detail(v_site, 'stay', v_room::text);
BEGIN
  PERFORM pg_temp.p_assert(v_detail->>'offering_id' = v_room::text AND v_detail->>'kind' = 'stay'
    AND v_detail->'days' = '[]'::jsonb AND v_detail->'included' = '[]'::jsonb
    AND v_detail->'stay'->>'kind' = 'room' AND (v_detail->'stay'->>'max_guests')::int = 4
    AND (v_detail->'stay'->>'max_adults')::int = 4 AND (v_detail->'stay'->>'max_children')::int = 2,
    'T-3a a live room: its guest limits, no days or inclusions');
  PERFORM pg_temp.p_assert(jsonb_array_length(v_detail->'stay'->'amenities') = 12
    AND v_detail->'stay'->'amenities'->0 = '"Wi-Fi"' AND v_detail->'stay'->'amenities'->1 = '"Air conditioning"'
    AND v_detail->'stay'->'accessibility' = '["Step-free entrance"]'::jsonb,
    'T-3b amenities in order, blanks dropped, at most 12; accessibility features');
  PERFORM pg_temp.p_assert(jsonb_array_length(v_detail->'photos') = 2
    AND v_detail->'photos'->0 = jsonb_build_object('path', 'brand_covers/' || (SELECT v FROM m9 WHERE k = 'brand') || '/room-2.jpg', 'alt', 'The bed')
    AND v_detail->'photos'->1 = jsonb_build_object('path', 'brand_covers/' || (SELECT v FROM m9 WHERE k = 'brand') || '/room-1.jpg', 'alt', NULL),
    'T-3c only its own READY photos, cover first (pending, failed and another room''s never)');
  PERFORM pg_temp.p_assert(public.brand_site_offering_detail(v_site, 'stay', (SELECT v FROM m9 WHERE k = 'draft')::text) IS NULL
    AND public.brand_site_offering_detail(v_site, 'stay', (SELECT v FROM m9 WHERE k = 'room_other')::text) IS NULL,
    'T-3d a draft room and another brand''s room are NULL');
  PERFORM pg_temp.p_assert(public.brand_site_offering_detail(v_site, 'room', v_room::text) IS NULL
    AND public.brand_site_offering_detail(v_site, 'trip', v_room::text) IS NULL
    AND public.brand_site_offering_detail(v_site, 'stay', '') IS NULL
    AND public.brand_site_offering_detail(v_site, 'stay', NULL) IS NULL,
    'T-3e a bad kind, a wrong kind, an empty or missing slug are NULL');
  PERFORM pg_temp.p_assert(public.brand_site_offering_detail((SELECT v FROM m9 WHERE k = 'site_other'), 'stay', v_room::text) IS NULL,
    'T-3f another brand''s site cannot read this brand''s room');
  -- 20280807054453's cover pattern once used a {1,900} repeat, which PostgreSQL
  -- refuses (max 255): ANY room with a ready photo errored the WHOLE feed.
  PERFORM pg_temp.p_assert((SELECT o->'cover'->>'path' FROM jsonb_array_elements(public.brand_site_offerings_feed(v_site)->'offerings') o
      WHERE o->>'id' = v_room::text) = 'brand_covers/' || (SELECT v FROM m9 WHERE k = 'brand') || '/room-2.jpg',
    'T-3g the feed serves a room with photos (its cover is the cover photo)');
END
$t3$;

-- The feed is CALLED, never changed by the migration. For the trip and
-- isolation cases only (rolled back), a stand-in with the feed's exact
-- signature lists this brand's trip and event, a cancelled trip, and a row
-- that names ANOTHER brand's trip id.
CREATE OR REPLACE FUNCTION public.brand_site_offerings_feed(p_site_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $stub$
  SELECT jsonb_build_object('generated_at', now(), 'brand', jsonb_build_object('slug', 'm9-lagoon'), 'offerings', jsonb_build_array(
    jsonb_build_object('id', (SELECT v FROM m9 WHERE k = 'trip'), 'kind', 'trip', 'slug', 'lofoten-peaks', 'status', 'scheduled'),
    jsonb_build_object('id', (SELECT v FROM m9 WHERE k = 'event'), 'kind', 'event', 'slug', 'harbour-night', 'status', 'scheduled'),
    jsonb_build_object('id', (SELECT v FROM m9 WHERE k = 'trip'), 'kind', 'trip', 'slug', 'called-off', 'status', 'cancelled'),
    jsonb_build_object('id', (SELECT v FROM m9 WHERE k = 'trip_other'), 'kind', 'trip', 'slug', 'other-trip', 'status', 'scheduled')));
$stub$;

DO $t4$
DECLARE
  v_site uuid := (SELECT v FROM m9 WHERE k = 'site');
  v_trip jsonb := public.brand_site_offering_detail(v_site, 'trip', 'lofoten-peaks');
  v_event jsonb := public.brand_site_offering_detail(v_site, 'event', 'harbour-night');
BEGIN
  PERFORM pg_temp.p_assert(v_trip->>'offering_id' = (SELECT v FROM m9 WHERE k = 'trip')::text
    AND jsonb_array_length(v_trip->'days') = 14
    AND v_trip->'days'->0 = '{"day": 1, "title": "Day title 1", "summary": "Leknes to Hamnøy"}'::jsonb
    AND v_trip->'days'->1->'summary' = 'null'::jsonb AND (v_trip->'days'->13->>'day')::int = 14,
    'T-4a a trip''s days in order, at most 14, whitespace folded, no summary is null');
  PERFORM pg_temp.p_assert(jsonb_array_length(v_trip->'included') = 12 AND v_trip->'included'->0 = '"Included 1"'
    AND NOT (v_trip->'included' ? 'Flights') AND v_trip->'stay' = 'null'::jsonb AND v_trip->'photos' = '[]'::jsonb,
    'T-4b what is included (never excluded), at most 12; no stay facts or photos');
  PERFORM pg_temp.p_assert(v_event->>'kind' = 'event' AND v_event->'days' = '[]'::jsonb AND v_event->'included' = '[]'::jsonb,
    'T-4c an event has no days or inclusions');
END
$t4$;

-- T-5 isolation
SELECT pg_temp.p_assert(public.brand_site_offering_detail((SELECT v FROM m9 WHERE k = 'site'), 'trip', 'other-trip') IS NULL,
  'T-5a a feed row naming another brand''s trip id still answers NULL');
SELECT pg_temp.p_assert(public.brand_site_offering_detail((SELECT v FROM m9 WHERE k = 'site'), 'trip', 'called-off') IS NULL,
  'T-5b a cancelled offering has no detail');
SELECT pg_temp.p_assert(public.brand_site_offering_detail(gen_random_uuid(), 'trip', 'lofoten-peaks') IS NULL,
  'T-5c an unknown site is NULL');

ROLLBACK;
