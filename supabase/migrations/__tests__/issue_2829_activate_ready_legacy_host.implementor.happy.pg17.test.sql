-- #2829 legacy published-host convergence (PG17).
-- The migration is replayed after a production-shaped legacy fixture exists;
-- a second replay proves idempotency. This suite commits only to cross the
-- migration's own transaction boundary, then removes every fixture row.

\set ON_ERROR_STOP on

CREATE TEMP TABLE i2829_activation_fixture(
  owner_id uuid NOT NULL,
  brand_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  site_id uuid NOT NULL
) ON COMMIT PRESERVE ROWS;

BEGIN;
INSERT INTO i2829_activation_fixture(
  owner_id, brand_id, operation_id, publication_id, site_id
)
VALUES (
  '28290000-0000-4000-8000-000000000101',
  '28290000-0000-4000-8000-000000000102',
  '28290000-0000-4000-8000-000000000103',
  '28290000-0000-4000-8000-000000000104',
  '28290000-0000-4000-8000-000000000105'
);
INSERT INTO auth.users(id, email)
SELECT owner_id, 'legacy-host-2829@example.test' FROM i2829_activation_fixture;
INSERT INTO public.creator_accounts(id, email)
SELECT owner_id, 'legacy-host-2829@example.test' FROM i2829_activation_fixture;
INSERT INTO public.brand_site_service_config(
  config_key, cms_origin, public_runtime_origin, public_host_suffix,
  configured_by, configured_at, updated_by, updated_at
)
SELECT 'sites_v1', 'https://studio.sites.usemingla.com',
  'https://legacy-host-2829.sites.usemingla.com', 'sites.usemingla.com',
  owner_id, now(), owner_id, now()
FROM i2829_activation_fixture;
INSERT INTO public.brands(id, account_id, name, slug)
SELECT brand_id, owner_id, 'Legacy Host 2829', 'legacy-host-2829'
FROM i2829_activation_fixture;
INSERT INTO public.brand_sites(
  id, brand_id, renderer_key, renderer_version, status,
  payload_tenant_id, created_by
)
SELECT site_id, brand_id, 'sites-v2', 1, 'draft',
  '28290000-0000-4000-8000-000000000107', owner_id
FROM i2829_activation_fixture;
INSERT INTO public.brand_site_hosts(
  site_id, hostname, kind, status, is_primary, label
)
SELECT site_id, 'legacy-host-2829.sites.usemingla.com',
  'mingla_subdomain', 'pending', true, 'legacy-host-2829'
FROM i2829_activation_fixture;
INSERT INTO public.brand_site_publications(
  id, site_id, operation_id, source_revision_id, source_digest,
  artifact_key, artifact_digest, artifact_schema_version,
  renderer_key, renderer_version, status, requested_by, completed_at
)
SELECT fixture.publication_id, fixture.site_id,
  fixture.operation_id, 'legacy-ready', repeat('2', 64),
  'sites/' || fixture.site_id || '/legacy.json', repeat('3', 64), 2,
  site.renderer_key, site.renderer_version, 'published', fixture.owner_id, now()
FROM i2829_activation_fixture fixture
JOIN public.brand_sites site ON site.id = fixture.site_id;
UPDATE public.brand_sites site
SET status = 'published',
  active_publication_id = fixture.publication_id,
  last_successful_publication_id = fixture.publication_id
FROM i2829_activation_fixture fixture
WHERE site.id = fixture.site_id;
UPDATE public.brand_site_hosts host
SET status = 'pending', activated_at = NULL
FROM i2829_activation_fixture fixture
WHERE host.site_id = fixture.site_id AND host.is_primary;
COMMIT;

DO $before$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM i2829_activation_fixture fixture
  CROSS JOIN LATERAL public.brand_site_resolve_publication(
    (SELECT hostname FROM public.brand_site_hosts WHERE site_id = fixture.site_id AND is_primary)
  );
  IF v_count <> 0 THEN RAISE EXCEPTION 'legacy host resolved before repair'; END IF;
END;
$before$;

\ir ../20280205002829_issue_2829_activate_ready_legacy_host.sql

DO $after$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM i2829_activation_fixture fixture
  JOIN public.brand_site_hosts host ON host.site_id = fixture.site_id AND host.is_primary
  WHERE host.status = 'active' AND host.activated_at IS NOT NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'eligible legacy host was not activated'; END IF;

  SELECT count(*) INTO v_count
  FROM i2829_activation_fixture fixture
  CROSS JOIN LATERAL public.brand_site_resolve_publication(
    (SELECT hostname FROM public.brand_site_hosts WHERE site_id = fixture.site_id AND is_primary)
  );
  IF v_count <> 1 THEN RAISE EXCEPTION 'activated host did not resolve publication'; END IF;

  SELECT count(*) INTO v_count
  FROM public.brand_site_audit_log audit
  JOIN i2829_activation_fixture fixture ON fixture.site_id = audit.site_id
  WHERE audit.action = 'site.provisioned'
    AND audit.metadata->>'reason_code' = 'LEGACY_HOST_ACTIVATION';
  IF v_count <> 1 THEN RAISE EXCEPTION 'activation audit count %', v_count; END IF;
END;
$after$;

\ir ../20280205002829_issue_2829_activate_ready_legacy_host.sql

DO $idempotent$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.brand_site_audit_log audit
  JOIN i2829_activation_fixture fixture ON fixture.site_id = audit.site_id
  WHERE audit.metadata->>'reason_code' = 'LEGACY_HOST_ACTIVATION';
  IF v_count <> 1 THEN RAISE EXCEPTION 'replay duplicated activation audit'; END IF;
END;
$idempotent$;

BEGIN;
UPDATE public.brand_sites site
SET active_publication_id = NULL, last_successful_publication_id = NULL,
  status = 'draft'
FROM i2829_activation_fixture fixture
WHERE site.id = fixture.site_id;
DELETE FROM public.brand_site_audit_log audit USING i2829_activation_fixture fixture
WHERE audit.site_id = fixture.site_id;
DELETE FROM public.brand_site_publications publication USING i2829_activation_fixture fixture
WHERE publication.site_id = fixture.site_id;
DELETE FROM public.brand_site_operation_receipts receipt USING i2829_activation_fixture fixture
WHERE receipt.site_id = fixture.site_id;
DELETE FROM public.brand_site_hosts host USING i2829_activation_fixture fixture
WHERE host.site_id = fixture.site_id;
DELETE FROM public.brand_sites site USING i2829_activation_fixture fixture
WHERE site.id = fixture.site_id;
DELETE FROM public.brand_site_entitlements entitlement USING i2829_activation_fixture fixture
WHERE entitlement.brand_id = fixture.brand_id;
DELETE FROM public.brand_site_service_config WHERE config_key = 'sites_v1';
DELETE FROM public.brands brand USING i2829_activation_fixture fixture
WHERE brand.id = fixture.brand_id;
DELETE FROM public.creator_accounts account USING i2829_activation_fixture fixture
WHERE account.id = fixture.owner_id;
DELETE FROM auth.users user_row USING i2829_activation_fixture fixture
WHERE user_row.id = fixture.owner_id;
COMMIT;

DROP TABLE i2829_activation_fixture;
