-- #4188 — staff can record a canonical Stay reservation without fabricating
-- provider money truth, and cancellation only reopens inventory.
-- MINGLA-INVARIANT: I-4188-STAFF-STAY-EXTERNAL-MONEY-TRUTH | issue #4188 | Staff-created Stay reservations use canonical quote/inventory truth, are explicitly property-collected, never enter the staff actor's guest itinerary, and never create provider payment/refund truth.
\set ON_ERROR_STOP on
BEGIN;

-- The production Supabase Auth schema includes phone; the bare PG17 replay
-- fixture does not. Keep this compatibility column inside the rolled-back test
-- transaction so notification-on behavior exercises the real trigger path.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key IN ('STAY_RESERVE_READS', 'STAY_RESERVE_WRITES');
UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key = 'STAY_NOTIFICATIONS';
UPDATE public.feature_flags
SET is_enabled = false
WHERE flag_key = 'STAY_PUBLIC_PAGES';

DO $catalog$
DECLARE
  v_function text;
BEGIN
  IF public.biz_role_rank('venue_staff') <> -1 THEN
    RAISE EXCEPTION 'venue_staff_rank_sentinel_drifted';
  END IF;
  FOREACH v_function IN ARRAY ARRAY[
    'public.issue_4188_staff_stay_details(uuid)',
    'public.issue_4188_create_staff_stay_group(uuid,text,jsonb,text,bigint,text,bytea,boolean,boolean,timestamptz,uuid)',
    'public.issue_4188_rotate_staff_payment_link(uuid,bytea,timestamptz,boolean,boolean)',
    'public.issue_4188_revoke_staff_payment_link(uuid,text)',
    'public.issue_4188_cancel_preview(uuid,uuid[],bigint,uuid)',
    'public.issue_4188_cancel(uuid,text,text,text,uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR pg_get_functiondef(v_function::regprocedure) NOT LIKE '%SECURITY DEFINER%'
       OR pg_get_functiondef(v_function::regprocedure) NOT LIKE '%SET search_path TO%'
    THEN
      RAISE EXCEPTION 'unsafe_staff_stay_rpc:%', v_function;
    END IF;
  END LOOP;
  IF has_function_privilege(
    'authenticated',
    'public.issue_4188_property_cancel(uuid,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'internal_property_cancel_rpc_was_exposed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.stay_reservation_groups'::regclass
      AND confrelid = 'auth.users'::regclass
      AND pg_get_constraintdef(oid) LIKE
        'FOREIGN KEY (created_by_staff_user_id)%ON DELETE SET NULL%'
  ) THEN
    RAISE EXCEPTION 'staff_actor_erasure_fk_not_set_null';
  END IF;
END;
$catalog$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  (
    '41880000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'owner-4188@example.test', now(), now()
  ),
  (
    '41880000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'manager-4188@example.test', now(), now()
  ),
  (
    '41880000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'outsider-4188@example.test', now(), now()
  ),
  (
    '41880000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'frontdesk-4188@example.test', now(), now()
  );

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('41880000-0000-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '41880000-0000-4000-9000-000000000010',
  '41880000-0000-4000-8000-000000000001',
  'Issue 4188 Stay Brand', 'issue-4188-stay-brand', 'USD',
  'ACCT_issue4188', now(), now()
);

INSERT INTO public.brand_team_members (
  brand_id, user_id, role, accepted_at
) VALUES
  (
    '41880000-0000-4000-9000-000000000010',
    '41880000-0000-4000-8000-000000000002',
    'event_manager', now()
  ),
  (
    '41880000-0000-4000-9000-000000000010',
    '41880000-0000-4000-8000-000000000004',
    'venue_staff', now()
  );

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES
  (
    '41880000-0000-4000-9000-000000000011',
    '41880000-0000-4000-9000-000000000010',
    'staffstay4188', 'Staff Stay 4188', 6.45, 3.47, 'stay', 'verified'
  ),
  (
    '41880000-0000-4000-9000-000000000016',
    '41880000-0000-4000-9000-000000000010',
    'otherstay4188', 'Other Stay 4188', 6.46, 3.48, 'stay', 'verified'
  );

INSERT INTO public.brand_team_member_venue_grants (
  member_id, venue_id, access_profile, capabilities
)
SELECT
  member.id,
  '41880000-0000-4000-9000-000000000011',
  'front_desk',
  ARRAY[
    'stay.view_reservations',
    'stay.create_reservations',
    'stay.manage_reservations',
    'stay.view_availability'
  ]::text[]
FROM public.brand_team_members member
WHERE member.brand_id = '41880000-0000-4000-9000-000000000010'
  AND member.user_id = '41880000-0000-4000-8000-000000000004';

INSERT INTO public.stay_settings (
  venue_id, brand_id, timezone, default_booking_mode,
  booking_state, approved_payment_minutes, created_by, updated_by
) VALUES (
  '41880000-0000-4000-9000-000000000011',
  '41880000-0000-4000-9000-000000000010',
  'UTC', 'request', 'active', 45,
  '41880000-0000-4000-8000-000000000001',
  '41880000-0000-4000-8000-000000000001'
);

INSERT INTO public.stay_offerings (
  id, venue_id, brand_id, kind, name, description, status,
  confirmation_mode, inventory_basis, unit_naming_mode,
  quantity, min_guests, max_guests, max_adults, max_children,
  access_scope, created_by, updated_by
) VALUES (
  '41880000-0000-4000-9000-000000000012',
  '41880000-0000-4000-9000-000000000011',
  '41880000-0000-4000-9000-000000000010',
  'room', 'Ocean Room', 'A canonical request-mode room', 'live',
  'request', 'pooled_units', 'interchangeable',
  4, 1, 4, 4, 2, 'public',
  '41880000-0000-4000-8000-000000000001',
  '41880000-0000-4000-8000-000000000001'
);

INSERT INTO public.stay_policy_versions (
  id, offering_id, brand_id, venue_id, version_number,
  cancellation_policy, created_by
) VALUES (
  '41880000-0000-4000-9000-000000000013',
  '41880000-0000-4000-9000-000000000012',
  '41880000-0000-4000-9000-000000000010',
  '41880000-0000-4000-9000-000000000011',
  1, 'Property handles externally collected refunds.',
  '41880000-0000-4000-8000-000000000001'
);

INSERT INTO public.stay_price_versions (
  id, offering_id, brand_id, venue_id, version_number,
  amount_minor, currency_code, pricing_unit, created_by
) VALUES (
  '41880000-0000-4000-9000-000000000014',
  '41880000-0000-4000-9000-000000000012',
  '41880000-0000-4000-9000-000000000010',
  '41880000-0000-4000-9000-000000000011',
  1, 12000, 'USD', 'room_night',
  '41880000-0000-4000-8000-000000000001'
);

INSERT INTO public.stay_fee_versions (
  id, offering_id, brand_id, venue_id, fee_key, label,
  version_number, fee_kind, calculation, amount_minor,
  currency_code, display_mode, refund_treatment, created_by
) VALUES (
  '41880000-0000-4000-9000-000000000015',
  '41880000-0000-4000-9000-000000000012',
  '41880000-0000-4000-9000-000000000010',
  '41880000-0000-4000-9000-000000000011',
  'service_fee', 'Service fee', 1, 'mandatory_fee',
  'fixed_per_group', 1500, 'USD', 'separate', 'refundable',
  '41880000-0000-4000-8000-000000000001'
);

INSERT INTO public.stay_room_nights (
  offering_id, local_date, brand_id, venue_id, sellable_quantity
)
SELECT
  '41880000-0000-4000-9000-000000000012',
  (now() AT TIME ZONE 'UTC')::date + day_offset,
  '41880000-0000-4000-9000-000000000010',
  '41880000-0000-4000-9000-000000000011',
  4
FROM generate_series(30, 31) day_offset;

SELECT set_config(
  'request.jwt.claim.sub', '41880000-0000-4000-8000-000000000002', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '41880000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $staff_create$
DECLARE
  v_check_in date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_quote jsonb;
  v_staff_detail jsonb;
  v_group jsonb;
  v_repeat jsonb;
  v_list jsonb;
  v_itinerary jsonb;
  v_group_id uuid;
BEGIN
  IF public.pg_public_stay_details(
    '41880000-0000-4000-9000-000000000011'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'public_stay_gate_fixture_was_not_closed';
  END IF;
  v_staff_detail := public.issue_4188_staff_stay_details(
    '41880000-0000-4000-9000-000000000011'
  );
  IF v_staff_detail->>'venueId'
       <> '41880000-0000-4000-9000-000000000011'
     OR v_staff_detail#>>'{offerings,0,id}'
       <> '41880000-0000-4000-9000-000000000012'
  THEN
    RAISE EXCEPTION 'staff_detail_depended_on_public_page:%', v_staff_detail;
  END IF;

  v_quote := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '41880000-0000-4000-9000-000000000011',
      'idempotencyKey', 'staff-front-desk-quote-4188',
      'lines', jsonb_build_array(jsonb_build_object(
        'kind', 'room',
        'offeringId', '41880000-0000-4000-9000-000000000012',
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
    '41880000-0000-4000-8000-000000000020'
  );
  v_group := public.issue_4188_create_staff_stay_group(
    (v_quote->>'quoteId')::uuid,
    'staff-front-desk-group-4188',
    jsonb_build_object(
      'name', 'Nia Front Desk Guest',
      'email', 'nia-4188@example.test',
      'phone', '+15555554188'
    ),
    'phone',
    (v_quote->>'version')::bigint,
    'property',
    NULL,
    false,
    false,
    NULL,
    '41880000-0000-4000-8000-000000000021'
  );
  v_group_id := (v_group->>'groupId')::uuid;
  IF v_group->>'state' <> 'confirmed'
     OR v_group->>'bookingSource' <> 'phone'
     OR v_group->>'paymentCollection' <> 'property'
     OR v_group->>'totalMinor' <> v_quote->>'totalMinor'
     OR v_group#>>'{permissions,canCreate}' <> 'true'
     OR jsonb_array_length(v_group->'events') <> 1
     OR v_group#>>'{events,0,eventType}' <> 'stay_staff_reservation_created'
  THEN
    RAISE EXCEPTION 'staff_create_projection_not_truthful:%', v_group;
  END IF;
  PERFORM set_config('role', 'none', true);
  IF (SELECT state FROM public.stay_inventory_holds WHERE group_id = v_group_id)
       <> 'converted'
     OR (SELECT count(*) FROM public.stay_inventory_commitments
         WHERE group_id = v_group_id AND state = 'active') <> 2
     OR (SELECT COALESCE(sum(quantity), 0)
         FROM public.stay_inventory_commitments
         WHERE group_id = v_group_id AND state = 'active') <> 4
     OR EXISTS (SELECT 1 FROM public.stay_payment_attempts WHERE group_id = v_group_id)
     OR EXISTS (SELECT 1 FROM public.stay_refunds WHERE group_id = v_group_id)
     OR EXISTS (SELECT 1 FROM public.stay_money_ledger WHERE group_id = v_group_id)
     OR EXISTS (
       SELECT 1 FROM public.notification_outbox
       WHERE payload->>'stay_group_id' = v_group_id::text
     )
  THEN
    RAISE EXCEPTION 'staff_create_inventory_or_money_truth_failed:%', v_group_id;
  END IF;
  PERFORM set_config('role', 'authenticated', true);

  v_repeat := public.issue_4188_create_staff_stay_group(
    (v_quote->>'quoteId')::uuid,
    'staff-front-desk-group-4188',
    jsonb_build_object(
      'name', 'Nia Front Desk Guest',
      'email', 'nia-4188@example.test',
      'phone', '+15555554188'
    ),
    'phone',
    (v_quote->>'version')::bigint,
    'property',
    NULL,
    false,
    false,
    NULL,
    '41880000-0000-4000-8000-000000000022'
  );
  PERFORM set_config('role', 'none', true);
  IF v_repeat->>'groupId' <> v_group_id::text
     OR (SELECT count(*) FROM public.stay_reservation_groups
         WHERE id = v_group_id) <> 1 THEN
    RAISE EXCEPTION 'staff_create_idempotency_failed:%', v_repeat;
  END IF;
  PERFORM set_config('role', 'authenticated', true);

  v_list := public.issue_1426_list_staff_stay_reservations(
    '41880000-0000-4000-9000-000000000011'
  );
  IF v_list#>>'{permissions,canCreate}' <> 'true'
     OR v_list#>>'{groups,0,bookingSource}' <> 'phone'
     OR v_list#>>'{groups,0,paymentCollection}' <> 'property'
     OR v_list#>>'{groups,0,paymentState}' IS NOT NULL
  THEN
    RAISE EXCEPTION 'staff_queue_lost_property_booking_truth:%', v_list;
  END IF;

  v_itinerary := public.pg_my_stay_reservation_groups();
  IF jsonb_array_length(v_itinerary) <> 0 THEN
    RAISE EXCEPTION 'staff_booking_leaked_into_guest_itinerary:%', v_itinerary;
  END IF;

  BEGIN
    PERFORM public.issue_4188_create_staff_stay_group(
      (v_quote->>'quoteId')::uuid,
      'staff-front-desk-group-4188',
      jsonb_build_object(
        'name', 'Nia Front Desk Guest',
        'email', 'nia-4188@example.test',
        'phone', '+15555554188'
      ),
      'walk_in',
      (v_quote->>'version')::bigint,
      'property',
      NULL,
      false,
      false,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'staff_source_idempotency_conflict_was_accepted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'stay_idempotency_conflict' THEN RAISE; END IF;
  END;
END;
$staff_create$;

DO $property_cancel$
DECLARE
  v_group_id uuid;
  v_group_version bigint;
  v_line_ids uuid[];
  v_preview jsonb;
  v_result jsonb;
BEGIN
  PERFORM set_config('role', 'none', true);
  SELECT id, version INTO STRICT v_group_id, v_group_version
  FROM public.stay_reservation_groups
  WHERE idempotency_key = 'staff-front-desk-group-4188';
  SELECT array_agg(id ORDER BY id) INTO v_line_ids
  FROM public.stay_reservation_lines
  WHERE group_id = v_group_id;
  PERFORM set_config('role', 'authenticated', true);

  v_preview := public.issue_4188_cancel_preview(
    v_group_id,
    v_line_ids,
    v_group_version,
    '41880000-0000-4000-8000-000000000023'
  );
  IF v_preview->>'paymentCollection' <> 'property'
     OR v_preview->>'amountMinor' <> '0'
     OR v_preview->>'externalRefundHandledBy' <> 'property'
     OR v_preview#>>'{inventoryRelease,commitmentCount}' <> '2'
  THEN
    RAISE EXCEPTION 'property_cancel_preview_not_truthful:%', v_preview;
  END IF;

  v_result := public.issue_4188_cancel(
    (v_preview->>'previewId')::uuid,
    v_preview->>'previewHash',
    'staff-property-cancel-4188',
    'Guest called the front desk',
    '41880000-0000-4000-8000-000000000024'
  );
  PERFORM set_config('role', 'none', true);
  IF v_result->>'refundId' IS NOT NULL
     OR v_result->>'state' <> 'not_applicable'
     OR v_result#>>'{group,state}' <> 'cancelled'
     OR EXISTS (SELECT 1 FROM public.stay_inventory_commitments
       WHERE group_id = v_group_id AND state = 'active')
     OR EXISTS (SELECT 1 FROM public.stay_refunds WHERE group_id = v_group_id)
     OR EXISTS (SELECT 1 FROM public.source_refunds WHERE subject_id = v_group_id)
     OR EXISTS (SELECT 1 FROM public.stay_money_ledger WHERE group_id = v_group_id)
     OR EXISTS (
       SELECT 1 FROM public.notification_outbox
       WHERE payload->>'stay_group_id' = v_group_id::text
     )
  THEN
    RAISE EXCEPTION 'property_cancel_fabricated_money_or_kept_inventory:%', v_result;
  END IF;
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.issue_4188_cancel(
    (v_preview->>'previewId')::uuid,
    v_preview->>'previewHash',
    'staff-property-cancel-4188',
    'Guest called the front desk',
    '41880000-0000-4000-8000-000000000025'
  );
  IF v_result#>>'{group,state}' <> 'cancelled' THEN
    RAISE EXCEPTION 'property_cancel_idempotency_failed:%', v_result;
  END IF;
END;
$property_cancel$;

DO $staff_payment_link$
DECLARE
  v_check_in date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_quote jsonb;
  v_group jsonb;
  v_group_id uuid;
  v_link jsonb;
  v_rotated jsonb;
  v_revoked jsonb;
BEGIN
  v_quote := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '41880000-0000-4000-9000-000000000011',
      'idempotencyKey', 'staff-payment-link-quote-4188',
      'lines', jsonb_build_array(jsonb_build_object(
        'kind', 'room',
        'offeringId', '41880000-0000-4000-9000-000000000012',
        'checkIn', v_check_in,
        'checkOut', v_check_in + 2,
        'quantity', 1,
        'allocations', jsonb_build_array(
          jsonb_build_object('adults', 2, 'children', 0)
        )
      ))
    ),
    NULL,
    '41880000-0000-4000-8000-000000000030'
  );
  v_group := public.issue_4188_create_staff_stay_group(
    (v_quote->>'quoteId')::uuid,
    'staff-payment-link-group-4188',
    jsonb_build_object(
      'name', 'Link Guest',
      'email', 'link-4188@example.test',
      'phone', '+15555554189'
    ),
    'phone',
    (v_quote->>'version')::bigint,
    'link',
    decode(repeat('ab', 32), 'hex'),
    true,
    true,
    now() + interval '24 hours',
    '41880000-0000-4000-8000-000000000031'
  );
  v_group_id := (v_group->>'groupId')::uuid;
  PERFORM set_config('role', 'none', true);
  IF v_group->>'state' <> 'approved_payment_required'
     OR v_group->>'paymentCollection' <> 'mingla'
     OR v_group#>>'{paymentLink,emailStatus}' <> 'pending'
     OR v_group#>>'{paymentLink,smsStatus}' <> 'pending'
     OR (SELECT user_id FROM public.stay_reservation_groups
         WHERE id = v_group_id) IS NOT NULL
     OR (SELECT state FROM public.stay_inventory_holds
         WHERE group_id = v_group_id) <> 'active'
     OR EXISTS (SELECT 1 FROM public.stay_inventory_commitments
         WHERE group_id = v_group_id)
  THEN
    RAISE EXCEPTION 'staff_payment_link_creation_untruthful:%', v_group;
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  v_group := public.issue_4188_create_staff_stay_group(
    (v_quote->>'quoteId')::uuid,
    'staff-payment-link-group-4188',
    jsonb_build_object(
      'name', 'Link Guest',
      'email', 'link-4188@example.test',
      'phone', '+15555554189'
    ),
    'phone',
    (v_quote->>'version')::bigint,
    'link',
    decode(repeat('bc', 32), 'hex'),
    true,
    false,
    now() + interval '24 hours',
    '41880000-0000-4000-8000-000000000032'
  );
  PERFORM set_config('role', 'none', true);
  IF v_group->>'groupId' <> v_group_id::text
     OR NOT EXISTS (
       SELECT 1 FROM public.stay_staff_payment_links
       WHERE group_id = v_group_id
         AND token_hash = decode(repeat('bc', 32), 'hex')
         AND email_status = 'pending'
         AND sms_status = 'not_requested'
     )
     OR EXISTS (
       SELECT 1 FROM public.stay_staff_payment_links
       WHERE group_id = v_group_id
         AND token_hash = decode(repeat('ab', 32), 'hex')
     )
  THEN
    RAISE EXCEPTION 'staff_payment_link_retry_returned_stale_token:%', v_group;
  END IF;

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'service_role')::text,
    true
  );
  v_link := public.issue_4188_staff_payment_link_details(
    decode(repeat('bc', 32), 'hex')
  );
  IF v_link->>'groupId' <> v_group_id::text
     OR v_link ? 'guestEmail'
     OR v_link ? 'guestPhone'
     OR v_link ? 'token'
     OR v_link ? 'tokenHash'
  THEN
    RAISE EXCEPTION 'staff_payment_link_public_projection_unsafe:%', v_link;
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '41880000-0000-4000-8000-000000000002',
      'role', 'authenticated'
    )::text,
    true
  );
  v_rotated := public.issue_4188_rotate_staff_payment_link(
    v_group_id,
    decode(repeat('cd', 32), 'hex'),
    now() + interval '24 hours',
    false,
    true
  );
  PERFORM set_config('role', 'none', true);
  IF v_rotated#>>'{paymentLink,emailStatus}' <> 'not_requested'
     OR v_rotated#>>'{paymentLink,smsStatus}' <> 'pending'
     OR EXISTS (
       SELECT 1 FROM public.stay_staff_payment_links
       WHERE group_id = v_group_id
         AND token_hash = decode(repeat('ab', 32), 'hex')
     )
  THEN
    RAISE EXCEPTION 'staff_payment_link_rotation_failed:%', v_rotated;
  END IF;
  PERFORM set_config('role', 'authenticated', true);
  v_revoked := public.issue_4188_revoke_staff_payment_link(
    v_group_id, 'Guest changed plans'
  );
  PERFORM set_config('role', 'none', true);
  IF v_revoked->>'state' <> 'cancelled'
     OR v_revoked#>>'{paymentLink,revokedAt}' IS NULL
     OR EXISTS (
       SELECT 1 FROM public.stay_inventory_holds
       WHERE group_id = v_group_id AND state = 'active'
     )
  THEN
    RAISE EXCEPTION 'staff_payment_link_revoke_failed:%', v_revoked;
  END IF;
  PERFORM set_config('role', 'authenticated', true);
END;
$staff_payment_link$;

SELECT set_config(
  'request.jwt.claim.sub', '41880000-0000-4000-8000-000000000001', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '41880000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

DO $category_grant_denial$
DECLARE
  v_member_id uuid;
BEGIN
  SELECT id INTO STRICT v_member_id
  FROM public.brand_team_members
  WHERE brand_id = '41880000-0000-4000-9000-000000000010'
    AND user_id = '41880000-0000-4000-8000-000000000004';
  BEGIN
    PERFORM public.issue_4188_set_member_venue_grants(
      '41880000-0000-4000-9000-000000000010',
      v_member_id,
      jsonb_build_array(jsonb_build_object(
        'venueId', '41880000-0000-4000-9000-000000000011',
        'profile', 'restaurant_manager',
        'capabilities', jsonb_build_array('restaurant.manage_menu')
      ))
    );
    RAISE EXCEPTION 'restaurant_capability_was_assigned_to_stay';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_venue_grants' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.issue_4188_set_member_venue_grants(
      '41880000-0000-4000-9000-000000000010',
      v_member_id,
      '[]'::jsonb
    );
    RAISE EXCEPTION 'venue_staff_zero_grants_was_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_venue_grants' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.issue_4188_set_member_venue_grants(
      '41880000-0000-4000-9000-000000000010',
      v_member_id,
      jsonb_build_array(jsonb_build_object(
        'venueId', '41880000-0000-4000-9000-000000000011',
        'profile', 'custom',
        'capabilities', '[]'::jsonb
      ))
    );
    RAISE EXCEPTION 'venue_staff_empty_capability_grant_was_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_venue_grants' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.issue_4188_set_member_venue_grants(
      '41880000-0000-4000-9000-000000000010',
      v_member_id,
      jsonb_build_array(
        jsonb_build_object(
          'venueId', '41880000-0000-4000-9000-000000000011',
          'profile', 'front_desk',
          'capabilities', jsonb_build_array('stay.view_reservations')
        ),
        jsonb_build_object(
          'venueId', '41880000-0000-4000-9000-000000000011',
          'profile', 'front_desk',
          'capabilities', jsonb_build_array('stay.view_availability')
        )
      )
    );
    RAISE EXCEPTION 'venue_staff_duplicate_venue_grants_was_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_venue_grants' THEN RAISE; END IF;
  END;
END;
$category_grant_denial$;

SELECT set_config(
  'request.jwt.claim.sub', '41880000-0000-4000-8000-000000000004', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '41880000-0000-4000-8000-000000000004',
    'role', 'authenticated'
  )::text,
  true
);

DO $venue_scoped_access$
DECLARE
  v_access jsonb;
  v_details jsonb;
BEGIN
  IF public.biz_brand_effective_rank_for_caller(
    '41880000-0000-4000-9000-000000000010'
  ) <> 0 THEN
    RAISE EXCEPTION 'venue_staff_leaked_legacy_brand_rank';
  END IF;
  IF (
    SELECT count(*) FROM public.brands
    WHERE id = '41880000-0000-4000-9000-000000000010'
  ) <> 1 THEN
    RAISE EXCEPTION 'venue_staff_could_not_hydrate_assigned_brand';
  END IF;
  IF (
    SELECT count(*) FROM public.venue_listings
    WHERE brand_id = '41880000-0000-4000-9000-000000000010'
  ) <> 1 THEN
    RAISE EXCEPTION 'venue_staff_listing_scope_was_not_exactly_one';
  END IF;
  v_access := public.issue_4188_my_venue_access(
    '41880000-0000-4000-9000-000000000011'
  );
  IF v_access->>'scoped' <> 'true'
     OR NOT (v_access->'capabilities' ? 'stay.create_reservations')
  THEN
    RAISE EXCEPTION 'granted_venue_access_not_projected:%', v_access;
  END IF;
  v_details := public.issue_4188_staff_stay_details(
    '41880000-0000-4000-9000-000000000011'
  );
  IF v_details->>'venueId' <> '41880000-0000-4000-9000-000000000011' THEN
    RAISE EXCEPTION 'granted_venue_detail_denied:%', v_details;
  END IF;
  BEGIN
    PERFORM public.issue_4188_staff_stay_details(
      '41880000-0000-4000-9000-000000000016'
    );
    RAISE EXCEPTION 'ungranted_same_brand_venue_was_visible';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;
END;
$venue_scoped_access$;

SELECT set_config(
  'request.jwt.claim.sub', '41880000-0000-4000-8000-000000000002', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '41880000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);

SELECT set_config('role', 'none', true);
DO $source_truth_is_immutable$
BEGIN
  BEGIN
    UPDATE public.stay_reservation_groups
    SET booking_source = 'instagram'
    WHERE idempotency_key = 'staff-front-desk-group-4188';
    RAISE EXCEPTION 'property_booking_source_was_mutable';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'stay_group_source_immutable' THEN RAISE; END IF;
  END;
END;
$source_truth_is_immutable$;

UPDATE public.brand_team_members
SET permissions_override = '{"stay.create": false}'::jsonb
WHERE brand_id = '41880000-0000-4000-9000-000000000010'
  AND user_id = '41880000-0000-4000-8000-000000000002';
SELECT set_config('role', 'authenticated', true);

DO $create_permission_denial$
DECLARE
  v_list jsonb;
  v_quote_id uuid;
BEGIN
  v_list := public.issue_1426_list_staff_stay_reservations(
    '41880000-0000-4000-9000-000000000011'
  );
  IF v_list#>>'{permissions,canCreate}' <> 'false' THEN
    RAISE EXCEPTION 'stay_create_deny_not_projected:%', v_list;
  END IF;
  PERFORM set_config('role', 'none', true);
  SELECT quote_id INTO STRICT v_quote_id
  FROM public.stay_reservation_groups
  WHERE idempotency_key = 'staff-front-desk-group-4188';
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.issue_4188_create_staff_stay_group(
      v_quote_id,
      'staff-front-desk-denied-4188',
      jsonb_build_object(
        'name', 'Denied Guest', 'email', 'denied-4188@example.test'
      ),
      'phone',
      1,
      'property',
      NULL,
      false,
      false,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'stay_create_deny_was_not_enforced';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;
END;
$create_permission_denial$;

SELECT set_config('role', 'none', true);
SELECT set_config(
  'request.jwt.claim.sub', '41880000-0000-4000-8000-000000000003', true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '41880000-0000-4000-8000-000000000003',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $cross_brand_denial$
DECLARE
  v_quote_id uuid;
BEGIN
  BEGIN
    PERFORM public.issue_4188_staff_stay_details(
      '41880000-0000-4000-9000-000000000011'
    );
    RAISE EXCEPTION 'cross_brand_staff_detail_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;

  PERFORM set_config('role', 'none', true);
  SELECT quote_id INTO STRICT v_quote_id
  FROM public.stay_reservation_groups
  WHERE idempotency_key = 'staff-front-desk-group-4188';
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.issue_4188_create_staff_stay_group(
      v_quote_id,
      'outsider-front-desk-group-4188',
      jsonb_build_object(
        'name', 'Outsider Guest', 'email', 'outsider-guest@example.test'
      ),
      'walk_in',
      1,
      'property',
      NULL,
      false,
      false,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'cross_brand_staff_create_was_allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'forbidden' THEN RAISE; END IF;
  END;
END;
$cross_brand_denial$;

ROLLBACK;
