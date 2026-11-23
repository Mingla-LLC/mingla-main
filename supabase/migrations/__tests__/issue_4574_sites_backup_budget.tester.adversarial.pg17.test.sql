-- MINGLA-INVARIANT: I-4574-SITES-GATE-BOUNDARIES | issue #4574 | The first-publish gate refuses a database backup at or past brand_site_database_backup_budget() and accepts one second inside it, keeps the 26 h manifest and 100 day drill limits, and leaves preview, rollback and non-first publish ungated, also when called as the authenticated role.
-- #4574 tester adversarial (pg17, BEGIN ... ROLLBACK, profile psql-pg17-post-replay).
-- Different angles from the implementor's suite (30 h / 49 h / 27 h cases):
--   * exact boundaries: backup exactly 48 h old is refused, 48 h - 1 s accepted;
--     NULL refused; a future-dated stamp accepted (as before #4574);
--   * the manifest limit is still 26 h (26 h - 1 s accepted, 26 h + 1 s refused);
--   * the restore drill limit is still 100 days (99 d accepted, 100 d + 1 s refused);
--   * the gate runs AS the authenticated role (SET LOCAL ROLE): the helpers are
--     revoked from authenticated, so this proves SECURITY DEFINER still reaches
--     them and nothing widened (anon still has no EXECUTE on the gate);
--   * every other operation is unchanged: preview and a NON-first publish
--     succeed with stale evidence, rollback is not readiness-gated, and an
--     unknown kind is still sites_validation_failed;
--   * the gate header is unchanged: SECURITY DEFINER, search_path public,pg_temp,
--     owner postgres, EXECUTE for authenticated + service_role only;
--   * service_role can INSERT/UPDATE the watch row (the hourly ready mark);
--   * re-running the cron.schedule call keeps exactly one job (idempotent).
-- Rework (claim before send), tester angles:
--   * claim and release are SECURITY DEFINER, search_path pg_catalog,pg_temp,
--     and anon / authenticated / PUBLIC cannot EXECUTE them; calling claim as
--     the authenticated role is refused (no forging or suppressing alerts);
--   * release misuse: a stale release for a delivered warn after a critical
--     was claimed, a release for another closing time, and a heartbeat release
--     for another completion all change nothing;
--   * release restores exactly the prior the claim returned;
--   * the unproven 2 h window is exact in SQL (2 h - 1 s refused, 2 h + 1 s claimed).
-- FAILS-ON-REVERT: with the gate back on `interval '26 hours'` the
-- 48 h - 1 s case raises 'backup 48 h - 1 s old blocked first publish'.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t4574_try(p_site uuid, p_kind text, p_rev text)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM public.brand_site_authorize_operation(p_site, gen_random_uuid(),
    p_kind, encode(sha256(convert_to(p_rev || 'a', 'UTF8')), 'hex'), p_rev,
    encode(sha256(convert_to(p_rev || 's', 'UTF8')), 'hex'));
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$f$;

DO $t4574adv$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_site uuid;
  v_result jsonb;
  v_r text;
  v_pub uuid;
BEGIN
  -- ── header unchanged ───────────────────────────────────────────────────
  IF NOT (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp']
            AND pg_get_userbyid(p.proowner) = 'postgres'
          FROM pg_proc p WHERE p.oid = 'public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'gate header changed (security definer / search_path / owner)';
  END IF;
  IF has_function_privilege('anon', 'public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_database_backup_budget()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_object_manifest_budget()', 'EXECUTE') THEN
    RAISE EXCEPTION 'gate or helper grants widened or lost';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.brand_site_recovery_watch_state', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.brand_site_recovery_watch_state', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role cannot write the watch ready mark';
  END IF;

  -- ── fixture ────────────────────────────────────────────────────────────
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'owner-4574-adv@example.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES (v_brand, v_owner, 'Adv 4574', 'adv-4574');
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_owner, now(), v_owner, now());
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand, v_owner);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_provision(v_brand, gen_random_uuid(), repeat('1', 64));
  v_site := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site AND kind = 'provision'), gen_random_uuid()::text);
  UPDATE public.brand_site_service_config SET
    backup_retention_days = 14, backup_entitlement_verified_at = clock_timestamp(),
    database_backup_verified_at = clock_timestamp() - interval '1 hour',
    object_manifest_verified_at = clock_timestamp() - interval '1 hour',
    restore_drill_verified_at = clock_timestamp() - interval '1 day',
    restore_drill_evidence_digest = repeat('7', 64);

  -- From here the gate runs as the authenticated role, like PostgREST.
  SET LOCAL ROLE authenticated;
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'SET LOCAL ROLE did not take effect (%)', current_user; END IF;

  -- ── database backup boundaries ─────────────────────────────────────────
  RESET ROLE;
  UPDATE public.brand_site_service_config SET database_backup_verified_at = clock_timestamp() - interval '48 hours' + interval '1 second';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-48h-minus-1s');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'backup 48 h - 1 s old blocked first publish (%)', v_r; END IF;

  RESET ROLE;
  UPDATE public.brand_site_service_config SET database_backup_verified_at = clock_timestamp() - interval '48 hours';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-48h-exact');
  IF v_r <> 'sites_readiness_blocked' THEN RAISE EXCEPTION 'backup exactly 48 h old was not refused (%)', v_r; END IF;

  RESET ROLE;
  UPDATE public.brand_site_service_config SET database_backup_verified_at = NULL;
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-null');
  IF v_r <> 'sites_readiness_blocked' THEN RAISE EXCEPTION 'NULL backup stamp was not refused (%)', v_r; END IF;

  RESET ROLE;
  UPDATE public.brand_site_service_config SET database_backup_verified_at = clock_timestamp() + interval '5 hours';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-future');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'future-dated stamp behaviour changed (%)', v_r; END IF;

  -- ── manifest still 26 h ────────────────────────────────────────────────
  RESET ROLE;
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - interval '1 hour',
    object_manifest_verified_at = clock_timestamp() - interval '26 hours' + interval '1 second';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-man-26h-minus-1s');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'manifest 26 h - 1 s blocked (%)', v_r; END IF;
  RESET ROLE;
  UPDATE public.brand_site_service_config SET object_manifest_verified_at = clock_timestamp() - interval '26 hours' - interval '1 second';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-man-26h-plus-1s');
  IF v_r <> 'sites_readiness_blocked' THEN RAISE EXCEPTION 'manifest 26 h + 1 s was not refused (%)', v_r; END IF;

  -- ── restore drill still 100 days ───────────────────────────────────────
  RESET ROLE;
  UPDATE public.brand_site_service_config SET
    object_manifest_verified_at = clock_timestamp() - interval '1 hour',
    restore_drill_verified_at = clock_timestamp() - interval '99 days';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-drill-99d');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'drill 99 d blocked (%)', v_r; END IF;
  RESET ROLE;
  UPDATE public.brand_site_service_config SET restore_drill_verified_at = clock_timestamp() - interval '100 days' - interval '1 second';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-drill-100d');
  IF v_r <> 'sites_readiness_blocked' THEN RAISE EXCEPTION 'drill 100 d + 1 s was not refused (%)', v_r; END IF;

  -- ── every other operation is unchanged under stale evidence ────────────
  RESET ROLE;
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - interval '400 hours',
    object_manifest_verified_at = clock_timestamp() - interval '400 hours';
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'preview', 'adv-preview-stale');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'preview became readiness-gated (%)', v_r; END IF;
  v_r := pg_temp.t4574_try(v_site, 'rollback', 'adv-rollback-stale');
  IF v_r = 'sites_readiness_blocked' THEN RAISE EXCEPTION 'rollback became readiness-gated'; END IF;
  v_r := pg_temp.t4574_try(v_site, 'delete', 'adv-unknown-kind');
  IF v_r <> 'sites_validation_failed' THEN RAISE EXCEPTION 'unknown kind no longer rejected (%)', v_r; END IF;

  -- A site that has published before is not gated at all.
  RESET ROLE;
  SELECT publication.id INTO v_pub FROM public.brand_site_publications publication
    WHERE publication.site_id = v_site ORDER BY publication.requested_at LIMIT 1;
  UPDATE public.brand_sites SET last_successful_publication_id = v_pub WHERE id = v_site;
  SET LOCAL ROLE authenticated;
  v_r := pg_temp.t4574_try(v_site, 'publish', 'adv-republish-stale');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'a non-first publish became readiness-gated (%)', v_r; END IF;
  RESET ROLE;

  -- ── cron.schedule is idempotent by name ────────────────────────────────
  PERFORM cron.schedule('issue_4574_sites_recovery_watch', '4-59/15 * * * *',
    (SELECT command FROM cron.job WHERE jobname = 'issue_4574_sites_recovery_watch'));
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'issue_4574_sites_recovery_watch') <> 1 THEN
    RAISE EXCEPTION 're-scheduling created a duplicate job';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE command LIKE '%"mode":"sites_recovery"%') <> 1 THEN
    RAISE EXCEPTION 'more than one job posts sites_recovery';
  END IF;

  RAISE NOTICE 'ISSUE_4574_TESTER_ADVERSARIAL_OK';
END;
$t4574adv$;

DO $t4574claim$
DECLARE
  v_x timestamptz := '2026-11-26T10:00:00Z';
  v_c jsonb;
  v_s public.brand_site_recovery_watch_state;
  v_denied boolean;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz)',
    'public.brand_site_recovery_watch_release(text, timestamptz, timestamptz, jsonb)'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
      OR has_function_privilege('public', v_fn, 'EXECUTE') OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not service_role only', v_fn;
    END IF;
    IF NOT (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp'] FROM pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION '% lost SECURITY DEFINER or its search_path', v_fn;
    END IF;
  END LOOP;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.brand_site_recovery_watch_claim('unproven', NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  RESET ROLE;
  IF NOT v_denied THEN RAISE EXCEPTION 'authenticated could claim (suppress) a recovery email'; END IF;

  -- release misuse
  DELETE FROM public.brand_site_recovery_watch_state;
  v_c := public.brand_site_recovery_watch_claim('warn', v_x, NULL);
  IF (v_c->>'claimed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'first warn not claimed: %', v_c; END IF;
  v_c := public.brand_site_recovery_watch_claim('critical', v_x, NULL);
  IF (v_c->>'claimed')::boolean IS NOT TRUE OR v_c->'prior'->>'last_sent_level' IS DISTINCT FROM 'warn' THEN
    RAISE EXCEPTION 'critical not claimed or prior wrong: %', v_c; END IF;
  PERFORM public.brand_site_recovery_watch_release('warn', v_x, NULL, '{}'::jsonb);
  PERFORM public.brand_site_recovery_watch_release('critical', v_x + interval '1 day', NULL, '{}'::jsonb);
  SELECT * INTO v_s FROM public.brand_site_recovery_watch_state;
  IF v_s.last_sent_level IS DISTINCT FROM 'critical' OR v_s.incident_closes_at IS DISTINCT FROM v_x THEN
    RAISE EXCEPTION 'a stale or foreign release re-opened a delivered claim (% %)', v_s.last_sent_level, v_s.incident_closes_at;
  END IF;
  -- the real release restores exactly the claim's prior
  PERFORM public.brand_site_recovery_watch_release('critical', v_x, NULL, v_c->'prior');
  SELECT * INTO v_s FROM public.brand_site_recovery_watch_state;
  IF v_s.last_sent_level IS DISTINCT FROM 'warn' OR v_s.incident_closes_at IS DISTINCT FROM v_x
    OR v_s.last_sent_at IS DISTINCT FROM (v_c->'prior'->>'last_sent_at')::timestamptz THEN
    RAISE EXCEPTION 'release did not restore the prior exactly';
  END IF;
  IF (public.brand_site_recovery_watch_claim('warn', v_x, NULL)->>'claimed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'warn re-claimed for the same incident after the critical release';
  END IF;
  -- heartbeat release for another completion changes nothing
  PERFORM public.brand_site_recovery_watch_claim('heartbeat', NULL, '2026-11-25T10:00:00Z');
  PERFORM public.brand_site_recovery_watch_release('heartbeat', NULL, '2026-11-24T10:00:00Z', '{"heartbeat_for":null}'::jsonb);
  IF (SELECT heartbeat_for FROM public.brand_site_recovery_watch_state) IS DISTINCT FROM '2026-11-25T10:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'a heartbeat release for another completion cleared the claim';
  END IF;
  -- unproven 2 h window, exact
  UPDATE public.brand_site_recovery_watch_state SET unproven_sent_at = clock_timestamp() - interval '2 hours' + interval '1 second';
  IF (public.brand_site_recovery_watch_claim('unproven', NULL, NULL)->>'claimed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'unproven claimed 1 s inside the 2 h window';
  END IF;
  UPDATE public.brand_site_recovery_watch_state SET unproven_sent_at = clock_timestamp() - interval '2 hours' - interval '1 second';
  IF (public.brand_site_recovery_watch_claim('unproven', NULL, NULL)->>'claimed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'unproven not claimed 1 s after the 2 h window';
  END IF;
  RAISE NOTICE 'ISSUE_4574_TESTER_ADVERSARIAL_CLAIM_OK';
END;
$t4574claim$;

ROLLBACK;
