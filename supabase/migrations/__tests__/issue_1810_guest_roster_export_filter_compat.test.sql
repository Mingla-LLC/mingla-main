\set ON_ERROR_STOP on

DO $test$
DECLARE
  v_filter text;
  v_allowed text[] := ARRAY[
    'all','rsvpd','ticketed','not_yet','suppressed',
    'needs_attention','no_response','confirmed','checked_in','not_checked_in',
    'delivery_failed','removed','going','maybe','awaiting_approval','waitlisted',
    'declined','denied','bought_ticket','refunded','cancelled','transferred'
  ];
  v_definition text;
BEGIN
  -- Every allowed filter must pass validation. With no actor/event fixture the
  -- function then reaches its authorization boundary and fails 42501.
  FOREACH v_filter IN ARRAY v_allowed LOOP
    BEGIN
      PERFORM public.biz_export_brand_people(
        'offering_guest_roster',
        '18100000-0000-4000-8000-000000000001'::uuid,
        v_filter,NULL,'action_priority','{}'::jsonb,
        gen_random_uuid()
      );
      RAISE EXCEPTION 'issue_1810_expected_auth_failure:%',v_filter;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;

  BEGIN
    PERFORM public.biz_export_brand_people(
      'offering_guest_roster','18100000-0000-4000-8000-000000000001'::uuid,
      'invented_filter',NULL,'action_priority','{}'::jsonb,gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1810_unknown_filter_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  BEGIN
    PERFORM public.biz_export_brand_people(
      'brand_book',NULL,'no_response',NULL,'action_priority','{}'::jsonb,gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1810_roster_filter_leaked_to_brand_book';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  BEGIN
    PERFORM public.biz_export_brand_people(
      'offering_guest_roster','18100000-0000-4000-8000-000000000001'::uuid,
      'all',NULL,'action_priority','{"rawWhere":"true"}'::jsonb,gen_random_uuid()
    );
    RAISE EXCEPTION 'issue_1810_arbitrary_snapshot_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  SELECT pg_get_functiondef('public.biz_offering_guest_roster_export_rows(uuid)'::regprocedure)
    INTO v_definition;
  IF position('export_provider_not_ready' IN v_definition)=0 THEN
    RAISE EXCEPTION 'issue_1810_provider_hook_was_implemented_upstream';
  END IF;

  IF has_function_privilege('anon','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.biz_export_brand_people(text,uuid,text,text,text,jsonb,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_offering_guest_roster_export_rows(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.biz_offering_guest_roster_export_rows(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'issue_1810_export_grant_boundary_failed';
  END IF;
END;
$test$;

SELECT 'issue_1810_guest_roster_export_filter_compat: PASS' AS result;
