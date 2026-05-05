-- ORCH-0395: Mutual-like consensus trigger
-- When 2+ participants in a collab session swipe right on the same card,
-- auto-insert into board_saved_cards and create vote entries for each swiper.
-- Pattern: same as check_card_lock_in (SECURITY DEFINER, AFTER INSERT OR UPDATE).

CREATE OR REPLACE FUNCTION public.check_mutual_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_right_swipe_count INTEGER;
  v_existing_saved_card_id UUID;
  v_new_saved_card_id UUID;
  v_card_json JSONB;
  v_deck_cards JSONB;
  v_swiper RECORD;
BEGIN
  -- Only process right swipes
  IF NEW.swipe_state != 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Check if card is already saved to this session (by experience_id match in card_data)
  SELECT id INTO v_existing_saved_card_id
  FROM public.board_saved_cards
  WHERE session_id = NEW.session_id
    AND (
      experience_id = NEW.experience_id
      OR (card_data->>'id')::TEXT = NEW.experience_id::TEXT
    )
  LIMIT 1;

  -- If card already saved, just ensure this swiper has a vote
  IF v_existing_saved_card_id IS NOT NULL THEN
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_existing_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Count right-swipes for this experience in this session
  SELECT COUNT(*) INTO v_right_swipe_count
  FROM public.board_user_swipe_states
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
    AND swipe_state = 'swiped_right';

  -- Threshold: 2+ right-swipes = match
  IF v_right_swipe_count < 2 THEN
    RETURN NEW;
  END IF;

  -- Retrieve card_data from the latest session deck
  SELECT cards INTO v_deck_cards
  FROM public.session_decks
  WHERE session_id = NEW.session_id
  ORDER BY generated_at DESC
  LIMIT 1;

  -- Find the card in the deck JSONB array by id
  IF v_deck_cards IS NOT NULL THEN
    SELECT elem INTO v_card_json
    FROM jsonb_array_elements(v_deck_cards) AS elem
    WHERE elem->>'id' = NEW.experience_id::TEXT
    LIMIT 1;
  END IF;

  -- Fallback stub if card not found in deck (expired/regenerated)
  IF v_card_json IS NULL THEN
    v_card_json := jsonb_build_object(
      'id', NEW.experience_id,
      'title', 'Matched experience'
    );
  END IF;

  -- INSERT into board_saved_cards
  -- Use SELECT-then-INSERT pattern because the unique constraint includes
  -- saved_experience_id which can be NULL (SQL NULL != NULL breaks ON CONFLICT).
  -- Double-check no concurrent insert happened between our earlier check and now.
  SELECT id INTO v_existing_saved_card_id
  FROM public.board_saved_cards
  WHERE session_id = NEW.session_id
    AND (
      experience_id = NEW.experience_id
      OR (card_data->>'id')::TEXT = NEW.experience_id::TEXT
    )
  LIMIT 1;

  IF v_existing_saved_card_id IS NOT NULL THEN
    -- Concurrent insert beat us — just add the vote
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_existing_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;
    RETURN NEW;
  END IF;

  INSERT INTO public.board_saved_cards (
    session_id, experience_id, card_data, saved_by
  ) VALUES (
    NEW.session_id,
    NEW.experience_id,
    v_card_json,
    NEW.user_id
  )
  RETURNING id INTO v_new_saved_card_id;

  -- Create vote entries for ALL right-swipers
  IF v_new_saved_card_id IS NOT NULL THEN
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
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger fires after every swipe state insert or update
DROP TRIGGER IF EXISTS check_mutual_like_trigger ON public.board_user_swipe_states;
CREATE TRIGGER check_mutual_like_trigger
  AFTER INSERT OR UPDATE ON public.board_user_swipe_states
  FOR EACH ROW
  EXECUTE FUNCTION public.check_mutual_like();
