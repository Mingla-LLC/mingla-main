-- Issue #3801 — a cover video the server applies to a DRAFT keeps the draft's
-- revision, so the host's open trip wizard is not told "This trip was changed
-- somewhere else" by the server's own apply.
--
-- Why: `events.updated_at` is the trip draft revision. `biz_apply_trip_draft_graph`
-- refuses a save whose expected revision differs (`trip_revision_conflict`).
-- `cover_video_apply_once` writes the processed video onto the event 18-42 s
-- after upload (webhook, apply endpoint or reaper), often while the host is
-- still in the wizard, and `trg_events_updated_at` (BEFORE UPDATE, every column,
-- shared `update_updated_at_column()`) moved the revision on that write. The
-- host's next save then carried the pre-apply revision and was refused.
--
-- Option A (decision on #3801): DRAFTS ONLY.
--   * Published events keep bumping on a cover apply: public search marks a
--     search_ready document stale from `events.updated_at`, and the sitemap
--     publishes it. Drafts are never in public search, and Publish moves
--     `updated_at` anyway.
--   * The shared `update_updated_at_column()` is NOT changed (brands and many
--     other tables use it). `events` gets its own trigger function, which
--     behaves exactly as before unless all three hold:
--       1. the transaction-local flag `mingla.cover_video_apply` is 'on'
--          (only `cover_video_apply_once` sets it, around its events UPDATE,
--          and only when the target row is a draft; it resets it to '' right
--          after, so no later UPDATE in the transaction inherits it);
--       2. OLD.status = 'draft' (the status every trip and event draft path
--          uses: biz_apply_trip_draft_graph raises trip_not_draft otherwise);
--       3. the only columns that changed are the cover columns
--          (cover_media_type, cover_media_url, cover_media_poster_url) and
--          updated_at itself. Anything else changing bumps as normal.
--
-- `cover_video_apply_once` is rebuilt from its latest definition
-- (20271108003040_issue_3040_video_lane_1080p_owners.sql, identical to
-- production on 2026-10-26) with only the flag set/reset added. Owner,
-- SECURITY DEFINER, search_path and grants are kept (it has no comment).
--
-- Applies after #4134's 20271231204134 (PT409). Neither function raises 40001.
--
-- MINGLA-INVARIANT: I-3801-DRAFT-COVER-APPLY-KEEPS-REVISION | issue #3801 | A cover video applied by cover_video_apply_once to a DRAFT event leaves events.updated_at unchanged; on a published event it still moves; any other change to a draft still moves it; the flag never outlives the apply's own UPDATE. Enforced by supabase/migrations/__tests__/issue_3801_draft_cover_video_keeps_revision.implementor.pg17.test.sql

BEGIN;

-- ── 1. events-only updated_at trigger function ──────────────────────────────
CREATE OR REPLACE FUNCTION public.events_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $f$
BEGIN
  IF pg_catalog.current_setting('mingla.cover_video_apply', true) = 'on' THEN
    IF OLD.status = 'draft' THEN
      IF (pg_catalog.to_jsonb(NEW) - ARRAY['cover_media_type','cover_media_url','cover_media_poster_url','updated_at'])
         = (pg_catalog.to_jsonb(OLD) - ARRAY['cover_media_type','cover_media_url','cover_media_poster_url','updated_at']) THEN
        NEW.updated_at := OLD.updated_at;
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END
$f$;

ALTER FUNCTION public.events_set_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.events_set_updated_at() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.events_set_updated_at() IS
  'Issue #3801 events-only updated_at trigger. Same as update_updated_at_column() except a cover-only change to a DRAFT made by cover_video_apply_once (transaction-local flag mingla.cover_video_apply = on) keeps OLD.updated_at.';

-- Repoint only the events trigger. update_updated_at_column() stays as it is
-- for brands and every other table.
CREATE OR REPLACE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_set_updated_at();

-- ── 2. cover_video_apply_once: flag the draft apply ─────────────────────────
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
 -- The server owner (NULL requester) re-checks, in the same statement that
 -- writes, that the cover still shows the baseline recorded at upload (or
 -- already shows this video): a host change landing after the reaper read the
 -- cover is never overwritten. A client caller and the draft_auto webhook keep
 -- their existing behaviour.
 IF v_job.target_kind='event' THEN
  -- Issue #3801 — a draft keeps its revision through this cover-only write
  -- (events_set_updated_at). The flag is local to this transaction and is
  -- reset right after the UPDATE.
  IF EXISTS (SELECT 1 FROM public.events WHERE id=v_job.event_id AND status='draft') THEN
   PERFORM pg_catalog.set_config('mingla.cover_video_apply','on',true);
  END IF;
  UPDATE public.events SET cover_media_type='video',cover_media_url=v_job.processed_url,cover_media_poster_url=v_job.processed_poster_url,updated_at=now() WHERE id=v_job.event_id AND deleted_at IS NULL
    AND (p_expected_requested_by IS NOT NULL OR v_job.apply_mode='draft_auto' OR NOT v_job.target_cover_base_captured
      OR cover_media_url IS NOT DISTINCT FROM v_job.target_cover_base_url OR cover_media_url IS NOT DISTINCT FROM v_job.processed_url);
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_catalog.set_config('mingla.cover_video_apply','',true);
 ELSIF v_job.target_kind='brand' THEN
  UPDATE public.brands SET cover_media_type='video',cover_media_url=v_job.processed_url,cover_media_poster_url=v_job.processed_poster_url,updated_at=now() WHERE id=v_job.brand_id AND deleted_at IS NULL
    AND (p_expected_requested_by IS NOT NULL OR v_job.apply_mode='draft_auto' OR NOT v_job.target_cover_base_captured
      OR cover_media_url IS NOT DISTINCT FROM v_job.target_cover_base_url OR cover_media_url IS NOT DISTINCT FROM v_job.processed_url);
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

ALTER FUNCTION public.cover_video_apply_once(uuid,bigint,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cover_video_apply_once(uuid,bigint,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cover_video_apply_once(uuid,bigint,text,uuid) TO service_role;

COMMIT;
