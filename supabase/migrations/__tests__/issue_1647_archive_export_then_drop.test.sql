-- Issue #1647 — contract for export-then-drop of the expired archive tables.
--
-- NON-VACUITY: CI runs this against a database with every migration applied
-- EXCEPT 20270222001649, where the manifest table and both RPCs are absent, so
-- section 1 raises.
--
-- The whole value of this migration is a REFUSAL, so most of the file asserts
-- that the drop refuses: with no export on record, with a stale export, and with
-- a retention window that has not elapsed. A guard that is never proven to fire
-- is indistinguishable from no guard.

\set ON_ERROR_STOP on

-- ── 1. THE PIECES EXIST, AND A DROP-TABLE RPC IS NOT PUBLIC ─────────────────
DO $$
DECLARE
  v_fn text;
  v_fns text[] := ARRAY[
    'public.issue_1647_record_archive_export(text,bigint,bigint,text,text)',
    'public.issue_1647_drop_expired_archives(boolean)'
  ];
BEGIN
  IF to_regclass('public.issue_1647_archive_export_manifest') IS NULL THEN
    RAISE EXCEPTION 'the export manifest table does not exist';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.issue_1647_archive_export_manifest'::regclass) THEN
    RAISE EXCEPTION 'the export manifest has RLS disabled';
  END IF;
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '% does not exist', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon/authenticated', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %', v_fn;
    END IF;
  END LOOP;
END $$;

-- ── 2. WITHOUT AN EXPORT, THE DROP REFUSES ──────────────────────────────────
DO $$
DECLARE v_refused boolean := false;
BEGIN
  DELETE FROM public.issue_1647_archive_export_manifest;
  DELETE FROM public._archive_orch_0700_doomed_columns;
  INSERT INTO public._archive_orch_0700_doomed_columns (id, archived_at, retention_drop_date)
  VALUES (gen_random_uuid(), now() - interval '95 days', current_date - 65);

  BEGIN
    PERFORM public.issue_1647_drop_expired_archives(true);
  EXCEPTION WHEN raise_exception THEN
    v_refused := true;
    IF SQLERRM NOT LIKE '%no export on record%' THEN
      RAISE EXCEPTION 'refused for the wrong reason: %', SQLERRM;
    END IF;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION
      'the drop proceeded with NO export on record — export-then-drop is not enforced';
  END IF;
END $$;

-- ── 3. AN EXPORT THAT DOES NOT MATCH THE TABLE IS REJECTED ──────────────────
DO $$
DECLARE
  v_rejected boolean;
  v_live bigint;
BEGIN
  SELECT count(*) INTO v_live FROM public._archive_orch_0700_doomed_columns;

  v_rejected := false;
  BEGIN
    PERFORM public.issue_1647_record_archive_export(
      '_archive_orch_0700_doomed_columns', v_live + 7, 4096,
      repeat('a', 64), '/tmp/issue-1647/doomed.ndjson');
  EXCEPTION WHEN raise_exception THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'an export claiming the wrong row count was accepted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.issue_1647_record_archive_export(
      '_archive_orch_0700_doomed_columns', v_live, 4096,
      'not-a-sha', '/tmp/issue-1647/doomed.ndjson');
  EXCEPTION WHEN raise_exception THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'an export with a malformed sha256 was accepted';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.issue_1647_record_archive_export(
      '_archive_orch_0700_doomed_columns', v_live, 0,
      repeat('b', 64), '/tmp/issue-1647/doomed.ndjson');
  EXCEPTION WHEN raise_exception THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'a zero-byte export file was accepted as an export';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.issue_1647_record_archive_export(
      'orders', 0, 4096, repeat('c', 64), '/tmp/x');
  EXCEPTION WHEN raise_exception THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'the manifest accepted a table outside the sanctioned archive set';
  END IF;
END $$;

-- ── 4. A RETENTION WINDOW THAT HAS NOT ELAPSED BLOCKS THE DROP ──────────────
DO $$
DECLARE
  v_refused boolean := false;
  v_t text;
  v_n bigint;
BEGIN
  UPDATE public._archive_orch_0700_doomed_columns SET retention_drop_date = current_date + 30;

  FOREACH v_t IN ARRAY ARRAY['_archive_card_pool','_archive_card_pool_stops','_archive_orch_0700_doomed_columns'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
    PERFORM public.issue_1647_record_archive_export(
      v_t, v_n, 4096, repeat('d', 64), '/tmp/issue-1647/' || v_t || '.ndjson');
  END LOOP;

  BEGIN
    PERFORM public.issue_1647_drop_expired_archives(true);
  EXCEPTION WHEN raise_exception THEN
    v_refused := true;
    IF SQLERRM NOT LIKE '%retention window has NOT elapsed%' THEN
      RAISE EXCEPTION 'refused for the wrong reason: %', SQLERRM;
    END IF;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'the drop proceeded while the table''s own retention_drop_date was in the future';
  END IF;
END $$;

-- ── 5. DRY RUN REPORTS BUT DOES NOT DROP; THE REAL RUN DROPS ────────────────
DO $$
DECLARE
  v_res jsonb;
  v_t   text;
BEGIN
  UPDATE public._archive_orch_0700_doomed_columns SET retention_drop_date = current_date - 65;

  v_res := public.issue_1647_drop_expired_archives(true);
  IF (v_res ->> 'dry_run')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'the dry run did not report itself as one: %', v_res;
  END IF;
  IF NOT (v_res -> 'tables') @> '[{"action":"would_drop"}]'::jsonb THEN
    RAISE EXCEPTION 'the dry run reported no would_drop entries: %', v_res;
  END IF;
  FOREACH v_t IN ARRAY ARRAY['_archive_card_pool','_archive_card_pool_stops','_archive_orch_0700_doomed_columns'] LOOP
    IF to_regclass('public.' || quote_ident(v_t)) IS NULL THEN
      RAISE EXCEPTION 'the DRY RUN dropped %', v_t;
    END IF;
  END LOOP;

  v_res := public.issue_1647_drop_expired_archives(false);
  IF (v_res ->> 'dry_run')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'the real run reported itself as a dry run: %', v_res;
  END IF;
  FOREACH v_t IN ARRAY ARRAY['_archive_card_pool','_archive_card_pool_stops','_archive_orch_0700_doomed_columns'] LOOP
    IF to_regclass('public.' || quote_ident(v_t)) IS NOT NULL THEN
      RAISE EXCEPTION '% survived the real drop', v_t;
    END IF;
  END LOOP;

  -- Re-running must be a no-op, not an error: the RPC has to be safe to retry
  -- after a lock_timeout abort halfway through the list.
  v_res := public.issue_1647_drop_expired_archives(false);
  IF NOT (v_res -> 'tables') @> '[{"action":"already_absent"}]'::jsonb THEN
    RAISE EXCEPTION 're-running the drop was not idempotent: %', v_res;
  END IF;
END $$;

SELECT 'issue #1647 archive export-then-drop contract: PASS' AS result;
