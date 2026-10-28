-- #2893 forward-only Sites readiness/activation behavioral regression.
-- Apply every migration first, then run with ON_ERROR_STOP=1. The transaction
-- rolls every fixture back.
--
-- #2829 converted this suite. The single-pilot binding it was written for
-- (brand_site_configure_pilot_binding, brand_site_activate_gogi_pilot,
-- brand_site_deactivate_gogi_pilot, the pilot_* columns and the literal
-- brand/operator/host checks) was removed by
-- 20280119012829_issue_2829_sites_multi_brand_w1.sql. The assertions on that
-- removed behaviour are replaced by the entitlement, host and resolver
-- assertions in issue_2829_sites_multi_brand.test.sql. What still applies is
-- kept here: evidence validation and freshness bounds, host readiness bound to
-- the site's own primary host, least-privilege grants, receipt immutability,
-- and "an entitled brand with no website can create one without leaking a
-- fabricated site payload".

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_other_actor uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_other_brand uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_publication uuid := gen_random_uuid();
  v_other_publication uuid := gen_random_uuid();
  v_host_operation uuid := gen_random_uuid();
  v_host_observed_at timestamptz := clock_timestamp();
  v_artifact text := repeat('a', 64);
  v_probe jsonb := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', repeat('a', 64),
    'status_code', 200
  );
  v_failed boolean;
  v_result jsonb;
  v_replayed_result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_actor), (v_other_actor);
  INSERT INTO public.creator_accounts(id, created_at, updated_at)
  VALUES (v_actor, now(), now()), (v_other_actor, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES
    (v_brand, v_actor, '#2893 readiness brand', 'issue-2893-readiness'),
    (v_other_brand, v_actor, '#2893 no Sites', 'issue-2893-no-sites');
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_actor, now(), v_actor, now());
  INSERT INTO public.brand_sites(
    id, brand_id, status, payload_tenant_id, created_by
  ) VALUES (
    v_site, v_brand, 'draft', gen_random_uuid()::text, v_actor
  );
  INSERT INTO public.brand_site_hosts(site_id, hostname, label)
  VALUES (v_site, 'issue-2893-readiness.sites.usemingla.com', 'issue-2893-readiness');
  INSERT INTO public.brand_site_publications(
    id, site_id, operation_id, source_revision_id, source_digest,
    artifact_key, artifact_digest, status, requested_by, completed_at,
    probe_summary
  ) VALUES (
    v_publication, v_site, gen_random_uuid(), 'r1', repeat('b', 64),
    'publications/' || v_site || '/' || v_publication || '/' || v_artifact || '.json',
    v_artifact, 'published', v_actor, clock_timestamp(), v_probe
  ), (
    v_other_publication, v_site, gen_random_uuid(), 'r0', repeat('c', 64),
    'publications/' || v_site || '/' || v_other_publication || '/' || repeat('d', 64) || '.json',
    repeat('d', 64), 'published', v_actor, clock_timestamp(),
    v_probe || jsonb_build_object('observed_digest', repeat('d', 64))
  );
  UPDATE public.brand_sites SET
    status = 'published', active_publication_id = v_publication,
    last_successful_publication_id = v_publication
  WHERE id = v_site;

  -- (#2829: the pilot-binding typo matrix was removed with the binding.)

  -- Service routines are private; the Business projection is the sole
  -- authenticated exception and still rechecks live brand rank.
  IF has_function_privilege('anon',
      'public.brand_site_record_readiness_evidence(uuid, uuid, text, jsonb, text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.brand_site_record_readiness_evidence(uuid, uuid, text, jsonb, text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.brand_site_record_host_readiness(uuid, uuid, timestamptz, text, uuid, text, text, text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated',
      'public.brand_site_business_availability(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'readiness grants are not least privilege';
  END IF;
  IF has_table_privilege('service_role', 'public.brand_site_service_config', 'UPDATE')
    OR has_table_privilege('service_role', 'public.brand_site_hosts', 'UPDATE')
    OR has_table_privilege('service_role', 'public.brand_site_readiness_receipts', 'SELECT') THEN
    RAISE EXCEPTION 'service_role can bypass or scrape readiness receipts';
  END IF;

  -- Evidence older than its window is refused, not recorded.
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_record_readiness_evidence(
      v_site, gen_random_uuid(), repeat('8', 64), jsonb_build_object(
        'schema_version', 1, 'evidence_kind', 'nightly_backup',
        'observed_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'backup_retention_days', 7,
        'database_backup_verified_at', to_char(clock_timestamp() - interval '26 hours 1 second', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'object_manifest_verified_at', to_char(clock_timestamp() - interval '30 seconds', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'manifest_digest', repeat('2', 64),
        'backup_bundle_digest', repeat('3', 64),
        'object_count', 0, 'object_bytes', 0
      )
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE '%sites_readiness_blocked%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale database backup evidence recorded'; END IF;

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
  IF (SELECT backup_retention_days FROM public.brand_site_service_config) <> 7
    OR (SELECT restore_drill_evidence_digest FROM public.brand_site_service_config) <> repeat('5', 64) THEN
    RAISE EXCEPTION 'accepted evidence did not update the shared service row';
  END IF;

  -- Host readiness: only this site's own primary host, only the live publication.
  FOREACH v_result IN ARRAY ARRAY[
    jsonb_build_object('host', 'other.sites.usemingla.com', 'publication', v_publication, 'digest', v_artifact),
    jsonb_build_object('host', 'issue-2893-readiness.sites.usemingla.com', 'publication', v_other_publication, 'digest', repeat('d', 64))
  ] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_record_host_readiness(
        v_site, gen_random_uuid(), clock_timestamp(), v_result->>'host',
        (v_result->>'publication')::uuid, v_result->>'digest', repeat('6', 64), repeat('7', 64));
    EXCEPTION WHEN OTHERS THEN v_failed := true; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'wrong host readiness accepted: %', v_result; END IF;
  END LOOP;
  v_result := public.brand_site_record_host_readiness(
    v_site, v_host_operation, v_host_observed_at, 'issue-2893-readiness.sites.usemingla.com',
    v_publication, v_artifact, repeat('6', 64), repeat('7', 64)
  );
  v_replayed_result := public.brand_site_record_host_readiness(
    v_site, v_host_operation, v_host_observed_at, 'issue-2893-readiness.sites.usemingla.com',
    v_publication, v_artifact, repeat('6', 64), repeat('7', 64)
  );
  IF v_result->>'status' <> 'verified' OR v_replayed_result <> v_result THEN
    RAISE EXCEPTION 'host readiness operation did not verify and replay';
  END IF;

  -- (#2829: activation/deactivation, its evidence gates and the freshness
  -- predicate on public resolution were removed. Recovery evidence now gates
  -- only a new site's first publish and never public resolution; see
  -- issue_2829_sites_multi_brand.test.sql.)

  -- An entitled brand with no website can create one, but gets no fake site.
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  v_result := public.brand_site_business_availability(v_other_brand);
  IF v_result->>'available' <> 'true'
    OR v_result->>'can_create' <> 'true'
    OR v_result->>'can_publish' <> 'true'
    OR v_result->>'can_edit' <> 'true'
    OR v_result->'site' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'entitled brand without a website got wrong availability: %', v_result;
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

  RAISE NOTICE '#2893 Sites readiness evidence PASS';
END;
$test$;

ROLLBACK;
