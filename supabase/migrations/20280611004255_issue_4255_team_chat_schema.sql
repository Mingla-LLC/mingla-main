-- Issue #4255 (Work board v2, wave W1b): Mingla team chat, database layer 1 of 2.
-- Spec: revisions 3 (Messages and Mingla team, D11-D14) and 4 (photos,
-- documents and links in chats), approved by Seth on 10 Nov.
--
-- What this file adds:
--   1. Who is staff for team chat: team_chat_staff(uid) is an active Admin
--      teammate (issue_3720_active_team_member) whose sign-in address is
--      CONFIRMED and who is not banned or deleted. Nobody can sign up with a
--      staff address and get in. team_chat_admin(uid) is a confirmed owner or
--      admin (the only people who may mention everyone).
--   2. Tables, kept apart from host and explorer chats (conversations and
--      messages are untouched): team_threads (team | group | dm),
--      team_thread_members, team_messages, team_message_reactions, team_reads,
--      team_message_attachments.
--   3. Row-level security on every table: a row is readable only by a live
--      member of its thread who is staff at the moment of the read, so a
--      revoked teammate loses access at once. Clients get SELECT only; every
--      write goes through the SECURITY DEFINER functions in the next file.
--   4. The private bucket team-files (25 MB a file, no image transformations,
--      #1643) and its storage policies: an upload only to the path the
--      server issued to that person in the last 24 hours, a read only while
--      the attachment row is live, by a member of the thread whose id starts
--      the path.
--   5. The one "Mingla team" thread, its membership synced from the staff
--      tables (admin_users, admin_team_members) and from sign-in accounts
--      (a confirmed or changed address), plus a backfill.
--   6. team_mentions may now come from a team chat message.
--   7. Realtime for the tables whose rows RLS already limits to members.
--
-- Static SQL only (#1860 C7). Conflicts raise PT409 (functions file).
-- MINGLA-INVARIANT declarations live beside the enforcing test:
-- supabase/migrations/__tests__/issue_4255_team_chat.implementor.pg17.test.sql

-- ---------------------------------------------------------------------------
-- 1. Staff identity.
--
-- The sign-in service owns email_confirmed_at, banned_until and deleted_at;
-- a bare database image has none of them. They are read through to_jsonb so
-- this file applies everywhere, and an absent column reads as "not
-- confirmed", which fails closed.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.team_chat_staff(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_user jsonb;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  SELECT to_jsonb(u) INTO v_user FROM auth.users u WHERE u.id = p_user_id;
  IF v_user IS NULL OR btrim(COALESCE(v_user->>'email', '')) = '' THEN RETURN false; END IF;
  IF v_user->>'email_confirmed_at' IS NULL THEN RETURN false; END IF;
  IF v_user->>'deleted_at' IS NOT NULL THEN RETURN false; END IF;
  IF COALESCE((v_user->>'banned_until')::timestamptz > now(), false) THEN RETURN false; END IF;
  RETURN public.issue_3720_active_team_member(p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_staff(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_chat_staff(uuid) TO service_role;
COMMENT ON FUNCTION public.team_chat_staff(uuid) IS
  'Issue #4255. Team chat access: an active Admin teammate (admin_users or admin_team_members, by address) whose sign-in address is confirmed and who is not banned or deleted. Internal.';

CREATE FUNCTION public.team_chat_admin(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN public.team_chat_staff(p_user_id) AND EXISTS (
    SELECT 1 FROM auth.users u JOIN public.admin_users a ON lower(btrim(a.email)) = lower(btrim(u.email))
     WHERE u.id = p_user_id AND a.status = 'active' AND a.role IN ('owner', 'admin'));
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_chat_admin(uuid) TO service_role;
COMMENT ON FUNCTION public.team_chat_admin(uuid) IS
  'Issue #4255. A confirmed, active owner or admin: the only people who may mention everyone in a team chat. Internal.';

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------
CREATE TABLE public.team_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,
  title           text,
  dm_key          text UNIQUE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  archived_at     timestamptz,
  revision        bigint NOT NULL DEFAULT 1,
  CONSTRAINT team_threads_kind_check CHECK (kind IN ('team', 'group', 'dm')),
  CONSTRAINT team_threads_title_check CHECK (
    (kind = 'dm' AND title IS NULL)
    OR (kind <> 'dm' AND title IS NOT NULL AND title = btrim(title) AND char_length(title) BETWEEN 1 AND 80 AND title !~ '[[:cntrl:]]')),
  CONSTRAINT team_threads_dm_key_check CHECK (
    (kind = 'dm' AND dm_key ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$') OR (kind <> 'dm' AND dm_key IS NULL)),
  CONSTRAINT team_threads_team_live CHECK (kind <> 'team' OR archived_at IS NULL),
  CONSTRAINT team_threads_revision_check CHECK (revision >= 1)
);
-- Exactly one Mingla team thread.
CREATE UNIQUE INDEX team_threads_one_team ON public.team_threads ((kind)) WHERE kind = 'team';
COMMENT ON TABLE public.team_threads IS
  'Issue #4255. Mingla team chats: the one team thread (every active staff member, synced from the staff tables), groups and DMs. Separate from conversations/messages (host and explorer chats). Rows readable only by live members who are staff; writes only through team_* functions.';

CREATE TABLE public.team_thread_members (
  thread_id  uuid NOT NULL REFERENCES public.team_threads(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',
  muted      boolean NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  added_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id),
  CONSTRAINT team_thread_members_role_check CHECK (role IN ('owner', 'member'))
);
CREATE INDEX team_thread_members_by_user ON public.team_thread_members (user_id) WHERE left_at IS NULL;
COMMENT ON TABLE public.team_thread_members IS
  'Issue #4255. Who is in a team chat. left_at marks someone who left, was removed, or (team thread) stopped being staff. muted silences message pushes for that thread; mentions still reach them.';

CREATE TABLE public.team_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        uuid NOT NULL REFERENCES public.team_threads(id) ON DELETE CASCADE,
  author_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body_md          text NOT NULL DEFAULT '',
  reply_to_id      uuid REFERENCES public.team_messages(id) ON DELETE SET NULL,
  mentions         uuid[] NOT NULL DEFAULT '{}'::uuid[],
  mention_everyone boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  revision         bigint NOT NULL DEFAULT 1,
  request_key      text,
  CONSTRAINT team_messages_body_check CHECK (char_length(body_md) <= 10000),
  CONSTRAINT team_messages_mentions_check CHECK (cardinality(mentions) <= 20),
  -- A deleted message keeps mention_everyone, so deleting it cannot reset
  -- the once-every-10-minutes limit (the read functions hide it).
  CONSTRAINT team_messages_deleted_clean CHECK (deleted_at IS NULL OR (body_md = '' AND cardinality(mentions) = 0)),
  CONSTRAINT team_messages_request_key_check CHECK (request_key IS NULL OR char_length(request_key) BETWEEN 8 AND 120),
  CONSTRAINT team_messages_revision_check CHECK (revision >= 1)
);
CREATE INDEX team_messages_by_thread ON public.team_messages (thread_id, created_at DESC, id DESC);
CREATE INDEX team_messages_everyone_by_author ON public.team_messages (author_id, created_at DESC) WHERE mention_everyone;
CREATE UNIQUE INDEX team_messages_request_once ON public.team_messages (author_id, request_key) WHERE request_key IS NOT NULL;
COMMENT ON TABLE public.team_messages IS
  'Issue #4255. A team chat message: Markdown up to 10,000 characters, attachments, a reply to another message of the same thread, mentions (live members) and everyone (owner or admin, once every 10 minutes). Delete is soft: the words, mentions and attachments go at once.';

CREATE TABLE public.team_message_reactions (
  message_id uuid NOT NULL REFERENCES public.team_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji),
  CONSTRAINT team_message_reactions_emoji_check CHECK (char_length(emoji) BETWEEN 1 AND 16 AND emoji !~ '[[:space:][:cntrl:]]')
);

CREATE TABLE public.team_reads (
  thread_id    uuid NOT NULL REFERENCES public.team_threads(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
COMMENT ON TABLE public.team_reads IS
  'Issue #4255. How far each member has read each team chat (unread counts and the badge).';

CREATE TABLE public.team_message_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    uuid NOT NULL REFERENCES public.team_threads(id) ON DELETE CASCADE,
  message_id   uuid REFERENCES public.team_messages(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  name         text NOT NULL,
  mime         text,
  size_bytes   bigint,
  storage_path text UNIQUE,
  url          text,
  width        integer,
  height       integer,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CONSTRAINT team_message_attachments_kind_check CHECK (kind IN ('image', 'document', 'link')),
  CONSTRAINT team_message_attachments_name_check CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
  CONSTRAINT team_message_attachments_mime_check CHECK (mime IS NULL OR (char_length(mime) BETWEEN 3 AND 120 AND mime ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$')),
  CONSTRAINT team_message_attachments_size_check CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 26214400),
  CONSTRAINT team_message_attachments_where CHECK (
    (kind = 'link' AND url IS NOT NULL AND storage_path IS NULL AND mime IS NULL AND size_bytes IS NULL)
    OR (kind <> 'link' AND url IS NULL AND storage_path IS NOT NULL AND mime IS NOT NULL AND size_bytes IS NOT NULL)),
  CONSTRAINT team_message_attachments_url_check CHECK (url IS NULL OR (char_length(url) BETWEEN 9 AND 2000 AND url ~ '^https://[^[:space:]]+$')),
  -- <thread_id>/<attachment_id>/<file>: the thread's id always starts the path.
  CONSTRAINT team_message_attachments_path_check CHECK (
    storage_path IS NULL OR (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'
                             AND split_part(storage_path, '/', 1) = thread_id::text
                             AND split_part(storage_path, '/', 2) = id::text)),
  CONSTRAINT team_message_attachments_dims_check CHECK (
    (width IS NULL AND height IS NULL) OR (kind = 'image' AND width BETWEEN 1 AND 20000 AND height BETWEEN 1 AND 20000))
);
CREATE INDEX team_message_attachments_by_message ON public.team_message_attachments (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX team_message_attachments_pending ON public.team_message_attachments (created_by, created_at) WHERE message_id IS NULL AND archived_at IS NULL;
COMMENT ON TABLE public.team_message_attachments IS
  'Issue #4255 (rev 4). Photos and documents (private bucket team-files, 25 MB each, signed links only while the row is live and its message is not deleted) and links (no page fetch). Added before the message, attached when it is posted, up to 10 per message.';

-- ---------------------------------------------------------------------------
-- 3. Row-level security. Every read: a live member of the thread who is
-- staff right now. No client writes.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.team_chat_can_read(p_thread_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.team_thread_members m
                  WHERE m.thread_id = p_thread_id AND m.user_id = auth.uid() AND m.left_at IS NULL)
     AND public.team_chat_staff(auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_can_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_chat_can_read(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.team_chat_can_read(uuid) IS
  'Issue #4255. RLS: may the signed-in person read this team chat (a live member, and staff now)? Answers only for the caller.';

ALTER TABLE public.team_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_thread_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_message_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.team_threads, public.team_thread_members, public.team_messages,
  public.team_message_reactions, public.team_reads, public.team_message_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_threads, public.team_thread_members, public.team_messages,
  public.team_message_reactions, public.team_reads, public.team_message_attachments TO authenticated;
GRANT ALL ON public.team_threads, public.team_thread_members, public.team_messages,
  public.team_message_reactions, public.team_reads, public.team_message_attachments TO service_role;

CREATE POLICY team_threads_member_read ON public.team_threads
  FOR SELECT TO authenticated USING (public.team_chat_can_read(id));
CREATE POLICY team_thread_members_member_read ON public.team_thread_members
  FOR SELECT TO authenticated USING (public.team_chat_can_read(thread_id));
CREATE POLICY team_messages_member_read ON public.team_messages
  FOR SELECT TO authenticated USING (public.team_chat_can_read(thread_id));
CREATE POLICY team_message_reactions_member_read ON public.team_message_reactions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.team_messages m WHERE m.id = team_message_reactions.message_id AND public.team_chat_can_read(m.thread_id)));
CREATE POLICY team_reads_own_read ON public.team_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.team_chat_can_read(thread_id));
CREATE POLICY team_message_attachments_member_read ON public.team_message_attachments
  FOR SELECT TO authenticated USING (archived_at IS NULL AND public.team_chat_can_read(thread_id));

-- ---------------------------------------------------------------------------
-- 4. The private bucket and its storage policies. Static SQL only (#1860
-- C7): the bucket shape is probed, never EXECUTEd. No image transformations
-- (#1643).
-- ---------------------------------------------------------------------------
DO $bucket$
DECLARE has_public boolean; has_file_size_limit boolean; has_allowed_mime_types boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public') INTO has_public;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit') INTO has_file_size_limit;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types') INTO has_allowed_mime_types;
  IF has_public AND has_file_size_limit AND has_allowed_mime_types THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('team-files', 'team-files', false, 26214400, ARRAY[
      'image/jpeg','image/png','image/webp','image/gif','image/heic',
      'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain','text/csv','application/vnd.apple.keynote','application/vnd.apple.numbers','application/vnd.apple.pages'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
  ELSIF has_public THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('team-files', 'team-files', false)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  ELSE
    INSERT INTO storage.buckets (id, name) VALUES ('team-files', 'team-files')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  END IF;
END
$bucket$;

-- An upload goes only to the path team_attachment_add issued to this person
-- in the last 24 hours, for an attachment not yet in a message, in a thread
-- they can read now.
CREATE FUNCTION public.team_file_can_upload(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN auth.uid() IS NOT NULL AND p_name IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.team_message_attachments a
                  WHERE a.storage_path = p_name AND a.archived_at IS NULL AND a.message_id IS NULL
                    AND a.created_by = auth.uid() AND a.created_at > now() - interval '24 hours'
                    AND split_part(p_name, '/', 1) = a.thread_id::text
                    AND public.team_chat_can_read(a.thread_id));
END;
$$;
REVOKE ALL ON FUNCTION public.team_file_can_upload(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_file_can_upload(text) TO authenticated;

-- A read (which is how a signed link is made): the attachment row is live,
-- its message is not deleted (or it is the uploader's own file not yet
-- posted), and the reader can read the thread whose id starts the path.
CREATE FUNCTION public.team_file_can_read(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RETURN auth.uid() IS NOT NULL AND p_name IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.team_message_attachments a
                   LEFT JOIN public.team_messages m ON m.id = a.message_id
                  WHERE a.storage_path = p_name AND a.archived_at IS NULL
                    AND split_part(p_name, '/', 1) = a.thread_id::text
                    AND ((a.message_id IS NOT NULL AND m.deleted_at IS NULL)
                         OR (a.message_id IS NULL AND a.created_by = auth.uid()))
                    AND public.team_chat_can_read(a.thread_id));
END;
$$;
REVOKE ALL ON FUNCTION public.team_file_can_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_file_can_read(text) TO authenticated;

DROP POLICY IF EXISTS team_files_object_insert ON storage.objects;
CREATE POLICY team_files_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'team-files' AND public.team_file_can_upload(name));

DROP POLICY IF EXISTS team_files_object_select ON storage.objects;
CREATE POLICY team_files_object_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'team-files' AND public.team_file_can_read(name));
-- No UPDATE or DELETE policy: a file is never replaced in place; archiving
-- its row (or deleting its message) stops it being served at once.

-- ---------------------------------------------------------------------------
-- 5. The Mingla team thread and its membership.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.team_chat_team_thread() RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT t.id INTO v_id FROM public.team_threads t WHERE t.kind = 'team';
  IF v_id IS NULL THEN
    INSERT INTO public.team_threads (kind, title) VALUES ('team', 'Mingla team')
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN SELECT t.id INTO v_id FROM public.team_threads t WHERE t.kind = 'team'; END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_team_thread() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_chat_team_thread() TO service_role;

-- Bring one person's Mingla team membership in line with whether they are
-- staff now. Returns true when anything changed.
CREATE FUNCTION public.team_chat_sync_user(p_user_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_team uuid; v_staff boolean; v_n integer;
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;
  v_staff := public.team_chat_staff(p_user_id);
  v_team := public.team_chat_team_thread();
  IF v_staff THEN
    INSERT INTO public.team_thread_members (thread_id, user_id, role)
    VALUES (v_team, p_user_id, 'member')
    ON CONFLICT (thread_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now(), updated_at = now()
      WHERE team_thread_members.left_at IS NOT NULL;
  ELSE
    UPDATE public.team_thread_members m SET left_at = now(), updated_at = now()
     WHERE m.thread_id = v_team AND m.user_id = p_user_id AND m.left_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_sync_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_chat_sync_user(uuid) TO service_role;

-- Everyone at once: every account whose address is on a staff row now, plus
-- every current member of the team thread.
CREATE FUNCTION public.team_chat_sync_team() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_uid uuid; v_changed integer := 0; v_team uuid := public.team_chat_team_thread();
BEGIN
  FOR v_uid IN
    SELECT u.id FROM auth.users u
     WHERE EXISTS (SELECT 1 FROM public.admin_users a WHERE lower(btrim(a.email)) = lower(btrim(u.email)))
        OR EXISTS (SELECT 1 FROM public.admin_team_members t WHERE t.email = lower(btrim(u.email)))
    UNION
    SELECT m.user_id FROM public.team_thread_members m WHERE m.thread_id = v_team AND m.left_at IS NULL
  LOOP
    IF public.team_chat_sync_user(v_uid) THEN v_changed := v_changed + 1; END IF;
  END LOOP;
  RETURN v_changed;
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_sync_team() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_chat_sync_team() TO service_role;
COMMENT ON FUNCTION public.team_chat_sync_team() IS
  'Issue #4255. Makes the Mingla team thread''s membership match the staff tables: active, confirmed staff in; everyone else marked left. Runs on every staff-table change and once as a backfill.';

-- A staff row changed (added, activated, revoked, removed, address changed).
CREATE FUNCTION public.team_chat_staff_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM public.team_chat_sync_team();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_staff_changed() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER team_chat_sync_admin_users
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_users
  FOR EACH STATEMENT EXECUTE FUNCTION public.team_chat_staff_changed();
CREATE TRIGGER team_chat_sync_admin_team_members
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_team_members
  FOR EACH STATEMENT EXECUTE FUNCTION public.team_chat_staff_changed();

-- A sign-in account was made, confirmed, banned or changed address. Every
-- other update (each sign-in writes last_sign_in_at) returns at once. A
-- failure here must never stop someone signing in: it is logged as a
-- warning, and team_list_threads re-syncs the caller on every read.
CREATE FUNCTION public.team_chat_auth_user_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_new jsonb := to_jsonb(NEW); v_old jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    IF v_new->'email' IS NOT DISTINCT FROM v_old->'email'
       AND v_new->'email_confirmed_at' IS NOT DISTINCT FROM v_old->'email_confirmed_at'
       AND v_new->'banned_until' IS NOT DISTINCT FROM v_old->'banned_until'
       AND v_new->'deleted_at' IS NOT DISTINCT FROM v_old->'deleted_at' THEN
      RETURN NULL;
    END IF;
  END IF;
  BEGIN
    IF public.team_chat_staff(NEW.id)
       OR EXISTS (SELECT 1 FROM public.team_thread_members m JOIN public.team_threads t ON t.id = m.thread_id
                   WHERE t.kind = 'team' AND m.user_id = NEW.id AND m.left_at IS NULL) THEN
      PERFORM public.team_chat_sync_user(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'team_chat_auth_user_changed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.team_chat_auth_user_changed() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER team_chat_sync_auth_user
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.team_chat_auth_user_changed();

-- Backfill once: the thread and today's staff.
SELECT public.team_chat_sync_team();

-- ---------------------------------------------------------------------------
-- 6. Team mentions may come from a team chat message.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_mentions DROP CONSTRAINT team_mentions_source_kind_check;
ALTER TABLE public.team_mentions ADD CONSTRAINT team_mentions_source_kind_check
  CHECK (source_kind IN ('content_calendar_comment', 'work_card', 'team_message'));

-- ---------------------------------------------------------------------------
-- 7. Realtime. postgres_changes runs every row through the reader's RLS, and
-- the policies above admit only live members who are staff. Attachments and
-- reads are fetched through functions, so they are not published.
-- ---------------------------------------------------------------------------
DO $realtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_threads') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.team_threads;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_thread_members') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.team_thread_members;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.team_messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_message_reactions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.team_message_reactions;
    END IF;
  END IF;
END;
$realtime$;

-- ---------------------------------------------------------------------------
-- 8. Notification categories (in-app and push, the Host app). The drain
-- skips an unknown category, so a missing seed would silently drop pushes:
-- the suite asserts these rows.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES
  ('business.team_message',  'team', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('business.team_mention',  'team', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true),
  ('business.team_decision', 'team', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;
