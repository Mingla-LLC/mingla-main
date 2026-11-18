\set ON_ERROR_STOP on
-- #4453 milestone 9, tester's adversarial proof of the detail read and the
-- edited stay feed (20280807084453, 20280807054453), through the REAL feed
-- (no stand-in). BEGIN ... ROLLBACK.
-- MINGLA-INVARIANT: I-SITES-DETAIL-ONLY-LIVE-OWN | issue #4453 | a detail page exists only for a public, published, uncancelled offering in the site's own feed: another brand's slug or id, a private, draft, cancelled or deleted offering, and any room while a stay flag is off all answer NULL.
--
-- A-1  guessing across brands: site A asked for brand B's event slug, B's event id, B's room id: NULL.
-- A-2  private, draft, cancelled and deleted events of the site's OWN brand: NULL, and not in the feed.
-- A-3  one stay flag off: no stay rows in the feed and no room detail.
-- A-4  the stay feed's cover with real photo names: a 900-character object name is served; 901 or a
--      ".." name is never served and never errors the feed (the M5 {1,900} pattern errored on any photo).
-- A-5  no guest, owner or staff field and no private contact value in any detail or feed answer.
-- A-6  flag off: NULL for an event too.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 offering detail (tester) FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

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

UPDATE public.feature_flags SET is_enabled = true WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES', 'SITES_DETAIL_PAGES');

CREATE TEMP TABLE t9 (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO t9 VALUES ('owner', gen_random_uuid()), ('a', gen_random_uuid()), ('b', gen_random_uuid()),
  ('site_a', gen_random_uuid()), ('site_b', gen_random_uuid()),
  ('night_a', gen_random_uuid()), ('secret_a', gen_random_uuid()), ('draft_a', gen_random_uuid()),
  ('off_a', gen_random_uuid()), ('gone_a', gen_random_uuid()), ('night_b', gen_random_uuid()),
  ('venue_a', gen_random_uuid()), ('venue_b', gen_random_uuid()),
  ('room_ok', gen_random_uuid()), ('room_long', gen_random_uuid()), ('room_dots', gen_random_uuid()), ('room_b', gen_random_uuid());

DO $fixture$
DECLARE
  v_owner uuid := (SELECT v FROM t9 WHERE k = 'owner');
  v_a uuid := (SELECT v FROM t9 WHERE k = 'a');
  v_b uuid := (SELECT v FROM t9 WHERE k = 'b');
  v_e record;
  v_r record;
  v_obj uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 't9-owner@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, contact_email, contact_phone) VALUES
    (v_a, v_owner, 'T9 Alpha', 't9-alpha', 'NGN', 'alpha-private@4453.invalid', '+2348000009453'),
    (v_b, v_owner, 'T9 Beta', 't9-beta', 'NGN', 'beta-private@4453.invalid', '+2348000009454');
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
    ((SELECT v FROM t9 WHERE k = 'site_a'), v_a, 'provisioning', v_owner),
    ((SELECT v FROM t9 WHERE k = 'site_b'), v_b, 'provisioning', v_owner);
  FOR v_e IN SELECT * FROM (VALUES
      ('night_a', 'a', 'night-a', 'public', 'scheduled', false),
      ('secret_a', 'a', 'secret-a', 'private', 'scheduled', false),
      ('draft_a', 'a', 'draft-a', 'public', 'draft', false),
      ('off_a', 'a', 'off-a', 'public', 'cancelled', false),
      ('gone_a', 'a', 'gone-a', 'public', 'scheduled', true),
      ('night_b', 'b', 'night-b', 'public', 'scheduled', false)) AS x(k, brand, slug, visibility, status, deleted)
  LOOP
    INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency, deleted_at)
    VALUES ((SELECT v FROM t9 WHERE k = v_e.k), (SELECT v FROM t9 WHERE k = v_e.brand), initcap(replace(v_e.slug, '-', ' ')),
      v_e.slug, 'event', v_e.visibility, v_e.status, 'Africa/Lagos', 'NGN', CASE WHEN v_e.deleted THEN now() END);
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES ((SELECT v FROM t9 WHERE k = v_e.k), now() + interval '5 days', now() + interval '5 days 3 hours', 'Africa/Lagos', true);
    INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total, display_order)
    VALUES ((SELECT v FROM t9 WHERE k = v_e.k), 'Free', 0, 'NGN', true, 50, 0);
  END LOOP;

  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
    ((SELECT v FROM t9 WHERE k = 'venue_a'), v_a, 't9alphastay', 'Alpha Stay', 6.45, 3.47, 'stay', 'verified'),
    ((SELECT v FROM t9 WHERE k = 'venue_b'), v_b, 't9betastay', 'Beta Stay', 6.46, 3.48, 'stay', 'verified');
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state) VALUES
    ((SELECT v FROM t9 WHERE k = 'venue_a'), v_a, 'resort', 'Africa/Lagos', 'instant', 'active'),
    ((SELECT v FROM t9 WHERE k = 'venue_b'), v_b, 'resort', 'Africa/Lagos', 'instant', 'active');
  -- Three rooms of A with one ready cover photo each (a normal name, a
  -- 901-character name, a name with ".."), and one room of B.
  FOR v_r IN SELECT * FROM (VALUES
      ('room_ok', 'a', 'venue_a', 'Ok Room', v_a::text || '/' || repeat('k', 859) || '.jpg'),
      ('room_long', 'a', 'venue_a', 'Long Room', v_a::text || '/' || repeat('l', 860) || '.jpg'),
      ('room_dots', 'a', 'venue_a', 'Dots Room', v_a::text || '/../escape.jpg'),
      ('room_b', 'b', 'venue_b', 'Beta Room', v_b::text || '/beta.jpg')) AS x(k, brand, venue, name, object_name)
  LOOP
    INSERT INTO public.stay_offerings(id, venue_id, brand_id, kind, name, summary, status, confirmation_mode,
        inventory_basis, unit_naming_mode, quantity, min_guests, max_guests, max_adults, max_children, amenities, accessibility_features)
    VALUES ((SELECT v FROM t9 WHERE k = v_r.k), (SELECT v FROM t9 WHERE k = v_r.venue), (SELECT v FROM t9 WHERE k = v_r.brand), 'room',
      v_r.name, '', 'live', 'instant', 'pooled_units', 'interchangeable', 2, 1, 2, 2, 0, ARRAY['Wi-Fi'], '{}');
    INSERT INTO storage.objects(id, bucket_id, name, metadata)
    VALUES (gen_random_uuid(), 'brand_covers', v_r.object_name, jsonb_build_object('mimetype', 'image/jpeg', 'size', 1000))
    RETURNING id INTO v_obj;
    INSERT INTO public.stay_offering_media(offering_id, brand_id, venue_id, storage_object_id, storage_bucket_id,
        storage_object_name, mime_type, byte_size, alt_text, sort_order, is_cover, status)
    VALUES ((SELECT v FROM t9 WHERE k = v_r.k), (SELECT v FROM t9 WHERE k = v_r.brand), (SELECT v FROM t9 WHERE k = v_r.venue),
      v_obj, 'brand_covers', v_r.object_name, 'image/jpeg', 1000, NULL, 1, true, 'ready');
  END LOOP;
END
$fixture$;

-- A-1 / A-2 / A-4 / A-5 with every flag on
DO $a$
DECLARE
  v_site uuid := (SELECT v FROM t9 WHERE k = 'site_a');
  v_feed jsonb := public.brand_site_offerings_feed((SELECT v FROM t9 WHERE k = 'site_a'));
  v_slugs text[];
  v_cover_ok text;
  v_all jsonb;
  v_bad text[];
BEGIN
  SELECT array_agg(o->>'slug' ORDER BY o->>'slug') INTO v_slugs FROM jsonb_array_elements(v_feed->'offerings') o;
  PERFORM pg_temp.p_assert(public.brand_site_offering_detail(v_site, 'event', 'night-a') IS NOT NULL
    AND 'night-a' = ANY (v_slugs), 'A-0 the site''s own public event has a detail and is in the feed');
  PERFORM pg_temp.p_assert(public.brand_site_offering_detail(v_site, 'event', 'night-b') IS NULL
    AND public.brand_site_offering_detail(v_site, 'event', (SELECT v FROM t9 WHERE k = 'night_b')::text) IS NULL
    AND public.brand_site_offering_detail(v_site, 'stay', (SELECT v FROM t9 WHERE k = 'room_b')::text) IS NULL
    AND public.brand_site_offering_detail(v_site, 'trip', 'night-b') IS NULL
    AND NOT ('night-b' = ANY (v_slugs)),
    'A-1 brand B''s event slug, its id and its room id all answer NULL on brand A''s site');
  PERFORM pg_temp.p_assert(
    public.brand_site_offering_detail(v_site, 'event', 'secret-a') IS NULL
    AND public.brand_site_offering_detail(v_site, 'event', 'draft-a') IS NULL
    AND public.brand_site_offering_detail(v_site, 'event', 'off-a') IS NULL
    AND public.brand_site_offering_detail(v_site, 'event', 'gone-a') IS NULL
    AND NOT (v_slugs && ARRAY['secret-a', 'draft-a', 'gone-a']),
    'A-2 private, draft, cancelled and deleted own events have no detail (private, draft, deleted not in the feed)');
  SELECT o->'cover'->>'path' INTO v_cover_ok FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = (SELECT v FROM t9 WHERE k = 'room_ok')::text;
  PERFORM pg_temp.p_assert(v_cover_ok LIKE 'brand_covers/%' AND char_length(v_cover_ok) = 913
    AND (SELECT o->'cover' FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = (SELECT v FROM t9 WHERE k = 'room_long')::text) = 'null'::jsonb
    AND (SELECT o->'cover' FROM jsonb_array_elements(v_feed->'offerings') o WHERE o->>'id' = (SELECT v FROM t9 WHERE k = 'room_dots')::text) = 'null'::jsonb,
    'A-4a the feed serves a 900-character photo name, and drops a 901-character or ".." name without erroring');
  PERFORM pg_temp.p_assert(
    jsonb_array_length(public.brand_site_offering_detail(v_site, 'stay', (SELECT v FROM t9 WHERE k = 'room_ok')::text)->'photos') = 1
    AND public.brand_site_offering_detail(v_site, 'stay', (SELECT v FROM t9 WHERE k = 'room_long')::text)->'photos' = '[]'::jsonb
    AND public.brand_site_offering_detail(v_site, 'stay', (SELECT v FROM t9 WHERE k = 'room_dots')::text)->'photos' = '[]'::jsonb,
    'A-4b the detail serves the same photos the feed would (never an over-long or ".." name)');
  v_all := jsonb_build_array(v_feed,
    public.brand_site_offering_detail(v_site, 'event', 'night-a'),
    public.brand_site_offering_detail(v_site, 'stay', (SELECT v FROM t9 WHERE k = 'room_ok')::text));
  SELECT array_agg(k) INTO v_bad FROM pg_temp.p_keys(v_all) k
  WHERE k ~* '(email|phone|user|guest_|owner|account|staff|reviewer|created_by|token|secret|password)';
  PERFORM pg_temp.p_assert(v_bad IS NULL AND position('4453.invalid' in v_all::text) = 0 AND position('800000945' in v_all::text) = 0,
    'A-5 no guest, owner or staff field and no private email or phone in the feed or any detail (found ' || COALESCE(array_to_string(v_bad, ','), '') || ')');
END
$a$;

-- A-3 one stay flag off
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'STAY_PUBLIC_PAGES';
SELECT pg_temp.p_assert(public.brand_site_offering_detail((SELECT v FROM t9 WHERE k = 'site_a'), 'stay', (SELECT v FROM t9 WHERE k = 'room_ok')::text) IS NULL
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_site_offerings_feed((SELECT v FROM t9 WHERE k = 'site_a'))->'offerings') o WHERE o->>'kind' = 'stay'),
  'A-3 STAY_PUBLIC_PAGES off: no stay rows and no room detail');
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'STAY_PUBLIC_PAGES';

-- A-6 detail flag off
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'SITES_DETAIL_PAGES';
SELECT pg_temp.p_assert(public.brand_site_offering_detail((SELECT v FROM t9 WHERE k = 'site_a'), 'event', 'night-a') IS NULL,
  'A-6 SITES_DETAIL_PAGES off: no detail for a live public event');

ROLLBACK;
