-- MINGLA-INVARIANT: I-4574-SITES-FIRST-PUBLISH-BACKUP-BUDGET-SQL | issue #4574 | A new site's first publish accepts a database backup up to public.brand_site_database_backup_budget() (48 h) old and no older, and the recovery watch snapshot measures closing time with the same helper.
-- #4574 Sites first-publish backup budget and recovery watch (pg17, BEGIN ... ROLLBACK).
-- Runs on a full migration replay (profile psql-pg17-post-replay), so
-- 20281128004574_issue_4574_sites_backup_budget_and_alerts.sql is applied.
--   * the helper returns 48 hours; the manifest helper still returns 26 hours;
--   * the gate accepts a 30 h-old provider backup (refused before #4574) and
--     refuses a 49 h-old one; a 27 h-old manifest still blocks;
--   * the gate's live body reads both helpers and holds no literal budget;
--   * the snapshot's closes_at and gate_budget_h come from the same helpers;
--   * the drift guard's hash no longer matches the live gate (so re-applying
--     the migration over a changed gate aborts);
--   * the record RPC round-trips and dedups by what was delivered;
--   * anon and authenticated cannot run the snapshot, record or helper, and
--     the state table has RLS on with no policies;
--   * the 15-minute cron job posts {"mode":"sites_recovery"} only while the
--     state row exists.
-- FAILS-ON-REVERT: with the gate back on `interval '26 hours'` the 30 h case
-- raises 'a 30 h-old backup blocked first publish'.

\set ON_ERROR_STOP on
\ir issue_2830_complete_brand_setup.fixture.sql
BEGIN;

DO $t4574$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_site uuid;
  v_result jsonb;
  v_failed boolean;
  v_body text;
  v_snap jsonb;
  v_state jsonb;
BEGIN
  -- ── helpers ────────────────────────────────────────────────────────────
  IF public.brand_site_database_backup_budget() <> interval '48 hours' THEN
    RAISE EXCEPTION 'database backup budget is %, expected 48 hours', public.brand_site_database_backup_budget();
  END IF;
  IF public.brand_site_object_manifest_budget() <> interval '26 hours' THEN
    RAISE EXCEPTION 'manifest budget changed to %', public.brand_site_object_manifest_budget();
  END IF;

  -- ── the live gate body reads the helpers ───────────────────────────────
  -- #4572 item 15 moved the recovery condition into its one owner,
  -- brand_site_first_publish_ready(); the gate calls it. The budgets are
  -- read there now (and the gate holds no literal budget either).
  v_body := pg_get_functiondef('public.brand_site_first_publish_ready()'::regprocedure)
    || pg_get_functiondef('public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)'::regprocedure);
  IF position('database_backup_verified_at > clock_timestamp() - public.brand_site_database_backup_budget()' IN v_body) = 0
    OR position('object_manifest_verified_at > clock_timestamp() - public.brand_site_object_manifest_budget()' IN v_body) = 0 THEN
    RAISE EXCEPTION 'the live gate does not read the budget helpers';
  END IF;
  IF v_body ~ '(database_backup|object_manifest)_verified_at > clock_timestamp\(\) - interval' THEN
    RAISE EXCEPTION 'the live gate still holds a literal backup budget';
  END IF;
  -- Drift guard: the hash the migration checks is the #2829 W1 body, so it can
  -- never match the patched gate. Re-applying over any other body aborts.
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid = 'public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)'::regprocedure)
     = '06956f65c9d27612919a982340f16681' THEN
    RAISE EXCEPTION 'drift guard hash matches the patched gate';
  END IF;

  -- ── grants ─────────────────────────────────────────────────────────────
  IF has_function_privilege('anon', 'public.brand_site_recovery_watch_snapshot()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_recovery_watch_snapshot()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_recovery_watch_record(text, timestamptz, text, timestamptz, boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_recovery_watch_record(text, timestamptz, text, timestamptz, boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_database_backup_budget()', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.brand_site_recovery_watch_snapshot()', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.brand_site_recovery_watch_record(text, timestamptz, text, timestamptz, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'recovery watch grants are not service_role only';
  END IF;
  IF has_table_privilege('anon', 'public.brand_site_recovery_watch_state', 'SELECT')
    OR has_table_privilege('authenticated', 'public.brand_site_recovery_watch_state', 'SELECT')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brand_site_recovery_watch_state'::regclass)
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'brand_site_recovery_watch_state') THEN
    RAISE EXCEPTION 'recovery watch state is readable outside service_role';
  END IF;

  -- ── the cron job ───────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_4574_sites_recovery_watch'
      AND schedule = '4-59/15 * * * *'
      AND command LIKE '%/functions/v1/api-health-probe%'
      AND command LIKE '%{"mode":"sites_recovery"}%'
      AND command LIKE '%WHERE EXISTS (SELECT 1 FROM public.brand_site_recovery_watch_state)%'
  ) THEN
    RAISE EXCEPTION 'the sites recovery cron job is missing or wrong';
  END IF;

  -- ── fixture: one brand, its owner, one provisioned site ────────────────
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'owner-4574@example.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug) VALUES (v_brand, v_owner, 'Budget 4574', 'budget-4574');
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

  -- ── the gate: 30 h accepted, 49 h refused, stale manifest still blocks ─
  UPDATE public.brand_site_service_config SET
    backup_retention_days = 14, backup_entitlement_verified_at = clock_timestamp(),
    database_backup_verified_at = clock_timestamp() - interval '30 hours',
    object_manifest_verified_at = clock_timestamp() - interval '1 hour',
    restore_drill_verified_at = clock_timestamp() - interval '1 day',
    restore_drill_evidence_digest = repeat('7', 64);
  BEGIN
    PERFORM public.brand_site_authorize_operation(v_site, gen_random_uuid(),
      'publish', repeat('3', 64), 'rev-30h', repeat('4', 64));
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'a 30 h-old backup blocked first publish (%)', SQLERRM;
  END;

  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - interval '49 hours';
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_authorize_operation(v_site, gen_random_uuid(),
      'publish', repeat('5', 64), 'rev-49h', repeat('6', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a 49 h-old backup allowed first publish'; END IF;

  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = clock_timestamp() - interval '1 hour',
    object_manifest_verified_at = clock_timestamp() - interval '27 hours';
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_authorize_operation(v_site, gen_random_uuid(),
      'publish', repeat('8', 64), 'rev-manifest', repeat('9', 64));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_readiness_blocked'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a 27 h-old manifest allowed first publish'; END IF;

  -- ── the snapshot measures with the same helpers ────────────────────────
  UPDATE public.brand_site_service_config SET
    database_backup_verified_at = '2026-11-24T10:00:00Z',
    object_manifest_verified_at = '2026-11-25T08:00:00Z';
  v_snap := public.brand_site_recovery_watch_snapshot();
  IF (v_snap->>'config_present')::boolean IS NOT TRUE
    OR (v_snap->>'gate_budget_h')::numeric <> extract(epoch FROM public.brand_site_database_backup_budget()) / 3600
    OR (v_snap->>'gate_budget_h')::numeric <> 48
    OR (v_snap->>'manifest_budget_h')::numeric <> 26
    OR (v_snap->>'closes_at')::timestamptz <> '2026-11-26T10:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'snapshot does not measure with the gate budget: %', v_snap;
  END IF;
  UPDATE public.brand_site_service_config SET object_manifest_verified_at = '2026-11-24T20:00:00Z';
  IF (public.brand_site_recovery_watch_snapshot()->>'closes_at')::timestamptz <> '2026-11-25T22:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'snapshot ignores the manifest budget';
  END IF;

  -- ── the record RPC ─────────────────────────────────────────────────────
  DELETE FROM public.brand_site_recovery_watch_state;
  v_state := public.brand_site_recovery_watch_record('watch', NULL, NULL, NULL, false);
  IF v_state->>'level' <> 'watch' OR v_state->>'last_sent_level' IS NOT NULL OR v_state ? 'id' THEN
    RAISE EXCEPTION 'record did not create the row: %', v_state;
  END IF;
  v_state := public.brand_site_recovery_watch_record('warn', '2026-11-26T10:00:00Z', 'warn', NULL, false);
  IF v_state->>'last_sent_level' <> 'warn'
    OR (v_state->>'incident_closes_at')::timestamptz <> '2026-11-26T10:00:00Z'::timestamptz
    OR v_state->>'last_sent_at' IS NULL THEN
    RAISE EXCEPTION 'record did not keep the delivered alert: %', v_state;
  END IF;
  -- A later check that sent nothing keeps the incident and the sent level.
  v_state := public.brand_site_recovery_watch_record('warn', NULL, NULL, '2026-11-25T10:00:00Z', true);
  IF v_state->>'last_sent_level' <> 'warn'
    OR (v_state->>'incident_closes_at')::timestamptz <> '2026-11-26T10:00:00Z'::timestamptz
    OR (v_state->>'heartbeat_for')::timestamptz <> '2026-11-25T10:00:00Z'::timestamptz
    OR v_state->>'unproven_sent_at' IS NULL THEN
    RAISE EXCEPTION 'record lost the dedup state: %', v_state;
  END IF;
  IF (SELECT count(*) FROM public.brand_site_recovery_watch_state) <> 1 THEN
    RAISE EXCEPTION 'the watch state is not one row';
  END IF;
  IF NOT ((public.brand_site_recovery_watch_snapshot()->'state'->>'last_sent_level') = 'warn') THEN
    RAISE EXCEPTION 'snapshot does not return the stored state';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_recovery_watch_record('fine', NULL, NULL, NULL, false);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'record accepted an unknown level'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_recovery_watch_record('ok', NULL, 'heartbeat', NULL, false);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'record accepted an unknown sent level'; END IF;

  -- With no service row the snapshot says so (the watch reports unproven).
  DELETE FROM public.brand_site_service_config;
  IF (public.brand_site_recovery_watch_snapshot()->>'config_present')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'snapshot without a service row claimed config_present';
  END IF;

  RAISE NOTICE 'ISSUE_4574_SITES_BACKUP_BUDGET_OK';
END;
$t4574$;

-- #4574 rework: claim before send (tester P1-1, P2-1).
DO $t4574_claim$
DECLARE
  v_c jsonb;
  v_failed boolean;
  v_closes timestamptz := '2026-11-26T10:00:00Z';
BEGIN
  IF has_function_privilege('anon', 'public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_recovery_watch_release(text, timestamptz, timestamptz, jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.brand_site_recovery_watch_release(text, timestamptz, timestamptz, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'claim/release grants are not service_role only';
  END IF;
  IF position('FOR UPDATE' IN pg_get_functiondef('public.brand_site_recovery_watch_claim(text, timestamptz, timestamptz)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the claim does not lock the state row';
  END IF;
  DELETE FROM public.brand_site_recovery_watch_state;

  -- The first claim wins; the same claim again (a second, overlapping run) is refused.
  IF NOT (public.brand_site_recovery_watch_claim('warn', v_closes, NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'first warn claim refused';
  END IF;
  IF (public.brand_site_recovery_watch_claim('warn', v_closes, NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'a second warn claim for the same incident was allowed (double send)';
  END IF;
  -- Escalation claims; de-escalation does not; a new incident re-arms.
  IF NOT (public.brand_site_recovery_watch_claim('critical', v_closes, NULL)->>'claimed')::boolean
    OR (public.brand_site_recovery_watch_claim('warn', v_closes, NULL)->>'claimed')::boolean
    OR NOT (public.brand_site_recovery_watch_claim('warn', v_closes + interval '1 day', NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'level claims do not follow once-per-incident with escalation';
  END IF;
  -- Recovery only after an alert, once.
  IF NOT (public.brand_site_recovery_watch_claim('recovered', v_closes + interval '2 days', NULL)->>'claimed')::boolean
    OR (public.brand_site_recovery_watch_claim('recovered', v_closes + interval '2 days', NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'recovery claim not exactly once after an alert';
  END IF;
  -- Heartbeat once per completion.
  IF NOT (public.brand_site_recovery_watch_claim('heartbeat', NULL, '2026-11-24T10:00:00Z')->>'claimed')::boolean
    OR (public.brand_site_recovery_watch_claim('heartbeat', NULL, '2026-11-24T10:00:00Z')->>'claimed')::boolean
    OR NOT (public.brand_site_recovery_watch_claim('heartbeat', NULL, '2026-11-25T10:00:00Z')->>'claimed')::boolean THEN
    RAISE EXCEPTION 'heartbeat claim not once per completion';
  END IF;
  -- Unproven: once, then refused until 2 h have passed.
  IF NOT (public.brand_site_recovery_watch_claim('unproven', NULL, NULL)->>'claimed')::boolean
    OR (public.brand_site_recovery_watch_claim('unproven', NULL, NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'unproven claimed twice inside 2 h';
  END IF;
  UPDATE public.brand_site_recovery_watch_state SET unproven_sent_at = clock_timestamp() - interval '1 hour 59 minutes';
  IF (public.brand_site_recovery_watch_claim('unproven', NULL, NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'unproven claimed after 1 h 59 min';
  END IF;
  UPDATE public.brand_site_recovery_watch_state SET unproven_sent_at = clock_timestamp() - interval '2 hours 1 second';
  IF NOT (public.brand_site_recovery_watch_claim('unproven', NULL, NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'unproven not claimable after 2 h';
  END IF;

  -- Release restores exactly what the undelivered claim changed.
  DELETE FROM public.brand_site_recovery_watch_state;
  v_c := public.brand_site_recovery_watch_claim('expired', v_closes, NULL);
  PERFORM public.brand_site_recovery_watch_release('expired', v_closes, NULL, v_c->'prior');
  IF (SELECT last_sent_level FROM public.brand_site_recovery_watch_state) IS NOT NULL
    OR NOT (public.brand_site_recovery_watch_claim('expired', v_closes, NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'release did not let the next check retry';
  END IF;
  v_c := public.brand_site_recovery_watch_claim('unproven', NULL, NULL);
  PERFORM public.brand_site_recovery_watch_release('unproven', NULL, NULL, v_c->'prior');
  IF (SELECT unproven_sent_at FROM public.brand_site_recovery_watch_state) IS NOT NULL THEN
    RAISE EXCEPTION 'unproven release did not restore the prior time';
  END IF;

  v_failed := false;
  BEGIN PERFORM public.brand_site_recovery_watch_claim('warn', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a level claim without a closing time was accepted'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_recovery_watch_claim('page', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an unknown claim kind was accepted'; END IF;

  -- Retest P3-A: a release that carries a stale prior (not the value this
  -- claim wrote) never re-opens a delivered unproven claim.
  DELETE FROM public.brand_site_recovery_watch_state;
  v_c := public.brand_site_recovery_watch_claim('unproven', NULL, NULL);
  IF v_c->'prior'->>'claim_written_at' IS NULL THEN
    RAISE EXCEPTION 'an unproven claim did not return the value it wrote';
  END IF;
  PERFORM public.brand_site_recovery_watch_release('unproven', NULL, NULL, '{"unproven_sent_at":null}'::jsonb);
  PERFORM public.brand_site_recovery_watch_release('unproven', NULL, NULL,
    jsonb_build_object('unproven_sent_at', NULL, 'claim_written_at', clock_timestamp() - interval '1 hour'));
  IF (SELECT unproven_sent_at FROM public.brand_site_recovery_watch_state) IS NULL
    OR (public.brand_site_recovery_watch_claim('unproven', NULL, NULL)->>'claimed')::boolean THEN
    RAISE EXCEPTION 'a stale unproven release re-opened a delivered claim';
  END IF;

  -- Retest P3-B: a sent warn with no stored closing time (written by no
  -- shipped code) must still let a warn be claimed, never answer NULL.
  UPDATE public.brand_site_recovery_watch_state SET last_sent_level = 'warn', incident_closes_at = NULL;
  v_c := public.brand_site_recovery_watch_claim('warn', v_closes, NULL);
  IF (v_c->>'claimed') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'a warn claim over a NULL incident answered % (warn skipped)', COALESCE(v_c->>'claimed', 'NULL');
  END IF;

  RAISE NOTICE 'ISSUE_4574_SITES_RECOVERY_CLAIM_OK';
END;
$t4574_claim$;

ROLLBACK;
