\set ON_ERROR_STOP on
BEGIN;

-- #1392 makes the reservation boundary default-dark. This success-path
-- fixture opens only read/write inside its rollback-only transaction.
UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key IN ('STAY_RESERVE_READS', 'STAY_RESERVE_WRITES');

DO $catalog$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.issue_1426_list_staff_stay_reservations(uuid)',
    'public.issue_1426_staff_group_projection(uuid)',
    'public.issue_1426_manage_request(text,uuid,bigint,text,uuid)',
    'public.issue_1426_cancel_preview(uuid,uuid[],bigint,uuid)',
    'public.issue_1426_cancel(uuid,text,text,text,uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR pg_get_functiondef(v_function::regprocedure) NOT LIKE '%SECURITY DEFINER%'
       OR pg_get_functiondef(v_function::regprocedure) NOT LIKE '%SET search_path TO%'
    THEN
      RAISE EXCEPTION 'H-1 FAIL: unsafe RPC ACL/search_path on %', v_function;
    END IF;
  END LOOP;
  RAISE NOTICE 'H-1 PASS: staff reservation RPCs are authenticated-only and pinned';
END;
$catalog$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  (
    '00000000-1426-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'owner-1426@example.test', now(), now()
  ),
  (
    '00000000-1426-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'manager-1426@example.test', now(), now()
  ),
  (
    '00000000-1426-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'guest-1426@example.test', now(), now()
  ),
  (
    '00000000-1426-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'outsider-1426@example.test', now(), now()
  );

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1426-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '00000000-1426-4000-8000-000000000010',
  '00000000-1426-4000-8000-000000000001',
  'Issue 1426 Stay Brand', 'issue-1426-stay-brand', 'USD',
  'ACCT_issue1426', now(), now()
);

INSERT INTO public.brand_team_members (
  brand_id, user_id, role, accepted_at
) VALUES (
  '00000000-1426-4000-8000-000000000010',
  '00000000-1426-4000-8000-000000000002',
  'event_manager', now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1426-4000-8000-000000000011',
  '00000000-1426-4000-8000-000000000010',
  'staffstay1426', 'Staff Stay 1426', 6.45, 3.47, 'stay', 'verified'
);

INSERT INTO public.stay_settings (
  venue_id, brand_id, timezone, default_booking_mode,
  booking_state, approved_payment_minutes, created_by, updated_by
) VALUES (
  '00000000-1426-4000-8000-000000000011',
  '00000000-1426-4000-8000-000000000010',
  'UTC', 'request', 'active', 45,
  '00000000-1426-4000-8000-000000000001',
  '00000000-1426-4000-8000-000000000001'
);

INSERT INTO public.stay_offerings (
  id, venue_id, brand_id, kind, name, description, status,
  confirmation_mode, inventory_basis, unit_naming_mode,
  quantity, min_guests, max_guests, max_adults, max_children,
  access_scope, created_by, updated_by
) VALUES (
  '00000000-1426-4000-8000-000000000012',
  '00000000-1426-4000-8000-000000000011',
  '00000000-1426-4000-8000-000000000010',
  'room', 'Ocean Room', 'A real request-mode room', 'live',
  'request', 'pooled_units', 'interchangeable',
  4, 1, 4, 4, 2, 'public',
  '00000000-1426-4000-8000-000000000001',
  '00000000-1426-4000-8000-000000000001'
);

INSERT INTO public.stay_policy_versions (
  id, offering_id, brand_id, venue_id, version_number,
  cancellation_policy, created_by
) VALUES (
  '00000000-1426-4000-8000-000000000013',
  '00000000-1426-4000-8000-000000000012',
  '00000000-1426-4000-8000-000000000010',
  '00000000-1426-4000-8000-000000000011',
  1, 'Free cancellation until the displayed cutoff.',
  '00000000-1426-4000-8000-000000000001'
);

INSERT INTO public.stay_price_versions (
  id, offering_id, brand_id, venue_id, version_number,
  amount_minor, currency_code, pricing_unit, created_by
) VALUES (
  '00000000-1426-4000-8000-000000000014',
  '00000000-1426-4000-8000-000000000012',
  '00000000-1426-4000-8000-000000000010',
  '00000000-1426-4000-8000-000000000011',
  1, 12000, 'USD', 'room_night',
  '00000000-1426-4000-8000-000000000001'
);

INSERT INTO public.stay_fee_versions (
  id, offering_id, brand_id, venue_id, fee_key, label,
  version_number, fee_kind, calculation, amount_minor,
  currency_code, display_mode, refund_treatment, created_by
) VALUES (
  '00000000-1426-4000-8000-000000000015',
  '00000000-1426-4000-8000-000000000012',
  '00000000-1426-4000-8000-000000000010',
  '00000000-1426-4000-8000-000000000011',
  'service_fee', 'Service fee', 1, 'mandatory_fee',
  'fixed_per_group', 1500, 'USD', 'separate', 'refundable',
  '00000000-1426-4000-8000-000000000001'
);

INSERT INTO public.stay_room_nights (
  offering_id, local_date, brand_id, venue_id, sellable_quantity
)
SELECT
  '00000000-1426-4000-8000-000000000012',
  (now() AT TIME ZONE 'UTC')::date + day_offset,
  '00000000-1426-4000-8000-000000000010',
  '00000000-1426-4000-8000-000000000011',
  4
FROM generate_series(30, 31) day_offset;

SELECT set_config(
  'request.jwt.claim.sub', '00000000-1426-4000-8000-000000000003', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1426-4000-8000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $guest_creates_real_request$
DECLARE
  v_check_in date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_quote jsonb;
  v_group jsonb;
BEGIN
  v_quote := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '00000000-1426-4000-8000-000000000011',
      'idempotencyKey', 'staff-queue-quote-1426',
      'lines', jsonb_build_array(jsonb_build_object(
        'kind', 'room',
        'offeringId', '00000000-1426-4000-8000-000000000012',
        'checkIn', v_check_in,
        'checkOut', v_check_in + 2,
        'quantity', 2,
        'allocations', jsonb_build_array(
          jsonb_build_object('adults', 2, 'children', 0),
          jsonb_build_object('adults', 1, 'children', 1)
        )
      ))
    ),
    NULL,
    '00000000-1426-4000-8000-000000000020'
  );
  v_group := public.biz_manage_stay_reservation(
    'create_group',
    jsonb_build_object(
      'quoteId', v_quote->>'quoteId',
      'idempotencyKey', 'staff-queue-group-1426',
      'guest', jsonb_build_object(
        'name', 'Ada Staff Queue Guest',
        'email', 'ada-1426@example.test',
        'phone', '+15555551426'
      )
    ),
    1,
    '00000000-1426-4000-8000-000000000021'
  );
  IF v_group->>'state' <> 'request_pending'
     OR (v_group->>'totalMinor')::bigint <> 49500 THEN
    RAISE EXCEPTION 'H-2 FAIL: real request fixture was not truthful %', v_group;
  END IF;
  RAISE NOTICE 'H-2 PASS: guest produced a real two-room request with exact fees';
END;
$guest_creates_real_request$;

SELECT set_config('role', 'postgres', true);
SELECT set_config(
  'request.jwt.claim.sub', '00000000-1426-4000-8000-000000000002', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1426-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $staff_queue_and_approval$
DECLARE
  v_list jsonb;
  v_group jsonb;
  v_detail jsonb;
  v_group_id uuid;
  v_version bigint;
BEGIN
  v_list := public.issue_1426_list_staff_stay_reservations(
    '00000000-1426-4000-8000-000000000011'
  );
  IF jsonb_array_length(v_list->'groups') <> 1
     OR v_list#>>'{permissions,canRespond}' <> 'true'
     OR v_list#>>'{permissions,canViewFinance}' <> 'false'
     OR v_list#>>'{groups,0,state}' <> 'request_pending'
     OR v_list#>>'{groups,0,roomCount}' <> '1'
  THEN
    RAISE EXCEPTION 'H-3 FAIL: staff queue/permissions are wrong %', v_list;
  END IF;
  v_group_id := (v_list#>>'{groups,0,groupId}')::uuid;
  v_version := (v_list#>>'{groups,0,version}')::bigint;
  v_detail := public.issue_1426_staff_group_projection(v_group_id);
  IF jsonb_array_length(v_detail->'lines') <> 1
     OR jsonb_array_length(v_detail#>'{lines,0,allocations}') <> 2
     OR jsonb_array_length(v_detail#>'{lines,0,fees}') <> 1
     OR v_detail#>>'{lines,0,roomQuantity}' <> '2'
     OR v_detail#>>'{lines,0,fees,0,amountMinor}' <> '1500'
  THEN
    RAISE EXCEPTION 'H-3 FAIL: inspection lost line/fee/allocation truth %', v_detail;
  END IF;
  v_group := public.issue_1426_manage_request(
    'approve_request', v_group_id, v_version,
    'approve-staff-request-1426',
    '00000000-1426-4000-8000-000000000022'
  );
  IF v_group->>'state' <> 'approved_payment_required'
     OR v_group->>'paymentDeadline' IS NULL
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_group->'lines') line
       WHERE line->>'state' <> 'approved_payment_required'
     )
  THEN
    RAISE EXCEPTION 'H-4 FAIL: approval was not whole-group/payment-gated %', v_group;
  END IF;
  RAISE NOTICE 'H-3/H-4 PASS: staff sees truth and approves all rooms atomically';
END;
$staff_queue_and_approval$;

SELECT set_config('role', 'postgres', true);
UPDATE public.brand_team_members
SET permissions_override = '{"stay.respond": false}'::jsonb
WHERE brand_id = '00000000-1426-4000-8000-000000000010'
  AND user_id = '00000000-1426-4000-8000-000000000002';
SELECT set_config('role', 'authenticated', true);

DO $deny_override$
DECLARE
  v_group_id uuid;
  v_version bigint;
  v_detail jsonb;
  v_list jsonb;
BEGIN
  v_list := public.issue_1426_list_staff_stay_reservations(
    '00000000-1426-4000-8000-000000000011'
  );
  v_group_id := (v_list#>>'{groups,0,groupId}')::uuid;
  v_version := (v_list#>>'{groups,0,version}')::bigint;
  v_detail := public.issue_1426_staff_group_projection(v_group_id);
  IF v_detail#>>'{permissions,canRespond}' <> 'false' THEN
    RAISE EXCEPTION 'H-5 FAIL: explicit deny did not reach the UI projection';
  END IF;
  BEGIN
    PERFORM public.issue_1426_manage_request(
      'decline_request', v_group_id, v_version,
      'denied-staff-action-1426', gen_random_uuid()
    );
    RAISE EXCEPTION 'H-5 FAIL: denied manager changed a request';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'forbidden' THEN
      RAISE;
    END IF;
  END;
  RAISE NOTICE 'H-5 PASS: per-brand explicit deny removes the server action';
END;
$deny_override$;

SELECT set_config('role', 'postgres', true);
SELECT set_config(
  'request.jwt.claim.sub', '00000000-1426-4000-8000-000000000004', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1426-4000-8000-000000000004',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $cross_brand_denial$
BEGIN
  BEGIN
    PERFORM public.issue_1426_list_staff_stay_reservations(
      '00000000-1426-4000-8000-000000000011'
    );
    RAISE EXCEPTION 'H-6 FAIL: outsider read another brand queue';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'forbidden' THEN
      RAISE;
    END IF;
  END;
  RAISE NOTICE 'H-6 PASS: cross-brand queue access is blocked';
END;
$cross_brand_denial$;

SELECT set_config('role', 'postgres', true);
-- Restore the release posture before the existing dark-launch assertion.
UPDATE public.feature_flags
SET is_enabled = false
WHERE flag_key IN ('STAY_RESERVE_READS', 'STAY_RESERVE_WRITES');
DO $dark_launch$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.feature_flags
    WHERE flag_key IN (
      'STAY_VENUE_AUTHORING',
      'STAY_PUBLIC_PAGES',
      'STAY_RESERVE_READS',
      'STAY_RESERVE_WRITES',
      'STAY_STRIPE_COMMERCE',
      'STAY_PAYSTACK_COMMERCE',
      'STAY_NOTIFICATIONS'
    )
      AND is_enabled
  ) THEN
    RAISE EXCEPTION 'H-7 FAIL: issue #1426 turned on a Stay feature flag';
  END IF;
  RAISE NOTICE 'H-7 PASS: all Stay launch flags remain dark';
END;
$dark_launch$;

ROLLBACK;
