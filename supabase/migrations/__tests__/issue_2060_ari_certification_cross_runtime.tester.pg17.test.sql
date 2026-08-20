-- [TEST-MOD-APPROVED #2060]
-- Independent cross-runtime certification attack. PostgreSQL and the published
-- JavaScript validator must hash the same canonical evidence bytes, and a
-- native runtime declaration must contain the exact artifact/runtime identity
-- needed to correlate physical proof to the certified release.
BEGIN;

DO $test$
DECLARE
  v_js_digest constant text := '1ab3c47beeca068a6c76a2b458748568d261ad61380cb4dc878a75f299c57a54';
  v_sql_digest text;
  v_incomplete_native_accepted boolean := false;
BEGIN
  v_sql_digest := private.ari_cert_digest_v1('scenario-evidence', ARRAY[
    '123e4567-e89b-42d3-a456-426614174000',
    'ari.brand.create',
    'confirm_one_side_effect',
    'business_web',
    'owner_tenant',
    'owner',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    'business_web',
    'web-1',
    'brands:one',
    'passed',
    '00000000-0000-4000-8000-000000000005',
    repeat('d', 64),
    '00000000-0000-4000-8000-000000000006'
  ]);

  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.ari_cert_begin_run(
      repeat('a', 40),
      '{"agent_chat":"v500","agent_confirm_action":"v501"}'::jsonb,
      'business-web-1',
      '[{"surface":"business_ios_simulator"},{"surface":"business_ios_physical"},{"surface":"business_android"}]'::jsonb,
      '{}'::jsonb
    );
    v_incomplete_native_accepted := true;
  EXCEPTION WHEN invalid_parameter_value OR check_violation OR not_null_violation THEN
    v_incomplete_native_accepted := false;
  END;
  RESET ROLE;

  IF v_sql_digest <> v_js_digest OR v_incomplete_native_accepted THEN
    RAISE EXCEPTION
      'issue_2060_cross_runtime_certification_not_correlated: js_digest=%, sql_digest=%, incomplete_native_accepted=%',
      v_js_digest, v_sql_digest, v_incomplete_native_accepted;
  END IF;
END;
$test$;

ROLLBACK;
