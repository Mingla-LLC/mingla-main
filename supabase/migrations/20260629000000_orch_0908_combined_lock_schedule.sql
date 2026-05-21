-- ============================================================================
-- ORCH-0908 rework — combined lock-and-schedule atomic RPC
-- ============================================================================
--
-- Bundled into ORCH-0908 [Collab session lifecycle: Lock-In → Schedule →
-- V_{n+1} Recycle] PR after operator-driven UX rework (2026-05-21):
--
--   - Operator-reported: tap "Lock it in" should open a date picker FIRST,
--     not lock immediately. Lock without a date is not a meaningful state.
--   - Operator-reported: the locker's name + the scheduled date/time should
--     render in the group chat as a real expandable card message, not as
--     a system message with sender_id=NULL ("Deleted user").
--
-- CHANGES
-- -------
-- (a) DROP the two-step RPCs from earlier today's migrations:
--       - rpc_admin_lock_card (was added in 20260626000000)
--       - rpc_admin_schedule_locked_card (was added in 20260626000000,
--         body amended in 20260628000000)
-- (b) CREATE the combined RPC rpc_admin_lock_and_schedule_card. Atomic:
--     auth gate → mark is_locked=true → calendar_entries flips
--     pending→confirmed with the scheduled_at the user picked → mint
--     V_{n+1} with the locked card excluded → flip session.status='active'
--     for the next round → INSERT chat message attributed to the locker.
-- (c) Chat message: sender_id = v_uid (the actual locker, not NULL).
--     message_type = 'card' so MessageBubble renders it as a clickable,
--     expandable card via the ORCH-0667 card-message substrate.
--     card_payload carries the saved_card.card_data PLUS
--     scheduled_at + duration_minutes + event='card_locked_and_scheduled'
--     + locker_user_id so the mobile chat renderer can show the
--     "Add to Calendar" affordance per-participant.
--
-- The create_calendar_entries_on_lock trigger continues to fire on the
-- board_saved_cards UPDATE (it still inserts per-participant calendar_entries
-- rows). The combined RPC then UPDATEs those rows with the scheduled_at +
-- duration + status='confirmed' inside the same transaction.
--
-- ROLLBACK
-- --------
-- Single `git revert` of the PR. The combined RPC is dropped; the two old
-- RPCs are re-created from the prior migrations (they're additive in those
-- files, so revert restores them).
--
-- ============================================================================

-- ============================================================================
-- 1. DROP the old split RPCs (replaced by the combined one)
-- ============================================================================

DROP FUNCTION IF EXISTS public.rpc_admin_lock_card(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_admin_schedule_locked_card(uuid, uuid, timestamptz, int);

-- ============================================================================
-- 2. FUNCTION — rpc_admin_lock_and_schedule_card
-- ============================================================================
-- One atomic operation. Lock + schedule + recycle + chat message in one txn.

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
  v_card_title text;
  v_card_place_id uuid;
  v_session_conversation_id uuid;
  v_new_deck_version int;
  v_updated_participant_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: authentication required';
  END IF;

  -- Auth gate: creator OR is_admin
  SELECT (cs.created_by = v_uid OR COALESCE(sp.is_admin, false) = true)
    INTO v_is_admin
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized (creator or session admin required)';
  END IF;

  -- Verify card belongs to this session + capture data
  SELECT is_locked, card_data, card_data->>'title'
    INTO v_already_locked, v_card_data, v_card_title
    FROM public.board_saved_cards
    WHERE id = p_saved_card_id AND session_id = p_session_id;

  IF v_already_locked IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: card not found in this session';
  END IF;

  IF v_already_locked = true THEN
    -- Idempotent: card already locked. Reject — the UI flow shouldn't
    -- allow re-locking; if the operator wants reschedule semantics later,
    -- that's a separate RPC.
    RAISE EXCEPTION 'ORCH-0908: card is already locked (lock-and-schedule is one-shot; reschedule is a separate flow)';
  END IF;

  -- Input validation
  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at must be in the future';
  END IF;
  IF p_scheduled_at > NOW() + INTERVAL '1 year' THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at cannot be more than 1 year out';
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 1440 THEN
    RAISE EXCEPTION 'ORCH-0908: duration_minutes must be between 15 and 1440';
  END IF;

  -- ── Lock the card ──────────────────────────────────────────────────────
  -- This fires create_calendar_entries_on_lock which INSERTs one
  -- calendar_entries row per accepted participant with status='pending'
  -- and scheduled_at=NULL.
  UPDATE public.board_saved_cards
    SET is_locked = true,
        locked_at = NOW(),
        locked_by_consensus = false
    WHERE id = p_saved_card_id;

  -- Transition session status to 'locked' briefly (the cycle restart at
  -- the end of this RPC flips it back to 'active').
  UPDATE public.collaboration_sessions
    SET status = 'locked',
        updated_at = NOW()
    WHERE id = p_session_id
      AND status IN ('pending', 'active', 'voting');

  -- ── Schedule (overwrite the trigger-inserted placeholder rows) ─────────
  -- The trigger just wrote NULL scheduled_at + status='pending'. Now
  -- atomically flip every participant's row to the user-picked date + time
  -- and status='confirmed'.
  UPDATE public.calendar_entries
    SET scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        status = 'confirmed',
        updated_at = NOW()
    WHERE board_card_id = p_saved_card_id
      AND source = 'collaboration';

  GET DIAGNOSTICS v_updated_participant_count = ROW_COUNT;

  -- ── Recycle the deck (mint V_{n+1} with this card excluded forever) ────
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

  -- Cycle restart: session.status = 'active' (next round begins).
  PERFORM set_config('orch_0908.force_recycle', 'true', true);

  UPDATE public.collaboration_sessions
    SET status = 'active',
        updated_at = NOW()
    WHERE id = p_session_id;

  -- ── Chat message: attributed to the locker, rendered as a card ─────────
  -- sender_id = v_uid (the actual locker) so MessageBubble shows their name.
  -- message_type = 'card' so MessageBubble renders it via CardPreview
  -- (ORCH-0667 card-message substrate). card_payload carries everything
  -- the chat needs to render a tappable expandable card + the "Add to
  -- Calendar" affordance per-participant.
  SELECT id INTO v_session_conversation_id
    FROM public.conversations
    WHERE session_id = p_session_id
      AND linked_entity_type = 'session'
    LIMIT 1;

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
      jsonb_build_object(
        'event', 'card_locked_and_scheduled',
        'saved_card_id', p_saved_card_id,
        'card_data', v_card_data,
        'scheduled_at', p_scheduled_at,
        'duration_minutes', p_duration_minutes,
        'locker_user_id', v_uid,
        'session_id', p_session_id
      )
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

COMMENT ON FUNCTION public.rpc_admin_lock_and_schedule_card(uuid, uuid, timestamptz, int) IS
  'ORCH-0908 rework (2026-05-21): atomic lock-and-schedule. Creator or session-admin only. Marks board_saved_cards.is_locked=true (fires create_calendar_entries_on_lock trigger → per-participant pending rows), overwrites those rows with scheduled_at + duration + status=confirmed, mints V_{n+1} with this card excluded forever (via rpc_force_deck_recycle), flips session.status back to active for the next round, and INSERTs a chat message attributed to the locker (sender_id=v_uid, message_type=card, card_payload includes the saved_card.card_data + scheduled_at + locker_user_id) so the chat renders an expandable card with the locker''s name. Replaces the split rpc_admin_lock_card + rpc_admin_schedule_locked_card from earlier in the same PR.';

GRANT EXECUTE ON FUNCTION public.rpc_admin_lock_and_schedule_card(uuid, uuid, timestamptz, int) TO authenticated;

-- ============================================================================
-- Verification probes (orchestrator runs post-push):
--
--   SELECT
--     EXISTS (SELECT 1 FROM pg_proc WHERE proname='rpc_admin_lock_and_schedule_card') AS new_combined_exists,
--     EXISTS (SELECT 1 FROM pg_proc WHERE proname='rpc_admin_lock_card') AS old_lock_dropped,
--     EXISTS (SELECT 1 FROM pg_proc WHERE proname='rpc_admin_schedule_locked_card') AS old_schedule_dropped;
--   -- Expected: true, false, false
-- ============================================================================
