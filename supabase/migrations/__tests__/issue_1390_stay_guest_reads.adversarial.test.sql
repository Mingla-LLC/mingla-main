\set ON_ERROR_STOP on
BEGIN;

DO $leakage$
DECLARE
  v_public text;
  v_mine text;
BEGIN
  SELECT pg_get_functiondef(
    'public.pg_public_stay_details(uuid)'::regprocedure
  ) INTO v_public;
  SELECT pg_get_functiondef(
    'public.pg_my_stay_reservation_groups()'::regprocedure
  ) INTO v_mine;
  IF v_public LIKE '%storage_object_id%'
     OR v_public LIKE '%created_by%'
     OR v_public LIKE '%updated_by%'
     OR v_public LIKE '%stay_inventory_hold%'
     OR v_public LIKE '%stay_inventory_commitment%'
     OR v_public LIKE '%stay_units%'
     OR v_public LIKE '%brand_currency_reconciliation%'
     OR v_mine LIKE '%issue_1387_has_brand_capability%'
     OR v_mine LIKE '%is_admin_user%' THEN
    RAISE EXCEPTION 'GA-1 FAIL: internal data or non-owner itinerary path leaked';
  END IF;
  RAISE NOTICE 'GA-1 PASS: public payload is narrow and itinerary is guest-only';
END;
$leakage$;

DO $table_acl$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stay_settings',
    'stay_offerings',
    'stay_offering_media',
    'stay_price_versions',
    'stay_fee_versions',
    'stay_policy_versions',
    'stay_room_nights',
    'stay_place_windows',
    'stay_reservation_groups',
    'stay_reservation_lines'
  ]
  LOOP
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'GA-2 FAIL: anon direct table read leaked on %', v_table;
    END IF;
  END LOOP;
  RAISE NOTICE 'GA-2 PASS: anon reads only the definer projection';
END;
$table_acl$;

DO $auth_null$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.pg_my_stay_reservation_groups();
    RAISE EXCEPTION 'GA-3 FAIL: null-auth itinerary read succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%unauthorized%' THEN
        RAISE;
      END IF;
  END;
  RAISE NOTICE 'GA-3 PASS: itinerary read fails closed without auth.uid';
END;
$auth_null$;

ROLLBACK;
