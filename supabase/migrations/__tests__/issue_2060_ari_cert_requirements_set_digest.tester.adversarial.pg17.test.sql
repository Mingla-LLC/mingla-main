-- =====================================================================================
-- #2060 Pass-5 tester adversarial — same-count capability swap fails closed.
--
-- Prove the defect #2592's literal parity could not catch: keep the row count,
-- change one capability_id, and show finalize refuses with
-- ari_cert_requirements_digest_mismatch (begin stamped the pre-swap set).
--
-- The immutable trigger is disabled only inside this transaction so the swap
-- is possible; it is re-enabled before finalize. No residue on ROLLBACK.
-- =====================================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_run_id uuid;
  v_stamped text;
  v_after_swap text;
  v_victim text;
  v_release_sha constant text := repeat('f', 40);
  v_native constant jsonb := '[
    {"surface":"business_ios_simulator","artifact_id":"issue-2060-swap-ios-sim","runtime_version":"1.1.5","device":"iPhone simulator"},
    {"surface":"business_ios_physical","artifact_id":"issue-2060-swap-ios-phys","runtime_version":"1.1.5","device":"Physical iPhone"},
    {"surface":"business_android","artifact_id":"issue-2060-swap-android","runtime_version":"1.1.5","device":"Pixel 7"}
  ]'::jsonb;
  v_finalized boolean;
  v_message text;
  v_requirement_count integer;
BEGIN
  SELECT count(*) INTO v_requirement_count FROM public.ari_cert_capability_requirements;
  IF v_requirement_count < 2 THEN
    RAISE EXCEPTION 'issue_2060_adversarial_need_at_least_two_requirements';
  END IF;

  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(
    v_release_sha,
    '{"agent_chat":"v512","agent_confirm_action":"v512"}'::jsonb,
    'issue-2060-set-digest-swap',
    v_native,
    '{}'::jsonb
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_simulator', 'issue-2060-swap-ios-sim',
    v_release_sha, repeat('1', 64));
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_physical', 'issue-2060-swap-ios-phys',
    v_release_sha, repeat('2', 64));
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_android', 'issue-2060-swap-android',
    v_release_sha, repeat('3', 64));
  RESET ROLE;

  SELECT requirements_digest INTO v_stamped
  FROM public.ari_cert_runs WHERE id = v_run_id;

  -- Cover every current capability so the count gate passes after the swap
  -- (count is unchanged); only the set digest must fail.
  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    artifact_type, artifact_id, outcome, safe_evidence, evidence_digest
  )
  SELECT
    v_run_id, r.capability_id, 'business_web', 'owner_tenant', 'owner',
    'confirm_one_side_effect', 'business_web', 'issue-2060-swap-web',
    'passed', '{}'::jsonb, repeat('4', 64)
  FROM public.ari_cert_capability_requirements r;

  SELECT capability_id INTO v_victim
  FROM public.ari_cert_capability_requirements
  ORDER BY capability_id
  LIMIT 1;

  ALTER TABLE public.ari_cert_capability_requirements
    DISABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
  UPDATE public.ari_cert_capability_requirements
  SET capability_id = 'ari.fake.swapped_capability_for_2060'
  WHERE capability_id = v_victim;
  ALTER TABLE public.ari_cert_capability_requirements
    ENABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;

  IF (SELECT count(*) FROM public.ari_cert_capability_requirements) <> v_requirement_count THEN
    RAISE EXCEPTION 'issue_2060_adversarial_count_changed_during_swap';
  END IF;

  v_after_swap := private.ari_cert_requirements_set_digest_v1();
  IF v_after_swap = v_stamped THEN
    RAISE EXCEPTION
      'issue_2060_adversarial_swap_did_not_change_set_digest: helper is not content-sensitive';
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
      'issue_2060_same_count_swap_was_certified: finalize accepted a drifted requirement set';
  END IF;
  IF v_message <> 'ari_cert_requirements_digest_mismatch' THEN
    RAISE EXCEPTION
      'issue_2060_same_count_swap_stopped_for_wrong_reason:%', v_message;
  END IF;

  RAISE NOTICE
    '#2060 same-count swap: stamped=% after=% refused with digest mismatch — ALL PASSED',
    v_stamped, v_after_swap;
END;
$test$;

ROLLBACK;
