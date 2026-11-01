-- #2829 A20 — a receipt that succeeded carries no stale error code, and a
-- publication that became published carries no stale failure code (pg17,
-- BEGIN ... ROLLBACK). Apply every migration through
-- 20280119102829_issue_2829_succeeded_clears_stale_error.sql first, then run
-- with ON_ERROR_STOP=1. Every fixture rolls back.
-- Path under test: brand-site-control's 15 s timeout marks the operation
-- ambiguous (SERVICE_TEMPORARILY_UNAVAILABLE), then Studio's completion
-- callback publishes it.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $w9f$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_site uuid;
  v_result jsonb;
  v_pub uuid := gen_random_uuid();
  v_op uuid := gen_random_uuid();
  v_pub_fail uuid := gen_random_uuid();
  v_op_fail uuid := gen_random_uuid();
  v_digest text := repeat('e', 64);
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_probe jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w9f-owner@2829.invalid'), (v_mingla_admin, 'w9f-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w9f-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'W9f Stale Error', 'w9f-stale-error');
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_grant(v_brand, 'rollout', NULL);
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand, v_owner);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_provision(v_brand, gen_random_uuid(), repeat('1', 64));
  v_site := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site AND kind = 'provision'), gen_random_uuid()::text);


  INSERT INTO public.brand_site_publications(id, site_id, operation_id,
    source_revision_id, source_digest, status, requested_by)
  VALUES (v_pub, v_site, v_op, 'r-1', repeat('d', 64), 'materializing', v_owner),
         (v_pub_fail, v_site, v_op_fail, 'r-2', repeat('c', 64), 'materializing', v_owner);
  INSERT INTO public.brand_site_operation_receipts(operation_id, site_id, brand_id,
    user_id, kind, arguments_digest, status)
  VALUES (v_op, v_site, v_brand, v_owner, 'publish', repeat('7', 64), 'executing'),
         (v_op_fail, v_site, v_brand, v_owner, 'publish', repeat('8', 64), 'executing');

  -- The edge function gives up waiting: both operations become ambiguous.
  PERFORM public.brand_site_mark_operation_ambiguous(v_site, v_op, 'SERVICE_TEMPORARILY_UNAVAILABLE');
  PERFORM public.brand_site_mark_operation_ambiguous(v_site, v_op_fail, 'SERVICE_TEMPORARILY_UNAVAILABLE');
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts WHERE operation_id = v_op;
  IF v_receipt.status <> 'ambiguous' OR v_receipt.error_code <> 'SERVICE_TEMPORARILY_UNAVAILABLE' THEN
    RAISE EXCEPTION 'fixture: expected an ambiguous receipt, got % / %', v_receipt.status, v_receipt.error_code;
  END IF;

  -- Studio finishes and calls back: the publish succeeds.
  v_probe := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', v_digest, 'status_code', 200);
  PERFORM public.brand_site_complete_publication(v_site, v_op, v_pub, 'r-1', repeat('d', 64),
    'publications/' || v_site || '/' || v_pub || '/' || v_digest || '.json', v_digest,
    v_probe, 2, 'sites-v2', 'atelier', 1, '[]'::jsonb);

  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts WHERE operation_id = v_op;
  SELECT * INTO v_publication FROM public.brand_site_publications WHERE id = v_pub;
  IF v_receipt.status <> 'succeeded' OR v_receipt.error_code IS NOT NULL THEN
    RAISE EXCEPTION 'A20: a succeeded receipt kept error code % (status %)', v_receipt.error_code, v_receipt.status;
  END IF;
  IF v_publication.status <> 'published' OR v_publication.failure_code IS NOT NULL THEN
    RAISE EXCEPTION 'A20: a published publication kept failure code % (status %)', v_publication.failure_code, v_publication.status;
  END IF;

  -- A real failure keeps its reason.
  PERFORM public.brand_site_fail_publication(v_site, v_op_fail, v_pub_fail);
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts WHERE operation_id = v_op_fail;
  IF v_receipt.status <> 'failed' OR v_receipt.error_code IS NULL THEN
    RAISE EXCEPTION 'A20: a failed receipt lost its error code (status %, code %)', v_receipt.status, v_receipt.error_code;
  END IF;

  RAISE NOTICE 'ISSUE_2829_A20_SUCCEEDED_CLEARS_STALE_ERROR_OK';
END;
$w9f$;

ROLLBACK;
