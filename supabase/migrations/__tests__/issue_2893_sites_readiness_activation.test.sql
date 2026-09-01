-- #2893 forward-only Sites readiness/activation behavioral regression.
-- Apply the #2830 foundation and 20270613002893 repair first, then run with
-- ON_ERROR_STOP=1. The transaction rolls every fixture back.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_actor uuid := '1f3d2ddf-b741-4e2f-8884-d7222a660c7e'::uuid;
  v_other_actor uuid := gen_random_uuid();
  v_brand uuid := '733bc470-45e1-4684-8896-acd7e26074ff'::uuid;
  v_other_brand uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_publication uuid := gen_random_uuid();
  v_other_publication uuid := gen_random_uuid();
  v_host_operation uuid := gen_random_uuid();
  v_deactivation_operation uuid := gen_random_uuid();
  v_host_observed_at timestamptz := clock_timestamp();
  v_artifact text := repeat('a', 64);
  v_probe jsonb := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', repeat('a', 64),
    'status_code', 200
  );
  v_config public.brand_site_service_config%ROWTYPE;
  v_pointer uuid;
  v_failed boolean;
  v_column text;
  v_result jsonb;
  v_replayed_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_actor), (v_other_actor);
  INSERT INTO public.creator_accounts(id, created_at, updated_at)
  VALUES (v_actor, now(), now()), (v_other_actor, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES
    (v_brand, v_actor, '#2893 Gogi pilot', 'issue-2893-gogi-pilot'),
    (v_other_brand, v_actor, '#2893 non-pilot', 'issue-2893-non-pilot');
  INSERT INTO public.brand_sites(
    id, brand_id, status, payload_tenant_id, created_by
  ) VALUES (
    v_site, v_brand, 'draft', gen_random_uuid()::text, v_actor
  );
  INSERT INTO public.brand_site_hosts(site_id, hostname)
  VALUES (v_site, 'gogi.sites.usemingla.com');
  INSERT INTO public.brand_site_publications(
    id, site_id, operation_id, source_revision_id, source_digest,
    artifact_key, artifact_digest, status, requested_by, completed_at,
    probe_summary
  ) VALUES (
    v_publication, v_site, gen_random_uuid(), 'gogi-r1', repeat('b', 64),
    'publications/' || v_site || '/' || v_publication || '/' || v_artifact || '.json',
    v_artifact, 'published', v_actor, clock_timestamp(), v_probe
  ), (
    v_other_publication, v_site, gen_random_uuid(), 'gogi-r0', repeat('c', 64),
    'publications/' || v_site || '/' || v_other_publication || '/' || repeat('d', 64) || '.json',
    repeat('d', 64), 'published', v_actor, clock_timestamp(),
    v_probe || jsonb_build_object('observed_digest', repeat('d', 64))
  );
  UPDATE public.brand_sites SET
    status = 'published', active_publication_id = v_publication,
    last_successful_publication_id = v_publication
  WHERE id = v_site;

  -- No self-consistent typo may move the exact pilot binding.
  FOREACH v_result IN ARRAY ARRAY[
    jsonb_build_object(
      'brand', v_other_brand, 'site', NULL, 'operator', v_actor,
      'cms', 'https://studio.sites.usemingla.com',
      'runtime', 'https://gogi.sites.usemingla.com'),
    jsonb_build_object(
      'brand', v_brand, 'site', v_site, 'operator', v_other_actor,
      'cms', 'https://studio.sites.usemingla.com',
      'runtime', 'https://gogi.sites.usemingla.com'),
    jsonb_build_object(
      'brand', v_brand, 'site', v_site, 'operator', v_actor,
      'cms', 'https://studio2.sites.usemingla.com',
      'runtime', 'https://gogi.sites.usemingla.com'),
    jsonb_build_object(
      'brand', v_brand, 'site', v_site, 'operator', v_actor,
      'cms', 'https://studio.sites.usemingla.com',
      'runtime', 'https://runtime.sites.usemingla.com')
  ] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_configure_pilot_binding(
        (v_result->>'brand')::uuid,
        NULLIF(v_result->>'site', '')::uuid,
        v_result->>'cms', v_result->>'runtime',
        (v_result->>'operator')::uuid, gen_random_uuid()
      );
    EXCEPTION WHEN OTHERS THEN v_failed := true; END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'wrong pilot configuration accepted: %', v_result;
    END IF;
  END LOOP;

  PERFORM public.brand_site_configure_pilot_binding(
    v_brand, v_site, 'https://studio.sites.usemingla.com',
    'https://gogi.sites.usemingla.com', v_actor, gen_random_uuid()
  );

  -- Service routines are private; the Business projection is the sole
  -- authenticated exception and still rechecks live brand rank.
  IF NOT has_function_privilege('service_role',
      'public.brand_site_activate_gogi_pilot(uuid, uuid, text, uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.brand_site_deactivate_gogi_pilot(uuid, uuid, text, uuid, text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.brand_site_activate_gogi_pilot(uuid, uuid, text, uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.brand_site_deactivate_gogi_pilot(uuid, uuid, text, uuid, text)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.brand_site_record_readiness_evidence(uuid, uuid, text, jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated',
      'public.brand_site_business_availability(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'readiness grants are not least privilege';
  END IF;
  IF has_table_privilege('service_role', 'public.brand_site_service_config', 'UPDATE')
    OR has_table_privilege('service_role', 'public.brand_site_hosts', 'UPDATE')
    OR has_table_privilege('service_role', 'public.brand_site_readiness_receipts', 'SELECT') THEN
    RAISE EXCEPTION 'service_role can bypass or scrape readiness receipts';
  END IF;

  -- No evidence at all: activation must not move either half of the switch.
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%sites_readiness_blocked%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'missing evidence activated pilot'; END IF;
  IF EXISTS (SELECT 1 FROM public.brand_site_service_config WHERE pilot_enabled)
    OR EXISTS (SELECT 1 FROM public.brand_site_hosts WHERE site_id = v_site AND status = 'active') THEN
    RAISE EXCEPTION 'failed activation partially committed';
  END IF;

  PERFORM public.brand_site_record_readiness_evidence(
    v_site, gen_random_uuid(), repeat('1', 64), jsonb_build_object(
      'schema_version', 1, 'evidence_kind', 'nightly_backup',
      'observed_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'backup_retention_days', 7,
      'database_backup_verified_at', to_char(clock_timestamp() - interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'object_manifest_verified_at', to_char(clock_timestamp() - interval '30 seconds', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'manifest_digest', repeat('2', 64),
      'backup_bundle_digest', repeat('3', 64),
      'object_count', 0, 'object_bytes', 0
    )
  );
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'missing restore/host evidence activated pilot'; END IF;

  PERFORM public.brand_site_record_readiness_evidence(
    v_site, gen_random_uuid(), repeat('4', 64), jsonb_build_object(
      'schema_version', 1, 'evidence_kind', 'restore_drill',
      'observed_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'restore_drill_verified_at', to_char(clock_timestamp() - interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'restore_drill_evidence_digest', repeat('5', 64),
      'tenant_count', 1, 'document_count', 1,
      'object_count', 0, 'object_bytes', 0
    )
  );
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'missing TLS/probe evidence activated pilot'; END IF;

  PERFORM public.brand_site_record_host_readiness(
    v_site, v_host_operation, v_host_observed_at, 'gogi.sites.usemingla.com',
    v_publication, v_artifact, repeat('6', 64), repeat('7', 64)
  );
  SELECT * INTO v_config FROM public.brand_site_service_config
  WHERE config_key = 'sites_v1';

  -- Every nullable evidence gate independently fails closed.
  FOREACH v_column IN ARRAY ARRAY[
    'backup_entitlement_verified_at','backup_retention_days',
    'database_backup_verified_at','object_manifest_verified_at',
    'restore_drill_verified_at','restore_drill_evidence_digest',
    'backup_bundle_evidence_digest','object_manifest_evidence_digest'
  ] LOOP
    EXECUTE format('UPDATE public.brand_site_service_config SET %I = NULL WHERE config_key = ''sites_v1''', v_column);
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_activate_gogi_pilot(
        v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'missing % activated pilot', v_column; END IF;
    UPDATE public.brand_site_service_config SET
      backup_entitlement_verified_at = v_config.backup_entitlement_verified_at,
      backup_retention_days = v_config.backup_retention_days,
      database_backup_verified_at = v_config.database_backup_verified_at,
      object_manifest_verified_at = v_config.object_manifest_verified_at,
      restore_drill_verified_at = v_config.restore_drill_verified_at,
      restore_drill_evidence_digest = v_config.restore_drill_evidence_digest,
      backup_bundle_evidence_digest = v_config.backup_bundle_evidence_digest,
      object_manifest_evidence_digest = v_config.object_manifest_evidence_digest
    WHERE config_key = 'sites_v1';
  END LOOP;

  UPDATE public.brand_site_service_config SET
    host_readiness_verified_at = NULL, host_readiness_hostname = NULL,
    tls_evidence_digest = NULL, public_probe_evidence_digest = NULL,
    public_probe_publication_id = NULL, public_probe_artifact_digest = NULL
  WHERE config_key = 'sites_v1';
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'missing host evidence activated pilot'; END IF;
  UPDATE public.brand_site_service_config SET
    host_readiness_verified_at = v_config.host_readiness_verified_at,
    host_readiness_hostname = v_config.host_readiness_hostname,
    tls_evidence_digest = v_config.tls_evidence_digest,
    public_probe_evidence_digest = v_config.public_probe_evidence_digest,
    public_probe_publication_id = v_config.public_probe_publication_id,
    public_probe_artifact_digest = v_config.public_probe_artifact_digest
  WHERE config_key = 'sites_v1';

  -- Every freshness window is executable, not documentary.
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - interval '26 hours 1 second';
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale database backup activated pilot'; END IF;
  UPDATE public.brand_site_service_config SET database_backup_verified_at = v_config.database_backup_verified_at;

  UPDATE public.brand_site_service_config SET
    object_manifest_verified_at = clock_timestamp() - interval '26 hours 1 second';
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale manifest activated pilot'; END IF;
  UPDATE public.brand_site_service_config SET object_manifest_verified_at = v_config.object_manifest_verified_at;

  UPDATE public.brand_site_service_config SET
    restore_drill_verified_at = clock_timestamp() - interval '100 days 1 second';
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale restore drill activated pilot'; END IF;
  UPDATE public.brand_site_service_config SET restore_drill_verified_at = v_config.restore_drill_verified_at;

  UPDATE public.brand_site_service_config SET
    host_readiness_verified_at = clock_timestamp() - interval '15 minutes 1 second';
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale host probe activated pilot'; END IF;
  UPDATE public.brand_site_service_config SET host_readiness_verified_at = v_config.host_readiness_verified_at;

  -- Exact binding: wrong brand, site, host, publication, or non-pending host.
  FOREACH v_result IN ARRAY ARRAY[
    jsonb_build_object('brand', v_other_brand, 'site', v_site, 'host', 'gogi.sites.usemingla.com'),
    jsonb_build_object('brand', v_brand, 'site', gen_random_uuid(), 'host', 'gogi.sites.usemingla.com'),
    jsonb_build_object('brand', v_brand, 'site', v_site, 'host', 'other.sites.usemingla.com')
  ] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_activate_gogi_pilot(
        (v_result->>'brand')::uuid, (v_result->>'site')::uuid,
        v_result->>'host', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_failed := true; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'wrong pilot binding activated: %', v_result; END IF;
  END LOOP;

  UPDATE public.brand_site_service_config SET
    public_probe_publication_id = v_other_publication,
    public_probe_artifact_digest = repeat('d', 64);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'wrong publication evidence activated pilot'; END IF;
  UPDATE public.brand_site_service_config SET
    public_probe_publication_id = v_config.public_probe_publication_id,
    public_probe_artifact_digest = v_config.public_probe_artifact_digest;

  UPDATE public.brand_site_hosts SET status = 'suspended' WHERE site_id = v_site;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_activate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-pending host activated pilot'; END IF;
  UPDATE public.brand_site_hosts SET status = 'pending' WHERE site_id = v_site;

  -- Green path is atomic; deactivation is idempotent and preserves last-good.
  v_result := public.brand_site_activate_gogi_pilot(
    v_brand, v_site, 'gogi.sites.usemingla.com', gen_random_uuid());
  IF v_result->>'status' <> 'active'
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_service_config WHERE pilot_enabled)
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_hosts WHERE site_id = v_site AND status = 'active') THEN
    RAISE EXCEPTION 'green activation did not commit both switch halves';
  END IF;
  v_replayed_result := public.brand_site_record_host_readiness(
    v_site, v_host_operation, v_host_observed_at, 'gogi.sites.usemingla.com',
    v_publication, v_artifact, repeat('6', 64), repeat('7', 64)
  );
  IF v_replayed_result->>'status' <> 'verified' THEN
    RAISE EXCEPTION 'host readiness operation did not replay after activation';
  END IF;
  SELECT active_publication_id INTO v_pointer FROM public.brand_sites WHERE id = v_site;
  IF (SELECT count(*) FROM public.brand_site_resolve_publication(
      'gogi.sites.usemingla.com')) <> 1 THEN
    RAISE EXCEPTION 'fresh active pilot did not resolve';
  END IF;
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - interval '26 hours 1 second'
  WHERE config_key = 'sites_v1';
  IF (SELECT count(*) FROM public.brand_site_resolve_publication(
      'gogi.sites.usemingla.com')) <> 0
    OR (SELECT active_publication_id FROM public.brand_sites WHERE id = v_site) <> v_pointer THEN
    RAISE EXCEPTION 'stale public resolution did not fail closed and preserve last-good';
  END IF;
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = v_config.database_backup_verified_at
  WHERE config_key = 'sites_v1';
  v_result := public.brand_site_deactivate_gogi_pilot(
    v_brand, v_site, 'gogi.sites.usemingla.com', v_deactivation_operation,
    'BACKUP_READINESS_FAILED');
  IF v_result->>'status' <> 'disabled'
    OR EXISTS (SELECT 1 FROM public.brand_site_service_config WHERE pilot_enabled)
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_hosts WHERE site_id = v_site AND status = 'pending')
    OR (SELECT active_publication_id FROM public.brand_sites WHERE id = v_site) <> v_pointer THEN
    RAISE EXCEPTION 'deactivation did not fail safe or preserve last-good';
  END IF;
  v_replayed_result := public.brand_site_deactivate_gogi_pilot(
    v_brand, v_site, 'gogi.sites.usemingla.com', v_deactivation_operation,
    'BACKUP_READINESS_FAILED');
  IF v_replayed_result <> v_result THEN
    RAISE EXCEPTION 'deactivation operation did not replay exactly';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_deactivate_gogi_pilot(
      v_brand, v_site, 'gogi.sites.usemingla.com', v_deactivation_operation,
      'MANUAL_DISABLE');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%sites_idempotency_conflict%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'deactivation operation accepted a different reason';
  END IF;

  -- Non-pilot Business brands get a boolean false and no site payload.
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  v_result := public.brand_site_business_availability(v_other_brand);
  IF v_result <> '{"available": false}'::jsonb THEN
    RAISE EXCEPTION 'non-pilot availability leaked Website state: %', v_result;
  END IF;

  -- Immutable receipts cannot be forged after acceptance.
  v_failed := false;
  BEGIN
    UPDATE public.brand_site_readiness_receipts SET body_digest = repeat('f', 64)
    WHERE site_id = v_site;
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%brand_site_readiness_receipt_immutable%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'readiness receipt was mutable'; END IF;

  RAISE NOTICE '#2893 Sites readiness activation/deactivation PASS';
END;
$test$;

ROLLBACK;
