-- Issue #3040: one-minute shared Host-video contract and durable processing SLO evidence.
-- The canonical uploader remains provider-neutral at the job boundary; Bunny is the
-- certified implementation candidate, not a Host-visible product concept.

BEGIN;

ALTER TABLE public.event_cover_video_jobs
  ADD COLUMN IF NOT EXISTS source_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_slo_alerted_at timestamptz;

-- Historical jobs predate the first-class clock. Preserve their best server clock so
-- status projection and incident review never have to trust a client timestamp.
UPDATE public.event_cover_video_jobs
SET source_uploaded_at = coalesce(provider_checked_at, updated_at, created_at)
WHERE source_uploaded_at IS NULL
  AND status IN ('source_uploaded','processing_queued','processing','ready','applied');

ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_trim_max_duration,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_processed_max_duration;
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_trim_max_duration CHECK
    (client_operation_id IS NULL OR trim_end_ms-trim_start_ms <= 60000) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_processed_max_duration CHECK
    (client_operation_id IS NULL OR processed_duration_ms IS NULL OR processed_duration_ms <= 60000) NOT VALID;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_trim_max_duration;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_processed_max_duration;

CREATE OR REPLACE FUNCTION public.cover_video_require_new_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
DECLARE v_brand_id uuid;
BEGIN
  IF NEW.target_kind='event' THEN
    SELECT brand_id INTO v_brand_id FROM public.events WHERE id=NEW.event_id AND deleted_at IS NULL;
    IF v_brand_id IS DISTINCT FROM NEW.brand_id THEN RAISE EXCEPTION 'cover_video_event_brand_mismatch'; END IF;
  ELSIF NEW.target_kind='venue' THEN
    SELECT brand_id INTO v_brand_id FROM public.venue_listings WHERE id=NEW.venue_id;
    IF v_brand_id IS DISTINCT FROM NEW.brand_id THEN RAISE EXCEPTION 'cover_video_venue_brand_mismatch'; END IF;
  END IF;
  IF NEW.client_operation_id IS NULL THEN RETURN NEW; END IF;
  NEW.source_mime_type:=lower(btrim(NEW.source_mime_type));
  NEW.source_extension:=lower(btrim(NEW.source_extension));
  NEW.source_sha256:=lower(btrim(NEW.source_sha256));
  IF NEW.source_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'cover_video_sha256_required'; END IF;
  IF (NEW.source_mime_type,NEW.source_extension) NOT IN
    (('video/mp4','mp4'),('video/quicktime','mov'),('video/x-m4v','m4v'),('video/webm','webm')) THEN
    RAISE EXCEPTION 'cover_video_source_type_not_allowed';
  END IF;
  IF NEW.source_bytes IS NULL OR NEW.source_bytes <= 0 OR NEW.source_duration_ms IS NULL OR NEW.source_duration_ms > 60000
     OR NEW.trim_start_ms <> 0 OR NEW.trim_end_ms <> NEW.source_duration_ms THEN
    RAISE EXCEPTION 'cover_video_source_contract_invalid';
  END IF;
  RETURN NEW;
END $f$;

-- Keep the original transition matrix and CAS semantics; add only the authoritative
-- final-byte clock used by the 30/60-second UX and the provider SLO ledger.
CREATE OR REPLACE FUNCTION public.cover_video_transition_job(p_job_id uuid,p_from_statuses text[],p_to_status text,p_provider_status integer DEFAULT NULL,p_provider_progress integer DEFAULT NULL,p_patch jsonb DEFAULT '{}'::jsonb)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs j SET status=p_to_status,provider_status=coalesce(p_provider_status,j.provider_status),
  provider_progress=CASE WHEN p_provider_progress IS NULL THEN j.provider_progress ELSE greatest(coalesce(j.provider_progress,0),p_provider_progress) END,
  provider_checked_at=now(),tus_upload_offset=coalesce((p_patch->>'tus_upload_offset')::bigint,j.tus_upload_offset),
  source_uploaded_at=CASE WHEN p_to_status='source_uploaded' THEN coalesce(j.source_uploaded_at,now()) ELSE j.source_uploaded_at END,
  processed_url=coalesce(p_patch->>'processed_url',j.processed_url),processed_poster_url=coalesce(p_patch->>'processed_poster_url',j.processed_poster_url),
  processed_mime_type=coalesce(p_patch->>'processed_mime_type',j.processed_mime_type),processed_bytes=coalesce((p_patch->>'processed_bytes')::bigint,j.processed_bytes),
  processed_duration_ms=coalesce((p_patch->>'processed_duration_ms')::integer,j.processed_duration_ms),processed_video_codec=coalesce(p_patch->>'processed_video_codec',j.processed_video_codec),
  processed_audio_codec=coalesce(p_patch->>'processed_audio_codec',j.processed_audio_codec),provider_payload=coalesce(p_patch->'provider_payload',j.provider_payload),failure_code=coalesce(p_patch->>'failure_code',j.failure_code),
  failure_message=coalesce(p_patch->>'failure_message',j.failure_message),completed_at=CASE WHEN p_to_status IN ('ready','failed','cancelled','superseded','applied') THEN coalesce(j.completed_at,now()) ELSE j.completed_at END
 WHERE j.id=p_job_id AND j.status=ANY(p_from_statuses) AND j.status NOT IN ('cancelled','superseded','applied') AND (
  (j.status='source_uploading' AND p_to_status IN ('source_uploaded','failed','cancelled','superseded')) OR
  (j.status='source_uploaded' AND p_to_status IN ('processing_queued','processing','ready','failed','cancelled','superseded')) OR
  (j.status='processing_queued' AND p_to_status IN ('processing','ready','failed','cancelled','superseded')) OR
  (j.status='processing' AND p_to_status IN ('ready','failed','cancelled','superseded')) OR
  (j.status='ready' AND p_to_status='ready')) RETURNING * INTO v;
 IF FOUND THEN RETURN v; END IF; SELECT * INTO v FROM public.event_cover_video_jobs WHERE id=p_job_id; RETURN v;
END $f$;

CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_processing_slo
  ON public.event_cover_video_jobs (source_uploaded_at, id)
  WHERE processing_slo_alerted_at IS NULL
    AND status IN ('source_uploaded','processing_queued','processing');

-- One durable alert per job, recorded by the existing minute-cadence reaper. The
-- existing Bunny health rail owns operator visibility; no new recipient or secret.
CREATE OR REPLACE FUNCTION public.cover_video_record_processing_slo_breaches(
  p_limit integer DEFAULT 100
) RETURNS SETOF public.event_cover_video_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_job public.event_cover_video_jobs;
BEGIN
  FOR v_job IN
    WITH candidates AS (
      SELECT id
      FROM public.event_cover_video_jobs
      WHERE processing_slo_alerted_at IS NULL
        AND source_uploaded_at IS NOT NULL
        AND source_uploaded_at <= now() - interval '60 seconds'
        AND status IN ('source_uploaded','processing_queued','processing')
      ORDER BY source_uploaded_at,id
      FOR UPDATE SKIP LOCKED
      LIMIT least(greatest(p_limit,1),1000)
    )
    UPDATE public.event_cover_video_jobs j
    SET processing_slo_alerted_at=now()
    FROM candidates c
    WHERE j.id=c.id
    RETURNING j.*
  LOOP
    INSERT INTO public.api_health_checks(
      service_key,layer,status,latency_ms,mode,http_status,detail,checked_at
    ) VALUES (
      'bunny','passive','degraded',
      greatest(0,extract(epoch FROM (v_job.processing_slo_alerted_at-v_job.source_uploaded_at))*1000)::integer,
      NULL,NULL,
      jsonb_build_object(
        'signal','cover_video_processing_slo_breach',
        'job_id',v_job.id,
        'target_kind',v_job.target_kind,
        'source_duration_ms',v_job.source_duration_ms,
        'source_uploaded_at',v_job.source_uploaded_at,
        'processing_slo_ms',60000
      ),
      v_job.processing_slo_alerted_at
    );
    RETURN NEXT v_job;
  END LOOP;
END $f$;

REVOKE ALL ON FUNCTION public.cover_video_require_new_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_transition_job(uuid,text[],text,integer,integer,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_record_processing_slo_breaches(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cover_video_require_new_identity() TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_transition_job(uuid,text[],text,integer,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_record_processing_slo_breaches(integer) TO service_role;

COMMENT ON COLUMN public.event_cover_video_jobs.source_uploaded_at IS
  'Issue #3040 authoritative final-byte acknowledgement clock; processing SLO excludes transfer time.';
COMMENT ON COLUMN public.event_cover_video_jobs.processing_slo_alerted_at IS
  'Issue #3040 first durable 60-second provider-processing alert for this job; NULL means no breach recorded.';
COMMENT ON FUNCTION public.cover_video_record_processing_slo_breaches(integer) IS
  'Issue #3040 records each unresolved 60-second cover-video processing breach once on the existing Bunny health rail.';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='event_cover_video_jobs_trim_max_duration'
      AND pg_get_constraintdef(oid) LIKE '%60000%'
  ) THEN RAISE EXCEPTION 'issue #3040: 60-second trim constraint missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname='idx_event_cover_video_jobs_processing_slo'
  ) THEN RAISE EXCEPTION 'issue #3040: processing SLO index missing'; END IF;
END $verify$;

COMMIT;
