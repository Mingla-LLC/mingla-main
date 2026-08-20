-- #2060 implementor happy path: PostgreSQL shares Node's fixed digest vector,
-- rejects malformed native tuples at the writer boundary, and revalidates
-- stored native identity at finalization. This transaction leaves no residue.
BEGIN;

DO $test$
DECLARE
  v_expected constant text := '1ab3c47beeca068a6c76a2b458748568d261ad61380cb4dc878a75f299c57a54';
  v_actual text;
  v_valid_native constant jsonb := '[
    {"surface":"business_ios_simulator","artifact_id":"business_ios_simulator-1","runtime_version":"1.1.3","device":"iPhone simulator"},
    {"surface":"business_ios_physical","artifact_id":"business_ios_physical-1","runtime_version":"1.1.3","device":"Physical iPhone"},
    {"surface":"business_android","artifact_id":"business_android-1","runtime_version":"1.1.3","device":"Pixel 7"}
  ]'::jsonb;
  v_attack jsonb;
  v_rejected boolean;
  v_run_id uuid;
BEGIN
  v_actual := private.ari_cert_digest_v1('scenario-evidence', ARRAY[
    '123e4567-e89b-42d3-a456-426614174000', 'ari.brand.create',
    'confirm_one_side_effect', 'business_web', 'owner_tenant', 'owner',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    'business_web', 'web-1', 'brands:one', 'passed',
    '00000000-0000-4000-8000-000000000005', repeat('d', 64),
    '00000000-0000-4000-8000-000000000006'
  ]);
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'issue_2060_pg_node_digest_mismatch: expected=%, actual=%',
      v_expected, v_actual;
  END IF;

  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(
    repeat('a', 40),
    '{"agent_chat":"v500","agent_confirm_action":"v501"}'::jsonb,
    'business-web-1', v_valid_native, '{}'::jsonb
  );
  RESET ROLE;

  FOREACH v_attack IN ARRAY ARRAY[
    '[{"surface":"business_ios_simulator"},{"surface":"business_ios_physical"},{"surface":"business_android"}]'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"","runtime_version":"1","device":"x"},{"surface":"business_ios_physical","artifact_id":"b","runtime_version":"1","device":"x"},{"surface":"business_android","artifact_id":"c","runtime_version":"1","device":"x"}]'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"a","runtime_version":"1","device":"x","extra":"closed"},{"surface":"business_ios_physical","artifact_id":"b","runtime_version":"1","device":"x"},{"surface":"business_android","artifact_id":"c","runtime_version":"1","device":"x"}]'::jsonb,
    '[{"surface":"business_ios_simulator","artifact_id":"a","runtime_version":"1","device":"x"},{"surface":"business_ios_simulator","artifact_id":"b","runtime_version":"1","device":"x"},{"surface":"business_android","artifact_id":"c","runtime_version":"1","device":"x"}]'::jsonb
  ] LOOP
    v_rejected := false;
    SET LOCAL ROLE service_role;
    BEGIN
      PERFORM public.ari_cert_begin_run(
        repeat('a', 40),
        '{"agent_chat":"v500","agent_confirm_action":"v501"}'::jsonb,
        'business-web-1', v_attack, '{}'::jsonb
      );
    EXCEPTION WHEN invalid_parameter_value OR check_violation OR not_null_violation THEN
      v_rejected := true;
    END;
    RESET ROLE;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'issue_2060_native_attack_accepted:%', v_attack;
    END IF;
  END LOOP;

  -- Prove finalization does not trust the tuple accepted at begin time.
  UPDATE public.ari_cert_runs
  SET native_artifacts = jsonb_set(native_artifacts, '{0,artifact_id}', '"tampered"'::jsonb)
  WHERE id = v_run_id;
  INSERT INTO public.ari_cert_release_artifacts (
    run_id, artifact_type, artifact_id, release_sha, sha256
  ) VALUES
    (v_run_id, 'business_ios_simulator', 'business_ios_simulator-1', repeat('a', 40), repeat('b', 64)),
    (v_run_id, 'business_ios_physical', 'business_ios_physical-1', repeat('a', 40), repeat('b', 64)),
    (v_run_id, 'business_android', 'business_android-1', repeat('a', 40), repeat('b', 64));
  v_rejected := false;
  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issue_2060_finalizer_accepted_mismatched_native_artifact';
  END IF;
END;
$test$;

ROLLBACK;
