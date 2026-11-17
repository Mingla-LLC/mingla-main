-- #4420 — the Stay pay link details carry the brand's PUBLIC slug and theme
-- (color, font, animation, gradient) so /stay/pay/{token} wears the host's
-- colours; nothing private is added and every #4188 guard still holds.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

UPDATE public.feature_flags
SET is_enabled = true
WHERE flag_key IN ('STAY_RESERVE_READS', 'STAY_RESERVE_WRITES');
UPDATE public.feature_flags
SET is_enabled = false
WHERE flag_key IN ('STAY_NOTIFICATIONS', 'STAY_PUBLIC_PAGES');

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

-- The brand's public theme (what business_public_brands_view shows anon), plus
-- private contact fields that must never reach the pay link.
UPDATE public.brands
SET theme_color = '#7c3aed',
    theme_font = 'playfair_display',
    theme_animation = 'sparkles',
    theme_gradient = '#7c3aed,#f97316',
    contact_email = 'private-4420@example.test',
    contact_phone = '+15555554420'
WHERE id = '41880000-0000-4000-9000-000000000010';

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

DO $pay_link_theme$
DECLARE
  v_check_in date := (now() AT TIME ZONE 'UTC')::date + 30;
  v_quote jsonb;
  v_group jsonb;
  v_link jsonb;
  v_failed boolean;
BEGIN
  v_quote := public.biz_manage_stay_reservation(
    'quote',
    jsonb_build_object(
      'venueId', '41880000-0000-4000-9000-000000000011',
      'idempotencyKey', 'issue-4420-pay-link-theme-quote',
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
    '44200000-0000-4000-8000-000000000030'
  );
  v_group := public.issue_4188_create_staff_stay_group(
    (v_quote->>'quoteId')::uuid,
    'issue-4420-pay-link-theme-group',
    jsonb_build_object(
      'name', 'Theme Guest',
      'email', 'theme-4420@example.test',
      'phone', '+15555554421'
    ),
    'phone',
    (v_quote->>'version')::bigint,
    'link',
    decode(repeat('cd', 32), 'hex'),
    true,
    false,
    now() + interval '24 hours',
    '44200000-0000-4000-8000-000000000031'
  );

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config(
    'request.jwt.claims', json_build_object('role', 'service_role')::text, true
  );
  v_link := public.issue_4188_staff_payment_link_details(
    decode(repeat('cd', 32), 'hex')
  );

  -- Existing #4188 keys are kept.
  IF v_link->>'groupId' <> v_group->>'groupId'
     OR v_link->>'brandName' <> 'Issue 4188 Stay Brand'
     OR v_link->>'venueName' <> 'Staff Stay 4188'
     OR NOT (v_link ? 'publicReference' AND v_link ? 'version'
             AND v_link ? 'totalMinor' AND v_link ? 'expiresAt'
             AND v_link ? 'lines' AND v_link ? 'paid')
  THEN
    RAISE EXCEPTION 'pay_link_existing_keys_dropped:%', v_link;
  END IF;

  -- The brand's public slug and exactly the four public theme fields.
  IF v_link->>'brandSlug' IS DISTINCT FROM 'issue-4188-stay-brand'
     OR v_link->'brandTheme' IS DISTINCT FROM jsonb_build_object(
       'color', '#7c3aed',
       'font', 'playfair_display',
       'animation', 'sparkles',
       'gradient', '#7c3aed,#f97316'
     )
  THEN
    RAISE EXCEPTION 'pay_link_brand_theme_missing:%', v_link;
  END IF;

  -- Nothing private rides along.
  IF v_link::text LIKE '%private-4420@example.test%'
     OR v_link::text LIKE '%+15555554420%'
     OR v_link::text LIKE '%ACCT_issue4188%'
     OR v_link::text LIKE '%theme-4420@example.test%'
     OR v_link::text LIKE '%41880000-0000-4000-8000-000000000001%'
     OR v_link ? 'guestEmail' OR v_link ? 'guestPhone'
     OR v_link ? 'token' OR v_link ? 'tokenHash'
  THEN
    RAISE EXCEPTION 'pay_link_projection_leaks_private_fields:%', v_link;
  END IF;

  -- A brand with no theme returns nulls, never a guessed colour.
  UPDATE public.brands
  SET theme_color = NULL, theme_font = NULL,
      theme_animation = NULL, theme_gradient = NULL
  WHERE id = '41880000-0000-4000-9000-000000000010';
  v_link := public.issue_4188_staff_payment_link_details(
    decode(repeat('cd', 32), 'hex')
  );
  IF v_link->'brandTheme'->>'color' IS NOT NULL
     OR v_link->'brandTheme'->>'font' IS NOT NULL
  THEN
    RAISE EXCEPTION 'pay_link_theme_fabricated:%', v_link;
  END IF;

  -- The expired guard is unchanged.
  UPDATE public.stay_staff_payment_links
  SET created_at = now() - interval '2 hours',
      expires_at = now() - interval '1 minute'
  WHERE token_hash = decode(repeat('cd', 32), 'hex');
  v_failed := false;
  BEGIN
    PERFORM public.issue_4188_staff_payment_link_details(
      decode(repeat('cd', 32), 'hex')
    );
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    v_failed := SQLERRM = 'stay_payment_link_expired';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'pay_link_expired_guard_lost';
  END IF;
  PERFORM set_config('role', 'none', true);
END;
$pay_link_theme$;

-- Guests and signed-in users still cannot call the lookup directly.
DO $grants$
BEGIN
  IF has_function_privilege('anon', 'public.issue_4188_staff_payment_link_details(bytea)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4188_staff_payment_link_details(bytea)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_4188_staff_payment_link_details(bytea)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'pay_link_details_grants_drifted';
  END IF;
END;
$grants$;

ROLLBACK;
