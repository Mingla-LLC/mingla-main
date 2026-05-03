# Retention Reminders

> Operator-facing list of scheduled cleanup actions. When the date hits, run the SQL.

---

## 2026-06-02 — Drop ORCH-0700 archive table

**Action:** drop `_archive_orch_0700_doomed_columns` if no rollback signal has surfaced for ORCH-0700 Phase 2 + Phase 3B.

**Context:** Migration 6 (applied 2026-05-03) atomically dropped 6 columns from `place_pool` (`seeding_category`, `ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`) and snapshot-archived 69,599 rows into `_archive_orch_0700_doomed_columns`. 30-day retention window allows rollback-by-restore-from-archive if any unforeseen consumer surfaces.

**Verify before dropping (optional sanity):**

```sql
-- Confirm no production code still references the doomed columns
SELECT proname FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND (prosrc ILIKE '%seeding_category%'
    OR prosrc ILIKE '%ai_categories%'
    OR prosrc ILIKE '%ai_reason%'
    OR prosrc ILIKE '%ai_primary_identity%'
    OR prosrc ILIKE '%ai_confidence%'
    OR prosrc ILIKE '%ai_web_evidence%');
-- Expected: zero rows
```

**Drop SQL (run in Supabase SQL editor):**

```sql
DROP TABLE IF EXISTS public._archive_orch_0700_doomed_columns;
DROP INDEX IF EXISTS public._archive_orch_0700_doomed_columns_id_idx;
```

**After dropping:** delete this section from `RETENTION_REMINDERS.md` and add a one-line entry to `DECISION_LOG.md` noting the archive drop.

---

## How to use this file

When you start a new session and want to know if there's any cleanup work due today, open this file. If today's date matches or has passed any reminder, run the action. Otherwise, the file is a forward-looking reminder; no action needed.

Add new reminders here whenever a deferred-cleanup commitment is made (typically by the orchestrator's CLOSE protocol Step 5h).
