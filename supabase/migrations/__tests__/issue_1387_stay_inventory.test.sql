\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_table text;
  v_function text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_settings',
    'stay_offerings',
    'stay_units',
    'stay_offering_media',
    'stay_policy_versions',
    'stay_price_versions',
    'stay_fee_versions',
    'stay_room_nights',
    'stay_place_schedule_rules',
    'stay_place_windows',
    'stay_bulk_jobs',
    'stay_bulk_job_items',
    'stay_currency_reconciliation_items'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'H-1 FAIL: missing table %', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = to_regclass('public.' || v_table)
        AND c.relrowsecurity
        AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'H-1 FAIL: RLS/FORCE RLS missing on %', v_table;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(
    'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure
  ) INTO v_function;
  IF v_function NOT LIKE '%SECURITY DEFINER%'
     OR v_function NOT LIKE '%SET search_path TO%'
     OR has_function_privilege(
       'anon',
       'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'H-1 FAIL: management RPC security contract incomplete';
  END IF;

  RAISE NOTICE 'H-1 PASS: canonical Stay catalog, forced RLS, and RPC ACL';
END;
$catalog$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1387-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'owner-1387@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1387-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '00000000-1387-4000-8000-000000000002',
  '00000000-1387-4000-8000-000000000001',
  'Issue 1387 Stay Brand',
  'issue-1387-stay-brand',
  'USD',
  'ACCT_issue1387',
  now(),
  now()
);

INSERT INTO storage.objects (
  id, bucket_id, name, owner, metadata
) VALUES
  (
    '00000000-1387-4000-8000-000000000021',
    'brand_covers',
    '00000000-1387-4000-8000-000000000002/stay/lagoon.jpg',
    '00000000-1387-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":1024,"width":1600,"height":900}'::jsonb
  ),
  (
    '00000000-1387-4000-8000-000000000022',
    'brand_covers',
    '00000000-1387-4000-8000-000000000002/stay/lagoon-bath.jpg',
    '00000000-1387-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":2048,"width":1200,"height":900}'::jsonb
  ),
  (
    '00000000-1387-4000-8000-000000000023',
    'brand_covers',
    '00000000-1387-4000-8000-000000000002/stay/cabana.jpg',
    '00000000-1387-4000-8000-000000000001',
    '{"mimetype":"image/webp","size":4096,"width":1600,"height":900}'::jsonb
  );

DO $category$
BEGIN
  BEGIN
    INSERT INTO public.venue_listings (
      id, brand_id, slug, name, lat, lng, venue_category
    ) VALUES (
      gen_random_uuid(),
      '00000000-1387-4000-8000-000000000002',
      'invalidhotel',
      'Invalid hotel identifier',
      6.45,
      3.47,
      'hotel'
    );
    RAISE EXCEPTION 'H-2 FAIL: hotel persisted as a product category';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO public.venue_listings (
    id, brand_id, slug, name, lat, lng, venue_category, claim_status
  ) VALUES (
    '00000000-1387-4000-8000-000000000004',
    '00000000-1387-4000-8000-000000000002',
    'canonicalstay',
    'Canonical Stay',
    6.45,
    3.47,
    'stay',
    'verified'
  );

  RAISE NOTICE 'H-2 PASS: only canonical stay category is accepted';
END;
$category$;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1387-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1387-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $authoring$
DECLARE
  v_result jsonb;
  v_room_id uuid;
  v_bulk jsonb;
  v_place_id uuid;
  v_rule_id uuid;
  v_media_ids jsonb;
BEGIN
  v_result := public.biz_manage_stay_inventory(
    'save_settings',
    '00000000-1387-4000-8000-000000000004',
    '{
      "propertyKind":"resort",
      "timezone":"Africa/Lagos",
      "defaultBookingMode":"instant",
      "checkInTime":"15:00",
      "checkOutTime":"11:00",
      "bookingState":"active"
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );

  v_result := public.biz_manage_stay_inventory(
    'create_offering',
    '00000000-1387-4000-8000-000000000004',
    '{
      "kind":"room",
      "name":"Lagoon Suite",
      "description":"Waterfront suite",
      "confirmationMode":"instant",
      "inventoryBasis":"exclusive_units",
      "unitNamingMode":"named",
      "quantity":2,
      "maxGuests":4,
      "maxAdults":4,
      "maxChildren":2,
      "amenities":["wifi","breakfast"],
      "units":[{"name":"Suite 101"},{"name":"Suite 102"}],
      "media":[
        {
          "storageObjectId":"00000000-1387-4000-8000-000000000021",
          "isCover":true
        }
      ],
      "policy":{
        "cancellationPolicy":"Free cancellation until 48 hours before check-in.",
        "terms":{"cutoffHours":48}
      },
      "price":{
        "amountMinor":10000,
        "currencyCode":"USD"
      },
      "fees":[
        {
          "feeKey":"resort_fee",
          "label":"Resort fee",
          "feeKind":"mandatory_fee",
          "calculation":"fixed_per_room_night",
          "amountMinor":2000,
          "currencyCode":"USD",
          "displayMode":"separate",
          "refundTreatment":"same_as_line"
        },
        {
          "feeKey":"service_fee",
          "label":"Service fee",
          "feeKind":"mandatory_fee",
          "calculation":"percentage_of_line_base",
          "basisPoints":500,
          "displayMode":"included",
          "refundTreatment":"same_as_line"
        }
      ]
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );
  v_room_id := (v_result->>'offeringId')::uuid;

  IF (SELECT count(*) FROM public.stay_units WHERE offering_id = v_room_id) <> 2
     OR (SELECT count(*) FROM public.stay_offering_media
         WHERE offering_id = v_room_id AND is_cover) <> 1
     OR (SELECT count(*) FROM public.stay_fee_versions
         WHERE offering_id = v_room_id AND effective_to IS NULL) <> 2 THEN
    RAISE EXCEPTION 'H-3 FAIL: Room aggregate was not created atomically';
  END IF;

  PERFORM public.biz_manage_stay_inventory(
    'attach_media',
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object(
      'offeringId', v_room_id,
      'storageObjectId', '00000000-1387-4000-8000-000000000022',
      'isCover', false
    ),
    1,
    gen_random_uuid()
  );
  SELECT jsonb_agg(id ORDER BY sort_order DESC)
  INTO v_media_ids
  FROM public.stay_offering_media
  WHERE offering_id = v_room_id;
  PERFORM public.biz_manage_stay_inventory(
    'reorder_media',
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object('offeringId', v_room_id, 'mediaIds', v_media_ids),
    2,
    gen_random_uuid()
  );
  IF (
    SELECT storage_object_id
    FROM public.stay_offering_media
    WHERE offering_id = v_room_id AND sort_order = 0
  ) <> '00000000-1387-4000-8000-000000000022'::uuid THEN
    RAISE EXCEPTION 'H-3 FAIL: media reorder did not swap positions';
  END IF;

  PERFORM public.biz_manage_stay_inventory(
    'upsert_room_nights',
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object(
      'offeringId', v_room_id,
      'nights', jsonb_build_array(jsonb_build_object(
        'localDate', '2027-02-14',
        'sellableQuantity', 2,
        'minimumNights', 2
      ))
    ),
    NULL,
    gen_random_uuid()
  );

  v_bulk := public.biz_manage_stay_inventory(
    'bulk_create',
    '00000000-1387-4000-8000-000000000004',
    '{
      "idempotencyKey":"issue-1387-bulk-1",
      "items":[
        {
          "kind":"place",
          "name":"Pool Cabana",
          "description":"Private poolside cabana",
          "confirmationMode":"request",
          "inventoryBasis":"exclusive_units",
          "unitNamingMode":"interchangeable",
          "quantity":4,
          "maxGuests":8,
          "placePricingBasis":"per_unit",
          "bufferBeforeMinutes":15,
          "bufferAfterMinutes":15,
          "accessScope":"overnight_guests_only",
          "media":[
            {
              "storageObjectId":"00000000-1387-4000-8000-000000000023",
              "isCover":true
            }
          ],
          "policy":{"cancellationPolicy":"Cancel up to 24 hours before."},
          "price":{"amountMinor":5000,"currencyCode":"USD"}
        },
        {
          "kind":"restaurant",
          "name":"Invalid legacy type"
        }
      ]
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );

  IF (v_bulk->'job'->>'succeeded_count')::integer <> 1
     OR (v_bulk->'job'->>'failed_count')::integer <> 1 THEN
    RAISE EXCEPTION 'H-4 FAIL: bulk job did not preserve per-item outcomes: %',
      v_bulk;
  END IF;

  SELECT id INTO v_place_id
  FROM public.stay_offerings
  WHERE venue_id = '00000000-1387-4000-8000-000000000004'
    AND kind = 'place'
    AND name = 'Pool Cabana';

  PERFORM public.biz_manage_stay_inventory(
    'upsert_place_schedule',
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object(
      'offeringId', v_place_id,
      'mode', 'repeating_windows',
      'timezone', 'Africa/Lagos',
      'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'localStartDate', '2027-02-01',
      'localEndDate', '2027-02-07',
      'localStartTime', '10:00',
      'localEndTime', '18:00',
      'slotDurationMinutes', 60,
      'slotIntervalMinutes', 60,
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
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object(
      'scheduleRuleId', v_rule_id,
      'fromDate', '2027-02-01',
      'toDate', '2027-02-07'
    ),
    NULL,
    gen_random_uuid()
  );
  IF (SELECT count(*) FROM public.stay_place_windows
      WHERE schedule_rule_id = v_rule_id) <> 56 THEN
    RAISE EXCEPTION 'H-5 FAIL: Place windows were not materialized';
  END IF;

  RAISE NOTICE 'H-3/H-4/H-5 PASS: aggregate, media, bulk, nights, and Place schedule';
END;
$authoring$;

RESET ROLE;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  (
    '00000000-1387-4000-8000-000000000011',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'event-1387@example.test', now(), now()
  ),
  (
    '00000000-1387-4000-8000-000000000012',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'finance-1387@example.test', now(), now()
  );
INSERT INTO public.brand_team_members (
  id, brand_id, user_id, role, invited_at, accepted_at
) VALUES
  (
    gen_random_uuid(),
    '00000000-1387-4000-8000-000000000002',
    '00000000-1387-4000-8000-000000000011',
    'event_manager', now(), now()
  ),
  (
    gen_random_uuid(),
    '00000000-1387-4000-8000-000000000002',
    '00000000-1387-4000-8000-000000000012',
    'finance_manager', now(), now()
  );

DO $permissions$
DECLARE
  v_room_id uuid;
  v_room_version bigint;
BEGIN
  SELECT id, version INTO v_room_id, v_room_version
  FROM public.stay_offerings
  WHERE venue_id = '00000000-1387-4000-8000-000000000004'
    AND kind = 'room';

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1387-4000-8000-000000000011',
    true
  );
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.biz_manage_stay_inventory(
      'set_price',
      '00000000-1387-4000-8000-000000000004',
      jsonb_build_object(
        'offeringId', v_room_id,
        'amountMinor', 11000,
        'currencyCode', 'USD'
      ),
      v_room_version,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-6 FAIL: event manager changed Stay money';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1387-4000-8000-000000000012',
    true
  );
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.biz_manage_stay_inventory(
      'update_offering',
      '00000000-1387-4000-8000-000000000004',
      jsonb_build_object('offeringId', v_room_id, 'name', 'Forbidden rename'),
      v_room_version,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-6 FAIL: finance manager changed Room metadata';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  PERFORM public.biz_manage_stay_inventory(
    'set_price',
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object(
      'offeringId', v_room_id,
      'amountMinor', 11000,
      'currencyCode', 'USD'
    ),
    v_room_version,
    gen_random_uuid()
  );
  RESET ROLE;

  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1387-4000-8000-000000000001',
    true
  );
  RAISE NOTICE 'H-6 PASS: inventory and finance permissions stay separate';
END;
$permissions$;

DO $dst$
BEGIN
  BEGIN
    PERFORM * FROM public.issue_1387_resolve_local_timestamp(
      '2027-03-14', '02:30', 'America/New_York', 'reject'
    );
    RAISE EXCEPTION 'H-5 FAIL: DST gap was silently materialized';
  EXCEPTION WHEN datetime_field_overflow THEN
    NULL;
  END;
  RAISE NOTICE 'H-5 PASS: nonexistent local time fails closed';
END;
$dst$;

DO $currency$
DECLARE
  v_reconciliation_id uuid;
  v_snapshot_id uuid := gen_random_uuid();
  v_preview jsonb;
  v_items jsonb;
  v_room_id uuid;
  v_room_version bigint;
BEGIN
  UPDATE public.brands
  SET default_currency = 'NGN'
  WHERE id = '00000000-1387-4000-8000-000000000002';

  SELECT id INTO v_reconciliation_id
  FROM public.brand_currency_reconciliations
  WHERE brand_id = '00000000-1387-4000-8000-000000000002'
    AND status = 'pending';
  IF v_reconciliation_id IS NULL
     OR (SELECT count(*) FROM public.stay_currency_reconciliation_items
         WHERE reconciliation_id = v_reconciliation_id
           AND status = 'pending') <> 3 THEN
    RAISE EXCEPTION 'H-7 FAIL: Stay price/fixed-fee set was not registered';
  END IF;

  INSERT INTO public.fx_rate_snapshots (
    id, provider, base_currency_code, provider_updated_at,
    provider_next_update_at, provider_eol_at, stale_after, expires_at,
    payload_sha256, status
  ) VALUES (
    v_snapshot_id, 'exchange_rate_api_open_v6', 'USD',
    now() - interval '1 hour', now() + interval '23 hours',
    now() + interval '2 days', now() + interval '1 day',
    now() + interval '7 days', 'issue-1387-currency-fixture', 'active'
  );
  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  SELECT
    v_snapshot_id,
    c.code,
    CASE WHEN c.code = 'NGN' THEN 1500::numeric ELSE 1::numeric END
  FROM public.supported_brand_currencies c
  WHERE c.active;

  PERFORM set_config('role', 'authenticated', true);
  v_preview := public.issue_1384_preview_reconciliation(
    '00000000-1387-4000-8000-000000000002',
    v_reconciliation_id
  );
  IF jsonb_array_length(v_preview->'stayItems') <> 3 THEN
    RAISE EXCEPTION 'H-7 FAIL: preview omitted Stay money';
  END IF;

  BEGIN
    PERFORM public.issue_1384_resolve_reconciliation(
      '00000000-1387-4000-8000-000000000002',
      v_reconciliation_id,
      'convert',
      v_snapshot_id,
      '[]'::jsonb,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-7 FAIL: legacy resolver silently omitted Stay money';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%stay_currency_reconciliation_required%' THEN
      RAISE;
    END IF;
  END;

  SELECT jsonb_agg(jsonb_build_object('itemId', i.id) ORDER BY i.id)
  INTO v_items
  FROM public.stay_currency_reconciliation_items i
  WHERE i.reconciliation_id = v_reconciliation_id
    AND i.status = 'pending';

  PERFORM public.biz_manage_stay_inventory(
    'resolve_currency_reconciliation',
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object(
      'reconciliationId', v_reconciliation_id,
      'decision', 'convert',
      'fxSnapshotId', v_snapshot_id,
      'ranges', '[]'::jsonb,
      'stayItems', v_items
    ),
    NULL,
    gen_random_uuid()
  );
  RESET ROLE;

  IF EXISTS (
    SELECT 1 FROM public.stay_price_versions p
    WHERE p.brand_id = '00000000-1387-4000-8000-000000000002'
      AND p.effective_to IS NULL
      AND p.currency_code <> 'NGN'
  ) OR EXISTS (
    SELECT 1 FROM public.stay_fee_versions f
    WHERE f.brand_id = '00000000-1387-4000-8000-000000000002'
      AND f.effective_to IS NULL
      AND f.calculation LIKE 'fixed_%'
      AND f.currency_code <> 'NGN'
  ) THEN
    RAISE EXCEPTION 'H-7 FAIL: current Stay money did not convert to NGN';
  END IF;

  BEGIN
    UPDATE public.stay_price_versions
    SET amount_minor = amount_minor + 1
    WHERE brand_id = '00000000-1387-4000-8000-000000000002'
      AND effective_to IS NULL;
    RAISE EXCEPTION 'H-8 FAIL: immutable price value was mutated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;

  SELECT id, version INTO v_room_id, v_room_version
  FROM public.stay_offerings
  WHERE venue_id = '00000000-1387-4000-8000-000000000004'
    AND kind = 'room';
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.biz_manage_stay_inventory(
    'change_status',
    '00000000-1387-4000-8000-000000000004',
    jsonb_build_object('offeringId', v_room_id, 'status', 'live'),
    v_room_version,
    gen_random_uuid()
  );
  RESET ROLE;
  IF (SELECT status FROM public.stay_offerings WHERE id = v_room_id) <> 'live' THEN
    RAISE EXCEPTION 'H-9 FAIL: complete rail-ready Room did not publish';
  END IF;

  RAISE NOTICE 'H-7/H-8/H-9 PASS: atomic currency conversion, immutability, publish gate';
END;
$currency$;

DO $anon$
BEGIN
  PERFORM set_config('role', 'anon', true);
  BEGIN
    PERFORM 1 FROM public.stay_offerings LIMIT 1;
    RAISE EXCEPTION 'H-10 FAIL: anon read Stay inventory directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'H-10 PASS: no anonymous direct table access';
END;
$anon$;

ROLLBACK;
