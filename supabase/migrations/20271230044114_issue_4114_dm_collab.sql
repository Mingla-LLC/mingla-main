-- Issue #4114 Wave 5: a collab can live inside a 1:1 chat.
--
-- Why: the 1:1 chat rule (`conversations_linked_entity_coherent`) forbids a
-- session link on a direct conversation, the session trigger always created a
-- new group chat, and `conversations.session_id` is ON DELETE CASCADE, so a
-- two-person session that ends would take its chat with it.
--
-- What changes:
--   * `collaboration_sessions.conversation_id` points a session at the 1:1 chat
--     it was started from (ON DELETE SET NULL). The direct conversation keeps
--     `session_id IS NULL`, so ending, leaving or deleting the session never
--     touches the chat. At most one live session (pending / active / voting /
--     locked) per chat (partial unique index). Only `start_dm_collab` may set
--     the link (guard trigger); anyone may clear it.
--   * `ensure_group_conversation_on_session_create` creates no group chat for a
--     linked session, and the two roster-mirroring triggers do nothing for one
--     (the two people are already the 1:1 chat's members; leaving the collab
--     never removes anyone from the chat).
--   * `resolve_session_conversation(session)` answers "which chat does this
--     session talk in": the linked 1:1 chat, else the session's group chat.
--     The two live functions that post into the session's chat use it:
--     `rpc_admin_lock_and_schedule_card` and `rpc_post_collab_dead_end_banner`
--     (bodies copied from their latest definitions, 20260630000000 and
--     20260826000000, with only the lookup replaced).
--   * `start_dm_collab(conversation, name)` is the one create path for a 1:1
--     collab: friends only, nobody blocked, no live session, the free-plan limit
--     (same `check_session_creation_allowed` + trigger). It creates the pending
--     session, both participants (starter accepted, friend invited), seeds the
--     starter's prefs exactly like group creation, writes the invite and posts
--     the "started a collab" card into the chat. The friend joins through the
--     existing `accept_session_with_prefs` (decision D3: the friend must tap Join).
--   * `end_dm_collab(session)` lets either person end it (the session is
--     deleted; the chat stays). Declining the invite ends it too.
--   * System rows (`message_type='system'`, `card_payload.kind='dm_collab'`)
--     record started / joined / ended in the chat, so both phones see the
--     change through the chat's realtime feed.
--   * `list_connection_conversation_access()` also returns each chat's live
--     session (id + status), so the Chats list badges a friend collab with no
--     extra query.
--
-- Idempotent: every statement can run twice.

BEGIN;

-- 1. The link.
ALTER TABLE public.collaboration_sessions
  ADD COLUMN IF NOT EXISTS conversation_id uuid NULL
    REFERENCES public.conversations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.collaboration_sessions.conversation_id IS
  'Issue #4114 Wave 5: the 1:1 (direct) conversation this collab was started from. NULL for group collabs, whose chat is conversations.session_id. ON DELETE SET NULL; set only by start_dm_collab.';

CREATE UNIQUE INDEX IF NOT EXISTS collaboration_sessions_one_live_per_conversation
  ON public.collaboration_sessions (conversation_id)
  WHERE conversation_id IS NOT NULL AND status IN ('pending', 'active', 'voting', 'locked');

-- 2. Only start_dm_collab may link a session to a chat. Without this, cs_update
--    (any participant) could point a session at someone else's chat and have
--    the SECURITY DEFINER lock/schedule writer post into it.
CREATE OR REPLACE FUNCTION public.tg_guard_session_conversation_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.conversation_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id)
     AND current_setting('issue_4114.dm_collab_start', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'dm_collab_link_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_session_conversation_link ON public.collaboration_sessions;
CREATE TRIGGER guard_session_conversation_link
  BEFORE INSERT OR UPDATE OF conversation_id ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_session_conversation_link();

-- 3. No group chat for a session started from a 1:1 chat. Body from
--    20260624000000 with the early return added.
CREATE OR REPLACE FUNCTION public.ensure_group_conversation_on_session_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_session_name text;
BEGIN
  -- Issue #4114 Wave 5: a collab started from a 1:1 chat talks in that chat.
  IF NEW.conversation_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Use the session name as default conversation name. Fall back to "Group chat" if empty.
  v_session_name := COALESCE(NULLIF(trim(NEW.name), ''), 'Group chat');

  -- Idempotent insert via UNIQUE (session_id) partial index.
  INSERT INTO public.conversations (
    type,
    linked_entity_type,
    session_id,
    name,
    created_by,
    is_enabled,
    is_broadcast_only
  ) VALUES (
    'group',
    'session',
    NEW.id,
    v_session_name,
    NEW.created_by,
    true,
    false
  )
  ON CONFLICT (session_id) WHERE session_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_conv_id;

  -- Add the session creator as the first participant. Idempotent via UNIQUE constraint.
  -- Note: v_conv_id may be NULL on ON CONFLICT path; in that case the conversation already
  -- exists (e.g., from prior backfill) and the creator may already be a participant — the
  -- ON CONFLICT DO NOTHING below covers re-runs.
  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id
    FROM public.conversations
    WHERE session_id = NEW.id AND linked_entity_type = 'session';
  END IF;

  IF v_conv_id IS NOT NULL AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, NEW.created_by)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. The roster mirrors skip a 1:1 collab. Bodies from 20260624000000 with the
--    early return added.
CREATE OR REPLACE FUNCTION public.sync_session_member_to_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  -- Only mirror users who have accepted the invite (has_accepted=true).
  -- The WHEN clause on the trigger gates this, but defense-in-depth.
  IF NEW.has_accepted IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Issue #4114 Wave 5: both people are already members of the 1:1 chat.
  IF EXISTS (
    SELECT 1 FROM public.collaboration_sessions
    WHERE id = NEW.session_id AND conversation_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  -- Find the group conversation for this session (created by Step 4's trigger or backfilled).
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE session_id = NEW.session_id
    AND linked_entity_type = 'session';

  IF v_conv_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conv_id, NEW.user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_session_member_from_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
BEGIN
  -- Issue #4114 Wave 5: leaving a 1:1 collab never removes anyone from the chat.
  IF EXISTS (
    SELECT 1 FROM public.collaboration_sessions
    WHERE id = OLD.session_id AND conversation_id IS NOT NULL
  ) THEN
    RETURN OLD;
  END IF;

  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE session_id = OLD.session_id
    AND linked_entity_type = 'session';

  IF v_conv_id IS NOT NULL THEN
    DELETE FROM public.conversation_participants
    WHERE conversation_id = v_conv_id AND user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

-- 5. Which chat a session talks in. Internal: called by SECURITY DEFINER
--    writers only.
CREATE OR REPLACE FUNCTION public.resolve_session_conversation(p_session_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT cs.conversation_id FROM public.collaboration_sessions cs WHERE cs.id = p_session_id),
    (SELECT c.id FROM public.conversations c
      WHERE c.session_id = p_session_id AND c.linked_entity_type = 'session'
      LIMIT 1)
  );
$function$;

COMMENT ON FUNCTION public.resolve_session_conversation(uuid) IS
  'Issue #4114 Wave 5: the chat a collab session talks in: its linked 1:1 chat (collaboration_sessions.conversation_id), else its group chat (conversations.session_id). Every server writer that posts into "the session''s chat" uses this.';

REVOKE ALL ON FUNCTION public.resolve_session_conversation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_session_conversation(uuid) TO service_role;

-- 6. The two live writers into "the session's chat", retargeted.

CREATE OR REPLACE FUNCTION public.rpc_admin_lock_and_schedule_card(
  p_session_id uuid,
  p_saved_card_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_already_locked boolean;
  v_card_data jsonb;
  v_card_payload jsonb;
  v_card_place_id uuid;
  v_session_conversation_id uuid;
  v_new_deck_version int;
  v_updated_participant_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: authentication required';
  END IF;

  SELECT (cs.created_by = v_uid OR COALESCE(sp.is_admin, false) = true)
    INTO v_is_admin
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized (creator or session admin required)';
  END IF;

  SELECT is_locked, card_data
    INTO v_already_locked, v_card_data
    FROM public.board_saved_cards
    WHERE id = p_saved_card_id AND session_id = p_session_id;

  IF v_already_locked IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: card not found in this session';
  END IF;

  IF v_already_locked = true THEN
    RAISE EXCEPTION 'ORCH-0908: card is already locked (lock-and-schedule is one-shot; reschedule is a separate flow)';
  END IF;

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at must be in the future';
  END IF;
  IF p_scheduled_at > NOW() + INTERVAL '1 year' THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at cannot be more than 1 year out';
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 1440 THEN
    RAISE EXCEPTION 'ORCH-0908: duration_minutes must be between 15 and 1440';
  END IF;

  UPDATE public.board_saved_cards
    SET is_locked = true,
        locked_at = NOW(),
        locked_by_consensus = false
    WHERE id = p_saved_card_id;

  UPDATE public.collaboration_sessions
    SET status = 'locked',
        updated_at = NOW()
    WHERE id = p_session_id
      AND status IN ('pending', 'active', 'voting');

  UPDATE public.calendar_entries
    SET scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        status = 'confirmed',
        updated_at = NOW()
    WHERE board_card_id = p_saved_card_id
      AND source = 'collaboration';

  GET DIAGNOSTICS v_updated_participant_count = ROW_COUNT;

  SELECT pp.id
    INTO v_card_place_id
    FROM public.place_pool pp
    JOIN public.board_saved_cards bsc ON bsc.experience_id = pp.google_place_id
    WHERE bsc.id = p_saved_card_id
    LIMIT 1;

  IF v_card_place_id IS NULL THEN
    v_new_deck_version := public.rpc_force_deck_recycle(p_session_id, '{}'::uuid[]);
  ELSE
    v_new_deck_version := public.rpc_force_deck_recycle(p_session_id, ARRAY[v_card_place_id]::uuid[]);
  END IF;

  PERFORM set_config('orch_0908.force_recycle', 'true', true);

  UPDATE public.collaboration_sessions
    SET status = 'active',
        updated_at = NOW()
    WHERE id = p_session_id;

  -- ── Flat CardPayload (ORCH-0667 shape) ────────────────────────────────────
  -- Spread the saved card's card_data at the top level so the chat renderer
  -- and ExpandedCardModal pick up image/title/category/etc. directly. Add the
  -- four lock-in extras alongside. Strip nulls keeps payload tight.
  v_card_payload := jsonb_strip_nulls(
    COALESCE(v_card_data, '{}'::jsonb) || jsonb_build_object(
      'lockInEvent', 'card_locked_and_scheduled',
      'scheduledAt', to_jsonb(p_scheduled_at),
      'durationMinutes', p_duration_minutes,
      'lockerUserId', v_uid,
      'savedCardId', p_saved_card_id,
      'sessionId', p_session_id,
      'selectedDateTime', to_jsonb(p_scheduled_at)
    )
  );

  -- Issue #4114 Wave 5: the session's chat is its 1:1 chat when it was
  -- started from one, otherwise its group chat.
  v_session_conversation_id := public.resolve_session_conversation(p_session_id);

  IF v_session_conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id,
      sender_id,
      content,
      message_type,
      card_payload
    ) VALUES (
      v_session_conversation_id,
      v_uid,
      'Locked in for ' || to_char(p_scheduled_at AT TIME ZONE 'UTC', 'Mon DD, HH24:MI') || ' UTC',
      'card',
      v_card_payload
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'locked_and_scheduled',
    'saved_card_id', p_saved_card_id,
    'session_id', p_session_id,
    'scheduled_at', p_scheduled_at,
    'duration_minutes', p_duration_minutes,
    'updated_participant_count', v_updated_participant_count,
    'new_deck_version', v_new_deck_version,
    'locker_user_id', v_uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_post_collab_dead_end_banner(
  p_session_id uuid,
  p_reason text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
  v_prose text;
  v_message_id uuid;
BEGIN
  -- 1. Auth required.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- 2. Resolve the session's chat (Issue #4114 Wave 5: the 1:1 chat when the
  --    session was started from one, otherwise its group chat).
  v_conversation_id := public.resolve_session_conversation(p_session_id);

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  -- 3. Authorization — replaces the WITH CHECK the null-sender INSERT bypasses.
  --    Only an actual participant of THIS conversation may post the banner,
  --    exactly as the regular INSERT RLS would enforce.
  IF NOT EXISTS (
    SELECT 1
      FROM public.conversation_participants cp
     WHERE cp.conversation_id = v_conversation_id
       AND cp.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  -- 4. Validate the reason against the known set (server is the trust boundary
  --    for a SECURITY DEFINER insert).
  IF p_reason NOT IN (
    'intersection_empty',
    'no_matching_candidates',
    'no_unswiped_candidates',
    'quorum_not_met',
    'all_pools_exhausted'
  ) THEN
    RAISE EXCEPTION 'unknown reason: %', p_reason;
  END IF;

  -- 5. Validate the payload shape (kind + non-empty participants array).
  IF p_payload IS NULL
     OR p_payload->>'kind' IS DISTINCT FROM 'collab_dead_end'
     OR jsonb_typeof(p_payload->'participants') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_payload->'participants') < 1 THEN
    RAISE EXCEPTION 'invalid payload';
  END IF;

  -- 6. The degrade prose lives in `content` (NOT NULL column) so old builds and
  --    notification previews show readable text; the structured object lives in
  --    `card_payload`. Default to empty string if the caller omitted prose
  --    (content is NOT NULL).
  v_prose := COALESCE(p_payload->>'prose', '');

  INSERT INTO public.messages (
    conversation_id,
    sender_id,
    content,
    message_type,
    card_payload
  ) VALUES (
    v_conversation_id,
    NULL,
    v_prose,
    'system',
    p_payload
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

-- 7. System rows in the 1:1 chat (started / joined / ended). sender_id NULL and
--    message_type 'system' like the ORCH-1058B banner; both phones receive them
--    through the chat's realtime feed, which is how the header and the Chats
--    list learn the collab changed.
CREATE OR REPLACE FUNCTION public.issue_4114_post_dm_collab_event(
  p_conversation_id uuid,
  p_session_id uuid,
  p_event text,
  p_user_id uuid,
  p_content text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_conversation_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = p_conversation_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.messages (conversation_id, sender_id, content, message_type, card_payload)
  VALUES (
    p_conversation_id,
    NULL,
    p_content,
    'system',
    jsonb_build_object(
      'kind', 'dm_collab',
      'event', p_event,
      'session_id', p_session_id,
      'user_id', p_user_id
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4114_post_dm_collab_event(uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_post_dm_collab_event(uuid, uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4114_first_name(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT COALESCE(
      NULLIF(btrim(p.first_name), ''),
      NULLIF(split_part(btrim(COALESCE(p.display_name, '')), ' ', 1), ''),
      NULLIF(btrim(p.username), '')
    )
    FROM public.profiles p
    WHERE p.id = p_user_id
  ), 'Someone');
$function$;

REVOKE ALL ON FUNCTION public.issue_4114_first_name(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4114_first_name(uuid) TO service_role;

-- 8. The one create path for a 1:1 collab.
CREATE OR REPLACE FUNCTION public.start_dm_collab(
  p_conversation_id uuid,
  p_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_friend uuid;
  v_member_count integer;
  v_check record;
  v_name text;
  v_session_id uuid;
  v_invite_id uuid;
  v_prefs record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- Lock the chat so two taps (or both people at once) cannot race.
  PERFORM 1 FROM public.conversations
   WHERE id = p_conversation_id AND type = 'direct' AND linked_entity_type = 'direct'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT user_id) INTO v_member_count
    FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id;
  IF v_member_count <> 2 OR NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
     WHERE conversation_id = p_conversation_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_friend
    FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id AND user_id <> v_uid
   LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users b
     WHERE (b.blocker_id = v_uid AND b.blocked_id = v_friend)
        OR (b.blocker_id = v_friend AND b.blocked_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'blocked' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.friends f
     WHERE f.status = 'accepted' AND f.deleted_at IS NULL
       AND ((f.user_id = v_uid AND f.friend_user_id = v_friend)
         OR (f.user_id = v_friend AND f.friend_user_id = v_uid))
  ) THEN
    RAISE EXCEPTION 'not_friends' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.collaboration_sessions
     WHERE conversation_id = p_conversation_id
       AND status IN ('pending', 'active', 'voting', 'locked')
  ) THEN
    RAISE EXCEPTION 'collab_already_live' USING ERRCODE = 'P0001';
  END IF;

  -- Decision D4: a 1:1 collab counts toward the free plan's open sessions.
  -- Same check and wording as enforce_session_creation_limit (which still runs
  -- on the INSERT below), so the app's paywall path is unchanged.
  SELECT * INTO v_check FROM public.check_session_creation_allowed(v_uid);
  IF NOT v_check.allowed THEN
    RAISE EXCEPTION 'session_limit_reached: You have reached your % limit of % active session(s).',
      v_check.tier, v_check.max_allowed
      USING ERRCODE = 'P0001';
  END IF;

  v_name := left(COALESCE(
    NULLIF(btrim(p_name), ''),
    public.issue_4114_first_name(v_uid) || ' & ' || public.issue_4114_first_name(v_friend)
  ), 80);

  PERFORM set_config('issue_4114.dm_collab_start', 'on', true);
  INSERT INTO public.collaboration_sessions (name, created_by, status, conversation_id)
  VALUES (v_name, v_uid, 'pending', p_conversation_id)
  RETURNING id INTO v_session_id;
  PERFORM set_config('issue_4114.dm_collab_start', 'off', true);

  INSERT INTO public.session_participants (session_id, user_id, has_accepted, joined_at)
  VALUES (v_session_id, v_uid, true, now());
  INSERT INTO public.session_participants (session_id, user_id, has_accepted)
  VALUES (v_session_id, v_friend, false);

  -- The starter's solo prefs, seeded exactly like group creation
  -- (app/index.tsx handleCreateGroupChat → upsert_participant_prefs).
  SELECT * INTO v_prefs FROM public.preferences WHERE profile_id = v_uid;
  PERFORM public.upsert_participant_prefs(
    v_session_id,
    v_uid,
    jsonb_build_object(
      'categories', CASE WHEN COALESCE(array_length(v_prefs.categories, 1), 0) > 0
                         THEN to_jsonb(v_prefs.categories)
                         ELSE '["nature","drinks_and_music","icebreakers"]'::jsonb END,
      'intents', COALESCE(to_jsonb(v_prefs.intents), '[]'::jsonb),
      'travel_mode', COALESCE(v_prefs.travel_mode, 'walking'),
      'travel_constraint_type', 'time',
      'travel_constraint_value', COALESCE(v_prefs.travel_constraint_value, 30),
      'date_option', v_prefs.date_option,
      'datetime_pref', v_prefs.datetime_pref,
      'selected_dates', to_jsonb(v_prefs.selected_dates),
      'use_gps_location', COALESCE(v_prefs.use_gps_location, true),
      'custom_location', v_prefs.custom_location,
      'custom_lat', v_prefs.custom_lat,
      'custom_lng', v_prefs.custom_lng,
      'intent_toggle', COALESCE(v_prefs.intent_toggle, true),
      'category_toggle', COALESCE(v_prefs.category_toggle, true)
    )
  );

  INSERT INTO public.collaboration_invites (session_id, inviter_id, invited_user_id, status)
  VALUES (v_session_id, v_uid, v_friend, 'pending')
  RETURNING id INTO v_invite_id;

  PERFORM public.issue_4114_post_dm_collab_event(
    p_conversation_id, v_session_id, 'started', v_uid,
    public.issue_4114_first_name(v_uid) || ' started a collab'
  );

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'invite_id', v_invite_id,
    'session_name', v_name,
    'friend_id', v_friend
  );
END;
$function$;

COMMENT ON FUNCTION public.start_dm_collab(uuid, text) IS
  'Issue #4114 Wave 5: start a collab inside a 1:1 chat. Caller and exactly one other person must be the direct chat''s members, accepted friends, neither blocking the other, with no live session in the chat and room under check_session_creation_allowed. Creates the pending session linked by conversation_id (no group chat), both participants (starter accepted), the starter''s prefs, the invite and the "started" system row. Returns session_id, invite_id, session_name, friend_id.';

REVOKE ALL ON FUNCTION public.start_dm_collab(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_dm_collab(uuid, text) TO authenticated, service_role;

-- 9. Either person ends a 1:1 collab. The session goes; the chat stays.
CREATE OR REPLACE FUNCTION public.end_dm_collab(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
     WHERE cs.id = p_session_id AND cs.conversation_id IS NOT NULL
       AND (cs.created_by = v_uid OR EXISTS (
         SELECT 1 FROM public.session_participants sp
          WHERE sp.session_id = cs.id AND sp.user_id = v_uid
       ))
  ) THEN
    RAISE EXCEPTION 'collab_unavailable' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.collaboration_sessions WHERE id = p_session_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.end_dm_collab(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_dm_collab(uuid) TO authenticated, service_role;

-- 10. Declining a 1:1 collab invite ends the collab (otherwise a pending session
--     would sit in the chat and count toward the starter's limit). Covers every
--     decline path: the chat card, the notification button and the inbox.
CREATE OR REPLACE FUNCTION public.tg_end_dm_collab_on_decline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  DELETE FROM public.collaboration_sessions
   WHERE id = NEW.session_id AND conversation_id IS NOT NULL;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS end_dm_collab_on_decline ON public.collaboration_invites;
CREATE TRIGGER end_dm_collab_on_decline
  AFTER UPDATE OF status ON public.collaboration_invites
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'declined' AND NEW.status = 'declined')
  EXECUTE FUNCTION public.tg_end_dm_collab_on_decline();

-- 11. "Tomi joined the collab".
CREATE OR REPLACE FUNCTION public.tg_dm_collab_member_joined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_conversation_id uuid;
  v_created_by uuid;
BEGIN
  IF NEW.has_accepted IS NOT TRUE OR (TG_OP = 'UPDATE' AND OLD.has_accepted IS TRUE) THEN
    RETURN NEW;
  END IF;
  SELECT conversation_id, created_by INTO v_conversation_id, v_created_by
    FROM public.collaboration_sessions WHERE id = NEW.session_id;
  IF v_conversation_id IS NULL OR NEW.user_id = v_created_by THEN
    RETURN NEW;
  END IF;
  PERFORM public.issue_4114_post_dm_collab_event(
    v_conversation_id, NEW.session_id, 'joined', NEW.user_id,
    public.issue_4114_first_name(NEW.user_id) || ' joined the collab'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS dm_collab_member_joined ON public.session_participants;
CREATE TRIGGER dm_collab_member_joined
  AFTER INSERT OR UPDATE OF has_accepted ON public.session_participants
  FOR EACH ROW
  WHEN (NEW.has_accepted = true)
  EXECUTE FUNCTION public.tg_dm_collab_member_joined();

-- 12. "The collab ended": the session was deleted (ended, declined, cleanup
--     under two people) or left the live states.
CREATE OR REPLACE FUNCTION public.tg_dm_collab_ended()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.conversation_id IS NOT NULL AND OLD.status IN ('pending', 'active', 'voting', 'locked') THEN
      PERFORM public.issue_4114_post_dm_collab_event(
        OLD.conversation_id, OLD.id, 'ended', NULL, 'The collab ended'
      );
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.conversation_id IS NOT NULL
     AND OLD.status IN ('pending', 'active', 'voting', 'locked')
     AND NEW.status NOT IN ('pending', 'active', 'voting', 'locked') THEN
    PERFORM public.issue_4114_post_dm_collab_event(
      NEW.conversation_id, NEW.id, 'ended', NULL, 'The collab ended'
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS dm_collab_ended_on_delete ON public.collaboration_sessions;
CREATE TRIGGER dm_collab_ended_on_delete
  AFTER DELETE ON public.collaboration_sessions
  FOR EACH ROW
  WHEN (OLD.conversation_id IS NOT NULL)
  EXECUTE FUNCTION public.tg_dm_collab_ended();

DROP TRIGGER IF EXISTS dm_collab_ended_on_status ON public.collaboration_sessions;
CREATE TRIGGER dm_collab_ended_on_status
  AFTER UPDATE OF status ON public.collaboration_sessions
  FOR EACH ROW
  WHEN (NEW.conversation_id IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.tg_dm_collab_ended();

-- 13. The Chats list learns each chat's live session in the batch it already
--     makes. Body from 20271230014114 plus live_session_id / live_session_status.
DROP FUNCTION IF EXISTS public.list_connection_conversation_access();
CREATE FUNCTION public.list_connection_conversation_access()
RETURNS TABLE(
  conversation_id uuid,
  archived_at timestamptz,
  pinned_at timestamptz,
  marked_unread_at timestamptz,
  live_session_id uuid,
  live_session_status text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
  WITH access AS (
    SELECT DISTINCT c.conversation_id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
    FROM public.content_share_recipient_candidates(auth.uid(),true,false) c
    LEFT JOIN public.conversation_participant_lifecycle lifecycle
      ON lifecycle.conversation_id=c.conversation_id AND lifecycle.user_id=auth.uid()
    WHERE c.target_kind IN ('direct','group') AND c.conversation_id IS NOT NULL
    UNION
    SELECT conversation.id,lifecycle.archived_at,lifecycle.pinned_at,lifecycle.marked_unread_at
    FROM public.conversation_participants mine
    JOIN public.conversations conversation ON conversation.id=mine.conversation_id
    JOIN public.collaboration_sessions session ON session.id=conversation.session_id
    LEFT JOIN public.conversation_participant_lifecycle lifecycle
      ON lifecycle.conversation_id=mine.conversation_id AND lifecycle.user_id=mine.user_id
    WHERE mine.user_id=auth.uid() AND lifecycle.hidden_at IS NULL
      AND conversation.type='group' AND conversation.linked_entity_type='session'
      AND conversation.is_enabled IS TRUE AND session.created_by=auth.uid()
      AND session.is_active IS TRUE AND session.archived_at IS NULL
      AND session.status='pending'
  )
  SELECT access.conversation_id,access.archived_at,access.pinned_at,access.marked_unread_at,
    live.id,live.status
  FROM access
  LEFT JOIN LATERAL (
    SELECT cs.id,cs.status
    FROM public.collaboration_sessions cs
    WHERE cs.conversation_id=access.conversation_id
      AND cs.status IN ('pending','active','voting','locked')
    ORDER BY cs.created_at DESC
    LIMIT 1
  ) live ON true;
$function$;
REVOKE ALL ON FUNCTION public.list_connection_conversation_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_connection_conversation_access() TO authenticated,service_role;

COMMIT;
