-- Issue #4276: resuming an Intelligence run restarts its no-progress clock.
--
-- place_intel_reap_stalled_runs() pauses a running run whose last_progress_at is more
-- than 30 minutes old. last_progress_at only moves when processed_count changes, and no
-- resume path reset it: handleResumeRun (run-place-intelligence-trial) and
-- place_intel_auto_resume_system_runs() both set status back to 'queued' and leave the old
-- timestamp. On 2026-11-08 Abuja's run 77e7f5d2 was resumed two hours after its last
-- progress and the reaper paused it again within two minutes ('stalled_no_progress'),
-- before the worker could finish a single chunk.
--
-- One BEFORE UPDATE trigger covers every resume path, current and future: when a run
-- leaves 'paused' for 'queued' or 'running', its clock restarts from now.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS place_intel_resume_resets_progress ON public.place_intelligence_runs;
--   DROP FUNCTION IF EXISTS public.tg_place_intel_resume_resets_progress();

CREATE OR REPLACE FUNCTION public.tg_place_intel_resume_resets_progress()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'paused' AND NEW.status IN ('queued', 'running') THEN
    NEW.last_progress_at := now();
    NEW.last_progress_count := NEW.processed_count;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_place_intel_resume_resets_progress() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS place_intel_resume_resets_progress ON public.place_intelligence_runs;
CREATE TRIGGER place_intel_resume_resets_progress
  BEFORE UPDATE OF status ON public.place_intelligence_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_place_intel_resume_resets_progress();
