-- ============================================================================
-- ORCH-0729: Production migration history cleanup
-- ============================================================================
--
-- WHAT THIS DOES:
--   Aligns production's `supabase_migrations.schema_migrations` table with
--   the squash-baseline approach in commit 6b91c3ec. Removes 493 historical
--   migration tracking entries (their effects on prod schema are NOT undone —
--   only the tracking entries are cleared) and inserts one entry for the
--   new baseline so Supabase CLI / Branches recognize it as already-applied.
--
-- WHAT THIS DOES NOT DO:
--   - Does NOT modify any actual schema (tables, functions, RLS, indexes — all unchanged)
--   - Does NOT modify any data rows in any user table
--   - Does NOT undo any prior migration's effects on prod
--   - Only modifies the metadata table that Supabase CLI uses for sync tracking
--
-- HOW TO RUN:
--   Option 1 (Supabase Dashboard SQL Editor):
--     1. Open https://supabase.com/dashboard/project/gqnoajqerqhnvulmnyvv/sql/new
--     2. Paste this entire file
--     3. Click Run
--
--   Option 2 (psql / Supabase CLI):
--     supabase db execute -f Mingla_Artifacts/ORCH-0729_PROD_MIGRATION_HISTORY_CLEANUP.sql
--     (or your preferred psql connection)
--
-- AFTER RUNNING:
--   - PR #62's Supabase Branch should pass on next push
--   - `supabase migration list --linked` should show 1 row matching local
--   - Future migrations append on top of the baseline normally
--
-- ROLLBACK (if you need to undo this):
--   The historical entries can be re-inserted from the archive directory's
--   filenames. Bash one-liner to regenerate:
--     for f in Mingla_Artifacts/migrations_archive_orch_0729_2026-05-05/*.sql; do
--       basename "$f" | grep -oE '^[0-9]{14}'
--     done > /tmp/historical_versions.txt
--   Then INSERT each version back into schema_migrations.
--
-- ============================================================================

BEGIN;

-- Snapshot the current state for audit (in case rollback is ever needed)
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations_pre_orch_0729_snapshot AS
  SELECT * FROM supabase_migrations.schema_migrations;

-- Clear all historical entries
DELETE FROM supabase_migrations.schema_migrations
WHERE version != '20260505000000';

-- Insert the baseline as already-applied (idempotent)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260505000000', 'baseline_squash_orch_0729')
ON CONFLICT (version) DO NOTHING;

-- Verify post-state
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM supabase_migrations.schema_migrations;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ORCH-0729 cleanup verify FAIL: expected exactly 1 row in schema_migrations, got %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260505000000'
  ) THEN
    RAISE EXCEPTION 'ORCH-0729 cleanup verify FAIL: baseline entry missing';
  END IF;

  RAISE NOTICE 'ORCH-0729 cleanup OK. schema_migrations now has 1 row (baseline). Snapshot preserved at supabase_migrations.schema_migrations_pre_orch_0729_snapshot.';
END $$;

COMMIT;
