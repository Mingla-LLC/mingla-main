-- ORCH-0408 Phase 3: Unified card interaction RPC.
-- Handles all 4 types: swipe_left, swipe_right, expand, schedule.
-- Replaces record_card_swipe as the primary RPC.
-- record_card_swipe becomes a backward-compat wrapper.

CREATE OR REPLACE FUNCTION public.record_card_interaction(
  p_card_id TEXT,
  p_interaction_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_interaction_type NOT IN ('swipe_left', 'swipe_right', 'expand', 'schedule') THEN
    RAISE EXCEPTION 'Invalid interaction type: %', p_interaction_type;
  END IF;

  IF p_interaction_type = 'swipe_right' THEN
    UPDATE public.card_pool SET save_count = save_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  ELSIF p_interaction_type = 'swipe_left' THEN
    UPDATE public.card_pool SET skip_count = skip_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  ELSIF p_interaction_type = 'expand' THEN
    UPDATE public.card_pool SET expand_count = expand_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  ELSIF p_interaction_type = 'schedule' THEN
    UPDATE public.card_pool SET visit_count = visit_count + 1
    WHERE google_place_id = p_card_id OR id::TEXT = p_card_id;
  END IF;
END;
$$;

-- Backward-compat wrapper: Phase 2 clients still call record_card_swipe
-- during the OTA rollout gap. Maps left/right to swipe_left/swipe_right.
CREATE OR REPLACE FUNCTION public.record_card_swipe(
  p_card_id TEXT,
  p_direction TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_direction = 'left' THEN
    PERFORM public.record_card_interaction(p_card_id, 'swipe_left');
  ELSIF p_direction = 'right' THEN
    PERFORM public.record_card_interaction(p_card_id, 'swipe_right');
  ELSE
    RAISE EXCEPTION 'Invalid direction: %', p_direction;
  END IF;
END;
$$;
