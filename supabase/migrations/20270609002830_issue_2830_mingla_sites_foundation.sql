-- Issue #2830 — Mingla Sites Slice A Core authority.
-- Additive only. This migration authors no infrastructure, data seed, pilot
-- enablement, DNS change, live secret, deployment, or Gogi content mutation.

DO $ari_certification$
BEGIN
  IF to_regclass('public.ari_cert_capability_requirements') IS NOT NULL THEN
    INSERT INTO public.ari_cert_capability_requirements (
      capability_id,
      evidence_mode
    ) VALUES
      ('ari.sites.read_site', 'read'),
      ('ari.sites.list_pages', 'read'),
      ('ari.sites.read_page', 'read'),
      ('ari.sites.propose_content', 'write'),
      ('ari.sites.propose_settings', 'write'),
      ('ari.sites.attach_media', 'write'),
      ('ari.sites.validate_draft', 'read'),
      ('ari.sites.create_preview', 'write'),
      ('ari.sites.publish', 'write'),
      ('ari.sites.read_operation', 'read'),
      ('ari.sites.list_versions', 'read'),
      ('ari.sites.rollback', 'write')
    ON CONFLICT (capability_id) DO NOTHING;
  END IF;
END;
$ari_certification$;

-- #2830 extends the reviewed Ari certification requirement set in the same
-- additive migration that registers the Website capabilities. Both halves of
-- the pinned digest and the exact denominator move forward together.
CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(
  p_release_sha text,
  p_function_versions jsonb,
  p_web_deployment_id text,
  p_native_artifacts jsonb,
  p_baseline jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_run_id uuid;
BEGIN
  IF p_release_sha !~ '^[0-9a-f]{40,64}$'
     OR jsonb_typeof(p_function_versions) <> 'object'
     OR NULLIF(p_function_versions ->> 'agent_chat', '') IS NULL
     OR NULLIF(p_function_versions ->> 'agent_confirm_action', '') IS NULL
     OR NULLIF(btrim(p_web_deployment_id), '') IS NULL
     OR NOT private.ari_cert_native_artifacts_valid(p_native_artifacts)
     OR jsonb_typeof(p_baseline) <> 'object' THEN
    RAISE EXCEPTION 'ari_cert_invalid_release_manifest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ari_cert_runs (
    release_sha, requirements_digest, function_versions,
    web_deployment_id, native_artifacts, baseline, status
  ) VALUES (
    p_release_sha,
    -- #2830: MUST equal the literal `ari_cert_finalize_run` checks. The gate
    -- named in this file's header fails closed when these two diverge.
    '0de714ca5cf4f3a78dea892dabaadde8c22d09407d939ec366a239b6d63953ad',
    p_function_versions, p_web_deployment_id, p_native_artifacts, p_baseline, 'running'
  ) RETURNING id INTO v_run_id;
  RETURN v_run_id;
END;
$function$;

-- ACLs re-stated verbatim from 20270504002060 (CREATE OR REPLACE preserves the
-- existing grants, but re-stating them keeps this file independently correct).
REVOKE ALL ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  IF v_capability_count <> 132 THEN RAISE EXCEPTION 'ari_cert_missing_capabilities:%', v_capability_count; END IF;
  IF v_run.requirements_digest <> '0de714ca5cf4f3a78dea892dabaadde8c22d09407d939ec366a239b6d63953ad' THEN
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
    'capability_count', 132,
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

CREATE TABLE public.brand_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL UNIQUE REFERENCES public.brands(id),
  renderer_key text NOT NULL DEFAULT 'restaurant-website-v1'
    CHECK (renderer_key = 'restaurant-website-v1'),
  renderer_version integer NOT NULL DEFAULT 1 CHECK (renderer_version > 0),
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','draft','publishing','published','suspended','error')),
  payload_tenant_id text UNIQUE,
  active_publication_id uuid,
  last_successful_publication_id uuid,
  provisioning_error_code text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  suspended_by uuid REFERENCES auth.users(id),
  suspension_reason_code text,
  CONSTRAINT brand_sites_tenant_state_ck CHECK (
    payload_tenant_id IS NOT NULL OR status IN ('provisioning','error')
  ),
  CONSTRAINT brand_sites_pointer_state_ck CHECK (
    active_publication_id IS NULL OR status IN ('published','suspended')
  ),
  CONSTRAINT brand_sites_suspension_ck CHECK (
    (status <> 'suspended' AND suspended_at IS NULL AND suspended_by IS NULL
      AND suspension_reason_code IS NULL)
    OR
    (status = 'suspended' AND suspended_at IS NOT NULL
      AND suspension_reason_code IS NOT NULL)
  ),
  CONSTRAINT brand_sites_safe_provisioning_error_ck CHECK (
    provisioning_error_code IS NULL OR provisioning_error_code IN (
      'FORBIDDEN','NOT_FOUND','INVALID_STATE','VALIDATION_FAILED',
      'REVISION_CONFLICT','SESSION_EXPIRED','OPERATION_IN_PROGRESS',
      'PUBLISH_FAILED_LAST_GOOD_PRESERVED','MEDIA_REJECTED',
      'MEDIA_PROCESSING','SERVICE_TEMPORARILY_UNAVAILABLE',
      'IDEMPOTENCY_CONFLICT'
    )
  )
);

CREATE TABLE public.brand_site_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  hostname text NOT NULL,
  kind text NOT NULL DEFAULT 'mingla_subdomain' CHECK (kind = 'mingla_subdomain'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','retired')),
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT brand_site_hosts_hostname_shape_ck CHECK (
    hostname = lower(hostname)
    AND hostname = 'gogi.sites.usemingla.com'
    AND hostname !~ '[:/*?#]'
    AND hostname !~ '\.$'
  )
);
CREATE UNIQUE INDEX brand_site_hosts_hostname_uidx
  ON public.brand_site_hosts(hostname);
CREATE UNIQUE INDEX brand_site_hosts_one_active_primary_uidx
  ON public.brand_site_hosts(site_id)
  WHERE status = 'active' AND is_primary;

CREATE OR REPLACE FUNCTION public.brand_site_json_keys_allowed(
  p_value jsonb,
  p_allowed text[]
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_value IS NULL OR (
    jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_value) AS key
      WHERE NOT (key = ANY (p_allowed))
    )
  );
$$;

CREATE TABLE public.brand_site_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  operation_id uuid NOT NULL UNIQUE,
  source_revision_id text NOT NULL CHECK (length(source_revision_id) BETWEEN 1 AND 200),
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  artifact_key text,
  artifact_digest text CHECK (artifact_digest IS NULL OR artifact_digest ~ '^[0-9a-f]{64}$'),
  artifact_schema_version integer NOT NULL DEFAULT 1 CHECK (artifact_schema_version = 1),
  renderer_key text NOT NULL DEFAULT 'restaurant-website-v1'
    CHECK (renderer_key = 'restaurant-website-v1'),
  renderer_version integer NOT NULL DEFAULT 1 CHECK (renderer_version > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','validating','materializing','probing','published','failed','ambiguous','rolled_back')),
  previous_publication_id uuid REFERENCES public.brand_site_publications(id),
  rollback_source_publication_id uuid REFERENCES public.brand_site_publications(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  probe_summary jsonb,
  CONSTRAINT brand_site_publications_artifact_pair_ck CHECK (
    (artifact_key IS NULL) = (artifact_digest IS NULL)
  ),
  CONSTRAINT brand_site_publications_probe_ck CHECK (
    public.brand_site_json_keys_allowed(
      probe_summary,
      ARRAY['http_ok','digest_ok','renderer_ok','schema_ok','canonical_ok',
        'assets_ok','accessibility_ok','consent_ok','cta_ok','leak_check_ok',
        'observed_digest','status_code']
    )
  ),
  CONSTRAINT brand_site_publications_safe_failure_ck CHECK (
    failure_code IS NULL OR failure_code IN (
      'FORBIDDEN','NOT_FOUND','INVALID_STATE','VALIDATION_FAILED',
      'REVISION_CONFLICT','SESSION_EXPIRED','OPERATION_IN_PROGRESS',
      'PUBLISH_FAILED_LAST_GOOD_PRESERVED','MEDIA_REJECTED',
      'MEDIA_PROCESSING','SERVICE_TEMPORARILY_UNAVAILABLE',
      'IDEMPOTENCY_CONFLICT','SIGNATURE_INVALID','REPLAY_DETECTED',
      'TENANT_MISMATCH','ARTIFACT_DIGEST_MISMATCH','PROBE_FAILED',
      'CALLBACK_AMBIGUOUS','STORAGE_UNAVAILABLE','CORE_UNAVAILABLE'
    )
  )
);

ALTER TABLE public.brand_sites
  ADD CONSTRAINT brand_sites_active_publication_fk
  FOREIGN KEY (active_publication_id)
  REFERENCES public.brand_site_publications(id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.brand_sites
  ADD CONSTRAINT brand_sites_last_successful_publication_fk
  FOREIGN KEY (last_successful_publication_id)
  REFERENCES public.brand_site_publications(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.brand_site_validate_publication_pointer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.active_publication_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_site_publications publication
    WHERE publication.id = NEW.active_publication_id
      AND publication.site_id = NEW.id
      AND publication.status = 'published'
  ) THEN
    RAISE EXCEPTION 'brand_site_active_publication_mismatch';
  END IF;
  IF NEW.last_successful_publication_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_site_publications publication
    WHERE publication.id = NEW.last_successful_publication_id
      AND publication.site_id = NEW.id
      AND publication.status = 'published'
  ) THEN
    RAISE EXCEPTION 'brand_site_last_successful_publication_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER brand_sites_validate_publication_pointer
AFTER INSERT OR UPDATE OF active_publication_id, last_successful_publication_id
ON public.brand_sites DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.brand_site_validate_publication_pointer();

CREATE TABLE public.brand_site_editor_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  code_digest text NOT NULL UNIQUE CHECK (code_digest ~ '^[0-9a-f]{64}$'),
  destination text NOT NULL CHECK (destination IN ('studio','preview')),
  role_snapshot integer NOT NULL CHECK (role_snapshot BETWEEN 20 AND 60),
  membership_revision text NOT NULL,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','consumed','expired','revoked')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT brand_site_editor_exchange_ttl_ck CHECK (
    expires_at = issued_at + interval '60 seconds'
  )
);

CREATE TABLE public.brand_site_operation_receipts (
  operation_id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN (
    'provision','editor_session','preview','publish','rollback',
    'suspend','resume','reconcile','revoke_sessions'
  )),
  arguments_digest text NOT NULL CHECK (arguments_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('authorized','executing','succeeded','failed','ambiguous')),
  result_summary jsonb,
  error_code text,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_receipts_result_ck CHECK (
    public.brand_site_json_keys_allowed(
      result_summary,
      ARRAY['site_id','publication_id','status','destination','expires_at',
        'revision_id','artifact_digest','last_good_preserved','retryable',
        'brand_id','user_id','rank','generated_at',
        'rollback_source_publication_id']
    )
  )
);

CREATE TABLE public.brand_site_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  actor_user_id uuid REFERENCES auth.users(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','admin','system','ari')),
  action text NOT NULL CHECK (action IN (
    'site.provision_requested','site.provisioned','site.provision_failed',
    'editor.exchange_issued','editor.exchange_consumed','editor.sessions_revoked',
    'preview.requested','preview.created',
    'publication.requested','publication.published','publication.failed',
    'publication.reconciled','publication.rollback_requested',
    'operation.reconcile_checked',
    'site.suspended','site.resumed','attribution.consumed'
  )),
  resource_kind text NOT NULL CHECK (length(resource_kind) BETWEEN 1 AND 64),
  resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 200),
  operation_id uuid,
  before_digest text CHECK (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$'),
  after_digest text CHECK (after_digest IS NULL OR after_digest ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved']
    )
  )
);

CREATE TABLE public.brand_site_gateway_nonces (
  direction text NOT NULL CHECK (direction IN ('core_to_cms','cms_to_core','runtime_to_core')),
  nonce text NOT NULL,
  operation_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (direction, nonce)
);

CREATE TABLE public.brand_site_attribution_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  publication_id uuid NOT NULL REFERENCES public.brand_site_publications(id),
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  consent_policy_version text NOT NULL CHECK (length(consent_policy_version) BETWEEN 1 AND 40),
  source_kind text NOT NULL CHECK (source_kind IN ('direct','site','campaign')),
  source_ref text CHECK (source_ref IS NULL OR source_ref ~ '^[A-Za-z0-9_.-]{1,80}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  order_id uuid,
  CONSTRAINT brand_site_attribution_ttl_ck CHECK (
    expires_at <= issued_at + interval '30 minutes'
  )
);
CREATE UNIQUE INDEX brand_site_attribution_order_once_idx
  ON public.brand_site_attribution_touches(order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN site_attribution_token_digest text
  CHECK (
    site_attribution_token_digest IS NULL OR
    site_attribution_token_digest ~ '^[0-9a-f]{64}$'
  );

CREATE OR REPLACE FUNCTION public.brand_site_bind_checkout_attribution()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_touch public.brand_site_attribution_touches%ROWTYPE;
BEGIN
  IF NEW.order_id IS NULL OR NEW.site_attribution_token_digest IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT * INTO v_touch
    FROM public.brand_site_attribution_touches touch
    WHERE touch.token_digest = NEW.site_attribution_token_digest
      AND touch.brand_id = NEW.brand_id
      AND touch.consumed_at IS NULL
      AND touch.expires_at > clock_timestamp()
    FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    UPDATE public.brand_site_attribution_touches
      SET consumed_at = clock_timestamp(), order_id = NEW.order_id
      WHERE id = v_touch.id AND consumed_at IS NULL;
    INSERT INTO public.brand_site_audit_log(
      site_id, brand_id, actor_kind, action, resource_kind, resource_id, metadata
    ) VALUES (
      v_touch.site_id, v_touch.brand_id, 'system', 'attribution.consumed',
      'attribution_touch', v_touch.id::text, '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    -- Analytics is additive. It may never roll back a successful checkout or
    -- make an order depend on the Sites control plane being available.
    RAISE LOG 'mingla_sites_attribution_bind_failed sqlstate=%', SQLSTATE;
    RETURN NEW;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_bind_checkout_attribution()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER brand_site_checkout_attribution_trigger
AFTER INSERT OR UPDATE OF order_id, site_attribution_token_digest
ON public.ticket_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.brand_site_bind_checkout_attribution();

CREATE TABLE public.brand_site_analytics_events (
  event_id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  publication_id uuid NOT NULL REFERENCES public.brand_site_publications(id),
  event_name text NOT NULL CHECK (event_name IN (
    'site_view','page_view','cta_click','offering_view','reservation_start',
    'checkout_start','checkout_complete','contact_click','consent_granted','consent_denied'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  page_role text CHECK (page_role IS NULL OR page_role IN ('home','about','menu','gallery','contact')),
  cta_kind text CHECK (cta_kind IS NULL OR cta_kind IN ('offering','reservation','checkout','contact','menu','message')),
  offering_id uuid,
  referrer_class text CHECK (referrer_class IS NULL OR referrer_class IN ('direct','search','social','mingla','other')),
  consent_policy_version text NOT NULL CHECK (consent_policy_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.brand_site_service_config (
  config_key text PRIMARY KEY CHECK (config_key = 'sites_v1'),
  cms_origin text NOT NULL,
  public_runtime_origin text NOT NULL,
  public_host_suffix text NOT NULL CHECK (public_host_suffix = 'sites.usemingla.com'),
  pilot_brand_id uuid REFERENCES public.brands(id),
  pilot_site_id uuid REFERENCES public.brand_sites(id),
  pilot_enabled boolean NOT NULL DEFAULT false,
  backup_entitlement_verified_at timestamptz,
  backup_retention_days integer CHECK (
    backup_retention_days IS NULL OR backup_retention_days >= 7
  ),
  database_backup_verified_at timestamptz,
  object_manifest_verified_at timestamptz,
  restore_drill_verified_at timestamptz,
  restore_drill_evidence_digest text CHECK (
    restore_drill_evidence_digest IS NULL OR
    restore_drill_evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  configured_by uuid NOT NULL REFERENCES auth.users(id),
  configured_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL,
  CONSTRAINT brand_site_service_config_pair_ck CHECK (
    pilot_site_id IS NULL OR pilot_brand_id IS NOT NULL
  ),
  CONSTRAINT brand_site_service_config_enable_ck CHECK (
    NOT pilot_enabled OR (pilot_brand_id IS NOT NULL AND pilot_site_id IS NOT NULL)
  ),
  CONSTRAINT brand_site_service_config_cms_origin_ck CHECK (
    cms_origin ~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
    AND cms_origin !~ '(localhost|127\.0\.0\.1|@|\*|\?|#)'
  ),
  CONSTRAINT brand_site_service_config_runtime_origin_ck CHECK (
    public_runtime_origin ~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
    AND public_runtime_origin !~ '(localhost|127\.0\.0\.1|@|\*|\?|#)'
  )
);

CREATE OR REPLACE FUNCTION public.brand_site_validate_service_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.pilot_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_sites site
    WHERE site.id = NEW.pilot_site_id AND site.brand_id = NEW.pilot_brand_id
  ) THEN
    RAISE EXCEPTION 'brand_site_pilot_binding_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_site_validate_service_config
BEFORE INSERT OR UPDATE ON public.brand_site_service_config
FOR EACH ROW EXECUTE FUNCTION public.brand_site_validate_service_config();

CREATE OR REPLACE FUNCTION public.brand_site_enforce_publication_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status IN ('published','failed','rolled_back') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'brand_site_publication_terminal';
  END IF;
  IF OLD.status = 'ambiguous' AND NEW.status NOT IN ('ambiguous','published','failed') THEN
    RAISE EXCEPTION 'brand_site_publication_reconciliation_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_site_enforce_publication_transition
BEFORE UPDATE ON public.brand_site_publications
FOR EACH ROW EXECUTE FUNCTION public.brand_site_enforce_publication_transition();

CREATE OR REPLACE FUNCTION public.brand_site_enforce_receipt_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status IN ('succeeded','failed') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'brand_site_receipt_terminal';
  END IF;
  IF OLD.status = 'ambiguous' AND NEW.status NOT IN ('ambiguous','succeeded','failed') THEN
    RAISE EXCEPTION 'brand_site_receipt_reconciliation_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_site_enforce_receipt_transition
BEFORE UPDATE ON public.brand_site_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.brand_site_enforce_receipt_transition();

CREATE OR REPLACE FUNCTION public.brand_site_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_sites_set_updated_at
BEFORE UPDATE ON public.brand_sites
FOR EACH ROW EXECUTE FUNCTION public.brand_site_set_updated_at();
CREATE TRIGGER brand_site_receipts_set_updated_at
BEFORE UPDATE ON public.brand_site_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.brand_site_set_updated_at();

ALTER TABLE public.brand_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_sites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_hosts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_editor_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_editor_exchanges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_operation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_gateway_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_gateway_nonces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_attribution_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_attribution_touches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_analytics_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_service_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_service_config FORCE ROW LEVEL SECURITY;

CREATE POLICY brand_sites_marketing_read ON public.brand_sites
FOR SELECT TO authenticated USING (
  public.biz_brand_effective_rank(brand_id, auth.uid()) >= 20
);
CREATE POLICY brand_site_hosts_marketing_read ON public.brand_site_hosts
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.brand_sites site
  WHERE site.id = brand_site_hosts.site_id
    AND public.biz_brand_effective_rank(site.brand_id, auth.uid()) >= 20
));
CREATE POLICY brand_site_publications_marketing_read ON public.brand_site_publications
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.brand_sites site
  WHERE site.id = brand_site_publications.site_id
    AND public.biz_brand_effective_rank(site.brand_id, auth.uid()) >= 20
));
CREATE POLICY brand_site_receipts_marketing_read ON public.brand_site_operation_receipts
FOR SELECT TO authenticated USING (
  public.biz_brand_effective_rank(brand_id, auth.uid()) >= 20
);

REVOKE ALL ON TABLE public.brand_sites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_hosts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_publications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_editor_exchanges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_operation_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_audit_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_gateway_nonces FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_attribution_touches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_analytics_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_service_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.brand_sites TO authenticated;
GRANT SELECT ON TABLE public.brand_site_hosts TO authenticated;
GRANT SELECT ON TABLE public.brand_site_publications TO authenticated;
GRANT SELECT ON TABLE public.brand_site_operation_receipts TO authenticated;
GRANT ALL ON TABLE public.brand_sites, public.brand_site_hosts,
  public.brand_site_publications, public.brand_site_editor_exchanges,
  public.brand_site_operation_receipts, public.brand_site_audit_log,
  public.brand_site_gateway_nonces, public.brand_site_attribution_touches,
  public.brand_site_analytics_events, public.brand_site_service_config
  TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_provision(
  p_brand_id uuid,
  p_operation_id uuid,
  p_arguments_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_pilot_brand_id uuid;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_arguments_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  -- The disabled service row is the bootstrap allowlist: Gogi's brand may be
  -- bound before its site exists, while every other brand fails closed.
  SELECT config.pilot_brand_id INTO v_pilot_brand_id
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
  FOR SHARE;
  IF NOT FOUND OR v_pilot_brand_id IS DISTINCT FROM p_brand_id THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> p_arguments_digest OR
       v_receipt.brand_id <> p_brand_id OR v_receipt.kind <> 'provision' THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN COALESCE(v_receipt.result_summary, jsonb_build_object(
      'site_id', v_receipt.site_id, 'status', v_receipt.status));
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.brand_sites(brand_id, created_by)
    VALUES (p_brand_id, v_actor) RETURNING * INTO v_site;
    INSERT INTO public.brand_site_hosts(site_id, hostname)
    VALUES (v_site.id, 'gogi.sites.usemingla.com');
  END IF;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at
  ) VALUES (
    p_operation_id, v_site.id, p_brand_id, v_actor, 'provision',
    p_arguments_digest, 'executing',
    jsonb_build_object('site_id', v_site.id, 'status', 'executing'), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    v_site.id, p_brand_id, v_actor, 'user', 'site.provision_requested',
    'site', v_site.id::text, p_operation_id,
    jsonb_build_object('status', 'executing', 'renderer_version', 1)
  );
  RETURN jsonb_build_object('site_id', v_site.id, 'status', 'executing');
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_issue_editor_exchange(
  p_brand_id uuid,
  p_operation_id uuid,
  p_destination text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_code text;
  v_digest text;
  v_arguments_digest text;
  v_exchange_id uuid;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_issued timestamptz := clock_timestamp();
  v_rank integer;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 OR p_destination <> 'studio' THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_arguments_digest := encode(
    extensions.digest(p_destination || ':' || v_site.id::text, 'sha256'),
    'hex'
  );
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> v_arguments_digest OR
       v_receipt.site_id <> v_site.id OR
       v_receipt.brand_id <> p_brand_id OR
       v_receipt.user_id <> v_actor OR
       v_receipt.kind <> 'editor_session' THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    -- Raw exchange codes are deliberately never persisted. A transport retry
    -- receives the recorded result and cannot mint a second live credential.
    RETURN COALESCE(v_receipt.result_summary, '{}'::jsonb);
  END IF;
  v_code := replace(replace(trim(trailing '=' FROM encode(extensions.gen_random_bytes(32), 'base64')), '+', '-'), '/', '_');
  v_digest := encode(extensions.digest(v_code, 'sha256'), 'hex');
  INSERT INTO public.brand_site_editor_exchanges(
    site_id, brand_id, user_id, code_digest, destination, role_snapshot,
    membership_revision, issued_at, expires_at
  ) VALUES (
    v_site.id, p_brand_id, v_actor, v_digest, p_destination, v_rank,
    v_rank::text || ':' || extract(epoch FROM now())::bigint::text,
    v_issued, v_issued + interval '60 seconds'
  ) RETURNING id INTO v_exchange_id;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, completed_at
  ) VALUES (
    p_operation_id, v_site.id, p_brand_id, v_actor, 'editor_session',
    v_arguments_digest,
    'succeeded', jsonb_build_object(
      'site_id', v_site.id, 'status', 'succeeded',
      'destination', p_destination, 'expires_at', v_issued + interval '60 seconds'
    ), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    v_site.id, p_brand_id, v_actor, 'user', 'editor.exchange_issued',
    'editor_exchange', v_exchange_id::text, p_operation_id,
    jsonb_build_object('destination', p_destination)
  );
  RETURN jsonb_build_object(
    'site_id', v_site.id,
    'code', v_code,
    'destination', p_destination,
    'expires_at', v_issued + interval '60 seconds'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_authorize_operation(
  p_site_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_arguments_digest text,
  p_expected_revision text,
  p_source_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_publication_id uuid;
  v_rollback_source_id uuid;
  v_rank integer;
  v_config public.brand_site_service_config%ROWTYPE;
  v_generated_at timestamptz;
BEGIN
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_kind NOT IN ('preview','publish','rollback') OR
     p_arguments_digest !~ '^[0-9a-f]{64}$' OR
     p_source_digest !~ '^[0-9a-f]{64}$' OR
     length(p_expected_revision) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> p_arguments_digest OR
       v_receipt.site_id <> p_site_id OR
       v_receipt.brand_id <> v_site.brand_id OR
       v_receipt.user_id <> v_actor OR
       v_receipt.kind <> p_kind THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN COALESCE(v_receipt.result_summary, '{}'::jsonb) || jsonb_build_object(
      'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank
    );
  END IF;
  IF p_kind IN ('publish','rollback') THEN
    IF p_kind = 'publish' AND v_site.last_successful_publication_id IS NULL THEN
      SELECT * INTO v_config
      FROM public.brand_site_service_config config
      WHERE config.config_key = 'sites_v1'
        AND config.pilot_site_id = v_site.id
        AND config.pilot_brand_id = v_site.brand_id;
      IF NOT FOUND OR COALESCE(v_config.backup_retention_days, 0) < 7
        OR v_config.backup_entitlement_verified_at IS NULL
        OR v_config.database_backup_verified_at IS NULL
        OR v_config.database_backup_verified_at <= clock_timestamp() - interval '26 hours'
        OR v_config.object_manifest_verified_at IS NULL
        OR v_config.object_manifest_verified_at <= clock_timestamp() - interval '26 hours'
        OR v_config.restore_drill_verified_at IS NULL
        OR v_config.restore_drill_verified_at <= clock_timestamp() - interval '100 days'
        OR v_config.restore_drill_evidence_digest IS NULL THEN
        RAISE EXCEPTION 'sites_readiness_blocked';
      END IF;
    END IF;
    IF p_kind = 'rollback' THEN
      SELECT publication.id INTO STRICT v_rollback_source_id
      FROM public.brand_site_publications publication
      WHERE publication.site_id = p_site_id
        AND publication.status = 'published'
        AND publication.source_revision_id = p_expected_revision
        AND publication.source_digest = p_source_digest;
    END IF;
    v_publication_id := gen_random_uuid();
    INSERT INTO public.brand_site_publications(
      id, site_id, operation_id, source_revision_id, source_digest,
      previous_publication_id, rollback_source_publication_id, requested_by
    ) VALUES (
      v_publication_id, p_site_id, p_operation_id, p_expected_revision,
      p_source_digest, v_site.active_publication_id,
      v_rollback_source_id,
      v_actor
    ) RETURNING requested_at INTO v_generated_at;
    IF p_kind = 'publish' AND v_site.active_publication_id IS NULL THEN
      UPDATE public.brand_sites
      SET status = 'publishing', provisioning_error_code = NULL
      WHERE id = p_site_id;
    END IF;
  END IF;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, p_kind,
    p_arguments_digest, 'authorized', jsonb_build_object(
      'site_id', p_site_id, 'status', 'authorized',
      'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank,
      'revision_id', p_expected_revision,
      'publication_id', v_publication_id,
      'generated_at', v_generated_at,
      'rollback_source_publication_id', v_rollback_source_id
    )
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user',
    CASE WHEN p_kind = 'rollback' THEN 'publication.rollback_requested'
         WHEN p_kind = 'preview' THEN 'preview.requested'
         ELSE 'publication.requested' END,
    p_kind, COALESCE(v_publication_id::text, p_expected_revision), p_operation_id,
    jsonb_build_object('status', 'authorized')
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'status', 'authorized',
    'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank,
    'revision_id', p_expected_revision, 'publication_id', v_publication_id,
    'generated_at', v_generated_at,
    'rollback_source_publication_id', v_rollback_source_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_complete_preview(
  p_site_id uuid,
  p_operation_id uuid,
  p_revision_id text,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id
    AND site_id = p_site_id
    AND kind = 'preview'
  FOR UPDATE;
  IF v_receipt.status = 'succeeded' THEN
    RETURN v_receipt.result_summary;
  END IF;
  IF v_receipt.status NOT IN ('authorized','executing','ambiguous') OR
     p_revision_id <> v_receipt.result_summary->>'revision_id' OR
     p_expires_at <= clock_timestamp() OR
     p_expires_at > clock_timestamp() + interval '30 minutes' THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_site_operation_receipts
  SET status = 'succeeded', completed_at = clock_timestamp(),
    result_summary = jsonb_build_object(
      'site_id', p_site_id,
      'status', 'succeeded',
      'revision_id', p_revision_id,
      'expires_at', p_expires_at
    )
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_receipt.brand_id, v_receipt.user_id, 'user',
    'preview.created', 'preview', p_revision_id, p_operation_id,
    jsonb_build_object('status', 'succeeded')
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'status', 'succeeded',
    'revision_id', p_revision_id,
    'expires_at', p_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_consume_editor_exchange(
  p_code text,
  p_destination text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_digest text := encode(extensions.digest(p_code, 'sha256'), 'hex');
  v_exchange public.brand_site_editor_exchanges%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_exchange FROM public.brand_site_editor_exchanges
    WHERE code_digest = v_digest FOR UPDATE;
  IF v_exchange.status <> 'issued' OR v_exchange.expires_at <= clock_timestamp()
     OR v_exchange.destination <> p_destination
     OR public.biz_brand_effective_rank(v_exchange.brand_id, v_exchange.user_id) < 20 THEN
    RAISE EXCEPTION 'sites_session_expired';
  END IF;
  UPDATE public.brand_site_editor_exchanges
    SET status = 'consumed', consumed_at = clock_timestamp()
    WHERE id = v_exchange.id AND status = 'issued';
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, metadata
  ) VALUES (
    v_exchange.site_id, v_exchange.brand_id, v_exchange.user_id, 'user',
    'editor.exchange_consumed', 'editor_exchange', v_exchange.id::text,
    jsonb_build_object('destination', p_destination)
  );
  RETURN jsonb_build_object(
    'site_id', v_exchange.site_id,
    'brand_id', v_exchange.brand_id,
    'user_id', v_exchange.user_id,
    'rank', public.biz_brand_effective_rank(v_exchange.brand_id, v_exchange.user_id),
    'absolute_expires_at', clock_timestamp() + interval '8 hours',
    'idle_expires_at', clock_timestamp() + interval '30 minutes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_complete_provision(
  p_site_id uuid,
  p_operation_id uuid,
  p_payload_tenant_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
BEGIN
  IF p_payload_tenant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id AND site_id = p_site_id
      AND kind = 'provision' FOR UPDATE;
  IF v_receipt.status = 'succeeded' THEN
    IF v_site.payload_tenant_id <> p_payload_tenant_id THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  IF v_receipt.status NOT IN ('authorized','executing','ambiguous') THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_sites SET payload_tenant_id = p_payload_tenant_id,
    status = 'draft', provisioning_error_code = NULL
  WHERE id = p_site_id;
  UPDATE public.brand_site_operation_receipts SET status = 'succeeded',
    result_summary = jsonb_build_object(
      'site_id', p_site_id, 'status', 'succeeded'
    ), completed_at = clock_timestamp()
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'site.provisioned',
    'site', p_site_id::text, p_operation_id,
    jsonb_build_object('status', 'draft', 'renderer_version', 1)
  );
  RETURN jsonb_build_object('site_id', p_site_id, 'status', 'succeeded');
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_commercial_projection(
  p_site_id uuid,
  p_offering_ids uuid[]
) RETURNS TABLE (
  id uuid,
  kind text,
  title text,
  summary text,
  url text,
  checkout_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id FROM public.brand_sites WHERE id = p_site_id;
  IF cardinality(p_offering_ids) > 20 OR array_position(p_offering_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  RETURN QUERY
  SELECT event.id,
    CASE event.event_type
      WHEN 'trip' THEN 'offering'
      WHEN 'experience' THEN 'offering'
      ELSE 'offering'
    END,
    event.title,
    left(COALESCE(event.description, ''), 500),
    'https://host.usemingla.com/' ||
      CASE event.event_type WHEN 'trip' THEN 't/' WHEN 'experience' THEN 'exp/' ELSE 'e/' END ||
      brand.slug || '/' || event.slug,
    CASE WHEN event.event_type IN ('event','rsvp')
      THEN 'https://host.usemingla.com/checkout/' || event.id::text
      ELSE 'https://host.usemingla.com/' ||
        CASE event.event_type WHEN 'trip' THEN 't/' ELSE 'exp/' END ||
        brand.slug || '/' || event.slug
    END
  FROM public.events event
  JOIN public.brands brand ON brand.id = event.brand_id
  WHERE event.id = ANY(p_offering_ids)
    AND event.brand_id = v_brand_id
    AND event.deleted_at IS NULL
    AND event.visibility IN ('public','discover')
    AND event.status IN ('scheduled','live');
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_complete_publication(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid,
  p_source_revision_id text,
  p_source_digest text,
  p_artifact_key text,
  p_artifact_digest text,
  p_probe_summary jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_publication FROM public.brand_site_publications
    WHERE id = p_publication_id AND operation_id = p_operation_id
      AND site_id = p_site_id FOR UPDATE;
  IF v_publication.status = 'published' THEN
    RETURN jsonb_build_object(
      'site_id', p_site_id, 'publication_id', p_publication_id,
      'artifact_digest', v_publication.artifact_digest, 'status', 'published'
    );
  END IF;
  IF v_publication.status NOT IN ('queued','validating','materializing','probing','ambiguous')
     OR v_publication.source_revision_id <> p_source_revision_id
     OR v_publication.source_digest <> p_source_digest
     OR p_artifact_digest !~ '^[0-9a-f]{64}$'
     OR p_artifact_key <> 'publications/' || p_site_id::text || '/' ||
        p_publication_id::text || '/' || p_artifact_digest || '.json'
     OR NOT public.brand_site_json_keys_allowed(
       p_probe_summary,
       ARRAY['http_ok','digest_ok','renderer_ok','schema_ok','canonical_ok',
        'assets_ok','accessibility_ok','consent_ok','cta_ok','leak_check_ok',
        'observed_digest','status_code']
     )
     OR COALESCE((p_probe_summary->>'http_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'digest_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'renderer_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'schema_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'canonical_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'assets_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'accessibility_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'consent_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'cta_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'leak_check_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'status_code')::integer, 0) <> 200
     OR p_probe_summary->>'observed_digest' <> p_artifact_digest THEN
    RAISE EXCEPTION 'sites_callback_ambiguous';
  END IF;
  UPDATE public.brand_site_publications SET
    artifact_key = p_artifact_key,
    artifact_digest = p_artifact_digest,
    probe_summary = p_probe_summary,
    status = 'published',
    completed_at = clock_timestamp()
  WHERE id = p_publication_id;
  UPDATE public.brand_sites SET
    status = 'published', active_publication_id = p_publication_id,
    last_successful_publication_id = p_publication_id,
    provisioning_error_code = NULL
  WHERE id = p_site_id;
  UPDATE public.brand_site_operation_receipts SET
    status = 'succeeded', completed_at = clock_timestamp(),
    result_summary = jsonb_build_object(
      'site_id', p_site_id, 'publication_id', p_publication_id,
      'artifact_digest', p_artifact_digest, 'status', 'succeeded'
    )
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    operation_id, after_digest, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'publication.published',
    'publication', p_publication_id::text, p_operation_id, p_artifact_digest,
    jsonb_build_object('status', 'published', 'schema_version', 1, 'renderer_version', 1)
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'publication_id', p_publication_id,
    'artifact_digest', p_artifact_digest, 'status', 'published'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_fail_publication(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_site
  FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications
  WHERE id = p_publication_id
    AND site_id = p_site_id
    AND operation_id = p_operation_id
  FOR UPDATE;
  IF v_publication.status = 'published' THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_site_publications
  SET status = 'failed', failed_at = clock_timestamp(),
    failure_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED'
  WHERE id = p_publication_id;
  UPDATE public.brand_sites
  SET status = CASE
      WHEN last_successful_publication_id IS NULL THEN 'draft'
      ELSE 'published'
    END,
    provisioning_error_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED'
  WHERE id = p_site_id;
  UPDATE public.brand_site_operation_receipts
  SET status = 'failed', completed_at = clock_timestamp(),
    error_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED',
    result_summary = jsonb_build_object(
      'site_id', p_site_id,
      'publication_id', p_publication_id,
      'status', 'failed',
      'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL,
      'retryable', false
    )
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'publication.failed',
    'publication', p_publication_id::text, p_operation_id,
    jsonb_build_object(
      'status', 'failed',
      'safe_error_code', 'PUBLISH_FAILED_LAST_GOOD_PRESERVED',
      'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL
    )
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'publication_id', p_publication_id,
    'status', 'failed',
    'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL,
    'retryable', false
  );
END;
$$;

-- A transport timeout or rejected callback is uncertainty, not failure and
-- never success. This transition preserves the live pointer and gives Admin an
-- exact operation id to reconcile against durable Core state.
CREATE OR REPLACE FUNCTION public.brand_site_mark_operation_ambiguous(
  p_site_id uuid,
  p_operation_id uuid,
  p_safe_error_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
BEGIN
  IF p_safe_error_code NOT IN ('CALLBACK_AMBIGUOUS','SERVICE_TEMPORARILY_UNAVAILABLE') THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_receipt
  FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id AND site_id = p_site_id
  FOR UPDATE;
  IF v_receipt.status IN ('succeeded','failed') THEN
    RETURN jsonb_build_object(
      'site_id', p_site_id, 'operation_id', p_operation_id,
      'status', v_receipt.status
    );
  END IF;
  UPDATE public.brand_site_operation_receipts
  SET status = 'ambiguous', error_code = p_safe_error_code
  WHERE operation_id = p_operation_id;
  UPDATE public.brand_site_publications
  SET status = 'ambiguous', failure_code = p_safe_error_code
  WHERE site_id = p_site_id AND operation_id = p_operation_id
    AND status IN ('queued','validating','materializing','probing','ambiguous');
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'operation_id', p_operation_id,
    'status', 'ambiguous'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_internal_authorize(
  p_site_id uuid,
  p_user_id uuid,
  p_min_rank integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_rank integer;
BEGIN
  IF p_min_rank NOT IN (20, 50) THEN RAISE EXCEPTION 'sites_forbidden'; END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, p_user_id);
  IF v_rank < p_min_rank THEN RAISE EXCEPTION 'sites_forbidden'; END IF;
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'brand_id', v_site.brand_id,
    'user_id', p_user_id, 'rank', v_rank, 'authorized', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_resolve_publication(p_hostname text)
RETURNS TABLE (
  site_id uuid,
  brand_id uuid,
  publication_id uuid,
  artifact_key text,
  artifact_digest text,
  artifact_schema_version integer,
  renderer_key text,
  renderer_version integer,
  hostname text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT site.id, site.brand_id, publication.id, publication.artifact_key,
    publication.artifact_digest, publication.artifact_schema_version,
    publication.renderer_key, publication.renderer_version, host.hostname
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  JOIN public.brand_site_publications publication
    ON publication.id = site.active_publication_id AND publication.site_id = site.id
  JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1' AND config.pilot_enabled
    AND config.pilot_site_id = site.id AND config.pilot_brand_id = site.brand_id
  WHERE host.hostname = lower(p_hostname)
    AND p_hostname = 'gogi.sites.usemingla.com'
    AND host.status = 'active' AND host.is_primary
    AND site.status = 'published' AND publication.status = 'published'
    AND publication.artifact_key IS NOT NULL
    AND publication.artifact_digest IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_consume_attribution(
  p_token_digest text,
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_touch public.brand_site_attribution_touches%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_touch FROM public.brand_site_attribution_touches
    WHERE token_digest = p_token_digest FOR UPDATE;
  IF v_touch.expires_at <= clock_timestamp() OR v_touch.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'sites_attribution_forbidden';
  END IF;
  UPDATE public.brand_site_attribution_touches
    SET consumed_at = clock_timestamp(), order_id = p_order_id
    WHERE id = v_touch.id AND consumed_at IS NULL;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id, metadata
  ) VALUES (
    v_touch.site_id, v_touch.brand_id, 'system', 'attribution.consumed',
    'attribution_touch', v_touch.id::text, '{}'::jsonb
  );
  RETURN jsonb_build_object('accepted', true, 'touch_id', v_touch.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_record_analytics_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_event_id uuid;
  v_occurred_at timestamptz;
BEGIN
  IF NOT public.brand_site_json_keys_allowed(
    p_event,
    ARRAY['event_name','occurred_at','site_id','brand_id','publication_id',
      'page_role','cta_kind','offering_id','referrer_class',
      'consent_policy_version','event_id']
  ) THEN RAISE EXCEPTION 'sites_validation_failed'; END IF;
  v_event_id := (p_event->>'event_id')::uuid;
  v_occurred_at := COALESCE((p_event->>'occurred_at')::timestamptz, now());
  IF v_occurred_at < now() - interval '24 hours' OR v_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites
    WHERE id = (p_event->>'site_id')::uuid
      AND brand_id = (p_event->>'brand_id')::uuid;
  SELECT * INTO STRICT v_publication FROM public.brand_site_publications
    WHERE id = (p_event->>'publication_id')::uuid
      AND site_id = v_site.id AND status = 'published';
  IF v_site.active_publication_id <> v_publication.id THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  INSERT INTO public.brand_site_analytics_events(
    event_id, site_id, brand_id, publication_id, event_name, occurred_at,
    page_role, cta_kind, offering_id, referrer_class, consent_policy_version
  ) VALUES (
    v_event_id, v_site.id, v_site.brand_id, v_publication.id,
    p_event->>'event_name', v_occurred_at, NULLIF(p_event->>'page_role',''),
    NULLIF(p_event->>'cta_kind',''), NULLIF(p_event->>'offering_id','')::uuid,
    NULLIF(p_event->>'referrer_class',''), p_event->>'consent_policy_version'
  ) ON CONFLICT (event_id) DO NOTHING;
  RETURN jsonb_build_object('accepted', true, 'event_id', v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_customer_analytics(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id FROM public.brand_sites WHERE id = p_site_id;
  IF auth.uid() IS NULL OR public.biz_brand_effective_rank(v_brand_id, auth.uid()) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'site_id', p_site_id,
      'issued_handoffs', count(*),
      'consumed_handoffs', count(*) FILTER (WHERE consumed_at IS NOT NULL),
      'events_30d', (
        SELECT count(*) FROM public.brand_site_analytics_events event
        WHERE event.site_id = p_site_id AND event.occurred_at >= now() - interval '30 days'
      ),
      'generated_at', now()
    ) FROM public.brand_site_attribution_touches WHERE site_id = p_site_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_customer_audit(p_site_id uuid)
RETURNS TABLE (
  occurred_at timestamptz,
  action text,
  resource_kind text,
  resource_id text,
  operation_id uuid,
  metadata jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id FROM public.brand_sites WHERE id = p_site_id;
  IF auth.uid() IS NULL OR public.biz_brand_effective_rank(v_brand_id, auth.uid()) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN QUERY SELECT log.occurred_at, log.action, log.resource_kind,
    log.resource_id, log.operation_id, log.metadata
  FROM public.brand_site_audit_log log
  WHERE log.site_id = p_site_id ORDER BY log.occurred_at DESC LIMIT 100;
END;
$$;

-- The operations console reads through guard-first projections. It never gains
-- direct table access and never receives editor exchange digests, gateway
-- nonces, attribution tokens, service origins, or credential material.
CREATE OR REPLACE FUNCTION public.brand_site_admin_list(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.brand_sites site
  JOIN public.brands brand ON brand.id = site.brand_id
  WHERE v_search IS NULL
    OR brand.name ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
    OR site.id::text = v_search
    OR site.brand_id::text = v_search;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.updated_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT site.id AS site_id, site.brand_id, brand.name AS brand_name,
      site.status, site.renderer_key, site.renderer_version,
      site.active_publication_id, site.last_successful_publication_id,
      site.provisioning_error_code AS safe_error_code, site.updated_at,
      host.hostname AS permanent_hostname, host.status AS host_status,
      publication.completed_at AS last_published_at,
      CASE
        WHEN site.payload_tenant_id IS NULL THEN 'not_configured'
        WHEN site.status = 'error' THEN 'attention_needed'
        ELSE 'ready'
      END AS editor_health,
      CASE
        WHEN site.status = 'suspended' THEN 'suspended'
        WHEN config.pilot_enabled AND publication.id IS NOT NULL AND host.status = 'active'
          THEN 'verified'
        WHEN publication.id IS NOT NULL THEN 'last_good_ready'
        ELSE 'not_published'
      END AS public_health,
      NULL::integer AS media_backlog,
      COALESCE(config.pilot_enabled, false) AS pilot_enabled
    FROM public.brand_sites site
    JOIN public.brands brand ON brand.id = site.brand_id
    LEFT JOIN LATERAL (
      SELECT h.hostname, h.status
      FROM public.brand_site_hosts h
      WHERE h.site_id = site.id AND h.is_primary
      ORDER BY h.created_at DESC LIMIT 1
    ) host ON true
    LEFT JOIN public.brand_site_publications publication
      ON publication.id = site.active_publication_id
    LEFT JOIN public.brand_site_service_config config
      ON config.config_key = 'sites_v1'
      AND config.pilot_site_id = site.id
      AND config.pilot_brand_id = site.brand_id
    WHERE v_search IS NULL
      OR brand.name ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
      OR site.id::text = v_search
      OR site.brand_id::text = v_search
    ORDER BY site.updated_at DESC
    LIMIT v_limit OFFSET v_offset
  ) row_value;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_admin_detail(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;

  SELECT jsonb_build_object(
    'site', jsonb_build_object(
      'site_id', site.id, 'brand_id', site.brand_id, 'brand_name', brand.name,
      'status', site.status, 'renderer_key', site.renderer_key,
      'renderer_version', site.renderer_version,
      'active_publication_id', site.active_publication_id,
      'last_successful_publication_id', site.last_successful_publication_id,
      'safe_error_code', site.provisioning_error_code,
      'created_at', site.created_at, 'updated_at', site.updated_at,
      'suspended_at', site.suspended_at,
      'suspension_reason_code', site.suspension_reason_code
    ),
    'hosts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'hostname', host.hostname, 'kind', host.kind, 'status', host.status,
        'is_primary', host.is_primary, 'activated_at', host.activated_at
      ) ORDER BY host.created_at DESC)
      FROM public.brand_site_hosts host WHERE host.site_id = site.id
    ), '[]'::jsonb),
    'publications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'publication_id', publication.id, 'operation_id', publication.operation_id,
        'source_revision_id', publication.source_revision_id,
        'source_digest', publication.source_digest,
        'artifact_digest', publication.artifact_digest,
        'artifact_schema_version', publication.artifact_schema_version,
        'renderer_key', publication.renderer_key,
        'renderer_version', publication.renderer_version,
        'status', publication.status,
        'previous_publication_id', publication.previous_publication_id,
        'rollback_source_publication_id', publication.rollback_source_publication_id,
        'failure_code', publication.failure_code,
        'requested_at', publication.requested_at,
        'completed_at', publication.completed_at
      ) ORDER BY publication.requested_at DESC)
      FROM (
        SELECT * FROM public.brand_site_publications
        WHERE site_id = site.id ORDER BY requested_at DESC LIMIT 25
      ) publication
    ), '[]'::jsonb),
    'receipts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'operation_id', receipt.operation_id, 'kind', receipt.kind,
        'status', receipt.status, 'error_code', receipt.error_code,
        'authorized_at', receipt.authorized_at, 'started_at', receipt.started_at,
        'completed_at', receipt.completed_at, 'updated_at', receipt.updated_at
      ) ORDER BY receipt.updated_at DESC)
      FROM (
        SELECT * FROM public.brand_site_operation_receipts
        WHERE site_id = site.id ORDER BY updated_at DESC LIMIT 50
      ) receipt
    ), '[]'::jsonb),
    'audit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'occurred_at', audit.occurred_at, 'actor_kind', audit.actor_kind,
        'action', audit.action, 'resource_kind', audit.resource_kind,
        'resource_id', audit.resource_id, 'operation_id', audit.operation_id,
        'metadata', audit.metadata
      ) ORDER BY audit.occurred_at DESC)
      FROM (
        SELECT * FROM public.brand_site_audit_log
        WHERE site_id = site.id ORDER BY occurred_at DESC LIMIT 100
      ) audit
    ), '[]'::jsonb),
    'health', jsonb_build_object(
      'editor', CASE WHEN site.payload_tenant_id IS NULL THEN 'not_configured'
        WHEN site.status = 'error' THEN 'attention_needed' ELSE 'ready' END,
      'public', CASE WHEN site.status = 'suspended' THEN 'suspended'
        WHEN config.pilot_enabled AND site.active_publication_id IS NOT NULL THEN 'verified'
        WHEN site.active_publication_id IS NOT NULL THEN 'last_good_ready'
        ELSE 'not_published' END,
      'media', 'not_reported', 'backup', 'not_reported'
    ),
    'readiness', jsonb_build_object(
      'pilot_enabled', COALESCE(config.pilot_enabled, false),
      'backup_entitlement_verified_at', config.backup_entitlement_verified_at,
      'backup_retention_days', config.backup_retention_days,
      'backup_last_verified_at', config.database_backup_verified_at,
      'manifest_last_verified_at', config.object_manifest_verified_at,
      'restore_last_tested_at', config.restore_drill_verified_at,
      'backup_age_hours', CASE WHEN config.database_backup_verified_at IS NULL THEN NULL
        ELSE extract(epoch FROM (now() - config.database_backup_verified_at)) / 3600 END,
      'manifest_age_hours', CASE WHEN config.object_manifest_verified_at IS NULL THEN NULL
        ELSE extract(epoch FROM (now() - config.object_manifest_verified_at)) / 3600 END,
      'restore_age_days', CASE WHEN config.restore_drill_verified_at IS NULL THEN NULL
        ELSE extract(epoch FROM (now() - config.restore_drill_verified_at)) / 86400 END,
      'media_counts', jsonb_build_object('processing', NULL, 'failed', NULL, 'ready', NULL)
    )
  ) INTO v_result
  FROM public.brand_sites site
  JOIN public.brands brand ON brand.id = site.brand_id
  LEFT JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1'
    AND config.pilot_site_id = site.id
    AND config.pilot_brand_id = site.brand_id
  WHERE site.id = p_site_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'sites_not_found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_admin_action(
  p_site_id uuid,
  p_operation_id uuid,
  p_action text,
  p_reason_code text,
  p_target_operation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_kind text;
  v_status text;
  v_arguments_digest text;
  v_target_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_target_publication public.brand_site_publications%ROWTYPE;
  v_target_status text;
  v_reconciled boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_action NOT IN ('reconcile','suspend','resume','revoke_editor_sessions')
    OR p_reason_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF (p_action = 'reconcile') <> (p_target_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  SELECT * INTO STRICT v_site FROM public.brand_sites
  WHERE id = p_site_id FOR UPDATE;
  v_kind := CASE WHEN p_action = 'revoke_editor_sessions'
    THEN 'revoke_sessions' ELSE p_action END;
  v_arguments_digest := encode(extensions.digest(
    p_site_id::text || ':' || p_action || ':' || p_reason_code || ':' ||
      COALESCE(p_target_operation_id::text, '-'),
    'sha256'
  ), 'hex');

  SELECT receipt.status INTO v_status
  FROM public.brand_site_operation_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.brand_site_operation_receipts receipt
      WHERE receipt.operation_id = p_operation_id
        AND receipt.site_id = p_site_id
        AND receipt.kind = v_kind
        AND receipt.arguments_digest = v_arguments_digest
    ) THEN
      RETURN jsonb_build_object(
        'operation_id', p_operation_id, 'site_id', p_site_id,
        'status', v_status, 'replayed', true,
        'target_operation_id', p_target_operation_id
      );
    END IF;
    RAISE EXCEPTION 'sites_idempotency_conflict';
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE public.brand_sites SET status = 'suspended', suspended_at = now(),
      suspended_by = auth.uid(), suspension_reason_code = p_reason_code
    WHERE id = p_site_id AND status <> 'suspended';
    UPDATE public.brand_site_hosts SET status = 'suspended'
    WHERE site_id = p_site_id AND status = 'active';
  ELSIF p_action = 'resume' THEN
    IF v_site.status <> 'suspended' THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;
    UPDATE public.brand_sites SET
      status = CASE WHEN active_publication_id IS NULL THEN 'draft' ELSE 'published' END,
      suspended_at = NULL, suspended_by = NULL, suspension_reason_code = NULL
    WHERE id = p_site_id;
    UPDATE public.brand_site_hosts host SET status = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.brand_site_service_config config
        WHERE config.config_key = 'sites_v1' AND config.pilot_enabled
          AND config.pilot_site_id = p_site_id
      ) THEN 'active' ELSE 'pending' END
    WHERE host.site_id = p_site_id AND host.status = 'suspended';
  ELSIF p_action = 'revoke_editor_sessions' THEN
    UPDATE public.brand_site_editor_exchanges SET status = 'revoked', revoked_at = now()
    WHERE site_id = p_site_id AND status = 'issued';
  ELSIF p_action = 'reconcile' THEN
    SELECT * INTO STRICT v_target_receipt
    FROM public.brand_site_operation_receipts receipt
    WHERE receipt.site_id = p_site_id
      AND receipt.operation_id = p_target_operation_id
      AND receipt.status = 'ambiguous'
    FOR UPDATE;
    SELECT * INTO v_target_publication
    FROM public.brand_site_publications publication
    WHERE publication.site_id = p_site_id
      AND publication.operation_id = p_target_operation_id;

    IF v_target_receipt.kind = 'provision' AND v_site.payload_tenant_id IS NOT NULL THEN
      UPDATE public.brand_site_operation_receipts
      SET status = 'succeeded', error_code = NULL, completed_at = clock_timestamp(),
        result_summary = jsonb_build_object(
          'site_id', p_site_id, 'status', 'succeeded'
        )
      WHERE operation_id = p_target_operation_id;
      v_target_status := 'succeeded';
      v_reconciled := true;
    ELSIF v_target_publication.id IS NOT NULL
      AND v_target_publication.status = 'published' THEN
      UPDATE public.brand_site_operation_receipts
      SET status = 'succeeded', error_code = NULL, completed_at = clock_timestamp(),
        result_summary = jsonb_build_object(
          'site_id', p_site_id,
          'publication_id', v_target_publication.id,
          'artifact_digest', v_target_publication.artifact_digest,
          'status', 'succeeded'
        )
      WHERE operation_id = p_target_operation_id;
      v_target_status := 'succeeded';
      v_reconciled := true;
    ELSIF v_target_publication.id IS NOT NULL
      AND v_target_publication.status = 'failed' THEN
      UPDATE public.brand_site_operation_receipts
      SET status = 'failed',
        error_code = COALESCE(v_target_publication.failure_code,
          'PUBLISH_FAILED_LAST_GOOD_PRESERVED'),
        completed_at = clock_timestamp(),
        result_summary = jsonb_build_object(
          'site_id', p_site_id,
          'publication_id', v_target_publication.id,
          'status', 'failed',
          'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL,
          'retryable', false
        )
      WHERE operation_id = p_target_operation_id;
      v_target_status := 'failed';
      v_reconciled := true;
    ELSE
      v_target_status := 'ambiguous';
    END IF;
  END IF;

  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at, completed_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, auth.uid(), v_kind,
    v_arguments_digest, 'succeeded',
    jsonb_build_object('site_id', p_site_id, 'status', 'succeeded'),
    now(), now()
  );

  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, auth.uid(), 'admin',
    CASE p_action
      WHEN 'suspend' THEN 'site.suspended'
      WHEN 'resume' THEN 'site.resumed'
      WHEN 'revoke_editor_sessions' THEN 'editor.sessions_revoked'
      ELSE CASE WHEN v_reconciled
        THEN 'publication.reconciled'
        ELSE 'operation.reconcile_checked' END
    END,
    CASE WHEN p_action = 'reconcile' THEN 'operation' ELSE 'brand_site' END,
    CASE WHEN p_action = 'reconcile'
      THEN p_target_operation_id::text ELSE p_site_id::text END,
    p_operation_id,
    jsonb_build_object(
      'reason_code', p_reason_code,
      'status', CASE WHEN p_action = 'reconcile' THEN v_target_status ELSE 'succeeded' END
    )
  );

  RETURN jsonb_build_object(
    'operation_id', p_operation_id, 'site_id', p_site_id,
    'status', 'succeeded', 'replayed', false,
    'target_operation_id', p_target_operation_id,
    'target_status', v_target_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.brand_site_json_keys_allowed(jsonb,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_provision(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_issue_editor_exchange(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_authorize_operation(uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_consume_editor_exchange(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_complete_provision(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_complete_preview(uuid,uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_commercial_projection(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_mark_operation_ambiguous(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_internal_authorize(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_resolve_publication(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_consume_attribution(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_record_analytics_event(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_customer_analytics(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_customer_audit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_admin_list(text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_admin_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_admin_action(uuid,uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_provision(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_issue_editor_exchange(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_authorize_operation(uuid,uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_customer_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_customer_audit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_list(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_action(uuid,uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_consume_editor_exchange(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_provision(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_preview(uuid,uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_commercial_projection(uuid,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_mark_operation_ambiguous(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_internal_authorize(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_publication(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_consume_attribution(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_record_analytics_event(jsonb) TO service_role;

COMMENT ON TABLE public.brand_sites IS
  '#2830 Core-owned site identity, renderer and last-good publication pointers.';
COMMENT ON TABLE public.brand_site_service_config IS
  '#2830 private nonsecret service origins and disabled-by-default Gogi pilot binding.';
COMMENT ON FUNCTION public.brand_site_resolve_publication(text) IS
  '#2830 exact-host, active-pointer-only public runtime projection; never returns draft state.';
