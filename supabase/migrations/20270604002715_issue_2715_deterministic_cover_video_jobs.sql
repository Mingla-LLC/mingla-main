-- Issue #2715: deterministic, content-addressed and resumable cover-video jobs.
-- Historical rows are evidence: new contracts apply only to rows with a client operation id.

ALTER TABLE public.event_cover_video_jobs
  ADD COLUMN IF NOT EXISTS client_operation_id uuid,
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS draft_owner_key text,
  ADD COLUMN IF NOT EXISTS source_sha256 text,
  ADD COLUMN IF NOT EXISTS source_extension text,
  ADD COLUMN IF NOT EXISTS tus_resource_url text,
  ADD COLUMN IF NOT EXISTS tus_upload_offset bigint,
  ADD COLUMN IF NOT EXISTS tus_upload_length bigint,
  ADD COLUMN IF NOT EXISTS tus_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS transport_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_allocation_token uuid,
  ADD COLUMN IF NOT EXISTS provider_allocation_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS provider_allocation_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_allocation_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_allocation_last_error text,
  ADD COLUMN IF NOT EXISTS provider_allocation_identity text,
  ADD COLUMN IF NOT EXISTS provider_allocation_uncertain_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_status integer,
  ADD COLUMN IF NOT EXISTS provider_progress integer,
  ADD COLUMN IF NOT EXISTS provider_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_lease_token uuid,
  ADD COLUMN IF NOT EXISTS reconcile_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS application_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS application_receipt jsonb;

ALTER TABLE public.event_cover_video_jobs ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE public.event_cover_video_jobs DROP CONSTRAINT IF EXISTS event_cover_video_jobs_status_check;
ALTER TABLE public.event_cover_video_jobs ADD CONSTRAINT event_cover_video_jobs_status_check CHECK (status IN
  ('created','source_uploading','source_uploaded','processing_queued','processing','ready','failed','cancelled','superseded','applied')) NOT VALID;
ALTER TABLE public.event_cover_video_jobs VALIDATE CONSTRAINT event_cover_video_jobs_status_check;
ALTER TABLE public.event_cover_video_jobs DROP CONSTRAINT IF EXISTS event_cover_video_jobs_target_kind_check;
ALTER TABLE public.event_cover_video_jobs ADD CONSTRAINT event_cover_video_jobs_target_kind_check
  CHECK (target_kind IN ('event','brand','venue','venue_draft')) NOT VALID;
ALTER TABLE public.event_cover_video_jobs VALIDATE CONSTRAINT event_cover_video_jobs_target_kind_check;
ALTER TABLE public.event_cover_video_jobs DROP CONSTRAINT IF EXISTS event_cover_video_jobs_target_kind_event_id;
ALTER TABLE public.event_cover_video_jobs DROP CONSTRAINT IF EXISTS event_cover_video_jobs_exact_target;
ALTER TABLE public.event_cover_video_jobs ADD CONSTRAINT event_cover_video_jobs_exact_target CHECK (
  (target_kind='event' AND event_id IS NOT NULL AND venue_id IS NULL AND draft_owner_key IS NULL) OR
  (target_kind='brand' AND event_id IS NULL AND venue_id IS NULL AND draft_owner_key IS NULL) OR
  (target_kind='venue' AND event_id IS NULL AND venue_id IS NOT NULL AND draft_owner_key IS NULL) OR
  (target_kind='venue_draft' AND event_id IS NULL AND venue_id IS NULL AND draft_owner_key IS NOT NULL
    AND length(btrim(draft_owner_key)) BETWEEN 3 AND 160)) NOT VALID;

ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_new_operation_required,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_tus_bounds,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_provider_progress_bounds,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_application_version_nonnegative,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_trim_max_duration,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_processed_max_duration;
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_tus_bounds CHECK (
    client_operation_id IS NULL OR (tus_upload_offset IS NULL OR tus_upload_offset >= 0)
      AND (tus_upload_length IS NULL OR tus_upload_length > 0)
      AND (tus_upload_offset IS NULL OR tus_upload_length IS NULL OR tus_upload_offset <= tus_upload_length)) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_provider_progress_bounds CHECK
    (provider_progress IS NULL OR provider_progress BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_application_version_nonnegative CHECK (application_version >= 0) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_trim_max_duration CHECK
    (client_operation_id IS NULL OR trim_end_ms-trim_start_ms <= 15000) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_processed_max_duration CHECK
    (client_operation_id IS NULL OR processed_duration_ms IS NULL OR processed_duration_ms <= 15000) NOT VALID;

CREATE OR REPLACE FUNCTION public.cover_video_require_new_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
DECLARE v_brand_id uuid;
BEGIN
  -- Edge-first rollout bridge (#2715/A12): historical/deployed insert shapes
  -- remain writable while the new edge fails closed before reaching INSERT.
  -- Target ownership/coherence is not a new-client invariant: legacy/null-op
  -- venue/event rows must obey it on both insert and update too.
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
  IF NEW.source_bytes IS NULL OR NEW.source_bytes <= 0 OR NEW.source_duration_ms IS NULL OR NEW.source_duration_ms > 15000
     OR NEW.trim_start_ms <> 0 OR NEW.trim_end_ms <> NEW.source_duration_ms THEN
    RAISE EXCEPTION 'cover_video_source_contract_invalid';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_event_cover_video_jobs_require_new_identity ON public.event_cover_video_jobs;
CREATE TRIGGER trg_event_cover_video_jobs_require_new_identity BEFORE INSERT OR UPDATE ON public.event_cover_video_jobs
FOR EACH ROW EXECUTE FUNCTION public.cover_video_require_new_identity();

CREATE OR REPLACE FUNCTION public.cover_video_enforce_immutable_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN
  IF OLD.client_operation_id IS NOT NULL AND
    (NEW.requested_by,NEW.client_operation_id,NEW.target_kind,NEW.event_id,NEW.brand_id,NEW.venue_id,
     NEW.draft_owner_key,NEW.apply_mode,NEW.provider,NEW.source_file_name,NEW.source_mime_type,
     NEW.source_extension,NEW.source_sha256,NEW.source_bytes,NEW.source_duration_ms,NEW.trim_start_ms,NEW.trim_end_ms)
    IS DISTINCT FROM
    (OLD.requested_by,OLD.client_operation_id,OLD.target_kind,OLD.event_id,OLD.brand_id,OLD.venue_id,
     OLD.draft_owner_key,OLD.apply_mode,OLD.provider,OLD.source_file_name,OLD.source_mime_type,
     OLD.source_extension,OLD.source_sha256,OLD.source_bytes,OLD.source_duration_ms,OLD.trim_start_ms,OLD.trim_end_ms)
  THEN RAISE EXCEPTION 'cover_video_identity_immutable'; END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_event_cover_video_jobs_immutable_identity ON public.event_cover_video_jobs;
CREATE TRIGGER trg_event_cover_video_jobs_immutable_identity BEFORE UPDATE ON public.event_cover_video_jobs
FOR EACH ROW EXECUTE FUNCTION public.cover_video_enforce_immutable_identity();

REVOKE ALL ON FUNCTION public.cover_video_require_new_identity(),public.cover_video_enforce_immutable_identity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cover_video_require_new_identity(),public.cover_video_enforce_immutable_identity() TO service_role;

DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_operation;
DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_one_active_per_event;
DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_one_active_per_brand_target;
DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_one_active_event;
DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_one_active_brand;
DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_one_active_venue;
DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_one_active_venue_draft;
DROP INDEX IF EXISTS public.idx_event_cover_video_jobs_reconcile;
CREATE UNIQUE INDEX idx_event_cover_video_jobs_operation ON public.event_cover_video_jobs(requested_by,client_operation_id) WHERE client_operation_id IS NOT NULL;
CREATE UNIQUE INDEX idx_event_cover_video_jobs_one_active_event ON public.event_cover_video_jobs(event_id) WHERE target_kind='event' AND status NOT IN ('failed','cancelled','superseded','applied');
CREATE UNIQUE INDEX idx_event_cover_video_jobs_one_active_brand ON public.event_cover_video_jobs(brand_id) WHERE target_kind='brand' AND status NOT IN ('failed','cancelled','superseded','applied');
CREATE UNIQUE INDEX idx_event_cover_video_jobs_one_active_venue ON public.event_cover_video_jobs(venue_id) WHERE target_kind='venue' AND status NOT IN ('failed','cancelled','superseded','applied');
CREATE UNIQUE INDEX idx_event_cover_video_jobs_one_active_venue_draft ON public.event_cover_video_jobs(requested_by,brand_id,draft_owner_key) WHERE target_kind='venue_draft' AND status NOT IN ('failed','cancelled','superseded','applied');
CREATE INDEX idx_event_cover_video_jobs_reconcile ON public.event_cover_video_jobs(status,reconcile_lease_until NULLS FIRST,created_at,id) WHERE status IN ('source_uploading','failed','cancelled','superseded','source_uploaded','processing_queued','processing','ready');

DROP FUNCTION IF EXISTS public.cover_video_create_or_replay_job(uuid,uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,integer);
CREATE OR REPLACE FUNCTION public.cover_video_create_or_replay_job(
 p_requested_by uuid,p_client_operation_id uuid,p_target_kind text,p_event_id uuid,p_brand_id uuid,p_venue_id uuid,
 p_draft_owner_key text,p_apply_mode text,p_provider text,p_source_file_name text,p_source_mime_type text,
 p_source_extension text,p_source_sha256 text,p_source_bytes bigint,p_source_duration_ms integer,p_trim_start_ms integer,p_trim_end_ms integer,
 p_accept_new boolean)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs; k text;
BEGIN
  -- A live event/brand/venue has one shared target owner across all managers.
  -- Only a venue draft is private to its requesting manager.
  k:=CASE WHEN p_target_kind='venue_draft'
    THEN concat_ws(':','cover',p_target_kind,p_requested_by,p_brand_id,nullif(btrim(p_draft_owner_key),''))
    ELSE concat_ws(':','cover',p_target_kind,p_event_id,p_brand_id,p_venue_id)
  END;
  PERFORM pg_advisory_xact_lock(hashtextextended(k,2715));
  SELECT * INTO v FROM public.event_cover_video_jobs WHERE requested_by=p_requested_by AND client_operation_id=p_client_operation_id FOR UPDATE;
  IF FOUND THEN
    IF (v.target_kind,v.event_id,v.brand_id,v.venue_id,v.draft_owner_key,v.apply_mode,v.provider,v.source_file_name,
        v.source_mime_type,v.source_extension,v.source_sha256,v.source_bytes,v.source_duration_ms,v.trim_start_ms,v.trim_end_ms)
       IS DISTINCT FROM
       (p_target_kind,p_event_id,p_brand_id,p_venue_id,nullif(btrim(p_draft_owner_key),''),p_apply_mode,p_provider,p_source_file_name,
        p_source_mime_type,p_source_extension,lower(p_source_sha256),p_source_bytes,p_source_duration_ms,p_trim_start_ms,p_trim_end_ms)
    THEN RAISE EXCEPTION 'cover_video_operation_identity_mismatch'; END IF;
    RETURN v;
  END IF;
  -- Replay/schema probe: capacity is external provider truth and must be
  -- accepted before an old active job is superseded or a replacement exists.
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
  -- A competing writer may have committed between a legacy/non-advisory write
  -- and this transaction. Re-read the canonical active row; never leak a 500.
  SELECT * INTO v FROM public.event_cover_video_jobs WHERE status NOT IN ('failed','cancelled','superseded','applied') AND (
    (p_target_kind='event' AND target_kind='event' AND event_id=p_event_id) OR
    (p_target_kind='brand' AND target_kind='brand' AND brand_id=p_brand_id) OR
    (p_target_kind='venue' AND target_kind='venue' AND venue_id=p_venue_id) OR
    (p_target_kind='venue_draft' AND target_kind='venue_draft' AND requested_by=p_requested_by AND brand_id=p_brand_id AND draft_owner_key=p_draft_owner_key))
  ORDER BY created_at DESC,id DESC LIMIT 1;
  IF FOUND THEN RETURN v; END IF;
  RAISE;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_claim_provider_allocation(p_job_id uuid,p_lease_seconds integer DEFAULT 60)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs SET provider_allocation_token=gen_random_uuid(),provider_allocation_lease_until=now()+make_interval(secs=>greatest(10,p_lease_seconds)),
   provider_allocation_attempts=provider_allocation_attempts+1,provider_allocation_attempted_at=now()
 WHERE id=p_job_id AND status='source_uploading' AND tus_resource_url IS NULL
   AND (provider_allocation_lease_until IS NULL OR provider_allocation_lease_until<now()) RETURNING * INTO v;
 IF FOUND THEN RETURN v; END IF;
 SELECT * INTO v FROM public.event_cover_video_jobs WHERE id=p_job_id;
 -- The lease token is capability material. A losing caller may observe the
 -- canonical transport, but must never receive or own the winner's token.
 v.provider_allocation_token:=NULL;
 RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_record_provider_allocation_attempt(
 p_job_id uuid,p_token uuid,p_source_asset_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs SET
  source_asset_id=coalesce(source_asset_id,nullif(btrim(p_source_asset_id),'')),
  source_public_id=coalesce(source_public_id,nullif(btrim(p_source_asset_id),'')),
  provider_allocation_attempted_at=now(),provider_allocation_last_error=nullif(btrim(p_error),''),
  provider_allocation_uncertain_at=CASE WHEN nullif(btrim(p_source_asset_id),'') IS NOT NULL THEN NULL ELSE provider_allocation_uncertain_at END
 WHERE id=p_job_id AND status='source_uploading' AND provider_allocation_token=p_token
   AND provider_allocation_lease_until>=now()
   AND (p_source_asset_id IS NULL OR source_asset_id IS NULL OR source_asset_id=p_source_asset_id)
 RETURNING * INTO v;
 IF NOT FOUND THEN RAISE EXCEPTION 'cover_video_allocation_lease_lost'; END IF;
 RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_begin_provider_create(
 p_job_id uuid,p_token uuid,p_identity text)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs SET provider_allocation_identity=btrim(p_identity),
  provider_allocation_uncertain_at=now(),provider_allocation_attempted_at=now(),provider_allocation_last_error=NULL
 WHERE id=p_job_id AND status='source_uploading' AND provider_allocation_token=p_token
  AND provider_allocation_lease_until>=now() AND source_asset_id IS NULL AND tus_resource_url IS NULL
  AND btrim(p_identity)=id::text RETURNING * INTO v;
 IF NOT FOUND THEN RAISE EXCEPTION 'cover_video_allocation_lease_lost'; END IF;
 RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_resolve_provider_allocation(
 p_job_id uuid,p_token uuid,p_source_asset_id text,p_absent boolean)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 IF NOT (
  (p_absent AND p_source_asset_id IS NULL) OR
  (NOT p_absent AND nullif(btrim(p_source_asset_id),'') IS NOT NULL)
 ) THEN
  RAISE EXCEPTION 'cover_video_allocation_resolution_invalid';
 END IF;
 UPDATE public.event_cover_video_jobs SET
  source_asset_id=CASE WHEN p_absent THEN source_asset_id ELSE btrim(p_source_asset_id) END,
  source_public_id=CASE WHEN p_absent THEN source_public_id ELSE btrim(p_source_asset_id) END,
  provider_allocation_uncertain_at=NULL,provider_allocation_last_error=NULL,
  provider_allocation_attempted_at=now()
 WHERE id=p_job_id AND status='source_uploading' AND provider_allocation_token=p_token
  AND provider_allocation_lease_until>=now() AND provider_allocation_uncertain_at IS NOT NULL
  AND provider_allocation_identity=id::text AND source_asset_id IS NULL AND tus_resource_url IS NULL
 RETURNING * INTO v;
 IF NOT FOUND THEN RAISE EXCEPTION 'cover_video_allocation_lease_lost'; END IF;
 RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_renew_provider_allocation(p_job_id uuid,p_token uuid,p_lease_seconds integer DEFAULT 60)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE changed integer;
BEGIN
 UPDATE public.event_cover_video_jobs SET provider_allocation_lease_until=now()+make_interval(secs=>greatest(10,p_lease_seconds))
 WHERE id=p_job_id AND status='source_uploading' AND provider_allocation_token=p_token
   AND provider_allocation_lease_until>=now() AND tus_resource_url IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_commit_provider_allocation(p_job_id uuid,p_token uuid,p_source_asset_id text,p_source_public_id text,p_tus_url text,p_tus_length bigint,p_expires_at timestamptz)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs SET source_asset_id=p_source_asset_id,source_public_id=p_source_public_id,tus_resource_url=p_tus_url,
  tus_upload_length=p_tus_length,tus_upload_offset=0,tus_expires_at=p_expires_at,provider_allocation_token=NULL,provider_allocation_lease_until=NULL,
  provider_allocation_last_error=NULL,provider_allocation_uncertain_at=NULL
 WHERE id=p_job_id AND status='source_uploading' AND provider_allocation_token=p_token AND provider_allocation_lease_until>=now()
  AND source_bytes=p_tus_length AND tus_resource_url IS NULL
  AND (source_asset_id IS NULL OR source_asset_id=p_source_asset_id) RETURNING * INTO v;
 IF NOT FOUND THEN RAISE EXCEPTION 'cover_video_allocation_lease_lost'; END IF; RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_replace_transport(p_job_id uuid,p_expected_url text,p_new_url text,p_expires_at timestamptz)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs SET tus_resource_url=p_new_url,tus_expires_at=p_expires_at,transport_generation=transport_generation+1
 WHERE id=p_job_id AND status='source_uploading' AND tus_resource_url=p_expected_url AND coalesce(tus_upload_offset,0)=0 RETURNING * INTO v;
 IF NOT FOUND THEN SELECT * INTO v FROM public.event_cover_video_jobs WHERE id=p_job_id; END IF; RETURN v;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_transition_job(p_job_id uuid,p_from_statuses text[],p_to_status text,p_provider_status integer DEFAULT NULL,p_provider_progress integer DEFAULT NULL,p_patch jsonb DEFAULT '{}'::jsonb)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs j SET status=p_to_status,provider_status=coalesce(p_provider_status,j.provider_status),
  provider_progress=CASE WHEN p_provider_progress IS NULL THEN j.provider_progress ELSE greatest(coalesce(j.provider_progress,0),p_provider_progress) END,
  provider_checked_at=now(),tus_upload_offset=coalesce((p_patch->>'tus_upload_offset')::bigint,j.tus_upload_offset),
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

CREATE OR REPLACE FUNCTION public.cover_video_cancel_once(p_job_id uuid) RETURNS public.event_cover_video_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$ DECLARE v public.event_cover_video_jobs;
BEGIN
 SELECT * INTO v FROM public.event_cover_video_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v.status IN ('ready','applied','failed','cancelled','superseded') THEN RETURN v; END IF;
 UPDATE public.event_cover_video_jobs SET status='cancelled',cancelled_at=coalesce(cancelled_at,now()),completed_at=coalesce(completed_at,now()) WHERE id=p_job_id RETURNING * INTO v; RETURN v;
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
 ELSIF v_job.target_kind IN ('venue','venue_draft') THEN n:=1;
 ELSE n:=0; END IF;
 IF n<>1 THEN RETURN v_job; END IF;
 UPDATE public.event_cover_video_jobs SET status='applied',applied_at=coalesce(applied_at,now()),completed_at=coalesce(completed_at,now()),application_version=application_version+1,
  application_receipt=jsonb_build_object('processedUrl',processed_url,'appliedAt',now()) WHERE id=p_job_id AND status='ready' RETURNING * INTO v_job; RETURN v_job;
END $f$;

CREATE OR REPLACE FUNCTION public.cover_video_claim_reconcile_jobs(p_limit integer DEFAULT 100,p_lease_seconds integer DEFAULT 60)
RETURNS SETOF public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN RETURN QUERY WITH c AS (
 SELECT id FROM public.event_cover_video_jobs WHERE
  ((status IN ('failed','cancelled','superseded','source_uploaded','processing_queued','processing','ready') AND source_asset_id IS NOT NULL)
   OR (status='source_uploading' AND provider_allocation_uncertain_at IS NOT NULL AND provider_allocation_identity=id::text))
  AND reaped_at IS NULL
  AND (reconcile_lease_until IS NULL OR reconcile_lease_until<now())
  ORDER BY CASE WHEN status IN ('failed','cancelled','superseded') THEN 0 ELSE 1 END,
    coalesce(provider_checked_at,created_at),created_at,id FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,1),1000))
 UPDATE public.event_cover_video_jobs j SET reconcile_lease_token=gen_random_uuid(),reconcile_lease_until=now()+make_interval(secs=>greatest(10,p_lease_seconds)),reconcile_attempted_at=now()
 FROM c WHERE j.id=c.id RETURNING j.*; END $f$;

REVOKE ALL ON FUNCTION public.cover_video_create_or_replay_job(uuid,uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_claim_provider_allocation(uuid,integer),public.cover_video_renew_provider_allocation(uuid,uuid,integer),public.cover_video_record_provider_allocation_attempt(uuid,uuid,text,text),public.cover_video_begin_provider_create(uuid,uuid,text),public.cover_video_resolve_provider_allocation(uuid,uuid,text,boolean),public.cover_video_commit_provider_allocation(uuid,uuid,text,text,text,bigint,timestamptz),public.cover_video_replace_transport(uuid,text,text,timestamptz),public.cover_video_transition_job(uuid,text[],text,integer,integer,jsonb),public.cover_video_cancel_once(uuid),public.cover_video_apply_once(uuid,bigint,text,uuid),public.cover_video_claim_reconcile_jobs(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cover_video_create_or_replay_job(uuid,uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,integer,boolean),public.cover_video_claim_provider_allocation(uuid,integer),public.cover_video_renew_provider_allocation(uuid,uuid,integer),public.cover_video_record_provider_allocation_attempt(uuid,uuid,text,text),public.cover_video_begin_provider_create(uuid,uuid,text),public.cover_video_resolve_provider_allocation(uuid,uuid,text,boolean),public.cover_video_commit_provider_allocation(uuid,uuid,text,text,text,bigint,timestamptz),public.cover_video_replace_transport(uuid,text,text,timestamptz),public.cover_video_transition_job(uuid,text[],text,integer,integer,jsonb),public.cover_video_cancel_once(uuid),public.cover_video_apply_once(uuid,bigint,text,uuid),public.cover_video_claim_reconcile_jobs(integer,integer) TO service_role;

DROP POLICY IF EXISTS "Event managers can read event cover video jobs" ON public.event_cover_video_jobs;
DROP POLICY IF EXISTS "Authorized managers can read cover video jobs" ON public.event_cover_video_jobs;
CREATE POLICY "Authorized managers can read cover video jobs" ON public.event_cover_video_jobs FOR SELECT TO authenticated USING (
 (target_kind='event' AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_cover_video_jobs.event_id AND e.brand_id=event_cover_video_jobs.brand_id AND e.deleted_at IS NULL AND public.biz_brand_effective_rank_for_caller(e.brand_id)>=public.biz_role_rank('event_manager'))) OR
 (target_kind IN ('brand','venue') AND public.biz_brand_effective_rank_for_caller(brand_id)>=public.biz_role_rank('brand_admin')) OR
 (target_kind='venue_draft' AND requested_by=auth.uid() AND public.biz_brand_effective_rank_for_caller(brand_id)>=public.biz_role_rank('brand_admin')));

DO $verify$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_event_cover_video_jobs_one_active_venue_draft') THEN RAISE EXCEPTION '#2715 target index missing'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_routine_grants WHERE routine_schema='public' AND routine_name LIKE 'cover_video_%' AND grantee IN ('anon','authenticated')) THEN RAISE EXCEPTION '#2715 privileged RPC grant leaked'; END IF;
END $verify$;
