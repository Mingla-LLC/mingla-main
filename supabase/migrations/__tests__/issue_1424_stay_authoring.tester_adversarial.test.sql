\set ON_ERROR_STOP on
BEGIN;

-- Tester-owned security proof: an authenticated user outside the exact brand
-- cannot inspect, edit, or publish another brand's Stay.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  (
    '00000000-1424-4000-8000-000000000101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner-1424-adversarial@example.test',
    now(),
    now()
  ),
  (
    '00000000-1424-4000-8000-000000000102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'outsider-1424-adversarial@example.test',
    now(),
    now()
  );

INSERT INTO public.creator_accounts (id, created_at)
VALUES
  ('00000000-1424-4000-8000-000000000101', now()),
  ('00000000-1424-4000-8000-000000000102', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, created_at, updated_at
) VALUES (
  '00000000-1424-4000-8000-000000000103',
  '00000000-1424-4000-8000-000000000101',
  'Issue 1424 Tenancy Brand',
  'issue-1424-tenancy-brand',
  'NGN',
  now(),
  now()
);

UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key = 'STAY_VENUE_AUTHORING';

INSERT INTO public.venue_listings (
  id,
  brand_id,
  name,
  slug,
  address,
  lat,
  lng,
  city,
  country_code,
  venue_category,
  claim_status
) VALUES (
  '00000000-1424-4000-8000-000000000104',
  '00000000-1424-4000-8000-000000000103',
  'Owned Stay',
  'ownedstay1424',
  '1424 Tenancy Street',
  6.46,
  3.48,
  'Lagos',
  'NG',
  'stay',
  'verified'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1424-4000-8000-000000000101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1424-4000-8000-000000000101',
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

DO $property_kind_is_optional$
DECLARE
  v_stay_id uuid := '00000000-1424-4000-8000-000000000104';
  v_property_kind text;
BEGIN
  PERFORM public.biz_save_stay_settings_v2(
    v_stay_id,
    '{
      "summary":"A complete Stay can be saved without choosing a property type.",
      "timezone":"Africa/Lagos",
      "checkInTime":"15:00",
      "checkOutTime":"11:00"
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );

  SELECT settings.property_kind
  INTO v_property_kind
  FROM public.stay_settings settings
  WHERE settings.venue_id = v_stay_id;

  IF v_property_kind IS NOT NULL THEN
    RAISE EXCEPTION 'TA-0 FAIL: property kind was fabricated as %', v_property_kind;
  END IF;

  RAISE NOTICE 'TA-0 PASS: null property kind saves as optional metadata';
END;
$property_kind_is_optional$;

RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1424-4000-8000-000000000102',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1424-4000-8000-000000000102',
    'role', 'authenticated'
  )::text,
  true
);
SET LOCAL ROLE authenticated;

DO $outsider_is_denied$
DECLARE
  v_stay_id uuid := '00000000-1424-4000-8000-000000000104';
BEGIN
  BEGIN
    PERFORM public.issue_1387_stay_inventory_snapshot(v_stay_id);
    RAISE EXCEPTION 'TA-1 FAIL: outsider inspected another brand Stay';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.biz_save_stay_settings_v2(
      v_stay_id,
      '{
        "propertyKind":"hotel",
        "summary":"An outsider must never be able to save this Stay.",
        "timezone":"Africa/Lagos",
        "checkInTime":"15:00",
        "checkOutTime":"11:00"
      }'::jsonb,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'TA-2 FAIL: outsider edited another brand Stay';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.biz_publish_stay(v_stay_id, 1, gen_random_uuid());
    RAISE EXCEPTION 'TA-3 FAIL: outsider published another brand Stay';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'TA-1/TA-2/TA-3 PASS: exact-brand tenancy protects read, edit, and publish';
END;
$outsider_is_denied$;

ROLLBACK;
