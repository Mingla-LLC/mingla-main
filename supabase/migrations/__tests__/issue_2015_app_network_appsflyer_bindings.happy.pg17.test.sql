BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_result jsonb;
  v_forbidden boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_config
    WHERE key='enable_native_app_campaign_creation' AND value='false'::jsonb
  ) THEN RAISE EXCEPTION 'native creation is not default off'; END IF;
  IF has_function_privilege('authenticated','public.set_ad_app_safe_binding(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can mutate safe bindings';
  END IF;
  IF has_function_privilege('authenticated','public.can_create_native_app_campaign(text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can query native creation authority';
  END IF;
  IF NOT has_table_privilege('authenticated','public.ad_app_measurement_configurations','SELECT') OR
     has_table_privilege('authenticated','public.ad_app_measurement_configurations','UPDATE') THEN
    RAISE EXCEPTION 'measurement RLS/grants are not read-only';
  END IF;
  IF NOT has_table_privilege('authenticated','public.ad_app_acquisition_canaries','SELECT') OR
     has_table_privilege('authenticated','public.ad_app_acquisition_canaries','UPDATE') THEN
    RAISE EXCEPTION 'canary RLS/grants are not read-only';
  END IF;

  INSERT INTO auth.users(id,email) VALUES(v_actor,'issue-2015-admin@example.com');
  INSERT INTO public.admin_users(email,role,status)
  VALUES('issue-2015-admin@example.com','admin','active');
  SELECT public.set_ad_app_safe_binding(jsonb_build_object(
    'app_key','business','os','android','provider','tiktok',
    'provider_contract_kind','mobile_asset',
    'provider_app_id','7659053200868786183',
    'provider_measurement_id','7659053200868769799',
    'actor',v_actor::text,
    'reason','Record provider-authoritative identifiers.',
    'expected_current_version',1,
    'idempotency_key','12345678-1234-4123-8123-123456789abc'
  )) INTO v_result;
  IF (v_result->>'binding_version')::bigint<>2 OR (v_result->>'idempotent_replay')::boolean THEN
    RAISE EXCEPTION 'safe binding did not advance exactly once: %',v_result;
  END IF;
  SELECT public.set_ad_app_safe_binding(jsonb_build_object(
    'app_key','business','os','android','provider','tiktok',
    'provider_contract_kind','mobile_asset',
    'provider_app_id','7659053200868786183',
    'provider_measurement_id','7659053200868769799',
    'actor',v_actor::text,
    'reason','Record provider-authoritative identifiers.',
    'expected_current_version',1,
    'idempotency_key','12345678-1234-4123-8123-123456789abc'
  )) INTO v_result;
  IF NOT (v_result->>'idempotent_replay')::boolean OR
     (SELECT count(*) FROM public.ad_app_binding_audit WHERE idempotency_key='12345678-1234-4123-8123-123456789abc')<>1 THEN
    RAISE EXCEPTION 'idempotent replay created duplicate audit state';
  END IF;
  BEGIN
    PERFORM public.set_ad_app_safe_binding(jsonb_build_object(
      'app_key','business','os','android','provider','tiktok',
      'provider_contract_kind','app_link',
      'provider_app_id','7659053200868786183',
      'provider_measurement_id','7659053200868769799',
      'actor',v_actor::text,'reason','Reject the wrong contract kind.',
      'expected_current_version',2,
      'idempotency_key','22345678-1234-4123-8123-123456789abc'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_forbidden := SQLERRM LIKE '%provider_contract_mismatch%';
  END;
  IF NOT v_forbidden THEN RAISE EXCEPTION 'wrong provider contract did not fail closed'; END IF;
  IF public.can_create_native_app_campaign('business','android','tiktok') THEN
    RAISE EXCEPTION 'default-off native campaign authority returned true';
  END IF;
END;
$test$;

ROLLBACK;
