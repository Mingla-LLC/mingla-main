-- #2829 W9b — Ari as the website designer, Core side (pg17, BEGIN ... ROLLBACK).
--  - a member (rank >= 20) of a brand whose Sites access was explicitly
--    revoked records interest once per day; an entitled brand records
--    nothing; a scanner or a stranger cannot; only Mingla admins read it, and
--    never through the table;
--  - the content gate learns the two Publish-review reads (rank 20);
--  - a refused first publish may say DESIGN_CHECKS_REQUIRED, free text never;
--  - the certification census moves with the ledger (160 requirement rows =
--    the finalizer's two literals).
-- Apply every migration through 20280119122829_issue_2829_ari_designer.sql
-- first, then run with ON_ERROR_STOP=1. Every fixture rolls back. Neutral
-- fixtures only.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $w9b$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_scanner uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_granted_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_granted uuid := gen_random_uuid();
  v_site uuid;
  v_publication uuid := gen_random_uuid();
  v_operation uuid := gen_random_uuid();
  v_result jsonb;
  v_failed boolean;
  v_count integer;
  v_definition text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w9b-owner@2829.invalid'), (v_marketing, 'w9b-marketing@2829.invalid'),
    (v_scanner, 'w9b-scanner@2829.invalid'), (v_stranger, 'w9b-stranger@2829.invalid'),
    (v_granted_owner, 'w9b-granted@2829.invalid'), (v_mingla_admin, 'w9b-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES
    (v_owner, now(), now()), (v_granted_owner, now(), now()), (v_stranger, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w9b-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_brand, v_owner, 'W9b Revoked', 'w9b-revoked'),
    (v_granted, v_granted_owner, 'W9b Granted', 'w9b-granted');
  UPDATE public.brands SET default_currency = 'USD' WHERE id IN (v_brand, v_granted);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
    (v_brand, v_marketing, 'marketing_manager', now()),
    (v_brand, v_scanner, 'scanner', now());
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_revoke(v_brand, 'support', 'W9b negative fixture');
  PERFORM public.brand_site_admin_grant(v_granted, 'rollout', NULL);

  -- ── grants: the table is RPC-only ────────────────────────────────────────
  IF has_table_privilege('authenticated', 'public.brand_site_interest', 'SELECT')
    OR has_table_privilege('anon', 'public.brand_site_interest', 'SELECT')
    OR has_table_privilege('authenticated', 'public.brand_site_interest', 'INSERT') THEN
    RAISE EXCEPTION 'brand_site_interest is reachable as a table';
  END IF;
  IF has_function_privilege('anon', 'public.brand_site_record_interest(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can record interest';
  END IF;

  -- ── a marketing manager of an explicitly revoked brand: recorded daily ─
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_result := public.brand_site_record_interest(v_brand, 'ari');
  IF v_result <> jsonb_build_object('recorded', true, 'entitled', false) THEN
    RAISE EXCEPTION 'interest not recorded for an explicitly revoked brand: %', v_result;
  END IF;
  PERFORM public.brand_site_record_interest(v_brand, 'ari');
  SELECT count(*) INTO v_count FROM public.brand_site_interest WHERE brand_id = v_brand;
  IF v_count <> 1 THEN RAISE EXCEPTION 'asking twice the same day stored % rows', v_count; END IF;

  -- the owner asking too is a second member
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.brand_site_record_interest(v_brand, 'business_app');
  SELECT count(*) INTO v_count FROM public.brand_site_interest WHERE brand_id = v_brand;
  IF v_count <> 2 THEN RAISE EXCEPTION 'a second member asking was not recorded'; END IF;

  -- ── a scanner (rank 10) and a stranger cannot; an unknown source is refused
  FOREACH v_operation IN ARRAY ARRAY[v_scanner, v_stranger] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_operation)::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_operation::text, true);
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_record_interest(v_brand, 'ari');
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM = 'sites_forbidden';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'a non-member or scanner recorded interest'; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_record_interest(v_brand, 'email');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'sites_forbidden';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an unknown interest source was stored'; END IF;

  -- ── a granted brand records nothing ─────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_granted_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_granted_owner::text, true);
  v_result := public.brand_site_record_interest(v_granted, 'ari');
  IF v_result <> jsonb_build_object('recorded', false, 'entitled', true) THEN
    RAISE EXCEPTION 'a granted brand recorded interest: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_site_interest WHERE brand_id = v_granted) THEN
    RAISE EXCEPTION 'a granted brand has an interest row';
  END IF;

  -- ── only Mingla admins read who is asking ───────────────────────────────
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_admin_interest(50);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'sites_forbidden';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a brand owner read the admin interest list'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  v_result := public.brand_site_admin_interest(50);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result) row
    WHERE row->>'brand_id' = v_brand::text AND (row->>'requests')::int = 2 AND (row->>'members')::int = 2
      AND (row->>'entitled')::boolean = false
  ) THEN
    RAISE EXCEPTION 'the admin list does not show the asking brand: %', v_result;
  END IF;
  IF v_result::text ILIKE '%@2829.invalid%' THEN
    RAISE EXCEPTION 'the admin list carries members'' emails';
  END IF;

  -- ── the content gate's two Publish-review reads ─────────────────────────
  IF public.brand_site_content_min_rank('work_log') IS DISTINCT FROM 20
    OR public.brand_site_content_min_rank('design_checks') IS DISTINCT FROM 20
    OR public.brand_site_content_min_rank('confirm_review') IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'content gate ranks drifted';
  END IF;

  -- ── a first publish refused for unrun checks names itself; free text never
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_granted_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_granted_owner::text, true);
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_granted, v_granted_owner);
  v_result := public.brand_site_provision(v_granted, gen_random_uuid(), repeat('3', 64));
  v_site := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site AND kind = 'provision'), gen_random_uuid()::text);
  v_operation := gen_random_uuid();
  INSERT INTO public.brand_site_publications(id, site_id, operation_id,
    source_revision_id, source_digest, status, requested_by)
  VALUES (v_publication, v_site, v_operation, 'r-1', repeat('5', 64), 'materializing', v_granted_owner);
  INSERT INTO public.brand_site_operation_receipts(operation_id, site_id, brand_id,
    user_id, kind, arguments_digest, status)
  VALUES (v_operation, v_site, v_granted, v_granted_owner, 'publish', repeat('4', 64), 'executing');
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_fail_publication(v_site, v_operation, v_publication, 'Your words are bad');
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM = 'sites_validation_failed';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a free-text publish refusal was stored'; END IF;
  v_result := public.brand_site_fail_publication(v_site, v_operation, v_publication, 'DESIGN_CHECKS_REQUIRED');
  IF v_result->>'reason_code' IS DISTINCT FROM 'DESIGN_CHECKS_REQUIRED' OR (v_result->>'last_good_preserved')::boolean THEN
    RAISE EXCEPTION 'the first-publish refusal did not name itself: %', v_result;
  END IF;
  IF (SELECT result_summary->>'reason_code' FROM public.brand_site_operation_receipts WHERE operation_id = v_operation)
    IS DISTINCT FROM 'DESIGN_CHECKS_REQUIRED' THEN
    RAISE EXCEPTION 'the receipt did not record DESIGN_CHECKS_REQUIRED';
  END IF;
  IF (SELECT status FROM public.brand_sites WHERE id = v_site) <> 'draft' THEN
    RAISE EXCEPTION 'a refused first publish did not leave the site a draft';
  END IF;

  -- ── the certification census moves with the ledger ──────────────────────
  SELECT count(*) INTO v_count FROM public.ari_cert_capability_requirements;
  v_definition := pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure);
  IF v_count <> 164
    OR v_definition NOT LIKE '%v_capability_count <> 164%'
    OR v_definition NOT LIKE '%''capability_count'', 164%' THEN
    RAISE EXCEPTION 'certification census drifted: % rows', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ari_cert_capability_requirements WHERE capability_id = 'ari.sites.confirm_review' AND evidence_mode = 'write')
    OR NOT EXISTS (SELECT 1 FROM public.ari_cert_capability_requirements WHERE capability_id = 'ari.sites.run_design_checks' AND evidence_mode = 'read') THEN
    RAISE EXCEPTION 'website designer capabilities are missing from the census';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W9B_ARI_DESIGNER_OK';
END;
$w9b$;

ROLLBACK;
