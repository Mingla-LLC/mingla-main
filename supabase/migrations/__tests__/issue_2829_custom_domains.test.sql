-- MINGLA-INVARIANT: I-PROPOSED-2829-12 | issue #2829 | A custom domain belongs to exactly one site, only brand admins and owners attach, make main or detach it, it goes live only after the provider verdict and the site-id probe, and detach moves the main address to the Mingla subdomain first.
-- #2829 W8 (AD-10) — a brand's own domain (pg17, BEGIN ... ROLLBACK).
-- Apply every migration through 20280119082829_issue_2829_custom_domains.sql
-- first, then run with ON_ERROR_STOP=1. Every fixture rolls back. Neutral
-- fixtures only.
-- Proves: attach (rank 50, shape, Mingla/provider domains refused, reserved
-- test names only locally, one site per name, max 4, idempotent replay),
-- activation needs probe, set primary only on active hosts, resolve gives a
-- non-primary host its primary (the runtime 308s) and every address the site
-- has had, drift (two failing checks -> misconfigured + notices; 7 days as
-- primary -> subdomain takes over), MX disappearance warning, certificate
-- expiry alert, detach (primary first, 30-day window, owner confirmation),
-- release (window or confirmation; never the main address), re-attach after
-- release, the brand-scoped list (rank 20 reads, rank 50 manages, other brand
-- refused), the probe resolver, grants, and the cron job.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $w8$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin_member uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand_a uuid := gen_random_uuid();
  v_brand_b uuid := gen_random_uuid();
  v_site_a uuid;
  v_site_b uuid;
  v_pub_a uuid := gen_random_uuid();
  v_sub_a uuid;
  v_host uuid;
  v_www uuid;
  v_op uuid := gen_random_uuid();
  v_result jsonb;
  v_row record;
  v_failed boolean;
  v_text text;
  v_ok jsonb := jsonb_build_object('records', jsonb_build_array(
      jsonb_build_object('type', 'A', 'name', '@', 'value', '76.76.21.21')),
    'registrar', 'namecheap', 'mx', jsonb_build_array('mx1.mail.test'),
    'probe_ok', true);
  v_probe jsonb := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', repeat('a', 64),
    'status_code', 200
  );
BEGIN
  -- ── fixtures ────────────────────────────────────────────────────────────
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w8-owner@2829.invalid'), (v_admin_member, 'w8-admin@2829.invalid'),
    (v_marketing, 'w8-marketing@2829.invalid'), (v_other_owner, 'w8-other@2829.invalid'),
    (v_mingla_admin, 'w8-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES
    (v_owner, now(), now()), (v_other_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w8-mingla-admin@2829.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_brand_a, v_owner, 'W8 Brand A', 'w8-brand-a'),
    (v_brand_b, v_other_owner, 'W8 Brand B', 'w8-brand-b');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
    (v_brand_a, v_admin_member, 'brand_admin', now()),
    (v_brand_a, v_marketing, 'marketing_manager', now());
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_grant(v_brand_a, 'rollout', NULL);
  PERFORM public.brand_site_admin_grant(v_brand_b, 'rollout', NULL);
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand_a, v_owner);
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand_b, v_other_owner);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_provision(v_brand_a, gen_random_uuid(), repeat('1', 64));
  v_site_a := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site_a,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site_a AND kind = 'provision'), gen_random_uuid()::text);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_result := public.brand_site_provision(v_brand_b, gen_random_uuid(), repeat('2', 64));
  v_site_b := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site_b,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site_b AND kind = 'provision'), gen_random_uuid()::text);
  INSERT INTO public.brand_site_publications(id, site_id, operation_id,
    source_revision_id, source_digest, artifact_key, artifact_digest, status,
    requested_by, completed_at, probe_summary)
  VALUES (v_pub_a, v_site_a, gen_random_uuid(), 'w8-1', repeat('b', 64),
    'publications/' || v_site_a || '/' || v_pub_a || '/' || repeat('a', 64) || '.json',
    repeat('a', 64), 'published', v_owner, clock_timestamp(), v_probe);
  UPDATE public.brand_sites SET status = 'published', active_publication_id = v_pub_a,
    last_successful_publication_id = v_pub_a WHERE id = v_site_a;
  SELECT id INTO STRICT v_sub_a FROM public.brand_site_hosts
  WHERE site_id = v_site_a AND kind = 'mingla_subdomain' AND status = 'active' AND is_primary;

  -- ── grants: RPC-only, service-role internals ────────────────────────────
  IF has_function_privilege('anon', 'public.brand_site_domain_attach(uuid,text,boolean,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_domain_record_check(uuid,text,text,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_domain_release(uuid,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_domains_due(integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_resolve_probe_host(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_domain_notify(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a domain internal is reachable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.brand_site_domain_attach(uuid,text,boolean,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'brand members cannot attach a domain';
  END IF;

  -- ── attach: rank 50 only ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_attach(v_site_a, 'brand-a.example.com', true, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager attached a domain'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_attach(v_site_a, 'brand-a.example.com', true, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another brand attached a domain to this site'; END IF;

  -- ── attach: names refused ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  FOREACH v_text IN ARRAY ARRAY[
    'shop.usemingla.com', 'x.sites.usemingla.com', 'mingla.app', 'brand.vercel.app',
    'abc.supabase.co', 'brand.test', 'brand.localhost', '10.0.0.1', 'UPPER..bad',
    'no_underscores.com', 'a'
  ] LOOP
    v_failed := false;
    BEGIN PERFORM public.brand_site_domain_attach(v_site_a, v_text, true, gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM IN ('sites_domain_invalid','sites_validation_failed'); END;
    IF NOT v_failed THEN RAISE EXCEPTION 'a refused name was attached: %', v_text; END IF;
  END LOOP;

  -- ── attach: happy path + idempotent replay ──────────────────────────────
  v_result := public.brand_site_domain_attach(v_site_a, 'Brand-A.example.com', true, v_op);
  v_host := (v_result->>'host_id')::uuid;
  IF v_result->>'status' <> 'pending' OR v_result->>'hostname' <> 'brand-a.example.com' THEN
    RAISE EXCEPTION 'attach result wrong: %', v_result;
  END IF;
  IF public.brand_site_domain_attach(v_site_a, 'brand-a.example.com', true, v_op)->>'host_id' <> v_host::text THEN
    RAISE EXCEPTION 'attach replay created another host';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_attach(v_site_a, 'other.example.com', true, v_op);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_idempotency_conflict'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an operation id was reused for another domain'; END IF;
  SELECT * INTO v_row FROM public.brand_site_hosts WHERE id = v_host;
  IF v_row.kind <> 'custom_domain' OR v_row.status <> 'pending' OR v_row.is_primary
    OR NOT v_row.is_apex OR v_row.site_id <> v_site_a THEN
    RAISE EXCEPTION 'attached host row wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log
    WHERE action = 'domain.attached' AND resource_id = v_host::text) THEN
    RAISE EXCEPTION 'attach not audited';
  END IF;

  -- ── one site per name: another brand cannot claim it ────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_attach(v_site_b, 'brand-a.example.com', true, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_domain_taken'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'two sites claimed one domain'; END IF;

  -- ── another brand can't read the list ───────────────────────────────────
  v_failed := false;
  BEGIN PERFORM public.brand_site_domains_list(v_site_a);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another brand read this site''s domains'; END IF;
  IF jsonb_array_length(public.brand_site_domains_list(v_site_b)->'hosts') <> 1 THEN
    RAISE EXCEPTION 'brand B sees a host that is not its own';
  END IF;

  -- ── rank 20 reads, cannot manage ────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_result := public.brand_site_domains_list(v_site_a);
  IF (v_result->>'can_manage')::boolean OR jsonb_array_length(v_result->'hosts') <> 2 THEN
    RAISE EXCEPTION 'marketing list wrong: %', v_result;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  IF NOT (public.brand_site_domains_list(v_site_a)->>'can_manage')::boolean THEN
    RAISE EXCEPTION 'a brand admin cannot manage domains';
  END IF;

  -- ── max 4 custom hosts per site ─────────────────────────────────────────
  v_www := (public.brand_site_domain_attach(v_site_a, 'www.brand-a.example.com', false, gen_random_uuid())->>'host_id')::uuid;
  PERFORM public.brand_site_domain_attach(v_site_a, 'c.example.org', true, gen_random_uuid());
  PERFORM public.brand_site_domain_attach(v_site_a, 'd.example.org', true, gen_random_uuid());
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_attach(v_site_a, 'e.example.org', true, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_domain_limit'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a fifth custom domain was attached'; END IF;

  -- ── not live yet: set primary refused, nothing resolves ─────────────────
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_set_primary(v_site_a, v_host, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_invalid_state'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a pending domain became the main address'; END IF;
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('brand-a.example.com')) THEN
    RAISE EXCEPTION 'a pending domain resolved publicly';
  END IF;
  -- The probe resolver answers for it (the probe is what activates it).
  IF (SELECT site_id FROM public.brand_site_resolve_probe_host('brand-a.example.com')) <> v_site_a THEN
    RAISE EXCEPTION 'probe resolver did not answer for a pending domain';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_probe_host('unknown.example.com')) THEN
    RAISE EXCEPTION 'probe resolver answered for an unknown name';
  END IF;

  -- ── check: provider OK but probe fails -> verifying, never active ───────
  v_result := public.brand_site_domain_record_check(v_host, 'ok', 'pending',
    v_ok || jsonb_build_object('probe_ok', false), 'ref-1');
  IF v_result->>'status' <> 'verifying' THEN RAISE EXCEPTION 'probe failure activated a domain: %', v_result; END IF;
  -- Provider says not verified -> stays waiting.
  v_result := public.brand_site_domain_record_check(v_www, 'pending', 'unknown',
    jsonb_build_object('mx', '[]'::jsonb), NULL);
  IF v_result->>'status' <> 'pending' OR v_result->>'dns_state' <> 'pending' THEN
    RAISE EXCEPTION 'unverified domain changed state: %', v_result;
  END IF;
  -- Malformed facts are refused.
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_record_check(v_host, 'ok', 'issued',
    jsonb_build_object('records', jsonb_build_array(jsonb_build_object('type', 'MX', 'name', '@', 'value', 'x'))), NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an MX record was offered for the owner to change'; END IF;

  -- ── check: provider OK + probe -> active; owner notified ────────────────
  v_result := public.brand_site_domain_record_check(v_host, 'ok', 'issued', v_ok, 'ref-1');
  IF v_result->>'status' <> 'active' OR v_result->>'dns_state' <> 'ok' THEN
    RAISE EXCEPTION 'healthy check did not activate: %', v_result;
  END IF;
  SELECT * INTO v_row FROM public.brand_site_hosts WHERE id = v_host;
  IF v_row.registrar <> 'namecheap' OR v_row.mx_at_attach <> '["mx1.mail.test"]'::jsonb
    OR jsonb_array_length(v_row.dns_records) <> 1 OR v_row.activated_at IS NULL THEN
    RAISE EXCEPTION 'check facts not kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox
    WHERE category_key = 'business.site_domain' AND payload->>'event' = 'activated'
      AND payload->>'host_id' = v_host::text AND user_id = v_owner)
    OR EXISTS (SELECT 1 FROM public.notification_outbox
    WHERE payload->>'host_id' = v_host::text AND user_id = v_marketing) THEN
    RAISE EXCEPTION 'activation notice recipients wrong';
  END IF;

  -- ── live but not main: resolves to the primary (the runtime 308s) ───────
  SELECT * INTO STRICT v_row FROM public.brand_site_resolve_publication('brand-a.example.com');
  IF v_row.is_primary OR v_row.primary_hostname = 'brand-a.example.com' OR v_row.site_id <> v_site_a THEN
    RAISE EXCEPTION 'non-primary custom host resolution wrong';
  END IF;
  IF NOT ('brand-a.example.com' = ANY (v_row.site_hostnames)) THEN
    RAISE EXCEPTION 'resolution does not list the site''s addresses';
  END IF;

  -- ── set primary: only rank 50; then the subdomain 308s to it ────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_set_primary(v_site_a, v_host, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager changed the main address'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_set_primary(v_site_b, v_host, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_not_found'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another brand made this domain its main address'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  PERFORM public.brand_site_domain_set_primary(v_site_a, v_host, gen_random_uuid());
  SELECT * INTO STRICT v_row FROM public.brand_site_resolve_publication(
    (SELECT hostname FROM public.brand_site_hosts WHERE id = v_sub_a));
  IF v_row.is_primary OR v_row.primary_hostname <> 'brand-a.example.com' THEN
    RAISE EXCEPTION 'subdomain does not point at the new main address';
  END IF;
  IF (SELECT count(*) FROM public.brand_site_hosts WHERE site_id = v_site_a AND is_primary) <> 1 THEN
    RAISE EXCEPTION 'more than one main address';
  END IF;

  -- ── drift: one failing check is not enough; two -> misconfigured ────────
  v_result := public.brand_site_domain_record_check(v_host, 'misconfigured', 'issued',
    v_ok || jsonb_build_object('probe_ok', false), NULL);
  IF v_result->>'dns_state' <> 'ok' THEN RAISE EXCEPTION 'one failing check flagged drift'; END IF;
  v_result := public.brand_site_domain_record_check(v_host, 'misconfigured', 'issued',
    v_ok || jsonb_build_object('probe_ok', false), NULL);
  IF v_result->>'dns_state' <> 'misconfigured' OR v_result->>'status' <> 'active' THEN
    RAISE EXCEPTION 'two failing checks did not flag drift: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE category_key = 'business.site_domain' AND payload->>'event' = 'misconfigured'
        AND payload->>'host_id' = v_host::text)
    OR NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log
      WHERE action = 'domain.misconfigured' AND resource_id = v_host::text) THEN
    RAISE EXCEPTION 'drift not notified or audited';
  END IF;
  -- Third failing check: no second notice for the same incident.
  PERFORM public.brand_site_domain_record_check(v_host, 'misconfigured', 'issued',
    v_ok || jsonb_build_object('probe_ok', false), NULL);
  IF (SELECT count(*) FROM public.brand_site_audit_log
      WHERE action = 'domain.misconfigured' AND resource_id = v_host::text) <> 1 THEN
    RAISE EXCEPTION 'one incident audited twice';
  END IF;
  -- Still the main address before 7 days.
  IF NOT (SELECT is_primary FROM public.brand_site_hosts WHERE id = v_host) THEN
    RAISE EXCEPTION 'primary fell back before 7 days';
  END IF;

  -- ── 7 days misconfigured as primary -> the subdomain takes over ─────────
  UPDATE public.brand_site_hosts SET misconfigured_since = clock_timestamp() - interval '7 days 1 minute'
  WHERE id = v_host;
  v_result := public.brand_site_domain_record_check(v_host, 'misconfigured', 'issued',
    v_ok || jsonb_build_object('probe_ok', false), NULL);
  IF NOT (v_result->>'fell_back')::boolean
    OR (SELECT is_primary FROM public.brand_site_hosts WHERE id = v_host)
    OR NOT (SELECT is_primary FROM public.brand_site_hosts WHERE id = v_sub_a) THEN
    RAISE EXCEPTION 'primary did not fall back after 7 days: %', v_result;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE payload->>'event' = 'fallback' AND payload->>'host_id' = v_host::text
        AND user_id = v_owner) THEN
    RAISE EXCEPTION 'owner not told about the fallback';
  END IF;

  -- ── recovery: healthy again -> ok, counter reset ────────────────────────
  v_result := public.brand_site_domain_record_check(v_host, 'ok', 'issued', v_ok, NULL);
  IF v_result->>'dns_state' <> 'ok' OR (v_result->>'misconfigured_checks')::int <> 0
    OR v_result->>'misconfigured_since' IS NOT NULL THEN
    RAISE EXCEPTION 'recovery not recorded: %', v_result;
  END IF;

  -- ── MX disappearance is warned, never caused ────────────────────────────
  v_result := public.brand_site_domain_record_check(v_host, 'ok', 'issued',
    v_ok || jsonb_build_object('mx', '[]'::jsonb), NULL);
  IF NOT (v_result->>'mx_missing')::boolean THEN RAISE EXCEPTION 'MX disappearance not flagged'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE payload->>'event' = 'mx_missing' AND payload->>'host_id' = v_host::text
        AND payload->>'body' LIKE '%We didn''t touch them, but check with your email provider.') THEN
    RAISE EXCEPTION 'MX warning text wrong';
  END IF;
  -- Unknown MX (DNS could not answer) never clears or raises the warning.
  v_result := public.brand_site_domain_record_check(v_host, 'ok', 'issued',
    v_ok - 'mx', NULL);
  IF NOT (v_result->>'mx_missing')::boolean THEN RAISE EXCEPTION 'unknown MX cleared the warning'; END IF;
  v_result := public.brand_site_domain_record_check(v_host, 'ok', 'issued', v_ok, NULL);
  IF (v_result->>'mx_missing')::boolean THEN RAISE EXCEPTION 'MX back did not clear the warning'; END IF;

  -- ── certificate expiring -> admins alerted once per expiry ──────────────
  PERFORM public.brand_site_domain_record_check(v_host, 'ok', 'expiring',
    v_ok || jsonb_build_object('tls_expires_at', (clock_timestamp() + interval '5 days')::text), NULL);
  PERFORM public.brand_site_domain_record_check(v_host, 'ok', 'expiring',
    v_ok || jsonb_build_object('tls_expires_at', (clock_timestamp() + interval '5 days')::text), NULL);
  IF (SELECT count(*) FROM public.brand_site_audit_log
      WHERE action = 'domain.tls_expiring' AND resource_id = v_host::text) <> 1 THEN
    RAISE EXCEPTION 'certificate expiry not alerted exactly once';
  END IF;
  IF (SELECT tls_state FROM public.brand_site_hosts WHERE id = v_host) <> 'expiring' THEN
    RAISE EXCEPTION 'tls state not kept';
  END IF;

  -- ── detach: primary moves FIRST, then 30-day redirect window ────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  PERFORM public.brand_site_domain_set_primary(v_site_a, v_host, gen_random_uuid());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_detach(v_site_a, v_host, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager detached a domain'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  v_result := public.brand_site_domain_detach(v_site_a, v_host, gen_random_uuid());
  IF v_result->>'status' <> 'detaching' OR (v_result->>'release_now')::boolean THEN
    RAISE EXCEPTION 'detach result wrong: %', v_result;
  END IF;
  SELECT * INTO v_row FROM public.brand_site_hosts WHERE id = v_host;
  IF v_row.is_primary OR v_row.redirect_until < clock_timestamp() + interval '29 days 23 hours'
    OR v_row.redirect_until > clock_timestamp() + interval '30 days 1 minute' THEN
    RAISE EXCEPTION 'detach window wrong';
  END IF;
  IF NOT (SELECT is_primary FROM public.brand_site_hosts WHERE id = v_sub_a) THEN
    RAISE EXCEPTION 'the subdomain did not take over on detach';
  END IF;
  -- The custom host still resolves (non-primary -> 308) inside the window.
  SELECT * INTO STRICT v_row FROM public.brand_site_resolve_publication('brand-a.example.com');
  IF v_row.is_primary OR v_row.primary_hostname <> (SELECT hostname FROM public.brand_site_hosts WHERE id = v_sub_a) THEN
    RAISE EXCEPTION 'detaching host does not redirect to the subdomain';
  END IF;
  -- Not released early by the window rule; the main address never.
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_release(v_host, 'REDIRECT_WINDOW_ENDED');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_invalid_state'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'released before the redirect window ended'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_domain_release(v_sub_a, 'OWNER_CONFIRMED');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_not_found'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'the Mingla subdomain was released'; END IF;
  -- Window over: no longer resolves even before release.
  UPDATE public.brand_site_hosts SET redirect_until = clock_timestamp() - interval '1 minute' WHERE id = v_host;
  IF EXISTS (SELECT 1 FROM public.brand_site_resolve_publication('brand-a.example.com')) THEN
    RAISE EXCEPTION 'a host past its redirect window still resolved';
  END IF;
  PERFORM public.brand_site_domain_release(v_host, 'REDIRECT_WINDOW_ENDED');
  IF (SELECT status FROM public.brand_site_hosts WHERE id = v_host) <> 'retired' THEN
    RAISE EXCEPTION 'release did not retire the host';
  END IF;
  -- The retired address is still one of the site's addresses for old artifacts.
  SELECT * INTO STRICT v_row FROM public.brand_site_resolve_publication(
    (SELECT hostname FROM public.brand_site_hosts WHERE id = v_sub_a));
  IF NOT ('brand-a.example.com' = ANY (v_row.site_hostnames)) THEN
    RAISE EXCEPTION 'a released address dropped out of the site''s history';
  END IF;

  -- ── a released name can be attached again (here by brand B) ─────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_result := public.brand_site_domain_attach(v_site_b, 'brand-a.example.com', true, gen_random_uuid());
  IF v_result->>'status' <> 'pending' THEN RAISE EXCEPTION 'released name could not be re-attached'; END IF;

  -- ── never-live address: detach releases at once ─────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  v_result := public.brand_site_domain_detach(v_site_a, v_www, gen_random_uuid());
  IF NOT (v_result->>'release_now')::boolean THEN RAISE EXCEPTION 'a never-live host was not released at once'; END IF;
  PERFORM public.brand_site_domain_release(v_www, 'NEVER_LIVE');

  -- ── due list contains only custom hosts in play ─────────────────────────
  IF EXISTS (SELECT 1 FROM public.brand_site_domains_due(500) due
      WHERE due.host_id IN (v_host, v_www, v_sub_a)) THEN
    RAISE EXCEPTION 'retired or subdomain hosts in the sweep list';
  END IF;

  -- ── locally (environment = local) a .test name may be attached ──────────
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix, environment,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'http://localhost:3101', 'http://localhost:3100',
    'sites.localhost', 'local', v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_member)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_member::text, true);
  -- c/d still count: one slot left after two releases.
  v_result := public.brand_site_domain_attach(v_site_a, 'brand-a.test', true, gen_random_uuid());
  IF v_result->>'status' <> 'pending' THEN RAISE EXCEPTION 'local .test domain refused locally'; END IF;

  -- ── the sweep is scheduled every 6 hours ────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'brand-site-domains-sweep'
      AND schedule = '23 */6 * * *' AND command LIKE '%/functions/v1/brand-site-domains/internal/v1/domains/sweep%') THEN
    RAISE EXCEPTION 'domain sweep not scheduled';
  END IF;

  RAISE NOTICE 'ISSUE_2829_W8_CUSTOM_DOMAINS_OK';
END;
$w8$;

ROLLBACK;
