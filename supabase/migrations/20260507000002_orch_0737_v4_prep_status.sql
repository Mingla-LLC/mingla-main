-- ─────────────────────────────────────────────────────────────────────────
-- ORCH-0737 v4 patch (post-WORKER_RESOURCE_LIMIT diagnosis 2026-05-06):
-- Two-pass worker pattern — schema addition for prep status tracking.
-- ─────────────────────────────────────────────────────────────────────────
-- Surfaced when v2 chunk-size-6 still hit WORKER_RESOURCE_LIMIT 546 because
-- 6 simultaneous compose_collage operations exceed ~150 MB edge fn memory cap.
--
-- Fix architecture: split per-row processing into two phases.
--   Phase 1 (prep, serial): fetch_reviews + compose_collage. Memory-bounded
--     because only 1 row's collage in flight at a time.
--   Phase 2 (score, parallel-12): Gemini call only. Memory-light because
--     Gemini just gets a URL — no photo bytes loaded in worker memory.
--
-- Schema: prep_status NULL = needs prep, 'ready' = prepped + ready for score.
-- Final status (existing): pending = not yet scored, completed = scored, etc.
--
-- Spec: SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md (binding contract; this
-- patch implements SC-21 stuck-recovery semantics across two phases).
-- Dispatch: prompts/IMPLEMENTOR_ORCH-0737_PATCH_V4_TWO_PASS_WORKER.md
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Add prep_status column ───────────────────────────────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS prep_status text;

COMMENT ON COLUMN public.place_intelligence_trial_runs.prep_status IS
  'ORCH-0737 v4: NULL = needs prep (fetch_reviews + compose_collage); ''ready'' = prepped + ready for Gemini score phase. Set by worker prep phase (serial, memory-bounded). Sample-mode rows pre-ORCH-0737 v4 also have NULL — backfill is unnecessary because sample mode does not use the worker pipeline.';

-- ─── 2. Index for efficient pickup queries ───────────────────────────────
-- Worker needs fast lookup on (parent_run_id, prep_status, status) to decide
-- phase and pick up next chunk. Conditional index on active rows only —
-- terminal rows (completed/cancelled/failed) excluded to keep index small.

CREATE INDEX IF NOT EXISTS idx_trial_runs_prep_pickup
  ON public.place_intelligence_trial_runs (parent_run_id, prep_status, status, started_at)
  WHERE status IN ('pending', 'running');

COMMENT ON INDEX public.idx_trial_runs_prep_pickup IS
  'ORCH-0737 v4: supports two-pass worker pickup queries. Score phase: WHERE parent_run_id=X AND prep_status=''ready'' AND status IN (''pending'', ''running''). Prep phase: WHERE parent_run_id=X AND prep_status IS NULL AND status IN (''pending'', ''running''). Conditional WHERE excludes terminal rows.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference (if v4 needs to be reverted):
--   BEGIN;
--   DROP INDEX IF EXISTS idx_trial_runs_prep_pickup;
--   ALTER TABLE place_intelligence_trial_runs DROP COLUMN IF EXISTS prep_status;
--   COMMIT;
-- (Cron + trigger function untouched; only v4 schema additions reverted.)
-- ─────────────────────────────────────────────────────────────────────────
