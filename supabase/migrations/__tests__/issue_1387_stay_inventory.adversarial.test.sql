\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1387-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'adversarial-owner-1387@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1387-4000-8000-000000000101', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '00000000-1387-4000-8000-000000000102',
  '00000000-1387-4000-8000-000000000101',
  'Issue 1387 Adversarial Stay Brand',
  'issue-1387-adversarial-stay-brand',
  'USD',
  'ACCT_issue1387_adversarial',
  now(),
  now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1387-4000-8000-000000000104',
  '00000000-1387-4000-8000-000000000102',
  'adversarialstay',
  'Adversarial Stay',
  6.45,
  3.47,
  'stay',
  'verified'
);

INSERT INTO storage.objects (
  id, bucket_id, name, owner, metadata
) VALUES
  (
    '00000000-1387-4000-8000-000000000121',
    'brand_covers',
    '00000000-1387-4000-8000-000000000102/stay/room.jpg',
    '00000000-1387-4000-8000-000000000101',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb
  ),
  (
    '00000000-1387-4000-8000-000000000122',
    'brand_covers',
    '00000000-1387-4000-8000-000000000102/stay/place.webp',
    '00000000-1387-4000-8000-000000000101',
    '{"mimetype":"image/webp","size":2048}'::jsonb
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1387-4000-8000-000000000101',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1387-4000-8000-000000000101',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $adversarial$
DECLARE
  v_result jsonb;
  v_room_id uuid;
  v_room_version bigint;
  v_place_id uuid;
  v_rule_id uuid;
  v_from date := current_date + 7;
  v_to date := current_date + 8;
BEGIN
  PERFORM public.biz_manage_stay_inventory(
    'save_settings',
    '00000000-1387-4000-8000-000000000104',
    '{
      "propertyKind":"hotel",
      "timezone":"UTC",
      "defaultBookingMode":"request",
      "checkInTime":"15:00",
      "checkOutTime":"11:00",
      "bookingHorizonDays":365,
      "bookingState":"active"
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );

  BEGIN
    PERFORM public.biz_manage_stay_inventory(
      'create_offering',
      '00000000-1387-4000-8000-000000000104',
      '{
        "kind":"room",
        "name":"Forged image room",
        "description":"Must not be created.",
        "inventoryBasis":"pooled_units",
        "quantity":1,
        "maxGuests":2,
        "maxAdults":2,
        "maxChildren":0,
        "media":[{
          "storageObjectId":"00000000-1387-4000-8000-000000000199",
          "isCover":true
        }]
      }'::jsonb,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'A-1 FAIL: missing storage object was trusted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%stay_media_object_invalid%' THEN
      RAISE;
    END IF;
  END;

  v_result := public.biz_manage_stay_inventory(
    'create_offering',
    '00000000-1387-4000-8000-000000000104',
    '{
      "kind":"room",
      "name":"Availability-gated room",
      "description":"Complete except for authoritative nights.",
      "confirmationMode":"instant",
      "inventoryBasis":"pooled_units",
      "quantity":2,
      "maxGuests":4,
      "maxAdults":4,
      "maxChildren":2,
      "media":[{
        "storageObjectId":"00000000-1387-4000-8000-000000000121",
        "isCover":true
      }],
      "policy":{"cancellationPolicy":"Flexible"},
      "price":{"amountMinor":25000,"currencyCode":"USD"}
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );
  v_room_id := (v_result->>'offeringId')::uuid;
  SELECT version INTO v_room_version
  FROM public.stay_offerings
  WHERE id = v_room_id;

  BEGIN
    PERFORM public.biz_manage_stay_inventory(
      'change_status',
      '00000000-1387-4000-8000-000000000104',
      jsonb_build_object('offeringId', v_room_id, 'status', 'live'),
      v_room_version,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'A-2 FAIL: Room published without sellable nights';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%stay_publish_incomplete%' THEN
      RAISE;
    END IF;
  END;

  PERFORM public.biz_manage_stay_inventory(
    'bulk_create',
    '00000000-1387-4000-8000-000000000104',
    '{
      "idempotencyKey":"payload-bound-key",
      "items":[{
        "kind":"room",
        "name":"Bulk Room A",
        "inventoryBasis":"pooled_units",
        "quantity":1,
        "maxGuests":2,
        "maxAdults":2,
        "maxChildren":0
      }]
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );
  BEGIN
    PERFORM public.biz_manage_stay_inventory(
      'bulk_create',
      '00000000-1387-4000-8000-000000000104',
      '{
        "idempotencyKey":"payload-bound-key",
        "items":[{
          "kind":"room",
          "name":"Bulk Room B",
          "inventoryBasis":"pooled_units",
          "quantity":1,
          "maxGuests":2,
          "maxAdults":2,
          "maxChildren":0
        }]
      }'::jsonb,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'A-3 FAIL: idempotency key replayed a changed payload';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM NOT LIKE '%stay_idempotency_conflict%' THEN
      RAISE;
    END IF;
  END;

  v_result := public.biz_manage_stay_inventory(
    'create_offering',
    '00000000-1387-4000-8000-000000000104',
    '{
      "kind":"place",
      "name":"Shared-capacity spa",
      "description":"Bookable by guest capacity.",
      "confirmationMode":"request",
      "inventoryBasis":"shared_capacity",
      "capacity":20,
      "minGuests":1,
      "maxGuests":10,
      "placePricingBasis":"per_guest",
      "bufferBeforeMinutes":15,
      "bufferAfterMinutes":30,
      "media":[{
        "storageObjectId":"00000000-1387-4000-8000-000000000122",
        "isCover":true
      }],
      "policy":{"cancellationPolicy":"Flexible"},
      "price":{"amountMinor":5000,"currencyCode":"USD"}
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );
  v_place_id := (v_result->>'offeringId')::uuid;

  PERFORM public.biz_manage_stay_inventory(
    'upsert_place_schedule',
    '00000000-1387-4000-8000-000000000104',
    jsonb_build_object(
      'offeringId', v_place_id,
      'mode', 'full_day',
      'timezone', 'UTC',
      'localStartDate', v_from,
      'localEndDate', v_to,
      'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'fullDayStartTime', '08:00',
      'fullDayEndTime', '20:00',
      'dstFoldPolicy', 'reject'
    ),
    NULL,
    gen_random_uuid()
  );
  SELECT id INTO v_rule_id
  FROM public.stay_place_schedule_rules
  WHERE offering_id = v_place_id;
  PERFORM public.biz_manage_stay_inventory(
    'materialize_place_windows',
    '00000000-1387-4000-8000-000000000104',
    jsonb_build_object(
      'scheduleRuleId', v_rule_id,
      'fromDate', v_from,
      'toDate', v_to
    ),
    NULL,
    gen_random_uuid()
  );
  IF (
    SELECT count(*)
    FROM public.stay_place_windows
    WHERE schedule_rule_id = v_rule_id
      AND sellable_capacity = 20
      AND sellable_units IS NULL
  ) <> 2 THEN
    RAISE EXCEPTION 'A-4 FAIL: shared-capacity full-day windows are incomplete';
  END IF;

  RAISE NOTICE 'A-1/A-2/A-3/A-4 PASS: adversarial Stay inventory guarantees';
END;
$adversarial$;

ROLLBACK;
