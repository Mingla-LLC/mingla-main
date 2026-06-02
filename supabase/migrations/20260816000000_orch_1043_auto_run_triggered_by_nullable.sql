-- ORCH-1043 hotfix: allow NULL photo_backfill_runs.triggered_by for cron/system runs.
--
-- The ORCH-1043 (D) cron auto-drain (ensure_auto_run) creates a thumbnail run with
-- no human initiator. It previously inserted an all-zero sentinel uuid, which is NOT
-- a real auth.users row, so the photo_backfill_runs_triggered_by_fkey FK rejected it
-- with HTTP 500 ("violates foreign key constraint") and no auto run was ever created.
--
-- Fix: cron-initiated runs record NULL provenance. Dropping NOT NULL is the minimal
-- correct change — the FK (-> auth.users) is preserved and simply ignores NULL, so
-- human-triggered runs still require a valid user while system runs record NULL.
-- Additive / constraint-relaxing only; safe to apply with existing rows present
-- (all current rows already hold a non-NULL value, so none are invalidated).
--
-- Docs: https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK
--       https://www.postgresql.org/docs/current/sql-altertable.html

ALTER TABLE public.photo_backfill_runs
  ALTER COLUMN triggered_by DROP NOT NULL;

COMMENT ON COLUMN public.photo_backfill_runs.triggered_by IS
  'auth.users id of the human who started the run; NULL for cron/system-initiated runs (ORCH-1043 ensure_auto_run). FK to auth.users is preserved and ignores NULL.';
