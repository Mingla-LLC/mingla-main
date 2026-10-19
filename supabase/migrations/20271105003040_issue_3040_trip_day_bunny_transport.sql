-- Issue #3040: route trip itinerary/day-gallery videos through the same
-- deterministic Bunny/TUS job machinery as Host cover and ad-source videos.
--
-- A trip-day video is media for an events-row, but it is NOT a cover. The new
-- target therefore reuses transfer, acknowledgement, webhook, reaper and
-- processing truth while `cover_video_apply_once` only writes an application
-- receipt; the client remains the owner of the ordered trip_days.media array.

BEGIN;

ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_target_kind_check,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_exact_target;

ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_target_kind_check
    CHECK (target_kind IN ('event','brand','venue','venue_draft','trip_day_media')) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_exact_target CHECK (
    (target_kind='event' AND event_id IS NOT NULL AND venue_id IS NULL AND draft_owner_key IS NULL) OR
    (target_kind='brand' AND event_id IS NULL AND venue_id IS NULL AND draft_owner_key IS NULL) OR
    (target_kind='venue' AND event_id IS NULL AND venue_id IS NOT NULL AND draft_owner_key IS NULL) OR
    (target_kind='venue_draft' AND event_id IS NULL AND venue_id IS NULL AND draft_owner_key IS NOT NULL
      AND length(btrim(draft_owner_key)) BETWEEN 3 AND 160) OR
    (target_kind='trip_day_media' AND event_id IS NOT NULL AND venue_id IS NULL AND draft_owner_key IS NULL)
  ) NOT VALID;

ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_target_kind_check;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_exact_target;

CREATE OR REPLACE FUNCTION public.cover_video_require_new_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
DECLARE v_brand_id uuid;
BEGIN
  IF NEW.target_kind IN ('event','trip_day_media') THEN
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

CREATE OR REPLACE FUNCTION public.cover_video_create_or_replay_job(
 p_requested_by uuid,p_client_operation_id uuid,p_target_kind text,p_event_id uuid,p_brand_id uuid,p_venue_id uuid,
 p_draft_owner_key text,p_apply_mode text,p_provider text,p_source_file_name text,p_source_mime_type text,
 p_source_extension text,p_source_sha256 text,p_source_bytes bigint,p_source_duration_ms integer,p_trim_start_ms integer,p_trim_end_ms integer,
 p_accept_new boolean)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs; k text;
BEGIN
  -- Cover targets serialize per owner. Gallery videos are independent assets,
  -- so their immutable operation id is the lock and no sibling is superseded.
  k:=CASE
    WHEN p_target_kind='venue_draft'
      THEN concat_ws(':','cover',p_target_kind,p_requested_by,p_brand_id,nullif(btrim(p_draft_owner_key),''))
    WHEN p_target_kind='trip_day_media'
      THEN concat_ws(':','media',p_target_kind,p_requested_by,p_event_id,p_client_operation_id)
    ELSE concat_ws(':','cover',p_target_kind,p_event_id,p_brand_id,p_venue_id)
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended(k,2715));
  SELECT * INTO v FROM public.event_cover_video_jobs
    WHERE requested_by=p_requested_by AND client_operation_id=p_client_operation_id FOR UPDATE;
  IF FOUND THEN
    IF (v.target_kind,v.event_id,v.brand_id,v.venue_id,v.draft_owner_key,v.apply_mode,v.provider,v.source_file_name,
        v.source_mime_type,v.source_extension,v.source_sha256,v.source_bytes,v.source_duration_ms,v.trim_start_ms,v.trim_end_ms)
       IS DISTINCT FROM
       (p_target_kind,p_event_id,p_brand_id,p_venue_id,nullif(btrim(p_draft_owner_key),''),p_apply_mode,p_provider,p_source_file_name,
        p_source_mime_type,p_source_extension,lower(p_source_sha256),p_source_bytes,p_source_duration_ms,p_trim_start_ms,p_trim_end_ms)
    THEN RAISE EXCEPTION 'cover_video_operation_identity_mismatch'; END IF;
    RETURN v;
  END IF;
  IF NOT p_accept_new THEN RETURN NULL; END IF;
  UPDATE public.event_cover_video_jobs SET status='superseded',superseded_at=now(),completed_at=now()
   WHERE status NOT IN ('failed','cancelled','superseded','applied') AND (
    (p_target_kind='event' AND target_kind='event' AND event_id=p_event_id) OR
    (p_target_kind='brand' AND target_kind='brand' AND brand_id=p_brand_id) OR
    (p_target_kind='venue' AND target_kind='venue' AND venue_id=p_venue_id) OR
    (p_target_kind='venue_draft' AND target_kind='venue_draft' AND requested_by=p_requested_by AND brand_id=p_brand_id AND draft_owner_key=p_draft_owner_key));
  INSERT INTO public.event_cover_video_jobs(requested_by,client_operation_id,target_kind,event_id,brand_id,venue_id,draft_owner_key,
   apply_mode,provider,status,source_file_name,source_mime_type,source_extension,source_sha256,source_bytes,source_duration_ms,
   trim_start_ms,trim_end_ms,tus_upload_offset,tus_upload_length)
  VALUES(p_requested_by,p_client_operation_id,p_target_kind,p_event_id,p_brand_id,p_venue_id,nullif(btrim(p_draft_owner_key),''),
   p_apply_mode,p_provider,'source_uploading',p_source_file_name,p_source_mime_type,p_source_extension,lower(p_source_sha256),
   p_source_bytes,p_source_duration_ms,p_trim_start_ms,p_trim_end_ms,0,p_source_bytes) RETURNING * INTO v;
  RETURN v;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v FROM public.event_cover_video_jobs
    WHERE requested_by=p_requested_by AND client_operation_id=p_client_operation_id;
  IF FOUND THEN RETURN v; END IF;
  SELECT * INTO v FROM public.event_cover_video_jobs WHERE status NOT IN ('failed','cancelled','superseded','applied') AND (
    (p_target_kind='event' AND target_kind='event' AND event_id=p_event_id) OR
    (p_target_kind='brand' AND target_kind='brand' AND brand_id=p_brand_id) OR
    (p_target_kind='venue' AND target_kind='venue' AND venue_id=p_venue_id) OR
    (p_target_kind='venue_draft' AND target_kind='venue_draft' AND requested_by=p_requested_by AND brand_id=p_brand_id AND draft_owner_key=p_draft_owner_key))
  ORDER BY created_at DESC,id DESC LIMIT 1;
  IF FOUND THEN RETURN v; END IF;
  RAISE;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_apply_once(p_job_id uuid,p_expected_version bigint,p_expected_url text,p_expected_requested_by uuid DEFAULT NULL)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_job public.event_cover_video_jobs; n integer;
BEGIN
 SELECT * INTO v_job FROM public.event_cover_video_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_job.status='applied' THEN RETURN v_job; END IF;
 IF v_job.status<>'ready' OR v_job.processed_url IS DISTINCT FROM p_expected_url OR v_job.application_version IS DISTINCT FROM p_expected_version
   OR (v_job.target_kind='venue_draft' AND v_job.requested_by IS DISTINCT FROM p_expected_requested_by) THEN RETURN v_job; END IF;
 IF v_job.target_kind='event' THEN
  UPDATE public.events SET cover_media_type='video',cover_media_url=v_job.processed_url,cover_media_poster_url=v_job.processed_poster_url,updated_at=now() WHERE id=v_job.event_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n=ROW_COUNT;
 ELSIF v_job.target_kind='brand' THEN
  UPDATE public.brands SET cover_media_type='video',cover_media_url=v_job.processed_url,cover_media_poster_url=v_job.processed_poster_url,updated_at=now() WHERE id=v_job.brand_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n=ROW_COUNT;
 ELSIF v_job.target_kind IN ('venue','venue_draft','trip_day_media') THEN n:=1;
 ELSE n:=0; END IF;
 IF n<>1 THEN RETURN v_job; END IF;
 UPDATE public.event_cover_video_jobs SET status='applied',applied_at=coalesce(applied_at,now()),completed_at=coalesce(completed_at,now()),application_version=application_version+1,
  application_receipt=jsonb_build_object('processedUrl',processed_url,'appliedAt',now()) WHERE id=p_job_id AND status='ready' RETURNING * INTO v_job;
 RETURN v_job;
END $f$;

DROP POLICY IF EXISTS "Authorized managers can read cover video jobs"
  ON public.event_cover_video_jobs;
CREATE POLICY "Authorized managers can read cover video jobs"
  ON public.event_cover_video_jobs FOR SELECT TO authenticated USING (
    (target_kind IN ('event','trip_day_media') AND EXISTS(
      SELECT 1
      FROM public.events e
      WHERE e.id=event_cover_video_jobs.event_id
        AND e.brand_id=event_cover_video_jobs.brand_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank_for_caller(e.brand_id)
          >= public.biz_role_rank('event_manager')
    )) OR
    (target_kind IN ('brand','venue') AND
      public.biz_brand_effective_rank_for_caller(brand_id)
        >= public.biz_role_rank('brand_admin')) OR
    (target_kind='venue_draft' AND requested_by=auth.uid() AND
      public.biz_brand_effective_rank_for_caller(brand_id)
        >= public.biz_role_rank('brand_admin'))
  );

COMMENT ON CONSTRAINT event_cover_video_jobs_target_kind_check ON public.event_cover_video_jobs IS
  'Cover targets plus upload-only trip_day_media jobs that reuse the deterministic Bunny transport without mutating cover columns.';

COMMIT;
