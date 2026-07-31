\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_signature text := 'public.pg_public_stays_discover(text,date,date,integer,integer,integer,text[],text[],text,integer,integer)';
BEGIN
  IF to_regprocedure(v_signature) IS NULL
     OR NOT has_function_privilege('anon', v_signature, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR pg_get_functiondef(v_signature::regprocedure) NOT LIKE '%SECURITY DEFINER%'
     OR pg_get_functiondef(v_signature::regprocedure) NOT LIKE '%SET search_path TO%'
  THEN
    RAISE EXCEPTION 'T-1423-01 FAIL: public Stay discovery ACL/search path is unsafe';
  END IF;
  RAISE NOTICE 'T-1423-01 PASS: public Stay discovery is pinned and anon-readable';
END;
$catalog$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1423-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'owner-1423@example.test', now(), now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1423-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '00000000-1423-4000-8000-000000000002',
  '00000000-1423-4000-8000-000000000001',
  'Issue 1423 Stay Brand', 'issue-1423-stay-brand', 'NGN',
  'ACCT_issue1423', now(), now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, address, city, country_code,
  lat, lng, venue_category, claim_status
) VALUES
  (
    '00000000-1423-4000-8000-000000000003',
    '00000000-1423-4000-8000-000000000002',
    'lagoonresort1423', 'Lagoon Resort', '1 Water Street', 'Lagos', 'NG',
    6.45, 3.47, 'stay', 'verified'
  ),
  (
    '00000000-1423-4000-8000-000000000004',
    '00000000-1423-4000-8000-000000000002',
    'draftresort1423', 'Unverified Resort', '2 Water Street', 'Lagos', 'NG',
    6.46, 3.48, 'stay', 'pending_review'
  );

INSERT INTO public.stay_settings (
  venue_id, brand_id, property_kind, timezone, default_booking_mode,
  booking_horizon_days, booking_state
) VALUES
  (
    '00000000-1423-4000-8000-000000000003',
    '00000000-1423-4000-8000-000000000002',
    'resort', 'UTC', 'instant', 365, 'active'
  ),
  (
    '00000000-1423-4000-8000-000000000004',
    '00000000-1423-4000-8000-000000000002',
    'hotel', 'UTC', 'instant', 365, 'active'
  );

INSERT INTO public.stay_offerings (
  id, venue_id, brand_id, kind, name, description, status,
  confirmation_mode, inventory_basis, unit_naming_mode, quantity,
  min_guests, max_guests, max_adults, max_children, amenities
) VALUES
  (
    '00000000-1423-4000-8000-000000000011',
    '00000000-1423-4000-8000-000000000003',
    '00000000-1423-4000-8000-000000000002',
    'room', 'Lagoon Suite', 'A real suite', 'live', 'instant',
    'pooled_units', 'interchangeable', 4, 1, 4, 4, 2,
    ARRAY['Wi-Fi', 'Pool']
  ),
  (
    '00000000-1423-4000-8000-000000000012',
    '00000000-1423-4000-8000-000000000003',
    '00000000-1423-4000-8000-000000000002',
    'room', 'Wrong currency room', 'Must never price the property', 'live', 'instant',
    'pooled_units', 'interchangeable', 4, 1, 4, 4, 2,
    ARRAY['Wi-Fi']
  ),
  (
    '00000000-1423-4000-8000-000000000013',
    '00000000-1423-4000-8000-000000000003',
    '00000000-1423-4000-8000-000000000002',
    'room', 'Draft cheap room', 'Must never price the property', 'draft', 'instant',
    'pooled_units', 'interchangeable', 4, 1, 4, 4, 2,
    ARRAY['Wi-Fi']
  ),
  (
    '00000000-1423-4000-8000-000000000014',
    '00000000-1423-4000-8000-000000000004',
    '00000000-1423-4000-8000-000000000002',
    'room', 'Unverified room', 'Must not leak', 'live', 'instant',
    'pooled_units', 'interchangeable', 4, 1, 4, 4, 2,
    ARRAY['Wi-Fi']
  );

INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
SELECT
  fixture.object_id,
  'brand_covers',
  '00000000-1423-4000-8000-000000000002/stay/' || fixture.file_name,
  '00000000-1423-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":1024,"width":1600,"height":900}'::jsonb
FROM (VALUES
  ('00000000-1423-4000-8000-000000000021'::uuid, 'lagoon.jpg'),
  ('00000000-1423-4000-8000-000000000022'::uuid, 'wrong-currency.jpg'),
  ('00000000-1423-4000-8000-000000000023'::uuid, 'draft.jpg'),
  ('00000000-1423-4000-8000-000000000024'::uuid, 'unverified.jpg')
) fixture(object_id, file_name);

INSERT INTO public.stay_offering_media (
  offering_id, brand_id, venue_id, storage_object_id,
  storage_bucket_id, storage_object_name, mime_type, byte_size,
  width, height, alt_text, sort_order, is_cover, status
)
SELECT
  fixture.offering_id,
  '00000000-1423-4000-8000-000000000002',
  fixture.venue_id,
  fixture.object_id,
  'brand_covers',
  '00000000-1423-4000-8000-000000000002/stay/' || fixture.file_name,
  'image/jpeg', 1024, 1600, 900, fixture.alt_text, 0, true, 'ready'
FROM (VALUES
  ('00000000-1423-4000-8000-000000000011'::uuid, '00000000-1423-4000-8000-000000000003'::uuid, '00000000-1423-4000-8000-000000000021'::uuid, 'lagoon.jpg', 'Lagoon Suite'),
  ('00000000-1423-4000-8000-000000000012'::uuid, '00000000-1423-4000-8000-000000000003'::uuid, '00000000-1423-4000-8000-000000000022'::uuid, 'wrong-currency.jpg', 'Wrong currency room'),
  ('00000000-1423-4000-8000-000000000013'::uuid, '00000000-1423-4000-8000-000000000003'::uuid, '00000000-1423-4000-8000-000000000023'::uuid, 'draft.jpg', 'Draft room'),
  ('00000000-1423-4000-8000-000000000014'::uuid, '00000000-1423-4000-8000-000000000004'::uuid, '00000000-1423-4000-8000-000000000024'::uuid, 'unverified.jpg', 'Unverified room')
) fixture(offering_id, venue_id, object_id, file_name, alt_text);

INSERT INTO public.stay_price_versions (
  offering_id, brand_id, venue_id, version_number,
  amount_minor, currency_code, pricing_unit
)
SELECT
  offering.id, offering.brand_id, offering.venue_id, 1,
  CASE offering.id
    WHEN '00000000-1423-4000-8000-000000000011' THEN 12500000
    WHEN '00000000-1423-4000-8000-000000000012' THEN 1
    WHEN '00000000-1423-4000-8000-000000000013' THEN 2
    ELSE 3
  END,
  CASE
    WHEN offering.id = '00000000-1423-4000-8000-000000000012' THEN 'USD'
    ELSE 'NGN'
  END,
  'room_night'
FROM public.stay_offerings offering
WHERE offering.id IN (
  '00000000-1423-4000-8000-000000000011',
  '00000000-1423-4000-8000-000000000012',
  '00000000-1423-4000-8000-000000000013',
  '00000000-1423-4000-8000-000000000014'
);

INSERT INTO public.stay_policy_versions (
  offering_id, brand_id, venue_id, version_number, cancellation_policy
)
SELECT offering.id, offering.brand_id, offering.venue_id, 1, 'Flexible policy'
FROM public.stay_offerings offering
WHERE offering.id IN (
  '00000000-1423-4000-8000-000000000011',
  '00000000-1423-4000-8000-000000000012',
  '00000000-1423-4000-8000-000000000013',
  '00000000-1423-4000-8000-000000000014'
);

INSERT INTO public.stay_room_nights (
  offering_id, local_date, brand_id, venue_id, sellable_quantity
)
SELECT
  offering.id,
  (now() AT TIME ZONE 'UTC')::date + day_offset,
  offering.brand_id,
  offering.venue_id,
  3
FROM public.stay_offerings offering
CROSS JOIN generate_series(30, 32) day_offset
WHERE offering.id IN (
  '00000000-1423-4000-8000-000000000011',
  '00000000-1423-4000-8000-000000000012',
  '00000000-1423-4000-8000-000000000013',
  '00000000-1423-4000-8000-000000000014'
);

UPDATE public.feature_flags SET is_enabled = false
WHERE flag_key = 'STAY_PUBLIC_PAGES';

DO $dark$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.pg_public_stays_discover();
  IF v_result <> '{"enabled":false,"rows":[],"totalCount":0}'::jsonb THEN
    RAISE EXCEPTION 'T-1423-02 FAIL: dark response is not explicit: %', v_result;
  END IF;
  RAISE NOTICE 'T-1423-02 PASS: disabled discovery fails closed explicitly';
END;
$dark$;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key = 'STAY_PUBLIC_PAGES';

DO $happy$
DECLARE
  v_from date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_to date := (now() AT TIME ZONE 'UTC')::date + 33;
  v_result jsonb;
BEGIN
  v_result := public.pg_public_stays_discover(
    'Lagos', v_from, v_to, 4, 0, 2,
    ARRAY['resort'], ARRAY['Wi-Fi', 'Pool'], 'instant', 20, 0
  );
  IF v_result->>'enabled' <> 'true'
     OR v_result->>'totalCount' <> '1'
     OR jsonb_array_length(v_result->'rows') <> 1
     OR v_result#>>'{rows,0,venueName}' <> 'Lagoon Resort'
     OR v_result#>>'{rows,0,propertyKind}' <> 'resort'
     OR v_result#>>'{rows,0,amountMinor}' <> '12500000'
     OR v_result#>>'{rows,0,currencyCode}' <> 'NGN'
     OR v_result#>>'{rows,0,availabilityState}' <> 'available'
     OR v_result#>>'{rows,0,coverPath}' NOT LIKE '%lagoon.jpg'
  THEN
    RAISE EXCEPTION 'T-1423-03 FAIL: verified multi-room NGN result is wrong: %', v_result;
  END IF;
  RAISE NOTICE 'T-1423-03 PASS: verified multi-room Stay returns exact source currency';
END;
$happy$;

DO $inventory_changes$
DECLARE
  v_from date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_to date := (now() AT TIME ZONE 'UTC')::date + 33;
  v_result jsonb;
BEGIN
  UPDATE public.stay_room_nights
  SET sellable_quantity = 1
  WHERE offering_id = '00000000-1423-4000-8000-000000000011'
    AND local_date = v_from;
  v_result := public.pg_public_stays_discover(
    NULL, v_from, v_to, 4, 0, 2, NULL, NULL, NULL, 20, 0
  );
  IF v_result->>'totalCount' <> '0' THEN
    RAISE EXCEPTION 'T-1423-04 FAIL: two-room search ignored changed nightly stock: %', v_result;
  END IF;

  UPDATE public.stay_room_nights
  SET sellable_quantity = 3, stop_sell = true
  WHERE offering_id = '00000000-1423-4000-8000-000000000011'
    AND local_date = v_from + 1;
  v_result := public.pg_public_stays_discover(
    NULL, v_from, v_to, 2, 0, 1, NULL, NULL, NULL, 20, 0
  );
  IF v_result->>'totalCount' <> '0' THEN
    RAISE EXCEPTION 'T-1423-04 FAIL: stop-sold night still appeared: %', v_result;
  END IF;
  RAISE NOTICE 'T-1423-04 PASS: every requested night and room is enforced';
END;
$inventory_changes$;

ROLLBACK;
