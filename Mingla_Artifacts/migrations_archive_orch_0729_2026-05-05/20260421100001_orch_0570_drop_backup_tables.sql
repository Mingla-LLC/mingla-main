-- ORCH-0570 Phase 1 — drop empty backup tables left from ORCH-0434.
--
-- Evidence:
--   - Both tables verified empty (0 rows) via MCP probe 2026-04-20.
--   - Zero inbound FK references from any public schema table.
--   - Zero code references across app-mobile/, mingla-admin/, supabase/functions/.
--   - Zero migration references beyond their original creation in ORCH-0434.
--
-- Kill list: Mingla_Artifacts/outputs/KILL_LIST_ORCH-0570.md (DEL-09 + DEL-10)
-- Investigation: Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0570_CURATED_AUDIT.md
--
-- Rollback: `git revert` + `supabase db push` re-creates empty tables. Supabase
-- daily backup retains any accidental data for 7+ days if needed.

DROP TABLE IF EXISTS public._backup_experiences;
DROP TABLE IF EXISTS public._backup_saved_experiences;
