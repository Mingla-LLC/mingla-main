-- #4435 M-A: groups are live at creation, members are added directly (15 cap on
-- every path), any admin removes and promotes through the server, a group is
-- deleted only when no accepted member remains, the last admin hands over, and
-- removed members stop counting toward new matches, open votes and auto-lock.
-- 1:1 collab sessions (collaboration_sessions.conversation_id set) keep #4114 rules.
--
-- Invariants (declared in supabase/migrations/__tests__/issue_4435_group_lifecycle.implementor.pg17.test.sql):
--   I-4435-GROUP-DELETE-AT-ZERO, I-4435-SERVER-CHECKED-MEMBERSHIP, I-4435-ADMIN-HANDOVER,
--   I-4435-MATCH-CURRENT-MEMBERS, I-4435-OPEN-VOTES-CURRENT-MEMBERS.
-- Adversarial twin: issue_4435_group_lifecycle.tester.adversarial.pg17.test.sql.
--
-- Replaced bodies are copied from their latest definitions and change only the
-- lines named in the #4435 spec; each restates its search_path. Server
-- functions that seed another member's deck prefs call the internal writer
-- issue_4436_write_participant_prefs (20280708046436), because
-- upsert_participant_prefs now writes only the caller's own prefs for app clients.

-- A1. A member's deck prefs, built exactly like start_dm_collab.
CREATE OR REPLACE FUNCTION public.issue_4435_member_prefs(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prefs public.preferences%ROWTYPE;
BEGIN
  SELECT * INTO v_prefs FROM public.preferences WHERE profile_id = p_user;
  RETURN jsonb_build_object(
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
  );
END $$;
REVOKE ALL ON FUNCTION public.issue_4435_member_prefs(uuid) FROM PUBLIC, anon, authenticated;

-- A2. Put one person straight into a session group. The ONE admit path: create,
-- add, link join and join approval all call it, so the cap holds everywhere.
CREATE OR REPLACE FUNCTION public.issue_4435_admit_member(
  p_session_id uuid, p_user uuid, p_inviter uuid, p_method text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cap integer; v_board uuid; v_frontier integer; v_accepted integer;
BEGIN
  SELECT COALESCE(cs.max_participants, 15), cs.board_id INTO v_cap, v_board
    FROM public.collaboration_sessions cs WHERE cs.id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM public.session_participants
              WHERE session_id = p_session_id AND user_id = p_user AND has_accepted IS TRUE) THEN
    RETURN false;
  END IF;
  SELECT count(*), COALESCE(max(current_position), 0) INTO v_accepted, v_frontier
    FROM public.session_participants WHERE session_id = p_session_id AND has_accepted IS TRUE;
  IF v_accepted >= v_cap THEN
    RAISE EXCEPTION 'conflict_group_full' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.collaboration_invites (session_id, inviter_id, invited_user_id, status, invite_method)
  VALUES (p_session_id, p_inviter, p_user, 'accepted', p_method)
  ON CONFLICT (session_id, invited_user_id) DO UPDATE
    SET status = 'accepted', inviter_id = EXCLUDED.inviter_id,
        invite_method = EXCLUDED.invite_method, updated_at = now();
  INSERT INTO public.session_participants (session_id, user_id, has_accepted, joined_at, current_position)
  VALUES (p_session_id, p_user, true, now(), v_frontier)
  ON CONFLICT (session_id, user_id) DO UPDATE
    SET has_accepted = true,
        joined_at = COALESCE(public.session_participants.joined_at, now()),
        current_position = GREATEST(public.session_participants.current_position, v_frontier);
  IF v_board IS NOT NULL THEN
    INSERT INTO public.board_collaborators (board_id, user_id, role)
    VALUES (v_board, p_user, 'collaborator') ON CONFLICT (board_id, user_id) DO NOTHING;
  END IF;
  PERFORM public.issue_4436_write_participant_prefs(p_session_id, p_user, public.issue_4435_member_prefs(p_user));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.issue_4435_admit_member(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- A3. Create a group: live now, with a board, the creator and 0-14 friends.
CREATE OR REPLACE FUNCTION public.create_group_chat(p_name text, p_friend_ids uuid[] DEFAULT ARRAY[]::uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_name text := btrim(COALESCE(p_name, ''));
  v_ids uuid[]; v_id uuid; v_session uuid; v_board uuid; v_conv uuid;
  v_added uuid[] := ARRAY[]::uuid[]; v_skipped uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_name';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_friend_ids, ARRAY[]::uuid[])) AS x WHERE x IS NOT NULL AND x <> v_uid;
  IF cardinality(v_ids) > 14 THEN
    RAISE EXCEPTION 'conflict_group_full' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.collaboration_sessions (name, created_by, status)
  VALUES (v_name, v_uid, 'active') RETURNING id INTO v_session;      -- R29 tier trigger fires here
  INSERT INTO public.boards (name, description, created_by, is_public)
  VALUES (v_name, 'Collaborative board for ' || v_name, v_uid, false) RETURNING id INTO v_board;
  UPDATE public.collaboration_sessions SET board_id = v_board WHERE id = v_session;
  INSERT INTO public.board_collaborators (board_id, user_id, role) VALUES (v_board, v_uid, 'owner');
  INSERT INTO public.session_participants (session_id, user_id, has_accepted, joined_at)
  VALUES (v_session, v_uid, true, now());
  PERFORM public.issue_4436_write_participant_prefs(v_session, v_uid, public.issue_4435_member_prefs(v_uid));
  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.friends f
                    WHERE f.user_id = v_uid AND f.friend_user_id = v_id
                      AND f.status = 'accepted' AND f.deleted_at IS NULL)
       OR public.has_block_between(v_uid, v_id) THEN
      v_skipped := v_skipped || v_id;
    ELSE
      PERFORM public.issue_4435_admit_member(v_session, v_id, v_uid, 'friends_list');
      v_added := v_added || v_id;
    END IF;
  END LOOP;
  SELECT c.id INTO v_conv FROM public.conversations c
   WHERE c.session_id = v_session AND c.type = 'group' ORDER BY c.created_at LIMIT 1;
  IF cardinality(v_added) > 0 THEN
    PERFORM public.chat_group_post_event(v_conv, 'members_added',
      jsonb_build_object('actorId', v_uid, 'userIds', to_jsonb(v_added)),
      public.issue_4114_first_name(v_uid) || ' added ' || cardinality(v_added)
        || CASE WHEN cardinality(v_added) = 1 THEN ' person' ELSE ' people' END);
  END IF;
  RETURN jsonb_build_object('sessionId', v_session, 'conversationId', v_conv, 'boardId', v_board,
                            'added', to_jsonb(v_added), 'skipped', to_jsonb(v_skipped));
END $$;
REVOKE ALL ON FUNCTION public.create_group_chat(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_chat(text, uuid[]) TO authenticated;

-- A4. add_group_members (copy of 20280403034261; plain branch unchanged, new session branch).
CREATE OR REPLACE FUNCTION public.add_group_members(p_conversation_id uuid, p_user_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_id uuid;
  v_added uuid[] := ARRAY[]::uuid[];
  v_skipped uuid[] := ARRAY[]::uuid[];
  v_kind text;
  v_session uuid;
  v_cap integer;
  v_eligible uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  v_kind := public.chat_plan_chat_kind(p_conversation_id);
  IF v_kind IS NULL OR v_kind NOT IN ('plain', 'session') THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS x
   WHERE x IS NOT NULL;
  IF cardinality(v_ids) < 1 OR cardinality(v_ids) > 20 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_user_ids';
  END IF;

  -- #4435: a session group adds people directly (any accepted member), all or
  -- nothing against max_participants.
  IF v_kind = 'session' THEN
    SELECT c.session_id, COALESCE(cs.max_participants, 15) INTO v_session, v_cap
      FROM public.conversations c JOIN public.collaboration_sessions cs ON cs.id = c.session_id
     WHERE c.id = p_conversation_id FOR UPDATE OF cs;
    IF v_session IS NULL OR NOT EXISTS (SELECT 1 FROM public.session_participants sp WHERE sp.session_id = v_session
                    AND sp.user_id = v_uid AND sp.has_accepted IS TRUE) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    FOREACH v_id IN ARRAY v_ids LOOP
      IF v_id = v_uid
         OR EXISTS (SELECT 1 FROM public.session_participants sp WHERE sp.session_id = v_session
                     AND sp.user_id = v_id AND sp.has_accepted IS TRUE)
         OR NOT EXISTS (
           SELECT 1 FROM public.friends f
            WHERE f.user_id = v_uid AND f.friend_user_id = v_id
              AND f.status = 'accepted' AND f.deleted_at IS NULL
         )
         OR public.chat_member_blocked(p_conversation_id, v_id) THEN
        v_skipped := v_skipped || v_id;
      ELSE
        v_eligible := v_eligible || v_id;
      END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.session_participants WHERE session_id = v_session AND has_accepted IS TRUE)
       + cardinality(v_eligible) > v_cap THEN
      RAISE EXCEPTION 'conflict_group_full' USING ERRCODE = 'PT409';
    END IF;
    FOREACH v_id IN ARRAY v_eligible LOOP
      PERFORM public.issue_4435_admit_member(v_session, v_id, v_uid, 'friends_list');
      v_added := v_added || v_id;
    END LOOP;
    IF cardinality(v_added) > 0 THEN
      PERFORM public.chat_group_post_event(
        p_conversation_id, 'members_added',
        jsonb_build_object('actorId', v_uid, 'userIds', to_jsonb(v_added)),
        public.issue_4114_first_name(v_uid) || ' added ' || cardinality(v_added)
          || CASE WHEN cardinality(v_added) = 1 THEN ' person' ELSE ' people' END
      );
    END IF;
    RETURN jsonb_build_object('added', to_jsonb(v_added), 'skipped', to_jsonb(v_skipped));
  END IF;

  IF NOT public.is_conversation_participant(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF v_id = v_uid
       OR public.is_conversation_participant(p_conversation_id, v_id)
       OR NOT EXISTS (
         SELECT 1 FROM public.friends f
          WHERE f.user_id = v_uid AND f.friend_user_id = v_id
            AND f.status = 'accepted' AND f.deleted_at IS NULL
       )
       OR public.chat_member_blocked(p_conversation_id, v_id) THEN
      v_skipped := v_skipped || v_id;
    ELSE
      INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (p_conversation_id, v_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
      v_added := v_added || v_id;
    END IF;
  END LOOP;

  IF cardinality(v_added) > 0 THEN
    PERFORM public.chat_group_post_event(
      p_conversation_id, 'members_added',
      jsonb_build_object('actorId', v_uid, 'userIds', to_jsonb(v_added)),
      public.issue_4114_first_name(v_uid) || ' added ' || cardinality(v_added)
        || CASE WHEN cardinality(v_added) = 1 THEN ' person' ELSE ' people' END
    );
  END IF;

  RETURN jsonb_build_object('added', to_jsonb(v_added), 'skipped', to_jsonb(v_skipped));
END;
$function$;
REVOKE ALL ON FUNCTION public.add_group_members(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) TO authenticated;

-- A5. Remove a member. Caller: accepted member and group admin. Creator protected.
CREATE OR REPLACE FUNCTION public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_session uuid; v_creator uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'session' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT cs.id, cs.created_by INTO v_session, v_creator
    FROM public.conversations c JOIN public.collaboration_sessions cs ON cs.id = c.session_id
   WHERE c.id = p_conversation_id FOR UPDATE OF cs;
  IF NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_session
                  AND user_id = v_uid AND has_accepted IS TRUE)
     OR NOT public.chat_group_is_admin(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_uid THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', DETAIL = 'p_user_id'; END IF;
  IF p_user_id = v_creator THEN RAISE EXCEPTION 'creator_protected' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.session_participants WHERE session_id = v_session AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM public.collaboration_invites WHERE session_id = v_session AND invited_user_id = p_user_id;
  PERFORM public.chat_group_post_event(p_conversation_id, 'member_removed',
    jsonb_build_object('actorId', v_uid, 'userId', p_user_id),
    public.issue_4114_first_name(v_uid) || ' removed ' || public.issue_4114_first_name(p_user_id));
  RETURN jsonb_build_object('removed', p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.remove_group_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;

-- A6. Make or remove an admin. Same caller check. The creator is always an
-- admin; the last admin cannot be demoted (leaving hands over instead, A7).
CREATE OR REPLACE FUNCTION public.set_group_admin(p_conversation_id uuid, p_user_id uuid, p_is_admin boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_session uuid; v_creator uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF public.chat_plan_chat_kind(p_conversation_id) IS DISTINCT FROM 'session' THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT cs.id, cs.created_by INTO v_session, v_creator
    FROM public.conversations c JOIN public.collaboration_sessions cs ON cs.id = c.session_id
   WHERE c.id = p_conversation_id FOR UPDATE OF cs;
  IF NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_session
                  AND user_id = v_uid AND has_accepted IS TRUE)
     OR NOT public.chat_group_is_admin(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF p_is_admin IS NULL OR p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_session
                  AND user_id = p_user_id AND has_accepted IS TRUE) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT p_is_admin AND p_user_id = v_creator THEN
    RAISE EXCEPTION 'creator_protected' USING ERRCODE = '42501'; END IF;
  IF NOT p_is_admin AND NOT EXISTS (
       SELECT 1 FROM public.session_participants sp WHERE sp.session_id = v_session
          AND sp.has_accepted IS TRUE AND sp.user_id <> p_user_id
          AND (sp.is_admin IS TRUE OR sp.user_id = v_creator)) THEN
    RAISE EXCEPTION 'last_admin' USING ERRCODE = '42501'; END IF;
  UPDATE public.session_participants SET is_admin = p_is_admin
   WHERE session_id = v_session AND user_id = p_user_id;
  IF p_is_admin THEN
    PERFORM public.chat_group_post_event(p_conversation_id, 'made_admin',
      jsonb_build_object('actorId', v_uid, 'userId', p_user_id),
      public.issue_4114_first_name(v_uid) || ' made ' || public.issue_4114_first_name(p_user_id) || ' an admin');
  END IF;
  RETURN jsonb_build_object('userId', p_user_id, 'isAdmin', p_is_admin);
END $$;
REVOKE ALL ON FUNCTION public.set_group_admin(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_admin(uuid, uuid, boolean) TO authenticated;

-- A7. Trigger name and binding unchanged (baseline trg_cleanup_session_under_two_participants).
-- Groups: delete at zero accepted, hand admin to the longest-standing member.
-- 1:1 collab: today's rule.
CREATE OR REPLACE FUNCTION public.cleanup_session_if_under_two_participants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sid uuid := COALESCE(OLD.session_id, NEW.session_id);
  v_status text; v_dm uuid; v_creator uuid; v_accepted integer; v_heir uuid;
BEGIN
  IF v_sid IS NULL OR TG_OP = 'INSERT' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT cs.status, cs.conversation_id, cs.created_by INTO v_status, v_dm, v_creator
    FROM public.collaboration_sessions cs WHERE cs.id = v_sid;
  IF NOT FOUND THEN RETURN COALESCE(NEW, OLD); END IF;     -- session already gone (cascade)
  SELECT count(*) INTO v_accepted FROM public.session_participants sp
   WHERE sp.session_id = v_sid AND sp.has_accepted = true;
  IF v_dm IS NOT NULL THEN                                  -- 1:1 collab (#4114): unchanged
    IF v_status = 'active' AND v_accepted < 2 THEN
      DELETE FROM public.collaboration_sessions WHERE id = v_sid;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF v_accepted = 0 THEN
    DELETE FROM public.collaboration_sessions WHERE id = v_sid;
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (
       SELECT 1 FROM public.session_participants sp WHERE sp.session_id = v_sid
          AND sp.has_accepted = true AND (sp.is_admin IS TRUE OR sp.user_id = v_creator)) THEN
    SELECT sp.user_id INTO v_heir FROM public.session_participants sp
     WHERE sp.session_id = v_sid AND sp.has_accepted = true
     ORDER BY sp.joined_at ASC NULLS LAST, sp.created_at ASC, sp.user_id ASC LIMIT 1;
    UPDATE public.session_participants SET is_admin = true
     WHERE session_id = v_sid AND user_id = v_heir;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- A8. cascade_friend_decline_to_collabs (copy of the baseline; step 3 deletes only 1:1 collabs).
CREATE OR REPLACE FUNCTION "public"."cascade_friend_decline_to_collabs"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  affected_session RECORD;
  remaining_count INTEGER;
BEGIN
  IF NEW.status = 'declined' AND OLD.status = 'pending' THEN

    -- ── 1. Cancel collaboration invites (both directions) ──
    -- When a friend request is declined, any session invites between these
    -- two users are invalid — friendship is a prerequisite for collaboration.
    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id
    AND invited_user_id = NEW.receiver_id
    AND status = 'pending';

    UPDATE public.collaboration_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id
    AND invited_user_id = NEW.sender_id
    AND status = 'pending';

    -- ── 2. Delete session_participants for cancelled invites (both directions) ──
    DELETE FROM public.session_participants
    WHERE user_id = NEW.receiver_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id
    );

    DELETE FROM public.session_participants
    WHERE user_id = NEW.sender_id
    AND session_id IN (
      SELECT session_id FROM public.collaboration_invites
      WHERE inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id
    );

    -- ── 3. Delete empty sessions ──
    -- For each session affected by the cancelled invites, check if any
    -- participants remain besides the creator. If not, delete the session.
    -- A session with only its creator has no purpose.
    FOR affected_session IN
      SELECT DISTINCT cs.id AS session_id, cs.created_by
      FROM public.collaboration_sessions cs
      WHERE cs.id IN (
        SELECT session_id FROM public.collaboration_invites
        WHERE (inviter_id = NEW.sender_id AND invited_user_id = NEW.receiver_id)
           OR (inviter_id = NEW.receiver_id AND invited_user_id = NEW.sender_id)
      )
      AND cs.status IN ('pending', 'active')
      AND cs.conversation_id IS NOT NULL
    LOOP
      -- Count participants OTHER than the creator
      SELECT COUNT(*) INTO remaining_count
      FROM public.session_participants sp
      WHERE sp.session_id = affected_session.session_id
      AND sp.user_id != affected_session.created_by;

      IF remaining_count = 0 THEN
        -- No one left — delete the session entirely
        DELETE FROM public.collaboration_sessions
        WHERE id = affected_session.session_id;
      END IF;
    END LOOP;

    -- ── 4. Cancel pending phone invites (friend-specific) ──
    UPDATE public.pending_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.sender_id
    AND converted_user_id = NEW.receiver_id
    AND status = 'pending';

    UPDATE public.pending_invites
    SET status = 'cancelled', updated_at = NOW()
    WHERE inviter_id = NEW.receiver_id
    AND converted_user_id = NEW.sender_id
    AND status = 'pending';

    -- ── 5. Expire referral credits ──
    UPDATE public.referral_credits
    SET status = 'expired'
    WHERE ((referrer_id = NEW.sender_id AND referred_id = NEW.receiver_id)
       OR  (referrer_id = NEW.receiver_id AND referred_id = NEW.sender_id))
    AND status = 'pending';

  END IF;
  RETURN NEW;
END;
$$;

-- A9. check_mutual_like (copy of the baseline; only current accepted members' right swipes count).
CREATE OR REPLACE FUNCTION "public"."check_mutual_like"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_right_swipe_count INTEGER;
  v_existing_saved_card_id UUID;
  v_new_saved_card_id UUID;
  v_card_json JSONB;
  v_swiper RECORD;
  v_lock_key BIGINT;
  v_telemetry_available BOOLEAN;
BEGIN
  -- Only process right swipes
  IF NEW.swipe_state != 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Idempotency guard (ORCH-0558 HF-7): if this row was already
  -- 'swiped_right' and is just being re-upserted (deck regen, client
  -- retry), skip quorum logic. Prevents double-counted votes.
  IF TG_OP = 'UPDATE' AND OLD.swipe_state = 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Check if telemetry table exists (defensive — in case migration
  -- ordering ever flips). Kept as a cached flag per trigger invocation.
  v_telemetry_available := EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'match_telemetry_events'
  );

  -- Advisory lock (ORCH-0558 RC-3 fix): serialize any concurrent triggers
  -- for the same (session_id, experience_id) pair. Held until Tx
  -- commit/rollback. Canonical key ordering ensures deadlock-free because
  -- all triggers acquire locks in identical (session_id, experience_id)
  -- order.
  v_lock_key := hashtextextended(
    NEW.session_id::TEXT || '|' || NEW.experience_id::TEXT, 0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- After lock, check if the card is already saved (post-0558 cleanup:
  -- experience_id is NOT NULL, so single-column match is authoritative).
  SELECT id INTO v_existing_saved_card_id
  FROM public.board_saved_cards
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
  LIMIT 1;

  -- If already saved, attach vote
  IF v_existing_saved_card_id IS NOT NULL THEN
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_existing_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;

    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, saved_card_id, reason
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, v_existing_saved_card_id, 'existing_row_votes_attached'
      );
    END IF;

    RETURN NEW;
  END IF;

  -- Count right-swipes (lock is held, so count is consistent with concurrent Txs)
  SELECT COUNT(*) INTO v_right_swipe_count
  FROM public.board_user_swipe_states s
  WHERE s.session_id = NEW.session_id AND s.experience_id = NEW.experience_id
    AND s.swipe_state = 'swiped_right'
    AND EXISTS (SELECT 1 FROM public.session_participants sp
                 WHERE sp.session_id = s.session_id AND sp.user_id = s.user_id AND sp.has_accepted = true);

  -- Threshold: 2+ right-swipes = match
  IF v_right_swipe_count < 2 THEN
    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, reason, quorum_count
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, 'quorum_not_met', v_right_swipe_count
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Retrieve card_data from any swipe-state row for this (session, experience)
  SELECT card_data INTO v_card_json
  FROM public.board_user_swipe_states
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
    AND card_data IS NOT NULL
  ORDER BY swiped_at DESC
  LIMIT 1;

  -- Fallback stub (rare: pre-0556 clients with no card_data)
  IF v_card_json IS NULL THEN
    v_card_json := jsonb_build_object(
      'id', NEW.experience_id,
      'title', 'Matched experience'
    );
  END IF;

  -- Promote with ON CONFLICT safety net. Unique index
  -- `board_saved_cards_session_experience_unique` (migration 000002)
  -- catches any lock escape. Loser falls into attach-vote branch below.
  INSERT INTO public.board_saved_cards (
    session_id, experience_id, card_data, saved_by
  ) VALUES (
    NEW.session_id, NEW.experience_id, v_card_json, NEW.user_id
  )
  ON CONFLICT (session_id, experience_id) DO NOTHING
  RETURNING id INTO v_new_saved_card_id;

  -- If ON CONFLICT hit, another trigger in a sibling Tx beat us.
  IF v_new_saved_card_id IS NULL THEN
    SELECT id INTO v_new_saved_card_id
    FROM public.board_saved_cards
    WHERE session_id = NEW.session_id AND experience_id = NEW.experience_id
    LIMIT 1;

    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_new_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;

    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, saved_card_id, reason
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, v_new_saved_card_id, 'concurrency_conflict_attached_to_existing'
      );
    END IF;

    RETURN NEW;
  END IF;

  -- Fresh promotion succeeded. Insert votes for ALL right-swipers.
  FOR v_swiper IN
    SELECT user_id
    FROM public.board_user_swipe_states
    WHERE session_id = NEW.session_id
      AND experience_id = NEW.experience_id
      AND swipe_state = 'swiped_right'
  LOOP
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_new_saved_card_id, v_swiper.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;
  END LOOP;

  IF v_telemetry_available THEN
    INSERT INTO public.match_telemetry_events (
      event_type, session_id, experience_id, user_id, saved_card_id, reason, quorum_count
    )
    VALUES (
      'collab_match_promotion_success', NEW.session_id, NEW.experience_id,
      NEW.user_id, v_new_saved_card_id, 'promoted', v_right_swipe_count
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."check_mutual_like"() IS 'ORCH-0558 v3: Bulletproof collab match trigger. Acquires advisory lock on (session_id, experience_id) to serialize concurrent triggers. Uses unique constraint (session_id, experience_id) + ON CONFLICT DO NOTHING as belt. Idempotency gate on UPDATE with OLD.swipe_state=swiped_right. Emits match_telemetry_events rows for every decision path. See Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0558_BULLETPROOF_COLLAB_MATCH.md.';

-- A10. check_card_lock_in (copy of the baseline; current members' RSVPs, 2+ members).
CREATE OR REPLACE FUNCTION "public"."check_card_lock_in"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
    AS $$
DECLARE
  v_session_id UUID;
  v_saved_card_id UUID;
  v_total_participants INTEGER;
  v_attending_count INTEGER;
  v_already_locked BOOLEAN;
BEGIN
  v_session_id := NEW.session_id;
  v_saved_card_id := NEW.saved_card_id;

  -- Skip if not an 'attending' RSVP
  IF NEW.rsvp_status != 'attending' THEN
    RETURN NEW;
  END IF;

  -- Check if card is already locked
  SELECT is_locked INTO v_already_locked
  FROM public.board_saved_cards
  WHERE id = v_saved_card_id;

  IF v_already_locked = true THEN
    RETURN NEW;
  END IF;

  -- Count active participants (has_accepted = true)
  SELECT COUNT(*) INTO v_total_participants
  FROM public.session_participants
  WHERE session_id = v_session_id
    AND has_accepted = true;

  -- Count attending RSVPs for this card
  SELECT COUNT(*) INTO v_attending_count
  FROM public.board_card_rsvps r
  JOIN public.session_participants sp
    ON sp.session_id = r.session_id AND sp.user_id = r.user_id AND sp.has_accepted = true
  WHERE r.session_id = v_session_id AND r.saved_card_id = v_saved_card_id AND r.rsvp_status = 'attending';

  -- Lock if ALL participants attending
  IF v_attending_count >= v_total_participants AND v_total_participants >= 2 THEN
    UPDATE public.board_saved_cards
    SET is_locked = true,
        locked_at = NOW(),
        locked_by_consensus = true
    WHERE id = v_saved_card_id;

    -- Transition session to 'locked' if not already
    UPDATE public.collaboration_sessions
    SET status = 'locked',
        updated_at = NOW()
    WHERE id = v_session_id
      AND status IN ('active', 'voting');
  END IF;

  RETURN NEW;
END;
$$;

-- A11. add_friend_to_session (copy of the baseline; accepted caller, cap).
CREATE OR REPLACE FUNCTION "public"."add_friend_to_session"("p_session_id" "uuid", "p_friend_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id    uuid := auth.uid();
  v_session_status text;
  v_existing_participant record;
  v_existing_invite record;
  v_new_invite_id uuid;
  v_new_invite_created_at timestamptz;
BEGIN
  -- Guard 1: authenticated
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'unauthenticated');
  END IF;

  -- Guard 2: self-invite refused
  IF v_caller_id = p_friend_user_id THEN
    RETURN jsonb_build_object('outcome', 'session_creator_self_invite', 'error_code', 'self_invite');
  END IF;

  -- Guard 3: caller must be a session member (or creator — covered by participant table since creators are always rows in session_participants per current code paths)
  IF NOT EXISTS (SELECT 1 FROM public.session_participants sp WHERE sp.session_id = p_session_id
                  AND sp.user_id = v_caller_id AND sp.has_accepted IS TRUE) THEN
    RETURN jsonb_build_object('outcome', 'not_session_member', 'error_code', 'caller_not_in_session');
  END IF;

  -- Guard 4: session must exist + be in invitable state
  SELECT status INTO v_session_status
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'session_not_found');
  END IF;

  IF v_session_status NOT IN ('pending', 'active') THEN
    RETURN jsonb_build_object(
      'outcome', 'session_invalid',
      'error_code', 'session_status_' || v_session_status
    );
  END IF;

  -- Guard 5: bidirectional block-check (HF-4 close)
  IF public.has_block_between(v_caller_id, p_friend_user_id) THEN
    RETURN jsonb_build_object('outcome', 'blocked', 'error_code', 'block_between_users');
  END IF;

  -- #4435: every add path enforces max_participants (accepted members).
  IF (SELECT count(*) FROM public.session_participants WHERE session_id = p_session_id AND has_accepted IS TRUE)
     >= (SELECT COALESCE(max_participants, 15) FROM public.collaboration_sessions WHERE id = p_session_id) THEN
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'session_full');
  END IF;

  -- Idempotency: already-accepted member
  SELECT user_id, has_accepted INTO v_existing_participant
    FROM public.session_participants
    WHERE session_id = p_session_id AND user_id = p_friend_user_id;

  IF FOUND AND v_existing_participant.has_accepted = TRUE THEN
    RETURN jsonb_build_object('outcome', 'already_member', 'error_code', 'friend_already_accepted');
  END IF;

  -- Idempotency: already-pending invite
  SELECT id, created_at, status INTO v_existing_invite
    FROM public.collaboration_invites
    WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

  IF FOUND AND v_existing_invite.status = 'pending' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  -- Re-pending after decline/cancel: UPDATE existing row to status='pending' (per investigation §14 Q2 + spec §0 lock)
  IF FOUND AND v_existing_invite.status IN ('declined', 'cancelled') THEN
    UPDATE public.collaboration_invites
      SET status = 'pending',
          updated_at = NOW(),
          inviter_id = v_caller_id  -- re-attribute to current adder
      WHERE id = v_existing_invite.id
      RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

    -- Also ensure session_participants row is present with has_accepted=false
    INSERT INTO public.session_participants (session_id, user_id, has_accepted)
    VALUES (p_session_id, p_friend_user_id, FALSE)
    ON CONFLICT (session_id, user_id) DO UPDATE
      SET has_accepted = FALSE
      WHERE session_participants.has_accepted = FALSE;  -- never demote an accepted row

    RETURN jsonb_build_object(
      'outcome', 'invited',
      'invite_id', v_new_invite_id,
      'created_at', v_new_invite_created_at
    );
  END IF;

  -- Happy path: insert participant + invite atomically (RPC is transactional)
  INSERT INTO public.session_participants (session_id, user_id, has_accepted)
  VALUES (p_session_id, p_friend_user_id, FALSE)
  ON CONFLICT (session_id, user_id) DO NOTHING;

  INSERT INTO public.collaboration_invites (
    session_id, inviter_id, invited_user_id, status, invite_method
  )
  VALUES (
    p_session_id, v_caller_id, p_friend_user_id, 'pending', 'friends_list'
  )
  ON CONFLICT (session_id, invited_user_id) DO NOTHING
  RETURNING id, created_at INTO v_new_invite_id, v_new_invite_created_at;

  -- If RETURNING is null, ON CONFLICT fired — extreme race; treat as already_invited
  IF v_new_invite_id IS NULL THEN
    SELECT id, created_at INTO v_existing_invite
      FROM public.collaboration_invites
      WHERE session_id = p_session_id AND invited_user_id = p_friend_user_id;

    RETURN jsonb_build_object(
      'outcome', 'already_invited',
      'invite_id', v_existing_invite.id,
      'created_at', v_existing_invite.created_at
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'invited',
    'invite_id', v_new_invite_id,
    'created_at', v_new_invite_created_at
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Last-resort safety net. Never leak stack traces. Log server-side.
    RAISE WARNING 'add_friend_to_session error for session=% friend=%: %', p_session_id, p_friend_user_id, SQLERRM;
    RETURN jsonb_build_object('outcome', 'session_invalid', 'error_code', 'rpc_internal_error');
END;
$$;

-- A12. chat_group_admit (copy of 20280403034261; session joiners are admitted directly).
CREATE OR REPLACE FUNCTION public.chat_group_admit(p_conversation_id uuid, p_user uuid, p_inviter uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_kind text := public.chat_plan_chat_kind(p_conversation_id);
  v_session_id uuid;
  v_inviter uuid;
  v_invite_id uuid;
  v_inserted uuid;
  v_prior_status text;
  v_had_invite boolean;
BEGIN
  IF v_kind = 'plain' THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (p_conversation_id, p_user)
    ON CONFLICT (conversation_id, user_id) DO NOTHING
    RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN
      PERFORM public.chat_group_post_event(
        p_conversation_id, 'joined_by_link',
        jsonb_build_object('userId', p_user, 'sharerId', p_inviter),
        public.issue_4114_first_name(p_user) || ' joined with the group link'
      );
    END IF;
    RETURN jsonb_build_object('status', 'joined', 'conversationId', p_conversation_id);
  END IF;

  IF v_kind = 'session' THEN
    SELECT c.session_id, COALESCE(p_inviter, cs.created_by)
      INTO v_session_id, v_inviter
      FROM public.conversations c
      JOIN public.collaboration_sessions cs ON cs.id = c.session_id
     WHERE c.id = p_conversation_id;
    IF v_session_id IS NULL OR v_inviter IS NULL THEN
      RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    -- #4435: the joiner goes straight in through the one admit path. The
    -- tg_4261_announce_link_join trigger posts joined_by_link when an
    -- existing non-accepted invite row turns accepted; a brand-new invite
    -- row (or an already accepted one) gets its line posted here, so every
    -- join gets exactly one joined_by_link line.
    SELECT ci.status INTO v_prior_status FROM public.collaboration_invites ci
     WHERE ci.session_id = v_session_id AND ci.invited_user_id = p_user;
    v_had_invite := FOUND;
    IF public.issue_4435_admit_member(v_session_id, p_user, v_inviter, 'link') THEN
      IF NOT v_had_invite OR v_prior_status = 'accepted' THEN
        PERFORM public.chat_group_post_event(
          p_conversation_id, 'joined_by_link',
          jsonb_build_object('userId', p_user, 'sharerId', v_inviter),
          public.issue_4114_first_name(p_user) || ' joined with the group link'
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('status', 'joined', 'conversationId', p_conversation_id, 'sessionId', v_session_id);
  END IF;

  RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_group_admit(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_group_admit(uuid, uuid, uuid) TO service_role;

-- A13. chat_plans_for_conversation (copy of 20280521004334; open plans count current members only).
CREATE OR REPLACE FUNCTION public.chat_plans_for_conversation(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_plans jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM public.chat_plan_require_member(p_conversation_id, v_uid);

  SELECT cp.history_visible_from INTO v_from
    FROM public.conversation_participants cp
   WHERE cp.conversation_id = p_conversation_id AND cp.user_id = v_uid;

  WITH base AS (
    SELECT p.*,
           bsc.card_data AS deck_card_data,
           bsc.locked_at AS deck_locked_at,
           public.chat_plan_effective_status(p) AS eff_status,
           CASE WHEN p.source = 'deck' THEN (
             SELECT min(ce.scheduled_at) FROM public.calendar_entries ce WHERE ce.board_card_id = p.saved_card_id
           ) ELSE p.scheduled_at END AS eff_scheduled_at,
           public.chat_plan_can_lock(p, v_uid) AS can_lock,
           (SELECT count(*) FROM public.chat_plan_time_options o WHERE o.plan_id = p.id) AS option_count,
           (SELECT count(*) FROM public.chat_plan_place_options o WHERE o.plan_id = p.id) AS place_option_count
      FROM public.chat_plans p
      LEFT JOIN public.board_saved_cards bsc ON bsc.id = p.saved_card_id
     WHERE p.conversation_id = p_conversation_id
       AND p.status <> 'cancelled'
  ), picked AS (
    SELECT * FROM base b
     WHERE b.eff_status = 'deciding'
        OR (b.eff_status = 'scheduled'
            AND COALESCE(b.eff_scheduled_at, b.deck_locked_at, b.locked_at, b.created_at) >= now() - interval '180 days')
     ORDER BY b.created_at DESC
     LIMIT 100
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'source', b.source,
      'sessionId', b.session_id,
      'savedCardId', b.saved_card_id,
      'messageId', b.message_id,
      'messageVisible', EXISTS (
        SELECT 1 FROM public.messages m
         WHERE m.id = b.message_id AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'createdBy', b.created_by,
      'createdByName', CASE WHEN b.created_by IS NULL THEN NULL ELSE public.issue_4114_first_name(b.created_by) END,
      'title', b.title,
      'whereKind', b.where_kind,
      'place', CASE WHEN b.where_kind IN ('place', 'address') THEN jsonb_build_object(
        'poolId', b.place_pool_id, 'providerPlaceId', b.provider_place_id, 'name', b.place_name,
        'address', b.place_address, 'lat', b.place_lat, 'lng', b.place_lng, 'photoUrl', b.place_photo_url
      ) END,
      'link', public.chat_plan_link_json(b.link_url, b.link_domain),
      'places', CASE WHEN b.source = 'deck' THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'kind', o.kind, 'poolId', o.place_pool_id, 'providerPlaceId', o.provider_place_id,
          'name', o.place_name, 'address', o.place_address, 'lat', o.place_lat, 'lng', o.place_lng,
          'photoUrl', o.place_photo_url,
          'link', public.chat_plan_link_json(o.link_url, o.link_domain),
          'addedBy', o.added_by, 'isOriginal', o.is_original,
          'voterIds', COALESCE((
            SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id)
              FROM public.chat_plan_place_votes v WHERE v.option_id = o.id
                AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = v.user_id))
          ), '[]'::jsonb)
        ) ORDER BY o.is_original DESC, o.created_at, o.id)
        FROM public.chat_plan_place_options o WHERE o.plan_id = b.id
      ), '[]'::jsonb) END,
      'cardData', CASE WHEN b.source = 'deck' THEN b.deck_card_data END,
      'whenMode', b.when_mode,
      'openTimes', b.open_times,
      'status', b.eff_status,
      'scheduledAt', b.eff_scheduled_at,
      'durationMinutes', CASE WHEN b.source = 'deck' THEN (
        SELECT min(ce.duration_minutes) FROM public.calendar_entries ce WHERE ce.board_card_id = b.saved_card_id
      ) ELSE b.duration_minutes END,
      'lockedAt', CASE WHEN b.source = 'deck' THEN b.deck_locked_at ELSE b.locked_at END,
      'lockedBy', b.locked_by,
      'note', b.note,
      'createdAt', b.created_at,
      'updatedAt', b.updated_at,
      'options', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'startsAt', o.starts_at, 'addedBy', o.added_by,
          'voterIds', COALESCE((
            SELECT jsonb_agg(v.user_id ORDER BY v.created_at, v.user_id)
              FROM public.chat_plan_time_votes v WHERE v.option_id = o.id
                AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = v.user_id))
          ), '[]'::jsonb)
        ) ORDER BY o.starts_at)
        FROM public.chat_plan_time_options o WHERE o.plan_id = b.id
      ), '[]'::jsonb),
      'rsvps', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'going' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = r.user_id))), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'maybe' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = r.user_id))), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.chat_plan_rsvps r WHERE r.plan_id = b.id AND r.status = 'cant' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = r.user_id))), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'going', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'attending' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = r.user_id))), '[]'::jsonb),
        'maybe', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'maybe' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = r.user_id))), '[]'::jsonb),
        'cant', COALESCE((SELECT jsonb_agg(r.user_id ORDER BY r.updated_at) FROM public.board_card_rsvps r WHERE r.session_id = b.session_id AND r.saved_card_id = b.saved_card_id AND r.rsvp_status = 'not_attending' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = r.user_id))), '[]'::jsonb)
      ) END,
      'reactions', CASE WHEN b.source = 'chat' THEN jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'up'), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.chat_plan_reactions x WHERE x.plan_id = b.id AND x.kind = 'down'), '[]'::jsonb)
      ) ELSE jsonb_build_object(
        'up', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'up' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = x.user_id))), '[]'::jsonb),
        'down', COALESCE((SELECT jsonb_agg(x.user_id ORDER BY x.updated_at) FROM public.board_votes x WHERE x.session_id = b.session_id AND x.saved_card_id = b.saved_card_id AND x.vote_type = 'down' AND (b.eff_status <> 'deciding' OR EXISTS (SELECT 1 FROM public.conversation_participants cpm WHERE cpm.conversation_id = p_conversation_id AND cpm.user_id = x.user_id))), '[]'::jsonb)
      ) END,
      'commentCount', (
        SELECT count(*) FROM public.messages m
         WHERE m.plan_id = b.id AND m.message_type NOT IN ('plan', 'system') AND m.deleted_at IS NULL
           AND (v_from IS NULL OR m.created_at >= v_from)
      ),
      'canLock', b.eff_status = 'deciding' AND b.can_lock,
      'canEdit', b.source = 'chat' AND b.created_by IS NOT DISTINCT FROM v_uid AND b.status IN ('deciding', 'scheduled'),
      'canCancel', b.source = 'chat' AND b.can_lock,
      'canAddTime', b.eff_status = 'deciding' AND (b.open_times OR b.can_lock OR b.created_by IS NOT DISTINCT FROM v_uid)
                    AND b.option_count < 8,
      'canAddPlace', b.source = 'chat' AND b.eff_status = 'deciding'
                     AND (b.open_times OR b.can_lock OR b.created_by IS NOT DISTINCT FROM v_uid)
                     AND b.place_option_count < 6
    ) ORDER BY b.created_at DESC
  ), '[]'::jsonb) INTO v_plans
  FROM picked b;

  RETURN jsonb_build_object(
    'viewerId', v_uid,
    'memberCount', (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = p_conversation_id),
    'historyVisibleFrom', v_from,
    'plans', v_plans
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plans_for_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_plans_for_conversation(uuid) TO authenticated;

-- A13b. plan_lock's place winner (copy of 20280403054261) counts current members' votes only.
CREATE OR REPLACE FUNCTION public.chat_plan_place_leader(p_plan_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT o.id
    FROM public.chat_plan_place_options o
   WHERE o.plan_id = p_plan_id
   ORDER BY (SELECT count(*) FROM public.chat_plan_place_votes v
              JOIN public.chat_plans p ON p.id = v.plan_id
             WHERE v.option_id = o.id
               AND EXISTS (SELECT 1 FROM public.conversation_participants cpm
                            WHERE cpm.conversation_id = p.conversation_id AND cpm.user_id = v.user_id)) DESC,
            o.is_original DESC, o.created_at, o.id
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_place_leader(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_place_leader(uuid) TO service_role;
