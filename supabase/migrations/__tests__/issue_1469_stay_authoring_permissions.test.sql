\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_capability text;
  v_snapshot text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1387_has_brand_capability(uuid,uuid,text)'::regprocedure
  ) INTO v_capability;
  SELECT pg_get_functiondef(
    'public.issue_1387_stay_inventory_snapshot(uuid)'::regprocedure
  ) INTO v_snapshot;

  IF v_capability NOT LIKE '%stay.%'
     OR v_capability NOT LIKE '%permissions_override%'
     OR v_capability NOT LIKE '%v_base AND%'
     OR v_snapshot NOT LIKE '%canManageInventory%'
     OR v_snapshot NOT LIKE '%canManageFinance%' THEN
    RAISE EXCEPTION 'issue_1469_capability_projection_contract_missing';
  END IF;
END;
$catalog$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES
  ('00000000-1469-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-1469@example.test', now(), now()),
  ('00000000-1469-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'event-1469@example.test', now(), now()),
  ('00000000-1469-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'finance-1469@example.test', now(), now()),
  ('00000000-1469-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marketing-1469@example.test', now(), now()),
  ('00000000-1469-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'denied-1469@example.test', now(), now());

INSERT INTO public.creator_accounts (id, created_at) VALUES
  ('00000000-1469-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency
) VALUES (
  '00000000-1469-4000-8000-000000000011',
  '00000000-1469-4000-8000-000000000001',
  'Issue 1469 Stay Brand',
  'issue-1469-stay-brand',
  'USD'
);

INSERT INTO public.brand_team_members (
  brand_id, user_id, role, accepted_at, permissions_override
) VALUES
  ('00000000-1469-4000-8000-000000000011', '00000000-1469-4000-8000-000000000002', 'event_manager', now(), '{}'::jsonb),
  ('00000000-1469-4000-8000-000000000011', '00000000-1469-4000-8000-000000000003', 'finance_manager', now(), '{}'::jsonb),
  ('00000000-1469-4000-8000-000000000011', '00000000-1469-4000-8000-000000000004', 'marketing_manager', now(), '{}'::jsonb),
  ('00000000-1469-4000-8000-000000000011', '00000000-1469-4000-8000-000000000005', 'event_manager', now(), '{"stay.inventory":false}'::jsonb);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1469-4000-8000-000000000012',
  '00000000-1469-4000-8000-000000000011',
  'issue1469stay',
  'Issue 1469 Stay',
  25.7907,
  -80.1300,
  'stay',
  'verified'
);

CREATE TEMP TABLE issue_1469_offering (id uuid NOT NULL);
GRANT INSERT, SELECT ON issue_1469_offering TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1469-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1469-4000-8000-000000000002","role":"authenticated"}', true);

DO $event_manager$
DECLARE
  v_snapshot jsonb;
  v_result jsonb;
  v_offering_id uuid;
  v_before integer;
BEGIN
  IF NOT public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000011',
    '00000000-1469-4000-8000-000000000002',
    'inventory'
  ) OR public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000011',
    '00000000-1469-4000-8000-000000000002',
    'finance'
  ) THEN
    RAISE EXCEPTION 'issue_1469_event_manager_capabilities_wrong';
  END IF;

  v_snapshot := public.issue_1387_stay_inventory_snapshot(
    '00000000-1469-4000-8000-000000000012'
  );
  IF (v_snapshot #>> '{permissions,canManageInventory}')::boolean IS NOT TRUE
     OR (v_snapshot #>> '{permissions,canManageFinance}')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'issue_1469_event_manager_projection_wrong';
  END IF;

  v_result := public.biz_manage_stay_inventory(
    'bulk_create',
    '00000000-1469-4000-8000-000000000012',
    '{
      "idempotencyKey":"issue-1469-event-unpriced",
      "items":[{
        "kind":"room",
        "name":"Permission-safe room",
        "description":"Created without money by inventory staff.",
        "confirmationMode":"request",
        "inventoryBasis":"pooled_units",
        "unitNamingMode":"interchangeable",
        "quantity":1,
        "maxGuests":2,
        "maxAdults":2,
        "maxChildren":0
      }]
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );
  IF (v_result #>> '{job,succeeded_count}')::integer <> 1 THEN
    RAISE EXCEPTION 'issue_1469_event_manager_unpriced_bulk_failed';
  END IF;
  SELECT id INTO v_offering_id
  FROM public.stay_offerings
  WHERE venue_id = '00000000-1469-4000-8000-000000000012'
    AND name = 'Permission-safe room';
  INSERT INTO issue_1469_offering (id) VALUES (v_offering_id);

  SELECT count(*) INTO v_before
  FROM public.stay_offerings
  WHERE venue_id = '00000000-1469-4000-8000-000000000012';
  BEGIN
    PERFORM public.biz_manage_stay_inventory(
      'bulk_create',
      '00000000-1469-4000-8000-000000000012',
      '{
        "idempotencyKey":"issue-1469-event-priced",
        "items":[{
          "kind":"room",
          "name":"Forbidden priced room",
          "confirmationMode":"request",
          "inventoryBasis":"pooled_units",
          "quantity":1,
          "maxGuests":2,
          "maxAdults":2,
          "maxChildren":0,
          "price":{"amountMinor":25000,"currencyCode":"USD"}
        }]
      }'::jsonb,
      NULL,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1469_event_manager_money_widened';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT count(*) FROM public.stay_offerings
      WHERE venue_id = '00000000-1469-4000-8000-000000000012') <> v_before THEN
    RAISE EXCEPTION 'issue_1469_forbidden_combined_write_left_rows';
  END IF;
END;
$event_manager$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1469-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1469-4000-8000-000000000003","role":"authenticated"}', true);

DO $finance_manager$
DECLARE
  v_snapshot jsonb;
  v_offering_id uuid;
  v_version bigint;
BEGIN
  v_snapshot := public.issue_1387_stay_inventory_snapshot(
    '00000000-1469-4000-8000-000000000012'
  );
  IF (v_snapshot #>> '{permissions,canManageInventory}')::boolean IS NOT FALSE
     OR (v_snapshot #>> '{permissions,canManageFinance}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1469_finance_projection_wrong';
  END IF;
  SELECT id INTO v_offering_id FROM issue_1469_offering;
  SELECT version INTO v_version
  FROM public.stay_offerings WHERE id = v_offering_id;
  PERFORM public.biz_manage_stay_inventory(
    'set_price',
    '00000000-1469-4000-8000-000000000012',
    jsonb_build_object(
      'offeringId', v_offering_id,
      'amountMinor', 25000,
      'currencyCode', 'USD'
    ),
    v_version,
    gen_random_uuid()
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_price_versions
    WHERE offering_id = v_offering_id
      AND amount_minor = 25000
      AND currency_code = 'USD'
      AND effective_to IS NULL
  ) THEN
    RAISE EXCEPTION 'issue_1469_finance_price_write_failed';
  END IF;
END;
$finance_manager$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1469-4000-8000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1469-4000-8000-000000000005","role":"authenticated"}', true);

DO $explicit_deny$
BEGIN
  IF public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000011',
    '00000000-1469-4000-8000-000000000005',
    'inventory'
  ) THEN
    RAISE EXCEPTION 'issue_1469_explicit_deny_ignored';
  END IF;
END;
$explicit_deny$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1469-4000-8000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1469-4000-8000-000000000004","role":"authenticated"}', true);

DO $lower_role$
BEGIN
  IF public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000011',
    '00000000-1469-4000-8000-000000000004',
    'read'
  ) OR public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000011',
    '00000000-1469-4000-8000-000000000004',
    'inventory'
  ) OR public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000011',
    '00000000-1469-4000-8000-000000000004',
    'finance'
  ) THEN
    RAISE EXCEPTION 'issue_1469_lower_role_gained_stay_authority';
  END IF;
  BEGIN
    PERFORM public.issue_1387_stay_inventory_snapshot(
      '00000000-1469-4000-8000-000000000012'
    );
    RAISE EXCEPTION 'issue_1469_lower_role_read_snapshot';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$lower_role$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1469-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1469-4000-8000-000000000001","role":"authenticated"}', true);

DO $account_owner$
DECLARE
  v_snapshot jsonb;
  v_result jsonb;
BEGIN
  v_snapshot := public.issue_1387_stay_inventory_snapshot(
    '00000000-1469-4000-8000-000000000012'
  );
  IF (v_snapshot #>> '{permissions,canManageInventory}')::boolean IS NOT TRUE
     OR (v_snapshot #>> '{permissions,canManageFinance}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1469_owner_projection_wrong';
  END IF;
  v_result := public.biz_manage_stay_inventory(
    'bulk_create',
    '00000000-1469-4000-8000-000000000012',
    '{
      "idempotencyKey":"issue-1469-owner-priced",
      "items":[{
        "kind":"place",
        "name":"Owner priced cabana",
        "description":"Combined authority remains available to the owner.",
        "confirmationMode":"instant",
        "inventoryBasis":"exclusive_units",
        "quantity":1,
        "maxGuests":4,
        "placePricingBasis":"per_booking",
        "price":{"amountMinor":15000,"currencyCode":"USD"}
      }]
    }'::jsonb,
    NULL,
    gen_random_uuid()
  );
  IF (v_result #>> '{job,succeeded_count}')::integer <> 1 THEN
    RAISE EXCEPTION 'issue_1469_owner_combined_write_failed';
  END IF;
END;
$account_owner$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1469-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-1469-4000-8000-000000000002","role":"authenticated"}', true);

DO $cross_brand$
BEGIN
  IF public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000099',
    '00000000-1469-4000-8000-000000000002',
    'inventory'
  ) OR public.issue_1387_has_brand_capability(
    '00000000-1469-4000-8000-000000000099',
    '00000000-1469-4000-8000-000000000002',
    'finance'
  ) THEN
    RAISE EXCEPTION 'issue_1469_cross_brand_capability_escape';
  END IF;
END;
$cross_brand$;

RESET ROLE;
ROLLBACK;
