-- ORCH-0776D - restore cancelled_at column on event_cover_video_jobs and
-- unblock any rows stuck in non-terminal status due to silent UPDATE failure.

ALTER TABLE public.event_cover_video_jobs
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

COMMENT ON COLUMN public.event_cover_video_jobs.cancelled_at IS
  'Set by event-cover-video-upload-intent (supersede prior active job) and event-cover-video-cancel (explicit cancel). Mirrors completed_at/applied_at telemetry pattern.';

-- Backfill any rows that were stuck in non-terminal status because the
-- cancel UPDATE was silently failing while the column was missing.
UPDATE public.event_cover_video_jobs
SET status = 'cancelled',
    cancelled_at = now(),
    failure_code = COALESCE(failure_code, 'orch_0776d_stuck_backfill'),
    failure_message = COALESCE(
      failure_message,
      'Cancelled by ORCH-0776D backfill - stuck due to missing cancelled_at column on prior schema.'
    ),
    updated_at = now()
WHERE status NOT IN ('failed','cancelled','applied','ready')
  AND created_at < now() - interval '10 minutes';
