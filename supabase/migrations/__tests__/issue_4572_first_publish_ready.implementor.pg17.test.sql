-- MINGLA-INVARIANT: I-4572-SITES-FIRST-PUBLISH-READY-ONE-OWNER | issue #4572 | public.brand_site_first_publish_ready() is the only definition of the first-publish recovery condition: brand_site_authorize_operation refuses a never-published site's publish exactly when it is false, and brand_site_publishing_paused() (what the Host reads) says paused from the same function.
-- #4572 item 15 (pg17, BEGIN ... ROLLBACK, full replay).
--   * happy path: fresh evidence -> publish authorized, paused = false;
--   * adversarial: database evidence one second past its budget -> paused =
--     true and the gate raises sites_readiness_blocked; a site that already
--     published still publishes and is never paused;
--   * the gate body calls the helper and keeps no inline evidence condition;
--   * grants: the helper is service-role only; paused is authenticated, and
--     an outsider gets sites_forbidden.
-- FAILS-ON-REVERT: re-applying 20281128004574's gate leaves no call to
-- brand_site_first_publish_ready() in the body, and dropping
-- brand_site_publishing_paused() fails the paused assertions.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $t4572$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_site uuid;
  v_result jsonb;
  v_failed boolean;
  v_body text;
BEGIN
  v_body := pg_get_functiondef('public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)'::regprocedure);
  IF position('IF NOT public.brand_site_first_publish_ready() THEN' IN v_body) = 0 THEN
    RAISE EXCEPTION 'the gate does not call brand_site_first_publish_ready()';
  END IF;
  IF position('database_backup_verified_at' IN v_body) > 0 OR position('restore_drill' IN v_body) > 0 THEN
    RAISE EXCEPTION 'the gate still holds its own copy of the recovery condition';
  END IF;
  IF position('public.brand_site_database_backup_budget()' IN pg_get_functiondef('public.brand_site_first_publish_ready()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the helper does not read the #4574 budget';
  END IF;
  IF has_function_privilege('authenticated', 'public.brand_site_first_publish_ready()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_first_publish_ready()', 'EXECUTE') THEN
    RAISE EXCEPTION 'clients can run brand_site_first_publish_ready()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.brand_site_publishing_paused(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_publishing_paused(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'brand_site_publishing_paused grants are wrong';
  END IF;

  INSERT INTO auth.users(id, email) VALUES (v_owner, 'owner-4572@example.invalid'), (v_outsider, 'outsider-4572@example.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now()), (v_outsider, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES (v_brand, v_owner, 'Ready 4572', 'ready-4572');
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_owner, now(), v_owner, now());
  PERFORM pg_temp.issue_2830_complete_brand_setup(v_brand, v_owner);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_provision(v_brand, gen_random_uuid(), repeat('1', 64));
  v_site := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site AND kind = 'provision'), gen_random_uuid()::text);

  -- ── happy path: fresh evidence ─────────────────────────────────────────
  UPDATE public.brand_site_service_config SET
    backup_retention_days = 14, backup_entitlement_verified_at = clock_timestamp(),
    database_backup_verified_at = clock_timestamp() - interval '1 hour',
    object_manifest_verified_at = clock_timestamp() - interval '1 hour',
    restore_drill_verified_at = clock_timestamp() - interval '1 day',
    restore_drill_evidence_digest = repeat('7', 64);
  IF public.brand_site_first_publish_ready() IS NOT TRUE THEN RAISE EXCEPTION 'fresh evidence reads as not ready'; END IF;
  IF public.brand_site_publishing_paused(v_site) IS NOT FALSE THEN RAISE EXCEPTION 'fresh evidence reads as paused'; END IF;

  -- ── adversarial: the database backup one second past its budget ───────
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - public.brand_site_database_backup_budget() - interval '1 second';
  IF public.brand_site_first_publish_ready() IS NOT FALSE THEN RAISE EXCEPTION 'stale evidence reads as ready'; END IF;
  IF public.brand_site_publishing_paused(v_site) IS NOT TRUE THEN RAISE EXCEPTION 'stale evidence does not read as paused'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_authorize_operation(v_site, gen_random_uuid(),
      'publish', repeat('5', 64), 'rev-stale', repeat('6', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale evidence allowed a first publish'; END IF;

  -- ── back to fresh: the gate authorizes the first publish ───────────────
  UPDATE public.brand_site_service_config SET database_backup_verified_at = clock_timestamp() - interval '1 hour';
  BEGIN
    v_result := public.brand_site_authorize_operation(v_site, gen_random_uuid(),
      'publish', repeat('3', 64), 'rev-fresh', repeat('4', 64));
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fresh evidence blocked first publish (%)', SQLERRM;
  END;

  -- ── a site that has published before is never paused ───────────────────
  UPDATE public.brand_sites SET last_successful_publication_id = (v_result->>'publication_id')::uuid WHERE id = v_site;
  UPDATE public.brand_site_service_config SET database_backup_verified_at = clock_timestamp() - interval '400 hours';
  IF public.brand_site_publishing_paused(v_site) IS NOT FALSE THEN RAISE EXCEPTION 'a published site reads as paused'; END IF;
  BEGIN
    PERFORM public.brand_site_authorize_operation(v_site, gen_random_uuid(),
      'publish', repeat('a', 64), 'rev-again', repeat('b', 64));
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'a published site was refused for recovery evidence (%)', SQLERRM;
  END;

  -- ── an outsider cannot read the paused state ───────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_publishing_paused(v_site);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an outsider read the paused state'; END IF;

  RAISE NOTICE '#4572 first-publish ready: PASS';
END;
$t4572$;

ROLLBACK;
