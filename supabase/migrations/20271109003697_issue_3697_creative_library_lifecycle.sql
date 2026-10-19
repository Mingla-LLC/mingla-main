-- Issue #3697: Creative Library lifecycle — archive, guarded permanent delete
-- and an immutable tombstone.
--
-- Removing a creative means archiving it: it stops appearing for NEW
-- campaigns, and every plan version already frozen with it keeps working.
-- "Delete permanently" removes the media file only when nothing references
-- it. The library row is never physically deleted: it becomes a tombstone
-- (purged_at set) that no library view shows, and an admin_audit_log row
-- records the deletion. Both are immutable.
--
-- Additive and backward compatible with the functions deployed before this
-- migration: new nullable columns, CHECKs that every existing row already
-- satisfies (no writer of status='archived' exists before this issue), new
-- service-role functions, and a same-signature redefinition of
-- cover_video_guid_live_references whose only change is that a tombstoned
-- creative no longer counts as a live reference.
--
-- Ad media must never block brand or account deletion (#3040/#3660): the new
-- actor links are ON DELETE SET NULL, and the tombstone trigger lets those
-- foreign-key actions clear a link (never set one).

BEGIN;

-- ── 1. Lifecycle columns. ─────────────────────────────────────────────────────
ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS purged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- No writer of status='archived' existed before this issue. Should a hand-set
-- archived row exist, give it an archive time so the consistency CHECK holds.
UPDATE public.ad_creatives
SET archived_at = coalesce(updated_at, created_at, now())
WHERE status = 'archived' AND archived_at IS NULL;

-- ── 2. Archive state is consistent. ───────────────────────────────────────────
ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_archive_consistent;
ALTER TABLE public.ad_creatives
  ADD CONSTRAINT ad_creatives_archive_consistent
    CHECK ((status = 'archived') = (archived_at IS NOT NULL)) NOT VALID;
ALTER TABLE public.ad_creatives VALIDATE CONSTRAINT ad_creatives_archive_consistent;

-- ── 3. Only an archived creative can be purged. ───────────────────────────────
ALTER TABLE public.ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_purge_requires_archive;
ALTER TABLE public.ad_creatives
  ADD CONSTRAINT ad_creatives_purge_requires_archive
    CHECK (purged_at IS NULL OR status = 'archived') NOT VALID;
ALTER TABLE public.ad_creatives VALIDATE CONSTRAINT ad_creatives_purge_requires_archive;

-- ── 3a. Rows are never deleted; a tombstone never changes. ────────────────────
-- Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
-- A tombstone may only lose a link through a foreign key's ON DELETE SET NULL
-- (a deleted brand, place, account or lane job). Everything else is frozen.
CREATE OR REPLACE FUNCTION public.ad_creatives_tombstone_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
DECLARE
  v_links constant text[] := ARRAY['brand_id','place_id','created_by','source_job_id','archived_by','purged_by'];
  v_old jsonb;
  v_new jsonb;
  v_col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ad_creative_tombstone_immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.purged_at IS NULL THEN
    RETURN NEW;
  END IF;
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  IF (v_old - v_links - 'updated_at') IS DISTINCT FROM (v_new - v_links - 'updated_at') THEN
    RAISE EXCEPTION 'ad_creative_tombstone_immutable' USING ERRCODE = '55000';
  END IF;
  FOREACH v_col IN ARRAY v_links LOOP
    IF (v_new -> v_col) IS DISTINCT FROM (v_old -> v_col)
       AND jsonb_typeof(v_new -> v_col) IS DISTINCT FROM 'null' THEN
      RAISE EXCEPTION 'ad_creative_tombstone_immutable' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_ad_creatives_tombstone_immutable ON public.ad_creatives;
CREATE TRIGGER trg_ad_creatives_tombstone_immutable
  BEFORE UPDATE OR DELETE ON public.ad_creatives
  FOR EACH ROW EXECUTE FUNCTION public.ad_creatives_tombstone_immutable();

-- ── 3b. The purge audit row is immutable. Other audit rows are unchanged. ─────
CREATE OR REPLACE FUNCTION public.admin_audit_log_purge_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $f$
BEGIN
  RAISE EXCEPTION 'ad_creative_purge_audit_immutable' USING ERRCODE = '55000';
END $f$;
DROP TRIGGER IF EXISTS trg_admin_audit_log_purge_immutable ON public.admin_audit_log;
CREATE TRIGGER trg_admin_audit_log_purge_immutable
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW WHEN (OLD.action = 'ad_creative_purge')
  EXECUTE FUNCTION public.admin_audit_log_purge_immutable();

-- ── 6 (ordered first: step 4 calls it). Live references skip tombstones. ──────
-- Same signature and body as 20271108003040 step 11; the ad_creative arm now
-- ignores a tombstoned creative (its media is gone).
-- Invariant I-VIDEO-NO-DESTROY-WHILE-REFERENCED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_orphan_reclaim.test.ts)
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
 IF EXISTS (SELECT 1 FROM public.ad_creatives c WHERE c.bunny_video_id=p_guid AND c.purged_at IS NULL) THEN
   kinds := array_append(kinds,'ad_creative');
 END IF;
 -- A venue-draft video that reached ready was handed to the host's device and
 -- lives in a local draft no table can see. It is client-owned and kept, so
 -- its own job counts too (p_exclude_job_id does not apply to this arm).
 -- Invariant I-VENUE-DRAFT-VIDEO-RETAINED (declared in supabase/functions/event-cover-video-reaper/__tests__/issue_3040_venue_draft_retained.test.ts)
 IF EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
      WHERE j.source_asset_id=p_guid AND j.target_kind='venue_draft'
        AND j.processed_url IS NOT NULL) THEN
   kinds := array_append(kinds,'venue_draft');
 END IF;
 IF EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
      WHERE j.source_asset_id=p_guid
        AND j.id IS DISTINCT FROM p_exclude_job_id
        AND j.status NOT IN ('failed','cancelled','superseded')) THEN
   kinds := array_append(kinds,'active_job');
 END IF;
 RETURN kinds;
END $f$;

-- ── 4. What stops a permanent delete. Empty means it may proceed. ─────────────
-- Order matters: the Admin menu shows the reason for the first blocker.
CREATE OR REPLACE FUNCTION public.ad_creative_purge_blockers(p_creative_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE
  c public.ad_creatives;
  b text[] := ARRAY[]::text[];
  v_versions uuid[];
  v_live text[];
BEGIN
  SELECT * INTO c FROM public.ad_creatives WHERE id = p_creative_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_creative_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.purged_at IS NOT NULL THEN b := array_append(b, 'already_purged'); END IF;
  IF c.status <> 'archived' THEN b := array_append(b, 'not_archived'); END IF;
  IF c.kind <> 'video' OR c.bunny_video_id IS NULL THEN b := array_append(b, 'not_video'); END IF;

  SELECT array_agg(v.id) INTO v_versions
  FROM public.ad_plan_versions v
  WHERE v.canonical_plan->>'creative_library_id' = p_creative_id::text;
  IF (v_versions IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.ad_campaigns ac WHERE ac.plan_version_id = ANY(v_versions)))
     OR EXISTS (SELECT 1 FROM public.ads a WHERE a.creative_id = p_creative_id) THEN
    b := array_append(b, 'campaign');
  END IF;
  IF v_versions IS NOT NULL THEN b := array_append(b, 'plan_version'); END IF;

  IF EXISTS (SELECT 1 FROM public.ad_creative_platform_refs r WHERE r.creative_id = p_creative_id) THEN
    b := array_append(b, 'platform_ref');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ad_status_events e
    JOIN public.ad_creative_platform_refs r ON r.id = e.creative_ref_id
    WHERE r.creative_id = p_creative_id
  ) THEN
    b := array_append(b, 'status_event');
  END IF;

  IF c.bunny_video_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ad_creatives o
    WHERE o.id <> c.id AND o.bunny_video_id = c.bunny_video_id AND o.purged_at IS NULL
  ) THEN
    b := array_append(b, 'duplicate_creative');
  END IF;

  IF c.bunny_video_id IS NOT NULL THEN
    IF c.bunny_video_id ~ '^[A-Za-z0-9-]{8,128}$' THEN
      v_live := array_remove(
        public.cover_video_guid_live_references(c.bunny_video_id, coalesce(c.source_job_id, c.source_job_ref)),
        'ad_creative'
      );
      IF cardinality(v_live) > 0 THEN b := array_append(b, 'live_surface'); END IF;
    ELSE
      -- A reference that cannot be checked is treated as live (fail closed).
      b := array_append(b, 'live_surface');
    END IF;
  END IF;

  -- Host-owned media stays under the host-media Terms hold.
  IF c.source IS DISTINCT FROM 'admin_upload' THEN b := array_append(b, 'legal_hold'); END IF;
  RETURN b;
END $f$;

-- ── 5. Archive and restore (idempotent). ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ad_creative_set_archived(p_creative_id uuid, p_archived boolean, p_actor uuid)
RETURNS public.ad_creatives LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE c public.ad_creatives;
BEGIN
  IF p_archived IS NULL THEN
    RAISE EXCEPTION 'ad_creative_archive_flag_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.ad_creatives WHERE id = p_creative_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_creative_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'ad_creative_purged' USING ERRCODE = '55000';
  END IF;
  IF (p_archived AND c.status = 'archived') OR (NOT p_archived AND c.status = 'active') THEN
    RETURN c;
  END IF;
  UPDATE public.ad_creatives
  SET status = CASE WHEN p_archived THEN 'archived' ELSE 'active' END,
      archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
      archived_by = CASE WHEN p_archived THEN p_actor ELSE NULL END
  WHERE id = p_creative_id
  RETURNING * INTO c;
  RETURN c;
END $f$;

-- ── 5b. Record a permanent delete. ─────────────────────────────────────────
-- Re-checks every blocker under the row lock (the server-side re-check at
-- delete time), then tombstones the row and writes the immutable audit row in
-- one transaction. Only after this does the caller destroy the media file,
-- through the one guarded provider delete (which also stamps the source job
-- reaped): once tombstoned, the creative no longer counts as a live reference
-- to its own file. A replay returns the tombstone unchanged.
CREATE OR REPLACE FUNCTION public.ad_creative_record_purge(
  p_creative_id uuid,
  p_actor uuid,
  p_admin_email text,
  p_blockers_checked_at timestamptz
) RETURNS public.ad_creatives LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $f$
DECLARE
  c public.ad_creatives;
  v_job uuid;
  v_blockers text[];
BEGIN
  IF p_admin_email IS NULL OR length(btrim(p_admin_email)) = 0 THEN
    RAISE EXCEPTION 'ad_creative_purge_actor_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.ad_creatives WHERE id = p_creative_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_creative_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.purged_at IS NOT NULL THEN
    RETURN c;
  END IF;
  v_blockers := public.ad_creative_purge_blockers(p_creative_id);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'ad_creative_purge_blocked:%', array_to_string(v_blockers, ',')
      USING ERRCODE = '55000';
  END IF;
  v_job := coalesce(c.source_job_id, c.source_job_ref);
  UPDATE public.ad_creatives
  SET purged_at = now(), purged_by = p_actor
  WHERE id = p_creative_id
  RETURNING * INTO c;
  INSERT INTO public.admin_audit_log(admin_email, action, target_type, target_id, metadata, actor_uid)
  VALUES (
    p_admin_email,
    'ad_creative_purge',
    'ad_creative',
    c.id::text,
    jsonb_build_object(
      'bunny_video_id', c.bunny_video_id,
      'source_job_id', v_job,
      'name', c.name,
      'content_hash', c.content_hash,
      'blockers_checked_at', p_blockers_checked_at
    ),
    p_actor
  );
  RETURN c;
END $f$;

-- ── 7. Grants and comments. ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.ad_creatives_tombstone_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_audit_log_purge_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cover_video_guid_live_references(text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ad_creative_purge_blockers(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ad_creative_set_archived(uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ad_creative_record_purge(uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ad_creatives_tombstone_immutable() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_audit_log_purge_immutable() TO service_role;
GRANT EXECUTE ON FUNCTION public.cover_video_guid_live_references(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_creative_purge_blockers(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_creative_set_archived(uuid,boolean,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_creative_record_purge(uuid,uuid,text,timestamptz) TO service_role;

COMMENT ON COLUMN public.ad_creatives.archived_at IS
  'Issue #3697 set while the creative is archived: hidden from new campaigns; frozen plan versions keep using it.';
COMMENT ON COLUMN public.ad_creatives.purged_at IS
  'Issue #3697 the media file was permanently deleted. The row stays as an immutable tombstone hidden from every library view.';
COMMENT ON FUNCTION public.ad_creative_purge_blockers(uuid) IS
  'Issue #3697 every reason a creative''s media file cannot be permanently deleted. Empty means the delete may proceed.';
COMMENT ON FUNCTION public.ad_creative_set_archived(uuid,boolean,uuid) IS
  'Issue #3697 archive or restore a creative. Idempotent; refuses a tombstone.';
COMMENT ON FUNCTION public.ad_creative_record_purge(uuid,uuid,text,timestamptz) IS
  'Issue #3697 re-check every blocker under the row lock, then tombstone the creative and write the immutable audit row. The media file is destroyed afterwards through the guarded provider delete.';
COMMENT ON FUNCTION public.cover_video_guid_live_references(text,uuid) IS
  'Issue #3040 the live surfaces still serving a provider asset. A non-empty answer forbids destroying it. A tombstoned creative is not a reference (#3697).';

-- ── 7b. Verify. ───────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ad_creatives'::regclass AND conname='ad_creatives_archive_consistent' AND convalidated
  ) THEN RAISE EXCEPTION 'issue #3697: archive consistency check missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ad_creatives'::regclass AND conname='ad_creatives_purge_requires_archive' AND convalidated
  ) THEN RAISE EXCEPTION 'issue #3697: purge-requires-archive check missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.ad_creatives'::regclass AND tgname='trg_ad_creatives_tombstone_immutable'
  ) THEN RAISE EXCEPTION 'issue #3697: tombstone trigger missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.admin_audit_log'::regclass AND tgname='trg_admin_audit_log_purge_immutable'
  ) THEN RAISE EXCEPTION 'issue #3697: purge audit trigger missing'; END IF;
  IF to_regprocedure('public.ad_creative_purge_blockers(uuid)') IS NULL
     OR to_regprocedure('public.ad_creative_set_archived(uuid,boolean,uuid)') IS NULL
     OR to_regprocedure('public.ad_creative_record_purge(uuid,uuid,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'issue #3697: lifecycle functions missing';
  END IF;
  IF pg_get_functiondef('public.cover_video_guid_live_references(text,uuid)'::regprocedure) NOT LIKE '%purged_at IS NULL%' THEN
    RAISE EXCEPTION 'issue #3697: live references still count tombstones';
  END IF;
  -- #3040: no ad_creatives link may block job, brand or account deletion.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.ad_creatives'::regclass AND contype='f'
      AND confdeltype NOT IN ('n','c')
      AND confrelid IN ('public.event_cover_video_jobs'::regclass,'auth.users'::regclass,'public.brands'::regclass)
  ) THEN RAISE EXCEPTION 'issue #3697: an ad_creatives link can block job, brand or account deletion'; END IF;
END
$verify$;

COMMIT;
