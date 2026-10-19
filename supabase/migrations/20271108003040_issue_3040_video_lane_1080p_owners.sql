-- Issue #3040: one deterministic 1080p video lane with a server owner for every job.
--
-- Additive and backward compatible with the functions deployed before this
-- migration: new columns are nullable (ad_creatives.source is filled by a
-- BEFORE INSERT default when an older writer omits it), CHECKs only widen or
-- pin values the edge already enforces, every function keeps its signature and
-- its behaviour for existing target kinds, and the one new transition edge
-- (ready -> failed) is only reachable with failure codes no deployed code sends.

BEGIN;

-- ── Step 0: ad_creatives provenance (must exist before cover_video_apply_once
--    below references ad_creatives.source_job_id). ────────────────────────────
-- Ad media must never block account or brand deletion (#3660, GDPR): the live
-- link to the lane job is ON DELETE SET NULL, and provenance survives in
-- immutable snapshot columns (source, source_job_ref, source_brand_id,
-- bunny_video_id) that no deletion touches.
ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_job_id uuid
    REFERENCES public.event_cover_video_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_job_ref uuid,
  ADD COLUMN IF NOT EXISTS source_brand_id uuid,
  ADD COLUMN IF NOT EXISTS rendition_height integer;

-- The creator link likewise never blocks deleting the creator's account.
ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_created_by_fkey;
ALTER TABLE public.ad_creatives
  ADD CONSTRAINT ad_creatives_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

DO $provenance_notice$
DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.ad_creatives c
  WHERE c.brand_id IS NULL
    AND c.source IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.admin_users a ON a.email = u.email AND a.status = 'active'
      WHERE u.id = c.created_by
    );
  RAISE NOTICE 'issue #3040: % brandless ad_creatives rows were not created by an active admin', v_count;
END
$provenance_notice$;

UPDATE public.ad_creatives
SET source = CASE WHEN brand_id IS NULL THEN 'admin_upload' ELSE 'host_upload' END
WHERE source IS NULL;
UPDATE public.ad_creatives SET source_brand_id = brand_id
WHERE source_brand_id IS NULL AND brand_id IS NOT NULL;

-- Older deployed writers do not send `source`. Fill it from the same rule the
-- backfill used so they keep working until the new functions deploy; new code
-- always sends it explicitly.
CREATE OR REPLACE FUNCTION public.ad_creatives_default_source() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN
  IF NEW.source IS NULL THEN
    NEW.source := CASE WHEN NEW.brand_id IS NULL THEN 'admin_upload' ELSE 'host_upload' END;
  END IF;
  -- Snapshots taken at creation; they outlive the job and the brand.
  NEW.source_job_ref := coalesce(NEW.source_job_ref, NEW.source_job_id);
  NEW.source_brand_id := coalesce(NEW.source_brand_id, NEW.brand_id);
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_ad_creatives_default_source ON public.ad_creatives;
CREATE TRIGGER trg_ad_creatives_default_source BEFORE INSERT ON public.ad_creatives
FOR EACH ROW EXECUTE FUNCTION public.ad_creatives_default_source();

ALTER TABLE public.ad_creatives ALTER COLUMN source SET NOT NULL;
ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_source_check;
ALTER TABLE public.ad_creatives
  ADD CONSTRAINT ad_creatives_source_check
    CHECK (source IN ('admin_upload','host_upload','ari_upload','event_cover')) NOT VALID;
ALTER TABLE public.ad_creatives VALIDATE CONSTRAINT ad_creatives_source_check;

CREATE UNIQUE INDEX IF NOT EXISTS ad_creatives_source_job_id_key
  ON public.ad_creatives(source_job_id) WHERE source_job_id IS NOT NULL;

-- MINGLA-INVARIANT: I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE | issue #3697 | house reuse keys on source='admin_upload', never on brand_id IS NULL
-- MINGLA-INVARIANT: I-AD-MEDIA-NEVER-BLOCKS-DELETION | issue #3040 | deleting a brand or account never fails because of ad media; provenance snapshots survive it
CREATE OR REPLACE FUNCTION public.ad_creatives_provenance_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN
  -- Snapshots never change. The live job link may only be cleared (by the
  -- ON DELETE SET NULL of a deleted job), never re-pointed.
  IF (NEW.source, NEW.source_job_ref, NEW.source_brand_id, NEW.bunny_video_id)
     IS DISTINCT FROM (OLD.source, OLD.source_job_ref, OLD.source_brand_id, OLD.bunny_video_id)
     OR (NEW.source_job_id IS DISTINCT FROM OLD.source_job_id AND NEW.source_job_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ad_creative_provenance_immutable';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_ad_creatives_provenance_immutable ON public.ad_creatives;
CREATE TRIGGER trg_ad_creatives_provenance_immutable BEFORE UPDATE ON public.ad_creatives
FOR EACH ROW EXECUTE FUNCTION public.ad_creatives_provenance_immutable();

COMMENT ON COLUMN public.ad_creatives.source IS
  'Issue #3040/#3697 immutable provenance: admin_upload | host_upload | ari_upload | event_cover. House reuse requires admin_upload.';
COMMENT ON COLUMN public.ad_creatives.source_job_id IS
  'Issue #3040 live link to the READY lane job this creative was made from (unique). Cleared, never re-pointed, when the job is deleted.';
COMMENT ON COLUMN public.ad_creatives.source_job_ref IS
  'Issue #3040 immutable snapshot of the lane job id; survives job, brand and account deletion.';
COMMENT ON COLUMN public.ad_creatives.source_brand_id IS
  'Issue #3040 immutable snapshot of the owning brand at creation; survives brand deletion.';
COMMENT ON COLUMN public.ad_creatives.rendition_height IS
  'Issue #3040 the processed MP4 rendition height (short side) chosen by the lane.';

-- ── Step 1: brandless house target (ad_creative only). ───────────────────────
ALTER TABLE public.event_cover_video_jobs ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_brand_required;
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_brand_required
    CHECK (brand_id IS NOT NULL OR target_kind='ad_creative') NOT VALID;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_brand_required;

-- ── Step 2: target kind. ─────────────────────────────────────────────────────
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_target_kind_check,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_exact_target;
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_target_kind_check
    CHECK (target_kind IN ('event','brand','venue','venue_draft','trip_day_media','ad_creative')) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_exact_target CHECK (
    (target_kind='event' AND event_id IS NOT NULL AND venue_id IS NULL AND draft_owner_key IS NULL) OR
    (target_kind='brand' AND event_id IS NULL AND venue_id IS NULL AND draft_owner_key IS NULL) OR
    (target_kind='venue' AND event_id IS NULL AND venue_id IS NOT NULL AND draft_owner_key IS NULL) OR
    (target_kind='venue_draft' AND event_id IS NULL AND venue_id IS NULL AND draft_owner_key IS NOT NULL
      AND length(btrim(draft_owner_key)) BETWEEN 3 AND 160) OR
    (target_kind='trip_day_media' AND event_id IS NOT NULL AND venue_id IS NULL AND draft_owner_key IS NULL) OR
    (target_kind='ad_creative' AND event_id IS NULL AND venue_id IS NULL AND draft_owner_key IS NOT NULL
      AND length(btrim(draft_owner_key)) BETWEEN 3 AND 160)
  ) NOT VALID;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_target_kind_check;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_exact_target;

-- ── Step 3: byte and duration caps. ──────────────────────────────────────────
-- MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | DB caps equal packages/video-upload/limits.js
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_processed_max_bytes,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_source_max_bytes,
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_ad_min_duration;
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_processed_max_bytes
    CHECK (processed_bytes IS NULL OR processed_bytes <= 67108864) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_source_max_bytes
    CHECK (client_operation_id IS NULL OR source_bytes <= 104857600) NOT VALID,
  ADD CONSTRAINT event_cover_video_jobs_ad_min_duration
    CHECK (target_kind <> 'ad_creative' OR source_duration_ms >= 5000) NOT VALID;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_processed_max_bytes;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_source_max_bytes;
ALTER TABLE public.event_cover_video_jobs
  VALIDATE CONSTRAINT event_cover_video_jobs_ad_min_duration;

-- ── Step 4: owner columns. ───────────────────────────────────────────────────
ALTER TABLE public.event_cover_video_jobs
  ADD COLUMN IF NOT EXISTS target_cover_base_captured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_cover_base_url text,
  ADD COLUMN IF NOT EXISTS ready_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS transport_lease_extended_at timestamptz;

COMMENT ON COLUMN public.event_cover_video_jobs.target_cover_base_url IS
  'Issue #3040 the event/brand cover URL captured when the job was created; the server applies a finished video only while the cover is still this value.';
COMMENT ON COLUMN public.event_cover_video_jobs.target_cover_base_captured IS
  'Issue #3040 true when target_cover_base_url was recorded at intent (NULL then means "no cover"). Legacy rows are false and are never applied by the server.';
COMMENT ON COLUMN public.event_cover_video_jobs.ready_alerted_at IS
  'Issue #3040 the one durable ready-but-unclaimed alert for this job.';
COMMENT ON COLUMN public.event_cover_video_jobs.transport_lease_extended_at IS
  'Issue #3040 last time a replayed upload signature extended tus_expires_at.';

-- ── Step 5: identity validation is an INSERT-time contract. ──────────────────
-- MINGLA-INVARIANT: I-VIDEO-SOFTDELETE-NO-WEDGE | issue #3040 | parent soft-delete never blocks job UPDATEs
CREATE OR REPLACE FUNCTION public.cover_video_require_new_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
DECLARE v_brand_id uuid;
BEGIN
  -- Identity is immutable after INSERT (trg_event_cover_video_jobs_immutable_identity),
  -- so re-validating it on UPDATE only let a soft-deleted parent abort the
  -- reaper's lease claim and every later transition of the job.
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  IF NEW.target_kind IN ('event','trip_day_media') THEN
    SELECT brand_id INTO v_brand_id FROM public.events WHERE id=NEW.event_id AND deleted_at IS NULL;
    IF v_brand_id IS DISTINCT FROM NEW.brand_id THEN RAISE EXCEPTION 'cover_video_event_brand_mismatch'; END IF;
  ELSIF NEW.target_kind='venue' THEN
    SELECT brand_id INTO v_brand_id FROM public.venue_listings WHERE id=NEW.venue_id;
    IF v_brand_id IS DISTINCT FROM NEW.brand_id THEN RAISE EXCEPTION 'cover_video_venue_brand_mismatch'; END IF;
  ELSIF NEW.target_kind='ad_creative' AND NEW.brand_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id=NEW.brand_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'cover_video_brand_missing';
    END IF;
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
  IF NEW.source_bytes IS NULL OR NEW.source_bytes <= 0 OR NEW.source_bytes > 104857600
     OR NEW.source_duration_ms IS NULL OR NEW.source_duration_ms > 60000
     OR (NEW.target_kind='ad_creative' AND NEW.source_duration_ms < 5000)
     OR NEW.trim_start_ms <> 0 OR NEW.trim_end_ms <> NEW.source_duration_ms THEN
    RAISE EXCEPTION 'cover_video_source_contract_invalid';
  END IF;
  RETURN NEW;
END $f$;

-- ── Step 6: create or replay (ad_creative is upload-only and non-superseding). ─
CREATE OR REPLACE FUNCTION public.cover_video_create_or_replay_job(
 p_requested_by uuid,p_client_operation_id uuid,p_target_kind text,p_event_id uuid,p_brand_id uuid,p_venue_id uuid,
 p_draft_owner_key text,p_apply_mode text,p_provider text,p_source_file_name text,p_source_mime_type text,
 p_source_extension text,p_source_sha256 text,p_source_bytes bigint,p_source_duration_ms integer,p_trim_start_ms integer,p_trim_end_ms integer,
 p_accept_new boolean)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs; k text;
BEGIN
  -- Cover targets serialize per owner. Gallery and ad videos are independent
  -- assets, so their immutable operation id is the lock and no sibling is
  -- superseded.
  k:=CASE
    WHEN p_target_kind='venue_draft'
      THEN concat_ws(':','cover',p_target_kind,p_requested_by,p_brand_id,nullif(btrim(p_draft_owner_key),''))
    WHEN p_target_kind='trip_day_media'
      THEN concat_ws(':','media',p_target_kind,p_requested_by,p_event_id,p_client_operation_id)
    WHEN p_target_kind='ad_creative'
      THEN concat_ws(':','media','ad_creative',p_requested_by,p_client_operation_id)
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
   trim_start_ms,trim_end_ms,tus_upload_offset,tus_upload_length,target_cover_base_captured,target_cover_base_url)
  VALUES(p_requested_by,p_client_operation_id,p_target_kind,p_event_id,p_brand_id,p_venue_id,nullif(btrim(p_draft_owner_key),''),
   p_apply_mode,p_provider,'source_uploading',p_source_file_name,p_source_mime_type,p_source_extension,lower(p_source_sha256),
   p_source_bytes,p_source_duration_ms,p_trim_start_ms,p_trim_end_ms,0,p_source_bytes,
   p_target_kind IN ('event','brand'),
   CASE
     WHEN p_target_kind='event' THEN (SELECT e.cover_media_url FROM public.events e WHERE e.id=p_event_id)
     WHEN p_target_kind='brand' THEN (SELECT b.cover_media_url FROM public.brands b WHERE b.id=p_brand_id)
     ELSE NULL
   END) RETURNING * INTO v;
  RETURN v;
EXCEPTION WHEN unique_violation THEN
  -- Only the caller's own operation may be returned. Handing back another
  -- operation's active row would give this caller a transport it does not own.
  SELECT * INTO v FROM public.event_cover_video_jobs
    WHERE requested_by=p_requested_by AND client_operation_id=p_client_operation_id;
  IF FOUND THEN RETURN v; END IF;
  RAISE;
END $f$;

-- ── Step 7: transition matrix gains exactly one owned edge: ready -> failed. ─
-- MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040
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
  (j.status='ready' AND p_to_status='ready') OR
  (j.status='ready' AND p_to_status='failed' AND p_patch->>'failure_code' IN
    ('ready_unclaimed','target_deleted','creative_materialize_failed','creative_source_untrusted'))) RETURNING * INTO v;
 IF FOUND THEN RETURN v; END IF; SELECT * INTO v FROM public.event_cover_video_jobs WHERE id=p_job_id; RETURN v;
END $f$;

-- ── Step 8: apply once (an ad video applies only once its creative row exists). ─
CREATE OR REPLACE FUNCTION public.cover_video_apply_once(p_job_id uuid,p_expected_version bigint,p_expected_url text,p_expected_requested_by uuid DEFAULT NULL)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v_job public.event_cover_video_jobs; n integer;
BEGIN
 SELECT * INTO v_job FROM public.event_cover_video_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF v_job.status='applied' THEN RETURN v_job; END IF;
 -- A NULL expected requester is the server (reaper) owner; a client caller
 -- always names itself and must be the requester of a private upload.
 IF v_job.status<>'ready' OR v_job.processed_url IS DISTINCT FROM p_expected_url OR v_job.application_version IS DISTINCT FROM p_expected_version
   OR (v_job.target_kind IN ('venue_draft','ad_creative') AND p_expected_requested_by IS NOT NULL
       AND v_job.requested_by IS DISTINCT FROM p_expected_requested_by) THEN RETURN v_job; END IF;
 IF v_job.target_kind='event' THEN
  UPDATE public.events SET cover_media_type='video',cover_media_url=v_job.processed_url,cover_media_poster_url=v_job.processed_poster_url,updated_at=now() WHERE id=v_job.event_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n=ROW_COUNT;
 ELSIF v_job.target_kind='brand' THEN
  UPDATE public.brands SET cover_media_type='video',cover_media_url=v_job.processed_url,cover_media_poster_url=v_job.processed_poster_url,updated_at=now() WHERE id=v_job.brand_id AND deleted_at IS NULL;
  GET DIAGNOSTICS n=ROW_COUNT;
 ELSIF v_job.target_kind IN ('venue','venue_draft','trip_day_media') THEN n:=1;
 ELSIF v_job.target_kind='ad_creative' THEN
  SELECT count(*) INTO n FROM public.ad_creatives WHERE source_job_id=v_job.id;
 ELSE n:=0; END IF;
 IF n<>1 THEN RETURN v_job; END IF;
 UPDATE public.event_cover_video_jobs SET status='applied',applied_at=coalesce(applied_at,now()),completed_at=coalesce(completed_at,now()),application_version=application_version+1,
  application_receipt=jsonb_build_object('processedUrl',processed_url,'appliedAt',now()) WHERE id=p_job_id AND status='ready' RETURNING * INTO v_job;
 RETURN v_job;
END $f$;

-- ── Step 9: reconcile claim rotates instead of starving. ─────────────────────
CREATE OR REPLACE FUNCTION public.cover_video_claim_reconcile_jobs(p_limit integer DEFAULT 100,p_lease_seconds integer DEFAULT 60)
RETURNS SETOF public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
BEGIN RETURN QUERY WITH c AS (
 SELECT id FROM public.event_cover_video_jobs WHERE
  ((status IN ('failed','cancelled','superseded','source_uploaded','processing_queued','processing','ready') AND source_asset_id IS NOT NULL)
   OR (status='source_uploading' AND provider_allocation_uncertain_at IS NOT NULL AND provider_allocation_identity=id::text))
  AND reaped_at IS NULL
  AND (reconcile_lease_until IS NULL OR reconcile_lease_until<now())
  ORDER BY CASE WHEN status IN ('failed','cancelled','superseded') THEN 0 ELSE 1 END,
    reconcile_attempted_at NULLS FIRST,created_at,id FOR UPDATE SKIP LOCKED LIMIT least(greatest(p_limit,1),1000))
 UPDATE public.event_cover_video_jobs j SET reconcile_lease_token=gen_random_uuid(),reconcile_lease_until=now()+make_interval(secs=>greatest(10,p_lease_seconds)),reconcile_attempted_at=now()
 FROM c WHERE j.id=c.id RETURNING j.*; END $f$;

-- ── Step 10: a replayed upload signature extends the server's transport lease. ─
CREATE OR REPLACE FUNCTION public.cover_video_extend_transport_lease(p_job_id uuid,p_expires_at timestamptz)
RETURNS public.event_cover_video_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE v public.event_cover_video_jobs;
BEGIN
 UPDATE public.event_cover_video_jobs
   SET tus_expires_at=greatest(tus_expires_at,p_expires_at),transport_lease_extended_at=now()
 WHERE id=p_job_id AND status='source_uploading' RETURNING * INTO v;
 RETURN v;
END $f$;

-- ── Step 11: live references to a provider asset. ────────────────────────────
-- MINGLA-INVARIANT: I-VIDEO-NO-DESTROY-WHILE-REFERENCED | issue #3040
-- p_exclude_job_id names the job whose own asset the caller is about to
-- reclaim, so that job is not counted as a reference to itself.
CREATE OR REPLACE FUNCTION public.cover_video_guid_live_references(p_guid text,p_exclude_job_id uuid DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE kinds text[] := ARRAY[]::text[]; needle text;
BEGIN
 IF p_guid IS NULL OR p_guid !~ '^[A-Za-z0-9-]{8,128}$' THEN
   RAISE EXCEPTION 'cover_video_guid_invalid';
 END IF;
 needle := '%/'||p_guid||'/%';
 IF EXISTS (SELECT 1 FROM public.events e WHERE e.deleted_at IS NULL AND (
      e.cover_media_url LIKE needle OR e.cover_media_poster_url LIKE needle
      OR e.cover_media_gallery::text LIKE needle OR e.theme::text LIKE needle)) THEN
   kinds := array_append(kinds,'event_cover');
 END IF;
 IF EXISTS (SELECT 1 FROM public.brands b WHERE b.deleted_at IS NULL AND (
      b.cover_media_url LIKE needle OR b.cover_media_poster_url LIKE needle)) THEN
   kinds := array_append(kinds,'brand_cover');
 END IF;
 IF EXISTS (SELECT 1 FROM public.venue_listings v WHERE v.cover_media_url LIKE needle) THEN
   kinds := array_append(kinds,'venue_cover');
 END IF;
 IF EXISTS (SELECT 1 FROM public.trip_days d JOIN public.events e ON e.id=d.event_id
      WHERE e.deleted_at IS NULL AND d.media::text LIKE needle) THEN
   kinds := array_append(kinds,'trip_day_media');
 END IF;
 IF EXISTS (SELECT 1 FROM public.ad_creatives c WHERE c.bunny_video_id=p_guid) THEN
   kinds := array_append(kinds,'ad_creative');
 END IF;
 IF EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
      WHERE j.source_asset_id=p_guid
        AND j.id IS DISTINCT FROM p_exclude_job_id
        AND j.status NOT IN ('failed','cancelled','superseded')) THEN
   kinds := array_append(kinds,'active_job');
 END IF;
 RETURN kinds;
END $f$;

-- ── Step 12: RLS read policy gains the ad_creative arm. ──────────────────────
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
        >= public.biz_role_rank('brand_admin')) OR
    (target_kind='ad_creative' AND requested_by=auth.uid() AND (
      (brand_id IS NULL AND public.is_admin_user()) OR
      (brand_id IS NOT NULL AND public.biz_brand_effective_rank_for_caller(brand_id)
        >= public.biz_role_rank('marketing_manager'))))
  );

-- ── Step 13: grants. ─────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ad_creatives_default_source() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ad_creatives_provenance_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_require_new_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_create_or_replay_job(uuid,uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,integer,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_transition_job(uuid,text[],text,integer,integer,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_apply_once(uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_claim_reconcile_jobs(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_extend_transport_lease(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_guid_live_references(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ad_creatives_default_source() TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_creatives_provenance_immutable() TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_require_new_identity() TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_create_or_replay_job(uuid,uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text,bigint,integer,integer,integer,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_transition_job(uuid,text[],text,integer,integer,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_apply_once(uuid,bigint,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_claim_reconcile_jobs(integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_extend_transport_lease(uuid,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_guid_live_references(text,uuid) TO service_role;

COMMENT ON FUNCTION public.cover_video_extend_transport_lease(uuid,timestamptz) IS
  'Issue #3040 a replayed intent hands out a fresh upload signature; the server lease only ever moves later to match it.';
COMMENT ON FUNCTION public.cover_video_guid_live_references(text,uuid) IS
  'Issue #3040 the live surfaces still serving a provider asset. A non-empty answer forbids destroying it.';
COMMENT ON CONSTRAINT event_cover_video_jobs_target_kind_check ON public.event_cover_video_jobs IS
  'Cover targets plus upload-only trip_day_media and ad_creative jobs that reuse the deterministic Bunny transport without mutating cover columns.';

-- ── Step 14: verify. ─────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.event_cover_video_jobs'::regclass
      AND conname='event_cover_video_jobs_target_kind_check'
      AND pg_get_constraintdef(oid) LIKE '%ad_creative%'
  ) THEN RAISE EXCEPTION 'issue #3040: ad_creative target kind missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.event_cover_video_jobs'::regclass
      AND conname='event_cover_video_jobs_processed_max_bytes'
      AND pg_get_constraintdef(oid) LIKE '%67108864%'
  ) THEN RAISE EXCEPTION 'issue #3040: processed byte cap is not 64 MiB'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ad_creatives'::regclass AND contype='f'
      AND confdeltype NOT IN ('n','c')
      AND confrelid IN ('public.event_cover_video_jobs'::regclass,'auth.users'::regclass,'public.brands'::regclass)
  ) THEN RAISE EXCEPTION 'issue #3040: an ad_creatives link can block job, brand or account deletion'; END IF;
  IF to_regprocedure('public.cover_video_guid_live_references(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue #3040: cover_video_guid_live_references missing';
  END IF;
  IF to_regprocedure('public.cover_video_extend_transport_lease(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'issue #3040: cover_video_extend_transport_lease missing';
  END IF;
  IF pg_get_functiondef('public.cover_video_require_new_identity()'::regprocedure) NOT LIKE '%TG_OP%' THEN
    RAISE EXCEPTION 'issue #3040: identity trigger still validates UPDATEs';
  END IF;
  IF EXISTS(
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema='public' AND routine_name LIKE 'cover_video_%' AND grantee IN ('anon','authenticated')
  ) THEN RAISE EXCEPTION 'issue #3040: privileged cover video RPC grant leaked'; END IF;
END $verify$;

COMMIT;
