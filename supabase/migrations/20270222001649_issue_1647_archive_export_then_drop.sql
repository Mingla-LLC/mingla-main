-- Issue #1647 / #1644 Tier-A6+A7 — export-then-drop the two expired archive
-- tables (94,797,824 bytes = 90.4 MiB, measured on production 2026-08-06).
--
-- WHAT IS BEING DROPPED, AND WHY IT IS SAFE — verified independently, not taken
-- from the sweep:
--
--   _archive_orch_0700_doomed_columns  35,291,136 B  69,599 rows
--     Every single row carries retention_drop_date = 2026-06-02 (one distinct
--     value across all 69,599), archived_at 2026-05-03. The table declares its
--     own expiry and that date passed 65 days ago. Zero scans of any kind, zero
--     writes in the 53-day stats window, zero foreign keys in either direction,
--     zero references anywhere in the monorepo outside migrations.
--
--   _archive_card_pool                 58,523,648 B   8,861 rows
--   _archive_card_pool_stops              983,040 B   1,944 rows
--     Zero writes, 6 seq scans and 1 index scan in 53 days. The only non-migration
--     reference in the whole monorepo is
--     scripts/deferred-migrations/20260502000001_orch_0640_final_archive_drop.sql
--     — a drop script already written for exactly these tables, whose 7-day
--     post-cutover soak after migrations 20260425000001..14 elapsed 102 days ago.
--
-- THE LOCK HAZARD NOBODY WOULD SEE COMING
-- ---------------------------------------
-- `_archive_card_pool` and `_archive_card_pool_stops` both carry FOREIGN KEYS
-- REFERENCING `place_pool`. Dropping a referencing table drops its constraints,
-- and dropping a constraint removes the referential-integrity triggers from BOTH
-- sides — so `DROP TABLE public._archive_card_pool` needs an ACCESS EXCLUSIVE
-- LOCK ON place_pool. A queued ACCESS EXCLUSIVE request also blocks every new
-- reader behind it, so run at the wrong moment this 90 MB of housekeeping stalls
-- the live collage re-encode's UPDATEs of place_pool.photo_collage_url AND every
-- app read of the place pool.
-- That is why the drop is an RPC with a 5-second `lock_timeout` rather than a
-- migration statement: it aborts loudly in five seconds instead of queueing.
-- `_archive_orch_0700_doomed_columns` has no such FK and is unaffected.
--
-- (Aside worth recording, because #1647's root cause is the mirror image: a
-- function-level `SET lock_timeout` DOES take effect, because the value is read
-- when a lock is requested. A function-level `SET statement_timeout` does NOT,
-- because the timer is armed when the top-level statement begins and is never
-- re-armed — which is exactly why cron_refresh_admin_place_pool_mv's `SET
-- statement_timeout TO '15min'` was inert and every failure landed on 120.00 s.)
--
-- EXPORT-THEN-DROP IS ENFORCED, NOT REQUESTED
-- -------------------------------------------
-- This migration creates NO DROP. It creates a manifest and a drop RPC that
-- REFUSES to run until a verified export of every table is on record with a row
-- count matching the live table. A comment saying "export first" is a suggestion;
-- a RAISE is a contract.
--
-- SEQUENCE the operator runs (see scripts/issue-1647/RECLAIM_RUNBOOK.sql):
--   1. apply this migration
--   2. deno run scripts/issue-1647/export-archive-tables.ts   (writes NDJSON + stamps the manifest)
--   3. SELECT public.issue_1647_drop_expired_archives(true);   -- dry run, reports what it would do
--   4. SELECT public.issue_1647_drop_expired_archives(false);  -- the drop, when the collage job is idle

CREATE TABLE IF NOT EXISTS public.issue_1647_archive_export_manifest (
  table_name  text PRIMARY KEY,
  row_count   bigint      NOT NULL,
  byte_count  bigint      NOT NULL,
  sha256      text        NOT NULL,
  destination text        NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_1647_archive_export_manifest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_1647_archive_export_manifest FROM PUBLIC;
REVOKE ALL ON TABLE public.issue_1647_archive_export_manifest FROM anon;
REVOKE ALL ON TABLE public.issue_1647_archive_export_manifest FROM authenticated;
GRANT SELECT ON TABLE public.issue_1647_archive_export_manifest TO service_role;

COMMENT ON TABLE public.issue_1647_archive_export_manifest IS
  'Issue #1647. Proof-of-export for the expired archive tables. '
  'issue_1647_drop_expired_archives() refuses to drop a table with no matching row here, '
  'so the export cannot be skipped by forgetting it.';

-- ── RECORD AN EXPORT ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_1647_record_archive_export(
  p_table       text,
  p_row_count   bigint,
  p_byte_count  bigint,
  p_sha256      text,
  p_destination text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_live bigint;
BEGIN
  IF p_table IS NULL OR p_table NOT IN (
    '_archive_card_pool', '_archive_card_pool_stops', '_archive_orch_0700_doomed_columns'
  ) THEN
    RAISE EXCEPTION 'issue #1647: % is not one of the sanctioned archive tables', p_table;
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'issue #1647: sha256 must be 64 lowercase hex characters, got %', p_sha256;
  END IF;
  IF p_destination IS NULL OR length(btrim(p_destination)) = 0 THEN
    RAISE EXCEPTION 'issue #1647: an export with no recorded destination is not an export';
  END IF;
  IF p_byte_count IS NULL OR p_byte_count <= 0 THEN
    RAISE EXCEPTION 'issue #1647: a zero-byte export file is not an export (table %)', p_table;
  END IF;

  EXECUTE format('SELECT count(*) FROM public.%I', p_table) INTO v_live;
  IF v_live <> p_row_count THEN
    RAISE EXCEPTION
      'issue #1647: export of % claims % rows but the table holds % — the export is incomplete or stale',
      p_table, p_row_count, v_live;
  END IF;

  INSERT INTO public.issue_1647_archive_export_manifest
    (table_name, row_count, byte_count, sha256, destination, exported_at)
  VALUES (p_table, p_row_count, p_byte_count, p_sha256, btrim(p_destination), now())
  ON CONFLICT (table_name) DO UPDATE
    SET row_count   = EXCLUDED.row_count,
        byte_count  = EXCLUDED.byte_count,
        sha256      = EXCLUDED.sha256,
        destination = EXCLUDED.destination,
        exported_at = EXCLUDED.exported_at;

  RETURN jsonb_build_object(
    'table', p_table, 'rows', p_row_count, 'bytes', p_byte_count, 'recorded_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1647_record_archive_export(text, bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1647_record_archive_export(text, bigint, bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1647_record_archive_export(text, bigint, bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1647_record_archive_export(text, bigint, bigint, text, text) TO service_role;

-- ── THE GUARDED DROP ────────────────────────────────────────────────────────
-- The function-level lock_timeout is load-bearing: see the LOCK HAZARD note.
CREATE OR REPLACE FUNCTION public.issue_1647_drop_expired_archives(
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
SET lock_timeout TO '5s'
AS $function$
DECLARE
  v_tables text[] := ARRAY[
    '_archive_card_pool_stops',            -- child first
    '_archive_card_pool',
    '_archive_orch_0700_doomed_columns'
  ];
  v_t          text;
  v_bytes      bigint := 0;
  v_this_bytes bigint;
  v_live       bigint;
  v_manifest   public.issue_1647_archive_export_manifest%ROWTYPE;
  v_expiry     date;
  v_report     jsonb := '[]'::jsonb;
  v_foreign    text;
BEGIN
  -- (a) The retention window, re-read from the DATA rather than from a comment.
  --     Guarded on existence so the RPC stays safe to re-run AFTER a successful
  --     drop: an operator re-running it (or checking status) must get an
  --     "already_absent" report, not `undefined_table`. A guard that only works
  --     once is a trap for whoever runs it second.
  IF to_regclass('public._archive_orch_0700_doomed_columns') IS NOT NULL THEN
    EXECUTE 'SELECT max(retention_drop_date) FROM public._archive_orch_0700_doomed_columns'
      INTO v_expiry;
    IF v_expiry IS NULL THEN
      RAISE EXCEPTION
        'issue #1647: _archive_orch_0700_doomed_columns declares no retention_drop_date — refusing to drop it';
    END IF;
    IF v_expiry >= current_date THEN
      RAISE EXCEPTION
        'issue #1647: retention window has NOT elapsed — retention_drop_date is %, today is %',
        v_expiry, current_date;
    END IF;
  END IF;

  FOREACH v_t IN ARRAY v_tables LOOP
    IF to_regclass('public.' || quote_ident(v_t)) IS NULL THEN
      v_report := v_report || jsonb_build_object('table', v_t, 'action', 'already_absent');
      CONTINUE;
    END IF;

    -- (b) Nothing OUTSIDE this set may depend on it. A live table pointing here
    --     would make the drop a data-integrity change, not housekeeping.
    SELECT string_agg(DISTINCT con.conrelid::regclass::text, ', ') INTO v_foreign
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = ('public.' || quote_ident(v_t))::regclass
      AND con.conrelid::regclass::text <> ('public.' || quote_ident(v_t))
      AND replace(con.conrelid::regclass::text, 'public.', '') <> ALL (v_tables);
    IF v_foreign IS NOT NULL THEN
      RAISE EXCEPTION
        'issue #1647: % is still referenced by %, which is NOT an expired archive — refusing to drop',
        v_t, v_foreign;
    END IF;

    -- (c) Export on record, and it must match the table as it stands right now.
    SELECT * INTO v_manifest
    FROM public.issue_1647_archive_export_manifest WHERE table_name = v_t;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'issue #1647: no export on record for % — run scripts/issue-1647/export-archive-tables.ts first. '
        'Export-then-drop is not optional.', v_t;
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_live;
    IF v_live <> v_manifest.row_count THEN
      RAISE EXCEPTION
        'issue #1647: % now holds % rows but the export recorded % — the export is stale',
        v_t, v_live, v_manifest.row_count;
    END IF;

    SELECT pg_total_relation_size(('public.' || quote_ident(v_t))::regclass) INTO v_this_bytes;
    v_bytes := v_bytes + v_this_bytes;
    v_report := v_report || jsonb_build_object(
      'table', v_t,
      'action', CASE WHEN p_dry_run THEN 'would_drop' ELSE 'dropped' END,
      'rows', v_live,
      'bytes', v_this_bytes,
      'exported_to', v_manifest.destination,
      'exported_at', v_manifest.exported_at
    );

    IF NOT p_dry_run THEN
      -- No CASCADE. If something unexpected depends on this table the drop must
      -- FAIL rather than quietly take that something with it.
      EXECUTE format('DROP TABLE public.%I', v_t);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'total_bytes', v_bytes,
    'total_pretty', pg_size_pretty(v_bytes),
    'retention_drop_date', v_expiry,
    'tables', v_report
  );
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION
      'issue #1647: could not take the locks within 5s. _archive_card_pool''s foreign keys to '
      'place_pool mean this drop needs ACCESS EXCLUSIVE on place_pool, and the collage re-encode '
      'is probably mid-flight. Aborted rather than queued — a queued ACCESS EXCLUSIVE blocks every '
      'new place_pool reader. Re-run when the re-encode is idle.';
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1647_drop_expired_archives(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1647_drop_expired_archives(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.issue_1647_drop_expired_archives(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1647_drop_expired_archives(boolean) TO service_role;

COMMENT ON FUNCTION public.issue_1647_drop_expired_archives(boolean) IS
  'Issue #1647 / #1644-A6+A7. Drops the three expired archive relations (90.4 MiB) ONLY after '
  'proving: the retention_drop_date the data carries has elapsed, no live table references them, '
  'and a row-count-matching export is on record. Dry run by default. Bounded lock_timeout because '
  '_archive_card_pool''s FKs to place_pool force an ACCESS EXCLUSIVE lock on place_pool.';

-- ── FAIL-LOUD CONTRACT ──────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF to_regclass('public.issue_1647_archive_export_manifest') IS NULL THEN
    RAISE EXCEPTION 'issue #1647: the export manifest table was not created';
  END IF;
  IF to_regprocedure('public.issue_1647_drop_expired_archives(boolean)') IS NULL
     OR to_regprocedure('public.issue_1647_record_archive_export(text,bigint,bigint,text,text)') IS NULL THEN
    RAISE EXCEPTION 'issue #1647: the archive export/drop RPCs were not created';
  END IF;
  IF has_function_privilege('anon', 'public.issue_1647_drop_expired_archives(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_1647_drop_expired_archives(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue #1647: a DROP TABLE RPC is executable by anon/authenticated';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.issue_1647_archive_export_manifest'::regclass) THEN
    RAISE EXCEPTION 'issue #1647: the export manifest has RLS disabled';
  END IF;
END
$verify$;
