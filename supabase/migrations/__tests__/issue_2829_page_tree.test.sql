-- #2829 W2 — a refused publish names an owner-fixable reason (pg17, BEGIN ... ROLLBACK).
-- Apply every migration through 20280119022829_issue_2829_page_tree_w2.sql
-- first, then run with ON_ERROR_STOP=1. Every fixture rolls back.
-- invariant: I-PROPOSED-2829-06 (DRAFT) — a refused publish keeps the last
-- good publication live; an owner-fixable reason (PATH_COLLISION,
-- PAGE_LIMIT_EXCEEDED) is recorded on the receipt and audit row, and no other
-- reason text can be stored.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $w2$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_site uuid;
  v_good uuid := gen_random_uuid();
  v_bad uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_op_bad uuid := gen_random_uuid();
  v_op_plain uuid := gen_random_uuid();
  v_op_free uuid := gen_random_uuid();
  v_free uuid := gen_random_uuid();
  v_result jsonb;
  v_failed boolean;
  v_probe jsonb := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', repeat('a', 64),
    'status_code', 200
  );
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w2-owner@2829.invalid'), (v_mingla_admin, 'w2-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w2-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'W2 Page Tree', 'w2-page-tree');
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

  -- A live publication, then two refused ones.
  INSERT INTO public.brand_site_publications(id, site_id, operation_id,
    source_revision_id, source_digest, artifact_key, artifact_digest, status,
    requested_by, completed_at, probe_summary)
  VALUES (v_good, v_site, gen_random_uuid(), 'g-1', repeat('b', 64),
    'publications/' || v_site || '/' || v_good || '/' || repeat('a', 64) || '.json',
    repeat('a', 64), 'published', v_owner, clock_timestamp(), v_probe);
  UPDATE public.brand_sites SET status = 'published', active_publication_id = v_good,
    last_successful_publication_id = v_good WHERE id = v_site;
  INSERT INTO public.brand_site_publications(id, site_id, operation_id,
    source_revision_id, source_digest, status, requested_by)
  VALUES
    (v_bad, v_site, v_op_bad, 'b-1', repeat('c', 64), 'materializing', v_owner),
    (v_plain, v_site, v_op_plain, 'p-1', repeat('d', 64), 'materializing', v_owner),
    (v_free, v_site, v_op_free, 'f-1', repeat('e', 64), 'materializing', v_owner);
  INSERT INTO public.brand_site_operation_receipts(operation_id, site_id, brand_id,
    user_id, kind, arguments_digest, status)
  VALUES
    (v_op_bad, v_site, v_brand, v_owner, 'publish', repeat('5', 64), 'executing'),
    (v_op_plain, v_site, v_brand, v_owner, 'publish', repeat('6', 64), 'executing'),
    (v_op_free, v_site, v_brand, v_owner, 'publish', repeat('7', 64), 'executing');

  -- PATH_COLLISION is recorded, and the last good publication stays live.
  v_result := public.brand_site_fail_publication(v_site, v_op_bad, v_bad, 'PATH_COLLISION');
  IF v_result->>'reason_code' <> 'PATH_COLLISION' OR v_result->>'last_good_preserved' <> 'true' THEN
    RAISE EXCEPTION 'fail result did not carry the reason: %', v_result;
  END IF;
  IF (SELECT result_summary->>'reason_code' FROM public.brand_site_operation_receipts
      WHERE operation_id = v_op_bad) IS DISTINCT FROM 'PATH_COLLISION'
    OR (SELECT error_code FROM public.brand_site_operation_receipts
      WHERE operation_id = v_op_bad) <> 'PUBLISH_FAILED_LAST_GOOD_PRESERVED' THEN
    RAISE EXCEPTION 'receipt did not record the reason under the unchanged error code';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log
      WHERE operation_id = v_op_bad AND action = 'publication.failed'
        AND metadata->>'reason_code' = 'PATH_COLLISION') THEN
    RAISE EXCEPTION 'audit row did not record the reason';
  END IF;
  IF (SELECT active_publication_id FROM public.brand_sites WHERE id = v_site) <> v_good
    OR (SELECT status FROM public.brand_sites WHERE id = v_site) <> 'published' THEN
    RAISE EXCEPTION 'a refused publish took the last good site down';
  END IF;

  -- The 3-argument form still works and records no reason.
  v_result := public.brand_site_fail_publication(v_site, v_op_plain, v_plain);
  IF v_result ? 'reason_code' OR v_result->>'status' <> 'failed' THEN
    RAISE EXCEPTION 'plain failure carried a reason: %', v_result;
  END IF;

  -- No other text can be stored as a reason.
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_fail_publication(v_site, v_op_free, v_free, 'anything the CMS says');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a free-text reason was stored'; END IF;

  -- Not callable by signed-in users.
  IF has_function_privilege('authenticated',
      'public.brand_site_fail_publication(uuid,uuid,uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.brand_site_fail_publication(uuid,uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the failure recorder is callable by app users';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W2_PAGE_TREE_OK';
END;
$w2$;

ROLLBACK;
