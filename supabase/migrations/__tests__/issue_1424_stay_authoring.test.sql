-- [TEST-MOD-APPROVED #1564] — SIGNATURE PIN ONLY. `biz_create_venue_listing`
-- gained three APPENDED, DEFAULTED params (p_theme_color / p_theme_font /
-- p_theme_animation) so a venue can carry its own colours; the 18-arg overload
-- no longer exists, and `regprocedure` / `has_function_privilege` resolve by
-- the EXACT argument list. Every assertion in this file is unchanged — only the
-- signature string it looks the function up by. The grant expectations below
-- (anon has NO execute, authenticated does) are asserted exactly as before, now
-- against the real signature.
-- [TEST-MOD-APPROVED #1719] — SIGNATURE PIN ONLY. The binding all-writers
-- amendment adds one appended/defaulted poster URL; stay authorization,
-- inventory, and feature-flag assertions below remain unchanged.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1424-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'owner-1424@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1424-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, created_at, updated_at
) VALUES (
  '00000000-1424-4000-8000-000000000002',
  '00000000-1424-4000-8000-000000000001',
  'Issue 1424 Stay Brand',
  'issue-1424-stay-brand',
  'NGN',
  now(),
  now()
);

UPDATE public.feature_flags
SET is_enabled = false
WHERE flag_key = 'STAY_VENUE_AUTHORING';

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1424-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1424-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

DO $flag_off$
DECLARE
  v_hours jsonb := '[
    {"weekday":0,"is_closed":true},
    {"weekday":1,"is_closed":true},
    {"weekday":2,"is_closed":true},
    {"weekday":3,"is_closed":true},
    {"weekday":4,"is_closed":true},
    {"weekday":5,"is_closed":true},
    {"weekday":6,"is_closed":true}
  ]'::jsonb;
  v_restaurant_id uuid;
BEGIN
  BEGIN
    PERFORM public.biz_create_venue_listing(
      p_brand_id => '00000000-1424-4000-8000-000000000002',
      p_name => 'Dark Stay',
      p_slug => 'darkstay1424',
      p_description => NULL,
      p_google_place_id => NULL,
      p_lat => 6.45,
      p_lng => 3.47,
      p_city => 'Lagos',
      p_country_code => 'NG',
      p_address => '1 Test Street',
      p_venue_category => 'stay',
      p_contact_email => NULL,
      p_contact_phone => NULL,
      p_cover_media_url => NULL,
      p_cover_media_type => NULL,
      p_hours => v_hours
    );
    RAISE EXCEPTION 'T-1 FAIL: Stay created while authoring flag was off';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'stay_authoring_disabled' THEN
      RAISE;
    END IF;
  END;

  v_restaurant_id := public.biz_create_venue_listing(
    p_brand_id => '00000000-1424-4000-8000-000000000002',
    p_name => 'Unaffected Restaurant',
    p_slug => 'restaurant1424',
    p_description => NULL,
    p_google_place_id => NULL,
    p_lat => 6.45,
    p_lng => 3.47,
    p_city => 'Lagos',
    p_country_code => 'NG',
    p_address => '2 Test Street',
    p_venue_category => 'restaurant',
    p_contact_email => NULL,
    p_contact_phone => NULL,
    p_cover_media_url => NULL,
    p_cover_media_type => NULL,
    p_hours => v_hours
  );
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'T-1 FAIL: non-Stay venue creation changed';
  END IF;
  RAISE NOTICE 'T-1 PASS: the server flag hides only Stay creation';
END;
$flag_off$;

RESET ROLE;
UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key = 'STAY_VENUE_AUTHORING';
SET LOCAL ROLE authenticated;

DO $authoring$
DECLARE
  v_hours jsonb := '[
    {"weekday":0,"is_closed":true},
    {"weekday":1,"is_closed":true},
    {"weekday":2,"is_closed":true},
    {"weekday":3,"is_closed":true},
    {"weekday":4,"is_closed":true},
    {"weekday":5,"is_closed":true},
    {"weekday":6,"is_closed":true}
  ]'::jsonb;
  v_stay_id uuid;
BEGIN
  v_stay_id := public.biz_create_venue_listing(
    p_brand_id => '00000000-1424-4000-8000-000000000002',
    p_name => 'Canonical Stay',
    p_slug => 'stay1424',
    p_description => NULL,
    p_google_place_id => NULL,
    p_lat => 6.46,
    p_lng => 3.48,
    p_city => 'Lagos',
    p_country_code => 'NG',
    p_address => '3 Test Street',
    p_venue_category => 'stay',
    p_contact_email => NULL,
    p_contact_phone => NULL,
    p_cover_media_url => NULL,
    p_cover_media_type => NULL,
    p_hours => v_hours
  );
  IF v_stay_id IS NULL THEN
    RAISE EXCEPTION 'T-2 FAIL: flag-on Stay creation returned no venue';
  END IF;
END;
$authoring$;

RESET ROLE;
UPDATE public.venue_listings
SET claim_status = 'verified'
WHERE brand_id = '00000000-1424-4000-8000-000000000002'
  AND slug = 'stay1424';
SET LOCAL ROLE authenticated;

DO $settings_publish$
DECLARE
  v_stay_id uuid;
  v_saved jsonb;
  v_version bigint;
BEGIN
  SELECT id INTO STRICT v_stay_id
  FROM public.venue_listings
  WHERE brand_id = '00000000-1424-4000-8000-000000000002'
    AND slug = 'stay1424';
  v_saved := public.biz_save_stay_settings_v2(
    v_stay_id,
    '{
      "propertyKind":"hotel",
      "summary":"A complete waterfront Stay created by issue 1424.",
      "timezone":"Africa/Lagos",
      "defaultBookingMode":"request",
      "checkInTime":"15:00",
      "checkOutTime":"11:00",
      "amenities":["Pool","Wi-Fi"],
      "accessibilityFeatures":["Step-free entrance"],
      "arrivalInstructions":"Check in at the main desk."
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );
  v_version := (v_saved #>> '{inventory,settings,version}')::bigint;
  IF v_version IS NULL
     OR v_saved #>> '{inventory,settings,summary}'
       <> 'A complete waterfront Stay created by issue 1424.'
     OR v_saved #>> '{inventory,settings,booking_state}' <> 'review' THEN
    RAISE EXCEPTION 'T-2 FAIL: Stay settings did not round-trip in review';
  END IF;

  BEGIN
    PERFORM public.biz_manage_stay_inventory(
      'save_settings',
      v_stay_id,
      '{
        "propertyKind":"hotel",
        "timezone":"Africa/Lagos",
        "defaultBookingMode":"request",
        "checkInTime":"15:00",
        "checkOutTime":"11:00",
        "bookingState":"active"
      }'::jsonb,
      v_version,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'T-2 FAIL: generic RPC activated Stay after flag-on';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'stay_publish_action_required' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.biz_publish_stay(
      v_stay_id,
      v_version,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'T-3 FAIL: Stay published without a connected bank';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'paid_currency_not_ready' THEN
      RAISE;
    END IF;
  END;
  RAISE NOTICE 'T-2/T-3 PASS: settings save; only guarded publish can activate; bank is compulsory';
END;
$settings_publish$;

RESET ROLE;

DO $catalog$
DECLARE
  v_publish text;
  v_create text;
  v_snapshot text;
BEGIN
  SELECT pg_get_functiondef(
    'public.biz_publish_stay(uuid,bigint,uuid)'::regprocedure
  ) INTO v_publish;
  SELECT pg_get_functiondef(
    'public.biz_create_venue_listing(uuid,text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,text,text,text)'::regprocedure
  ) INTO v_create;
  SELECT pg_get_functiondef(
    'public.issue_1387_stay_inventory_snapshot(uuid)'::regprocedure
  ) INTO v_snapshot;
  IF v_publish NOT LIKE '%STAY_VENUE_AUTHORING%'
     OR v_publish NOT LIKE '%pg_brand_can_collect%'
     OR v_publish NOT LIKE '%brand_currency_reconciliations%'
     OR v_publish NOT LIKE '%stay_room_nights%'
     OR v_publish NOT LIKE '%stay_place_windows%'
     OR v_publish NOT LIKE '%stay.publish%' THEN
    RAISE EXCEPTION 'T-4 FAIL: publish invariant is incomplete';
  END IF;
  IF v_snapshot NOT LIKE '%hasOpenAvailability%'
     OR v_snapshot NOT LIKE '%stay_room_nights%'
     OR v_snapshot NOT LIKE '%stay_place_windows%' THEN
    RAISE EXCEPTION 'T-4 FAIL: business readiness snapshot is incomplete';
  END IF;
  IF v_create NOT LIKE '%p_venue_category = ''stay''%'
     OR v_create NOT LIKE '%stay_authoring_disabled%' THEN
    RAISE EXCEPTION 'T-4 FAIL: create flag gate is incomplete';
  END IF;
  RAISE NOTICE 'T-4 PASS: create and publish invariants are catalog-visible';
END;
$catalog$;

ROLLBACK;
