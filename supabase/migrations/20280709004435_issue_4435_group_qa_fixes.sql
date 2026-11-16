-- #4435 follow-up (QA round 1): group membership rules hold on every path.
--
--   Q1. Accepting an invite respects the 15 cap and needs a live invite. The
--       accept call locks the group row first, refuses a full group
--       (PT409 conflict_group_full), and accepts only a pending invite (an
--       already-accepted invite answers again for a current member, so a
--       repeated tap still works). A row-level backstop holds the cap for any
--       other path that makes someone an accepted member.
--   Q2. Leaving clears your invite. When an accepted member's row goes, by any
--       path (leave, remove, own-row delete), their accepted invite goes too.
--   Q3. Only current members manage the group. The creator's extra powers
--       (member rows, invites, group settings, admin changes, deleting the
--       group, locking a plan) apply only while the creator is still an
--       accepted member. A creator who left is an ordinary non-member.
--   Q4. Removed members' old right swipes no longer add votes when a new
--       match is made (the count already ignored them).
--
-- Invariants (declared in
-- supabase/migrations/__tests__/issue_4435_group_qa_fixes.implementor.pg17.test.sql):
--   I-4435-ACCEPT-CAP-AND-LIVE-INVITE, I-4435-LEAVE-CLEARS-INVITE,
--   I-4435-CURRENT-CREATOR-ONLY, I-4435-MATCH-VOTES-CURRENT-MEMBERS.
--
-- Replaced bodies are copied from their latest definitions and change only the
-- lines named here. Policy text is unchanged: is_session_creator, which every
-- creator-power policy calls, now means "the creator and still an accepted
-- member".

-- Q0. Does the group have any accepted member yet? (internal helper)
CREATE OR REPLACE FUNCTION public.issue_4435_has_accepted_member(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.session_participants sp
                  WHERE sp.session_id = p_session_id AND sp.has_accepted IS TRUE);
$$;
-- The member and group guards run as the app client (SECURITY INVOKER), so the
-- client role may call this; it answers one yes/no for a group id.
REVOKE ALL ON FUNCTION public.issue_4435_has_accepted_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4435_has_accepted_member(uuid) TO authenticated, service_role;

-- Q3a. The creator check every creator-power policy and the member guard use.
CREATE OR REPLACE FUNCTION public.is_session_creator(p_session_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.collaboration_sessions cs
     WHERE cs.id = p_session_id AND cs.created_by = p_user_id
       AND EXISTS (SELECT 1 FROM public.session_participants sp
                    WHERE sp.session_id = cs.id AND sp.user_id = p_user_id AND sp.has_accepted IS TRUE)
  );
$$;

-- Q3b. Member guard (copy of 20280708046436). Two changes: the creator adds
-- their own row only while the group has no accepted member yet (creating it),
-- and v_is_creator (is_session_creator) now needs the creator to be a member.
CREATE OR REPLACE FUNCTION public.tg_issue_4436_guard_member_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid := COALESCE(NEW.session_id, OLD.session_id);
  v_is_creator boolean;
  v_is_accepted boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;  -- server function or service role
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  v_is_creator := public.is_session_creator(v_session, v_uid);

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id = v_uid
       AND EXISTS (SELECT 1 FROM public.collaboration_sessions cs
                    WHERE cs.id = NEW.session_id AND cs.created_by = v_uid)
       AND NOT public.issue_4435_has_accepted_member(NEW.session_id) THEN
      RETURN NEW;  -- creator adds own row when creating the group
    END IF;
    IF NEW.is_admin IS TRUE OR NEW.has_accepted IS TRUE
       OR COALESCE(NEW.role, 'member') <> 'member' THEN
      RAISE EXCEPTION 'a new member starts as a pending, non-admin member' USING ERRCODE = '42501';
    END IF;
    IF NEW.user_id = v_uid AND NOT EXISTS (
         SELECT 1 FROM public.collaboration_invites ci
          WHERE ci.session_id = NEW.session_id AND ci.invited_user_id = v_uid
            AND ci.status = 'pending') THEN
      RAISE EXCEPTION 'joining a group needs an invitation' USING ERRCODE = '42501';
    END IF;
    IF NEW.user_id <> v_uid AND NOT v_is_creator THEN
      SELECT EXISTS (SELECT 1 FROM public.session_participants sp
                      WHERE sp.session_id = NEW.session_id AND sp.user_id = v_uid
                        AND sp.has_accepted IS TRUE) INTO v_is_accepted;
      IF NOT v_is_accepted THEN
        RAISE EXCEPTION 'only the group creator or an accepted member can invite' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.has_accepted IS DISTINCT FROM OLD.has_accepted OR NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    RAISE EXCEPTION 'membership fields can only change through the server' USING ERRCODE = '42501';
  END IF;
  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.role IS DISTINCT FROM OLD.role)
     AND NOT v_is_creator THEN
    RAISE EXCEPTION 'only the group creator can change admins' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4436_guard_member_write() FROM PUBLIC, anon, authenticated;

-- Q3c. Group guard (copy of 20280708044436). The creator's full say needs the
-- creator to be an accepted member (or the group to have no member yet, while
-- it is being created); a creator who left is refused like any non-member.
CREATE OR REPLACE FUNCTION public.tg_issue_4436_guard_group_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'group ownership can only change through the server' USING ERRCODE = '42501';
  END IF;
  IF OLD.created_by = v_uid
     AND (public.is_session_creator(OLD.id, v_uid) OR NOT public.issue_4435_has_accepted_member(OLD.id)) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.session_participants sp
                  WHERE sp.session_id = OLD.id AND sp.user_id = v_uid AND sp.has_accepted IS TRUE) THEN
    RAISE EXCEPTION 'only accepted members can change the group' USING ERRCODE = '42501';
  END IF;
  IF NEW.invite_code IS DISTINCT FROM OLD.invite_code OR NEW.invite_link IS DISTINCT FROM OLD.invite_link
     OR NEW.max_participants IS DISTINCT FROM OLD.max_participants
     OR NEW.session_type IS DISTINCT FROM OLD.session_type THEN
    RAISE EXCEPTION 'only the group creator can change these group settings' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4436_guard_group_write() FROM PUBLIC, anon, authenticated;

-- Q3d. Deleting a group (cs_delete lets the creator) needs the creator to still
-- be a member, unless the group has no member at all (a half-made group).
CREATE OR REPLACE FUNCTION public.tg_issue_4435_guard_group_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN OLD;  -- server function, cascade or service role
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  IF public.issue_4435_has_accepted_member(OLD.id) AND NOT public.is_session_creator(OLD.id, v_uid) THEN
    RAISE EXCEPTION 'only the group creator, while a member, can delete the group' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4435_guard_group_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4435_guard_group_delete ON public.collaboration_sessions;
CREATE TRIGGER issue_4435_guard_group_delete
  BEFORE DELETE ON public.collaboration_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4435_guard_group_delete();

-- Q3e. chat_group_is_admin (copy of 20280403034261): the creator counts only
-- while an accepted member; an admin flag counts only on an accepted row.
CREATE OR REPLACE FUNCTION public.chat_group_is_admin(p_conversation_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT CASE public.chat_plan_chat_kind(c.id)
      WHEN 'session' THEN EXISTS (
        SELECT 1 FROM public.collaboration_sessions cs
          JOIN public.session_participants sp
            ON sp.session_id = cs.id AND sp.user_id = p_user AND sp.has_accepted IS TRUE
         WHERE cs.id = c.session_id
           AND (cs.created_by = p_user OR sp.is_admin IS TRUE)
      )
      WHEN 'plain' THEN c.created_by IS NOT DISTINCT FROM p_user AND p_user IS NOT NULL
      ELSE false
    END
    FROM public.conversations c
    WHERE c.id = p_conversation_id
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.chat_group_is_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_group_is_admin(uuid, uuid) TO service_role;

-- Q3f. chat_plan_can_lock (copy of 20280403044261): a deck plan's creator or
-- admin must be an accepted member.
CREATE OR REPLACE FUNCTION public.chat_plan_can_lock(p_plan public.chat_plans, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_user IS NULL THEN false
    WHEN p_plan.source = 'deck' THEN EXISTS (
      SELECT 1 FROM public.collaboration_sessions cs
        JOIN public.session_participants sp
          ON sp.session_id = cs.id AND sp.user_id = p_user AND sp.has_accepted IS TRUE
       WHERE cs.id = p_plan.session_id
         AND (cs.created_by = p_user OR sp.is_admin IS TRUE)
    )
    WHEN p_plan.created_by IS NOT NULL
         AND public.is_conversation_participant(p_plan.conversation_id, p_plan.created_by)
      THEN p_plan.created_by = p_user
    ELSE public.chat_group_is_admin(p_plan.conversation_id, p_user)
  END;
$function$;
REVOKE ALL ON FUNCTION public.chat_plan_can_lock(public.chat_plans, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_plan_can_lock(public.chat_plans, uuid) TO service_role;

-- Q3g. rpc_admin_lock_and_schedule_card (copy of 20271230044114): only a
-- current member's creator or admin role counts.
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

  -- #4435 follow-up: only a current (accepted) member's creator or admin role counts.
  SELECT (COALESCE(sp.has_accepted, false) = true
          AND (cs.created_by = v_uid OR COALESCE(sp.is_admin, false) = true))
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

-- Q1a. accept_session_with_prefs (copy of 20260701000000). Changes: lock the
-- group row first; accept only a pending invite (an accepted one answers again
-- for a current member); refuse a full group. Same signature, grants and
-- return shape.
CREATE OR REPLACE FUNCTION public.accept_session_with_prefs(
  p_session_id uuid,
  p_invite_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_categories text[],
  p_intents text[],
  p_travel_mode text,
  p_travel_constraint_value int,
  p_date_option text DEFAULT NULL,
  p_datetime_pref text DEFAULT NULL,
  p_selected_dates text[] DEFAULT NULL,
  p_use_gps_location boolean DEFAULT true,
  p_custom_location text DEFAULT NULL,
  p_intent_toggle boolean DEFAULT true,
  p_category_toggle boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invited_user_id uuid;
  v_invite_status text;
  v_frontier int;
  v_prefs_merge jsonb;
  v_cap int;
  v_already_member boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ORCH-0909: authentication required';
  END IF;

  -- #4435 follow-up: the group row is locked before anything is read, the same
  -- order add_group_members and issue_4435_admit_member use.
  SELECT COALESCE(max_participants, 15) INTO v_cap
    FROM public.collaboration_sessions WHERE id = p_session_id FOR UPDATE;

  SELECT invited_user_id, status INTO v_invited_user_id, v_invite_status
    FROM public.collaboration_invites
    WHERE id = p_invite_id
      AND session_id = p_session_id;

  IF v_invited_user_id IS NULL OR v_invited_user_id <> v_user_id THEN
    RAISE EXCEPTION 'ORCH-0909: invite_not_found_or_not_owner';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.session_participants
                  WHERE session_id = p_session_id AND user_id = v_user_id AND has_accepted = true)
    INTO v_already_member;

  -- #4435 follow-up: only a pending invite is accepted. An accepted invite
  -- answers again only for someone who is still a member (a repeated tap);
  -- declined, cancelled or left-behind invites are refused.
  IF NOT (v_invite_status = 'pending' OR (v_invite_status = 'accepted' AND v_already_member)) THEN
    RAISE EXCEPTION 'ORCH-0909: invite_not_found_or_not_owner';
  END IF;

  -- #4435 follow-up: the 15 cap holds when a pending invite is accepted.
  IF NOT v_already_member AND (
       SELECT count(*) FROM public.session_participants
        WHERE session_id = p_session_id AND has_accepted = true) >= v_cap THEN
    RAISE EXCEPTION 'conflict_group_full' USING ERRCODE = 'PT409';
  END IF;

  -- Suppress the legacy session_participants touch trigger while this RPC
  -- upserts the participant row. The final participant_prefs UPDATE below
  -- fires recompute_deck_version_after_prefs_change exactly once with the
  -- complete accept+prefs+GPS picture.
  PERFORM set_config('orch_0909.accept_with_prefs', 'true', true);

  SELECT COALESCE(MAX(current_position), 0) INTO v_frontier
    FROM public.session_participants
    WHERE session_id = p_session_id
      AND has_accepted = true
      AND user_id <> v_user_id;

  UPDATE public.collaboration_invites
    SET status = 'accepted',
        updated_at = now()
    WHERE id = p_invite_id
      AND invited_user_id = v_user_id;

  INSERT INTO public.session_participants (
    session_id,
    user_id,
    has_accepted,
    joined_at,
    current_position
  ) VALUES (
    p_session_id,
    v_user_id,
    true,
    now(),
    v_frontier
  )
  ON CONFLICT (session_id, user_id) DO UPDATE
    SET has_accepted = true,
        joined_at = COALESCE(public.session_participants.joined_at, now()),
        current_position = GREATEST(public.session_participants.current_position, v_frontier);

  v_prefs_merge := jsonb_strip_nulls(jsonb_build_object(
    'categories', COALESCE(to_jsonb(p_categories), '[]'::jsonb),
    'intents', COALESCE(to_jsonb(p_intents), '[]'::jsonb),
    'travel_mode', COALESCE(p_travel_mode, 'walking'),
    'travel_constraint_type', 'time',
    'travel_constraint_value', COALESCE(p_travel_constraint_value, 30),
    'date_option', p_date_option,
    'datetime_pref', p_datetime_pref,
    'selected_dates', to_jsonb(p_selected_dates),
    'use_gps_location', COALESCE(p_use_gps_location, true),
    'custom_location', p_custom_location,
    'custom_lat', p_lat,
    'custom_lng', p_lng,
    'intent_toggle', COALESCE(p_intent_toggle, true),
    'category_toggle', COALESCE(p_category_toggle, true)
  ));

  UPDATE public.collaboration_sessions
    SET participant_prefs = COALESCE(participant_prefs, '{}'::jsonb)
          || jsonb_build_object(v_user_id::text, v_prefs_merge),
        updated_at = now()
    WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'user_id', v_user_id,
    'current_position', v_frontier,
    'has_gps', (p_lat IS NOT NULL AND p_lng IS NOT NULL)
  );
END;
$$;

-- Q1b. Backstop: no path makes someone an accepted member of a full group.
-- Counts accepted rows other than this person's (an upsert over an accepted
-- row, or an accepted row's other updates, never trips it), under the same
-- group-row lock the add paths take.
CREATE OR REPLACE FUNCTION public.tg_issue_4435_group_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cap integer;
BEGIN
  IF NEW.has_accepted IS NOT TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.has_accepted IS TRUE THEN RETURN NEW; END IF;
  SELECT COALESCE(cs.max_participants, 15) INTO v_cap
    FROM public.collaboration_sessions cs WHERE cs.id = NEW.session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF (SELECT count(*) FROM public.session_participants sp
       WHERE sp.session_id = NEW.session_id AND sp.has_accepted IS TRUE
         AND sp.user_id <> NEW.user_id) >= v_cap THEN
    RAISE EXCEPTION 'conflict_group_full' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4435_group_cap() FROM PUBLIC, anon, authenticated;
-- Named trg_* so it runs after issue_4436_guard_member_write (BEFORE row
-- triggers fire in name order): a refused client write keeps its 42501.
DROP TRIGGER IF EXISTS trg_issue_4435_group_cap ON public.session_participants;
CREATE TRIGGER trg_issue_4435_group_cap
  BEFORE INSERT OR UPDATE OF has_accepted ON public.session_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4435_group_cap();

-- Q2. Leaving clears your invite: an accepted member's row going (leave,
-- remove, own-row delete, any path) takes their accepted invite with it, so
-- the old invite cannot be accepted again.
CREATE OR REPLACE FUNCTION public.tg_issue_4435_leave_clears_invite()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.collaboration_invites ci
   WHERE ci.session_id = OLD.session_id AND ci.invited_user_id = OLD.user_id
     AND ci.status = 'accepted';
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.tg_issue_4435_leave_clears_invite() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS issue_4435_leave_clears_invite ON public.session_participants;
CREATE TRIGGER issue_4435_leave_clears_invite
  AFTER DELETE ON public.session_participants
  FOR EACH ROW WHEN (OLD.has_accepted IS TRUE)
  EXECUTE FUNCTION public.tg_issue_4435_leave_clears_invite();

-- Q4. check_mutual_like (copy of 20280708054435): a new match's votes come
-- only from right-swipers who are still accepted members.
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

  -- Fresh promotion succeeded. Insert votes for every right-swiper who is
  -- still an accepted member (#4435 follow-up: removed members' swipes stay
  -- on record but no longer vote).
  FOR v_swiper IN
    SELECT user_id
    FROM public.board_user_swipe_states
    WHERE session_id = NEW.session_id
      AND experience_id = NEW.experience_id
      AND swipe_state = 'swiped_right'
      AND EXISTS (SELECT 1 FROM public.session_participants sp
                   WHERE sp.session_id = board_user_swipe_states.session_id
                     AND sp.user_id = board_user_swipe_states.user_id AND sp.has_accepted = true)
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
