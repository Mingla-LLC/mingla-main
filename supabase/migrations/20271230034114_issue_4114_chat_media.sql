-- Issue #4114 Wave 4: chat photos, videos, files and view once.
--
-- What changes:
--   * Chat attachments move to the PRIVATE `message-attachments` bucket. The app
--     stores the object PATH on the message (`messages.file_url`), never a URL,
--     and shows short-lived signed URLs. Paths are
--         <conversation_id>/<client_id>.<ext>        normal attachment
--         <conversation_id>/once/<client_id>.<ext>   view once
--     Old messages that hold a public `messages` bucket URL keep rendering.
--   * Storage policies mirror the `messages` bucket (participant of the
--     conversation named by folder[1]) with three tightenings:
--       - an object name must have the shape above (so folder[1] is always a uuid);
--       - view-once objects are readable ONLY by their sender, so a recipient can
--         never list, download or sign one; the recipient's one open goes
--         through the `open-view-once` edge function (service role);
--       - delete is limited to the sender of the message that references the
--         object (the `messages` bucket lets any participant delete anything).
--   * `messages.view_once` (default false) and `messages.view_once_purged_at`.
--     A trigger refuses a view-once message that is not a photo or video stored
--     in its conversation's `once/` folder, so a view-once item can never sit in
--     a recipient-readable path.
--   * `message_media_views(message_id, user_id, viewed_at)`: one row per person
--     per view-once message. Clients can read (their own rows, and every row of
--     the messages they sent) but never write; only the edge function inserts.
--   * Cleanup: `issue_4114_view_once_media_due` lists objects to delete (a
--     view-once item every recipient has opened, one older than 14 days, one
--     whose message was unsent, and attachments whose send never landed), and
--     `issue_4114_mark_view_once_purged` records the purge. Storage refuses SQL
--     deletes from storage.objects (storage.protect_delete), so the hourly cron
--     calls the `open-view-once` function's sweep, which deletes through the
--     Storage API. Both functions are service-role only.
--
-- Idempotent: every statement can run twice.

BEGIN;

-- 1. Private bucket (exists in production with 0 objects; created here for
--    every other environment). 25 MB per object (decision D7).
DO $bucket$
DECLARE
  has_public boolean;
  has_file_size_limit boolean;
  has_allowed_mime_types boolean;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE '#4114: storage schema unavailable; message-attachments bucket not created';
    RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='storage' AND table_name='buckets' AND column_name='public') INTO has_public;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='storage' AND table_name='buckets' AND column_name='file_size_limit') INTO has_file_size_limit;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='storage' AND table_name='buckets' AND column_name='allowed_mime_types') INTO has_allowed_mime_types;

  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'message-attachments', 'message-attachments', false, 26214400,
      -- Keep in step with CHAT_ATTACHMENT_MIME_TYPES in app-mobile/src/utils/chatMedia.ts
      -- (a regression test compares the two lists).
      ARRAY[
        'image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif',
        'video/mp4','video/quicktime','video/x-m4v','video/3gpp','video/webm',
        'audio/mpeg','audio/mp4','audio/x-m4a','audio/aac','audio/wav',
        'application/pdf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain','text/csv','application/zip'
      ]::text[]
    )
    ON CONFLICT (id) DO UPDATE SET
      public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets(id, name, public)
    VALUES ('message-attachments', 'message-attachments', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  ELSE
    INSERT INTO storage.buckets(id, name)
    VALUES ('message-attachments', 'message-attachments')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$bucket$;

-- 2. Message columns.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS view_once boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS view_once_purged_at timestamptz NULL;

COMMENT ON COLUMN public.messages.view_once IS
  'Issue #4114: a photo or video each recipient may open once, through the open-view-once edge function. Its object lives under <conversation_id>/once/ in message-attachments and only the sender can read it from storage.';
COMMENT ON COLUMN public.messages.view_once_purged_at IS
  'Issue #4114: when the view-once object was deleted from storage (everyone opened it, 14 days passed, or the message was unsent).';

-- Lookups from a storage object name back to its message (policies and cleanup).
CREATE INDEX IF NOT EXISTS messages_file_url_idx
  ON public.messages (file_url)
  WHERE file_url IS NOT NULL;

-- 3. A view-once message must be a photo or video in its own once/ folder.
CREATE OR REPLACE FUNCTION public.issue_4114_enforce_view_once_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.view_once IS TRUE THEN
    IF NEW.message_type IS DISTINCT FROM 'image' AND NEW.message_type IS DISTINCT FROM 'video' THEN
      RAISE EXCEPTION 'view_once_requires_photo_or_video' USING ERRCODE = '23514';
    END IF;
    IF NEW.file_url IS NULL
       OR left(NEW.file_url, length(NEW.conversation_id::text) + 6) <> NEW.conversation_id::text || '/once/' THEN
      RAISE EXCEPTION 'view_once_requires_once_folder' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_4114_view_once_shape ON public.messages;
CREATE TRIGGER issue_4114_view_once_shape
  BEFORE INSERT OR UPDATE OF view_once, file_url, message_type ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.issue_4114_enforce_view_once_shape();

-- 4. Who opened which view-once message.
CREATE TABLE IF NOT EXISTS public.message_media_views (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_media_views_user_idx
  ON public.message_media_views (user_id, viewed_at DESC);

COMMENT ON TABLE public.message_media_views IS
  'Issue #4114: one row per person per view-once message they opened. Written only by the open-view-once edge function (service role).';

ALTER TABLE public.message_media_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_media_views FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.message_media_views TO authenticated;
GRANT ALL ON public.message_media_views TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_is_message_sender(p_message_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id AND m.sender_id = p_user_id
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_is_message_sender(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_is_message_sender(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS message_media_views_read_own ON public.message_media_views;
CREATE POLICY message_media_views_read_own ON public.message_media_views
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS message_media_views_sender_read ON public.message_media_views;
CREATE POLICY message_media_views_sender_read ON public.message_media_views
  FOR SELECT TO authenticated
  USING (public.issue_4114_is_message_sender(message_id, auth.uid()));

-- 5. Storage access helpers. The name is validated before any uuid cast, so a
--    malformed name is refused instead of raising.
CREATE OR REPLACE FUNCTION public.issue_4114_chat_attachment_conversation(p_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_name IS NULL OR p_name !~
     '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(once/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$' THEN
    RETURN NULL;
  END IF;
  RETURN split_part(p_name, '/', 1)::uuid;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_chat_attachment_conversation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_chat_attachment_conversation(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_can_write_chat_attachment(p_name text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation uuid := public.issue_4114_chat_attachment_conversation(p_name);
BEGIN
  IF p_user_id IS NULL OR v_conversation IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.is_message_conversation_participant(v_conversation, p_user_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_can_write_chat_attachment(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_can_write_chat_attachment(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_can_read_chat_attachment(p_name text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation uuid := public.issue_4114_chat_attachment_conversation(p_name);
BEGIN
  IF p_user_id IS NULL OR v_conversation IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.is_message_conversation_participant(v_conversation, p_user_id) THEN
    RETURN false;
  END IF;
  -- View once: only the sender of the referencing message may read it.
  IF split_part(p_name, '/', 2) = 'once' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.file_url = p_name
        AND m.conversation_id = v_conversation
        AND m.sender_id = p_user_id
    );
  END IF;
  -- Belt and braces: an object some view-once message points at is never
  -- readable by anyone but that message's sender.
  RETURN NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.file_url = p_name
      AND m.view_once
      AND m.sender_id IS DISTINCT FROM p_user_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_can_read_chat_attachment(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_can_read_chat_attachment(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_can_delete_chat_attachment(p_name text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation uuid := public.issue_4114_chat_attachment_conversation(p_name);
BEGIN
  IF p_user_id IS NULL OR v_conversation IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.is_message_conversation_participant(v_conversation, p_user_id) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.file_url = p_name
      AND m.conversation_id = v_conversation
      AND m.sender_id = p_user_id
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_can_delete_chat_attachment(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4114_can_delete_chat_attachment(text, uuid) TO authenticated, service_role;

DO $policies$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE '#4114: storage.objects unavailable; message-attachments policies not created';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS message_attachments_insert ON storage.objects';
  EXECUTE $p$
    CREATE POLICY message_attachments_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'message-attachments'
        AND public.issue_4114_can_write_chat_attachment(name, auth.uid())
      )
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS message_attachments_select ON storage.objects';
  EXECUTE $p$
    CREATE POLICY message_attachments_select ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'message-attachments'
        AND public.issue_4114_can_read_chat_attachment(name, auth.uid())
      )
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS message_attachments_delete ON storage.objects';
  EXECUTE $p$
    CREATE POLICY message_attachments_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'message-attachments'
        AND public.issue_4114_can_delete_chat_attachment(name, auth.uid())
      )
  $p$;
END
$policies$;

-- 6. Cleanup. Lists what to delete; the edge function deletes through the
--    Storage API and then marks the view-once messages purged.
--    reason: 'opened'   every recipient (members who were in the chat when it
--                       was sent, other than the sender) has opened it
--            'expired'  14 days after it was sent (decision D6)
--            'unsent'   the sender unsent it
--            'orphan'   an attachment no message points at, older than 2 days
--                       (a send that never landed)
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
  ),
  classified AS (
    SELECT o.id, o.file_url,
      CASE
        WHEN o.deleted_at IS NOT NULL THEN 'unsent'
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

  IF to_regclass('storage.objects') IS NOT NULL THEN
    RETURN QUERY
    SELECT NULL::uuid, o.name, 'orphan'::text
    FROM storage.objects o
    WHERE o.bucket_id = 'message-attachments'
      AND o.created_at < p_now - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.file_url = o.name)
    ORDER BY o.created_at
    LIMIT v_limit;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_view_once_media_due(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_view_once_media_due(integer, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_mark_view_once_purged(p_message_ids uuid[])
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
     SET view_once_purged_at = COALESCE(view_once_purged_at, now())
   WHERE id = ANY(COALESCE(p_message_ids, ARRAY[]::uuid[]))
     AND view_once;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_mark_view_once_purged(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_mark_view_once_purged(uuid[]) TO service_role;

-- 7. Hourly sweep through the edge function (mirrors #3872's guarded schedule).
DO $cron$
DECLARE v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#4114: pg_cron/pg_net unavailable; view-once cleanup not scheduled'; RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='supabase_url')
    OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key') THEN
    RAISE NOTICE '#4114: runtime vault rows unavailable; view-once cleanup not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_4114_chat_media_cleanup';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_4114_chat_media_cleanup','41 * * * *',$job$SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)||'/functions/v1/open-view-once',
    headers:=jsonb_build_object('content-type','application/json','authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
    body:='{"action":"sweep"}'::jsonb,timeout_milliseconds:=25000)$job$);
END;
$cron$;

NOTIFY pgrst, 'reload schema';

COMMIT;
