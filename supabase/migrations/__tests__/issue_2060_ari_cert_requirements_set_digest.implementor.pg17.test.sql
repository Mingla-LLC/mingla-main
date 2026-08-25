-- =====================================================================================
-- #2060 Pass-5 implementor proof — requirements_digest hashes the live set.
--
-- Run AFTER the complete migration chain on supabase/postgres:17.4.1.075.
-- [TEST-MOD-APPROVED #2060] also amends the #2592 begin/finalize digest suite
-- so it no longer pins two hardcoded literals.
--
-- Assertions:
--   (a) begin_run stamps private.ari_cert_requirements_set_digest_v1()
--   (b) finalize_run's digest gate is the same helper (not a hex literal)
--   (c) a canonical run reaches past the digest gate (stops at matrix, not mismatch)
-- =====================================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_run_id uuid;
  v_stamped text;
  v_live text;
  v_definition text;
  v_release_sha constant text := repeat('a', 40);
  v_native constant jsonb := '[
    {"surface":"business_ios_simulator","artifact_id":"issue-2060-ios-sim","runtime_version":"1.1.5","device":"iPhone simulator"},
    {"surface":"business_ios_physical","artifact_id":"issue-2060-ios-phys","runtime_version":"1.1.5","device":"Physical iPhone"},
    {"surface":"business_android","artifact_id":"issue-2060-android","runtime_version":"1.1.5","device":"Pixel 7"}
  ]'::jsonb;
  v_finalized boolean;
  v_message text;
  v_evidence_capabilities integer;
BEGIN
  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(
    v_release_sha,
    '{"agent_chat":"v511","agent_confirm_action":"v511"}'::jsonb,
    'issue-2060-set-digest-web',
    v_native,
    '{}'::jsonb
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_simulator', 'issue-2060-ios-sim', v_release_sha, repeat('b', 64));
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_physical', 'issue-2060-ios-phys', v_release_sha, repeat('c', 64));
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_android', 'issue-2060-android', v_release_sha, repeat('d', 64));
  RESET ROLE;

  SELECT requirements_digest INTO v_stamped
  FROM public.ari_cert_runs WHERE id = v_run_id;
  v_live := private.ari_cert_requirements_set_digest_v1();

  IF v_stamped IS NULL OR v_live IS NULL OR v_stamped !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION
      'issue_2060_requirements_set_digest_missing: stamped=%, live=%',
      v_stamped, v_live;
  END IF;
  IF v_stamped <> v_live THEN
    RAISE EXCEPTION
      'issue_2060_begin_run_did_not_stamp_set_digest: stamped=% live=%',
      v_stamped, v_live;
  END IF;

  v_definition := pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure);
  IF v_definition !~ 'private\.ari_cert_requirements_set_digest_v1\s*\(' THEN
    RAISE EXCEPTION 'issue_2060_finalize_missing_set_digest_helper';
  END IF;
  IF v_definition ~ $re$requirements_digest\s*<>\s*'[0-9a-f]{64}'$re$ THEN
    RAISE EXCEPTION 'issue_2060_finalize_still_pins_hardcoded_digest';
  END IF;

  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    artifact_type, artifact_id, outcome, safe_evidence, evidence_digest
  )
  SELECT
    v_run_id, r.capability_id, 'business_web', 'owner_tenant', 'owner',
    'confirm_one_side_effect', 'business_web', 'issue-2060-web',
    'passed', '{}'::jsonb, repeat('e', 64)
  FROM public.ari_cert_capability_requirements r;

  SELECT count(DISTINCT capability_id) INTO v_evidence_capabilities
  FROM public.ari_cert_evidence WHERE run_id = v_run_id;
  IF v_evidence_capabilities <> (SELECT count(*) FROM public.ari_cert_capability_requirements) THEN
    RAISE EXCEPTION 'issue_2060_fixture_did_not_cover_every_capability:%', v_evidence_capabilities;
  END IF;

  v_finalized := false;
  v_message := NULL;
  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
    v_finalized := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  END;

  IF v_finalized THEN
    RAISE EXCEPTION 'issue_2060_fixture_evidence_certified';
  END IF;
  IF v_message = 'ari_cert_requirements_digest_mismatch' THEN
    RAISE EXCEPTION
      'issue_2060_set_digest_still_mismatches_at_finalize: stamped set digest rejected';
  END IF;
  IF v_message NOT LIKE 'ari_cert_missing_matrix_evidence:%' THEN
    RAISE EXCEPTION 'issue_2060_finalizer_stopped_at_unexpected_gate:%', v_message;
  END IF;

  RAISE NOTICE
    '#2060 requirements set-digest: stamped=%, % capabilities reached matrix gate ("%") — ALL PASSED',
    v_stamped, v_evidence_capabilities, v_message;
END;
$test$;

ROLLBACK;
