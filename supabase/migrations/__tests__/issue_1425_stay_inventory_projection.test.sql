\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.issue_1387_stay_inventory_snapshot(uuid)'::regprocedure
  ) INTO v_definition;

  IF v_definition NOT LIKE '%''roomNights''%'
     OR v_definition NOT LIKE '%public.stay_room_nights%'
     OR v_definition NOT LIKE '%''placeScheduleRules''%'
     OR v_definition NOT LIKE '%public.stay_place_schedule_rules%'
     OR v_definition NOT LIKE '%''placeWindows''%'
     OR v_definition NOT LIKE '%public.stay_place_windows%'
     OR v_definition NOT LIKE '%''nextAvailability''%'
     OR v_definition NOT LIKE '%''hasOpenAvailability''%'
     OR v_definition LIKE '%night.id%' THEN
    RAISE EXCEPTION 'issue_1425_inventory_projection_incomplete';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.issue_1387_stay_inventory_snapshot(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1425_snapshot_anon_execute_regression';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.issue_1387_stay_inventory_snapshot(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1425_snapshot_authenticated_grant_missing';
  END IF;

  IF v_definition LIKE '%venue_tables%'
     OR v_definition LIKE '%venue_availability_slots%'
     OR v_definition LIKE '%venue_menu_%' THEN
    RAISE EXCEPTION 'issue_1425_restaurant_contract_contamination';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, created_at, updated_at
) VALUES (
  '00000000-1425-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'owner-1425@example.test',
  now(),
  now()
);

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1425-4000-8000-000000000001', now());

INSERT INTO public.brands (
  id, account_id, name, slug, default_currency,
  paystack_subaccount_code, created_at, updated_at
) VALUES (
  '00000000-1425-4000-8000-000000000002',
  '00000000-1425-4000-8000-000000000001',
  'Issue 1425 Stay Brand',
  'issue-1425-stay-brand',
  'USD',
  'ACCT_issue1425',
  now(),
  now()
);

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1425-4000-8000-000000000004',
  '00000000-1425-4000-8000-000000000002',
  'issue1425stay',
  'Issue 1425 Stay',
  6.45,
  3.47,
  'stay',
  'verified'
);

INSERT INTO public.stay_settings (venue_id, brand_id, timezone)
VALUES (
  '00000000-1425-4000-8000-000000000004',
  '00000000-1425-4000-8000-000000000002',
  'UTC'
);

INSERT INTO public.stay_offerings (
  id, venue_id, brand_id, kind, name, inventory_basis,
  quantity, min_guests, max_guests, max_adults, max_children
) VALUES (
  '00000000-1425-4000-8000-000000000005',
  '00000000-1425-4000-8000-000000000004',
  '00000000-1425-4000-8000-000000000002',
  'room',
  'Projection room',
  'pooled_units',
  1,
  1,
  2,
  2,
  0
);

INSERT INTO public.stay_room_nights (
  offering_id, local_date, brand_id, venue_id, sellable_quantity
) VALUES (
  '00000000-1425-4000-8000-000000000005',
  current_date + 2,
  '00000000-1425-4000-8000-000000000002',
  '00000000-1425-4000-8000-000000000004',
  1
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-1425-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-1425-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);
SELECT set_config('role', 'authenticated', true);

DO $$
DECLARE
  v_snapshot jsonb;
  v_room jsonb;
BEGIN
  v_snapshot := public.issue_1387_stay_inventory_snapshot(
    '00000000-1425-4000-8000-000000000004'
  );
  v_room := v_snapshot->'offerings'->0;

  IF jsonb_array_length(v_room->'roomNights') <> 1
     OR (v_room->>'nextAvailability')::date <> current_date + 2
     OR (v_room->>'hasOpenAvailability')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'issue_1425_room_night_runtime_projection_failed';
  END IF;
END;
$$;

RESET ROLE;

SELECT 'issue_1425_stay_inventory_projection_passed' AS result;

ROLLBACK;
