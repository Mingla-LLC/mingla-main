-- ============================================================================
-- ORCH-0908 rework — flatten card_payload to match ORCH-0667 CardPayload shape
-- ============================================================================
--
-- Smoke test on 2026-05-21 revealed the chat card-bubble + ExpandedCardModal
-- both read CardPayload fields at the TOP LEVEL (cardPayload.title,
-- cardPayload.image, cardPayload.category, etc.) per the ORCH-0667 substrate.
--
-- The combined RPC from 20260629000000 nested the card under card_payload.card_data,
-- so the chat renderer fell back to the bookmark placeholder + 'No images
-- available' + zero-rating stub.
--
-- This migration drops + recreates rpc_admin_lock_and_schedule_card with the
-- card_payload built by spreading saved_card.card_data at the top level and
-- adding four lock-in extras alongside (lockInEvent, scheduledAt,
-- durationMinutes, lockerUserId) so the chat renders the SAME visual + info
-- payload the user saw on the deck.
--
-- ROLLBACK: single `git revert` of the PR. Combined RPC drops + the prior
-- (nested) version is recreated from 20260629000000.
-- ============================================================================

DROP FUNCTION IF EXISTS public.rpc_admin_lock_and_schedule_card(uuid, uuid, timestamptz, int);

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

COMMENT ON FUNCTION public.rpc_admin_lock_and_schedule_card(uuid, uuid, timestamptz, int) IS
  'ORCH-0908 rework v2 (2026-05-21): atomic lock-and-schedule. card_payload is FLAT (ORCH-0667 CardPayload shape) — spreads saved_card.card_data at top level (id, title, image, category, etc.) + lock-in extras (lockInEvent, scheduledAt, durationMinutes, lockerUserId) alongside so chat renderer + ExpandedCardModal render the same visual payload the user saw on the deck. Supersedes the nested card_data variant from 20260629000000.';

GRANT EXECUTE ON FUNCTION public.rpc_admin_lock_and_schedule_card(uuid, uuid, timestamptz, int) TO authenticated;

-- ============================================================================
-- 3. One-shot backfill: flatten existing card-message rows that were written
--    by the v1 (nested) combined RPC. Match by the discriminator
--    card_payload.event = 'card_locked_and_scheduled' AND the presence of a
--    nested card_data object. Spread card_data at the top level, preserve the
--    lock-in extras (renamed to the new keys), then drop the nested object +
--    the snake_case extras.
-- ============================================================================

UPDATE public.messages
   SET card_payload = jsonb_strip_nulls(
     COALESCE(card_payload->'card_data', '{}'::jsonb)
       || jsonb_build_object(
         'lockInEvent', 'card_locked_and_scheduled',
         'scheduledAt', card_payload->'scheduled_at',
         'durationMinutes', card_payload->'duration_minutes',
         'lockerUserId', card_payload->'locker_user_id',
         'savedCardId', card_payload->'saved_card_id',
         'sessionId', card_payload->'session_id',
         'selectedDateTime', card_payload->'scheduled_at'
       )
   )
 WHERE message_type = 'card'
   AND card_payload ? 'card_data'
   AND (card_payload->>'event' = 'card_locked_and_scheduled'
        OR card_payload ? 'scheduled_at');

NOTIFY pgrst, 'reload schema';
