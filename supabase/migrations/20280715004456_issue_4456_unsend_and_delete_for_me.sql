-- #4456: Unsend for everyone, Delete for me, and admin removal in chats.
--
--   U1. A message that is unsent (deleted_at set) becomes a tombstone: its
--       text, card, file reference, mentions and media facts are wiped from
--       the row, and the original goes to a private 30-day store
--       (message_unsend_evidence, server only). unsent_at / unsent_by /
--       unsent_kind say who did it: 'sender' (the author), 'admin' (a friend
--       group admin), 'host' (a brand team member's moderation delete),
--       'server' (a server job such as account deletion) or 'legacy' (rows
--       unsent before this migration). The apps show a placeholder for
--       'sender' and 'admin' and hide the others, as before.
--   U2. One path for every unsend. A BEFORE UPDATE trigger turns any change of
--       deleted_at from NULL into the tombstone, whoever writes it: the new
--       unsend_messages RPC, the direct deleted_at update older Explorer
--       builds send, the Host app's moderation delete, and server code. An
--       AFTER trigger removes the reactions, quiets the in-app notification
--       rows (and drops their preview) and bumps the conversation so chat
--       lists refresh. An unsent message never comes back.
--   U3. Messages can only be unsent, not changed: app clients keep UPDATE on
--       deleted_at, updated_at, is_read and read_at only (the read-receipt
--       trigger writes the last two), and lose DELETE.
--   U4. unsend_messages(ids): the author unsends their own messages (no time
--       limit, Seth 2026-11-16), a group admin removes someone else's. One to
--       ten ids from one chat (an album is one call).
--   U5. Delete for me: message_hidden_for (per user, synced), the
--       hide_messages_for_me / unhide_messages_for_me RPCs and a restrictive
--       read rule.
--   U6. Chat files: a participant reads a file only while a live message
--       points at it; an unsent message's file is readable by the server only.
--       The hourly media sweep deletes it after 30 days ('unsent_retention'),
--       later while an open report names the message.
--   U7. Reports name the message (user_reports.message_id), checked by the
--       server, which keeps its own copy for moderation.
--   U8. The rows unsent before this migration are wiped into the store
--       ('legacy', 30 days).
--
-- Invariants (declared in
-- supabase/migrations/__tests__/issue_4456_unsend_and_delete_for_me.implementor.pg17.test.sql):
--   I-4456-UNSEND-SCRUBS, I-4456-UNSEND-FINAL, I-4456-CLIENT-NO-CONTENT-WRITE,
--   I-4456-HIDE-IS-PER-USER, I-4456-UNSENT-FILE-SERVER-ONLY,
--   I-4456-EVIDENCE-RETENTION.
--
-- Replaced bodies are copied from their latest definitions
-- (20271230064114_issue_4114_chat_media_guards.sql) and change only the lines
-- marked #4456. Every statement can run twice.

-- U1. Tombstone columns.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS unsent_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unsent_kind text;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_unsent_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_unsent_kind_check
  CHECK (unsent_kind IS NULL OR unsent_kind IN ('sender', 'admin', 'host', 'server', 'legacy'));
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_unsent_shape;
ALTER TABLE public.messages ADD CONSTRAINT messages_unsent_shape
  CHECK ((unsent_at IS NULL) = (unsent_kind IS NULL) AND (unsent_at IS NULL OR deleted_at IS NOT NULL));

-- A tombstoned card keeps its type with no payload.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_card_requires_payload;
ALTER TABLE public.messages ADD CONSTRAINT messages_card_requires_payload
  CHECK ((message_type)::text <> 'card' OR card_payload IS NOT NULL OR unsent_at IS NOT NULL);

-- The private 30-day store. No policies: service role only.
CREATE TABLE IF NOT EXISTS public.message_unsend_evidence (
  message_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL,
  sender_id uuid,
  unsent_by uuid,
  unsent_kind text NOT NULL CHECK (unsent_kind IN ('sender', 'admin', 'host', 'server', 'legacy')),
  original jsonb NOT NULL,
  -- The storage objects the message pointed at (bucket message-attachments),
  -- only when they are object paths (old public URLs are not).
  file_path text,
  thumb_path text,
  unsent_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS message_unsend_evidence_purge_idx ON public.message_unsend_evidence (purge_after);
CREATE INDEX IF NOT EXISTS message_unsend_evidence_file_idx ON public.message_unsend_evidence (file_path) WHERE file_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_unsend_evidence_thumb_idx ON public.message_unsend_evidence (thumb_path) WHERE thumb_path IS NOT NULL;
ALTER TABLE public.message_unsend_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.message_unsend_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.message_unsend_evidence TO service_role;

-- How long the store keeps an unsent message (Seth, decision D3).
CREATE OR REPLACE FUNCTION public.issue_4456_evidence_retention()
RETURNS interval LANGUAGE sql IMMUTABLE AS $$ SELECT interval '30 days' $$;
REVOKE ALL ON FUNCTION public.issue_4456_evidence_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4456_evidence_retention() TO service_role;

-- The types a person can unsend (plan cards, system rows and enquiry cards are
-- server-owned).
CREATE OR REPLACE FUNCTION public.issue_4456_is_unsendable_type(p_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_type, 'text') IN ('text', 'image', 'video', 'file', 'card')
$$;
REVOKE ALL ON FUNCTION public.issue_4456_is_unsendable_type(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4456_is_unsendable_type(text) TO authenticated, service_role;

-- The canonical storage object a column names, or NULL (old public URLs).
CREATE OR REPLACE FUNCTION public.issue_4456_object_path(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_value IS NULL OR p_value ~* '^https?://' OR btrim(p_value) = '' THEN NULL ELSE p_value END
$$;
REVOKE ALL ON FUNCTION public.issue_4456_object_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4456_object_path(text) TO authenticated, service_role;

-- U2. The tombstone trigger. Runs after issue_4114_view_once_shape (name
-- order) and before tg_4261_guard_plan_messages, so a client unsend of a plan
-- row is still refused there.
CREATE OR REPLACE FUNCTION public.issue_4456_tombstone_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_client boolean := COALESCE(auth.role(), '') IN ('authenticated', 'anon');
  v_uid uuid := auth.uid();
  v_requested text := NULLIF(current_setting('issue_4456.unsend_kind', true), '');
  v_kind text;
  v_becomes boolean;
BEGIN
  -- I-4456-UNSEND-FINAL: a tombstone stays a tombstone, with nothing put back.
  IF OLD.unsent_at IS NOT NULL THEN
    IF NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION 'unsend_is_final' USING ERRCODE = '23514';
    END IF;
    NEW.deleted_at := OLD.deleted_at;
    NEW.unsent_at := OLD.unsent_at;
    -- unsent_by may only go to NULL (its user was deleted: ON DELETE SET NULL).
    NEW.unsent_by := CASE WHEN NEW.unsent_by IS NULL THEN NULL ELSE OLD.unsent_by END;
    NEW.unsent_kind := OLD.unsent_kind;
    NEW.content := '';
    NEW.file_url := NULL;
    NEW.thumb_path := NULL;
    NEW.file_name := NULL;
    NEW.file_size := NULL;
    NEW.card_payload := NULL;
    NEW.card_tags := '[]'::jsonb;
    NEW.mentions := '[]'::jsonb;
    NEW.media_duration_ms := NULL;
    NEW.media_width := NULL;
    NEW.media_height := NULL;
    RETURN NEW;
  END IF;

  -- App clients never bring a removed message back.
  IF v_client AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'unsend_is_final' USING ERRCODE = '23514';
  END IF;

  v_becomes := NEW.deleted_at IS NOT NULL AND (
    OLD.deleted_at IS NULL
    -- U8 backfill (server only): an already-removed row is tombstoned when the
    -- server stamps unsent_at on it.
    OR (NOT v_client AND NEW.unsent_at IS NOT NULL)
  );
  IF NOT v_becomes THEN
    IF NOT v_client THEN
      RETURN NEW;
    END IF;
    -- Clients never set the tombstone columns themselves (also refused by grants).
    NEW.unsent_at := OLD.unsent_at;
    NEW.unsent_by := OLD.unsent_by;
    NEW.unsent_kind := OLD.unsent_kind;
    RETURN NEW;
  END IF;

  IF NOT public.issue_4456_is_unsendable_type(OLD.message_type) THEN
    IF v_client AND OLD.message_type IS DISTINCT FROM 'plan' THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    -- Plan rows: tg_4261_guard_plan_messages refuses clients; the server's own
    -- removals of server-owned rows stay plain hides.
    NEW.unsent_at := NULL;
    NEW.unsent_by := NULL;
    NEW.unsent_kind := NULL;
    RETURN NEW;
  END IF;

  IF v_client THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;
    IF v_requested = 'admin' THEN
      IF OLD.sender_id IS NOT DISTINCT FROM v_uid
         OR OLD.view_once
         OR NOT public.chat_group_is_admin(OLD.conversation_id, v_uid) THEN
        RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
      END IF;
      v_kind := 'admin';
    ELSIF OLD.sender_id IS NOT DISTINCT FROM v_uid THEN
      v_kind := 'sender';
    ELSIF public.is_conversation_brand_team_member(OLD.conversation_id, v_uid) THEN
      v_kind := 'host';
    ELSE
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_kind := COALESCE(NULLIF(NEW.unsent_kind, ''), v_requested, 'server');
    IF v_kind NOT IN ('sender', 'admin', 'host', 'server', 'legacy') THEN
      v_kind := 'server';
    END IF;
  END IF;

  INSERT INTO public.message_unsend_evidence(
    message_id, conversation_id, sender_id, unsent_by, unsent_kind, original,
    file_path, thumb_path, unsent_at, purge_after
  ) VALUES (
    OLD.id, OLD.conversation_id, OLD.sender_id, v_uid, v_kind,
    jsonb_build_object(
      'content', OLD.content,
      'message_type', OLD.message_type,
      'file_url', OLD.file_url,
      'thumb_path', OLD.thumb_path,
      'file_name', OLD.file_name,
      'file_size', OLD.file_size,
      'card_payload', OLD.card_payload,
      'card_tags', OLD.card_tags,
      'mentions', OLD.mentions,
      'reply_to_id', OLD.reply_to_id,
      'view_once', OLD.view_once,
      'media_album_id', OLD.media_album_id,
      'media_duration_ms', OLD.media_duration_ms,
      'media_width', OLD.media_width,
      'media_height', OLD.media_height,
      'created_at', OLD.created_at,
      'deleted_at', OLD.deleted_at
    ),
    public.issue_4456_object_path(OLD.file_url),
    public.issue_4456_object_path(OLD.thumb_path),
    now(),
    now() + public.issue_4456_evidence_retention()
  )
  ON CONFLICT (message_id) DO NOTHING;

  -- I-4456-UNSEND-SCRUBS.
  NEW.content := '';
  NEW.file_url := NULL;
  NEW.thumb_path := NULL;
  NEW.file_name := NULL;
  NEW.file_size := NULL;
  NEW.card_payload := NULL;
  NEW.card_tags := '[]'::jsonb;
  NEW.mentions := '[]'::jsonb;
  NEW.media_duration_ms := NULL;
  NEW.media_width := NULL;
  NEW.media_height := NULL;
  NEW.unsent_at := now();
  NEW.unsent_by := v_uid;
  NEW.unsent_kind := v_kind;
  IF OLD.deleted_at IS NULL AND v_client THEN
    NEW.deleted_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4456_tombstone_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4456_tombstone ON public.messages;
CREATE TRIGGER issue_4456_tombstone
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.issue_4456_tombstone_on_delete();

-- U2. What follows a tombstone, on every path.
CREATE OR REPLACE FUNCTION public.issue_4456_after_unsend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.unsent_at IS NOT NULL OR NEW.unsent_at IS NULL THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.direct_message_reactions WHERE message_id = NEW.id;
  -- The in-app rows for this message keep no preview (two statements, so each
  -- uses its index).
  UPDATE public.notifications n
     SET in_app_suppressed_at = COALESCE(n.in_app_suppressed_at, now()),
         body = ''
   WHERE n.data ? 'messageId' AND n.data ->> 'messageId' = NEW.id::text;
  UPDATE public.notifications n
     SET in_app_suppressed_at = COALESCE(n.in_app_suppressed_at, now()),
         body = ''
   WHERE n.related_id = NEW.id::text AND n.related_type = 'message';
  -- Chat lists listen for conversation updates; last_message_at stays.
  UPDATE public.conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4456_after_unsend() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4456_after_unsend ON public.messages;
CREATE TRIGGER issue_4456_after_unsend
  AFTER UPDATE OF deleted_at, unsent_at ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.issue_4456_after_unsend();

CREATE INDEX IF NOT EXISTS notifications_message_id_idx
  ON public.notifications ((data ->> 'messageId'))
  WHERE data ? 'messageId';

-- The view-once shape check skips a tombstone (its file reference is wiped).
-- Body copied from 20271230064114_issue_4114_chat_media_guards.sql; only the
-- #4456 lines are new.
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
      -- #4456: a new message is never born a tombstone.
      IF NEW.unsent_at IS NOT NULL OR NEW.unsent_kind IS NOT NULL OR NEW.unsent_by IS NOT NULL THEN
        RAISE EXCEPTION 'unsend_is_server_owned' USING ERRCODE = '23514';
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

  -- #4456: a tombstone has no file to check.
  IF TG_OP = 'UPDATE' AND NEW.unsent_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
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
    -- #4456: an unsent message's file is never reused by a new message.
    IF EXISTS (
      SELECT 1 FROM public.message_unsend_evidence e
      WHERE e.file_path = NEW.file_url OR e.thumb_path = NEW.file_url
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

-- U3. I-4456-CLIENT-NO-CONTENT-WRITE. App clients keep only the unsend write
-- (deleted_at), the timestamp and the read flags the read-receipt trigger
-- sets. The existing row policies (own row, brand team member, restrictive
-- guards) still decide WHICH rows. The DELETE policy stays in place for the
-- #4423 policy rewrites but has no privilege behind it.
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.messages FROM anon, authenticated;
GRANT UPDATE (deleted_at, updated_at, is_read, read_at) ON TABLE public.messages TO authenticated;

-- U5. Delete for me.
CREATE TABLE IF NOT EXISTS public.message_hidden_for (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);
CREATE INDEX IF NOT EXISTS message_hidden_for_message_idx ON public.message_hidden_for (message_id);
ALTER TABLE public.message_hidden_for ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.message_hidden_for FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.message_hidden_for TO authenticated;
GRANT ALL ON TABLE public.message_hidden_for TO service_role;

DROP POLICY IF EXISTS message_hidden_for_select ON public.message_hidden_for;
CREATE POLICY message_hidden_for_select ON public.message_hidden_for
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
-- Only a message in a chat the person is in. A definer check, because the
-- messages read rules themselves read this table.
CREATE OR REPLACE FUNCTION public.issue_4456_can_hide_message(p_message_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id
      AND public.is_message_conversation_participant(m.conversation_id, p_user)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4456_can_hide_message(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4456_can_hide_message(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS message_hidden_for_insert ON public.message_hidden_for;
CREATE POLICY message_hidden_for_insert ON public.message_hidden_for
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.issue_4456_can_hide_message(message_id, (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS message_hidden_for_delete ON public.message_hidden_for;
CREATE POLICY message_hidden_for_delete ON public.message_hidden_for
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- I-4456-HIDE-IS-PER-USER.
DROP POLICY IF EXISTS messages_hidden_for_me ON public.messages;
CREATE POLICY messages_hidden_for_me ON public.messages AS RESTRICTIVE FOR SELECT
  USING (NOT EXISTS (
    SELECT 1 FROM public.message_hidden_for h
    WHERE h.message_id = messages.id AND h.user_id = (SELECT auth.uid())
  ));

CREATE OR REPLACE FUNCTION public.hide_messages_for_me(p_message_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_message_ids, ARRAY[]::uuid[])) AS x WHERE x IS NOT NULL;
  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 50 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  -- The SELECT runs under the caller's read rules: only messages they can see.
  INSERT INTO public.message_hidden_for(user_id, message_id)
  SELECT v_uid, m.id FROM public.messages m WHERE m.id = ANY(v_ids)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('count', v_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.hide_messages_for_me(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_messages_for_me(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.unhide_messages_for_me(p_message_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF cardinality(COALESCE(p_message_ids, ARRAY[]::uuid[])) < 1 OR cardinality(p_message_ids) > 50 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.message_hidden_for
   WHERE user_id = v_uid AND message_id = ANY(p_message_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('count', v_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.unhide_messages_for_me(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unhide_messages_for_me(uuid[]) TO authenticated;

-- U4. Unsend for everyone / admin remove.
CREATE OR REPLACE FUNCTION public.unsend_messages(p_message_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_found integer;
  v_conversations integer;
  v_conversation uuid;
  v_linked text;
  v_own integer;
  v_kind text;
  v_pending uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_message_ids, ARRAY[]::uuid[])) AS x WHERE x IS NOT NULL;
  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 10
     OR cardinality(v_ids) <> cardinality(COALESCE(p_message_ids, ARRAY[]::uuid[])) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT m.conversation_id), min(m.conversation_id::text)::uuid
    INTO v_found, v_conversations, v_conversation
    FROM public.messages m WHERE m.id = ANY(v_ids);
  IF v_conversations > 1 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF v_found < cardinality(v_ids) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_message_conversation_participant(v_conversation, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT c.linked_entity_type INTO v_linked FROM public.conversations c WHERE c.id = v_conversation;
  IF v_linked IN ('brand_enquiry', 'support') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  -- Messages already removed (by anyone) count as done.
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_pending
    FROM public.messages m WHERE m.id = ANY(v_ids) AND m.deleted_at IS NULL;
  IF EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = ANY(v_pending) AND NOT public.issue_4456_is_unsendable_type(m.message_type)
  ) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_own FROM public.messages m
   WHERE m.id = ANY(v_ids) AND m.sender_id IS NOT DISTINCT FROM v_uid;
  IF v_own = cardinality(v_ids) THEN
    v_kind := 'sender';
  ELSIF v_own = 0 THEN
    -- Group admins only (session or plain friend groups), never on view-once.
    IF NOT public.chat_group_is_admin(v_conversation, v_uid) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM public.messages m WHERE m.id = ANY(v_pending) AND m.view_once) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    v_kind := 'admin';
  ELSE
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF cardinality(v_pending) > 0 THEN
    PERFORM set_config('issue_4456.unsend_kind', v_kind, true);
    UPDATE public.messages SET deleted_at = now()
     WHERE id = ANY(v_pending) AND deleted_at IS NULL;
    PERFORM set_config('issue_4456.unsend_kind', '', true);
  END IF;

  RETURN jsonb_build_object('unsent', to_jsonb(v_ids), 'kind', v_kind);
END;
$function$;
REVOKE ALL ON FUNCTION public.unsend_messages(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unsend_messages(uuid[]) TO authenticated;

-- U6. Storage read. I-4456-UNSENT-FILE-SERVER-ONLY: an unsent message's file
-- (in the store) is readable by nobody but the server; an ordinary file is
-- readable by a participant only while a live message points at it (its
-- uploader also before the message lands). Body copied from
-- 20271230064114_issue_4114_chat_media_guards.sql; the #4456 lines are new.
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

  -- #4456: unsent, kept privately for the 30-day store.
  IF EXISTS (
    SELECT 1 FROM public.message_unsend_evidence e
    WHERE e.file_path = p_name OR e.thumb_path = p_name
  ) THEN
    RETURN false;
  END IF;

  IF public.is_message_conversation_participant(v_conversation, p_user_id) THEN
    IF p_owner IS NOT NULL AND p_owner = p_user_id THEN
      RETURN true;
    END IF;
    IF v_once THEN
      RETURN false;
    END IF;
    -- #4456: only while a live message in this chat points at it.
    RETURN EXISTS (
      SELECT 1 FROM public.messages m
      WHERE (m.file_url = p_name OR m.thumb_path = p_name)
        AND m.conversation_id = v_conversation
        AND m.deleted_at IS NULL
    ) AND NOT EXISTS (
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

-- U7. Reports name the message.
ALTER TABLE public.user_reports ADD COLUMN IF NOT EXISTS message_id uuid;
CREATE INDEX IF NOT EXISTS user_reports_message_id_idx ON public.user_reports (message_id) WHERE message_id IS NOT NULL;

-- The server's copy of a reported message, taken when the report is filed
-- (from the store when the message was already unsent). Service role only.
CREATE TABLE IF NOT EXISTS public.message_report_evidence (
  report_id uuid PRIMARY KEY REFERENCES public.user_reports(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_report_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.message_report_evidence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.message_report_evidence TO service_role;

-- A report that names a message is open while pending or reviewed.
CREATE OR REPLACE FUNCTION public.issue_4456_message_has_open_report(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_reports r
    WHERE r.message_id = p_message_id
      AND r.status::text IN ('pending', 'reviewed')
  )
$$;
REVOKE ALL ON FUNCTION public.issue_4456_message_has_open_report(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4456_message_has_open_report(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4456_report_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_client boolean := COALESCE(auth.role(), '') IN ('authenticated', 'anon');
  v_message public.messages%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  IF NEW.message_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_message FROM public.messages m WHERE m.id = NEW.message_id;
  IF v_client THEN
    -- Only a message in a chat the reporter is in, written by the person reported.
    IF NOT FOUND
       OR NOT public.is_message_conversation_participant(v_message.conversation_id, NEW.reporter_id)
       OR v_message.sender_id IS DISTINCT FROM NEW.reported_user_id THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF FOUND THEN
    SELECT e.original INTO v_snapshot FROM public.message_unsend_evidence e WHERE e.message_id = v_message.id;
    v_snapshot := COALESCE(v_snapshot, jsonb_build_object(
      'content', v_message.content,
      'message_type', v_message.message_type,
      'file_url', v_message.file_url,
      'thumb_path', v_message.thumb_path,
      'file_name', v_message.file_name,
      'card_payload', v_message.card_payload,
      'view_once', v_message.view_once,
      'created_at', v_message.created_at
    )) || jsonb_build_object(
      'conversation_id', v_message.conversation_id,
      'sender_id', v_message.sender_id,
      'unsent_at', v_message.unsent_at,
      'unsent_kind', v_message.unsent_kind
    );
    INSERT INTO public.message_report_evidence(report_id, message_id, snapshot)
    VALUES (NEW.id, NEW.message_id, v_snapshot)
    ON CONFLICT (report_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4456_report_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4456_report_message ON public.user_reports;
CREATE TRIGGER issue_4456_report_message
  AFTER INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.issue_4456_report_message();

-- U6. The hourly sweep. I-4456-EVIDENCE-RETENTION: an unsent message's files
-- are listed ('unsent_retention') only after purge_after and while no open
-- report names the message; until then the orphan rule leaves them alone.
-- Body copied from 20271230064114_issue_4114_chat_media_guards.sql; the #4456
-- lines are new.
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

  -- #4456: an unsent message's file and thumbnail, once its private copy is due.
  RETURN QUERY
  SELECT d.message_id, d.path, 'unsent_retention'::text
  FROM (
    SELECT e.message_id, e.unsent_at, p.path
    FROM public.message_unsend_evidence e
    CROSS JOIN LATERAL (VALUES (e.file_path), (e.thumb_path)) AS p(path)
    WHERE e.purge_after < p_now
      AND p.path IS NOT NULL
      AND public.issue_4114_chat_attachment_conversation(p.path) = e.conversation_id
      AND NOT public.issue_4456_message_has_open_report(e.message_id)
  ) d
  ORDER BY d.unsent_at
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
      -- #4456: kept for the 30-day store.
      AND NOT EXISTS (
        SELECT 1 FROM public.message_unsend_evidence e
        WHERE e.file_path = o.name OR e.thumb_path = o.name
      )
    ORDER BY o.created_at
    LIMIT v_limit;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4114_view_once_media_due(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_view_once_media_due(integer, timestamptz) TO service_role;

-- The sweep calls this after deleting the files: drops the private copies
-- that are due (the ones whose files were listed, plus up to 100 with no
-- files). A copy an open report names stays. Returns how many went.
CREATE OR REPLACE FUNCTION public.issue_4456_purge_unsent_evidence(
  p_message_ids uuid[],
  p_now timestamptz DEFAULT now()
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
  WITH due AS (
    SELECT e.message_id FROM public.message_unsend_evidence e
     WHERE e.purge_after < p_now
       AND e.message_id = ANY(COALESCE(p_message_ids, ARRAY[]::uuid[]))
    UNION
    SELECT x.message_id FROM (
      SELECT e.message_id FROM public.message_unsend_evidence e
       WHERE e.purge_after < p_now AND e.file_path IS NULL AND e.thumb_path IS NULL
       ORDER BY e.purge_after
       LIMIT 100
    ) x
  )
  DELETE FROM public.message_unsend_evidence e
   USING due
   WHERE e.message_id = due.message_id
     AND NOT public.issue_4456_message_has_open_report(e.message_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4456_purge_unsent_evidence(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4456_purge_unsent_evidence(uuid[], timestamptz) TO service_role;

-- U8. The rows unsent before this migration: wiped into the store, 30 days.
-- Server statement, so the tombstone trigger stamps kind 'legacy' and keeps
-- each original.
UPDATE public.messages
   SET unsent_at = now(), unsent_kind = 'legacy'
 WHERE deleted_at IS NOT NULL
   AND unsent_at IS NULL
   AND public.issue_4456_is_unsendable_type(message_type);
