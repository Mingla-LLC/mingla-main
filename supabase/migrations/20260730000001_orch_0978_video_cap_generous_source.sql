DO $$
DECLARE
  offending_count int;
BEGIN
  -- Existing <=29000 constraints should guarantee this is zero, but probe
  -- defensively before loosening the edge/DB processed cap to 30000.
  SELECT count(*) INTO offending_count
  FROM public.event_cover_video_jobs
  WHERE (trim_end_ms - trim_start_ms) > 30000
     OR (processed_duration_ms IS NOT NULL AND processed_duration_ms > 30000);

  IF offending_count > 0 THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 pre-flight: % rows exceed 30000ms cap; data repair runbook required before migration', offending_count;
  END IF;
END $$;

ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_trim_max_duration;
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_processed_max_duration;

ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_trim_max_duration
    CHECK ((trim_end_ms - trim_start_ms) <= 30000);
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_processed_max_duration
    CHECK (processed_duration_ms IS NULL OR processed_duration_ms <= 30000);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN (
      'event_cover_video_jobs_trim_max_duration',
      'event_cover_video_jobs_processed_max_duration'
    )
    AND pg_get_constraintdef(oid) LIKE '%29000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 post-verify: stale 29000ms constraint still present after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_trim_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%30000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 post-verify: 30000ms trim constraint not present after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_processed_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%30000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 post-verify: 30000ms processed constraint not present after migration';
  END IF;
END $$;
