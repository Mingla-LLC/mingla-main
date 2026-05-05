-- ORCH-0700 Phase 2.E + ORCH-0707 Appendix A — DROP COLUMN x6
--
-- Drops 6 columns from public.place_pool in a single ALTER TABLE:
--   1. seeding_category   (Phase 2.E — replaced by helper-derived category)
--   2. ai_categories      (Appendix A — old AI validator output, deprecated)
--   3. ai_reason          (Appendix A — AI validator metadata)
--   4. ai_primary_identity (Appendix A — AI validator metadata)
--   5. ai_confidence      (Appendix A — AI validator metadata)
--   6. ai_web_evidence    (Appendix A — AI validator metadata)
--
-- Two pre-check DO blocks fail-fast if Migrations 3 + 4 didn't complete:
--   Pre-check 1: matview must NOT reference any of the 6 doomed columns
--   Pre-check 2: NO function in public schema may reference any of the 6 columns
--
-- 30-day archive backup created BEFORE drop, preserving any rows with non-null
-- data in any of the 6 columns. Operator can DROP TABLE the archive after
-- 2026-06-02 if no rollback needed.
--
-- Reference:
--   ORCH-0700 spec §3.A.A6
--   ORCH-0707 spec §12 Appendix A.1

BEGIN;

-- ── Pre-check 1: matview must NOT reference any doomed column ──
DO $$
DECLARE
  v_offending TEXT[];
BEGIN
  v_offending := ARRAY(
    SELECT col FROM unnest(ARRAY['seeding_category','ai_categories','ai_reason','ai_primary_identity','ai_confidence','ai_web_evidence']) AS col
    WHERE EXISTS (
      SELECT 1 FROM pg_matviews
      WHERE matviewname = 'admin_place_pool_mv'
        AND definition ILIKE '%' || col || '%'
    )
  );
  IF array_length(v_offending, 1) > 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.E PRE-CHECK FAIL: admin_place_pool_mv still references doomed columns: % — Migration 4 must run first', v_offending;
  END IF;
END $$;

-- ── Pre-check 2: NO function in public schema may reference any doomed column ──
-- (Catches any RPC missed by Migration 3.)
DO $$
DECLARE
  v_offending_rpcs TEXT[];
BEGIN
  v_offending_rpcs := ARRAY(
    SELECT proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND (
        prosrc ILIKE '%seeding_category%'
        OR prosrc ILIKE '%ai_categories%'
        OR prosrc ILIKE '%ai_reason%'
        OR prosrc ILIKE '%ai_primary_identity%'
        OR prosrc ILIKE '%ai_confidence%'
        OR prosrc ILIKE '%ai_web_evidence%'
      )
  );
  IF array_length(v_offending_rpcs, 1) > 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.E PRE-CHECK FAIL: % function(s) still reference doomed columns: % — Migration 3 must run first', array_length(v_offending_rpcs, 1), v_offending_rpcs;
  END IF;
END $$;

-- ── Pre-step: 30-day archive backup of doomed-column data ──
-- Use a fixed table name (no dashes — Postgres identifiers reject hyphens
-- without quoting). _archive_orch_0700_doomed_columns is the canonical
-- backup; the date is encoded in a column for retention tracking.
CREATE TABLE IF NOT EXISTS public._archive_orch_0700_doomed_columns AS
SELECT
  id,
  seeding_category,
  ai_categories,
  ai_reason,
  ai_primary_identity,
  ai_confidence,
  ai_web_evidence,
  now() AS archived_at,
  '2026-06-02'::date AS retention_drop_date
FROM public.place_pool
WHERE seeding_category IS NOT NULL
   OR ai_categories IS NOT NULL
   OR ai_reason IS NOT NULL
   OR ai_primary_identity IS NOT NULL
   OR ai_confidence IS NOT NULL
   OR ai_web_evidence IS NOT NULL;

COMMENT ON TABLE public._archive_orch_0700_doomed_columns IS
  'ORCH-0700 + ORCH-0707 — backup of 6 columns dropped from place_pool 2026-05-03. '
  'Retention until 2026-06-02. After that date, operator runs: '
  'DROP TABLE public._archive_orch_0700_doomed_columns; '
  'See Mingla_Artifacts/specs/SPEC_ORCH-0700_*.md and SPEC_ORCH-0707_*.md.';

-- Index for any rollback queries
CREATE INDEX IF NOT EXISTS _archive_orch_0700_doomed_columns_id_idx
  ON public._archive_orch_0700_doomed_columns (id);

-- Verify backup non-empty (defensive — should never be 0 given live data per cycle-3 audit)
DO $$
DECLARE
  v_archive_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_archive_count FROM public._archive_orch_0700_doomed_columns;
  RAISE NOTICE 'ORCH-0700 Phase 2.E: archived % rows to _archive_orch_0700_doomed_columns (retention: 2026-06-02)', v_archive_count;
  IF v_archive_count = 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.E PRE-CHECK FAIL: archive backup table is empty — expected non-zero rows per cycle-3 audit live counts (3895 + 4328 + ...). Aborting drop to prevent data loss.';
  END IF;
END $$;

-- ── DROP the 6 columns in a single ALTER TABLE ──
ALTER TABLE public.place_pool
  DROP COLUMN IF EXISTS seeding_category,
  DROP COLUMN IF EXISTS ai_categories,
  DROP COLUMN IF EXISTS ai_reason,
  DROP COLUMN IF EXISTS ai_primary_identity,
  DROP COLUMN IF EXISTS ai_confidence,
  DROP COLUMN IF EXISTS ai_web_evidence;

-- Drop any orphan index on seeding_category (defensive — ALTER TABLE DROP COLUMN
-- should auto-drop dependent indexes, but explicit safety doesn't hurt)
DROP INDEX IF EXISTS public.place_pool_seeding_category_idx;

-- ── Verification: confirm 6 columns gone ──
DO $$
DECLARE
  v_remaining_count INT;
  v_remaining_cols TEXT[];
BEGIN
  v_remaining_cols := ARRAY(
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'place_pool'
      AND column_name IN ('seeding_category','ai_categories','ai_reason','ai_primary_identity','ai_confidence','ai_web_evidence')
  );
  v_remaining_count := COALESCE(array_length(v_remaining_cols, 1), 0);
  IF v_remaining_count <> 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.E verify FAIL: % column(s) still exist on place_pool: %', v_remaining_count, v_remaining_cols;
  END IF;
END $$;

COMMIT;

-- ── POST-MIGRATION OPERATOR REMINDER ──
-- Schedule a /schedule reminder for 2026-06-02 to drop the archive table:
--   DROP TABLE IF EXISTS public._archive_orch_0700_doomed_columns;
-- (After 30-day soak with no rollback signal, the archive can be released.)
