-- #4420 migration 20280719004420: an experience's street address never leaves the
-- server while the host hides it until booking. Runs on the fully replayed PG17
-- schema as anon (the buyer-web / Explorer caller); everything rolls back.
--
-- MINGLA-INVARIANT: I-4420-EXPERIENCE-VENUE-LINE-PRIVATE | issue #4420 | while an experience hides its address (hideAddressUntilTicket true or absent), pg_public_experience_by_slug venueText, pg_public_experiences_by_brand and pg_brand_experiences_for_place venue_text and theme, and the place reader's stop place id, street and pin carry no street: only the first stop's area line (city or region, country code) or NULL; a visible address is unchanged (H-SLUG, H-LEGACY, H-NOAREA, V-SLUG, V-FALLBACK, B-HIDDEN, B-VISIBLE, P-HIDDEN, P-VISIBLE, G-ACL)
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4420v_check(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    PERFORM set_config('t4420v.failures',
      COALESCE(NULLIF(current_setting('t4420v.failures', true), ''), '') || E'\n  - ' || p_message, true);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: one brand, one verified venue on a place, four experiences.
--   hid  hideAddressUntilTicket = true, venue_text = the street (as publish writes it)
--   leg  no hideAddressUntilTicket key at all (a legacy row: withheld, fail closed)
--   vis  hideAddressUntilTicket = false, venue_text = the street
--   fbk  hideAddressUntilTicket = false, no venue_text (falls back to the stop)
--   nar  hidden, and the stop has no city or region (no area to show)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner uuid := '44200000-0000-4000-8000-0000000000a1';
  v_brand uuid := '44200000-0000-4000-8000-0000000000b1';
  v_place uuid := '44200000-0000-4000-8000-0000000000c1';
  v_street text := '12 Hidden Lane, Raleigh, NC 27601, USA';
  r record;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'i4420v-owner@example.test');
  INSERT INTO public.profiles(id, email) VALUES (v_owner, 'i4420v-owner@example.test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at)
    VALUES (v_brand, v_owner, 'Venue line brand', 'i4420v-brand', 'USD', now(), now());
  INSERT INTO public.place_pool(id, name, lat, lng) VALUES (v_place, 'i4420v place', 35.78, -78.64);
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status, place_pool_id)
    VALUES ('44200000-0000-4000-8000-0000000000d1', v_brand, 'i4420vvenue', 'i4420v venue', 35.78, -78.64,
            'restaurant', 'verified', v_place);

  FOR r IN SELECT * FROM (VALUES
      ('hid', '44200000-0000-4000-8000-000000000e01'::uuid,
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true,
                             'location', jsonb_build_object('address', '1 Secret St', 'venueName', 'Back room')),
                           'experience_meta', jsonb_build_object('venue_text', v_street)),
        'Raleigh', NULL::text, 'us'),
      ('leg', '44200000-0000-4000-8000-000000000e02'::uuid,
        jsonb_build_object('experience_meta', jsonb_build_object('venue_text', v_street)),
        NULL::text, 'Lagos State', 'NG'),
      ('vis', '44200000-0000-4000-8000-000000000e03'::uuid,
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false),
                           'experience_meta', jsonb_build_object('venue_text', v_street)),
        'Raleigh', NULL::text, 'US'),
      ('fbk', '44200000-0000-4000-8000-000000000e04'::uuid,
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', false)),
        'Raleigh', NULL::text, 'US'),
      ('nar', '44200000-0000-4000-8000-000000000e05'::uuid,
        jsonb_build_object('business_event', jsonb_build_object('hideAddressUntilTicket', true),
                           'experience_meta', jsonb_build_object('venue_text', v_street)),
        NULL::text, '  ', 'US')
    ) AS t(k, id, theme, city, region, cc)
  LOOP
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone,
        currency, published_at, experience_intents, theme, created_at, updated_at)
      VALUES (r.id, v_brand, v_owner, 'Venue line ' || r.k, 'i4420v-' || r.k, 'experience', 'scheduled', 'public',
        'UTC', 'USD', now(), ARRAY['group-fun'], r.theme, now(), now());
    INSERT INTO public.experience_stops(event_id, stop_order, place_id, place_name, address, city, region,
        country_code, lat, lng)
      VALUES (r.id, 0, 'gplace-' || r.k, 'First stop ' || r.k, v_street, r.city, r.region, r.cc, 35.7796, -78.6382),
             (r.id, 1, 'gplace2-' || r.k, 'Second stop ' || r.k, '99 Other Rd, Raleigh, NC', 'Durham', NULL, 'US',
              35.99, -78.9);
  END LOOP;
END
$$;

-- Read every public surface as anon (the buyer web / Explorer caller).
CREATE TEMP TABLE t4420v_slug(k text, p jsonb);
CREATE TEMP TABLE t4420v_brand AS SELECT * FROM public.pg_public_experiences_by_brand('none') WITH NO DATA;
CREATE TEMP TABLE t4420v_place AS SELECT * FROM public.pg_brand_experiences_for_place(gen_random_uuid()) WITH NO DATA;
GRANT ALL ON t4420v_slug, t4420v_brand, t4420v_place TO anon;

SET LOCAL ROLE anon;
INSERT INTO t4420v_slug
  SELECT k, public.pg_public_experience_by_slug('i4420v-brand', 'i4420v-' || k)::jsonb
    FROM unnest(ARRAY['hid', 'leg', 'vis', 'fbk', 'nar']) AS k;
INSERT INTO t4420v_brand SELECT * FROM public.pg_public_experiences_by_brand('i4420v-brand');
INSERT INTO t4420v_place SELECT * FROM public.pg_brand_experiences_for_place('44200000-0000-4000-8000-0000000000c1');
RESET ROLE;

-- H-SLUG: hidden -> the area line, never the street; stops stay street-free.
SELECT pg_temp.t4420v_check((SELECT p->>'venueText' FROM t4420v_slug WHERE k = 'hid') = 'Raleigh, US',
  'H-SLUG hidden venueText is the area line "Raleigh, US", got '
  || COALESCE((SELECT p->>'venueText' FROM t4420v_slug WHERE k = 'hid'), 'NULL'));
SELECT pg_temp.t4420v_check(
  NOT EXISTS (SELECT 1 FROM t4420v_slug WHERE k IN ('hid', 'leg', 'nar')
               AND (p::text LIKE '%Hidden Lane%' OR p::text LIKE '%Other Rd%' OR p::text LIKE '%Secret St%')),
  'H-SLUG no hidden by-slug payload carries a street');
SELECT pg_temp.t4420v_check(
  (SELECT bool_and(s->'address' = 'null'::jsonb AND s->'lat' = 'null'::jsonb)
     FROM t4420v_slug, jsonb_array_elements(p->'stops') AS s WHERE k = 'hid'),
  'H-SLUG hidden stops carry no street or pin');

-- H-LEGACY: no hideAddressUntilTicket key -> withheld; region stands in for a missing city.
SELECT pg_temp.t4420v_check((SELECT p->>'venueText' FROM t4420v_slug WHERE k = 'leg') = 'Lagos State, NG',
  'H-LEGACY a legacy row is withheld and shows "Lagos State, NG", got '
  || COALESCE((SELECT p->>'venueText' FROM t4420v_slug WHERE k = 'leg'), 'NULL'));

-- H-NOAREA: hidden with no city or region -> NULL (missing is hidden, never faked).
SELECT pg_temp.t4420v_check((SELECT p->'venueText' FROM t4420v_slug WHERE k = 'nar') = 'null'::jsonb,
  'H-NOAREA hidden with no area returns a null venueText');

-- V-SLUG / V-FALLBACK: a visible address is unchanged.
SELECT pg_temp.t4420v_check(
  (SELECT p->>'venueText' FROM t4420v_slug WHERE k = 'vis') = '12 Hidden Lane, Raleigh, NC 27601, USA',
  'V-SLUG visible venueText is still venue_text');
SELECT pg_temp.t4420v_check(
  (SELECT p->>'venueText' FROM t4420v_slug WHERE k = 'fbk') = '12 Hidden Lane, Raleigh, NC 27601, USA',
  'V-FALLBACK visible with no venue_text still falls back to the first stop''s address');
SELECT pg_temp.t4420v_check(
  (SELECT (s->>'address') FROM t4420v_slug, jsonb_array_elements(p->'stops') AS s
    WHERE k = 'vis' AND (s->>'stopOrder')::int = 0) = '12 Hidden Lane, Raleigh, NC 27601, USA',
  'V-SLUG visible stops keep their street');

-- B-HIDDEN: brand-page cards.
SELECT pg_temp.t4420v_check(
  (SELECT venue_text FROM t4420v_brand WHERE experience_slug = 'i4420v-hid') = 'Raleigh, US',
  'B-HIDDEN brand card venue_text is the area line');
SELECT pg_temp.t4420v_check(
  NOT EXISTS (SELECT 1 FROM t4420v_brand
               WHERE experience_slug IN ('i4420v-hid', 'i4420v-leg', 'i4420v-nar')
                 AND (COALESCE(venue_text, '') LIKE '%Hidden Lane%' OR theme::text LIKE '%Hidden Lane%'
                      OR theme::text LIKE '%Secret St%')),
  'B-HIDDEN no hidden brand card carries the street in venue_text or theme');
SELECT pg_temp.t4420v_check(
  (SELECT (theme #>> '{business_event,hideAddressUntilTicket}')::boolean
          AND theme #>> '{business_event,location,venueName}' = 'Back room'
     FROM t4420v_brand WHERE experience_slug = 'i4420v-hid'),
  'B-HIDDEN the projected theme keeps the hide flag and the venue name');
-- B-VISIBLE
SELECT pg_temp.t4420v_check(
  (SELECT venue_text = '12 Hidden Lane, Raleigh, NC 27601, USA'
          AND theme #>> '{experience_meta,venue_text}' = '12 Hidden Lane, Raleigh, NC 27601, USA'
     FROM t4420v_brand WHERE experience_slug = 'i4420v-vis'),
  'B-VISIBLE a visible brand card keeps venue_text and theme.experience_meta.venue_text');

-- P-HIDDEN: Explorer place sheet.
SELECT pg_temp.t4420v_check(
  (SELECT venue_text FROM t4420v_place WHERE experience_slug = 'i4420v-hid') = 'Raleigh, US',
  'P-HIDDEN place card venue_text is the area line');
SELECT pg_temp.t4420v_check(
  (SELECT bool_and(s->'address' = 'null'::jsonb AND s->'lat' = 'null'::jsonb AND s->'lng' = 'null'::jsonb
                   AND s->>'place_id' NOT LIKE 'gplace%')
     FROM t4420v_place, jsonb_array_elements(stops) AS s
    WHERE experience_slug IN ('i4420v-hid', 'i4420v-leg', 'i4420v-nar')),
  'P-HIDDEN hidden stops carry no street, pin or map place id');
SELECT pg_temp.t4420v_check(
  NOT EXISTS (SELECT 1 FROM t4420v_place
               WHERE experience_slug IN ('i4420v-hid', 'i4420v-leg', 'i4420v-nar')
                 AND (stops::text LIKE '%Hidden Lane%' OR theme::text LIKE '%Hidden Lane%'
                      OR COALESCE(venue_text, '') LIKE '%Hidden Lane%')),
  'P-HIDDEN no hidden place row carries the street anywhere');
-- P-VISIBLE
SELECT pg_temp.t4420v_check(
  (SELECT bool_and(s->>'address' IS NOT NULL AND s->>'lat' IS NOT NULL AND s->>'place_id' LIKE 'gplace%')
     FROM t4420v_place, jsonb_array_elements(stops) AS s WHERE experience_slug = 'i4420v-vis'),
  'P-VISIBLE visible stops keep street, pin and place id');

-- G-ACL: the rule is not callable by app clients; the readers still are.
SELECT pg_temp.t4420v_check(
  NOT has_function_privilege('anon', 'public.issue_4420_experience_venue_line(uuid,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.issue_4420_experience_venue_line(uuid,jsonb)', 'EXECUTE'),
  'G-ACL anon and authenticated cannot execute issue_4420_experience_venue_line');
SELECT pg_temp.t4420v_check(
  has_function_privilege('anon', 'public.pg_public_experience_by_slug(text,text)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.pg_public_experiences_by_brand(text)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.pg_brand_experiences_for_place(uuid)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.issue_2489_public_theme(jsonb)', 'EXECUTE'),
  'G-ACL the public readers keep their anon grants');

DO $$
DECLARE v_failures text := NULLIF(current_setting('t4420v.failures', true), '');
BEGIN
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'I-4420-EXPERIENCE-VENUE-LINE-PRIVATE failed:%', v_failures;
  END IF;
  RAISE NOTICE 'I-4420-EXPERIENCE-VENUE-LINE-PRIVATE: PASS (H-SLUG, H-LEGACY, H-NOAREA, V-SLUG, V-FALLBACK, B-HIDDEN, B-VISIBLE, P-HIDDEN, P-VISIBLE, G-ACL)';
END
$$;

ROLLBACK;
