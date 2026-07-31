\set ON_ERROR_STOP on

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
     OR v_definition NOT LIKE '%''hasOpenAvailability''%' THEN
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

SELECT 'issue_1425_stay_inventory_projection_passed' AS result;
