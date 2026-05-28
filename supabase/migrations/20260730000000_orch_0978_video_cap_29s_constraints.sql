DO $$
DECLARE
  offending_count int;
BEGIN
  SELECT count(*) INTO offending_count
  FROM public.event_cover_video_jobs
  WHERE (trim_end_ms - trim_start_ms) > 29000
     OR (processed_duration_ms IS NOT NULL AND processed_duration_ms > 29000);

  IF offending_count > 0 THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 pre-flight: % rows exceed 29000ms cap; data repair runbook required before migration', offending_count;
  END IF;
END $$;

ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_trim_max_duration;
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_processed_max_duration;

ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_trim_max_duration
    CHECK ((trim_end_ms - trim_start_ms) <= 29000);
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_processed_max_duration
    CHECK (processed_duration_ms IS NULL OR processed_duration_ms <= 29000);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN (
      'event_cover_video_jobs_trim_max_duration',
      'event_cover_video_jobs_processed_max_duration'
    )
    AND pg_get_constraintdef(oid) LIKE '%15000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 post-verify: 15000ms constraint still present after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_trim_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%29000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 post-verify: 29000ms trim constraint not present after migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_processed_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%29000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 post-verify: 29000ms processed constraint not present after migration';
  END IF;
END $$;
