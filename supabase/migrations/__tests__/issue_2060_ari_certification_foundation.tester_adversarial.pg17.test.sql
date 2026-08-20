-- Independent #2060 certification-integrity attacks. Run after the migration
-- on PostgreSQL 17. The transaction guarantees zero residue on both PASS and
-- expected rework failures.
BEGIN;

CREATE TEMP TABLE ari2060_tester_results (
  finding text PRIMARY KEY,
  rejected boolean NOT NULL
) ON COMMIT DROP;

DO $test$
DECLARE
  v_run_id uuid;
  v_direct_pass_rejected boolean := false;
BEGIN
  INSERT INTO public.ari_cert_runs (
    release_sha,
    requirements_digest,
    function_versions,
    web_deployment_id,
    native_artifacts,
    tester_verdict,
    cleanup_verified_at,
    rollback_rehearsed_at,
    prior_compatible_pair,
    stranded_operation_count
  ) VALUES (
    repeat('a', 40),
    repeat('b', 64),
    '{"agent_chat":"v500","agent_confirm_action":"v501"}'::jsonb,
    'web-1',
    '[]'::jsonb,
    'PASS',
    now(),
    now(),
    'v499+v500',
    0
  ) RETURNING id INTO v_run_id;

  BEGIN
    UPDATE public.ari_cert_runs SET status = 'passed' WHERE id = v_run_id;
  EXCEPTION WHEN OTHERS THEN
    v_direct_pass_rejected := true;
  END;

  INSERT INTO ari2060_tester_results VALUES (
    'direct_pass_bypassed_finalizer',
    v_direct_pass_rejected
  );
END;
$test$;

DO $test$
DECLARE
  v_run_id uuid;
  v_fake_inventory_rejected boolean := false;
  v_artifact text;
BEGIN
  INSERT INTO public.ari_cert_runs (
    release_sha,
    requirements_digest,
    function_versions,
    web_deployment_id,
    native_artifacts,
    status,
    tester_verdict,
    rollback_rehearsed_at,
    prior_compatible_pair,
    stranded_operation_count
  ) VALUES (
    repeat('c', 40),
    repeat('d', 64),
    '{"agent_chat":"v600","agent_confirm_action":"v601"}'::jsonb,
    'web-2',
    '[]'::jsonb,
    'running',
    'PASS',
    now(),
    'v599+v600',
    0
  ) RETURNING id INTO v_run_id;

  FOREACH v_artifact IN ARRAY ARRAY[
    'source', 'agent_chat_bundle', 'agent_confirm_bundle', 'business_web',
    'business_ios_simulator', 'business_ios_physical', 'business_android'
  ] LOOP
    INSERT INTO public.ari_cert_release_artifacts (
      run_id, artifact_type, artifact_id, release_sha, sha256
    ) VALUES (v_run_id, v_artifact, v_artifact || '-fake', repeat('c', 40), repeat('e', 64));
  END LOOP;

  INSERT INTO public.ari_cert_evidence (
    run_id,
    capability_id,
    surface,
    tenant_case,
    role_case,
    scenario,
    outcome,
    safe_evidence,
    evidence_digest
  )
  SELECT
    v_run_id,
    'ari.fake.' || value,
    'backend',
    'fabricated-tenant',
    'fabricated-role',
    'fabricated-scenario',
    'passed',
    '{}'::jsonb,
    repeat('f', 64)
  FROM generate_series(1, 116) AS value;

  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
  EXCEPTION WHEN OTHERS THEN
    v_fake_inventory_rejected := true;
  END;

  INSERT INTO ari2060_tester_results VALUES (
    'fake_116_row_inventory_was_certified',
    v_fake_inventory_rejected
  );
END;
$test$;

DO $test$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(finding, ', ' ORDER BY finding)
  INTO v_failures
  FROM ari2060_tester_results
  WHERE NOT rejected;

  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'issue_2060_tester_certification_integrity:%', v_failures;
  END IF;
END;
$test$;

ROLLBACK;
