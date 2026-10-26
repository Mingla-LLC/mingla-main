-- Issue #4114 Wave 7: chat media thumbnails, albums, the daily upload
-- allowance (D17), video retention (D18) and the storage early warning.
--
-- What changes:
--   * Thumbnails. The phone uploads a 480px JPEG next to each ordinary photo
--     and video, named <conversation_id>/<uuid>_thumb.jpg where <uuid> is the
--     message's own object id. `issue_4114_chat_attachment_conversation` now
--     accepts exactly that sibling name, never under once/. A message stores it
--     in `messages.thumb_path`; the message trigger requires it to be the
--     sibling of the message's own file_url, in its own conversation, on an
--     ordinary (never view-once) photo or video. A file_url can never point at
--     a thumbnail. Storage read rules (participants; brand team of an event
--     chat) and the orphan sweep now know thumbnails.
--   * Media facts on the message: `media_duration_ms`, `media_width`,
--     `media_height` (for the card's aspect ratio) and `media_album_id` (photos
--     sent together share one id and the thread draws them as one album).
--   * D18 retention. The hourly media sweep (open-view-once, action "sweep")
--     also deletes the full object of an ordinary chat video 90 days after it
--     was sent, keeps its thumbnail, and stamps `messages.media_expired_at`
--     (server-owned: no client can set, change or clear it). Photos are kept.
--   * D17 allowance. A BEFORE INSERT trigger on storage.objects refuses a
--     message-attachments upload once the uploader (`owner`) has stored more
--     than 200 MB in the last 24 hours, counting `metadata->>'size'` of their
--     objects. The Storage API inserts each object twice: a permission test as
--     the user (no metadata yet, rolled back) and the final row as the service
--     with the object's metadata (size included). The first is refused once the
--     person is already at the limit (before any bytes move), the second when
--     this file would take them past it. The error text is
--     `chat_media_daily_limit`. `issue_4114_chat_media_quota()` lets the app
--     check before uploading and explain a refusal.
--   * Early warning. `issue_4114_chat_media_storage_due` sums the bucket and
--     names each threshold (5, 10, 20 GB) it has passed that has not been
--     alerted yet; `issue_4114_chat_media_storage_mark_alerted` records the
--     alert, so each threshold alerts once. The daily tick of api-health-probe
--     calls them and sends through the existing ops alert email.
--
-- Idempotent: every statement can run twice.

BEGIN;

-- 1. Message columns.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS thumb_path text NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_duration_ms integer NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_width integer NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_height integer NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_album_id uuid NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_expired_at timestamptz NULL;

DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_media_facts_range'
                 AND conrelid = 'public.messages'::regclass) THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_media_facts_range CHECK (
      (media_duration_ms IS NULL OR media_duration_ms BETWEEN 0 AND 3600000)
      AND (media_width IS NULL OR media_width BETWEEN 1 AND 20000)
      AND (media_height IS NULL OR media_height BETWEEN 1 AND 20000)
    );
  END IF;
END
$checks$;

COMMENT ON COLUMN public.messages.thumb_path IS
  'Issue #4114 Wave 7: the 480px JPEG thumbnail of an ordinary photo or video, <conversation_id>/<uuid>_thumb.jpg next to file_url. Never set on view once. NULL for older messages (they show the full file).';
COMMENT ON COLUMN public.messages.media_duration_ms IS 'Issue #4114 Wave 7: a video''s length.';
COMMENT ON COLUMN public.messages.media_width IS 'Issue #4114 Wave 7: the photo or video width, for the card''s aspect ratio.';
COMMENT ON COLUMN public.messages.media_height IS 'Issue #4114 Wave 7: the photo or video height, for the card''s aspect ratio.';
COMMENT ON COLUMN public.messages.media_album_id IS
  'Issue #4114 Wave 7: photos sent together share this id; the thread draws them as one album.';
COMMENT ON COLUMN public.messages.media_expired_at IS
  'Issue #4114 Wave 7 (D18): when the sweep deleted this video''s full file (90 days after it was sent). The thumbnail stays. Server-owned.';

CREATE INDEX IF NOT EXISTS messages_thumb_path_idx
  ON public.messages (thumb_path)
  WHERE thumb_path IS NOT NULL;
-- The retention sweep's scan: ordinary videos still holding their full file.
CREATE INDEX IF NOT EXISTS messages_video_retention_idx
  ON public.messages (created_at)
  WHERE message_type = 'video' AND NOT view_once AND media_expired_at IS NULL AND file_url IS NOT NULL;

-- 2. Canonical names: the attachment shapes plus exactly one thumbnail shape.
CREATE OR REPLACE FUNCTION public.issue_4114_chat_attachment_conversation(p_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_name IS NULL OR p_name !~
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/((once/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_thumb\.jpg)$' THEN
    RETURN NULL;
  END IF;
  RETURN split_part(p_name, '/', 1)::uuid;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_attachment_conversation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_attachment_conversation(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_is_chat_thumb_path(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT p_name IS NOT NULL AND p_name ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_thumb\.jpg$';
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_is_chat_thumb_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_is_chat_thumb_path(text) TO authenticated, service_role;

-- The only thumbnail name an ordinary attachment can have:
-- <conversation_id>/<uuid>.<ext>  ->  <conversation_id>/<uuid>_thumb.jpg
CREATE OR REPLACE FUNCTION public.issue_4114_chat_thumb_sibling(p_file_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_file_url ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'
      THEN regexp_replace(p_file_url, '\.[a-z0-9]{1,8}$', '') || '_thumb.jpg'
    ELSE NULL
  END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_thumb_sibling(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_thumb_sibling(text) TO authenticated, service_role;

-- 3. Message paths (20271230034114 section 3, plus thumbnails and the
--    server-owned media_expired_at).
CREATE OR REPLACE FUNCTION public.issue_4114_enforce_view_once_shape()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_path_conversation uuid;
  v_is_path boolean := NEW.file_url IS NOT NULL AND NOT (NEW.file_url ~* '^https?://');
  v_client boolean := COALESCE(auth.role(), '') IN ('authenticated', 'anon');
BEGIN
  -- Server-owned send time and final purges (clients only; migrations and
  -- service code keep theirs).
  IF v_client THEN
    IF TG_OP = 'INSERT' THEN
      -- clock_timestamp(), not now(): two messages written in one transaction
      -- (#4111's enquiry RPCs stamp clock_timestamp() for thread order) keep
      -- their order instead of sharing the transaction's start time.
      NEW.created_at := clock_timestamp();
      IF NEW.view_once_purged_at IS NOT NULL THEN
        RAISE EXCEPTION 'view_once_purge_is_server_owned' USING ERRCODE = '23514';
      END IF;
      IF NEW.media_expired_at IS NOT NULL THEN
        RAISE EXCEPTION 'media_expiry_is_server_owned' USING ERRCODE = '23514';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'message_created_at_is_server_owned' USING ERRCODE = '23514';
      END IF;
      IF NEW.view_once_purged_at IS DISTINCT FROM OLD.view_once_purged_at THEN
        IF OLD.view_once_purged_at IS NOT NULL THEN
          RAISE EXCEPTION 'view_once_purge_is_final' USING ERRCODE = '23514';
        END IF;
        RAISE EXCEPTION 'view_once_purge_is_server_owned' USING ERRCODE = '23514';
      END IF;
      IF OLD.view_once_purged_at IS NOT NULL
         AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        RAISE EXCEPTION 'view_once_purge_is_final' USING ERRCODE = '23514';
      END IF;
      IF NEW.media_expired_at IS DISTINCT FROM OLD.media_expired_at THEN
        RAISE EXCEPTION 'media_expiry_is_server_owned' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- An update that leaves the path columns alone (an unsend, a purge mark, an
  -- expiry mark, an edit) is not re-checked.
  IF TG_OP = 'UPDATE'
     AND NEW.view_once IS NOT DISTINCT FROM OLD.view_once
     AND NEW.file_url IS NOT DISTINCT FROM OLD.file_url
     AND NEW.thumb_path IS NOT DISTINCT FROM OLD.thumb_path
     AND NEW.message_type IS NOT DISTINCT FROM OLD.message_type
     AND NEW.conversation_id IS NOT DISTINCT FROM OLD.conversation_id
     AND NEW.sender_id IS NOT DISTINCT FROM OLD.sender_id THEN
    RETURN NEW;
  END IF;

  IF v_is_path THEN
    v_path_conversation := public.issue_4114_chat_attachment_conversation(NEW.file_url);
    -- A message's own file is never a thumbnail name.
    IF v_path_conversation IS NULL OR public.issue_4114_is_chat_thumb_path(NEW.file_url) THEN
      RAISE EXCEPTION 'attachment_path_not_canonical' USING ERRCODE = '23514';
    END IF;
    IF v_path_conversation IS DISTINCT FROM NEW.conversation_id THEN
      RAISE EXCEPTION 'attachment_path_outside_conversation' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.file_url = NEW.file_url
        AND m.id IS DISTINCT FROM NEW.id
        AND m.sender_id IS DISTINCT FROM NEW.sender_id
    ) THEN
      RAISE EXCEPTION 'attachment_path_in_use' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.view_once IS TRUE THEN
    IF NEW.message_type IS DISTINCT FROM 'image' AND NEW.message_type IS DISTINCT FROM 'video' THEN
      RAISE EXCEPTION 'view_once_requires_photo_or_video' USING ERRCODE = '23514';
    END IF;
    IF NOT v_is_path OR split_part(NEW.file_url, '/', 2) IS DISTINCT FROM 'once' THEN
      RAISE EXCEPTION 'view_once_requires_once_folder' USING ERRCODE = '23514';
    END IF;
    -- View once never has a thumbnail (the private placeholder stays as designed).
    IF NEW.thumb_path IS NOT NULL THEN
      RAISE EXCEPTION 'view_once_never_has_thumbnail' USING ERRCODE = '23514';
    END IF;
  ELSIF v_is_path AND split_part(NEW.file_url, '/', 2) = 'once' THEN
    RAISE EXCEPTION 'once_folder_requires_view_once' USING ERRCODE = '23514';
  END IF;

  -- A thumbnail is exactly the sibling of the message's own file, in its own
  -- conversation folder, on an ordinary photo or video.
  IF NEW.thumb_path IS NOT NULL THEN
    IF NEW.message_type IS DISTINCT FROM 'image' AND NEW.message_type IS DISTINCT FROM 'video' THEN
      RAISE EXCEPTION 'thumbnail_requires_photo_or_video' USING ERRCODE = '23514';
    END IF;
    IF NOT public.issue_4114_is_chat_thumb_path(NEW.thumb_path)
       OR public.issue_4114_chat_attachment_conversation(NEW.thumb_path) IS DISTINCT FROM NEW.conversation_id THEN
      RAISE EXCEPTION 'thumbnail_path_not_canonical' USING ERRCODE = '23514';
    END IF;
    IF NOT v_is_path OR public.issue_4114_chat_thumb_sibling(NEW.file_url) IS DISTINCT FROM NEW.thumb_path THEN
      RAISE EXCEPTION 'thumbnail_path_not_sibling' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- Legacy public-bucket URLs (old messages) pass through untouched.
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_enforce_view_once_shape() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4114_view_once_shape ON public.messages;
CREATE TRIGGER issue_4114_view_once_shape
  BEFORE INSERT OR UPDATE OF view_once, file_url, thumb_path, message_type, conversation_id, sender_id, created_at, deleted_at, view_once_purged_at, media_expired_at ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.issue_4114_enforce_view_once_shape();

-- 4. Storage read (20271230034114 section 5, thumbnails included). A thumbnail
--    is read on the same terms as its message's file: by the conversation's
--    participants, and by the brand team of an event chat for a live, ordinary
--    message. once/ objects stay uploader-only.
CREATE OR REPLACE FUNCTION public.issue_4114_can_read_chat_attachment(p_name text, p_owner uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation uuid := public.issue_4114_chat_attachment_conversation(p_name);
  v_once boolean;
BEGIN
  IF p_user_id IS NULL OR v_conversation IS NULL THEN
    RETURN false;
  END IF;
  v_once := split_part(p_name, '/', 2) = 'once';

  IF public.is_message_conversation_participant(v_conversation, p_user_id) THEN
    IF p_owner IS NOT NULL AND p_owner = p_user_id THEN
      RETURN true;
    END IF;
    IF v_once THEN
      RETURN false;
    END IF;
    RETURN NOT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE (m.file_url = p_name OR m.thumb_path = p_name)
        AND m.view_once
    );
  END IF;

  IF v_once THEN
    RETURN false;
  END IF;
  IF NOT public.issue_4114_is_event_chat_team_member(v_conversation, p_user_id) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.messages m
    WHERE (m.file_url = p_name OR m.thumb_path = p_name)
      AND m.conversation_id = v_conversation
      AND m.deleted_at IS NULL
      AND NOT m.view_once
  ) AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE (m.file_url = p_name OR m.thumb_path = p_name)
      AND m.view_once
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_can_read_chat_attachment(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_can_read_chat_attachment(text, uuid, uuid) TO authenticated, service_role;

-- 5. Cleanup (20271230034114 section 6, plus D18 and thumbnails).
--    reason: 'opened' | 'expired' | 'unsent'  view once, as before
--            'video_retention'  an ordinary chat video's full file, 90 days
--                               after it was sent (its thumbnail is kept)
--            'orphan'           an object no message points at (neither as its
--                               file nor as its thumbnail), older than 2 days
--    #4114 QA run 2 (grace): an opened or expired view-once item is NOT listed
--    while any recipient's first view of it is under 5 minutes old. After the
--    first open the recipient may re-sign the link for 2 minutes (a failed
--    load retries once); deleting the object inside that window broke the
--    open. 5 minutes covers the window with margin. An unsent item is still
--    listed at once (the sender withdrew it; open-view-once refuses it).
CREATE OR REPLACE FUNCTION public.issue_4114_view_once_media_due(
  p_limit integer DEFAULT 200,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (message_id uuid, storage_path text, reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000));
BEGIN
  RETURN QUERY
  WITH once AS (
    SELECT m.id, m.file_url, m.created_at, m.deleted_at, m.conversation_id, m.sender_id
    FROM public.messages m
    WHERE m.view_once
      AND m.view_once_purged_at IS NULL
      AND m.file_url IS NOT NULL
      AND public.issue_4114_chat_attachment_conversation(m.file_url) = m.conversation_id
      AND split_part(m.file_url, '/', 2) = 'once'
  ),
  classified AS (
    SELECT o.id, o.file_url,
      CASE
        WHEN o.deleted_at IS NOT NULL THEN 'unsent'
        WHEN EXISTS (
          SELECT 1 FROM public.message_media_views rv
          WHERE rv.message_id = o.id
            AND rv.viewed_at > p_now - interval '5 minutes'
        ) THEN NULL
        WHEN o.created_at < p_now - interval '14 days' THEN 'expired'
        WHEN NOT EXISTS (
          SELECT 1 FROM public.conversation_participants cp
          WHERE cp.conversation_id = o.conversation_id
            AND cp.user_id IS DISTINCT FROM o.sender_id
            AND (cp.joined_at IS NULL OR cp.joined_at <= o.created_at)
            AND NOT EXISTS (
              SELECT 1 FROM public.message_media_views v
              WHERE v.message_id = o.id AND v.user_id = cp.user_id
            )
        ) THEN 'opened'
        ELSE NULL
      END AS why,
      o.created_at
    FROM once o
  )
  SELECT c.id, c.file_url, c.why
  FROM classified c
  WHERE c.why IS NOT NULL
  ORDER BY c.created_at
  LIMIT v_limit;

  -- D18: ordinary chat videos, 90 days after they were sent. Only a canonical
  -- non-once, non-thumbnail path in the message's own conversation folder is
  -- ever handed to the deleter; the thumbnail is a different object and stays.
  RETURN QUERY
  SELECT m.id, m.file_url, 'video_retention'::text
  FROM public.messages m
  WHERE m.message_type = 'video'
    AND NOT m.view_once
    AND m.media_expired_at IS NULL
    AND m.file_url IS NOT NULL
    AND m.created_at < p_now - interval '90 days'
    AND public.issue_4114_chat_attachment_conversation(m.file_url) = m.conversation_id
    AND split_part(m.file_url, '/', 2) <> 'once'
    AND NOT public.issue_4114_is_chat_thumb_path(m.file_url)
  ORDER BY m.created_at
  LIMIT v_limit;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    RETURN QUERY
    SELECT NULL::uuid, o.name, 'orphan'::text
    FROM storage.objects o
    WHERE o.bucket_id = 'message-attachments'
      AND public.issue_4114_chat_attachment_conversation(o.name) IS NOT NULL
      AND o.created_at < p_now - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.file_url = o.name)
      AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.thumb_path = o.name)
    ORDER BY o.created_at
    LIMIT v_limit;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_view_once_media_due(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_view_once_media_due(integer, timestamptz) TO service_role;

-- Marks the videos whose full file the sweep deleted. Idempotent: the first
-- mark's time is kept.
CREATE OR REPLACE FUNCTION public.issue_4114_mark_media_expired(p_message_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.messages
     SET media_expired_at = now()
   WHERE id = ANY(COALESCE(p_message_ids, ARRAY[]::uuid[]))
     AND message_type = 'video'
     AND NOT view_once
     AND media_expired_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_mark_media_expired(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_mark_media_expired(uuid[]) TO service_role;

-- 6. D17: 200 MB of chat photos and videos per person per rolling 24 hours.
CREATE OR REPLACE FUNCTION public.issue_4114_chat_media_daily_limit_bytes()
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT 209715200::bigint; -- 200 MB (decision D17)
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_media_daily_limit_bytes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_media_daily_limit_bytes() TO authenticated, service_role;

-- What one person stored in message-attachments in the 24 hours before p_now.
CREATE OR REPLACE FUNCTION public.issue_4114_chat_media_bytes_last_24h(p_owner uuid, p_now timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_total bigint;
BEGIN
  IF p_owner IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RETURN 0;
  END IF;
  EXECUTE $q$
    SELECT COALESCE(SUM(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$'
                             THEN (o.metadata->>'size')::bigint ELSE 0 END), 0)
    FROM storage.objects o
    WHERE o.bucket_id = 'message-attachments'
      AND o.owner = $1
      AND o.created_at > $2 - interval '24 hours'
  $q$ INTO v_total USING p_owner, p_now;
  RETURN v_total;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_media_bytes_last_24h(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_media_bytes_last_24h(uuid, timestamptz) TO service_role;

-- The signed-in person's allowance (the app checks before uploading and uses
-- it to explain a refused upload).
CREATE OR REPLACE FUNCTION public.issue_4114_chat_media_quota()
RETURNS TABLE (used_bytes bigint, limit_bytes bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT public.issue_4114_chat_media_bytes_last_24h(auth.uid(), now()),
                      public.issue_4114_chat_media_daily_limit_bytes();
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_media_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_media_quota() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_enforce_chat_media_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_size bigint;
  v_used bigint;
  v_limit bigint := public.issue_4114_chat_media_daily_limit_bytes();
BEGIN
  IF NEW.bucket_id IS DISTINCT FROM 'message-attachments' OR NEW.owner IS NULL THEN
    RETURN NEW;
  END IF;
  -- A retry of an object that is already stored is not a new upload (the
  -- unique name refuses it as a duplicate, which the app counts as done).
  IF EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = NEW.bucket_id AND o.name = NEW.name) THEN
    RETURN NEW;
  END IF;
  -- One person's uploads are counted one at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4114_chat_media_daily:' || NEW.owner::text, 0));
  v_size := CASE WHEN NEW.metadata->>'size' ~ '^[0-9]{1,15}$' THEN (NEW.metadata->>'size')::bigint ELSE 0 END;
  v_used := public.issue_4114_chat_media_bytes_last_24h(NEW.owner, now());
  IF v_used >= v_limit OR v_used + v_size > v_limit THEN
    RAISE EXCEPTION 'chat_media_daily_limit'
      USING ERRCODE = 'P0001',
            DETAIL = format('used %s of %s bytes in the last 24 hours', v_used, v_limit),
            HINT = 'You''ve reached today''s limit for photos and videos.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_enforce_chat_media_daily_limit() FROM PUBLIC, anon, authenticated;

DO $daily$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE '#4114: storage.objects unavailable; chat media daily limit not installed';
    RETURN;
  END IF;
  EXECUTE 'DROP TRIGGER IF EXISTS issue_4114_chat_media_daily_limit ON storage.objects';
  EXECUTE $t$
    CREATE TRIGGER issue_4114_chat_media_daily_limit
      BEFORE INSERT ON storage.objects
      FOR EACH ROW
      WHEN (NEW.bucket_id = 'message-attachments')
      EXECUTE FUNCTION public.issue_4114_enforce_chat_media_daily_limit()
  $t$;
END
$daily$;

-- 7. Storage early warning: each threshold alerts once.
CREATE TABLE IF NOT EXISTS public.issue_4114_chat_media_storage_alerts (
  threshold_gb integer PRIMARY KEY CHECK (threshold_gb > 0),
  total_bytes bigint NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.issue_4114_chat_media_storage_alerts IS
  'Issue #4114 Wave 7: which message-attachments size thresholds have been alerted (one row per threshold, written by api-health-probe through issue_4114_chat_media_storage_mark_alerted).';
ALTER TABLE public.issue_4114_chat_media_storage_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.issue_4114_chat_media_storage_alerts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.issue_4114_chat_media_storage_alerts TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_chat_media_storage_due(
  p_thresholds_gb integer[] DEFAULT ARRAY[5, 10, 20]
)
RETURNS TABLE (total_bytes bigint, due_thresholds_gb integer[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_total bigint := 0;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE $q$
      SELECT COALESCE(SUM(CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,15}$'
                               THEN (o.metadata->>'size')::bigint ELSE 0 END), 0)
      FROM storage.objects o
      WHERE o.bucket_id = 'message-attachments'
    $q$ INTO v_total;
  END IF;
  RETURN QUERY
  SELECT v_total,
         COALESCE((
           SELECT array_agg(t.gb ORDER BY t.gb)
           FROM unnest(COALESCE(p_thresholds_gb, ARRAY[]::integer[])) AS t(gb)
           WHERE t.gb > 0
             AND v_total >= t.gb::bigint * 1073741824
             AND NOT EXISTS (
               SELECT 1 FROM public.issue_4114_chat_media_storage_alerts a WHERE a.threshold_gb = t.gb
             )
         ), ARRAY[]::integer[]);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_media_storage_due(integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_media_storage_due(integer[]) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_chat_media_storage_mark_alerted(
  p_thresholds_gb integer[],
  p_total_bytes bigint
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.issue_4114_chat_media_storage_alerts (threshold_gb, total_bytes)
  SELECT DISTINCT t.gb, COALESCE(p_total_bytes, 0)
  FROM unnest(COALESCE(p_thresholds_gb, ARRAY[]::integer[])) AS t(gb)
  WHERE t.gb > 0
  ON CONFLICT (threshold_gb) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_media_storage_mark_alerted(integer[], bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_media_storage_mark_alerted(integer[], bigint) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
