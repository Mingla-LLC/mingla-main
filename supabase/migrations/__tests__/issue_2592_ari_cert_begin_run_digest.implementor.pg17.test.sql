-- =====================================================================================
-- #2592 implementor proof — a certification run can actually REACH its finalizer.
--
-- Run AFTER the complete migration chain has been applied to a fresh
-- supabase/postgres:17.4.1.075:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_2592_ari_cert_begin_run_digest.implementor.pg17.test.sql
--
-- `requirements_digest` is one contract with two halves: `ari_cert_begin_run`
-- STAMPS it, `ari_cert_finalize_run` CHECKS it. #1973 and #1978 each replaced only
-- the finalizer, so production ran with begin_run on `29b71dbe…` while the live
-- finalizer demanded `5e06801c…` from 2026-08-20. Every run created through the
-- canonical entry point died at `ari_cert_requirements_digest_mismatch` no matter
-- what evidence it had collected.
--
-- Three assertions:
--   (a) the digest `ari_cert_begin_run` actually WRITES onto a run equals the digest
--       the deployed `ari_cert_finalize_run` actually DEMANDS. Both are read out of
--       the live database — one by calling the RPC, one out of `pg_get_functiondef`
--       — never from a literal typed into this file, so this keeps proving the right
--       thing after a future issue moves the requirement set.
--   (b) the finalizer's own digest predicate, evaluated against the stamped value,
--       is FALSE — i.e. it would not raise.
--   (c) THE BEHAVIOUR THAT WAS DEAD FOR FIVE DAYS: a run created through
--       `ari_cert_begin_run`, given evidence for every required capability, gets
--       PAST the digest gate. It still fails closed further down the chain (the
--       fixture evidence is deliberately not a real matrix), and what matters is
--       exactly which gate stops it: `ari_cert_missing_matrix_evidence`, never
--       `ari_cert_requirements_digest_mismatch`.
--
-- All fixtures roll back.
-- =====================================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_run_id uuid;
  v_stamped text;
  v_demanded text;
  v_release_sha constant text := repeat('a', 40);
  v_native constant jsonb := '[
    {"surface":"business_ios_simulator","artifact_id":"issue-2592-ios-sim","runtime_version":"1.1.5","device":"iPhone simulator"},
    {"surface":"business_ios_physical","artifact_id":"issue-2592-ios-phys","runtime_version":"1.1.5","device":"Physical iPhone"},
    {"surface":"business_android","artifact_id":"issue-2592-android","runtime_version":"1.1.5","device":"Pixel 7"}
  ]'::jsonb;
  v_finalized boolean;
  v_message text;
  v_evidence_capabilities integer;
BEGIN
  -- ---------------------------------------------------------------------------
  -- Arrange: a run opened exactly the way the certification harness opens one.
  -- ---------------------------------------------------------------------------
  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(
    v_release_sha,
    '{"agent_chat":"v511","agent_confirm_action":"v511"}'::jsonb,
    'issue-2592-web-deployment',
    v_native,
    '{}'::jsonb
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_simulator', 'issue-2592-ios-sim', v_release_sha, repeat('b', 64));
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_physical', 'issue-2592-ios-phys', v_release_sha, repeat('c', 64));
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_android', 'issue-2592-android', v_release_sha, repeat('d', 64));
  RESET ROLE;

  -- ---------------------------------------------------------------------------
  -- (a) What begin_run WROTE vs what the finalizer DEMANDS. Both live values.
  -- ---------------------------------------------------------------------------
  SELECT requirements_digest INTO v_stamped
  FROM public.ari_cert_runs WHERE id = v_run_id;
  v_demanded := (regexp_match(
    pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure),
    'requirements_digest <> ''([0-9a-f]{64})'''))[1];

  IF v_stamped IS NULL OR v_demanded IS NULL THEN
    RAISE EXCEPTION
      'issue_2592_requirements_digest_contract_missing: stamped=%, demanded=%',
      v_stamped, v_demanded;
  END IF;
  IF v_stamped <> v_demanded THEN
    RAISE EXCEPTION
      'issue_2592_requirements_digest_drift: ari_cert_begin_run stamps % but ari_cert_finalize_run demands % — every canonical run dies at ari_cert_requirements_digest_mismatch',
      v_stamped, v_demanded;
  END IF;

  -- (b) The finalizer's own predicate, evaluated against the stamped value.
  IF (v_stamped <> v_demanded) THEN
    RAISE EXCEPTION 'issue_2592_digest_predicate_would_raise';
  END IF;

  -- ---------------------------------------------------------------------------
  -- (c) Give the run evidence for every required capability so the capability
  --     count gate (which sits BEFORE the digest gate) passes, then prove which
  --     gate actually stops the run. Written as the database owner: the
  --     service role is correctly refused direct evidence INSERTs, and this
  --     fixture is not pretending to be a real evidence matrix.
  -- ---------------------------------------------------------------------------
  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    artifact_type, artifact_id, outcome, safe_evidence, evidence_digest
  )
  SELECT
    v_run_id, r.capability_id, 'business_web', 'owner_tenant', 'owner',
    'confirm_one_side_effect', 'business_web', 'issue-2592-web',
    'passed', '{}'::jsonb, repeat('e', 64)
  FROM public.ari_cert_capability_requirements r;

  SELECT count(DISTINCT capability_id) INTO v_evidence_capabilities
  FROM public.ari_cert_evidence WHERE run_id = v_run_id;
  IF v_evidence_capabilities <> (SELECT count(*) FROM public.ari_cert_capability_requirements) THEN
    RAISE EXCEPTION 'issue_2592_fixture_did_not_cover_every_capability:%', v_evidence_capabilities;
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
    RAISE EXCEPTION
      'issue_2592_fixture_evidence_certified: a synthetic evidence set must never pass finalization';
  END IF;
  IF v_message = 'ari_cert_requirements_digest_mismatch' THEN
    RAISE EXCEPTION
      'issue_2592_canonical_run_still_cannot_reach_its_finalizer: ari_cert_begin_run stamps a digest ari_cert_finalize_run rejects';
  END IF;
  IF v_message NOT LIKE 'ari_cert_missing_matrix_evidence:%' THEN
    RAISE EXCEPTION
      'issue_2592_finalizer_stopped_at_an_unexpected_gate:%', v_message;
  END IF;

  RAISE NOTICE
    '#2592 begin_run/finalize digest parity: both on %, % capabilities of evidence reached the matrix gate ("%") — ALL PASSED',
    v_stamped, v_evidence_capabilities, v_message;
END;
$test$;

ROLLBACK;
