-- ORCH-0757: Place Intelligence failed-only retry lineage + retry parent mode.
--
-- Monotonicity: local and linked remote migration heads were both
-- 20260514000000 at implementation time; this prefix is greater than both.

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_mode_check;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT place_intelligence_runs_mode_check
  CHECK (mode IN ('sample', 'full_city', 'retry_failed'));

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS chk_sample_size_consistency;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT chk_sample_size_consistency
  CHECK (
    (mode = 'sample' AND sample_size IS NOT NULL)
    OR (mode IN ('full_city', 'retry_failed') AND sample_size IS NULL)
  );

ALTER TABLE public.place_intelligence_runs
  ADD COLUMN IF NOT EXISTS source_run_id uuid REFERENCES public.place_intelligence_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retry_filter text,
  ADD COLUMN IF NOT EXISTS retry_source_failed_count integer,
  ADD COLUMN IF NOT EXISTS retry_selected_count integer;

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS source_trial_run_id uuid REFERENCES public.place_intelligence_trial_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_place_intel_runs_source_run_id
  ON public.place_intelligence_runs(source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pit_runs_source_trial_run_id
  ON public.place_intelligence_trial_runs(source_trial_run_id)
  WHERE source_trial_run_id IS NOT NULL;

COMMENT ON COLUMN public.place_intelligence_runs.source_run_id IS
  'ORCH-0757: retry_failed parent lineage. Points to the source place_intelligence_runs row whose failed children were retried.';

COMMENT ON COLUMN public.place_intelligence_runs.retry_filter IS
  'ORCH-0757: failed-row filter used when creating a retry_failed run, e.g. retryable_only or all_failed.';

COMMENT ON COLUMN public.place_intelligence_runs.retry_source_failed_count IS
  'ORCH-0757: number of failed child rows on the source run when retry_failed parent was created.';

COMMENT ON COLUMN public.place_intelligence_runs.retry_selected_count IS
  'ORCH-0757: number of failed source child rows selected into this retry_failed parent.';

COMMENT ON COLUMN public.place_intelligence_trial_runs.source_trial_run_id IS
  'ORCH-0757: retry child lineage. Points to the failed source child row that produced this retry attempt.';
