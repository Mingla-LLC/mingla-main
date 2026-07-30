\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_public text;
  v_mine text;
BEGIN
  IF to_regprocedure('public.pg_public_stay_details(uuid)') IS NULL
     OR to_regprocedure('public.pg_my_stay_reservation_groups()') IS NULL THEN
    RAISE EXCEPTION 'G-1 FAIL: Stay guest read contract missing';
  END IF;
  IF NOT has_function_privilege(
       'anon', 'public.pg_public_stay_details(uuid)', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.pg_public_stay_details(uuid)', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.pg_my_stay_reservation_groups()', 'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated', 'public.pg_my_stay_reservation_groups()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'G-1 FAIL: public/private read ACL is wrong';
  END IF;

  SELECT pg_get_functiondef(
    'public.pg_public_stay_details(uuid)'::regprocedure
  ) INTO v_public;
  SELECT pg_get_functiondef(
    'public.pg_my_stay_reservation_groups()'::regprocedure
  ) INTO v_mine;
  IF v_public NOT LIKE '%STAY_PUBLIC_PAGES%'
     OR v_public NOT LIKE '%venue_public_view%'
     OR v_public NOT LIKE '%booking_state = ''active''%'
     OR v_public NOT LIKE '%offering.status = ''live''%'
     OR v_public NOT LIKE '%media.status = ''ready''%'
     OR v_public NOT LIKE '%price.amount_minor::text%'
     OR v_public NOT LIKE '%price.currency_code%'
     OR v_mine NOT LIKE '%reservation_group.user_id = v_uid%'
     OR v_mine NOT LIKE '%RAISE EXCEPTION ''unauthorized''%' THEN
    RAISE EXCEPTION 'G-1 FAIL: feature, publication, money, or ownership guard missing';
  END IF;
  RAISE NOTICE 'G-1 PASS: Stay guest reads are flag-gated and owner-scoped';
END;
$catalog$;

DO $dark$
DECLARE
  v_result jsonb;
BEGIN
  UPDATE public.feature_flags
  SET is_enabled = false
  WHERE flag_key = 'STAY_PUBLIC_PAGES';
  SELECT public.pg_public_stay_details(gen_random_uuid()) INTO v_result;
  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'G-2 FAIL: disabled public Stay page did not fail closed';
  END IF;
  RAISE NOTICE 'G-2 PASS: public Stay projection ships dark';
END;
$dark$;

DO $currency$
DECLARE
  v_public text;
BEGIN
  SELECT pg_get_functiondef(
    'public.pg_public_stay_details(uuid)'::regprocedure
  ) INTO v_public;
  IF v_public LIKE '%''USD''%'
     OR v_public LIKE '%''$''%'
     OR v_public LIKE '%default_currency%'
     OR v_public NOT LIKE '%amountMinor%'
     OR v_public NOT LIKE '%currencyCode%' THEN
    RAISE EXCEPTION 'G-3 FAIL: public Stay price is not exact source currency';
  END IF;
  RAISE NOTICE 'G-3 PASS: no USD fallback exists in the guest projection';
END;
$currency$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1390-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'guest-1390@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1390-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '00000000-1390-4000-8000-000000000002',
  '00000000-1390-4000-8000-000000000001',
  'Issue 1390 Stay Brand',
  'issue-1390-stay-brand',
  'NGN',
  'ACCT_issue1390',
  now(),
  now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1390-4000-8000-000000000003',
  '00000000-1390-4000-8000-000000000002',
  'lagoonstay',
  'Lagoon Stay',
  6.45,
  3.47,
  'stay',
  'verified'
);

INSERT INTO public.stay_settings (
  venue_id, brand_id, property_kind, timezone, default_booking_mode,
  booking_state
) VALUES (
  '00000000-1390-4000-8000-000000000003',
  '00000000-1390-4000-8000-000000000002',
  'resort',
  'Africa/Lagos',
  'instant',
  'active'
);

INSERT INTO public.stay_offerings (
  id, venue_id, brand_id, kind, name, status, confirmation_mode,
  inventory_basis, unit_naming_mode, quantity, min_guests, max_guests,
  max_adults, max_children
) VALUES
  (
    '00000000-1390-4000-8000-000000000011',
    '00000000-1390-4000-8000-000000000003',
    '00000000-1390-4000-8000-000000000002',
    'room',
    'Lagoon Room',
    'live',
    'instant',
    'pooled_units',
    'interchangeable',
    4,
    1,
    4,
    4,
    2
  ),
  (
    '00000000-1390-4000-8000-000000000012',
    '00000000-1390-4000-8000-000000000003',
    '00000000-1390-4000-8000-000000000002',
    'room',
    'Draft Room',
    'draft',
    'instant',
    'pooled_units',
    'interchangeable',
    1,
    1,
    2,
    2,
    1
  );

INSERT INTO public.stay_price_versions (
  offering_id, brand_id, venue_id, version_number, amount_minor,
  currency_code, pricing_unit
)
SELECT
  offering.id,
  offering.brand_id,
  offering.venue_id,
  1,
  CASE WHEN offering.status = 'live' THEN 12500000 ELSE 100 END,
  'NGN',
  'room_night'
FROM public.stay_offerings offering
WHERE offering.id IN (
  '00000000-1390-4000-8000-000000000011',
  '00000000-1390-4000-8000-000000000012'
);

INSERT INTO public.stay_policy_versions (
  offering_id, brand_id, venue_id, version_number, cancellation_policy
)
SELECT
  offering.id,
  offering.brand_id,
  offering.venue_id,
  1,
  'Free cancellation until 24 hours before check-in.'
FROM public.stay_offerings offering
WHERE offering.id IN (
  '00000000-1390-4000-8000-000000000011',
  '00000000-1390-4000-8000-000000000012'
);

DO $projection$
DECLARE
  v_result jsonb;
BEGIN
  UPDATE public.feature_flags
  SET is_enabled = true
  WHERE flag_key = 'STAY_PUBLIC_PAGES';
  SELECT public.pg_public_stay_details(
    '00000000-1390-4000-8000-000000000003'
  ) INTO v_result;
  IF v_result IS NULL
     OR v_result->>'propertyKind' <> 'resort'
     OR jsonb_array_length(v_result->'offerings') <> 1
     OR v_result#>>'{offerings,0,name}' <> 'Lagoon Room'
     OR v_result#>>'{offerings,0,price,amountMinor}' <> '12500000'
     OR v_result#>>'{offerings,0,price,currencyCode}' <> 'NGN' THEN
    RAISE EXCEPTION 'G-4 FAIL: executable public Stay projection is wrong: %',
      v_result;
  END IF;
  RAISE NOTICE 'G-4 PASS: only live exact-NGN Stay inventory is projected';
END;
$projection$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1390-4000-8000-000000000099',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'other-guest-1390@example.test',
  now(),
  now()
);

INSERT INTO public.stay_quotes (
  id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
  mode, status, source_subtotal_minor, fee_total_minor, tax_total_minor,
  total_minor, request_hash, price_revision_set_hash,
  inventory_revision_set_hash, policy_snapshot_hash, idempotency_key,
  expires_at, consumed_at
) VALUES
  (
    '00000000-1390-4000-8000-000000000051',
    '00000000-1390-4000-8000-000000000001',
    repeat('a', 64),
    '00000000-1390-4000-8000-000000000003',
    '00000000-1390-4000-8000-000000000002',
    'NGN', 'instant', 'consumed',
    12500000, 0, 0, 12500000,
    repeat('1', 64), repeat('2', 64), repeat('3', 64), repeat('4', 64),
    'issue-1390-quote-owner', now() + interval '1 hour', now()
  ),
  (
    '00000000-1390-4000-8000-000000000052',
    '00000000-1390-4000-8000-000000000099',
    repeat('b', 64),
    '00000000-1390-4000-8000-000000000003',
    '00000000-1390-4000-8000-000000000002',
    'NGN', 'instant', 'consumed',
    12500000, 0, 0, 12500000,
    repeat('5', 64), repeat('6', 64), repeat('7', 64), repeat('8', 64),
    'issue-1390-quote-other', now() + interval '1 hour', now()
  );

INSERT INTO public.stay_quote_lines (
  id, quote_id, offering_id, kind, confirmation_mode,
  room_check_in, room_check_out, room_quantity, adults, children,
  base_minor, fee_minor, tax_minor, total_minor,
  price_version_id, policy_version_id, offering_version,
  inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot
)
SELECT
  fixture.id,
  fixture.quote_id,
  '00000000-1390-4000-8000-000000000011'::uuid,
  'room', 'instant', current_date + 5, current_date + 7, 1, 2, 0,
  12500000, 0, 0, 12500000,
  price.id, policy.id, 1,
  '{}'::jsonb, '{"name":"Lagoon Room"}'::jsonb,
  jsonb_build_object('amountMinor', '12500000', 'currencyCode', 'NGN'),
  '{"cancellationPolicy":"Flexible"}'::jsonb
FROM (
  VALUES
    (
      '00000000-1390-4000-8000-000000000061'::uuid,
      '00000000-1390-4000-8000-000000000051'::uuid
    ),
    (
      '00000000-1390-4000-8000-000000000062'::uuid,
      '00000000-1390-4000-8000-000000000052'::uuid
    )
) fixture(id, quote_id)
CROSS JOIN LATERAL (
  SELECT id
  FROM public.stay_price_versions
  WHERE offering_id = '00000000-1390-4000-8000-000000000011'
  ORDER BY version_number DESC
  LIMIT 1
) price
CROSS JOIN LATERAL (
  SELECT id
  FROM public.stay_policy_versions
  WHERE offering_id = '00000000-1390-4000-8000-000000000011'
  ORDER BY version_number DESC
  LIMIT 1
) policy;

INSERT INTO public.stay_reservation_groups (
  id, public_reference, quote_id, user_id, actor_key_hash, venue_id,
  brand_id, currency_code, mode, state, guest_snapshot,
  source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
  idempotency_key, request_hash
) VALUES
  (
    '00000000-1390-4000-8000-000000000071',
    'ST-13900000000000000001',
    '00000000-1390-4000-8000-000000000051',
    '00000000-1390-4000-8000-000000000001',
    repeat('a', 64),
    '00000000-1390-4000-8000-000000000003',
    '00000000-1390-4000-8000-000000000002',
    'NGN', 'instant', 'confirmed', '{"name":"Owner Guest"}',
    12500000, 0, 0, 12500000,
    'issue-1390-group-owner', repeat('9', 64)
  ),
  (
    '00000000-1390-4000-8000-000000000072',
    'ST-13900000000000000002',
    '00000000-1390-4000-8000-000000000052',
    '00000000-1390-4000-8000-000000000099',
    repeat('b', 64),
    '00000000-1390-4000-8000-000000000003',
    '00000000-1390-4000-8000-000000000002',
    'NGN', 'instant', 'confirmed', '{"name":"Other Guest"}',
    12500000, 0, 0, 12500000,
    'issue-1390-group-other', repeat('a', 64)
  );

INSERT INTO public.stay_reservation_lines (
  id, group_id, quote_line_id, offering_id, kind, state,
  room_check_in, room_check_out, room_quantity, adults, children,
  base_minor, fee_minor, tax_minor, total_minor,
  offering_snapshot, price_snapshot, policy_snapshot
) VALUES
  (
    '00000000-1390-4000-8000-000000000081',
    '00000000-1390-4000-8000-000000000071',
    '00000000-1390-4000-8000-000000000061',
    '00000000-1390-4000-8000-000000000011',
    'room', 'confirmed', current_date + 5, current_date + 7, 1, 2, 0,
    12500000, 0, 0, 12500000,
    '{"name":"Lagoon Room"}',
    '{"amountMinor":"12500000","currencyCode":"NGN"}',
    '{"cancellationPolicy":"Flexible"}'
  ),
  (
    '00000000-1390-4000-8000-000000000082',
    '00000000-1390-4000-8000-000000000072',
    '00000000-1390-4000-8000-000000000062',
    '00000000-1390-4000-8000-000000000011',
    'room', 'confirmed', current_date + 5, current_date + 7, 1, 2, 0,
    12500000, 0, 0, 12500000,
    '{"name":"Lagoon Room"}',
    '{"amountMinor":"12500000","currencyCode":"NGN"}',
    '{"cancellationPolicy":"Flexible"}'
  );

DO $owner_list$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claim.sub',
    '00000000-1390-4000-8000-000000000001',
    true
  );
  SELECT public.pg_my_stay_reservation_groups() INTO v_result;
  IF jsonb_array_length(v_result) <> 1
     OR v_result#>>'{0,groupId}' <> '00000000-1390-4000-8000-000000000071'
     OR v_result#>>'{0,currencyCode}' <> 'NGN'
     OR v_result#>>'{0,lines,0,roomCheckIn}' IS NULL
     OR v_result#>'{0,lines,0}' ? 'placeStartsAt' IS NOT TRUE THEN
    RAISE EXCEPTION 'G-5 FAIL: guest itinerary ownership or dates wrong: %',
      v_result;
  END IF;
  RAISE NOTICE 'G-5 PASS: guest list returns only owner rows with itinerary dates';
END;
$owner_list$;

ROLLBACK;
