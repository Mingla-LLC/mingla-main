-- Independent #2060 provenance attack. A server-owned digest authenticates
-- bytes, not truth: the bounded writer must reject IDs with no canonical rows.
BEGIN;

DO $test$
DECLARE
  v_run_id uuid;
  v_fake_ids_rejected boolean := false;
BEGIN
  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(
    repeat('a', 40),
    '{"agent_chat":"v500","agent_confirm_action":"v501"}'::jsonb,
    'business-web-1',
    '[{"surface":"business_ios_simulator","artifact_id":"business_ios_simulator-1","runtime_version":"1.1.3","device":"iPhone simulator"},{"surface":"business_ios_physical","artifact_id":"business_ios_physical-1","runtime_version":"1.1.3","device":"Physical iPhone"},{"surface":"business_android","artifact_id":"business_android-1","runtime_version":"1.1.3","device":"Pixel 7"}]'::jsonb,
    '{}'::jsonb
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_web', 'business-web-1', repeat('a', 40), repeat('b', 64)
  );

  BEGIN
    PERFORM public.ari_cert_record_evidence(
      v_run_id,
      'ari.brand.create',
      'business_web',
      'owner_tenant',
      'owner',
      'confirm_one_side_effect',
      '00000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000002'::uuid,
      '00000000-0000-4000-8000-000000000003'::uuid,
      '00000000-0000-4000-8000-000000000004'::uuid,
      'fabricated:canonical:readback',
      'business_web',
      'business-web-1',
      '00000000-0000-4000-8000-000000000005'::uuid,
      repeat('d', 64),
      '00000000-0000-4000-8000-000000000006'::uuid
    );
  EXCEPTION WHEN invalid_parameter_value OR foreign_key_violation THEN
    v_fake_ids_rejected := true;
  END;

  IF NOT v_fake_ids_rejected THEN
    RAISE EXCEPTION
      'issue_2060_fake_provenance_was_server_signed: arbitrary operation/receipt/readback/telemetry IDs accepted';
  END IF;
  RESET ROLE;
END;
$test$;

ROLLBACK;
