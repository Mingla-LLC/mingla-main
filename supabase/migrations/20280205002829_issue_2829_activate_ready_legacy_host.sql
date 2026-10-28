BEGIN;
SET LOCAL lock_timeout = '10s';

-- #2829 one-time convergence for a host whose CMS tenant and published
-- artifact predate the multi-brand provisioning completion path.
--
-- No brand, site or hostname is named. A future replay is a no-op after the
-- eligible host is active. More than one candidate aborts the whole migration.
LOCK TABLE public.brands,
  public.brand_site_service_config,
  public.brand_site_entitlements,
  public.brand_sites,
  public.brand_site_publications,
  public.brand_site_hosts
IN SHARE ROW EXCLUSIVE MODE;

DO $repair$
DECLARE
  v_candidate_count integer;
  v_host_id uuid;
  v_site_id uuid;
  v_brand_id uuid;
  v_hostname text;
  v_renderer_version integer;
  v_updated integer;
BEGIN
  SELECT count(*)::integer,
    max(host.id::text)::uuid,
    max(site.id::text)::uuid,
    max(site.brand_id::text)::uuid,
    max(host.hostname),
    max(site.renderer_version)
  INTO v_candidate_count, v_host_id, v_site_id, v_brand_id, v_hostname,
    v_renderer_version
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  JOIN public.brands brand ON brand.id = site.brand_id
  JOIN public.brand_site_entitlements entitlement
    ON entitlement.brand_id = site.brand_id
   AND entitlement.status = 'granted'
  JOIN public.brand_site_publications publication
    ON publication.id = site.active_publication_id
   AND publication.site_id = site.id
  JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1'
  WHERE host.kind = 'mingla_subdomain'
    AND host.status = 'pending'
    AND host.activated_at IS NULL
    AND host.is_primary
    AND host.label IS NOT NULL
    AND host.hostname = host.label || '.' || config.public_host_suffix
    AND site.status = 'published'
    AND site.payload_tenant_id IS NOT NULL
    AND site.owner_offline_at IS NULL
    AND site.active_publication_id IS NOT NULL
    AND site.active_publication_id = site.last_successful_publication_id
    AND publication.status = 'published'
    AND publication.completed_at IS NOT NULL
    AND publication.artifact_key IS NOT NULL
    AND publication.artifact_digest IS NOT NULL
    AND brand.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.brand_site_hosts active_host
      WHERE active_host.site_id = site.id
        AND active_host.is_primary
        AND active_host.status = 'active'
    );

  IF v_candidate_count > 1 THEN
    RAISE EXCEPTION 'issue_2829_legacy_host_ambiguous';
  END IF;
  IF v_candidate_count = 0 THEN
    RETURN;
  END IF;

  UPDATE public.brand_site_hosts
  SET status = 'active', activated_at = clock_timestamp()
  WHERE id = v_host_id
    AND site_id = v_site_id
    AND kind = 'mingla_subdomain'
    AND status = 'pending'
    AND activated_at IS NULL
    AND is_primary;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'issue_2829_legacy_host_changed';
  END IF;

  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    before_digest, after_digest, metadata
  ) VALUES (
    v_site_id, v_brand_id, 'system', 'site.provisioned', 'site',
    v_site_id::text,
    encode(extensions.digest(v_host_id::text || ':pending', 'sha256'), 'hex'),
    encode(extensions.digest(v_host_id::text || ':active', 'sha256'), 'hex'),
    jsonb_build_object(
      'status', 'published',
      'reason_code', 'LEGACY_HOST_ACTIVATION',
      'hostname', v_hostname,
      'renderer_version', v_renderer_version
    )
  );
END;
$repair$;

COMMIT;
