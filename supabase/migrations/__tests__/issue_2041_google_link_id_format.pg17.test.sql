BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_result jsonb;
  v_rejected boolean := false;
BEGIN
  INSERT INTO auth.users(id,email)
  VALUES(v_actor,'issue-2041-admin@example.com');
  INSERT INTO public.admin_users(email,role,status)
  VALUES('issue-2041-admin@example.com','admin','active');

  SELECT public.set_ad_app_safe_binding(jsonb_build_object(
    'app_key','business','os','android','provider','google',
    'provider_contract_kind','app_link',
    'provider_app_id','com.sethogieva.minglabusiness',
    'provider_measurement_id','66CB20600C7FDA957E511684502DFFE3',
    'actor',v_actor::text,
    'reason','Record the exact Google Ads hexadecimal Link ID.',
    'expected_current_version',1,
    'idempotency_key','20412041-2041-4041-8041-204120412041'
  )) INTO v_result;

  IF v_result->>'provider_measurement_id'<>'66CB20600C7FDA957E511684502DFFE3'
     OR (v_result->>'binding_version')::bigint<>2 THEN
    RAISE EXCEPTION 'hexadecimal Google Link ID was not persisted exactly: %',v_result;
  END IF;

  BEGIN
    PERFORM public.set_ad_app_safe_binding(jsonb_build_object(
      'app_key','business','os','ios','provider','google',
      'provider_contract_kind','app_link',
      'provider_app_id','6768737367',
      'provider_measurement_id','NOT-A-GOOGLE-LINK-ID',
      'actor',v_actor::text,
      'reason','Reject a malformed Google Link ID.',
      'expected_current_version',1,
      'idempotency_key','20412041-2041-4041-8041-204120412042'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%invalid_google_link_id%';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'malformed Google Link ID did not fail closed';
  END IF;
END;
$test$;

ROLLBACK;
