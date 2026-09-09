-- Issue #3157 — a publish certified itself green against a path the public
-- cannot reach, and the kill switch left no trace.
--
-- On 2026-09-09 gogi.sites.usemingla.com was dark for 3h13m. The publish at
-- 13:38Z recorded probe_summary = {status_code: 200, http_ok: true, ...} while
-- every public route was already 404: brand_site_service_config.pilot_enabled
-- had been set false, so brand_site_resolve_publication's join was empty. Two
-- gates missed it.
--
--   A. Neither brand_site_activate_gogi_pilot nor
--      brand_site_deactivate_gogi_pilot wrote a brand_site_audit_log row, so a
--      customer's live website went down and came back with nothing to
--      attribute it to. This migration adds the audit write to both, and
--      changes nothing else about either: every precondition, every lock, and
--      the idempotency-receipt replay behaviour are reproduced verbatim.
--
--   B. The publish probe is an INTERNAL candidate probe against the artifact,
--      run BEFORE the live pointer moves. It is structurally incapable of
--      seeing "the site is unreachable". This migration adds
--      brand_site_record_public_reachability, which records a REAL request to
--      the public hostname made AFTER the pointer changed, onto the
--      publication row and into the audit log, and annotates the publish
--      operation receipt so the Website workspace can show it.
--
--      It SURFACES, it does not ACT. It never touches
--      brand_sites.active_publication_id, last_successful_publication_id or
--      brand_site_service_config.pilot_enabled. An automatic rollback on a
--      transient network blip would be worse than the problem it solves.
--
--   C. The reactivation gate is deliberately NOT tightened — see the comment
--      on brand_site_activate_gogi_pilot at the bottom of this file.

-- ---------------------------------------------------------------------------
-- Vocabulary. Three new audit actions, five new audit metadata keys, three new
-- operation-receipt result keys, one new readiness evidence kind. Nothing is
-- removed from any list; every existing member is reproduced verbatim.
-- ---------------------------------------------------------------------------

ALTER TABLE public.brand_site_audit_log
  DROP CONSTRAINT brand_site_audit_log_action_check,
  ADD CONSTRAINT brand_site_audit_log_action_check CHECK (action IN (
    'site.provision_requested','site.provisioned','site.provision_failed',
    'editor.exchange_issued','editor.exchange_consumed','editor.sessions_revoked',
    'preview.requested','preview.created',
    'publication.requested','publication.published','publication.failed',
    'publication.reconciled','publication.rollback_requested',
    'publication.public_check',
    'operation.reconcile_checked',
    'site.suspended','site.resumed','attribution.consumed',
    'pilot.activated','pilot.deactivated'
  ));

ALTER TABLE public.brand_site_audit_log
  DROP CONSTRAINT brand_site_audit_metadata_ck,
  ADD CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved',
        'hostname','publication_id','status_code','reachable','digest_ok']
    )
  );

ALTER TABLE public.brand_site_operation_receipts
  DROP CONSTRAINT brand_site_receipts_result_ck,
  ADD CONSTRAINT brand_site_receipts_result_ck CHECK (
    public.brand_site_json_keys_allowed(
      result_summary,
      ARRAY['site_id','publication_id','status','destination','expires_at',
        'revision_id','artifact_digest','last_good_preserved','retryable',
        'brand_id','user_id','rank','generated_at',
        'rollback_source_publication_id',
        'public_reachable','public_status_code','public_checked_at']
    )
  );

ALTER TABLE public.brand_site_readiness_receipts
  DROP CONSTRAINT brand_site_readiness_receipts_evidence_kind_check,
  ADD CONSTRAINT brand_site_readiness_receipts_evidence_kind_check CHECK (
    evidence_kind IN (
      'pilot_configuration','nightly_backup','restore_drill','host_probe',
      'pilot_activation','pilot_deactivation','public_check'
    )
  );

-- ---------------------------------------------------------------------------
-- What the public host actually served, recorded on the publication itself.
-- public_status_code is NULL when the request never completed at all (DNS,
-- TLS, connect, timeout) — that is the shape of the outage this issue is
-- about, so it has to be representable.
-- ---------------------------------------------------------------------------

ALTER TABLE public.brand_site_publications
  ADD COLUMN public_checked_at timestamptz,
  ADD COLUMN public_status_code integer,
  ADD COLUMN public_reachable boolean;

ALTER TABLE public.brand_site_publications
  ADD CONSTRAINT brand_site_publications_public_check_ck CHECK (
    (public_checked_at IS NULL AND public_status_code IS NULL
      AND public_reachable IS NULL)
    OR (public_checked_at IS NOT NULL AND public_reachable IS NOT NULL
      AND (public_status_code IS NULL
        OR public_status_code BETWEEN 100 AND 599))
  );

COMMENT ON COLUMN public.brand_site_publications.public_checked_at IS
  '#3157 when a real HTTPS request was made to the public hostname AFTER this publication became the live pointer. NULL means no post-pointer check has been recorded.';
COMMENT ON COLUMN public.brand_site_publications.public_status_code IS
  '#3157 HTTP status the public hostname returned. NULL means the request never completed (DNS/TLS/connect/timeout).';
COMMENT ON COLUMN public.brand_site_publications.public_reachable IS
  '#3157 whether the public hostname answered 2xx. This is the only reachability signal in the schema that is not derived from the internal candidate probe.';

-- ---------------------------------------------------------------------------
-- Terminal rows take exactly ONE additive annotation, and no more.
--
-- A published publication and a succeeded receipt are terminal on purpose: the
-- record of what shipped must not be rewritable. But the public check is an
-- observation made strictly AFTER the row reaches its terminal state, so
-- without a narrow exception it could never be attached to the thing it is
-- about. Both guards below therefore admit one write-once change to the #3157
-- observation fields and nothing else — any other column movement on a
-- terminal row still raises, exactly as before.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.brand_site_enforce_publication_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_probe public.brand_site_publications%ROWTYPE;
BEGIN
  -- #3157 write-once post-pointer reachability annotation.
  IF OLD.status = 'published'
    AND OLD.public_checked_at IS NULL
    AND NEW.public_checked_at IS NOT NULL THEN
    v_probe := NEW;
    v_probe.public_checked_at := OLD.public_checked_at;
    v_probe.public_status_code := OLD.public_status_code;
    v_probe.public_reachable := OLD.public_reachable;
    IF v_probe IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;
  END IF;
  IF OLD.status IN ('published','failed','rolled_back') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'brand_site_publication_terminal';
  END IF;
  IF OLD.status = 'ambiguous' AND NEW.status NOT IN ('ambiguous','published','failed') THEN
    RAISE EXCEPTION 'brand_site_publication_reconciliation_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_enforce_receipt_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_probe public.brand_site_operation_receipts%ROWTYPE;
BEGIN
  -- #3157 write-once post-pointer reachability annotation on a publish receipt.
  IF OLD.status = 'succeeded'
    AND OLD.kind = 'publish'
    AND NOT (COALESCE(OLD.result_summary, '{}'::jsonb) ? 'public_reachable')
    AND COALESCE(NEW.result_summary, '{}'::jsonb) ? 'public_reachable' THEN
    v_probe := NEW;
    v_probe.result_summary := OLD.result_summary;
    v_probe.updated_at := OLD.updated_at;
    IF v_probe IS NOT DISTINCT FROM OLD
      AND (NEW.result_summary
        - ARRAY['public_reachable','public_status_code','public_checked_at'])
        IS NOT DISTINCT FROM COALESCE(OLD.result_summary, '{}'::jsonb) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF OLD.status IN ('succeeded','failed') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'brand_site_receipt_terminal';
  END IF;
  IF OLD.status = 'ambiguous' AND NEW.status NOT IN ('ambiguous','succeeded','failed') THEN
    RAISE EXCEPTION 'brand_site_receipt_reconciliation_required';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- PART B — the post-pointer public reachability record.
--
-- The caller (brand-site-cms-callback, immediately after
-- brand_site_complete_publication has moved the live pointer) fetches the
-- site's real public hostname over HTTPS and passes what it saw. This routine
-- stores it, audits it, and hands the outcome back for the operation receipt.
-- It deliberately has no power to change what is live.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.brand_site_record_public_reachability(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid,
  p_observed_at timestamptz,
  p_status_code integer,
  p_observed_digest text,
  p_reachable boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_hostname text;
  v_digest_ok boolean;
  v_body_digest text;
  v_annotated boolean := false;
  v_result jsonb;
  v_accepted_at timestamptz := clock_timestamp();
BEGIN
  IF p_site_id IS NULL OR p_operation_id IS NULL OR p_publication_id IS NULL
    OR p_observed_at IS NULL OR p_reachable IS NULL
    OR (p_status_code IS NOT NULL
      AND (p_status_code < 100 OR p_status_code > 599))
    OR (p_observed_digest IS NOT NULL
      AND p_observed_digest !~ '^[0-9a-f]{64}$')
    OR p_observed_at > v_accepted_at + interval '5 minutes'
    OR p_observed_at <= v_accepted_at - interval '60 minutes' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  v_body_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, p_publication_id::text, p_observed_at::text,
    COALESCE(p_status_code::text, '-'), COALESCE(p_observed_digest, '-'),
    p_reachable::text
  ), 'sha256'), 'hex');

  SELECT * INTO v_receipt FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id IS DISTINCT FROM p_site_id
      OR v_receipt.evidence_kind <> 'public_check'
      OR v_receipt.body_digest <> v_body_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;

  SELECT * INTO STRICT v_site FROM public.brand_sites site
  WHERE site.id = p_site_id FOR SHARE;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications publication
  WHERE publication.id = p_publication_id AND publication.site_id = p_site_id
  FOR UPDATE;

  SELECT host.hostname INTO v_hostname
  FROM public.brand_site_hosts host
  WHERE host.site_id = p_site_id AND host.is_primary
    AND host.kind = 'mingla_subdomain' AND host.retired_at IS NULL
  ORDER BY host.created_at LIMIT 1;

  v_digest_ok := p_observed_digest IS NOT NULL
    AND v_publication.artifact_digest IS NOT NULL
    AND p_observed_digest = v_publication.artifact_digest;

  UPDATE public.brand_site_publications SET
    public_checked_at = p_observed_at,
    public_status_code = p_status_code,
    public_reachable = p_reachable
  WHERE id = p_publication_id;

  -- The Website workspace reads the operation receipt, so the outcome has to
  -- land there too. Write-once, additive, and only onto the publish receipt
  -- this check belongs to.
  UPDATE public.brand_site_operation_receipts SET
    result_summary = COALESCE(result_summary, '{}'::jsonb) || jsonb_build_object(
      'public_reachable', p_reachable,
      'public_status_code', p_status_code,
      'public_checked_at', p_observed_at
    )
  WHERE operation_id = p_operation_id AND site_id = p_site_id
    AND kind = 'publish' AND status = 'succeeded'
    AND NOT (COALESCE(result_summary, '{}'::jsonb) ? 'public_reachable');
  v_annotated := FOUND;

  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, after_digest, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
    'publication.public_check', 'publication', p_publication_id::text,
    p_operation_id, v_publication.artifact_digest,
    jsonb_build_object(
      'hostname', v_hostname,
      'publication_id', p_publication_id,
      'status_code', p_status_code,
      'reachable', p_reachable,
      'digest_ok', v_digest_ok
    )
  );

  v_result := jsonb_build_object(
    'site_id', p_site_id,
    'publication_id', p_publication_id,
    'hostname', v_hostname,
    'checked_at', p_observed_at,
    'status_code', p_status_code,
    'reachable', p_reachable,
    'digest_ok', v_digest_ok,
    'operation_annotated', v_annotated,
    'live_pointer_changed', false
  );

  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, 'public_check', v_body_digest,
    jsonb_build_object(
      'observed_at', p_observed_at,
      'hostname', v_hostname,
      'publication_id', p_publication_id,
      'status_code', p_status_code,
      'observed_digest', p_observed_digest,
      'reachable', p_reachable
    ), v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- PART A — the kill switch now leaves a trace.
--
-- Both routines below are the merged #2893 bodies reproduced verbatim. The
-- ONLY additions are the brand_site_audit_log INSERT and, in the deactivation
-- path, the read of the site's pointer that the audit row needs. No
-- precondition, lock, digest, receipt or return value changes.
-- ---------------------------------------------------------------------------

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
  -- #3157 — a customer's live website can be switched on by exactly this call.
  -- It is now attributable.
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, after_digest, metadata
  ) VALUES (
    p_site_id, p_brand_id, auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
    'pilot.activated', 'service_config', 'sites_v1', p_operation_id,
    v_publication.artifact_digest,
    jsonb_build_object(
      'hostname', p_hostname,
      'publication_id', v_site.active_publication_id,
      'status', 'active'
    )
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
  v_publication_id uuid;
  v_artifact_digest text;
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
  -- #3157 — this is the call that took gogi dark for 3h13m with nothing in the
  -- audit log. It names the pointer it left intact so the next reader does not
  -- have to reconstruct it from edge logs.
  SELECT site.active_publication_id,
    (SELECT publication.artifact_digest
      FROM public.brand_site_publications publication
      WHERE publication.id = site.active_publication_id)
  INTO v_publication_id, v_artifact_digest
  FROM public.brand_sites site
  WHERE site.id = p_site_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, after_digest, metadata
  ) VALUES (
    p_site_id, p_brand_id, auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
    'pilot.deactivated', 'service_config', 'sites_v1', p_operation_id,
    v_artifact_digest,
    jsonb_build_object(
      'hostname', p_hostname,
      'publication_id', v_publication_id,
      'status', 'disabled',
      'reason_code', p_reason_code,
      'last_good_preserved', true
    )
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

ALTER FUNCTION public.brand_site_record_public_reachability(uuid,uuid,uuid,timestamptz,integer,text,boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.brand_site_record_public_reachability(uuid,uuid,uuid,timestamptz,integer,text,boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.brand_site_record_public_reachability(uuid,uuid,uuid,timestamptz,integer,text,boolean)
  TO service_role, postgres;

COMMENT ON FUNCTION public.brand_site_record_public_reachability(uuid,uuid,uuid,timestamptz,integer,text,boolean) IS
  '#3157 records a REAL request made to the site public hostname AFTER the live pointer moved, onto the publication row, the audit log and the publish operation receipt. Idempotent per operation_id. It surfaces and never acts: it does not change active_publication_id, last_successful_publication_id, pilot_enabled or host status, because an automatic rollback on a transient network blip would be worse than the outage it reports.';

-- ---------------------------------------------------------------------------
-- PART C — why the reactivation gate is NOT tightened.
--
-- brand_site_activate_gogi_pilot requires
-- public_probe_publication_id = active_publication_id. That evidence comes
-- from the internal candidate probe, i.e. it is RENDERER-level. It is
-- tempting, after #3157, to demand a public 200 there instead. Do not: while
-- the pilot is off the public host returns 404 by construction, so requiring
-- public reachability to turn the pilot back ON would make any accidental
-- deactivation unrecoverable through the sanctioned path. Renderer-level
-- evidence is exactly why the 2026-09-09 outage was recoverable at all.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.brand_site_service_config.public_probe_publication_id IS
  '#2893 RENDERER-level evidence: the publication the INTERNAL candidate probe rendered. #3157 — this is NOT proof the public hostname is reachable; it is deliberately renderer-level so an accidentally disabled pilot (public host 404 by construction) stays recoverable. Real public reachability is brand_site_record_public_reachability, recorded after the pointer moves.';
COMMENT ON COLUMN public.brand_site_service_config.public_probe_evidence_digest IS
  '#2893 RENDERER-level probe evidence digest. #3157 — renderer-level by design, not a public-host 200. See brand_site_record_public_reachability for public reachability.';
COMMENT ON COLUMN public.brand_site_service_config.public_probe_artifact_digest IS
  '#2893 artifact digest the RENDERER-level probe observed. #3157 — renderer-level by design, not a public-host 200. See brand_site_record_public_reachability for public reachability.';

COMMENT ON FUNCTION public.brand_site_activate_gogi_pilot(uuid,uuid,text,uuid) IS
  'Atomically promotes only the exact verified Gogi pending host and enables the pilot after fresh immutable readiness evidence, and (#3157) writes a pilot.activated audit row. #3157 — the public_probe_* evidence this gate requires is RENDERER-level, NOT a request to the public hostname, and must stay that way: while the pilot is off the public host 404s by construction, so requiring a public 200 here would make any accidental deactivation unrecoverable through the sanctioned path. True public reachability is brand_site_record_public_reachability, recorded after the live pointer moves.';
COMMENT ON FUNCTION public.brand_site_deactivate_gogi_pilot(uuid,uuid,text,uuid,text) IS
  'Fail-safe Gogi kill switch: disables resolution and returns the active host to pending without clearing last-good publication pointers, and (#3157) writes a pilot.deactivated audit row naming the actor, the hostname and the preserved pointer.';
