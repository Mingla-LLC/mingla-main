-- ORCH-0770: event cover video processing jobs.
--
-- Raw phone videos are provider/private processing inputs. Only processed
-- browser-safe MP4 derivatives may be applied to events.cover_media_url.

CREATE TABLE IF NOT EXISTS public.event_cover_video_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('cloudinary', 'transloadit')),
  status text NOT NULL CHECK (
    status IN (
      'created',
      'source_uploading',
      'source_uploaded',
      'processing_queued',
      'processing',
      'ready',
      'failed',
      'cancelled',
      'applied'
    )
  ),
  apply_mode text NOT NULL CHECK (apply_mode IN ('draft_auto', 'published_manual')),
  source_public_id text,
  source_asset_id text,
  source_mime_type text,
  source_file_name text,
  source_bytes bigint,
  source_duration_ms integer,
  trim_start_ms integer NOT NULL DEFAULT 0,
  trim_end_ms integer NOT NULL,
  processed_public_id text,
  processed_asset_id text,
  processed_url text,
  processed_mime_type text,
  processed_bytes bigint,
  processed_duration_ms integer,
  processed_video_codec text,
  processed_audio_codec text,
  failure_code text,
  failure_message text,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  applied_at timestamptz,
  CONSTRAINT event_cover_video_jobs_trim_start_nonnegative
    CHECK (trim_start_ms >= 0),
  CONSTRAINT event_cover_video_jobs_trim_end_after_start
    CHECK (trim_end_ms > trim_start_ms),
  CONSTRAINT event_cover_video_jobs_trim_max_duration
    CHECK ((trim_end_ms - trim_start_ms) <= 15000),
  CONSTRAINT event_cover_video_jobs_processed_max_bytes
    CHECK (processed_bytes IS NULL OR processed_bytes <= 26214400),
  CONSTRAINT event_cover_video_jobs_processed_max_duration
    CHECK (processed_duration_ms IS NULL OR processed_duration_ms <= 15000),
  CONSTRAINT event_cover_video_jobs_processed_mime_mp4
    CHECK (processed_mime_type IS NULL OR processed_mime_type = 'video/mp4'),
  CONSTRAINT event_cover_video_jobs_ready_has_processed_payload
    CHECK (
      status NOT IN ('ready', 'applied')
      OR (
        processed_url IS NOT NULL
        AND processed_mime_type IS NOT NULL
        AND processed_bytes IS NOT NULL
        AND processed_duration_ms IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_event_created
ON public.event_cover_video_jobs (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_brand_created
ON public.event_cover_video_jobs (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_status_updated
ON public.event_cover_video_jobs (status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_cover_video_jobs_one_active_per_event
ON public.event_cover_video_jobs (event_id)
WHERE status NOT IN ('failed', 'cancelled', 'applied');

DROP TRIGGER IF EXISTS trg_event_cover_video_jobs_updated_at
ON public.event_cover_video_jobs;

CREATE TRIGGER trg_event_cover_video_jobs_updated_at
BEFORE UPDATE ON public.event_cover_video_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.event_cover_video_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event managers can read event cover video jobs"
ON public.event_cover_video_jobs;
DROP POLICY IF EXISTS "No direct client insert event cover video jobs"
ON public.event_cover_video_jobs;
DROP POLICY IF EXISTS "No direct client update event cover video jobs"
ON public.event_cover_video_jobs;
DROP POLICY IF EXISTS "No direct client delete event cover video jobs"
ON public.event_cover_video_jobs;

CREATE POLICY "Event managers can read event cover video jobs"
ON public.event_cover_video_jobs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_cover_video_jobs.event_id
      AND e.brand_id = event_cover_video_jobs.brand_id
      AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank_for_caller(e.brand_id)
        >= public.biz_role_rank('event_manager'::text)
  )
);

COMMENT ON TABLE public.event_cover_video_jobs IS
  'ORCH-0770: private/provider raw phone video processing jobs for browser-safe event cover MP4 derivatives.';
COMMENT ON COLUMN public.event_cover_video_jobs.processed_url IS
  'Processed public MP4 derivative URL. Raw source URLs must never be written here or to events.cover_media_url.';
