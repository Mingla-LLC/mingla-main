-- #2829 W9b — keep Ari certification aligned with the website designer's tool
-- registry (152 -> 164), on top of #3872 R2-R3 (20271229003872, 148 -> 152).
-- Deliberately separate from the W9b schema migration
-- (20271229072829_issue_2829_ari_designer.sql): certification backlog-repair
-- tests re-apply the tip census, so this file is convergent (INSERT ... ON
-- CONFLICT DO NOTHING; the finalizer preflight accepts only the exact 152 pair
-- being upgraded or the exact 164 pair from a prior application) and changes
-- nothing on a second run. Twelve new website capabilities; the three earlier
-- website write capabilities (propose_content, propose_settings, attach_media)
-- keep their ids and now map to propose_site_composition, propose_site_tokens
-- and propose_site_imagery, so no requirement row is removed.
-- Do NOT apply here — orchestrator owns production apply.

BEGIN;
SET LOCAL lock_timeout = '10s';

INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES
  ('ari.sites.read_plan', 'read'),
  ('ari.sites.list_designs', 'read'),
  ('ari.sites.read_block_catalog', 'read'),
  ('ari.sites.read_tokens', 'read'),
  ('ari.sites.run_design_checks', 'read'),
  ('ari.sites.save_plan_answers', 'write'),
  ('ari.sites.create_draft', 'write'),
  ('ari.sites.propose_variant', 'write'),
  ('ari.sites.propose_copy', 'write'),
  ('ari.sites.propose_collection_entry', 'write'),
  ('ari.sites.confirm_review', 'write'),
  ('ari.sites.propose_trip_guide', 'write')
ON CONFLICT (capability_id) DO NOTHING;

DO $requirements$
DECLARE
  v_count integer;
  v_wrong text;
BEGIN
  SELECT count(*) INTO v_count FROM public.ari_cert_capability_requirements;
  IF v_count <> 164 THEN
    RAISE EXCEPTION 'issue_2829_ari_cert_requirement_count:%', v_count;
  END IF;

  SELECT string_agg(expected.capability_id || ':' || coalesce(actual.evidence_mode, '<missing>'), ', ' ORDER BY expected.capability_id)
    INTO v_wrong
  FROM (VALUES
    ('ari.sites.read_plan', 'read'),
    ('ari.sites.list_designs', 'read'),
    ('ari.sites.read_block_catalog', 'read'),
    ('ari.sites.read_tokens', 'read'),
    ('ari.sites.run_design_checks', 'read'),
    ('ari.sites.save_plan_answers', 'write'),
    ('ari.sites.create_draft', 'write'),
    ('ari.sites.propose_variant', 'write'),
    ('ari.sites.propose_copy', 'write'),
    ('ari.sites.propose_collection_entry', 'write'),
    ('ari.sites.confirm_review', 'write'),
    ('ari.sites.propose_trip_guide', 'write')
  ) AS expected(capability_id, evidence_mode)
  LEFT JOIN public.ari_cert_capability_requirements actual
    ON actual.capability_id = expected.capability_id
  WHERE actual.capability_id IS NULL OR actual.evidence_mode <> expected.evidence_mode;
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'issue_2829_ari_cert_requirement_modes:%', v_wrong;
  END IF;
END;
$requirements$;

-- Preserve the reviewed #3872 R2-R3 finalizer byte-for-byte except for its two
-- denominator literals. The preflight is convergent and refuses every third
-- state: either the live function has the exact 152 pair being upgraded, or it
-- already has the exact 164 pair from a prior application. The replacement is
-- intentionally static so the repository DDL/RLS audits can inspect it.
DO $finalizer$
DECLARE
  v_definition text;
  v_old_gate integer;
  v_old_receipt integer;
  v_new_gate integer;
  v_new_receipt integer;
BEGIN
  SELECT pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure)
    INTO v_definition;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'issue_2829_ari_cert_finalizer_missing';
  END IF;

  v_old_gate := (length(v_definition) - length(replace(v_definition, 'v_capability_count <> 152', '')))
    / length('v_capability_count <> 152');
  v_old_receipt := (length(v_definition) - length(replace(v_definition, '''capability_count'', 152', '')))
    / length('''capability_count'', 152');
  v_new_gate := (length(v_definition) - length(replace(v_definition, 'v_capability_count <> 164', '')))
    / length('v_capability_count <> 164');
  v_new_receipt := (length(v_definition) - length(replace(v_definition, '''capability_count'', 164', '')))
    / length('''capability_count'', 164');

  IF NOT (
    (v_old_gate = 1 AND v_old_receipt = 1 AND v_new_gate = 0 AND v_new_receipt = 0)
    OR
    (v_old_gate = 0 AND v_old_receipt = 0 AND v_new_gate = 1 AND v_new_receipt = 1)
  ) THEN
    RAISE EXCEPTION 'issue_2829_ari_cert_finalizer_unreviewed_state:old_gate=%,old_receipt=%,new_gate=%,new_receipt=%',
      v_old_gate, v_old_receipt, v_new_gate, v_new_receipt;
  END IF;
END;
$finalizer$;

CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_run public.ari_cert_runs%ROWTYPE;
  v_capability_count integer;
  v_failed_count integer;
  v_artifact_count integer;
  v_residue_count integer;
  v_missing_matrix_count integer;
  v_unknown_count integer;
  v_invalid_digest_count integer;
  v_unverified_provenance_count integer;
  v_invalid_native_count integer;
  v_evidence_set_digest text;
  v_artifact_set_digest text;
  v_capability_set_digest text;
  v_native_artifact_set_digest text;
  v_cleanup_digest text;
  v_rollback_digest text;
  v_run_manifest_digest text;
  v_attestation_key text;
  v_attestation_key_id text;
  v_attestation_payload bytea;
  v_attestation_signature text;
BEGIN
  SELECT * INTO v_run FROM public.ari_cert_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ari_cert_run_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT count(DISTINCT capability_id), count(*) FILTER (WHERE outcome <> 'passed')
    INTO v_capability_count, v_failed_count
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;
  SELECT count(DISTINCT artifact_type) INTO v_artifact_count
  FROM public.ari_cert_release_artifacts
  WHERE run_id = p_run_id AND release_sha = v_run.release_sha;
  SELECT count(*) INTO v_residue_count FROM public.ari_cert_fixtures
  WHERE run_id = p_run_id AND cleanup_state <> 'removed';

  SELECT count(*) INTO v_unknown_count
  FROM public.ari_cert_evidence e
  LEFT JOIN public.ari_cert_capability_requirements r
    ON r.capability_id = e.capability_id
  WHERE e.run_id = p_run_id AND r.capability_id IS NULL;

  WITH expected AS (
    SELECT
      r.capability_id,
      scenario,
      target.surface,
      target.artifact_type,
      role_case,
      CASE WHEN role_case = 'outsider' THEN 'outsider_tenant' ELSE 'owner_tenant' END AS tenant_case
    FROM public.ari_cert_capability_requirements r
    CROSS JOIN LATERAL unnest(public.ari_cert_required_scenarios(r.evidence_mode)) AS scenario
    CROSS JOIN (VALUES
      ('business_ios', 'business_ios_simulator'),
      ('business_ios', 'business_ios_physical'),
      ('business_android', 'business_android'),
      ('business_web', 'business_web')
    ) AS target(surface, artifact_type)
    CROSS JOIN unnest(ARRAY['owner','applicable_member','below_threshold','revoked','outsider']::text[]) AS role_case
  )
  SELECT count(*) INTO v_missing_matrix_count
  FROM expected x
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_release_artifacts a
      ON a.run_id = e.run_id
     AND a.artifact_type = e.artifact_type
     AND a.artifact_id = e.artifact_id
     AND a.release_sha = v_run.release_sha
    WHERE e.run_id = p_run_id
      AND e.capability_id = x.capability_id
      AND e.scenario = x.scenario
      AND e.surface = x.surface
      AND e.artifact_type = x.artifact_type
      AND e.role_case = x.role_case
      AND e.tenant_case = x.tenant_case
      AND e.outcome = 'passed'
      AND e.operation_id IS NOT NULL
      AND e.request_id IS NOT NULL
      AND e.client_turn_id IS NOT NULL
      AND e.execution_id IS NOT NULL
      AND NULLIF(btrim(e.canonical_readback_reference), '') IS NOT NULL
      AND jsonb_typeof(e.safe_evidence) = 'object'
      AND e.safe_evidence ?& ARRAY['receipt_id','readback_digest','telemetry_event_id']
      AND (SELECT count(*) FROM jsonb_object_keys(e.safe_evidence)) = 3
      AND (e.safe_evidence ->> 'receipt_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'telemetry_event_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'readback_digest') ~ '^[0-9a-f]{64}$'
  );

  SELECT count(*) INTO v_invalid_digest_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND e.evidence_digest <> private.ari_cert_digest_v1('scenario-evidence', ARRAY[
      e.run_id::text,
      e.capability_id,
      e.scenario,
      e.surface,
      e.tenant_case,
      e.role_case,
      e.operation_id::text,
      e.request_id::text,
      e.client_turn_id::text,
      e.execution_id::text,
      e.artifact_type,
      e.artifact_id,
      e.canonical_readback_reference,
      e.outcome,
      e.safe_evidence ->> 'receipt_id',
      e.safe_evidence ->> 'readback_digest',
      e.safe_evidence ->> 'telemetry_event_id'
    ]);

  SELECT count(*) INTO v_unverified_provenance_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM private.ari_cert_verified_provenance p
      WHERE p.run_id = e.run_id
        AND p.capability_id = e.capability_id
        AND p.surface = e.surface
        AND p.tenant_case = e.tenant_case
        AND p.role_case = e.role_case
        AND p.scenario = e.scenario
        AND p.operation_id = e.operation_id
        AND p.request_id = e.request_id
        AND p.client_turn_id = e.client_turn_id
        AND p.execution_id = e.execution_id
        AND p.canonical_readback_reference = e.canonical_readback_reference
        AND p.artifact_type = e.artifact_type
        AND p.artifact_id = e.artifact_id
        AND p.receipt_id = (e.safe_evidence ->> 'receipt_id')::uuid
        AND p.readback_digest = e.safe_evidence ->> 'readback_digest'
        AND p.telemetry_event_id = (e.safe_evidence ->> 'telemetry_event_id')::uuid
    );

  SELECT count(*) INTO v_invalid_native_count
  FROM jsonb_array_elements(v_run.native_artifacts) item
  LEFT JOIN public.ari_cert_release_artifacts artifact
    ON artifact.run_id = p_run_id
   AND artifact.artifact_type = item ->> 'surface'
   AND artifact.artifact_id = item ->> 'artifact_id'
   AND artifact.release_sha = v_run.release_sha
  WHERE artifact.id IS NULL;

  IF NOT private.ari_cert_native_artifacts_valid(v_run.native_artifacts)
     OR v_invalid_native_count <> 0 THEN
    RAISE EXCEPTION 'ari_cert_invalid_native_artifacts' USING ERRCODE = '22023';
  END IF;
  IF v_capability_count <> 164 THEN RAISE EXCEPTION 'ari_cert_missing_capabilities:%', v_capability_count; END IF;
  IF v_run.requirements_digest IS DISTINCT FROM private.ari_cert_requirements_set_digest_v1() THEN
    RAISE EXCEPTION 'ari_cert_requirements_digest_mismatch';
  END IF;
  IF v_unknown_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unknown_capabilities:%', v_unknown_count; END IF;
  IF v_missing_matrix_count <> 0 THEN RAISE EXCEPTION 'ari_cert_missing_matrix_evidence:%', v_missing_matrix_count; END IF;
  IF v_invalid_digest_count <> 0 THEN RAISE EXCEPTION 'ari_cert_invalid_evidence_digest:%', v_invalid_digest_count; END IF;
  IF v_unverified_provenance_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unverified_provenance:%', v_unverified_provenance_count; END IF;
  IF v_failed_count <> 0 THEN RAISE EXCEPTION 'ari_cert_nonpassing_evidence:%', v_failed_count; END IF;
  IF v_artifact_count <> 7 THEN RAISE EXCEPTION 'ari_cert_release_artifact_mismatch:%', v_artifact_count; END IF;
  IF v_residue_count <> 0 THEN RAISE EXCEPTION 'ari_cert_fixture_residue:%', v_residue_count; END IF;
  IF v_run.tester_verdict <> 'PASS' OR v_run.cleanup_manifest_digest IS NULL
     OR v_run.rollback_rehearsed_at IS NULL
     OR NULLIF(btrim(v_run.prior_compatible_pair), '') IS NULL
     OR v_run.stranded_operation_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ari_cert_test_or_rollback_incomplete';
  END IF;

  v_attestation_key := current_setting('app.settings.ari_certification_attestation_key', true);
  v_attestation_key_id := current_setting('app.settings.ari_certification_attestation_key_id', true);
  IF length(coalesce(v_attestation_key, '')) < 32
     OR coalesce(v_attestation_key_id, '') !~ '^[a-zA-Z0-9_.:-]{1,64}$' THEN
    RAISE EXCEPTION 'ari_cert_server_attestation_not_configured';
  END IF;
  SELECT private.ari_cert_digest_v1(
    'evidence-set',
    coalesce(array_agg(
      evidence_digest ORDER BY capability_id, surface, artifact_type, scenario, role_case
    ), ARRAY[]::text[])
  )
  INTO v_evidence_set_digest
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;

  SELECT private.ari_cert_digest_v1(
    'artifact-set',
    coalesce(array_agg(private.ari_cert_digest_v1('release-artifact', ARRAY[
      artifact_type, artifact_id, release_sha, sha256
    ]) ORDER BY artifact_type), ARRAY[]::text[])
  )
  INTO v_artifact_set_digest
  FROM public.ari_cert_release_artifacts WHERE run_id = p_run_id;

  WITH per_capability AS (
    SELECT e.capability_id, private.ari_cert_digest_v1(
      'capability-evidence',
      ARRAY[
        p_run_id::text,
        e.capability_id,
        CASE r.evidence_mode
          WHEN 'guided_handoff' THEN 'guided_handoff'
          WHEN 'unsupported' THEN 'unsupported'
          ELSE 'verified'
        END,
        'business_android', 'business_ios', 'business_web'
      ] || ARRAY(
        SELECT required_scenario
        FROM unnest(public.ari_cert_required_scenarios(r.evidence_mode)) required_scenario
        ORDER BY required_scenario
      ) || ARRAY[
        CASE WHEN r.evidence_mode IN ('guided_handoff','unsupported')
          THEN NULL ELSE min(e.canonical_readback_reference) END,
        'owner|applicable_member|below_threshold|revoked|outsider'
      ] || array_agg(
        e.evidence_digest ORDER BY e.surface, e.artifact_type, e.scenario, e.role_case
      )
    ) AS capability_digest
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_capability_requirements r
      ON r.capability_id = e.capability_id
    WHERE e.run_id = p_run_id
    GROUP BY e.capability_id, r.evidence_mode
  ), flattened AS (
    SELECT capability_id, value, ordinal
    FROM per_capability
    CROSS JOIN LATERAL unnest(ARRAY[capability_id, capability_digest])
      WITH ORDINALITY AS item(value, ordinal)
  )
  SELECT private.ari_cert_digest_v1(
    'capability-set',
    array_agg(value ORDER BY capability_id, ordinal)
  )
  INTO v_capability_set_digest
  FROM flattened;

  SELECT private.ari_cert_digest_v1(
    'native-artifact-set',
    array_agg(private.ari_cert_digest_v1('native-artifact', ARRAY[
      item ->> 'surface', item ->> 'artifact_id',
      item ->> 'runtime_version', item ->> 'device'
    ]) ORDER BY item ->> 'surface')
  )
  INTO v_native_artifact_set_digest
  FROM jsonb_array_elements(v_run.native_artifacts) item;

  v_cleanup_digest := private.ari_cert_digest_v1(
    'cleanup', ARRAY['true', v_run.cleanup_manifest_digest]
  );
  v_rollback_digest := private.ari_cert_digest_v1(
    'rollback', ARRAY['true', v_run.prior_compatible_pair, v_run.stranded_operation_count::text]
  );
  v_run_manifest_digest := private.ari_cert_digest_v1('run-manifest', ARRAY[
    v_run.function_versions ->> 'agent_chat',
    v_run.function_versions ->> 'agent_confirm_action',
    v_run.web_deployment_id,
    v_run.tester_verdict,
    v_native_artifact_set_digest,
    v_capability_set_digest,
    v_cleanup_digest,
    v_rollback_digest
  ]);
  v_attestation_payload := private.ari_cert_canonical_tuple_v1('attestation', ARRAY[
    v_attestation_key_id,
    p_run_id::text,
    v_run.release_sha,
    v_run.requirements_digest,
    v_evidence_set_digest,
    v_artifact_set_digest,
    v_capability_set_digest,
    v_native_artifact_set_digest,
    v_cleanup_digest,
    v_rollback_digest,
    v_run_manifest_digest
  ]);
  v_attestation_signature := encode(extensions.hmac(
    v_attestation_payload,
    convert_to(v_attestation_key, 'UTF8'),
    'sha256'
  ), 'hex');

  INSERT INTO private.ari_cert_finalize_authorizations (run_id, transaction_id)
  VALUES (p_run_id, txid_current())
  ON CONFLICT (run_id) DO UPDATE SET transaction_id = EXCLUDED.transaction_id;

  UPDATE public.ari_cert_runs
  SET status = 'passed', cleanup_verified_at = now(), finished_at = now(),
      attestation_key_id = v_attestation_key_id,
      evidence_set_digest = v_evidence_set_digest,
      artifact_set_digest = v_artifact_set_digest,
      capability_set_digest = v_capability_set_digest,
      native_artifact_set_digest = v_native_artifact_set_digest,
      cleanup_digest = v_cleanup_digest,
      rollback_digest = v_rollback_digest,
      run_manifest_digest = v_run_manifest_digest,
      attestation_signature = v_attestation_signature
  WHERE id = p_run_id;
  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'passed',
    'capability_count', 164,
    'server_attestation', jsonb_build_object(
      'algorithm', 'HMAC-SHA256',
      'canonicalization', 'ARI-CERT-TUPLE-V1',
      'key_id', v_attestation_key_id,
      'evidence_set_digest', v_evidence_set_digest,
      'artifact_set_digest', v_artifact_set_digest,
      'capability_set_digest', v_capability_set_digest,
      'native_artifact_set_digest', v_native_artifact_set_digest,
      'cleanup_digest', v_cleanup_digest,
      'rollback_digest', v_rollback_digest,
      'run_manifest_digest', v_run_manifest_digest,
      'signature', v_attestation_signature
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_cert_finalize_run(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_cert_finalize_run(uuid) TO service_role;

COMMENT ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) IS
  'Issue #2060 Pass-5 post-#2829 W9b: stamps private.ari_cert_requirements_set_digest_v1() of the live 164-row requirement set.';
COMMENT ON FUNCTION public.ari_cert_finalize_run(uuid) IS
  'Issue #2060 Pass-5 post-#2829 W9b: finalizes the live 164-capability matrix only when the stamped requirement digest still matches.';

DO $postcondition$
DECLARE
  v_definition text := pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure);
BEGIN
  IF v_definition NOT LIKE '%v_capability_count <> 164%'
     OR v_definition NOT LIKE '%''capability_count'', 164%'
     OR v_definition LIKE '%v_capability_count <> 152%'
     OR v_definition LIKE '%''capability_count'', 152%' THEN
    RAISE EXCEPTION 'issue_2829_ari_cert_finalizer_postcondition_failed';
  END IF;
END;
$postcondition$;

COMMIT;
