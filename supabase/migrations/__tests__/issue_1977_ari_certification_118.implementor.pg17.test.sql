\set ON_ERROR_STOP on

-- #1977 implementor current-state certification proof. Historical #2060 (116)
-- and #1973 (117) guards remain unchanged at their migration snapshots.
BEGIN;

DO $certification$
DECLARE
  v_run_id uuid;
  v_error text;
  v_digest text;
BEGIN
  IF (SELECT count(*) FROM public.ari_cert_capability_requirements) <> 118 THEN
    RAISE EXCEPTION '#1977 expected exactly 118 certification requirements';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('ari.rsvp.update', 'write'),
      ('ari.rsvp.list_contributions', 'read'),
      ('ari.rsvp.contribution_settings', 'write')
    ) expected(capability_id, evidence_mode)
    LEFT JOIN public.ari_cert_capability_requirements actual
      USING (capability_id, evidence_mode)
    WHERE actual.capability_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.guests.set_approval'
  ) THEN
    RAISE EXCEPTION '#1977 exact RSVP certification requirements drifted';
  END IF;

  v_run_id := public.ari_cert_begin_run(
    repeat('7', 40),
    '{"agent_chat":"v1977","agent_confirm_action":"v1977"}'::jsonb,
    'business-web-1977',
    '[
      {"surface":"business_ios_simulator","artifact_id":"ios-sim-1977","runtime_version":"1.1.3","device":"iPhone simulator"},
      {"surface":"business_ios_physical","artifact_id":"ios-device-1977","runtime_version":"1.1.3","device":"Physical iPhone"},
      {"surface":"business_android","artifact_id":"android-1977","runtime_version":"1.1.3","device":"Pixel 7"}
    ]'::jsonb,
    '{}'::jsonb
  );
  SELECT requirements_digest INTO v_digest
  FROM public.ari_cert_runs WHERE id = v_run_id;
  IF v_digest <> 'bac1588dd5d65fd2accdbaebfc7168fd2d682b41c9a253f98e1b3afd97d3dab6' THEN
    RAISE EXCEPTION '#1977 begin-run requirements digest drifted: %', v_digest;
  END IF;

  INSERT INTO public.ari_cert_release_artifacts (
    run_id, artifact_type, artifact_id, release_sha, sha256
  ) VALUES
    (v_run_id, 'business_ios_simulator', 'ios-sim-1977', repeat('7', 40), repeat('8', 64)),
    (v_run_id, 'business_ios_physical', 'ios-device-1977', repeat('7', 40), repeat('8', 64)),
    (v_run_id, 'business_android', 'android-1977', repeat('7', 40), repeat('8', 64));

  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    outcome, safe_evidence, evidence_digest
  )
  SELECT v_run_id, capability_id, 'backend', 'owner_tenant', 'owner',
         'confirm_one_side_effect', 'passed', '{}'::jsonb, repeat('9', 64)
  FROM public.ari_cert_capability_requirements
  WHERE capability_id <> 'ari.rsvp.update';

  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
    RAISE EXCEPTION '#1977 finalizer accepted an obsolete 117-row evidence set';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'ari_cert_missing_capabilities:117' THEN
      RAISE EXCEPTION '#1977 expected 117-row rejection, received %', v_error;
    END IF;
  END;
END;
$certification$;

ROLLBACK;
