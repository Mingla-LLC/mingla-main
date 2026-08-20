-- #2060 implementor proof: service_role can only write bounded evidence via
-- the server-owned RPCs. This transaction leaves zero certification residue.
BEGIN;

DO $test$
DECLARE
  v_run_id uuid;
  v_direct_insert_rejected boolean := false;
  v_bad_capability_rejected boolean := false;
  v_record jsonb;
  v_operation_id uuid := gen_random_uuid();
  v_request_id uuid := gen_random_uuid();
  v_client_turn_id uuid := gen_random_uuid();
  v_execution_id uuid := gen_random_uuid();
  v_receipt_id uuid := gen_random_uuid();
  v_telemetry_event_id uuid := gen_random_uuid();
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
    INSERT INTO public.ari_cert_evidence (
      run_id, capability_id, surface, tenant_case, role_case, scenario,
      outcome, safe_evidence, evidence_digest
    ) VALUES (
      v_run_id, 'ari.brand.create', 'business_web', 'owner_tenant', 'owner',
      'confirm_one_side_effect', 'passed', '{}'::jsonb, repeat('c', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_direct_insert_rejected := true;
  END;

  BEGIN
    PERFORM public.ari_cert_record_evidence(
      v_run_id, 'ari.fake.capability', 'business_web', 'owner_tenant', 'owner',
      'confirm_one_side_effect', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
      gen_random_uuid(), 'canonical:fixture', 'business_web', 'business-web-1',
      gen_random_uuid(), repeat('d', 64), gen_random_uuid()
    );
  EXCEPTION WHEN invalid_parameter_value THEN
    v_bad_capability_rejected := true;
  END;

  -- Only a database-owner canonical adapter may establish this row. The
  -- service role under test has no grant or public RPC that can fabricate it.
  RESET ROLE;
  INSERT INTO private.ari_cert_verified_provenance (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    operation_id, request_id, client_turn_id, execution_id,
    canonical_readback_reference, artifact_type, artifact_id, receipt_id,
    readback_digest, telemetry_event_id, canonical_source
  ) VALUES (
    v_run_id, 'ari.brand.create', 'business_web', 'owner_tenant', 'owner',
    'confirm_one_side_effect', v_operation_id, v_request_id, v_client_turn_id,
    v_execution_id, 'brands:fixture:v1', 'business_web', 'business-web-1',
    v_receipt_id, repeat('d', 64), v_telemetry_event_id,
    'issue_2060_pg17_canonical_fixture'
  );
  SET LOCAL ROLE service_role;

  v_record := public.ari_cert_record_evidence(
    v_run_id, 'ari.brand.create', 'business_web', 'owner_tenant', 'owner',
    'confirm_one_side_effect', v_operation_id, v_request_id, v_client_turn_id,
    v_execution_id, 'brands:fixture:v1', 'business_web', 'business-web-1',
    v_receipt_id, repeat('d', 64), v_telemetry_event_id
  );

  IF NOT v_direct_insert_rejected OR NOT v_bad_capability_rejected
     OR (v_record ->> 'evidence_digest') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'issue_2060_server_owned_evidence_failed';
  END IF;
  RESET ROLE;
END;
$test$;

ROLLBACK;
