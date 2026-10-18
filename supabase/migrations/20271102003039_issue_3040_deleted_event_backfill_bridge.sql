-- Issue #3040: let the one-minute clock backfill touch terminal jobs whose
-- event was deleted after the job completed, without weakening job identity.
--
-- Production has historical applied/cancelled/failed rows whose event is now
-- soft-deleted. The normal identity trigger deliberately treats those events
-- as unavailable, so any UPDATE fails even when it changes only an operational
-- timestamp. Migration 20271102003040 performs exactly such a backfill.
--
-- The bridge allows only the exact NULL -> authoritative-clock update issued by
-- the following migration. Every other field must be unchanged (updated_at is
-- owned by its existing BEFORE trigger). Inserts and all other updates still
-- require a live event/venue with the exact brand. The following migration
-- recreates the canonical strict function after its one bounded backfill, so
-- this bridge has no lasting runtime relaxation.

BEGIN;

CREATE OR REPLACE FUNCTION public.cover_video_require_new_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
DECLARE v_brand_id uuid;
BEGIN
  IF TG_OP='UPDATE'
    AND OLD.status IN ('source_uploaded','processing_queued','processing','ready','applied')
    AND (to_jsonb(OLD)->>'source_uploaded_at') IS NULL
    AND (to_jsonb(NEW)->>'source_uploaded_at')::timestamptz
        IS NOT DISTINCT FROM coalesce(OLD.provider_checked_at,OLD.updated_at,OLD.created_at)
    AND (to_jsonb(NEW)-ARRAY['source_uploaded_at','updated_at']::text[])
        IS NOT DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['source_uploaded_at','updated_at']::text[])
  THEN
    RETURN NEW;
  END IF;

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

REVOKE ALL ON FUNCTION public.cover_video_require_new_identity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cover_video_require_new_identity() TO service_role;

COMMIT;
