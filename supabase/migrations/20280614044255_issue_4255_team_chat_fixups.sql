-- Issue #4255 (Work board v2 + Mingla team) fix-up, approved by Seth 10 Nov.
-- Builds on 20280614024255_issue_4255_team_chat_schema.sql and
-- 20280614034255_issue_4255_team_chat_functions.sql (the latest bodies of
-- both functions below are copied from there; edits are marked
-- "#4255 fix-up" and counted).
--
--   1. A new notification category, business.team_group_message (in-app and
--      push, active): group and Mingla team messages get their own switch,
--      apart from direct messages (business.team_message). Defaults: a DM
--      pushes; a group pushes only on a mention (business.team_mention)
--      until its switch is turned on.
--   2. Anyone who had already switched message pushes on (which meant
--      "groups too") keeps group pushes on: their row is copied once.
--   3. team_chat_enqueue: 3 edits (E1 the group switch is
--      business.team_group_message; E2 a group message is queued under it;
--      E3 its idempotency key names it). Everything else is unchanged.
--   4. team_badge: 2 edits (B1, B2) — it also says whether the caller is an
--      owner or admin (team_chat_admin), the only people team_post lets
--      mention everyone, so the Host app and Admin offer @everyone to them
--      alone.
--
-- Neither function takes an expected revision; no conflict is raised here
-- (the PT409 rule is untouched). Static SQL only.

-- ---------------------------------------------------------------------------
-- 1. The group messages category.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES ('business.team_group_message', 'team', true, 'normal', ARRAY['inapp','push']::text[], 'reach_once', true)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = EXCLUDED.active;

-- ---------------------------------------------------------------------------
-- 2. Keep group pushes on for anyone who had switched message pushes on.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_channel_prefs (user_id, category_key, channel, enabled, updated_at)
SELECT p.user_id, 'business.team_group_message', 'push', true, now()
  FROM public.notification_channel_prefs p
 WHERE p.category_key = 'business.team_message' AND p.channel = 'push' AND p.enabled
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. team_chat_enqueue (from 20280614034255).
-- ---------------------------------------------------------------------------
-- The one producer of team chat notices (#1529 catalog: populating, with an
-- explicit NULL country_code, since no team category routes SMS). Payloads
-- carry ids and counts only: titles and bodies come from the templates.
--   * Mentioned members, everyone in an @everyone message, and the author of
--     the message replied to get a team_mentions row (in-app) and one
--     business.team_mention row. Muting a chat does not silence these.
--   * Everyone else in a DM gets business.team_message (pushes by default).
--   * Everyone else in a group or the Mingla team gets
--     business.team_group_message only after switching group message pushes
--     on (an explicit push preference), and never while the chat is muted.
--   * Nobody is queued who switched both in-app and push off for that kind.
CREATE OR REPLACE FUNCTION public.team_chat_enqueue(p_message_id uuid) RETURNS integer
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
        -- #4255 fix-up E1: groups have their own switch (off until switched on).
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.notification_channel_prefs p
                                   WHERE p.user_id = v_uid AND p.category_key = 'business.team_group_message' AND p.channel = 'push' AND p.enabled);
      END IF;
      -- #4255 fix-up E2: a DM is business.team_message, a group or the Mingla
      -- team business.team_group_message.
      INSERT INTO public.notification_outbox (category_key, user_id, country_code, payload, idempotency_key, status)
      VALUES (CASE WHEN t.kind = 'dm' THEN 'business.team_message' ELSE 'business.team_group_message' END, v_uid, NULL,
        jsonb_build_object('source_kind', 'team_message', 'thread_id', t.id, 'thread_kind', t.kind, 'message_id', m.id,
          'actor_user_id', m.author_id, 'attachment_count', v_count, 'attachment_kind', v_kinds, 'deep_link', v_link),
        -- #4255 fix-up E3: the key names the category it was queued under.
        CASE WHEN t.kind = 'dm' THEN 'business.team_message:' ELSE 'business.team_group_message:' END || m.id::text || ':' || v_uid::text, 'pending')
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_told := v_told + 1;
    END IF;
  END LOOP;
  RETURN v_told;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. team_badge (from 20280614034255).
-- ---------------------------------------------------------------------------
-- The one count for the Host app icon and the Admin Messages button: chats
-- with unread messages (muted chats left out) plus unread mentions, and
-- whether the caller may mention everyone. A signed-in person who is not
-- staff gets staff false, admin false and zeros, so the icon stays hidden
-- without an error.
CREATE OR REPLACE FUNCTION public.team_badge() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_me uuid := auth.uid(); v_chats integer; v_messages integer; v_mentions integer;
BEGIN
  IF v_me IS NULL OR NOT public.team_chat_staff(v_me) THEN
    -- #4255 fix-up B1: admin says whether the caller may mention everyone.
    RETURN jsonb_build_object('staff', false, 'admin', false, 'chats', 0, 'messages', 0, 'mentions', 0, 'total', 0);
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
  -- #4255 fix-up B2: the same rule team_post enforces for @everyone.
  RETURN jsonb_build_object('staff', true, 'admin', public.team_chat_admin(v_me), 'chats', v_chats, 'messages', v_messages, 'mentions', v_mentions, 'total', v_chats + v_mentions);
END;
$$;

COMMENT ON FUNCTION public.team_chat_enqueue(uuid) IS
  'Issue #4255. The one producer of team chat notices: team_mentions plus business.team_mention for mentions, @everyone and replies; business.team_message for a DM (on by default); business.team_group_message for a group or the Mingla team (only after that switch is on, never while muted). Ids only, explicit NULL country_code. Internal.';
COMMENT ON FUNCTION public.team_badge() IS
  'Issue #4255. One call for the Host app Mingla team icon and the Admin Messages button: chats with unread messages (not muted) plus unread mentions, and admin (owner or admin: may mention everyone). staff false, admin false and zeros for a signed-in person who is not staff.';
