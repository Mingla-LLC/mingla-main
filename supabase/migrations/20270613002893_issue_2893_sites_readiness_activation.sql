-- Issue #2893 — forward-only live-readiness and Gogi activation repair.
--
-- This migration intentionally does not edit the merged Sites foundation.
-- It turns the disabled pilot row into a controlled service boundary, records
-- immutable readiness receipts, and makes host activation a single fail-closed
-- transaction.  No customer-supplied hostname or provider value enters these
-- routines.

ALTER TABLE public.brand_site_service_config
  ADD COLUMN backup_bundle_evidence_digest text,
  ADD COLUMN object_manifest_evidence_digest text,
  ADD COLUMN host_readiness_verified_at timestamptz,
  ADD COLUMN host_readiness_hostname text,
  ADD COLUMN tls_evidence_digest text,
  ADD COLUMN public_probe_evidence_digest text,
  ADD COLUMN public_probe_publication_id uuid REFERENCES public.brand_site_publications(id),
  ADD COLUMN public_probe_artifact_digest text;

ALTER TABLE public.brand_site_service_config
  ADD CONSTRAINT brand_site_service_config_backup_digest_ck CHECK (
    backup_bundle_evidence_digest IS NULL OR
    backup_bundle_evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT brand_site_service_config_manifest_digest_ck CHECK (
    object_manifest_evidence_digest IS NULL OR
    object_manifest_evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT brand_site_service_config_host_readiness_ck CHECK (
    (host_readiness_verified_at IS NULL AND host_readiness_hostname IS NULL
      AND tls_evidence_digest IS NULL AND public_probe_evidence_digest IS NULL
      AND public_probe_publication_id IS NULL AND public_probe_artifact_digest IS NULL)
    OR
    (host_readiness_verified_at IS NOT NULL
      AND host_readiness_hostname = 'gogi.sites.usemingla.com'
      AND tls_evidence_digest ~ '^[0-9a-f]{64}$'
      AND public_probe_evidence_digest ~ '^[0-9a-f]{64}$'
      AND public_probe_publication_id IS NOT NULL
      AND public_probe_artifact_digest ~ '^[0-9a-f]{64}$')
  );

CREATE TABLE public.brand_site_readiness_receipts (
  operation_id uuid PRIMARY KEY,
  site_id uuid REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'pilot_configuration','nightly_backup','restore_drill','host_probe',
    'pilot_activation','pilot_deactivation'
  )),
  body_digest text NOT NULL CHECK (body_digest ~ '^[0-9a-f]{64}$'),
  evidence_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.brand_site_readiness_receipts IS
  'Private immutable #2893 service receipts. Digests, counts, and timestamps only; no object keys, provider payloads, or customer content.';

CREATE OR REPLACE FUNCTION public.brand_site_readiness_receipt_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION 'brand_site_readiness_receipt_immutable';
END;
$$;

CREATE TRIGGER brand_site_readiness_receipt_immutable
BEFORE UPDATE OR DELETE ON public.brand_site_readiness_receipts
FOR EACH ROW EXECUTE FUNCTION public.brand_site_readiness_receipt_immutable();

ALTER TABLE public.brand_site_readiness_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_readiness_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_readiness_receipts
  FROM PUBLIC, anon, authenticated, service_role;

-- The original migration necessarily granted service_role broad bootstrap
-- access.  Once these routines exist, direct config/host writes would bypass
-- their evidence gates, so service_role retains readback but loses DML.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.brand_site_service_config FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.brand_site_hosts FROM service_role;
GRANT SELECT ON TABLE public.brand_site_service_config TO service_role;
GRANT SELECT ON TABLE public.brand_site_hosts TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_configure_pilot_binding(
  p_brand_id uuid,
  p_site_id uuid,
  p_cms_origin text,
  p_public_runtime_origin text,
  p_operator_user_id uuid,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_existing public.brand_site_service_config%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_digest text;
  v_result jsonb;
  v_accepted_at timestamptz := clock_timestamp();
BEGIN
  IF p_brand_id <> '733bc470-45e1-4684-8896-acd7e26074ff'::uuid
    OR p_operator_user_id <> '1f3d2ddf-b741-4e2f-8884-d7222a660c7e'::uuid
    OR p_operation_id IS NULL
    OR p_cms_origin <> 'https://studio.sites.usemingla.com'
    OR p_public_runtime_origin <> 'https://gogi.sites.usemingla.com'
    OR p_cms_origin !~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
    OR p_public_runtime_origin !~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
    OR p_cms_origin ~ '(localhost|127\.0\.0\.1|@|\*|\?|#)'
    OR p_public_runtime_origin ~ '(localhost|127\.0\.0\.1|@|\*|\?|#)'
    OR NOT EXISTS (SELECT 1 FROM public.brands brand WHERE brand.id = p_brand_id)
    OR NOT EXISTS (SELECT 1 FROM auth.users account WHERE account.id = p_operator_user_id) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_sites site
    WHERE site.id = p_site_id AND site.brand_id = p_brand_id
  ) THEN
    RAISE EXCEPTION 'sites_pilot_binding_mismatch';
  END IF;

  v_digest := encode(extensions.digest(
    concat_ws(E'\n', p_brand_id::text, COALESCE(p_site_id::text, '-'),
      p_cms_origin, p_public_runtime_origin, p_operator_user_id::text),
    'sha256'
  ), 'hex');
  SELECT * INTO v_receipt
  FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.evidence_kind <> 'pilot_configuration'
      OR v_receipt.brand_id <> p_brand_id
      OR v_receipt.site_id IS DISTINCT FROM p_site_id
      OR v_receipt.body_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;

  SELECT * INTO v_existing
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
  FOR UPDATE;
  IF FOUND AND (
    v_existing.pilot_enabled
    OR v_existing.pilot_brand_id IS DISTINCT FROM p_brand_id
    OR (v_existing.pilot_site_id IS NOT NULL
      AND v_existing.pilot_site_id IS DISTINCT FROM p_site_id)
  ) THEN
    RAISE EXCEPTION 'sites_pilot_binding_immutable';
  END IF;

  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    pilot_brand_id, pilot_site_id, pilot_enabled,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES (
    'sites_v1', p_cms_origin, p_public_runtime_origin, 'sites.usemingla.com',
    p_brand_id, p_site_id, false,
    p_operator_user_id, v_accepted_at, p_operator_user_id, v_accepted_at
  )
  ON CONFLICT (config_key) DO UPDATE SET
    cms_origin = EXCLUDED.cms_origin,
    public_runtime_origin = EXCLUDED.public_runtime_origin,
    pilot_brand_id = EXCLUDED.pilot_brand_id,
    pilot_site_id = COALESCE(EXCLUDED.pilot_site_id,
      public.brand_site_service_config.pilot_site_id),
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  v_result := jsonb_build_object(
    'site_id', p_site_id,
    'brand_id', p_brand_id,
    'status', 'configured',
    'pilot_enabled', false
  );
  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, p_brand_id, 'pilot_configuration', v_digest,
    jsonb_build_object('configured_by', p_operator_user_id),
    v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_record_readiness_evidence(
  p_site_id uuid,
  p_operation_id uuid,
  p_body_digest text,
  p_evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_kind text;
  v_observed_at timestamptz;
  v_database_at timestamptz;
  v_manifest_at timestamptz;
  v_restore_at timestamptz;
  v_retention integer;
  v_object_count bigint;
  v_object_bytes bigint;
  v_tenant_count bigint;
  v_document_count bigint;
  v_accepted_at timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF p_body_digest !~ '^[0-9a-f]{64}$'
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object'
    OR p_evidence->>'schema_version' <> '1' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_kind := p_evidence->>'evidence_kind';
  IF v_kind NOT IN ('nightly_backup','restore_drill') THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  SELECT * INTO STRICT v_config
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
    AND config.pilot_site_id = p_site_id
  FOR UPDATE;
  SELECT * INTO STRICT v_site
  FROM public.brand_sites site
  WHERE site.id = p_site_id AND site.brand_id = v_config.pilot_brand_id
  FOR SHARE;

  SELECT * INTO v_receipt
  FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id
      OR v_receipt.brand_id <> v_site.brand_id
      OR v_receipt.evidence_kind <> v_kind
      OR v_receipt.body_digest <> p_body_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;

  IF (p_evidence->>'observed_at') !~
      '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_observed_at := (p_evidence->>'observed_at')::timestamptz;
  IF v_observed_at > v_accepted_at + interval '5 minutes' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  IF v_kind = 'nightly_backup' THEN
    IF NOT public.brand_site_json_keys_allowed(p_evidence, ARRAY[
      'schema_version','evidence_kind','observed_at','backup_retention_days',
      'database_backup_verified_at','object_manifest_verified_at',
      'manifest_digest','backup_bundle_digest','object_count','object_bytes'
    ])
      OR jsonb_typeof(p_evidence->'backup_retention_days') <> 'number'
      OR jsonb_typeof(p_evidence->'object_count') <> 'number'
      OR jsonb_typeof(p_evidence->'object_bytes') <> 'number'
      OR (p_evidence->>'backup_retention_days') !~ '^[0-9]+$'
      OR (p_evidence->>'object_count') !~ '^[0-9]+$'
      OR (p_evidence->>'object_bytes') !~ '^[0-9]+$'
      OR (p_evidence->>'database_backup_verified_at') !~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$'
      OR (p_evidence->>'object_manifest_verified_at') !~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$'
      OR (p_evidence->>'manifest_digest') !~ '^[0-9a-f]{64}$'
      OR (p_evidence->>'backup_bundle_digest') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_retention := (p_evidence->>'backup_retention_days')::integer;
    v_object_count := (p_evidence->>'object_count')::bigint;
    v_object_bytes := (p_evidence->>'object_bytes')::bigint;
    v_database_at := (p_evidence->>'database_backup_verified_at')::timestamptz;
    v_manifest_at := (p_evidence->>'object_manifest_verified_at')::timestamptz;
    IF v_retention < 7
      OR v_object_count > 9007199254740991
      OR v_object_bytes > 9007199254740991
      OR v_database_at > v_observed_at OR v_manifest_at > v_observed_at
      OR v_database_at > v_accepted_at + interval '5 minutes'
      OR v_manifest_at > v_accepted_at + interval '5 minutes'
      OR v_database_at <= v_accepted_at - interval '26 hours'
      OR v_manifest_at <= v_accepted_at - interval '26 hours' THEN
      RAISE EXCEPTION 'sites_readiness_blocked';
    END IF;
    UPDATE public.brand_site_service_config SET
      backup_entitlement_verified_at = v_observed_at,
      backup_retention_days = v_retention,
      database_backup_verified_at = v_database_at,
      object_manifest_verified_at = v_manifest_at,
      backup_bundle_evidence_digest = p_evidence->>'backup_bundle_digest',
      object_manifest_evidence_digest = p_evidence->>'manifest_digest',
      updated_at = v_accepted_at
    WHERE config_key = 'sites_v1';
  ELSE
    IF NOT public.brand_site_json_keys_allowed(p_evidence, ARRAY[
      'schema_version','evidence_kind','observed_at','restore_drill_verified_at',
      'restore_drill_evidence_digest','tenant_count','document_count',
      'object_count','object_bytes'
    ])
      OR jsonb_typeof(p_evidence->'tenant_count') <> 'number'
      OR jsonb_typeof(p_evidence->'document_count') <> 'number'
      OR jsonb_typeof(p_evidence->'object_count') <> 'number'
      OR jsonb_typeof(p_evidence->'object_bytes') <> 'number'
      OR (p_evidence->>'tenant_count') !~ '^[0-9]+$'
      OR (p_evidence->>'document_count') !~ '^[0-9]+$'
      OR (p_evidence->>'object_count') !~ '^[0-9]+$'
      OR (p_evidence->>'object_bytes') !~ '^[0-9]+$'
      OR (p_evidence->>'restore_drill_verified_at') !~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$'
      OR (p_evidence->>'restore_drill_evidence_digest') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_tenant_count := (p_evidence->>'tenant_count')::bigint;
    v_document_count := (p_evidence->>'document_count')::bigint;
    v_object_count := (p_evidence->>'object_count')::bigint;
    v_object_bytes := (p_evidence->>'object_bytes')::bigint;
    v_restore_at := (p_evidence->>'restore_drill_verified_at')::timestamptz;
    IF v_tenant_count < 1 OR v_document_count < 1
      OR v_tenant_count > 9007199254740991
      OR v_document_count > 9007199254740991
      OR v_object_count > 9007199254740991
      OR v_object_bytes > 9007199254740991
      OR v_restore_at > v_observed_at
      OR v_restore_at > v_accepted_at + interval '5 minutes'
      OR v_restore_at <= v_accepted_at - interval '100 days' THEN
      RAISE EXCEPTION 'sites_readiness_blocked';
    END IF;
    UPDATE public.brand_site_service_config SET
      restore_drill_verified_at = v_restore_at,
      restore_drill_evidence_digest =
        p_evidence->>'restore_drill_evidence_digest',
      updated_at = v_accepted_at
    WHERE config_key = 'sites_v1';
  END IF;

  SELECT jsonb_build_object(
    'site_id', p_site_id,
    'evidence_kind', v_kind,
    'accepted_at', v_accepted_at,
    'readiness', jsonb_build_object(
      'backup_retention_days', config.backup_retention_days,
      'database_backup_verified_at', config.database_backup_verified_at,
      'object_manifest_verified_at', config.object_manifest_verified_at,
      'restore_drill_verified_at', config.restore_drill_verified_at,
      'restore_drill_evidence_digest', config.restore_drill_evidence_digest
    )
  ) INTO v_result
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1';

  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_kind, p_body_digest,
    p_evidence, v_result, v_accepted_at
  );
  RETURN v_result;
EXCEPTION
  WHEN numeric_value_out_of_range OR invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'sites_validation_failed';
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_record_host_readiness(
  p_site_id uuid,
  p_operation_id uuid,
  p_observed_at timestamptz,
  p_hostname text,
  p_publication_id uuid,
  p_artifact_digest text,
  p_tls_evidence_digest text,
  p_probe_evidence_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_digest text;
  v_result jsonb;
  v_accepted_at timestamptz := clock_timestamp();
BEGIN
  IF p_hostname <> 'gogi.sites.usemingla.com'
    OR p_artifact_digest !~ '^[0-9a-f]{64}$'
    OR p_tls_evidence_digest !~ '^[0-9a-f]{64}$'
    OR p_probe_evidence_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sites_readiness_blocked';
  END IF;
  SELECT * INTO STRICT v_config
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
    AND config.pilot_site_id = p_site_id
  FOR UPDATE;
  SELECT * INTO STRICT v_site
  FROM public.brand_sites site
  WHERE site.id = p_site_id AND site.brand_id = v_config.pilot_brand_id
  FOR SHARE;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, p_observed_at::text, p_hostname, p_publication_id::text,
    p_artifact_digest, p_tls_evidence_digest, p_probe_evidence_digest
  ), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id OR v_receipt.evidence_kind <> 'host_probe'
      OR v_receipt.body_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  IF p_observed_at > v_accepted_at + interval '5 minutes'
    OR p_observed_at <= v_accepted_at - interval '15 minutes' THEN
    RAISE EXCEPTION 'sites_readiness_blocked';
  END IF;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications publication
  WHERE publication.id = p_publication_id
    AND publication.site_id = p_site_id
    AND publication.status = 'published'
    AND publication.artifact_digest = p_artifact_digest;
  IF v_site.status <> 'published'
    OR v_site.active_publication_id <> p_publication_id
    OR v_site.last_successful_publication_id <> p_publication_id
    OR NOT EXISTS (
      SELECT 1 FROM public.brand_site_hosts host
      WHERE host.site_id = p_site_id
        AND host.hostname = 'gogi.sites.usemingla.com'
        AND host.kind = 'mingla_subdomain'
        AND host.is_primary
        AND host.status = 'pending'
    )
    OR COALESCE((v_publication.probe_summary->>'http_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'digest_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'renderer_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'schema_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'canonical_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'assets_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'accessibility_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'consent_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'cta_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'leak_check_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'status_code')::integer, 0) <> 200
    OR v_publication.probe_summary->>'observed_digest' <> p_artifact_digest THEN
    RAISE EXCEPTION 'sites_readiness_blocked';
  END IF;

  UPDATE public.brand_site_service_config SET
    host_readiness_verified_at = p_observed_at,
    host_readiness_hostname = p_hostname,
    tls_evidence_digest = p_tls_evidence_digest,
    public_probe_evidence_digest = p_probe_evidence_digest,
    public_probe_publication_id = p_publication_id,
    public_probe_artifact_digest = p_artifact_digest,
    updated_at = v_accepted_at
  WHERE config_key = 'sites_v1';
  v_result := jsonb_build_object(
    'site_id', p_site_id, 'hostname', p_hostname,
    'publication_id', p_publication_id, 'status', 'verified',
    'accepted_at', v_accepted_at
  );
  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, 'host_probe', v_digest,
    jsonb_build_object(
      'observed_at', p_observed_at, 'hostname', p_hostname,
      'publication_id', p_publication_id, 'artifact_digest', p_artifact_digest,
      'tls_evidence_digest', p_tls_evidence_digest,
      'probe_evidence_digest', p_probe_evidence_digest
    ), v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_activate_gogi_pilot(
  p_brand_id uuid,
  p_site_id uuid,
  p_hostname text,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_digest text;
  v_result jsonb;
  v_accepted_at timestamptz := clock_timestamp();
BEGIN
  IF p_brand_id <> '733bc470-45e1-4684-8896-acd7e26074ff'::uuid
    OR p_hostname <> 'gogi.sites.usemingla.com' THEN
    RAISE EXCEPTION 'sites_pilot_binding_mismatch';
  END IF;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_brand_id::text, p_site_id::text, p_hostname, 'activate'
  ), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.brand_id <> p_brand_id OR v_receipt.site_id <> p_site_id
      OR v_receipt.evidence_kind <> 'pilot_activation'
      OR v_receipt.body_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;

  SELECT * INTO STRICT v_config
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
    AND config.pilot_brand_id = p_brand_id
    AND config.pilot_site_id = p_site_id
    AND config.configured_by = '1f3d2ddf-b741-4e2f-8884-d7222a660c7e'::uuid
    AND config.cms_origin = 'https://studio.sites.usemingla.com'
    AND config.public_runtime_origin = 'https://gogi.sites.usemingla.com'
    AND config.public_host_suffix = 'sites.usemingla.com'
  FOR UPDATE;
  SELECT * INTO STRICT v_site
  FROM public.brand_sites site
  WHERE site.id = p_site_id AND site.brand_id = p_brand_id
  FOR UPDATE;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications publication
  WHERE publication.id = v_site.active_publication_id
    AND publication.site_id = p_site_id
    AND publication.status = 'published';

  IF v_config.pilot_enabled
    OR v_site.status <> 'published'
    OR v_site.active_publication_id IS NULL
    OR v_site.last_successful_publication_id <> v_site.active_publication_id
    OR v_publication.artifact_digest IS NULL
    OR COALESCE(v_config.backup_retention_days, 0) < 7
    OR v_config.backup_entitlement_verified_at IS NULL
    OR v_config.backup_entitlement_verified_at <= v_accepted_at - interval '26 hours'
    OR v_config.database_backup_verified_at IS NULL
    OR v_config.database_backup_verified_at <= v_accepted_at - interval '26 hours'
    OR v_config.object_manifest_verified_at IS NULL
    OR v_config.object_manifest_verified_at <= v_accepted_at - interval '26 hours'
    OR v_config.restore_drill_verified_at IS NULL
    OR v_config.restore_drill_verified_at <= v_accepted_at - interval '100 days'
    OR v_config.host_readiness_verified_at IS NULL
    OR v_config.host_readiness_verified_at <= v_accepted_at - interval '15 minutes'
    OR v_config.host_readiness_hostname <> p_hostname
    OR v_config.backup_bundle_evidence_digest !~ '^[0-9a-f]{64}$'
    OR v_config.object_manifest_evidence_digest !~ '^[0-9a-f]{64}$'
    OR v_config.restore_drill_evidence_digest !~ '^[0-9a-f]{64}$'
    OR v_config.tls_evidence_digest !~ '^[0-9a-f]{64}$'
    OR v_config.public_probe_evidence_digest !~ '^[0-9a-f]{64}$'
    OR v_config.public_probe_publication_id <> v_site.active_publication_id
    OR v_config.public_probe_artifact_digest <> v_publication.artifact_digest
    OR NOT EXISTS (
      SELECT 1 FROM public.brand_site_readiness_receipts receipt
      WHERE receipt.site_id = p_site_id AND receipt.brand_id = p_brand_id
        AND receipt.evidence_kind = 'nightly_backup'
        AND receipt.accepted_at > v_accepted_at - interval '26 hours'
        AND receipt.evidence_payload->>'backup_bundle_digest' =
          v_config.backup_bundle_evidence_digest
        AND receipt.evidence_payload->>'manifest_digest' =
          v_config.object_manifest_evidence_digest
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.brand_site_readiness_receipts receipt
      WHERE receipt.site_id = p_site_id AND receipt.brand_id = p_brand_id
        AND receipt.evidence_kind = 'restore_drill'
        AND receipt.evidence_payload->>'restore_drill_evidence_digest' =
          v_config.restore_drill_evidence_digest
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.brand_site_readiness_receipts receipt
      WHERE receipt.site_id = p_site_id AND receipt.brand_id = p_brand_id
        AND receipt.evidence_kind = 'host_probe'
        AND receipt.accepted_at > v_accepted_at - interval '15 minutes'
        AND receipt.evidence_payload->>'tls_evidence_digest' =
          v_config.tls_evidence_digest
        AND receipt.evidence_payload->>'probe_evidence_digest' =
          v_config.public_probe_evidence_digest
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.brand_site_hosts host
      WHERE host.site_id = p_site_id AND host.hostname = p_hostname
        AND host.kind = 'mingla_subdomain' AND host.is_primary
        AND host.status = 'pending' AND host.activated_at IS NULL
        AND host.retired_at IS NULL
    ) THEN
    RAISE EXCEPTION 'sites_readiness_blocked';
  END IF;

  UPDATE public.brand_site_hosts SET
    status = 'active', activated_at = v_accepted_at
  WHERE site_id = p_site_id AND hostname = p_hostname
    AND kind = 'mingla_subdomain' AND is_primary AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_readiness_blocked'; END IF;
  UPDATE public.brand_site_service_config SET
    pilot_enabled = true, updated_at = v_accepted_at
  WHERE config_key = 'sites_v1' AND NOT pilot_enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_readiness_blocked'; END IF;

  v_result := jsonb_build_object(
    'site_id', p_site_id, 'brand_id', p_brand_id, 'hostname', p_hostname,
    'publication_id', v_site.active_publication_id,
    'status', 'active', 'activated_at', v_accepted_at
  );
  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, p_brand_id, 'pilot_activation', v_digest,
    jsonb_build_object(
      'hostname', p_hostname,
      'publication_id', v_site.active_publication_id,
      'artifact_digest', v_publication.artifact_digest
    ), v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_deactivate_gogi_pilot(
  p_brand_id uuid,
  p_site_id uuid,
  p_hostname text,
  p_operation_id uuid,
  p_reason_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_digest text;
  v_result jsonb;
  v_accepted_at timestamptz := clock_timestamp();
BEGIN
  IF p_brand_id <> '733bc470-45e1-4684-8896-acd7e26074ff'::uuid
    OR p_hostname <> 'gogi.sites.usemingla.com'
    OR p_reason_code !~ '^[A-Z0-9_]{3,64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_brand_id::text, p_site_id::text, p_hostname, p_reason_code, 'deactivate'
  ), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.brand_id <> p_brand_id OR v_receipt.site_id <> p_site_id
      OR v_receipt.evidence_kind <> 'pilot_deactivation'
      OR v_receipt.body_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  SELECT * INTO STRICT v_config
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
    AND config.pilot_brand_id = p_brand_id
    AND config.pilot_site_id = p_site_id
  FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_sites site
    WHERE site.id = p_site_id AND site.brand_id = p_brand_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.brand_site_hosts host
    WHERE host.site_id = p_site_id AND host.hostname = p_hostname
      AND host.kind = 'mingla_subdomain' AND host.is_primary
      AND host.status IN ('active','pending','suspended')
  ) THEN
    RAISE EXCEPTION 'sites_pilot_binding_mismatch';
  END IF;

  UPDATE public.brand_site_service_config SET
    pilot_enabled = false, updated_at = v_accepted_at
  WHERE config_key = 'sites_v1';
  UPDATE public.brand_site_hosts SET
    status = 'pending', activated_at = NULL
  WHERE site_id = p_site_id AND hostname = p_hostname
    AND kind = 'mingla_subdomain' AND is_primary
    AND status IN ('active','suspended');

  v_result := jsonb_build_object(
    'site_id', p_site_id, 'brand_id', p_brand_id, 'hostname', p_hostname,
    'status', 'disabled', 'deactivated_at', v_accepted_at,
    'last_good_preserved', true
  );
  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, p_brand_id, 'pilot_deactivation', v_digest,
    jsonb_build_object('hostname', p_hostname, 'reason_code', p_reason_code),
    v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;

-- Resolution enforces recovery freshness independently of the scheduler. If
-- a nightly workflow never starts, stale evidence still makes the public host
-- disappear while the last-good publication pointer remains intact.
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
    ON publication.id = site.active_publication_id
    AND publication.site_id = site.id
  JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1'
    AND config.pilot_enabled
    AND config.pilot_brand_id = '733bc470-45e1-4684-8896-acd7e26074ff'::uuid
    AND config.pilot_brand_id = site.brand_id
    AND config.pilot_site_id = site.id
    AND config.configured_by = '1f3d2ddf-b741-4e2f-8884-d7222a660c7e'::uuid
    AND config.cms_origin = 'https://studio.sites.usemingla.com'
    AND config.public_runtime_origin = 'https://gogi.sites.usemingla.com'
    AND COALESCE(config.backup_retention_days, 0) >= 7
    AND config.backup_entitlement_verified_at >
      statement_timestamp() - interval '26 hours'
    AND config.database_backup_verified_at >
      statement_timestamp() - interval '26 hours'
    AND config.object_manifest_verified_at >
      statement_timestamp() - interval '26 hours'
    AND config.restore_drill_verified_at >
      statement_timestamp() - interval '100 days'
  WHERE host.hostname = lower(p_hostname)
    AND p_hostname = 'gogi.sites.usemingla.com'
    AND host.status = 'active' AND host.is_primary
    AND site.status = 'published' AND publication.status = 'published'
    AND publication.artifact_key IS NOT NULL
    AND publication.artifact_digest IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_business_availability(
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_site_service_config config
    WHERE config.config_key = 'sites_v1'
      AND p_brand_id = '733bc470-45e1-4684-8896-acd7e26074ff'::uuid
      AND config.pilot_brand_id = p_brand_id
  ) THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  SELECT * INTO v_site FROM public.brand_sites site
  WHERE site.brand_id = p_brand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', true, 'site', NULL);
  END IF;
  RETURN jsonb_build_object(
    'available', true,
    'site', jsonb_build_object(
      'id', v_site.id,
      'brand_id', v_site.brand_id,
      'renderer_key', v_site.renderer_key,
      'renderer_version', v_site.renderer_version,
      'status', v_site.status,
      'active_publication_id', v_site.active_publication_id,
      'last_successful_publication_id', v_site.last_successful_publication_id,
      'provisioning_error_code', v_site.provisioning_error_code,
      'created_at', v_site.created_at,
      'updated_at', v_site.updated_at,
      'brand_site_hosts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'hostname', host.hostname, 'status', host.status,
          'is_primary', host.is_primary
        ) ORDER BY host.is_primary DESC, host.created_at)
        FROM public.brand_site_hosts host WHERE host.site_id = v_site.id
      ), '[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_retention_protection(
  p_site_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH bound_site AS (
    SELECT site.id, site.brand_id, site.active_publication_id,
      site.last_successful_publication_id
    FROM public.brand_sites site
    JOIN public.brand_site_service_config config
      ON config.config_key = 'sites_v1'
      AND config.pilot_site_id = site.id
      AND config.pilot_brand_id = site.brand_id
    WHERE site.id = p_site_id
  ), ranked AS (
    SELECT publication.id, publication.artifact_key, publication.requested_at,
      publication.rollback_source_publication_id,
      row_number() OVER (ORDER BY publication.requested_at DESC) AS newest_rank
    FROM public.brand_site_publications publication
    JOIN bound_site site ON site.id = publication.site_id
    WHERE publication.artifact_key IS NOT NULL
  ), protected AS (
    SELECT DISTINCT row.artifact_key, row.requested_at
    FROM ranked row CROSS JOIN bound_site site
    WHERE row.newest_rank <= 50
      OR row.requested_at >= clock_timestamp() - interval '90 days'
      OR row.id IN (site.active_publication_id, site.last_successful_publication_id)
      OR EXISTS (
        SELECT 1 FROM ranked reference
        WHERE reference.rollback_source_publication_id = row.id
      )
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM bound_site) THEN
    jsonb_build_object('protected_artifact_keys', COALESCE((
      SELECT jsonb_agg(artifact_key ORDER BY requested_at DESC) FROM protected
    ), '[]'::jsonb))
  ELSE NULL END;
$$;

ALTER FUNCTION public.brand_site_configure_pilot_binding(uuid,uuid,text,text,uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.brand_site_record_readiness_evidence(uuid,uuid,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.brand_site_record_host_readiness(uuid,uuid,timestamptz,text,uuid,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.brand_site_activate_gogi_pilot(uuid,uuid,text,uuid) OWNER TO postgres;
ALTER FUNCTION public.brand_site_deactivate_gogi_pilot(uuid,uuid,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.brand_site_resolve_publication(text) OWNER TO postgres;
ALTER FUNCTION public.brand_site_business_availability(uuid) OWNER TO postgres;
ALTER FUNCTION public.brand_site_retention_protection(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.brand_site_configure_pilot_binding(uuid,uuid,text,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_record_readiness_evidence(uuid,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_record_host_readiness(uuid,uuid,timestamptz,text,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_activate_gogi_pilot(uuid,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_deactivate_gogi_pilot(uuid,uuid,text,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_resolve_publication(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.brand_site_business_availability(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.brand_site_retention_protection(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.brand_site_configure_pilot_binding(uuid,uuid,text,text,uuid,uuid)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.brand_site_record_readiness_evidence(uuid,uuid,text,jsonb)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.brand_site_record_host_readiness(uuid,uuid,timestamptz,text,uuid,text,text,text)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.brand_site_activate_gogi_pilot(uuid,uuid,text,uuid)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.brand_site_deactivate_gogi_pilot(uuid,uuid,text,uuid,text)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_publication(text)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.brand_site_business_availability(uuid)
  TO authenticated, postgres;
GRANT EXECUTE ON FUNCTION public.brand_site_retention_protection(uuid)
  TO service_role, postgres;

COMMENT ON FUNCTION public.brand_site_record_readiness_evidence(uuid,uuid,text,jsonb) IS
  'Accepts only the signed #2893 nightly_backup or restore_drill v1 evidence contract and returns committed readiness readback.';
COMMENT ON FUNCTION public.brand_site_activate_gogi_pilot(uuid,uuid,text,uuid) IS
  'Atomically promotes only the exact verified Gogi pending host and enables the pilot after fresh immutable readiness evidence.';
COMMENT ON FUNCTION public.brand_site_deactivate_gogi_pilot(uuid,uuid,text,uuid,text) IS
  'Fail-safe Gogi kill switch: disables resolution and returns the active host to pending without clearing last-good publication pointers.';
COMMENT ON FUNCTION public.brand_site_resolve_publication(text) IS
  '#2893 exact Gogi last-good runtime projection with scheduler-independent backup and restore freshness enforcement.';
