-- ============================================================================
-- ORCH-0908 hotfix bundle — calendar trigger dead-reference + scheduled_at
--                            NULLABLE refactor + status='pending' for unscheduled
-- ============================================================================
--
-- Bundled into ORCH-0908 [Collab session lifecycle: Lock-In → Schedule →
-- V_{n+1} Recycle] PR per operator-confirmed narrow exception. Three related
-- defects shipped together because they all surfaced from ORCH-0908 being
-- the first feature to actually drive board_saved_cards.is_locked=true in
-- production usage:
--
--   1. create_calendar_entries_on_lock referenced the non-existent table
--      public.board_session_preferences (dead reference since the baseline
--      squash in 2026-05-05, never fired in production until ORCH-0908).
--
--   2. The trigger wrote a fake placeholder scheduled_at = NOW() + 1 day
--      which leaked into the consumer Calendar tab if the admin tapped
--      "Lock it in" but didn't immediately proceed to schedule. Constitution
--      #9 violation (no fabricated data).
--
--   3. calendar_entries.scheduled_at was NOT NULL, forcing the trigger to
--      pick a placeholder value when no schedule existed yet.
--
-- FIX
-- ---
-- (a) DROP NOT NULL on calendar_entries.scheduled_at so unscheduled
--     collaboration entries can be NULL.
-- (b) Rewrite create_calendar_entries_on_lock to:
--       - drop the dead board_session_preferences JOIN entirely
--       - INSERT scheduled_at = NULL (no fabricated date)
--       - INSERT status = 'pending' (not 'confirmed' — until admin schedules)
-- (c) Update rpc_admin_schedule_locked_card to flip status='confirmed' when
--     it writes the real user-picked scheduled_at, so the row transitions
--     pending → confirmed atomically with the schedule write.
--
-- All readers of calendar_entries.scheduled_at have been audited for NULL
-- safety in the same PR's mobile changeset.
--
-- ROLLBACK
-- --------
-- Single `git revert` of the PR. The schema change (DROP NOT NULL) is
-- backward compatible — existing non-NULL rows remain valid. The trigger
-- function is restored to the pre-hotfix (broken) state on revert.
--
-- ============================================================================

-- ============================================================================
-- 1. SCHEMA — calendar_entries.scheduled_at NULLABLE
-- ============================================================================

ALTER TABLE public.calendar_entries
  ALTER COLUMN scheduled_at DROP NOT NULL;

COMMENT ON COLUMN public.calendar_entries.scheduled_at IS
  'When the user/group plans to do this experience. NULL when a collab card has been locked-in (is_locked=true) but admin has not yet picked a date via rpc_admin_schedule_locked_card. Once the admin picks a date, this column is set and status flips from ''pending'' to ''confirmed''. Per ORCH-0908 hotfix 2026-05-21 (Constitution #9 — no fabricated placeholder dates).';

-- ============================================================================
-- 2. FUNCTION — create_calendar_entries_on_lock (rewrite)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_calendar_entries_on_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_participant RECORD;
  v_card_data JSONB;
BEGIN
  -- Defensive guard mirroring the trigger WHEN clause: only fire when
  -- is_locked transitions false → true.
  IF OLD.is_locked = true OR NEW.is_locked = false THEN
    RETURN NEW;
  END IF;

  v_card_data := NEW.card_data;

  -- Create one calendar_entries row per accepted participant.
  --
  -- ORCH-0908 hotfix (2026-05-21):
  --   - scheduled_at = NULL until admin picks the real date via
  --     rpc_admin_schedule_locked_card (Constitution #9 — no fabricated dates).
  --   - status = 'pending' (not 'confirmed') — confirmed-ness comes with
  --     the schedule write.
  --   - Dead LEFT JOIN on public.board_session_preferences removed
  --     (table never existed in production; reference was a baseline
  --     leftover that never executed because the trigger never ran).
  --   - duration_minutes = NULL (admin picks duration with the date).
  FOR v_participant IN
    SELECT user_id
      FROM public.session_participants
     WHERE session_id = NEW.session_id
       AND has_accepted = true
  LOOP
    INSERT INTO public.calendar_entries (
      user_id,
      board_card_id,
      source,
      card_data,
      status,
      scheduled_at,
      duration_minutes
    ) VALUES (
      v_participant.user_id,
      NEW.id,
      'collaboration',
      v_card_data,
      'pending',
      NULL,
      NULL
    )
    ON CONFLICT (user_id, board_card_id) WHERE board_card_id IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.create_calendar_entries_on_lock() IS
  'Fires on board_saved_cards UPDATE when is_locked transitions false→true. Inserts one calendar_entries row per accepted session participant with scheduled_at=NULL + status=''pending''. ORCH-0908''s rpc_admin_schedule_locked_card subsequently sets the user-picked scheduled_at + flips status to ''confirmed''. Hotfix 2026-05-21: removed dead board_session_preferences JOIN; switched from placeholder scheduled_at to NULL (Constitution #9).';

-- ============================================================================
-- 3. FUNCTION — rpc_admin_schedule_locked_card (flip status='confirmed')
-- ============================================================================
-- Replaces the body shipped in 20260626000000 to ALSO flip status from
-- 'pending' to 'confirmed' when scheduled_at is written. Atomic pending→
-- confirmed transition with the schedule write.

CREATE OR REPLACE FUNCTION public.rpc_admin_schedule_locked_card(
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
  v_is_locked boolean;
  v_card_title text;
  v_card_place_id uuid;
  v_session_conversation_id uuid;
  v_new_deck_version int;
  v_updated_count int;
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

  SELECT is_locked, card_data->>'title'
    INTO v_is_locked, v_card_title
    FROM public.board_saved_cards
    WHERE id = p_saved_card_id AND session_id = p_session_id;

  IF v_is_locked IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: card not found in this session';
  END IF;

  IF v_is_locked = false THEN
    RAISE EXCEPTION 'ORCH-0908: card must be locked before scheduling (call rpc_admin_lock_card first)';
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

  -- Update ALL accepted participants' calendar_entries rows for this card.
  -- ORCH-0908 hotfix: also flip status='pending' → 'confirmed' so the row
  -- transitions atomically with the schedule write.
  UPDATE public.calendar_entries
    SET scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        status = 'confirmed',
        updated_at = NOW()
    WHERE board_card_id = p_saved_card_id
      AND source = 'collaboration';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

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

  SELECT id INTO v_session_conversation_id
    FROM public.conversations
    WHERE session_id = p_session_id
      AND linked_entity_type = 'session'
    LIMIT 1;

  IF v_session_conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id, sender_id, content, message_type, card_payload
    ) VALUES (
      v_session_conversation_id,
      NULL,
      '📅 Scheduled for ' || to_char(p_scheduled_at AT TIME ZONE 'UTC', 'Mon DD, HH24:MI') || ' UTC',
      'text',
      jsonb_build_object(
        'event', 'plan_scheduled',
        'saved_card_id', p_saved_card_id,
        'scheduled_at', p_scheduled_at,
        'duration_minutes', p_duration_minutes,
        'scheduled_by_user_id', v_uid
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'scheduled',
    'saved_card_id', p_saved_card_id,
    'session_id', p_session_id,
    'scheduled_at', p_scheduled_at,
    'duration_minutes', p_duration_minutes,
    'updated_participant_count', v_updated_count,
    'new_deck_version', v_new_deck_version
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_schedule_locked_card(uuid, uuid, timestamptz, int) IS
  'ORCH-0908: admin/creator schedules a locked card. Updates all accepted participants calendar_entries: sets scheduled_at, duration_minutes, flips status pending→confirmed atomically. Mints V_{n+1} with locked card excluded, transitions session.status=active, inserts system message. Hotfix 2026-05-21: writes status=confirmed (paired with new create_calendar_entries_on_lock which writes pending).';

GRANT EXECUTE ON FUNCTION public.rpc_admin_schedule_locked_card(uuid, uuid, timestamptz, int) TO authenticated;

-- ============================================================================
-- Verification probes (orchestrator runs post-push):
--
--   -- 1. scheduled_at now nullable
--   SELECT is_nullable FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='calendar_entries'
--       AND column_name='scheduled_at';
--   -- Expected: 'YES'
--
--   -- 2. Trigger function references NULL placeholder, not board_session_preferences
--   SELECT
--     prosrc ILIKE '%board_session_preferences%' AS still_has_dead_ref,
--     prosrc ILIKE '%''pending''%' AS writes_pending_status
--   FROM pg_proc WHERE proname='create_calendar_entries_on_lock';
--   -- Expected: false, true
--
--   -- 3. Schedule RPC flips status='confirmed' on update
--   SELECT prosrc ILIKE '%status = ''confirmed''%' AS sets_confirmed
--     FROM pg_proc WHERE proname='rpc_admin_schedule_locked_card';
--   -- Expected: true
-- ============================================================================
