-- ORCH-0558 Step 5 — rpc_record_swipe_and_check_match RPC.
--
-- Atomic replacement for the legacy two-query client pattern
-- (trackSwipeState + checkForMatch) that caused ORCH-0558 RC-1 via
-- column-misalignment between the trigger's OR-filter and the client's
-- single-column .eq('experience_id', …).
--
-- After this RPC ships, collabSaveCard.ts calls this RPC once and gets
-- back a fully-shaped match result. No client-side board_saved_cards
-- query needed for match detection. Single server authority.
--
-- Depends on: board_user_swipe_states.card_data column (from ORCH-0556),
--             unique constraint + NOT NULL (migration 000002),
--             check_mutual_like v3 (migration 000003),
--             match_telemetry_events table (migration 000004).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.rpc_record_swipe_and_check_match(UUID, TEXT, UUID, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.rpc_record_swipe_and_check_match(
  p_session_id UUID,
  p_experience_id TEXT,
  p_user_id UUID,
  p_card_data JSONB,
  p_swipe_direction TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swipe_state TEXT;
  v_saved_card_id UUID;
  v_card_title TEXT;
  v_matched_user_ids UUID[];
  v_participant_count INTEGER;
BEGIN
  -- ------------------------------------------------------------------------
  -- Auth + participation validation
  -- ------------------------------------------------------------------------
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.session_participants
    WHERE session_id = p_session_id
      AND user_id = p_user_id
      AND has_accepted = true
  ) THEN
    RAISE EXCEPTION 'Not a session participant' USING ERRCODE = '42501';
  END IF;

  -- ------------------------------------------------------------------------
  -- Input validation
  -- ------------------------------------------------------------------------
  v_swipe_state := CASE p_swipe_direction
    WHEN 'right' THEN 'swiped_right'
    WHEN 'left'  THEN 'swiped_left'
    ELSE NULL
  END;

  IF v_swipe_state IS NULL THEN
    RAISE EXCEPTION 'Invalid swipe_direction: %', p_swipe_direction
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  IF p_experience_id IS NULL OR p_experience_id = '' THEN
    RAISE EXCEPTION 'experience_id is required' USING ERRCODE = '22023';
  END IF;

  -- ------------------------------------------------------------------------
  -- Upsert swipe_state (fires check_mutual_like v3 trigger)
  -- ------------------------------------------------------------------------
  INSERT INTO public.board_user_swipe_states (
    session_id, experience_id, user_id, swipe_state, swiped_at, card_data
  ) VALUES (
    p_session_id, p_experience_id, p_user_id, v_swipe_state, NOW(),
    CASE WHEN v_swipe_state = 'swiped_right' THEN p_card_data ELSE NULL END
  )
  ON CONFLICT (session_id, experience_id, user_id)
  DO UPDATE SET
    swipe_state = EXCLUDED.swipe_state,
    swiped_at = EXCLUDED.swiped_at,
    card_data = CASE
      WHEN EXCLUDED.swipe_state = 'swiped_right' THEN EXCLUDED.card_data
      ELSE public.board_user_swipe_states.card_data
    END;

  -- ------------------------------------------------------------------------
  -- Telemetry: record attempt
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_participant_count
  FROM public.session_participants
  WHERE session_id = p_session_id AND has_accepted = true;

  INSERT INTO public.match_telemetry_events (
    event_type, session_id, experience_id, user_id, reason, payload
  ) VALUES (
    'collab_match_attempt', p_session_id, p_experience_id, p_user_id,
    v_swipe_state,
    jsonb_build_object('participant_count', v_participant_count)
  );

  -- ------------------------------------------------------------------------
  -- Left-swipe short-circuit
  -- ------------------------------------------------------------------------
  IF v_swipe_state = 'swiped_left' THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'left_swipe'
    );
  END IF;

  -- ------------------------------------------------------------------------
  -- Check if trigger (which fired synchronously on the INSERT above)
  -- produced a saved_card row.
  -- ------------------------------------------------------------------------
  SELECT id, card_data->>'title'
    INTO v_saved_card_id, v_card_title
  FROM public.board_saved_cards
  WHERE session_id = p_session_id AND experience_id = p_experience_id
  LIMIT 1;

  IF v_saved_card_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'quorum_not_met'
    );
  END IF;

  -- ------------------------------------------------------------------------
  -- Match detected. Collect all right-swipers.
  -- ------------------------------------------------------------------------
  SELECT array_agg(DISTINCT user_id)
    INTO v_matched_user_ids
  FROM public.board_user_swipe_states
  WHERE session_id = p_session_id
    AND experience_id = p_experience_id
    AND swipe_state = 'swiped_right';

  RETURN jsonb_build_object(
    'matched', true,
    'saved_card_id', v_saved_card_id,
    'card_title', COALESCE(v_card_title, 'a spot'),
    'matched_user_ids', v_matched_user_ids,
    'reason', 'promoted'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_record_swipe_and_check_match(UUID, TEXT, UUID, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.rpc_record_swipe_and_check_match(UUID, TEXT, UUID, JSONB, TEXT) IS
  'ORCH-0558: Single atomic entry-point for collab right/left swipes. '
  'Upserts swipe_state (which fires check_mutual_like trigger under advisory lock), '
  'then returns match result in one server round-trip. '
  'Replaces the legacy trackSwipeState + checkForMatch two-query pattern '
  'that suffered from column-alignment bugs (see '
  'Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0558_BULLETPROOF_COLLAB_MATCH.md RC-1). '
  'Enforces I-CHECK-FOR-MATCH-COLUMN-ALIGNED.';
