\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_table text;
  v_function text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_quotes',
    'stay_quote_lines',
    'stay_quote_fee_lines',
    'stay_quote_allocations',
    'stay_reservation_groups',
    'stay_reservation_lines',
    'stay_inventory_holds',
    'stay_inventory_hold_slices',
    'stay_inventory_commitments',
    'stay_reservation_events'
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
      RAISE EXCEPTION 'H-1 FAIL: forced RLS missing on %', v_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege(
         'authenticated', 'public.' || v_table, 'SELECT'
       ) THEN
      RAISE EXCEPTION 'H-1 FAIL: direct client table read on %', v_table;
    END IF;
  END LOOP;
  SELECT pg_get_functiondef(
    'public.biz_manage_stay_reservation(text,jsonb,bigint,uuid)'::regprocedure
  ) INTO v_function;
  IF v_function NOT LIKE '%SECURITY DEFINER%'
     OR v_function NOT LIKE '%SET search_path TO%'
     OR has_function_privilege(
       'anon',
       'public.biz_manage_stay_reservation(text,jsonb,bigint,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.biz_manage_stay_reservation(text,jsonb,bigint,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'H-1 FAIL: reservation RPC ACL/search_path';
  END IF;
  RAISE NOTICE 'H-1 PASS: cart catalog is forced-RLS and RPC-only';
END;
$catalog$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1388-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'guest-1388@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1388-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '00000000-1388-4000-8000-000000000002',
  '00000000-1388-4000-8000-000000000001',
  'Issue 1388 Stay Brand',
  'issue-1388-stay-brand',
  'USD',
  'ACCT_issue1388',
  now(),
  now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1388-4000-8000-000000000004',
  '00000000-1388-4000-8000-000000000002',
  'atomicstay',
  'Atomic Stay',
  6.45,
  3.47,
  'stay',
  'verified'
);

INSERT INTO public.stay_settings (
  venue_id, brand_id, timezone, default_booking_mode,
  booking_state, created_by, updated_by
) VALUES (
  '00000000-1388-4000-8000-000000000004',
  '00000000-1388-4000-8000-000000000002',
  'UTC',
  'instant',
  'active',
  '00000000-1388-4000-8000-000000000001',
  '00000000-1388-4000-8000-000000000001'
);

INSERT INTO public.stay_offerings (
  id, venue_id, brand_id, kind, name, description, status,
  confirmation_mode, inventory_basis, unit_naming_mode,
  quantity, capacity, min_guests, max_guests, max_adults, max_children,
  place_pricing_basis, access_scope, created_by, updated_by
) VALUES
  (
    '00000000-1388-4000-8000-000000000010',
    '00000000-1388-4000-8000-000000000004',
    '00000000-1388-4000-8000-000000000002',
    'room', 'Garden Room', 'Garden room', 'live', 'instant',
    'pooled_units', 'interchangeable',
    3, NULL, 1, 4, 2, 2, NULL, 'public',
    '00000000-1388-4000-8000-000000000001',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000011',
    '00000000-1388-4000-8000-000000000004',
    '00000000-1388-4000-8000-000000000002',
    'room', 'Named Suite', 'Named suite', 'live', 'instant',
    'exclusive_units', 'named',
    2, NULL, 1, 4, 4, 2, NULL, 'public',
    '00000000-1388-4000-8000-000000000001',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000012',
    '00000000-1388-4000-8000-000000000004',
    '00000000-1388-4000-8000-000000000002',
    'place', 'Guest Spa', 'Shared guest spa', 'live', 'request',
    'shared_capacity', 'interchangeable',
    NULL, 10, 1, 10, NULL, NULL, 'per_guest',
    'overnight_guests_only',
    '00000000-1388-4000-8000-000000000001',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000013',
    '00000000-1388-4000-8000-000000000004',
    '00000000-1388-4000-8000-000000000002',
    'place', 'Private Cabana', 'Private cabana', 'live', 'instant',
    'exclusive_units', 'named',
    1, NULL, 1, 5, NULL, NULL, 'per_booking', 'public',
    '00000000-1388-4000-8000-000000000001',
    '00000000-1388-4000-8000-000000000001'
  );

INSERT INTO public.stay_units (
  id, offering_id, brand_id, venue_id, name, created_by, updated_by
) VALUES
  (
    '00000000-1388-4000-8000-000000000020',
    '00000000-1388-4000-8000-000000000011',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    'Suite A',
    '00000000-1388-4000-8000-000000000001',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000021',
    '00000000-1388-4000-8000-000000000011',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    'Suite B',
    '00000000-1388-4000-8000-000000000001',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000022',
    '00000000-1388-4000-8000-000000000013',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    'Cabana One',
    '00000000-1388-4000-8000-000000000001',
    '00000000-1388-4000-8000-000000000001'
  );

INSERT INTO public.stay_policy_versions (
  id, offering_id, brand_id, venue_id, version_number,
  cancellation_policy, created_by
)
SELECT
  ('00000000-1388-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('00000000-1388-4000-8000-' || lpad((n - 50)::text, 12, '0'))::uuid,
  '00000000-1388-4000-8000-000000000002',
  '00000000-1388-4000-8000-000000000004',
  1,
  'Free cancellation until the displayed cutoff.',
  '00000000-1388-4000-8000-000000000001'
FROM generate_series(60, 63) n;

INSERT INTO public.stay_price_versions (
  id, offering_id, brand_id, venue_id, version_number,
  amount_minor, currency_code, pricing_unit, created_by
) VALUES
  (
    '00000000-1388-4000-8000-000000000050',
    '00000000-1388-4000-8000-000000000010',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    1, 10000, 'USD', 'room_night',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000051',
    '00000000-1388-4000-8000-000000000011',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    1, 15000, 'USD', 'room_night',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000052',
    '00000000-1388-4000-8000-000000000012',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    1, 5000, 'USD', 'place_guest',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000053',
    '00000000-1388-4000-8000-000000000013',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    1, 8000, 'USD', 'place_booking',
    '00000000-1388-4000-8000-000000000001'
  );

INSERT INTO public.stay_fee_versions (
  id, offering_id, brand_id, venue_id, fee_key, label,
  version_number, fee_kind, calculation, amount_minor,
  currency_code, display_mode, refund_treatment, created_by
) VALUES
  (
    '00000000-1388-4000-8000-000000000070',
    '00000000-1388-4000-8000-000000000010',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    'night_fee', 'Night fee', 1, 'mandatory_fee',
    'fixed_per_room_night', 1000, 'USD', 'separate',
    'same_as_line',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000071',
    '00000000-1388-4000-8000-000000000011',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    'stay_fee', 'Stay fee', 1, 'mandatory_fee',
    'fixed_per_group', 500, 'USD', 'separate',
    'refundable',
    '00000000-1388-4000-8000-000000000001'
  );

INSERT INTO public.stay_room_nights (
  offering_id, local_date, brand_id, venue_id, sellable_quantity
)
SELECT
  offering_id,
  ((now() AT TIME ZONE 'UTC')::date + day_offset),
  '00000000-1388-4000-8000-000000000002',
  '00000000-1388-4000-8000-000000000004',
  quantity
FROM (
  VALUES
    ('00000000-1388-4000-8000-000000000010'::uuid, 30, 3),
    ('00000000-1388-4000-8000-000000000010'::uuid, 31, 3),
    ('00000000-1388-4000-8000-000000000011'::uuid, 30, 2),
    ('00000000-1388-4000-8000-000000000011'::uuid, 31, 2)
) inventory(offering_id, day_offset, quantity);

INSERT INTO public.stay_place_schedule_rules (
  id, offering_id, brand_id, venue_id, mode, timezone,
  local_start_date, weekdays, local_start_time, local_end_time, created_by
) VALUES
  (
    '00000000-1388-4000-8000-000000000030',
    '00000000-1388-4000-8000-000000000012',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    'fixed_slots', 'UTC',
    (now() AT TIME ZONE 'UTC')::date + 30,
    '{}', '10:00', '11:00',
    '00000000-1388-4000-8000-000000000001'
  ),
  (
    '00000000-1388-4000-8000-000000000031',
    '00000000-1388-4000-8000-000000000013',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    'fixed_slots', 'UTC',
    (now() AT TIME ZONE 'UTC')::date + 30,
    '{}', '12:00', '13:00',
    '00000000-1388-4000-8000-000000000001'
  );

INSERT INTO public.stay_place_windows (
  id, offering_id, schedule_rule_id, brand_id, venue_id, local_date,
  starts_at, ends_at, sellable_units, sellable_capacity, dst_resolution
) VALUES
  (
    '00000000-1388-4000-8000-000000000040',
    '00000000-1388-4000-8000-000000000012',
    '00000000-1388-4000-8000-000000000030',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    (now() AT TIME ZONE 'UTC')::date + 30,
    (((now() AT TIME ZONE 'UTC')::date + 30)::timestamp + '10:00'::time)
      AT TIME ZONE 'UTC',
    (((now() AT TIME ZONE 'UTC')::date + 30)::timestamp + '11:00'::time)
      AT TIME ZONE 'UTC',
    NULL, 10, 'unambiguous'
  ),
  (
    '00000000-1388-4000-8000-000000000041',
    '00000000-1388-4000-8000-000000000013',
    '00000000-1388-4000-8000-000000000031',
    '00000000-1388-4000-8000-000000000002',
    '00000000-1388-4000-8000-000000000004',
    (now() AT TIME ZONE 'UTC')::date + 30,
    (((now() AT TIME ZONE 'UTC')::date + 30)::timestamp + '12:00'::time)
      AT TIME ZONE 'UTC',
    (((now() AT TIME ZONE 'UTC')::date + 30)::timestamp + '13:00'::time)
      AT TIME ZONE 'UTC',
    1, NULL, 'unambiguous'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1388-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1388-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $multi_room$
DECLARE
  v_check_in date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_check_out date := (now() AT TIME ZONE 'UTC')::date + 32;
  v_quote jsonb;
  v_replay jsonb;
  v_group jsonb;
  v_quote_id uuid;
  v_group_id uuid;
BEGIN
  v_quote := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '00000000-1388-4000-8000-000000000004',
      'idempotencyKey', 'multi-room-quote-1388',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'kind', 'room',
          'offeringId', '00000000-1388-4000-8000-000000000010',
          'checkIn', v_check_in,
          'checkOut', v_check_out,
          'quantity', 2,
          'allocations', jsonb_build_array(
            jsonb_build_object('adults', 2, 'children', 0),
            jsonb_build_object('adults', 1, 'children', 1)
          )
        ),
        jsonb_build_object(
          'kind', 'room',
          'offeringId', '00000000-1388-4000-8000-000000000011',
          'checkIn', v_check_in,
          'checkOut', v_check_out,
          'quantity', 1,
          'allocations', jsonb_build_array(jsonb_build_object(
            'adults', 2,
            'children', 1,
            'namedUnitPreference',
              '00000000-1388-4000-8000-000000000020'
          ))
        )
      )
    ),
    NULL,
    gen_random_uuid()
  );
  IF v_quote->>'mode' <> 'instant'
     OR v_quote->>'currencyCode' <> 'USD'
     OR (v_quote->>'sourceSubtotalMinor')::bigint <> 70000
     OR (v_quote->>'feeTotalMinor')::bigint <> 4500
     OR (v_quote->>'totalMinor')::bigint <> 74500
     OR jsonb_array_length(v_quote->'lines') <> 2 THEN
    RAISE EXCEPTION 'H-2 FAIL: multi-room quote truth %', v_quote;
  END IF;
  IF (
    SELECT sum((fee->>'amountMinor')::bigint)
    FROM jsonb_array_elements(v_quote->'lines') line
    CROSS JOIN LATERAL jsonb_array_elements(line->'fees') fee
    WHERE fee->>'name' = 'Stay fee'
  ) <> 500 THEN
    RAISE EXCEPTION 'H-2 FAIL: largest-remainder group fee lost money';
  END IF;
  v_replay := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '00000000-1388-4000-8000-000000000004',
      'idempotencyKey', 'multi-room-quote-1388',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'kind', 'room',
          'offeringId', '00000000-1388-4000-8000-000000000010',
          'checkIn', v_check_in,
          'checkOut', v_check_out,
          'quantity', 2,
          'allocations', jsonb_build_array(
            jsonb_build_object('adults', 2, 'children', 0),
            jsonb_build_object('adults', 1, 'children', 1)
          )
        ),
        jsonb_build_object(
          'kind', 'room',
          'offeringId', '00000000-1388-4000-8000-000000000011',
          'checkIn', v_check_in,
          'checkOut', v_check_out,
          'quantity', 1,
          'allocations', jsonb_build_array(jsonb_build_object(
            'adults', 2,
            'children', 1,
            'namedUnitPreference',
              '00000000-1388-4000-8000-000000000020'
          ))
        )
      )
    ),
    NULL,
    gen_random_uuid()
  );
  IF v_replay->>'quoteId' <> v_quote->>'quoteId' THEN
    RAISE EXCEPTION 'H-2 FAIL: quote replay duplicated';
  END IF;

  v_quote_id := (v_quote->>'quoteId')::uuid;
  v_group := public.biz_manage_stay_reservation(
    'create_group',
    jsonb_build_object(
      'quoteId', v_quote_id,
      'idempotencyKey', 'multi-room-group-1388',
      'guest', jsonb_build_object(
        'name', 'Ada Guest',
        'email', 'ada@example.test'
      )
    ),
    1,
    gen_random_uuid()
  );
  v_group_id := (v_group->>'groupId')::uuid;
  PERFORM set_config('role', 'postgres', true);
  IF v_group->>'state' <> 'instant_payment_pending'
     OR jsonb_array_length(v_group->'lines') <> 2
     OR (
       SELECT count(*) FROM public.stay_inventory_hold_slices s
       JOIN public.stay_reservation_lines l ON l.id = s.reservation_line_id
       WHERE l.group_id = v_group_id
     ) <> 4
     OR (
       SELECT count(*) FROM public.stay_inventory_hold_slices s
       JOIN public.stay_reservation_lines l ON l.id = s.reservation_line_id
       WHERE l.group_id = v_group_id
         AND s.exclusive_unit_id =
           '00000000-1388-4000-8000-000000000020'
     ) <> 2 THEN
    RAISE EXCEPTION 'H-3 FAIL: multi-room hold was not atomic %', v_group;
  END IF;
  PERFORM set_config('role', 'authenticated', true);
  RAISE NOTICE 'H-2/H-3 PASS: multi-room quote, fee truth, replay, atomic hold';
END;
$multi_room$;

DO $idempotency_conflict$
DECLARE
  v_date date := (now() AT TIME ZONE 'UTC')::date + 30;
BEGIN
  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'quote',
      jsonb_build_object(
        'venueId', '00000000-1388-4000-8000-000000000004',
        'idempotencyKey', 'multi-room-quote-1388',
        'lines', jsonb_build_array(jsonb_build_object(
          'kind', 'room',
          'offeringId', '00000000-1388-4000-8000-000000000010',
          'checkIn', v_date,
          'checkOut', v_date + 1,
          'quantity', 1,
          'allocations', jsonb_build_array(
            jsonb_build_object('adults', 1, 'children', 0)
          )
        ))
      ),
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-4 FAIL: changed payload reused quote key';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%stay_idempotency_conflict%' THEN
      RAISE;
    END IF;
  END;
  RAISE NOTICE 'H-4 PASS: idempotency key is payload-bound';
END;
$idempotency_conflict$;

DO $mixed_request$
DECLARE
  v_date date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_quote jsonb;
  v_group jsonb;
  v_approved jsonb;
  v_group_id uuid;
BEGIN
  v_quote := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '00000000-1388-4000-8000-000000000004',
      'idempotencyKey', 'mixed-request-quote-1388',
      'mode', 'instant',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'kind', 'room',
          'offeringId', '00000000-1388-4000-8000-000000000010',
          'checkIn', v_date,
          'checkOut', v_date + 2,
          'quantity', 1,
          'allocations', jsonb_build_array(
            jsonb_build_object('adults', 2, 'children', 0)
          )
        ),
        jsonb_build_object(
          'kind', 'place',
          'offeringId', '00000000-1388-4000-8000-000000000012',
          'placeWindowId', '00000000-1388-4000-8000-000000000040',
          'guests', 4,
          'adults', 3,
          'children', 1
        )
      )
    ),
    NULL,
    gen_random_uuid()
  );
  IF v_quote->>'mode' <> 'request'
     OR (v_quote->>'sourceSubtotalMinor')::bigint <> 40000 THEN
    RAISE EXCEPTION 'H-5 FAIL: mixed mode/price not server-derived %', v_quote;
  END IF;
  v_group := public.biz_manage_stay_reservation(
    'create_group',
    jsonb_build_object(
      'quoteId', v_quote->>'quoteId',
      'idempotencyKey', 'mixed-request-group-1388',
      'guest', jsonb_build_object(
        'name', 'Mixed Guest',
        'phone', '+15555550101'
      )
    ),
    1,
    gen_random_uuid()
  );
  v_group_id := (v_group->>'groupId')::uuid;
  PERFORM set_config('role', 'postgres', true);
  IF v_group->>'state' <> 'request_pending'
     OR v_group->>'paymentDeadline' IS NOT NULL
     OR (
       SELECT count(*) FROM public.stay_inventory_commitments
       WHERE group_id = v_group_id
     ) <> 0
     OR (
       SELECT count(DISTINCT state)
       FROM public.stay_reservation_lines
       WHERE group_id = v_group_id
     ) <> 1 THEN
    RAISE EXCEPTION 'H-5 FAIL: Request submission was partial/charged %', v_group;
  END IF;
  PERFORM set_config('role', 'authenticated', true);
  v_approved := public.biz_manage_stay_reservation(
    'approve_request',
    jsonb_build_object(
      'groupId', v_group_id,
      'idempotencyKey', 'approve-mixed-request-1388'
    ),
    1,
    gen_random_uuid()
  );
  PERFORM set_config('role', 'postgres', true);
  IF v_approved->>'state' <> 'approved_payment_required'
     OR v_approved->>'paymentDeadline' IS NULL
     OR EXISTS (
       SELECT 1 FROM public.stay_reservation_lines
       WHERE group_id = v_group_id
         AND state <> 'approved_payment_required'
     )
     OR (
       SELECT h.expires_at
       FROM public.stay_inventory_holds h
       WHERE h.group_id = v_group_id
     ) IS DISTINCT FROM
       (v_approved->>'paymentDeadline')::timestamptz THEN
    RAISE EXCEPTION 'H-6 FAIL: whole-group approval/hold extension %', v_approved;
  END IF;
  PERFORM set_config('role', 'authenticated', true);
  RAISE NOTICE 'H-5/H-6 PASS: mixed Request has no precharge and approves whole';
END;
$mixed_request$;

DO $expired_request_replay$
DECLARE
  v_date date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_quote jsonb;
  v_group jsonb;
  v_expired jsonb;
  v_replay jsonb;
  v_group_id uuid;
BEGIN
  v_quote := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '00000000-1388-4000-8000-000000000004',
      'idempotencyKey', 'expiring-request-quote-1388',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'kind', 'room',
          'offeringId', '00000000-1388-4000-8000-000000000011',
          'checkIn', v_date,
          'checkOut', v_date + 2,
          'quantity', 1,
          'allocations', jsonb_build_array(jsonb_build_object(
            'adults', 2,
            'children', 0,
            'namedUnitPreference',
              '00000000-1388-4000-8000-000000000021'
          ))
        ),
        jsonb_build_object(
          'kind', 'place',
          'offeringId', '00000000-1388-4000-8000-000000000012',
          'placeWindowId', '00000000-1388-4000-8000-000000000040',
          'guests', 2
        )
      )
    ),
    NULL,
    gen_random_uuid()
  );
  v_group := public.biz_manage_stay_reservation(
    'create_group',
    jsonb_build_object(
      'quoteId', v_quote->>'quoteId',
      'idempotencyKey', 'expiring-request-group-1388',
      'guest', jsonb_build_object(
        'name', 'Expiry Guest',
        'email', 'expiry@example.test'
      )
    ),
    1,
    gen_random_uuid()
  );
  v_group_id := (v_group->>'groupId')::uuid;
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.stay_reservation_groups
  SET request_deadline = now() - interval '1 minute',
      updated_at = now()
  WHERE id = v_group_id;
  UPDATE public.stay_inventory_holds
  SET expires_at = now() - interval '1 minute',
      version = version + 1,
      updated_at = now()
  WHERE group_id = v_group_id;
  PERFORM set_config('role', 'authenticated', true);

  v_expired := public.biz_manage_stay_reservation(
    'approve_request',
    jsonb_build_object(
      'groupId', v_group_id,
      'idempotencyKey', 'expire-on-approve-1388'
    ),
    1,
    gen_random_uuid()
  );
  v_replay := public.biz_manage_stay_reservation(
    'approve_request',
    jsonb_build_object(
      'groupId', v_group_id,
      'idempotencyKey', 'expire-on-approve-1388'
    ),
    1,
    gen_random_uuid()
  );
  IF v_expired->>'state' <> 'request_expired'
     OR v_replay->>'groupId' <> v_expired->>'groupId'
     OR v_replay->>'state' <> 'request_expired' THEN
    RAISE EXCEPTION 'H-6B FAIL: expired Request replay diverged %, %',
      v_expired, v_replay;
  END IF;
  RAISE NOTICE 'H-6B PASS: deadline result is whole-group and idempotent';
END;
$expired_request_replay$;

DO $invalid_place_shape$
DECLARE
  v_date date := (now() AT TIME ZONE 'UTC')::date + 30;
BEGIN
  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'quote',
      jsonb_build_object(
        'venueId', '00000000-1388-4000-8000-000000000004',
        'idempotencyKey', 'missing-place-units-1388',
        'lines', jsonb_build_array(jsonb_build_object(
          'kind', 'place',
          'offeringId', '00000000-1388-4000-8000-000000000013',
          'placeWindowId', '00000000-1388-4000-8000-000000000041',
          'guests', 2
        ))
      ),
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-6C FAIL: exclusive Place accepted no unit count';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%stay_invalid_place_allocation%' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'quote',
      jsonb_build_object(
        'venueId', '00000000-1388-4000-8000-000000000004',
        'idempotencyKey', 'negative-place-party-1388',
        'lines', jsonb_build_array(jsonb_build_object(
          'kind', 'place',
          'offeringId', '00000000-1388-4000-8000-000000000013',
          'placeWindowId', '00000000-1388-4000-8000-000000000041',
          'units', 1,
          'guests', 2,
          'adults', -1,
          'children', 2
        ))
      ),
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-6C FAIL: Place accepted a negative party count';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%stay_invalid_place_allocation%' THEN
      RAISE;
    END IF;
  END;
  RAISE NOTICE 'H-6C PASS: malformed Place allocation fails at the boundary';
END;
$invalid_place_shape$;

DO $restricted_place$
BEGIN
  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'quote',
      jsonb_build_object(
        'venueId', '00000000-1388-4000-8000-000000000004',
        'idempotencyKey', 'restricted-place-alone-1388',
        'lines', jsonb_build_array(jsonb_build_object(
          'kind', 'place',
          'offeringId', '00000000-1388-4000-8000-000000000012',
          'placeWindowId', '00000000-1388-4000-8000-000000000040',
          'guests', 2
        ))
      ),
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-7 FAIL: restricted Place quoted without Room';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%stay_dependent_place_requires_room%' THEN
      RAISE;
    END IF;
  END;
  PERFORM set_config('role', 'postgres', true);
  IF EXISTS (
    SELECT 1 FROM public.stay_quotes
    WHERE idempotency_key = 'restricted-place-alone-1388'
  ) THEN
    RAISE EXCEPTION 'H-7 FAIL: failed quote left an orphan';
  END IF;
  PERFORM set_config('role', 'authenticated', true);
  RAISE NOTICE 'H-7 PASS: Overnight-guests-only dependency is atomic';
END;
$restricted_place$;

DO $oversell$
DECLARE
  v_quote_a jsonb;
  v_quote_b jsonb;
  v_group_a jsonb;
  v_groups_before integer;
BEGIN
  v_quote_a := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '00000000-1388-4000-8000-000000000004',
      'idempotencyKey', 'scarce-place-quote-a-1388',
      'lines', jsonb_build_array(jsonb_build_object(
        'kind', 'place',
        'offeringId', '00000000-1388-4000-8000-000000000013',
        'placeWindowId', '00000000-1388-4000-8000-000000000041',
        'units', 1,
        'guests', 2
      ))
    ),
    NULL,
    gen_random_uuid()
  );
  v_quote_b := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '00000000-1388-4000-8000-000000000004',
      'idempotencyKey', 'scarce-place-quote-b-1388',
      'lines', jsonb_build_array(jsonb_build_object(
        'kind', 'place',
        'offeringId', '00000000-1388-4000-8000-000000000013',
        'placeWindowId', '00000000-1388-4000-8000-000000000041',
        'units', 1,
        'guests', 2
      ))
    ),
    NULL,
    gen_random_uuid()
  );
  v_group_a := public.biz_manage_stay_reservation(
    'create_group',
    jsonb_build_object(
      'quoteId', v_quote_a->>'quoteId',
      'idempotencyKey', 'scarce-place-group-a-1388',
      'guest', jsonb_build_object(
        'name', 'Winner',
        'email', 'winner@example.test'
      )
    ),
    1,
    gen_random_uuid()
  );
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_groups_before
  FROM public.stay_reservation_groups;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'create_group',
      jsonb_build_object(
        'quoteId', v_quote_b->>'quoteId',
        'idempotencyKey', 'scarce-place-group-b-1388',
        'guest', jsonb_build_object(
          'name', 'Loser',
          'email', 'loser@example.test'
        )
      ),
      1,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-8 FAIL: scarce Place oversold';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM NOT LIKE '%stay_inventory_changed%' THEN
      RAISE;
    END IF;
  END;
  PERFORM set_config('role', 'postgres', true);
  IF (SELECT count(*) FROM public.stay_reservation_groups) <> v_groups_before
     OR EXISTS (
       SELECT 1 FROM public.stay_reservation_groups
       WHERE idempotency_key = 'scarce-place-group-b-1388'
     ) THEN
    RAISE EXCEPTION 'H-8 FAIL: losing attempt left a partial group';
  END IF;
  PERFORM set_config('role', 'authenticated', true);
  RAISE NOTICE 'H-8 PASS: stale quote loses atomically without oversell';
END;
$oversell$;

DO $illegal_transition$
DECLARE
  v_group_id uuid;
BEGIN
  PERFORM set_config('role', 'postgres', true);
  SELECT id INTO v_group_id
  FROM public.stay_reservation_groups
  WHERE idempotency_key = 'multi-room-group-1388';
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.biz_manage_stay_reservation(
      'approve_request',
      jsonb_build_object(
        'groupId', v_group_id,
        'idempotencyKey', 'invalid-instant-approval-1388'
      ),
      1,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'H-9 FAIL: Instant group entered Request approval';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM NOT LIKE '%stay_invalid_transition%' THEN
      RAISE;
    END IF;
  END;
  RAISE NOTICE 'H-9 PASS: illegal/partial state transitions fail closed';
END;
$illegal_transition$;

SELECT set_config('role', 'postgres', true);

DO $expiry_setup$
DECLARE
  v_group_id uuid;
BEGIN
  SELECT id INTO v_group_id
  FROM public.stay_reservation_groups
  WHERE idempotency_key = 'multi-room-group-1388';
  UPDATE public.stay_inventory_holds
  SET expires_at = now() - interval '1 minute',
      version = version + 1,
      updated_at = now()
  WHERE group_id = v_group_id;
END;
$expiry_setup$;

SELECT set_config(
  'request.jwt.claims',
  json_build_object('role', 'service_role')::text,
  true
);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('role', 'service_role', true);

DO $expiry$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.issue_1388_expire_groups(100, gen_random_uuid());
  IF (v_result->>'expiredCount')::integer < 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.stay_reservation_groups g
       JOIN public.stay_inventory_holds h ON h.group_id = g.id
       WHERE g.idempotency_key = 'multi-room-group-1388'
         AND g.state = 'cancelled'
         AND h.state = 'expired'
     ) THEN
    RAISE EXCEPTION 'H-10 FAIL: deadline sweep did not release hold %', v_result;
  END IF;
  RAISE NOTICE 'H-10 PASS: expiry is idempotent and releases inventory truth';
END;
$expiry$;

ROLLBACK;
