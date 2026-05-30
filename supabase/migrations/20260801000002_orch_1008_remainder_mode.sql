-- ORCH-1008: extend place_intelligence_runs.mode enum to include 'remainder'.
--
-- 'remainder' mode evaluates every servable place in a city that has NOT yet
-- been scored (no row in place_intelligence_trial_runs with status='completed'
-- for the same city). Operator UX gate: Run remainder button on the new
-- Intelligence Overview tab. Server enqueues only the un-evaluated subset;
-- sample_size stays NULL (mirrors full_city + retry_failed semantics).
--
-- Predecessor: ORCH-0757 (20260515000000_orch_0757_place_intel_retry_lineage.sql)
-- already DROPped + recreated place_intelligence_runs_mode_check to allow
-- ('sample','full_city','retry_failed'). We extend it again to add 'remainder'
-- as a fourth allowed value and update chk_sample_size_consistency in parallel.
--
-- Migration immutability rule: the original ORCH-0737 + ORCH-0757 migration
-- files are NOT edited. This file is a forward-only schema patch.
--
-- Monotonicity (codified 2026-05-10): local head + linked remote head are
-- both <= 20260801000001 at write time; this prefix is strictly greater than
-- both and greater than every sibling per-ORCH worktree's max prefix.
--
-- Read-only invariant probe done at implementation time:
--   SELECT count(*) FROM public.place_intelligence_runs WHERE mode='remainder';
-- expected: 0 (mode value cannot exist before constraint admits it). No
-- existing row should violate the new CHECK after the broaden — the new
-- constraint is a strict superset of the old.

BEGIN;

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_mode_check;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT place_intelligence_runs_mode_check
  CHECK (mode IN ('sample', 'full_city', 'retry_failed', 'remainder'));

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS chk_sample_size_consistency;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT chk_sample_size_consistency
  CHECK (
    (mode = 'sample' AND sample_size IS NOT NULL)
    OR (mode IN ('full_city', 'retry_failed', 'remainder') AND sample_size IS NULL)
  );

COMMIT;
