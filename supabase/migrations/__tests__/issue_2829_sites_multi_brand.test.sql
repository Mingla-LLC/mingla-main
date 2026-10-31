-- MINGLA-INVARIANT: I-PROPOSED-2829-03 | issue #2829 | A soft-deleted brand's site does not resolve publicly; restoring the brand brings the same publication back.
-- MINGLA-INVARIANT: I-PROPOSED-2829-04 | issue #2829 | Publishing and rolling back a site require brand rank 50 (brand admin) or higher; lower ranks are refused by the server.
-- #2829 Sites multi-brand behavioural regression (pg17, BEGIN ... ROLLBACK).
-- Apply every migration through 20280119012829_issue_2829_sites_multi_brand_w1.sql
-- first, then run with ON_ERROR_STOP=1. Every fixture rolls back.
-- CI runs it on a fresh migration replay. On the SEEDED local stack the seed's
-- own environment='local' row is recognised explicitly (see the first block);
-- every other non-production row still fails.
--
-- Section W0 — the environment guard.
-- invariant: I-PROPOSED-2829-05 (DRAFT) — the production database refuses
-- local-only configuration: loopback origins and the sites.localhost suffix
-- are accepted only on an environment='local' row, the environment never
-- changes after insert, and no migration writes a 'local' row.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_failed boolean;
  v_case jsonb;
BEGIN
  -- No migration may leave a local row behind.
  -- #2829 W11 (A24): the one exception is the SEEDED local stack, recognised
  -- by its own migration ledger (sites_local.applied_migrations, created only
  -- by scripts/sites/local/lib/common.sh): its seed (not a migration) writes
  -- exactly one environment='local' row. Anywhere else (CI's fresh replay,
  -- production) any non-production row still fails here, and the static check
  -- scripts/sites/__tests__/issue_2829_local_stack_scripts.test.mjs proves no
  -- migration inserts one.
  IF EXISTS (
    SELECT 1 FROM public.brand_site_service_config config
    WHERE config.environment <> 'production'
      AND NOT (
        config.environment = 'local'
        AND to_regclass('sites_local.applied_migrations') IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'a migration wrote a non-production service config row';
  END IF;

  INSERT INTO auth.users(id) VALUES (v_actor);
  -- Start from an empty table inside this transaction so the single-row key
  -- is free whatever the database already holds.
  DELETE FROM public.brand_site_service_config;

  -- Default environment is production.
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES (
    'sites_v1', 'https://studio.sites.usemingla.com',
    'https://gogi.sites.usemingla.com', 'sites.usemingla.com',
    v_actor, now(), v_actor, now()
  );
  IF (SELECT environment FROM public.brand_site_service_config) <> 'production' THEN
    RAISE EXCEPTION 'environment must default to production';
  END IF;

  -- A production row can never be flipped to local (that would admit loopback).
  v_failed := false;
  BEGIN
    UPDATE public.brand_site_service_config SET environment = 'local',
      cms_origin = 'http://localhost:3101',
      public_runtime_origin = 'http://localhost:3100',
      public_host_suffix = 'sites.localhost';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'brand_site_environment_immutable' THEN RAISE; END IF;
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'production row flipped to local'; END IF;
  DELETE FROM public.brand_site_service_config;

  -- Production rows refuse every local-only value.
  FOREACH v_case IN ARRAY ARRAY[
    jsonb_build_object('cms', 'http://localhost:3101', 'runtime', 'https://gogi.sites.usemingla.com', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'https://localhost:3101', 'runtime', 'https://gogi.sites.usemingla.com', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'http://127.0.0.1:3101', 'runtime', 'https://gogi.sites.usemingla.com', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'https://studio.sites.usemingla.com', 'runtime', 'http://localhost:3100', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'https://studio.sites.usemingla.com', 'runtime', 'https://127.0.0.1:3100', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'https://studio.sites.usemingla.com', 'runtime', 'https://gogi.sites.usemingla.com', 'suffix', 'sites.localhost'),
    -- A2.3: the Docker host gateway is local-only, over http or https.
    jsonb_build_object('cms', 'http://host.docker.internal:3101', 'runtime', 'https://gogi.sites.usemingla.com', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'https://host.docker.internal:3101', 'runtime', 'https://gogi.sites.usemingla.com', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'https://studio.sites.usemingla.com', 'runtime', 'https://host.docker.internal', 'suffix', 'sites.usemingla.com')
  ] LOOP
    v_failed := false;
    BEGIN
      INSERT INTO public.brand_site_service_config(
        config_key, environment, cms_origin, public_runtime_origin,
        public_host_suffix, configured_by, configured_at, updated_by, updated_at
      ) VALUES (
        'sites_v1', 'production', v_case->>'cms', v_case->>'runtime',
        v_case->>'suffix', v_actor, now(), v_actor, now()
      );
    EXCEPTION WHEN check_violation THEN v_failed := true;
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'production row accepted local-only value: %', v_case;
    END IF;
  END LOOP;

  -- Local rows refuse remote origins and the production suffix.
  FOREACH v_case IN ARRAY ARRAY[
    jsonb_build_object('cms', 'https://studio.sites.usemingla.com', 'runtime', 'http://localhost:3100', 'suffix', 'sites.localhost'),
    jsonb_build_object('cms', 'http://localhost:3101', 'runtime', 'https://gogi.sites.usemingla.com', 'suffix', 'sites.localhost'),
    jsonb_build_object('cms', 'http://10.0.0.4:3101', 'runtime', 'http://localhost:3100', 'suffix', 'sites.localhost'),
    jsonb_build_object('cms', 'http://localhost.attacker.invalid:3101', 'runtime', 'http://localhost:3100', 'suffix', 'sites.localhost'),
    jsonb_build_object('cms', 'http://localhost', 'runtime', 'http://localhost:3100', 'suffix', 'sites.localhost'),
    jsonb_build_object('cms', 'http://localhost:3101', 'runtime', 'http://localhost:3100', 'suffix', 'sites.usemingla.com'),
    jsonb_build_object('cms', 'https://host.docker.internal:3101', 'runtime', 'http://localhost:3100', 'suffix', 'sites.localhost'),
    jsonb_build_object('cms', 'http://host.docker.internal.attacker.invalid:3101', 'runtime', 'http://localhost:3100', 'suffix', 'sites.localhost'),
    jsonb_build_object('cms', 'http://host.docker.internal', 'runtime', 'http://localhost:3100', 'suffix', 'sites.localhost')
  ] LOOP
    v_failed := false;
    BEGIN
      INSERT INTO public.brand_site_service_config(
        config_key, environment, cms_origin, public_runtime_origin,
        public_host_suffix, configured_by, configured_at, updated_by, updated_at
      ) VALUES (
        'sites_v1', 'local', v_case->>'cms', v_case->>'runtime',
        v_case->>'suffix', v_actor, now(), v_actor, now()
      );
    EXCEPTION WHEN check_violation THEN v_failed := true;
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'local row accepted a non-local value: %', v_case;
    END IF;
  END LOOP;

  -- Unknown environments are refused.
  v_failed := false;
  BEGIN
    INSERT INTO public.brand_site_service_config(
      config_key, environment, cms_origin, public_runtime_origin,
      public_host_suffix, configured_by, configured_at, updated_by, updated_at
    ) VALUES (
      'sites_v1', 'staging', 'https://studio.sites.usemingla.com',
      'https://gogi.sites.usemingla.com', 'sites.usemingla.com',
      v_actor, now(), v_actor, now()
    );
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown environment accepted'; END IF;

  -- A consistent local row is accepted, and is just as immutable.
  INSERT INTO public.brand_site_service_config(
    config_key, environment, cms_origin, public_runtime_origin,
    public_host_suffix, configured_by, configured_at, updated_by, updated_at
  ) VALUES (
    'sites_v1', 'local', 'http://host.docker.internal:3101', 'http://127.0.0.1:3100',
    'sites.localhost', v_actor, now(), v_actor, now()
  );
  v_failed := false;
  BEGIN
    UPDATE public.brand_site_service_config SET environment = 'production';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'brand_site_environment_immutable' THEN RAISE; END IF;
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'local row flipped to production'; END IF;

  -- The migration text itself never inserts a local row (checked here against
  -- the catalog: no function body or default writes 'local').
  IF (
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brand_site_service_config'
      AND column_name = 'environment'
  ) <> '''production''::text' THEN
    RAISE EXCEPTION 'environment default must stay production';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W0_ENVIRONMENT_GUARD_OK';
END;
$test$;


-- Section W1 — more than one brand.
-- invariant: I-PROPOSED-2829-01 (DRAFT) — no current brand_site_% function
-- pins a single brand, site, operator or hostname.
-- invariant: I-PROPOSED-2829-02 (DRAFT) — recovery evidence alerts and may
-- block a NEW site's first publish, but never removes a published site from
-- public resolution.
-- invariant: I-PROPOSED-2829-03 (DRAFT) — a soft-deleted brand's site does
-- not resolve.
-- invariant: I-PROPOSED-2829-04 (DRAFT) — publish and rollback require rank
-- 50 (brand admin).
DO $w1$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin_member uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand_a uuid := gen_random_uuid();
  v_brand_b uuid := gen_random_uuid();
  v_brand_c uuid := gen_random_uuid();
  v_brand_d uuid := gen_random_uuid();
  v_site_a uuid;
  v_site_b uuid;
  v_pub_a uuid := gen_random_uuid();
  v_pub_b uuid := gen_random_uuid();
  v_result jsonb;
  v_failed boolean;
  v_count integer;
  v_text text;
  v_case text;
  v_probe jsonb := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', repeat('a', 64),
    'status_code', 200
  );
BEGIN
  -- ── catalog: the pilot binding is gone, no literal survives ──────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'brand_site_service_config'
      AND column_name IN ('pilot_brand_id','pilot_site_id','pilot_enabled')
  ) THEN
    RAISE EXCEPTION 'pilot columns survived';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('brand_site_activate_gogi_pilot',
        'brand_site_deactivate_gogi_pilot','brand_site_configure_pilot_binding')
  ) THEN
    RAISE EXCEPTION 'pilot activation functions survived';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'brand_site%'
    AND (pg_get_functiondef(p.oid) ~* '(gogi\.sites\.usemingla\.com|733bc470-45e1-4684-8896-acd7e26074ff|1f3d2ddf-b741-4e2f-8884-d7222a660c7e|pilot_brand_id|pilot_site_id|pilot_enabled|activate_gogi_pilot|deactivate_gogi_pilot)');
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'single-tenant literal in current function definition(s): %', v_text;
  END IF;
  SELECT string_agg(conname, ', ') INTO v_text
  FROM pg_constraint
  WHERE conrelid::regclass::text LIKE 'brand_site%'
    AND pg_get_constraintdef(oid) ~* 'gogi\.sites\.usemingla\.com';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'single-tenant literal in constraint(s): %', v_text;
  END IF;
  -- R-7: the resolver carries no recovery-evidence predicate.
  IF pg_get_functiondef('public.brand_site_resolve_publication(text)'::regprocedure)
      ~* '(verified_at|backup_retention_days|restore_drill|recovery)' THEN
    RAISE EXCEPTION 'resolver gates on recovery evidence';
  END IF;
  -- New tables are private: RLS forced, no anon/authenticated grants.
  IF has_table_privilege('authenticated', 'public.brand_site_entitlements', 'SELECT')
    OR has_table_privilege('anon', 'public.brand_site_entitlements', 'SELECT')
    OR has_table_privilege('authenticated', 'public.brand_site_reserved_labels', 'SELECT')
    OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.brand_site_entitlements'::regclass)
    OR NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.brand_site_reserved_labels'::regclass)
    OR has_function_privilege('authenticated', 'public.brand_site_resolve_publication(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_record_recovery_state(text, timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_complete_export(uuid, uuid, text, timestamptz, bigint)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.brand_site_set_owner_offline(uuid, boolean, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'W1 grants are not least privilege';
  END IF;

  -- ── label derivation ────────────────────────────────────────────────────
  FOREACH v_case IN ARRAY ARRAY[
    'gögi|gogi', 'Young & Stamped|young-stamped', 'Café Ñoño|cafe-nono',
    'snake_case_brand|snake-case-brand', '  --Hello--World--  |hello-world',
    'Straße Œuvre|strasse-oeuvre', '!!!|site', '|site', 'ŁÓDŹ Żółć|lodz-zolc'
  ] LOOP
    IF public.brand_site_subdomain_label(split_part(v_case, '|', 1)) <> split_part(v_case, '|', 2) THEN
      RAISE EXCEPTION 'label derivation: % gave %', v_case,
        public.brand_site_subdomain_label(split_part(v_case, '|', 1));
    END IF;
  END LOOP;
  v_text := public.brand_site_subdomain_label(repeat('ab-', 40));
  IF length(v_text) > 63 OR v_text ~ '(^-|-$)' THEN
    RAISE EXCEPTION 'long label not truncated safely: %', v_text;
  END IF;

  -- ── host shape (parity cases with isValidSiteHostname in sitesContracts) ─
  FOREACH v_case IN ARRAY ARRAY[
    'gogi.sites.usemingla.com', 'young-stamped.sites.localhost', 'a1.example.co.uk'
  ] LOOP
    IF NOT (v_case ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
      AND length(v_case) BETWEEN 4 AND 253) THEN
      RAISE EXCEPTION 'valid host refused by the shape rule: %', v_case;
    END IF;
  END LOOP;

  -- ── fixtures: four brands, one owner, a brand admin, a marketing manager ─
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w1-owner@2829.invalid'), (v_admin_member, 'w1-admin@2829.invalid'),
    (v_marketing, 'w1-marketing@2829.invalid'), (v_outsider, 'w1-outsider@2829.invalid'),
    (v_mingla_admin, 'w1-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w1-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_brand_a, v_owner, 'W1 Café Ñoño', 'w1-cafe-nono'),
    (v_brand_b, v_owner, 'W1 Second', 'w1-second'),
    (v_brand_c, v_owner, 'W1 Admin', 'admin'),
    (v_brand_d, v_owner, 'W1 Explicitly Revoked', 'w1-never');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  SELECT b, u, r, now() FROM (VALUES
    (v_brand_a, v_admin_member, 'brand_admin'), (v_brand_a, v_marketing, 'marketing_manager'),
    (v_brand_b, v_admin_member, 'brand_admin'), (v_brand_b, v_marketing, 'marketing_manager')
  ) AS member(b, u, r);
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_mingla_admin, now(), v_mingla_admin, now());

  -- ── entitlements: only a Mingla admin grants; reason required ───────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_admin_grant(v_brand_a, 'rollout', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a brand owner granted Sites to itself'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_admin_grant(v_brand_a, 'because', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'grant accepted an unknown reason'; END IF;
  PERFORM public.brand_site_admin_grant(v_brand_a, 'rollout', 'W1 fixture');
  PERFORM public.brand_site_admin_grant(v_brand_b, 'rollout', NULL);
  PERFORM public.brand_site_admin_grant(v_brand_c, 'support', NULL);
  PERFORM public.brand_site_admin_revoke(v_brand_d, 'support', 'W1 negative fixture');
  IF (SELECT count(*) FROM public.brand_site_audit_log
      WHERE action = 'entitlement.granted' AND actor_kind = 'admin'
        AND brand_id IN (v_brand_a, v_brand_b, v_brand_c)) <> 3 THEN
    RAISE EXCEPTION 'grants were not audited';
  END IF;

  -- ── availability ────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_result := public.brand_site_business_availability(v_brand_a);
  IF v_result->>'available' <> 'true' OR v_result->>'can_publish' <> 'false'
    OR v_result->>'can_create' <> 'false' OR v_result->>'can_edit' <> 'true' THEN
    RAISE EXCEPTION 'marketing availability wrong: %', v_result;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_business_availability(v_brand_d);
  IF v_result->>'available' <> 'false' THEN
    RAISE EXCEPTION 'explicitly revoked brand reported available';
  END IF;

  -- ── provisioning gates ──────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_provision(v_brand_a, gen_random_uuid(), repeat('1', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'marketing manager provisioned a site'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_provision(v_brand_d, gen_random_uuid(), repeat('1', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an explicitly revoked brand provisioned a site'; END IF;

  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand_a, v_owner);
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand_b, v_owner);

  v_result := public.brand_site_propose_label(v_brand_a);
  IF v_result->>'label' <> 'w1-cafe-nono' OR v_result->>'hostname' <> 'w1-cafe-nono.sites.usemingla.com' THEN
    RAISE EXCEPTION 'proposed label wrong: %', v_result;
  END IF;
  v_result := public.brand_site_propose_label(v_brand_c);
  IF v_result->>'label' <> 'admin-2' THEN
    RAISE EXCEPTION 'a reserved word was proposed: %', v_result;
  END IF;

  -- brand admin (50) provisions A; owner provisions B with a taken label
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  v_result := public.brand_site_provision(v_brand_a, gen_random_uuid(), repeat('1', 64));
  v_site_a := (v_result->>'site_id')::uuid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_provision(v_brand_b, gen_random_uuid(), repeat('2', 64), 'w1-cafe-nono');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_label_unavailable'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a taken label was accepted'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_provision(v_brand_b, gen_random_uuid(), repeat('2', 64), 'www');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_label_unavailable'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a reserved label was accepted'; END IF;
  v_result := public.brand_site_provision(v_brand_b, gen_random_uuid(), repeat('2', 64));
  v_site_b := (v_result->>'site_id')::uuid;
  IF (SELECT hostname FROM public.brand_site_hosts WHERE site_id = v_site_a) <> 'w1-cafe-nono.sites.usemingla.com'
    OR (SELECT hostname FROM public.brand_site_hosts WHERE site_id = v_site_b) <> 'w1-second.sites.usemingla.com'
    OR (SELECT status FROM public.brand_site_hosts WHERE site_id = v_site_a) <> 'pending' THEN
    RAISE EXCEPTION 'provisioned hosts wrong';
  END IF;
  -- Only a Mingla admin reserves labels; a reserved word then gets a variant.
  v_failed := false;
  BEGIN PERFORM public.brand_site_admin_reserve_label('w1-never', 'brand_protection');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an owner reserved a label'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_reserve_label('w1-never', 'brand_protection');
  PERFORM public.brand_site_admin_grant(v_brand_d, 'rollout', NULL);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF public.brand_site_propose_label(v_brand_d)->>'label' <> 'w1-never-2' THEN
    RAISE EXCEPTION 'reserved label not avoided';
  END IF;

  -- The label never changes afterwards (a later proposal returns it as is).
  IF public.brand_site_propose_label(v_brand_a)->>'existing' <> 'true' THEN
    RAISE EXCEPTION 'proposal for a provisioned site is not its existing label';
  END IF;
  v_failed := false;
  BEGIN
    UPDATE public.brand_site_hosts SET hostname = 'renamed.sites.usemingla.com',
      label = 'renamed' WHERE site_id = v_site_a;
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_host_immutable'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a site address changed'; END IF;
  -- Subdomain hosts must match label + suffix; custom domains refuse ours.
  v_failed := false;
  BEGIN
    INSERT INTO public.brand_site_hosts(site_id, hostname, kind, status, is_primary, label)
    VALUES (v_site_b, 'other.sites.usemingla.com', 'mingla_subdomain', 'pending', false, 'mismatch');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_host_invalid'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'subdomain host not bound to its label'; END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.brand_site_hosts(site_id, hostname, kind, status, is_primary)
    VALUES (v_site_b, 'evil.sites.usemingla.com', 'custom_domain', 'pending', false);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_host_invalid'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a Mingla domain was accepted as a custom domain'; END IF;
  FOREACH v_case IN ARRAY ARRAY['Upper.example.com', 'a..b.com', '-a.example.com',
    'example.com.', 'no-dot', 'a*b.example.com', 'x.y'] LOOP
    v_failed := false;
    BEGIN
      INSERT INTO public.brand_site_hosts(site_id, hostname, kind, status, is_primary)
      VALUES (v_site_b, v_case, 'custom_domain', 'pending', false);
    EXCEPTION WHEN check_violation THEN v_failed := true; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'malformed hostname accepted: %', v_case; END IF;
  END LOOP;

  -- Completing provisioning activates the subdomain.
  PERFORM public.brand_site_complete_provision(v_site_a,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site_a AND kind = 'provision'), gen_random_uuid()::text);
  PERFORM public.brand_site_complete_provision(v_site_b,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site_b AND kind = 'provision'), gen_random_uuid()::text);
  IF EXISTS (SELECT 1 FROM public.brand_site_hosts WHERE site_id IN (v_site_a, v_site_b)
    AND status <> 'active') THEN
    RAISE EXCEPTION 'provisioned subdomain not activated';
  END IF;

  -- ── first publish needs evidence; publish needs rank 50 ─────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_authorize_operation(v_site_a, gen_random_uuid(),
      'publish', repeat('3', 64), 'rev-1', repeat('4', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'first publish without recovery evidence'; END IF;
  -- Synthetic evidence is refused on a production row.
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_record_readiness_evidence(v_site_a, gen_random_uuid(),
      repeat('5', 64), jsonb_build_object(
        'schema_version', 1, 'evidence_kind', 'restore_drill',
        'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'restore_drill_verified_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'restore_drill_evidence_digest', repeat('6', 64), 'tenant_count', 1,
        'document_count', 1, 'object_count', 0, 'object_bytes', 0),
      'local_synthetic');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'production accepted local_synthetic evidence'; END IF;
  -- #2829 W11 (A7): each kind of stale recovery evidence is refused by the
  -- recorder (never recorded) and blocks a NEW site's first publish, while it
  -- never takes a published site down (R-7 below). These replace the pilot
  -- switch's "stale manifest / restore drill / host probe activated" checks.
  v_result := (SELECT to_jsonb(config) FROM public.brand_site_service_config config);
  v_count := (SELECT count(*) FROM public.brand_site_readiness_receipts);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_record_readiness_evidence(v_site_a, gen_random_uuid(),
      repeat('a', 64), jsonb_build_object(
        'schema_version', 1, 'evidence_kind', 'nightly_backup',
        'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'backup_retention_days', 7,
        'database_backup_verified_at', to_char((clock_timestamp() - interval '1 minute') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'object_manifest_verified_at', to_char((clock_timestamp() - interval '26 hours 1 second') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'manifest_digest', repeat('2', 64), 'backup_bundle_digest', repeat('3', 64),
        'object_count', 0, 'object_bytes', 0));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
  IF NOT v_failed
    OR (SELECT to_jsonb(config) FROM public.brand_site_service_config config) IS DISTINCT FROM v_result
    OR (SELECT count(*) FROM public.brand_site_readiness_receipts) <> v_count THEN
    RAISE EXCEPTION 'stale manifest evidence recorded';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_record_readiness_evidence(v_site_a, gen_random_uuid(),
      repeat('c', 64), jsonb_build_object(
        'schema_version', 1, 'evidence_kind', 'restore_drill',
        'observed_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'restore_drill_verified_at', to_char((clock_timestamp() - interval '100 days 1 second') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'restore_drill_evidence_digest', repeat('d', 64), 'tenant_count', 1,
        'document_count', 1, 'object_count', 0, 'object_bytes', 0));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
  IF NOT v_failed
    OR (SELECT to_jsonb(config) FROM public.brand_site_service_config config) IS DISTINCT FROM v_result
    OR (SELECT count(*) FROM public.brand_site_readiness_receipts) <> v_count THEN
    RAISE EXCEPTION 'stale restore drill evidence recorded';
  END IF;
  -- Everything fresh except one kind: a new site's first publish still waits.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  FOREACH v_case IN ARRAY ARRAY['manifest', 'restore_drill'] LOOP
    UPDATE public.brand_site_service_config SET
      backup_retention_days = 14, backup_entitlement_verified_at = clock_timestamp(),
      database_backup_verified_at = clock_timestamp(),
      object_manifest_verified_at = CASE WHEN v_case = 'manifest'
        THEN clock_timestamp() - interval '26 hours 1 second' ELSE clock_timestamp() END,
      restore_drill_verified_at = CASE WHEN v_case = 'restore_drill'
        THEN clock_timestamp() - interval '100 days 1 second' ELSE clock_timestamp() END,
      restore_drill_evidence_digest = repeat('7', 64);
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_authorize_operation(v_site_a, gen_random_uuid(),
        'publish', repeat('3', 64), 'rev-1', repeat('4', 64));
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'first publish allowed on a stale %', v_case; END IF;
  END LOOP;
  -- Fresh shared evidence (stamped directly; the recording RPC is covered by #2893).
  UPDATE public.brand_site_service_config SET
    backup_retention_days = 14, backup_entitlement_verified_at = clock_timestamp(),
    database_backup_verified_at = clock_timestamp(),
    object_manifest_verified_at = clock_timestamp(),
    restore_drill_verified_at = clock_timestamp(),
    restore_drill_evidence_digest = repeat('7', 64);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  -- R-6: a marketing manager previews but never publishes or rolls back.
  PERFORM public.brand_site_authorize_operation(v_site_a, gen_random_uuid(),
    'preview', repeat('3', 64), 'rev-1', repeat('4', 64));
  FOREACH v_case IN ARRAY ARRAY['publish', 'rollback'] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.brand_site_authorize_operation(v_site_a, gen_random_uuid(),
        v_case, repeat('3', 64), 'rev-1', repeat('4', 64));
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'marketing manager authorized %', v_case; END IF;
  END LOOP;
  -- ...nor takes the site offline or exports it.
  v_failed := false;
  BEGIN PERFORM public.brand_site_set_owner_offline(v_site_a, true, gen_random_uuid(), NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'marketing manager took the site offline'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_request_export(v_site_a, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'marketing manager exported the site'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  v_result := public.brand_site_authorize_operation(v_site_a, gen_random_uuid(),
    'publish', repeat('3', 64), 'rev-1', repeat('4', 64));
  IF v_result->>'status' <> 'authorized' THEN RAISE EXCEPTION 'brand admin publish refused'; END IF;
  -- A brand admin of A cannot act on a site of a brand it is not a member of.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_authorize_operation(v_site_b, gen_random_uuid(),
      'preview', repeat('3', 64), 'rev-1', repeat('4', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an outsider previewed another brand''s site'; END IF;

  -- ── publish both sites (direct fixture) and resolve ─────────────────────
  INSERT INTO public.brand_site_publications(id, site_id, operation_id,
    source_revision_id, source_digest, artifact_key, artifact_digest, status,
    requested_by, completed_at, probe_summary)
  VALUES
    (v_pub_a, v_site_a, gen_random_uuid(), 'a-1', repeat('b', 64),
     'publications/' || v_site_a || '/' || v_pub_a || '/' || repeat('a', 64) || '.json',
     repeat('a', 64), 'published', v_owner, clock_timestamp(), v_probe),
    (v_pub_b, v_site_b, gen_random_uuid(), 'b-1', repeat('b', 64),
     'publications/' || v_site_b || '/' || v_pub_b || '/' || repeat('a', 64) || '.json',
     repeat('a', 64), 'published', v_owner, clock_timestamp(), v_probe);
  UPDATE public.brand_sites SET status = 'published', active_publication_id = v_pub_a,
    last_successful_publication_id = v_pub_a WHERE id = v_site_a;
  UPDATE public.brand_sites SET status = 'published', active_publication_id = v_pub_b,
    last_successful_publication_id = v_pub_b WHERE id = v_site_b;

  SELECT count(*) INTO v_count FROM public.brand_site_resolve_publication('w1-cafe-nono.sites.usemingla.com') r
  WHERE r.site_id = v_site_a AND r.is_primary AND r.primary_hostname = 'w1-cafe-nono.sites.usemingla.com';
  IF v_count <> 1 THEN RAISE EXCEPTION 'site A does not resolve on its own host'; END IF;
  -- Each host resolves only its own site, and mixed case still names it.
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('W1-SECOND.sites.usemingla.com') r
    WHERE r.site_id <> v_site_b)
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'host resolution crossed sites';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('unknown.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'an unknown host resolved';
  END IF;

  -- R-4 (#3652): a touch can only be spent on a real order of its own brand.
  INSERT INTO public.brand_site_attribution_touches(site_id, brand_id,
    publication_id, token_digest, consent_policy_version, source_kind, expires_at)
  VALUES (v_site_a, v_brand_a, v_pub_a, repeat('9', 64), 'sites-v1', 'site',
    clock_timestamp() + interval '20 minutes');
  v_failed := false;
  BEGIN PERFORM public.brand_site_consume_attribution(repeat('9', 64), gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_attribution_forbidden'; END;
  IF NOT v_failed OR EXISTS (SELECT 1 FROM public.brand_site_attribution_touches
      WHERE token_digest = repeat('9', 64) AND order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a touch was spent on an order it never verified';
  END IF;
  -- The host binding used by previews resolves only the host's own site.
  IF (SELECT site_id FROM public.brand_site_resolve_host('w1-second.sites.usemingla.com')) <> v_site_b
    OR EXISTS (SELECT 1 FROM public.brand_site_resolve_host('unknown.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'host binding crossed sites';
  END IF;

  -- #2829 W11 (A7): a host probe older than 15 minutes is refused (not
  -- recorded) even for the site's own primary host and live publication, and
  -- the site keeps resolving; the same probe made now is accepted.
  v_count := (SELECT count(*) FROM public.brand_site_readiness_receipts);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_record_host_readiness(v_site_a, gen_random_uuid(),
      clock_timestamp() - interval '15 minutes 1 second', 'w1-cafe-nono.sites.usemingla.com',
      v_pub_a, repeat('a', 64), repeat('6', 64), repeat('7', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
  IF NOT v_failed
    OR (SELECT count(*) FROM public.brand_site_readiness_receipts) <> v_count
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-cafe-nono.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'stale host probe accepted';
  END IF;
  v_result := public.brand_site_record_host_readiness(v_site_a, gen_random_uuid(),
    clock_timestamp(), 'w1-cafe-nono.sites.usemingla.com',
    v_pub_a, repeat('a', 64), repeat('6', 64), repeat('7', 64));
  IF v_result->>'status' <> 'verified' THEN
    RAISE EXCEPTION 'a fresh host probe of the site''s own host was refused: %', v_result;
  END IF;

  -- R-7: stale recovery evidence and a recorded "stale" alert leave both sites up.
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - interval '30 days',
    object_manifest_verified_at = clock_timestamp() - interval '30 days',
    backup_entitlement_verified_at = clock_timestamp() - interval '30 days',
    restore_drill_verified_at = clock_timestamp() - interval '200 days';
  v_result := public.brand_site_record_recovery_state('stale', clock_timestamp());
  IF (SELECT recovery_alert_state FROM public.brand_site_service_config) <> 'stale'
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_readiness_receipts
      WHERE evidence_kind = 'recovery_alert' AND evidence_payload->>'state' = 'stale')
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-cafe-nono.sites.usemingla.com'))
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com'))
    OR EXISTS (SELECT 1 FROM public.brand_site_hosts WHERE site_id IN (v_site_a, v_site_b) AND status <> 'active') THEN
    RAISE EXCEPTION 'stale recovery evidence took a site down or was not recorded';
  END IF;

  -- Owner offline: rank 50, idempotent, audited; back online restores it.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  v_text := gen_random_uuid()::text;
  v_result := public.brand_site_set_owner_offline(v_site_a, true, v_text::uuid, 'holiday');
  PERFORM public.brand_site_set_owner_offline(v_site_a, true, v_text::uuid, 'holiday');
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-cafe-nono.sites.usemingla.com'))
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'owner offline did not hide exactly that site';
  END IF;
  PERFORM public.brand_site_set_owner_offline(v_site_a, false, gen_random_uuid(), NULL);
  IF (SELECT publication_id FROM public.brand_site_resolve_publication('w1-cafe-nono.sites.usemingla.com')) <> v_pub_a THEN
    RAISE EXCEPTION 'back online did not restore the same publication';
  END IF;
  IF (SELECT count(*) FROM public.brand_site_audit_log WHERE site_id = v_site_a
      AND action IN ('site.owner_offline','site.owner_online')) <> 2 THEN
    RAISE EXCEPTION 'offline/online not audited exactly once each';
  END IF;

  -- R-5: soft-deleting the brand hides its site at once; restoring brings it back.
  UPDATE public.brands SET deleted_at = now() WHERE id = v_brand_b;
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'a soft-deleted brand''s site resolved';
  END IF;
  UPDATE public.brands SET deleted_at = NULL WHERE id = v_brand_b;
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'restoring the brand did not restore its site';
  END IF;

  -- Revoking the entitlement hides the site; regrant restores it; others stay up.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_revoke(v_brand_b, 'support', NULL);
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com'))
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-cafe-nono.sites.usemingla.com'))
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_publications WHERE id = v_pub_b) THEN
    RAISE EXCEPTION 'revocation wrong (site must hide, publications stay, others up)';
  END IF;
  PERFORM public.brand_site_admin_grant(v_brand_b, 'rollout', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'regrant did not restore the site';
  END IF;

  -- Suspended hides; a detaching host still resolves; a non-primary host says so.
  INSERT INTO public.brand_site_hosts(site_id, hostname, kind, status, is_primary)
  VALUES (v_site_b, 'w1-second-brand.example.com', 'custom_domain', 'active', false);
  SELECT count(*) INTO v_count FROM public.brand_site_resolve_publication('w1-second-brand.example.com') r
  WHERE NOT r.is_primary AND r.primary_hostname = 'w1-second.sites.usemingla.com';
  IF v_count <> 1 THEN RAISE EXCEPTION 'non-primary host does not name the primary'; END IF;
  -- #2829 W8 — a detaching host carries its redirect window (30 days).
  UPDATE public.brand_site_hosts SET status = 'detaching',
    redirect_until = now() + interval '30 days'
  WHERE hostname = 'w1-second-brand.example.com';
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second-brand.example.com')) THEN
    RAISE EXCEPTION 'a detaching host stopped resolving';
  END IF;
  PERFORM public.brand_site_admin_action(v_site_b, gen_random_uuid(), 'suspend', 'POLICY_REVIEW');
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'a suspended site resolved';
  END IF;
  PERFORM public.brand_site_admin_action(v_site_b, gen_random_uuid(), 'resume', 'POLICY_REVIEW');
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('w1-second.sites.usemingla.com')) THEN
    RAISE EXCEPTION 'resume did not restore the site';
  END IF;

  -- Advertisable view excludes owner-offline and revoked sites.
  UPDATE public.brand_site_publications SET public_checked_at = now(),
    public_reachable = true, public_status_code = 200 WHERE id IN (v_pub_a, v_pub_b);
  IF (SELECT count(*) FROM public.ad_public_site_destinations_view
      WHERE id IN (v_site_a, v_site_b)) <> 2 THEN
    RAISE EXCEPTION 'advertisable view misses live sites';
  END IF;
  UPDATE public.brand_sites SET owner_offline_at = now(), owner_offline_by = v_owner WHERE id = v_site_a;
  PERFORM public.brand_site_admin_revoke(v_brand_b, 'support', NULL);
  IF EXISTS (SELECT 1 FROM public.ad_public_site_destinations_view WHERE id IN (v_site_a, v_site_b)) THEN
    RAISE EXCEPTION 'advertisable view lists offline or revoked sites';
  END IF;

  -- Studio/Ari authorization follows the entitlement too.
  v_failed := false;
  BEGIN PERFORM public.brand_site_internal_authorize(v_site_b, v_owner, 20);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'revoked brand authorized for Studio'; END IF;

  -- Export: rank 50 creates an executing receipt; Core completes it.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_text := gen_random_uuid()::text;
  PERFORM public.brand_site_request_export(v_site_a, v_text::uuid);
  PERFORM public.brand_site_complete_export(v_site_a, v_text::uuid,
    'https://storage.example.invalid/signed', clock_timestamp() + interval '24 hours', 1024);
  IF (SELECT status FROM public.brand_site_operation_receipts WHERE operation_id = v_text::uuid) <> 'succeeded' THEN
    RAISE EXCEPTION 'export receipt not completed';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W1_MULTI_BRAND_OK';
END;
$w1$;

ROLLBACK;
