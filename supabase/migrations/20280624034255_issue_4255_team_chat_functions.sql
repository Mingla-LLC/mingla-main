-- Issue #4255 (Work board v2, wave W1b): Mingla team chat, database layer 2 of 2.
-- Builds on 20280624024255_issue_4255_team_chat_schema.sql.
--
-- Client functions (authenticated; every one refuses anyone who is not
-- confirmed, active staff, and every write refuses a connected agent):
--   team_people()                                  teammates to start a chat with
--   team_list_threads()                            chats with unread counts, plus the badge
--   team_get_messages(thread, limit, before)       one page of a chat, with the chat and its members
--   team_post(thread, body, mentions, reply_to, attachment_ids, everyone, request_key)
--   team_edit(message, body, expected_revision)    PT409 on a stale revision
--   team_delete(message, expected_revision)        soft; PT409 on a stale revision
--   team_react(message, emoji, on)
--   team_mark_read(thread)
--   team_group_create(title, member_ids)
--   team_group_update(thread, title, expected_revision)   PT409 on a stale revision
--   team_dm_open(user_id)
--   team_members_add(thread, user_ids)
--   team_member_remove(thread, user_id)            yourself = leave
--   team_mute(thread, muted)
--   team_badge()                                   one call: team unread + unread mentions
--   team_attachment_add(thread, file)              a photo, document or link; the upload path
--   team_attachment_sign(attachment)               what a signed link is made from
-- Internal: team_chat_ctx, team_chat_name, team_chat_uploaded,
--   team_attachment_json, team_message_json, team_thread_json,
--   team_chat_unread, team_chat_enqueue (the one notification_outbox producer).
-- Changed (latest bodies copied, counted edits marked "#4255 W1b"):
--   ops_notify_people (from 20280524004255): a card-thread notice also
--     queues one business.team_mention push to that teammate's Host app;
--     in-app and email unchanged.
--   issue_4255_auto_card_withdraw_email (from 20280524004255): withdraws
--     that push too when it withdraws the email.
--   team_inbox (from 20280114004130): team chat mentions appear, with their
--     chat; mentions of a deleted message are hidden.
--
-- Conflicts raise PT409, never 40001. Static SQL only.

-- ---------------------------------------------------------------------------
-- 1. Internal helpers.
-- ---------------------------------------------------------------------------

-- The caller, if they may use team chat. p_write: refuse a connected agent
-- (agents never post in team chats). crm_ctx() is the one reader of the
-- gateway's request ledger (#3802 pins who reads it): its via is the agent
-- acting in this transaction, or NULL for a person. A teammate without the
-- crm area cannot have an agent acting through Hosts and Creators either,
-- so its refusal reads as a person.
CREATE FUNCTION public.team_chat_ctx(p_write boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := auth.uid(); v_via text;
BEGIN
  IF v_me IS NULL OR NOT public.team_chat_staff(v_me) THEN
    RAISE EXCEPTION 'team_access_required: This space is for the Mingla team.' USING ERRCODE = '42501';
  END IF;
  IF p_write THEN
    BEGIN
      SELECT x.via INTO v_via FROM public.crm_ctx() x;
    EXCEPTION WHEN insufficient_privilege THEN
      v_via := NULL;
    END;
    IF v_via IS NOT NULL THEN
      RAISE EXCEPTION 'agents_cannot_post: Agents do not post in team chats.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_me;
END;
$$;

CREATE FUNCTION public.team_chat_name(p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE((SELECT public.crm_display_name(lower(btrim(u.email))) FROM auth.users u WHERE u.id = p_user_id), 'A teammate')
$$;

CREATE FUNCTION public.team_chat_uploaded(p_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_path IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'team-files' AND o.name = p_path);
END;
$$;

CREATE FUNCTION public.team_attachment_json(a public.team_message_attachments) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', a.id, 'thread_id', a.thread_id, 'message_id', a.message_id, 'kind', a.kind, 'name', a.name,
    'mime', a.mime, 'size_bytes', a.size_bytes, 'url', a.url, 'width', a.width, 'height', a.height,
    'uploaded', a.kind = 'link' OR public.team_chat_uploaded(a.storage_path),
    'created_by', a.created_by, 'created_at', a.created_at)
$$;

CREATE FUNCTION public.team_message_json(m public.team_messages, p_me uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object('id', m.id, 'thread_id', m.thread_id, 'author_id', m.author_id,
    'author_name', public.team_chat_name(m.author_id),
    'body', CASE WHEN m.deleted_at IS NULL THEN m.body_md END,
    'mentions', CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', x, 'name', public.team_chat_name(x)) ORDER BY x) FROM unnest(m.mentions) x), '[]'::jsonb) ELSE '[]'::jsonb END,
    'everyone', m.mention_everyone AND m.deleted_at IS NULL,
    'reply_to', CASE WHEN m.reply_to_id IS NOT NULL THEN (SELECT jsonb_build_object('id', r.id, 'author_name', public.team_chat_name(r.author_id),
                    'excerpt', CASE WHEN r.deleted_at IS NULL THEN left(COALESCE(public.ops_one_line(r.body_md), ''), 120) END, 'deleted', r.deleted_at IS NOT NULL)
                  FROM public.team_messages r WHERE r.id = m.reply_to_id) END,
    'created_at', m.created_at, 'edited_at', m.edited_at, 'deleted', m.deleted_at IS NOT NULL, 'revision', m.revision,
    'mine', m.author_id = p_me,
    'reactions', CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine, 'names', r.names) ORDER BY r.first_at)
       FROM (SELECT x.emoji, count(*) AS n, bool_or(x.user_id = p_me) AS mine, min(x.created_at) AS first_at,
                    jsonb_agg(public.team_chat_name(x.user_id) ORDER BY x.created_at) AS names
               FROM public.team_message_reactions x WHERE x.message_id = m.id GROUP BY x.emoji) r), '[]'::jsonb) ELSE '[]'::jsonb END,
    'attachments', CASE WHEN m.deleted_at IS NULL THEN COALESCE((SELECT jsonb_agg(public.team_attachment_json(a) ORDER BY a.created_at, a.id)
       FROM public.team_message_attachments a WHERE a.message_id = m.id AND a.archived_at IS NULL), '[]'::jsonb) ELSE '[]'::jsonb END)
$$;

-- Unread messages for one member of one chat: after their last read (or,
-- never read, after they joined), not their own, not deleted.
CREATE FUNCTION public.team_chat_unread(p_thread_id uuid, p_user_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer FROM public.team_messages m
   WHERE m.thread_id = p_thread_id AND m.deleted_at IS NULL AND m.author_id IS DISTINCT FROM p_user_id
     AND m.created_at > COALESCE((SELECT r.last_read_at FROM public.team_reads r WHERE r.thread_id = p_thread_id AND r.user_id = p_user_id),
                                 (SELECT tm.joined_at FROM public.team_thread_members tm WHERE tm.thread_id = p_thread_id AND tm.user_id = p_user_id),
                                 '-infinity'::timestamptz)
$$;

CREATE FUNCTION public.team_thread_json(t public.team_threads, p_me uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
  WITH other AS (
    SELECT m.user_id FROM public.team_thread_members m
     WHERE t.kind = 'dm' AND m.thread_id = t.id AND m.user_id <> p_me LIMIT 1
  ), last AS (
    SELECT x.* FROM public.team_messages x WHERE x.thread_id = t.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC, x.id DESC LIMIT 1
  ), me AS (
    SELECT m.* FROM public.team_thread_members m WHERE m.thread_id = t.id AND m.user_id = p_me
  )
  SELECT jsonb_build_object('id', t.id, 'kind', t.kind,
    'title', CASE WHEN t.kind = 'dm' THEN public.team_chat_name((SELECT user_id FROM other)) ELSE t.title END,
    'other_user_id', (SELECT user_id FROM other),
    'member_count', (SELECT count(*) FROM public.team_thread_members m WHERE m.thread_id = t.id AND m.left_at IS NULL),
    'my_role', (SELECT role FROM me), 'muted', COALESCE((SELECT muted FROM me), false),
    'unread', public.team_chat_unread(t.id, p_me),
    'unread_mentions', (SELECT count(*) FROM public.team_mentions tm JOIN public.team_messages x ON x.id = tm.source_id
                         WHERE tm.source_kind = 'team_message' AND tm.target_user_id = p_me AND tm.read_at IS NULL
                           AND x.thread_id = t.id AND x.deleted_at IS NULL),
    'last_message', (SELECT jsonb_build_object('id', l.id, 'author_id', l.author_id, 'author_name', public.team_chat_name(l.author_id), 'at', l.created_at,
        'preview', COALESCE(left(public.ops_one_line(l.body_md), 120),
          (SELECT CASE WHEN count(*) = 0 THEN NULL
                       WHEN bool_and(a.kind = 'image') THEN 'Photo'
                       WHEN bool_and(a.kind = 'link') THEN 'Link'
                       ELSE 'Document' END
             FROM public.team_message_attachments a WHERE a.message_id = l.id AND a.archived_at IS NULL)))
      FROM last l),
    'last_message_at', t.last_message_at, 'created_at', t.created_at, 'archived', t.archived_at IS NOT NULL, 'revision', t.revision)
$$;

-- The one producer of team chat notices (#1529 catalog: populating, with an
-- explicit NULL country_code, since no team category routes SMS). Payloads
-- carry ids and counts only: titles and bodies come from the templates.
--   * Mentioned members, everyone in an @everyone message, and the author of
--     the message replied to get a team_mentions row (in-app) and one
--     business.team_mention row. Muting a chat does not silence these.
--   * Everyone else in a DM gets business.team_message (pushes by default).
--   * Everyone else in a group or the Mingla team gets business.team_message
--     only after switching message pushes on (an explicit push preference),
--     and never while the chat is muted.
--   * Nobody is queued who switched both in-app and push off for that kind.
CREATE FUNCTION public.team_chat_enqueue(p_message_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  m public.team_messages; t public.team_threads; v_uid uuid; v_reason text; v_mention uuid; v_told integer := 0;
  v_reply_author uuid; v_count integer; v_kinds text; v_excerpt text; v_link text;
BEGIN
  SELECT * INTO m FROM public.team_messages x WHERE x.id = p_message_id AND x.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT * INTO t FROM public.team_threads x WHERE x.id = m.thread_id;
  SELECT r.author_id INTO v_reply_author FROM public.team_messages r WHERE r.id = m.reply_to_id AND r.deleted_at IS NULL;
  SELECT count(*), CASE WHEN count(*) = 0 THEN NULL WHEN count(DISTINCT a.kind) = 1 THEN min(a.kind) ELSE 'mixed' END
    INTO v_count, v_kinds
    FROM public.team_message_attachments a WHERE a.message_id = m.id AND a.archived_at IS NULL;
  v_excerpt := COALESCE(left(public.ops_one_line(m.body_md), 280),
                        CASE WHEN v_count = 1 AND v_kinds = 'image' THEN 'sent a photo'
                             WHEN v_count = 1 AND v_kinds = 'link' THEN 'sent a link'
                             WHEN v_count = 1 THEN 'sent a file'
                             ELSE format('sent %s files', v_count) END);
  v_link := 'mingla-business://team/' || t.id::text;

  FOR v_uid, v_reason IN
    SELECT tm.user_id,
           CASE WHEN tm.user_id = ANY (m.mentions) THEN 'mention'
                WHEN m.mention_everyone AND t.kind <> 'dm' THEN 'everyone'
                WHEN tm.user_id = v_reply_author THEN 'reply'
                ELSE NULL END
      FROM public.team_thread_members tm
     WHERE tm.thread_id = t.id AND tm.left_at IS NULL AND tm.user_id IS DISTINCT FROM m.author_id
     ORDER BY tm.user_id
  LOOP
    CONTINUE WHEN NOT public.team_chat_staff(v_uid);
    IF v_reason IS NOT NULL THEN
      v_mention := NULL;
      INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link)
      VALUES ('team_message', m.id, m.author_id, v_uid, v_excerpt,
              'https://admin.usemingla.com/#/messages?thread=' || t.id::text)
      ON CONFLICT (source_kind, source_id, target_user_id) DO NOTHING
      RETURNING id INTO v_mention;
      CONTINUE WHEN v_mention IS NULL;
      IF public.can_send(v_uid, 'business.team_mention', 'push', NULL) OR public.can_send(v_uid, 'business.team_mention', 'inapp', NULL) THEN
        INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
        VALUES ('business.team_mention', v_uid, NULL,
          jsonb_build_object('source_kind', 'team_message', 'reason', v_reason, 'mention_id', v_mention,
            'thread_id', t.id, 'thread_kind', t.kind, 'message_id', m.id, 'actor_user_id', m.author_id,
            'attachment_count', v_count, 'attachment_kind', v_kinds, 'deep_link', v_link),
          'business.team_mention:' || v_mention::text, 'pending')
        ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
      v_told := v_told + 1;
    ELSE
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.team_thread_members x WHERE x.thread_id = t.id AND x.user_id = v_uid AND x.muted);
      IF t.kind = 'dm' THEN
        CONTINUE WHEN NOT (public.can_send(v_uid, 'business.team_message', 'push', NULL) OR public.can_send(v_uid, 'business.team_message', 'inapp', NULL));
      ELSE
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.notification_channel_prefs p
                                   WHERE p.user_id = v_uid AND p.category_key = 'business.team_message' AND p.channel = 'push' AND p.enabled);
      END IF;
      INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
      VALUES ('business.team_message', v_uid, NULL,
        jsonb_build_object('source_kind', 'team_message', 'thread_id', t.id, 'thread_kind', t.kind, 'message_id', m.id,
          'actor_user_id', m.author_id, 'attachment_count', v_count, 'attachment_kind', v_kinds, 'deep_link', v_link),
        'business.team_message:' || m.id::text || ':' || v_uid::text, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_told := v_told + 1;
    END IF;
  END LOOP;
  RETURN v_told;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reading.
-- ---------------------------------------------------------------------------

-- Teammates who can be in a chat: confirmed, active staff.
CREATE FUNCTION public.team_people() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(false);
BEGIN
  PERFORM public.team_chat_sync_team();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('user_id', p.id, 'name', public.team_chat_name(p.id), 'email', p.email, 'me', p.id = v_me)
                     ORDER BY public.team_chat_name(p.id), p.id)
      FROM (SELECT u.id, lower(btrim(u.email)) AS email FROM public.team_thread_members m
              JOIN public.team_threads t ON t.id = m.thread_id AND t.kind = 'team'
              JOIN auth.users u ON u.id = m.user_id
             WHERE m.left_at IS NULL) p
     WHERE public.team_chat_staff(p.id)), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.team_list_threads() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(false); v_threads jsonb;
BEGIN
  -- The Mingla team follows the staff directory (no trigger sits on the
  -- staff tables; see the schema file).
  PERFORM public.team_chat_sync_team();
  SELECT COALESCE(jsonb_agg(public.team_thread_json(t, v_me)
                            ORDER BY (t.kind = 'team') DESC, COALESCE(t.last_message_at, t.created_at) DESC, t.id), '[]'::jsonb)
    INTO v_threads
    FROM public.team_threads t
    JOIN public.team_thread_members m ON m.thread_id = t.id AND m.user_id = v_me AND m.left_at IS NULL
   WHERE t.archived_at IS NULL;
  RETURN jsonb_build_object('threads', v_threads, 'badge', public.team_badge());
END;
$$;

-- One page of a chat, oldest first, newest page first (p_before pages back).
-- A deleted message stays as a stub with no words or files.
CREATE FUNCTION public.team_get_messages(p_thread_id uuid, p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(false); t public.team_threads; v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
        v_rows jsonb; v_more boolean;
BEGIN
  SELECT * INTO t FROM public.team_threads x WHERE x.id = p_thread_id;
  IF NOT FOUND OR NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(public.team_message_json(x, v_me) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT m.* FROM public.team_messages m
           WHERE m.thread_id = t.id AND (p_before IS NULL OR m.created_at < p_before)
           ORDER BY m.created_at DESC, m.id DESC LIMIT v_limit) x;
  SELECT EXISTS (SELECT 1 FROM public.team_messages m
                  WHERE m.thread_id = t.id AND m.created_at < COALESCE((SELECT min((e->>'created_at')::timestamptz) FROM jsonb_array_elements(v_rows) e), '-infinity'::timestamptz))
    INTO v_more;
  RETURN jsonb_build_object('thread', public.team_thread_json(t, v_me),
    'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', public.team_chat_name(m.user_id), 'role', m.role) ORDER BY public.team_chat_name(m.user_id), m.user_id)
                           FROM public.team_thread_members m WHERE m.thread_id = t.id AND m.left_at IS NULL), '[]'::jsonb),
    'messages', v_rows, 'has_more', v_more, 'limit', v_limit);
END;
$$;

-- The one count for the Host app icon and the Admin Messages button: chats
-- with unread messages (muted chats left out) plus unread mentions. A
-- signed-in person who is not staff gets staff false and zeros, so the
-- icon stays hidden without an error.
CREATE FUNCTION public.team_badge() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := auth.uid(); v_chats integer; v_messages integer; v_mentions integer;
BEGIN
  IF v_me IS NULL OR NOT public.team_chat_staff(v_me) THEN
    RETURN jsonb_build_object('staff', false, 'chats', 0, 'messages', 0, 'mentions', 0, 'total', 0);
  END IF;
  SELECT count(*) FILTER (WHERE u.n > 0), COALESCE(sum(u.n), 0) INTO v_chats, v_messages
    FROM (SELECT public.team_chat_unread(t.id, v_me) AS n
            FROM public.team_threads t
            JOIN public.team_thread_members m ON m.thread_id = t.id AND m.user_id = v_me AND m.left_at IS NULL AND NOT m.muted
           WHERE t.archived_at IS NULL) u;
  SELECT count(*) INTO v_mentions FROM public.team_mentions tm
    LEFT JOIN public.team_messages x ON tm.source_kind = 'team_message' AND x.id = tm.source_id
   WHERE tm.target_user_id = v_me AND tm.read_at IS NULL
     AND (tm.source_kind <> 'team_message' OR (x.deleted_at IS NULL AND public.team_chat_can_read(x.thread_id)));
  RETURN jsonb_build_object('staff', true, 'chats', v_chats, 'messages', v_messages, 'mentions', v_mentions, 'total', v_chats + v_mentions);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Writing messages.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.team_post(p_thread_id uuid, p_body text, p_mentions uuid[] DEFAULT '{}'::uuid[], p_reply_to_id uuid DEFAULT NULL,
                                 p_attachment_ids uuid[] DEFAULT NULL, p_everyone boolean DEFAULT false, p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_me uuid := public.team_chat_ctx(true); t public.team_threads; m public.team_messages; r public.team_messages;
  v_body text := COALESCE(public.ops_multi_line(p_body), '');
  v_files uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_attachment_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL);
  v_mentions uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_mentions, ARRAY[]::uuid[])) x WHERE x IS NOT NULL);
  v_ok integer; v_told integer; v_everyone boolean := COALESCE(p_everyone, false); v_key text := NULLIF(btrim(COALESCE(p_request_key, '')), '');
BEGIN
  IF v_key IS NOT NULL THEN
    IF char_length(v_key) NOT BETWEEN 8 AND 120 THEN
      RAISE EXCEPTION 'invalid_request_key: A request key is 8 to 120 characters.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO m FROM public.team_messages x WHERE x.author_id = v_me AND x.request_key = v_key;
    IF FOUND THEN
      IF m.thread_id <> p_thread_id THEN
        RAISE EXCEPTION 'stale_write: That request key was used for another chat.' USING ERRCODE = 'PT409';
      END IF;
      RETURN jsonb_build_object('message', public.team_message_json(m, v_me), 'told', 0, 'replayed', true);
    END IF;
  END IF;
  SELECT * INTO t FROM public.team_threads x WHERE x.id = p_thread_id;
  IF NOT FOUND OR NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  IF t.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_archived: This chat is archived.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_body) > 10000 OR public.ops_has_control(v_body) THEN
    RAISE EXCEPTION 'invalid_message: A message is up to 10,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_files) > 10 THEN
    RAISE EXCEPTION 'too_many_files: A message carries up to 10 attachments.' USING ERRCODE = '22023';
  END IF;
  IF v_body = '' AND cardinality(v_files) = 0 THEN
    RAISE EXCEPTION 'invalid_message: Write something or attach a file.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_ok FROM public.team_message_attachments a
   WHERE a.id = ANY (v_files) AND a.thread_id = t.id AND a.message_id IS NULL AND a.archived_at IS NULL
     AND a.created_by = v_me AND (a.kind = 'link' OR public.team_chat_uploaded(a.storage_path));
  IF v_ok <> cardinality(v_files) THEN
    RAISE EXCEPTION 'invalid_message: An attachment is not in this chat, is already in a message, or has not finished uploading.' USING ERRCODE = '22023';
  END IF;
  IF p_reply_to_id IS NOT NULL THEN
    SELECT * INTO r FROM public.team_messages x WHERE x.id = p_reply_to_id;
    IF NOT FOUND OR r.thread_id <> t.id OR r.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'not_found: That message is no longer in this chat.' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF v_everyone THEN
    IF t.kind = 'dm' THEN
      RAISE EXCEPTION 'invalid_message: Everyone works in a group or the Mingla team, not a direct message.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.team_chat_admin(v_me) THEN
      RAISE EXCEPTION 'forbidden: Only the owner or an admin can mention everyone.' USING ERRCODE = '42501';
    END IF;
    -- One at a time per sender, so two tabs cannot both pass the check.
    PERFORM pg_advisory_xact_lock(hashtextextended('team_everyone:' || v_me::text, 0));
    IF EXISTS (SELECT 1 FROM public.team_messages x WHERE x.author_id = v_me AND x.mention_everyone
                AND x.created_at > clock_timestamp() - interval '10 minutes') THEN
      RAISE EXCEPTION 'too_soon: You mentioned everyone in the last 10 minutes. Mention the people who need it.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF cardinality(v_mentions) > 20 THEN
    RAISE EXCEPTION 'too_many_mentions: Mention at most 20 teammates in one message.' USING ERRCODE = '22023';
  END IF;
  v_mentions := ARRAY(SELECT x FROM unnest(v_mentions) x WHERE x <> v_me);
  IF EXISTS (SELECT 1 FROM unnest(v_mentions) x
              WHERE NOT EXISTS (SELECT 1 FROM public.team_thread_members tm WHERE tm.thread_id = t.id AND tm.user_id = x AND tm.left_at IS NULL)
                 OR NOT public.team_chat_staff(x)) THEN
    RAISE EXCEPTION 'invalid_mention_recipient: Mention only people in this chat.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    INSERT INTO public.team_messages (thread_id, author_id, body_md, reply_to_id, mentions, mention_everyone, created_at, request_key)
    VALUES (t.id, v_me, v_body, r.id, v_mentions, v_everyone, clock_timestamp(), v_key)
    RETURNING * INTO m;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'stale_write: This message is already being sent. Reload the chat.' USING ERRCODE = 'PT409';
  END;
  UPDATE public.team_message_attachments a SET message_id = m.id WHERE a.id = ANY (v_files);
  UPDATE public.team_threads x SET last_message_at = m.created_at, updated_at = now() WHERE x.id = t.id;
  INSERT INTO public.team_reads (thread_id, user_id, last_read_at, updated_at) VALUES (t.id, v_me, m.created_at, now())
  ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = GREATEST(team_reads.last_read_at, EXCLUDED.last_read_at), updated_at = now();
  -- The Mingla team is told as the staff directory stands now.
  IF t.kind = 'team' THEN PERFORM public.team_chat_sync_team(); END IF;
  v_told := public.team_chat_enqueue(m.id);
  RETURN jsonb_build_object('message', public.team_message_json(m, v_me), 'told', v_told, 'replayed', false);
END;
$$;

-- The author's own live message at the revision they saw (else PT409).
CREATE FUNCTION public.team_message_mine(p_message_id uuid, p_expected_revision bigint) RETURNS public.team_messages
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); m public.team_messages;
BEGIN
  SELECT * INTO m FROM public.team_messages x WHERE x.id = p_message_id FOR UPDATE;
  IF NOT FOUND OR m.deleted_at IS NOT NULL OR NOT public.team_chat_can_read(m.thread_id) THEN
    RAISE EXCEPTION 'not_found: That message is no longer in this chat.' USING ERRCODE = 'P0002';
  END IF;
  IF m.author_id IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'forbidden: You can change only your own messages.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR m.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This message changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  RETURN m;
END;
$$;

CREATE FUNCTION public.team_edit(p_message_id uuid, p_body text, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); m public.team_messages; v_body text := COALESCE(public.ops_multi_line(p_body), '');
BEGIN
  m := public.team_message_mine(p_message_id, p_expected_revision);
  IF char_length(v_body) > 10000 OR public.ops_has_control(v_body) THEN
    RAISE EXCEPTION 'invalid_message: A message is up to 10,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF v_body = '' AND NOT EXISTS (SELECT 1 FROM public.team_message_attachments a WHERE a.message_id = m.id AND a.archived_at IS NULL) THEN
    RAISE EXCEPTION 'invalid_message: Write something, or delete the message.' USING ERRCODE = '22023';
  END IF;
  IF v_body = m.body_md THEN
    RETURN jsonb_build_object('message', public.team_message_json(m, v_me), 'changed', false);
  END IF;
  UPDATE public.team_messages x SET body_md = v_body, edited_at = clock_timestamp(), revision = x.revision + 1
   WHERE x.id = m.id RETURNING * INTO m;
  RETURN jsonb_build_object('message', public.team_message_json(m, v_me), 'changed', true);
END;
$$;

-- Soft delete: the words, mentions, reactions and attachments go at once
-- (attachments stop being served; the files are purged later).
CREATE FUNCTION public.team_delete(p_message_id uuid, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); m public.team_messages;
BEGIN
  m := public.team_message_mine(p_message_id, p_expected_revision);
  UPDATE public.team_messages x SET deleted_at = clock_timestamp(), body_md = '', mentions = ARRAY[]::uuid[], revision = x.revision + 1
   WHERE x.id = m.id RETURNING * INTO m;
  UPDATE public.team_message_attachments a SET archived_at = now() WHERE a.message_id = m.id AND a.archived_at IS NULL;
  DELETE FROM public.team_message_reactions r WHERE r.message_id = m.id;
  UPDATE public.team_mentions tm SET read_at = COALESCE(tm.read_at, now()) WHERE tm.source_kind = 'team_message' AND tm.source_id = m.id;
  RETURN jsonb_build_object('message', public.team_message_json(m, v_me), 'changed', true);
END;
$$;

CREATE FUNCTION public.team_react(p_message_id uuid, p_emoji text, p_on boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); m public.team_messages; v_emoji text := btrim(COALESCE(p_emoji, ''));
BEGIN
  SELECT * INTO m FROM public.team_messages x WHERE x.id = p_message_id;
  IF NOT FOUND OR m.deleted_at IS NOT NULL OR NOT public.team_chat_can_read(m.thread_id) THEN
    RAISE EXCEPTION 'not_found: That message is no longer in this chat.' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(v_emoji) NOT BETWEEN 1 AND 16 OR v_emoji ~ '[[:space:][:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_reaction: React with one emoji.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_on, true) THEN
    INSERT INTO public.team_message_reactions (message_id, user_id, emoji) VALUES (m.id, v_me, v_emoji) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.team_message_reactions r WHERE r.message_id = m.id AND r.user_id = v_me AND r.emoji = v_emoji;
  END IF;
  RETURN jsonb_build_object('message', public.team_message_json(m, v_me));
END;
$$;

-- Read up to now: the chat's unread count and its mentions for you.
CREATE FUNCTION public.team_mark_read(p_thread_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(false); v_n integer;
BEGIN
  IF NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.team_reads (thread_id, user_id, last_read_at, updated_at) VALUES (p_thread_id, v_me, clock_timestamp(), now())
  ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = GREATEST(team_reads.last_read_at, EXCLUDED.last_read_at), updated_at = now();
  UPDATE public.team_mentions tm SET read_at = now()
    FROM public.team_messages x
   WHERE tm.source_kind = 'team_message' AND tm.source_id = x.id AND x.thread_id = p_thread_id
     AND tm.target_user_id = v_me AND tm.read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('thread_id', p_thread_id, 'mentions_read', v_n, 'badge', public.team_badge());
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Chats and members.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.team_group_create(p_title text, p_member_ids uuid[] DEFAULT '{}'::uuid[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); t public.team_threads; v_title text := public.ops_one_line(p_title);
        v_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL);
BEGIN
  IF v_title IS NULL OR char_length(v_title) > 80 OR public.ops_has_control(v_title) THEN
    RAISE EXCEPTION 'invalid_title: Name the group in 1 to 80 characters.' USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT x FROM unnest(v_ids) x WHERE x <> v_me);
  IF cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'too_many_members: A group holds up to 100 teammates.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE NOT public.team_chat_staff(x)) THEN
    RAISE EXCEPTION 'invalid_member: Only Mingla teammates can be in a team chat.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.team_threads (kind, title, created_by) VALUES ('group', v_title, v_me) RETURNING * INTO t;
  INSERT INTO public.team_thread_members (thread_id, user_id, role, added_by) VALUES (t.id, v_me, 'owner', v_me);
  INSERT INTO public.team_thread_members (thread_id, user_id, role, added_by) SELECT t.id, x, 'member', v_me FROM unnest(v_ids) x;
  RETURN jsonb_build_object('thread', public.team_thread_json(t, v_me));
END;
$$;

-- Rename a group at the revision you saw (else PT409).
CREATE FUNCTION public.team_group_update(p_thread_id uuid, p_title text, p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); t public.team_threads; v_title text := public.ops_one_line(p_title);
BEGIN
  SELECT * INTO t FROM public.team_threads x WHERE x.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  IF t.kind <> 'group' THEN
    RAISE EXCEPTION 'invalid_chat: Only a group can be renamed.' USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR t.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This group changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  IF v_title IS NULL OR char_length(v_title) > 80 OR public.ops_has_control(v_title) THEN
    RAISE EXCEPTION 'invalid_title: Name the group in 1 to 80 characters.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.team_threads x SET title = v_title, revision = x.revision + 1, updated_at = now() WHERE x.id = t.id RETURNING * INTO t;
  RETURN jsonb_build_object('thread', public.team_thread_json(t, v_me));
END;
$$;

-- The direct message with one teammate: the existing one, or a new one.
CREATE FUNCTION public.team_dm_open(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); t public.team_threads; v_key text;
BEGIN
  IF p_user_id IS NULL OR p_user_id = v_me OR NOT public.team_chat_staff(p_user_id) THEN
    RAISE EXCEPTION 'invalid_member: Message a Mingla teammate other than yourself.' USING ERRCODE = '22023';
  END IF;
  v_key := LEAST(v_me::text, p_user_id::text) || ':' || GREATEST(v_me::text, p_user_id::text);
  INSERT INTO public.team_threads (kind, dm_key, created_by) VALUES ('dm', v_key, v_me) ON CONFLICT (dm_key) DO NOTHING;
  SELECT * INTO t FROM public.team_threads x WHERE x.dm_key = v_key;
  INSERT INTO public.team_thread_members (thread_id, user_id, role, added_by)
  VALUES (t.id, v_me, 'member', v_me), (t.id, p_user_id, 'member', v_me)
  ON CONFLICT (thread_id, user_id) DO UPDATE SET left_at = NULL, updated_at = now() WHERE team_thread_members.left_at IS NOT NULL;
  RETURN jsonb_build_object('thread', public.team_thread_json(t, v_me));
END;
$$;

-- Any member of a group may add teammates.
CREATE FUNCTION public.team_members_add(p_thread_id uuid, p_user_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); t public.team_threads; v_n integer;
        v_ids uuid[] := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) x WHERE x IS NOT NULL);
BEGIN
  SELECT * INTO t FROM public.team_threads x WHERE x.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  IF t.kind <> 'group' THEN
    RAISE EXCEPTION 'invalid_chat: People are added to groups only. The Mingla team follows the staff list.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) = 0 OR cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'invalid_member: Add 1 to 100 teammates.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE NOT public.team_chat_staff(x)) THEN
    RAISE EXCEPTION 'invalid_member: Only Mingla teammates can be in a team chat.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.team_thread_members (thread_id, user_id, role, added_by)
  SELECT t.id, x, 'member', v_me FROM unnest(v_ids) x
  ON CONFLICT (thread_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now(), added_by = EXCLUDED.added_by, updated_at = now()
    WHERE team_thread_members.left_at IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN UPDATE public.team_threads x SET revision = x.revision + 1, updated_at = now() WHERE x.id = t.id RETURNING * INTO t; END IF;
  RETURN jsonb_build_object('thread', public.team_thread_json(t, v_me), 'added', v_n);
END;
$$;

-- Leave a group yourself, or (the group's owner, or an owner or admin)
-- take someone out.
CREATE FUNCTION public.team_member_remove(p_thread_id uuid, p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); t public.team_threads; v_n integer;
BEGIN
  SELECT * INTO t FROM public.team_threads x WHERE x.id = p_thread_id FOR UPDATE;
  IF NOT FOUND OR NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  IF t.kind <> 'group' THEN
    RAISE EXCEPTION 'invalid_chat: Only a group has people taken out. The Mingla team follows the staff list.' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS DISTINCT FROM v_me
     AND NOT EXISTS (SELECT 1 FROM public.team_thread_members m WHERE m.thread_id = t.id AND m.user_id = v_me AND m.role = 'owner' AND m.left_at IS NULL)
     AND NOT public.team_chat_admin(v_me) THEN
    RAISE EXCEPTION 'forbidden: Only the group''s owner or an admin can take someone out.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.team_thread_members m SET left_at = now(), updated_at = now()
   WHERE m.thread_id = t.id AND m.user_id = p_user_id AND m.left_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN UPDATE public.team_threads x SET revision = x.revision + 1, updated_at = now() WHERE x.id = t.id; END IF;
  RETURN jsonb_build_object('thread_id', t.id, 'removed', v_n);
END;
$$;

CREATE FUNCTION public.team_mute(p_thread_id uuid, p_muted boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(false);
BEGIN
  IF NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.team_thread_members m SET muted = COALESCE(p_muted, false), updated_at = now()
   WHERE m.thread_id = p_thread_id AND m.user_id = v_me;
  RETURN jsonb_build_object('thread_id', p_thread_id, 'muted', COALESCE(p_muted, false));
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Attachments (rev 4). Added before the message; a photo or document
-- gets a path to upload to (for 24 hours) and is attached by team_post once
-- the upload is there. 25 MB a file. Links are never fetched.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.team_attachment_add(p_thread_id uuid, p_file jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(true); t public.team_threads; a public.team_message_attachments;
        v_kind text; v_name text; v_mime text; v_size bigint; v_url text; v_id uuid := gen_random_uuid(); v_safe text; v_bad text;
        v_w integer; v_h integer;
BEGIN
  SELECT * INTO t FROM public.team_threads x WHERE x.id = p_thread_id;
  IF NOT FOUND OR NOT public.team_chat_can_read(p_thread_id) THEN
    RAISE EXCEPTION 'not_found: That chat is not here, or you are not in it.' USING ERRCODE = 'P0002';
  END IF;
  IF t.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_archived: This chat is archived.' USING ERRCODE = '22023';
  END IF;
  IF p_file IS NULL OR jsonb_typeof(p_file) <> 'object' THEN
    RAISE EXCEPTION 'invalid_file: Send the file''s kind, name, type and size, or a link.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM jsonb_object_keys(p_file) k WHERE k NOT IN ('kind','name','mime','size_bytes','url','width','height') LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '%', format('unknown_field: An attachment takes kind, name, mime, size_bytes, url, width and height, not "%s".', left(v_bad, 40)) USING ERRCODE = '22023';
  END IF;
  -- Unsent attachments: at most 30 waiting per person (a message takes 10).
  IF (SELECT count(*) FROM public.team_message_attachments x
       WHERE x.created_by = v_me AND x.message_id IS NULL AND x.archived_at IS NULL AND x.created_at > now() - interval '24 hours') >= 30 THEN
    RAISE EXCEPTION 'too_many_files: Send or remove the attachments you already added first.' USING ERRCODE = '22023';
  END IF;
  v_kind := p_file->>'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('image','document','link') THEN
    RAISE EXCEPTION 'invalid_file: An attachment is a photo, a document or a link.' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'link' THEN
    v_url := btrim(COALESCE(p_file->>'url', ''));
    IF char_length(v_url) NOT BETWEEN 9 AND 2000 OR v_url !~ '^https://[^[:space:]]+$' OR public.ops_has_control(v_url) THEN
      RAISE EXCEPTION 'invalid_file: Links start with https:// and stay under 2,000 characters.' USING ERRCODE = '22023';
    END IF;
    v_name := COALESCE(public.ops_one_line(p_file->>'name'), substring(v_url FROM '^https://([^/?#]+)'), 'Link');
  ELSE
    v_name := public.ops_one_line(p_file->>'name');
    v_mime := lower(btrim(COALESCE(p_file->>'mime', '')));
    IF jsonb_typeof(p_file->'size_bytes') IS DISTINCT FROM 'number' OR (p_file->>'size_bytes') !~ '^\d{1,12}$' THEN
      RAISE EXCEPTION 'invalid_file: Send the file''s size in bytes.' USING ERRCODE = '22023';
    END IF;
    v_size := (p_file->>'size_bytes')::bigint;
    IF v_size > 26214400 THEN
      RAISE EXCEPTION '%', format('file_too_big: %s is over 25 MB. Share it as a link instead.', COALESCE(left(v_name, 120), 'This file')) USING ERRCODE = '22023';
    END IF;
    IF v_size < 1 THEN RAISE EXCEPTION 'invalid_file: That file is empty.' USING ERRCODE = '22023'; END IF;
    IF NOT public.ops_file_mime_ok(v_kind, v_mime) THEN
      RAISE EXCEPTION '%', CASE WHEN v_kind = 'image' THEN 'invalid_file: Photos can be JPEG, PNG, WebP, GIF or HEIC.'
        ELSE 'invalid_file: Documents can be PDF, Word, Excel, PowerPoint, text, CSV, Keynote, Numbers or Pages.' END USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'image' AND (p_file ? 'width' OR p_file ? 'height') THEN
      IF (p_file->>'width') !~ '^\d{1,5}$' OR (p_file->>'height') !~ '^\d{1,5}$' THEN
        RAISE EXCEPTION 'invalid_file: Send a photo''s width and height in pixels.' USING ERRCODE = '22023';
      END IF;
      v_w := (p_file->>'width')::integer; v_h := (p_file->>'height')::integer;
      IF v_w NOT BETWEEN 1 AND 20000 OR v_h NOT BETWEEN 1 AND 20000 THEN
        RAISE EXCEPTION 'invalid_file: Send a photo''s width and height in pixels.' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_safe := left(btrim(regexp_replace(COALESCE(v_name, ''), '[^A-Za-z0-9._-]+', '_', 'g'), '_.'), 120);
    IF v_safe IS NULL OR v_safe = '' THEN v_safe := 'file'; END IF;
  END IF;
  IF v_name IS NULL OR char_length(v_name) > 200 OR public.ops_has_control(v_name) THEN
    RAISE EXCEPTION 'invalid_file: Name the file in 1 to 200 characters.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.team_message_attachments (id, thread_id, kind, name, mime, size_bytes, storage_path, url, width, height, created_by)
  VALUES (v_id, t.id, v_kind, v_name, CASE WHEN v_kind <> 'link' THEN v_mime END, v_size,
          CASE WHEN v_kind <> 'link' THEN t.id::text || '/' || v_id::text || '/' || v_safe END, v_url, v_w, v_h, v_me)
  RETURNING * INTO a;
  RETURN jsonb_build_object('attachment', public.team_attachment_json(a),
    'upload', CASE WHEN a.storage_path IS NOT NULL THEN jsonb_build_object('bucket', 'team-files', 'path', a.storage_path,
                                                                         'max_bytes', 26214400, 'expires_in_hours', 24) END);
END;
$$;

-- What a signed link is made from (storage checks team_file_can_read again).
-- Only live attachments of messages not deleted, to members who are staff.
CREATE FUNCTION public.team_attachment_sign(p_attachment_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := public.team_chat_ctx(false); a public.team_message_attachments;
BEGIN
  SELECT x.* INTO a FROM public.team_message_attachments x LEFT JOIN public.team_messages m ON m.id = x.message_id
   WHERE x.id = p_attachment_id AND x.archived_at IS NULL
     AND ((x.message_id IS NOT NULL AND m.deleted_at IS NULL) OR (x.message_id IS NULL AND x.created_by = v_me));
  IF NOT FOUND OR NOT public.team_chat_can_read(a.thread_id) THEN
    RAISE EXCEPTION 'not_found: That file is no longer here.' USING ERRCODE = 'P0002';
  END IF;
  IF a.kind = 'link' THEN
    RETURN jsonb_build_object('kind', 'link', 'url', a.url, 'name', a.name);
  END IF;
  IF NOT public.team_chat_uploaded(a.storage_path) THEN
    RAISE EXCEPTION 'not_uploaded: This file has not finished uploading. Try again in a moment.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('kind', a.kind, 'bucket', 'team-files', 'path', a.storage_path, 'expires_in', 300,
                            'name', a.name, 'mime', a.mime, 'size_bytes', a.size_bytes);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. ops_notify_people: latest body from
-- 20280524004255_issue_4255_work_card_email.sql, plus one push row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_notify_people(p_card_id uuid, p_event_id uuid, p_emails text[], p_actor_email text, p_excerpt text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_email text; v_uid uuid; v_actor uuid; v_mention uuid; v_told integer := 0;
  v_link text := 'https://admin.usemingla.com/#/work-board?card=' || p_card_id::text;
  v_excerpt text := COALESCE(left(public.ops_one_line(p_excerpt), 280), 'A work card changed.');
  v_card public.ops_work_cards;
  v_action text;
  v_card_title text;
  v_who text;
  v_cut integer;
  v_title text;
  v_email_ok boolean;
BEGIN
  SELECT * INTO v_card FROM public.ops_work_cards w WHERE w.id = p_card_id;
  SELECT e.action INTO v_action FROM public.ops_work_events e WHERE e.id = p_event_id;
  v_card_title := NULLIF(public.ops_one_line(v_card.title), '');

  -- Subject. A note tells only the people it tags: "<who> tagged you: <card>".
  -- Every other producer's excerpt already reads "<who> <did what>: <card>…".
  IF v_action = 'note' AND v_card_title IS NOT NULL THEN
    v_cut := position(' on ' || v_card_title || ': ' IN v_excerpt);
    v_who := CASE WHEN v_cut > 1 THEN left(v_excerpt, v_cut - 1) ELSE public.ops_name(p_actor_email) END;
    v_title := v_who || ' tagged you: ' || v_card_title;
  ELSIF v_card_title IS NOT NULL AND position(v_card_title IN v_excerpt) > 0 THEN
    v_title := v_excerpt;
  ELSIF v_card_title IS NOT NULL THEN
    v_title := public.ops_name(p_actor_email) || ' on a work card: ' || v_card_title;
  ELSE
    v_title := public.ops_name(p_actor_email) || ' on a work card';
  END IF;
  IF char_length(v_title) > 150 THEN v_title := left(v_title, 149) || '…'; END IF;

  -- Email only for cards a person should act on. A "Feature Guide is Live"
  -- card, or any automatic card already closed in the run that made it, is a
  -- bell item only.
  v_email_ok := NOT (
    v_card.auto_key IS NOT NULL AND (
      split_part(v_card.auto_key, ':', 1) = 'guide_live'
      OR (v_card.status = 'done' AND v_card.created_at = now())
    )
  );

  SELECT u.id INTO v_actor FROM auth.users u WHERE lower(btrim(u.email)) = lower(btrim(p_actor_email)) ORDER BY u.created_at LIMIT 1;
  FOR v_email IN SELECT DISTINCT lower(btrim(x)) FROM unnest(COALESCE(p_emails, ARRAY[]::text[])) x WHERE btrim(COALESCE(x, '')) <> '' LOOP
    CONTINUE WHEN v_email = lower(btrim(p_actor_email));
    v_uid := NULL;
    SELECT u.id INTO v_uid FROM auth.users u
     WHERE lower(btrim(u.email)) = v_email AND public.issue_3720_active_team_member(u.id)
     ORDER BY u.created_at LIMIT 1;
    CONTINUE WHEN v_uid IS NULL;
    v_mention := NULL;
    INSERT INTO public.team_mentions (source_kind, source_id, actor_user_id, target_user_id, body_excerpt, deep_link)
    VALUES ('work_card', p_event_id, v_actor, v_uid, v_excerpt, v_link)
    ON CONFLICT (source_kind, source_id, target_user_id) DO NOTHING
    RETURNING id INTO v_mention;
    CONTINUE WHEN v_mention IS NULL;
    IF v_email_ok THEN
      INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
      VALUES ('admin.team_mention', v_uid, NULL,
        jsonb_build_object('title', v_title, 'body', left(v_excerpt, 180), 'mention_id', v_mention,
          'source_kind', 'work_card', 'source_id', p_event_id, 'deep_link', v_link,
          'card_id', p_card_id, 'card_title', v_card_title),
        'admin.team_mention:' || v_mention::text, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
      -- #4255 W1b: one push to the teammate's Host app (Mentions there opens
      -- Admin at the card). Ids only; the template writes the words. Same
      -- quiet rule as the email; only a confirmed staff account.
      IF public.team_chat_staff(v_uid) THEN
        INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
        VALUES ('business.team_mention', v_uid, NULL,
          jsonb_build_object('source_kind', 'work_card', 'reason', CASE WHEN v_action = 'note' THEN 'mention' ELSE 'work_update' END,
            'mention_id', v_mention, 'source_id', p_event_id, 'card_id', p_card_id,
            'deep_link', 'mingla-business://team/mention/' || v_mention::text),
          'business.team_mention:' || v_mention::text, 'pending')
        ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END IF;
    v_told := v_told + 1;
  END LOOP;
  RETURN v_told;
END;
$$;
COMMENT ON FUNCTION public.ops_notify_people(uuid, uuid, text[], text, text) IS
  'Issue #3980/#4255. The one work-card notice producer: team_mentions plus admin.team_mention (no country, no text message) plus one business.team_mention push to the Host app of a confirmed staff account (#4255 W1b). The email subject names the card; guide_live cards and automatic cards closed in their own run get no email and no push.';

-- Latest body from 20280524004255_issue_4255_work_card_email.sql; the push
-- queued beside the email is withdrawn with it.
CREATE OR REPLACE FUNCTION public.issue_4255_auto_card_withdraw_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM public.notification_outbox o
   WHERE o.category_key IN ('admin.team_mention', 'business.team_mention') -- #4255 W1b: and its push
     AND o.status = 'pending'
     AND o.created_at = now()
     AND o.payload->>'card_id' = NEW.id::text;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. team_inbox: latest body from 20280114004130_issue_4130_dashboard_outreach_inbound.sql.
-- #4255 W1b: team chat mentions appear with their chat (thread_id,
-- message_id); a mention of a deleted message, or of a chat the reader has
-- left, is hidden.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_inbox(
  p_alert_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_types text[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.issue_3720_active_team_member(v_me) THEN
    RAISE EXCEPTION 'team_access_required' USING ERRCODE = '42501';
  END IF;
  v_types := public.team_inbox_alert_types(p_alert_types);

  RETURN (
    WITH m AS MATERIALIZED (
      SELECT tm.id, tm.source_kind, tm.created_at, tm.read_at, tm.body_excerpt, tm.deep_link,
             e.card_id, e.action,
             tmsg.thread_id, tmsg.id AS message_id, -- #4255 W1b
             public.team_inbox_kind(tm.source_kind, e.action) AS kind,
             COALESCE(
               CASE WHEN e.id IS NOT NULL THEN public.ops_actor_label(e.actor_email, e.via) END,
               public.crm_display_name(lower(btrim(u.email))),
               'A teammate') AS actor
        FROM public.team_mentions tm
        LEFT JOIN public.ops_work_events e ON tm.source_kind = 'work_card' AND e.id = tm.source_id
        LEFT JOIN public.team_messages tmsg ON tm.source_kind = 'team_message' AND tmsg.id = tm.source_id -- #4255 W1b
        LEFT JOIN auth.users u ON u.id = tm.actor_user_id
       WHERE tm.target_user_id = v_me
         AND (tm.source_kind <> 'team_message'
              OR (tmsg.deleted_at IS NULL AND public.team_chat_can_read(tmsg.thread_id))) -- #4255 W1b
    ), a AS MATERIALIZED (
      SELECT n.id, n.type, n.title, n.body, n.deep_link, n.data, n.created_at, n.read_at,
             public.team_inbox_ticket_resolved(n.data) AS ticket_resolved
        FROM public.notifications n
       WHERE n.user_id = v_me AND n.type = ANY (v_types)
         AND n.deleted_at IS NULL AND n.in_app_suppressed_at IS NULL
    )
    SELECT jsonb_build_object(
      'mentions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'kind', x.kind, 'source_kind', x.source_kind, 'card_id', x.card_id, 'action', x.action,
          'thread_id', x.thread_id, 'message_id', x.message_id, -- #4255 W1b
          'actor_name', x.actor, 'body_excerpt', x.body_excerpt, 'deep_link', x.deep_link,
          'created_at', x.created_at, 'read_at', x.read_at) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM m ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'alerts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'deep_link', x.deep_link,
          'data', x.data, 'created_at', x.created_at, 'read_at', x.read_at,
          'ticket_resolved', x.ticket_resolved) ORDER BY x.created_at DESC, x.id DESC)
        FROM (SELECT * FROM a ORDER BY created_at DESC, id DESC LIMIT v_limit) x), '[]'::jsonb),
      'unread', jsonb_build_object(
        'mentions', (SELECT count(*) FROM m WHERE kind = 'mention' AND read_at IS NULL),
        'work_updates', (SELECT count(*) FROM m WHERE kind = 'work_update' AND read_at IS NULL),
        'support', (SELECT count(*) FROM a WHERE read_at IS NULL AND NOT ticket_resolved))
    )
  );
END;
$$;
COMMENT ON FUNCTION public.team_inbox(text[], integer) IS
  'Issue #4130/#4255: the signed-in teammate''s own inbox. Mentions split into real mentions and Work updates with who did it (team chat mentions carry their thread_id and message_id; deleted or left ones are hidden); support alerts with whether their ticket is already resolved (then never unread). Own rows only.';
REVOKE ALL ON FUNCTION public.team_inbox(text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_inbox(text[], integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Grants. Internal helpers: nobody but the service role. Client
-- functions: signed-in people (each one checks staff itself).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.team_chat_ctx(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_chat_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_chat_uploaded(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_attachment_json(public.team_message_attachments) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_message_json(public.team_messages, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_thread_json(public.team_threads, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_chat_unread(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_chat_enqueue(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_message_mine(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_chat_ctx(boolean), public.team_chat_name(uuid), public.team_chat_uploaded(text),
  public.team_attachment_json(public.team_message_attachments), public.team_message_json(public.team_messages, uuid),
  public.team_thread_json(public.team_threads, uuid), public.team_chat_unread(uuid, uuid), public.team_chat_enqueue(uuid),
  public.team_message_mine(uuid, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.team_people() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_list_threads() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_get_messages(uuid, integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_badge() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_post(uuid, text, uuid[], uuid, uuid[], boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_edit(uuid, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_delete(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_react(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_mark_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_group_create(text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_group_update(uuid, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_dm_open(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_members_add(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_member_remove(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_mute(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_attachment_add(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_attachment_sign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_people(), public.team_list_threads(), public.team_get_messages(uuid, integer, timestamptz),
  public.team_badge(), public.team_post(uuid, text, uuid[], uuid, uuid[], boolean, text), public.team_edit(uuid, text, bigint),
  public.team_delete(uuid, bigint), public.team_react(uuid, text, boolean), public.team_mark_read(uuid),
  public.team_group_create(text, uuid[]), public.team_group_update(uuid, text, bigint), public.team_dm_open(uuid),
  public.team_members_add(uuid, uuid[]), public.team_member_remove(uuid, uuid), public.team_mute(uuid, boolean),
  public.team_attachment_add(uuid, jsonb), public.team_attachment_sign(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.team_post(uuid, text, uuid[], uuid, uuid[], boolean, text) IS
  'Issue #4255. Post in a team chat: words (up to 10,000 characters), up to 10 attachments already uploaded, or both; a reply; mentions of people in the chat; everyone (owner or admin, not in a DM, once every 10 minutes). Queues notices through team_chat_enqueue. Agents never post. A repeated request key returns the same message.';
COMMENT ON FUNCTION public.team_badge() IS
  'Issue #4255. One call for the Host app Mingla team icon and the Admin Messages button: chats with unread messages (not muted) plus unread mentions. staff false (and zeros) for a signed-in person who is not staff.';
