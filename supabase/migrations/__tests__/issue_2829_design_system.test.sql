-- #2829 W3 — a completed publication records the artifact generation,
-- renderer and design the CMS wrote, and any font fallbacks (pg17,
-- BEGIN ... ROLLBACK). Apply every migration through
-- 20280119032829_issue_2829_design_system_w3.sql first, then run with
-- ON_ERROR_STOP=1. Every fixture rolls back.
-- invariant: I-PROPOSED-2829-07 (DRAFT) — Mingla records an owner's font
-- fallback as a warning on the receipt; it never fails a publish for it.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $w3$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_site uuid;
  v_v2 uuid := gen_random_uuid();
  v_v1 uuid := gen_random_uuid();
  v_bad uuid := gen_random_uuid();
  v_op_v2 uuid := gen_random_uuid();
  v_op_v1 uuid := gen_random_uuid();
  v_op_bad uuid := gen_random_uuid();
  v_result jsonb;
  v_failed boolean;
  v_warnings jsonb := '[{"slot":"display","requested":"Fraunces","used":"Oswald","code":"FONT_FETCH_FAILED"}]';
  v_probe jsonb := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', repeat('a', 64),
    'status_code', 200
  );
  v_probe_b jsonb;
  v_probe_c jsonb;
BEGIN
  v_probe_b := v_probe || jsonb_build_object('observed_digest', repeat('b', 64));
  v_probe_c := v_probe || jsonb_build_object('observed_digest', repeat('c', 64));
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w3-owner@2829.invalid'), (v_mingla_admin, 'w3-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w3-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'W3 Design System', 'w3-design-system');
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
  VALUES
    (v_v2, v_site, v_op_v2, 'r-2', repeat('d', 64), 'probing', v_owner),
    (v_v1, v_site, v_op_v1, 'r-1', repeat('e', 64), 'probing', v_owner),
    (v_bad, v_site, v_op_bad, 'r-x', repeat('f', 64), 'probing', v_owner);
  INSERT INTO public.brand_site_operation_receipts(operation_id, site_id, brand_id,
    user_id, kind, arguments_digest, status)
  VALUES
    (v_op_v2, v_site, v_brand, v_owner, 'publish', repeat('5', 64), 'executing'),
    (v_op_v1, v_site, v_brand, v_owner, 'rollback', repeat('6', 64), 'executing'),
    (v_op_bad, v_site, v_brand, v_owner, 'publish', repeat('7', 64), 'executing');

  -- A v2 publication drawn by atelier, with one font fallback.
  v_result := public.brand_site_complete_publication(v_site, v_op_v2, v_v2, 'r-2',
    repeat('d', 64), 'publications/' || v_site || '/' || v_v2 || '/' || repeat('a', 64) || '.json',
    repeat('a', 64), v_probe, 2, 'sites-v2', 'atelier', 1, v_warnings);
  IF v_result->>'status' <> 'published' OR v_result->'font_warnings' <> v_warnings THEN
    RAISE EXCEPTION 'v2 completion result wrong: %', v_result;
  END IF;
  IF (SELECT row(artifact_schema_version, renderer_key, design_key, design_version)::text
      FROM public.brand_site_publications WHERE id = v_v2) <> '(2,sites-v2,atelier,1)' THEN
    RAISE EXCEPTION 'publication did not record its generation and design';
  END IF;
  IF (SELECT result_summary->'font_warnings' FROM public.brand_site_operation_receipts
      WHERE operation_id = v_op_v2) IS DISTINCT FROM v_warnings THEN
    RAISE EXCEPTION 'receipt did not record the font fallback';
  END IF;
  IF (SELECT design_key FROM public.brand_sites WHERE id = v_site) <> 'atelier'
    OR (SELECT active_publication_id FROM public.brand_sites WHERE id = v_site) <> v_v2 THEN
    RAISE EXCEPTION 'site did not move to the v2 publication';
  END IF;

  -- A replay describing a different generation is refused.
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_complete_publication(v_site, v_op_v2, v_v2, 'r-2',
      repeat('d', 64), 'publications/' || v_site || '/' || v_v2 || '/' || repeat('a', 64) || '.json',
      repeat('a', 64), v_probe, 1, 'restaurant-website-v1', NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_callback_ambiguous'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a replay rewrote the generation'; END IF;

  -- A rollback to an earlier v1 publication still records v1.
  v_result := public.brand_site_complete_publication(v_site, v_op_v1, v_v1, 'r-1',
    repeat('e', 64), 'publications/' || v_site || '/' || v_v1 || '/' || repeat('b', 64) || '.json',
    repeat('b', 64), v_probe_b, 1, 'restaurant-website-v1', NULL, NULL, NULL);
  IF (SELECT row(artifact_schema_version, renderer_key, design_key)::text
      FROM public.brand_site_publications WHERE id = v_v1) <> '(1,restaurant-website-v1,)' THEN
    RAISE EXCEPTION 'v1 rollback did not record v1';
  END IF;

  -- Mismatched pairs and anything outside the warning shape are refused.
  FOR v_result IN SELECT * FROM (VALUES
      (jsonb_build_object('s', 2, 'r', 'restaurant-website-v1', 'd', 'atelier', 'v', 1, 'w', NULL)),
      (jsonb_build_object('s', 1, 'r', 'sites-v2', 'd', NULL, 'v', NULL, 'w', NULL)),
      (jsonb_build_object('s', 2, 'r', 'sites-v2', 'd', NULL, 'v', NULL, 'w', NULL)),
      (jsonb_build_object('s', 2, 'r', 'sites-v2', 'd', 'Atelier!', 'v', 1, 'w', NULL)),
      (jsonb_build_object('s', 2, 'r', 'sites-v2', 'd', 'atelier', 'v', 1,
        'w', '[{"slot":"display","requested":"x;}","used":"Oswald","code":"FONT_FETCH_FAILED"}]'::jsonb)),
      (jsonb_build_object('s', 2, 'r', 'sites-v2', 'd', 'atelier', 'v', 1,
        'w', '[{"slot":"display","requested":"Inter","used":"Oswald","code":"ANYTHING"}]'::jsonb)),
      (jsonb_build_object('s', 2, 'r', 'sites-v2', 'd', 'atelier', 'v', 1,
        'w', '[{"slot":"display","requested":"Inter","used":"Oswald","code":"FONT_TOO_LARGE","note":"x"}]'::jsonb))
    ) AS cases(c) LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_complete_publication(v_site, v_op_bad, v_bad, 'r-x',
        repeat('f', 64), 'publications/' || v_site || '/' || v_bad || '/' || repeat('c', 64) || '.json',
        repeat('c', 64), v_probe_c, (v_result->>'s')::integer, v_result->>'r', v_result->>'d',
        (v_result->>'v')::integer, CASE WHEN v_result->'w' = 'null'::jsonb THEN NULL ELSE v_result->'w' END);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_callback_ambiguous'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'refused case was accepted: %', v_result; END IF;
  END LOOP;
  IF (SELECT status FROM public.brand_site_publications WHERE id = v_bad) <> 'probing' THEN
    RAISE EXCEPTION 'a refused completion changed the publication';
  END IF;

  -- Not callable by signed-in users.
  IF has_function_privilege('authenticated',
      'public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb,integer,text,text,integer,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb,integer,text,text,integer,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the completion recorder is callable by app users';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W3_DESIGN_SYSTEM_OK';
END;
$w3$;

ROLLBACK;
