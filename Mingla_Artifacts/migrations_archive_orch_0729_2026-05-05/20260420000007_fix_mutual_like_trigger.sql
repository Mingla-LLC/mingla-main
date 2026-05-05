-- ORCH-0556: check_mutual_like trigger references dropped session_decks table.
--
-- Migration 20260417000003_drop_session_decks.sql dropped public.session_decks
-- (deck cache moved to client-side React Query per ORCH-0446) but the trigger
-- check_mutual_like (created in 20260411500001_mutual_like_trigger.sql) was
-- never updated to match. Result: dormant P0 regression surfaced by ORCH-0532
-- fix — every 2nd right-swipe on the same card in a session now fails with
-- `42P01 "relation public.session_decks does not exist"`, so quorum-based
-- match promotion is 100% broken.
--
-- Fix: (a) add card_data JSONB column to board_user_swipe_states so clients
-- can persist the card payload on swiped_right; (b) rewrite check_mutual_like
-- to read the payload from that column instead of the dropped deck table.
-- Fallback stub preserved for edge cases (legacy rows with no card_data).
--
-- Deploy order: `supabase db push` applies this migration. Mobile OTA within
-- the same window so clients start writing card_data. Pre-fix mobile clients
-- that don't write card_data will fall through to the 2-key stub — matches
-- will still promote, just with minimal Cards tab display (graceful degrade,
-- not a crash).

-- ==========================================================================
-- Step 1: Add card_data JSONB column to board_user_swipe_states
-- ==========================================================================

ALTER TABLE public.board_user_swipe_states
  ADD COLUMN IF NOT EXISTS card_data JSONB;

COMMENT ON COLUMN public.board_user_swipe_states.card_data IS
  'ORCH-0556: Card JSONB payload captured at swipe time. Read by the '
  'check_mutual_like trigger to populate board_saved_cards.card_data when '
  'quorum is reached. Nullable for historical rows + left-swipe rows '
  '(which never promote to saved_cards).';

-- ==========================================================================
-- Step 2: Replace check_mutual_like body — swap session_decks SELECT
-- for board_user_swipe_states.card_data SELECT.
-- ==========================================================================

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
  v_swiper RECORD;
BEGIN
  -- Only process right swipes
  IF NEW.swipe_state != 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Check if card is already saved to this session (by experience_id match
  -- in card_data OR direct experience_id column).
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

  -- ORCH-0556: Retrieve card_data from swipe-state rows
  -- (session_decks was dropped by 20260417000003). Take ANY non-null
  -- card_data for this (session, experience) pair — all right-swipers
  -- see the same card, so any swiper's payload is correct.
  SELECT card_data INTO v_card_json
  FROM public.board_user_swipe_states
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
    AND card_data IS NOT NULL
  ORDER BY swiped_at DESC
  LIMIT 1;

  -- Fallback stub for edge cases (e.g., legacy pre-0556 swipes with no
  -- card_data, or clients running stale code that doesn't write the column).
  -- Match still promotes; Cards tab display degrades to id + placeholder title.
  IF v_card_json IS NULL THEN
    v_card_json := jsonb_build_object(
      'id', NEW.experience_id,
      'title', 'Matched experience'
    );
  END IF;

  -- Double-check no concurrent insert happened between our earlier check
  -- and now. Same pattern as prior trigger (unique constraint on board_saved_cards
  -- includes saved_experience_id which can be NULL, so ON CONFLICT is unreliable).
  SELECT id INTO v_existing_saved_card_id
  FROM public.board_saved_cards
  WHERE session_id = NEW.session_id
    AND (
      experience_id = NEW.experience_id
      OR (card_data->>'id')::TEXT = NEW.experience_id::TEXT
    )
  LIMIT 1;

  IF v_existing_saved_card_id IS NOT NULL THEN
    -- Concurrent insert beat us — just add this swiper's vote
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_existing_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Promote to saved_cards. bsc_insert_trigger_or_service_only RLS policy
  -- (migration 20260420000006) permits this because SECURITY DEFINER
  -- runs under CURRENT_USER = 'postgres'.
  INSERT INTO public.board_saved_cards (
    session_id, experience_id, card_data, saved_by
  ) VALUES (
    NEW.session_id,
    NEW.experience_id,
    v_card_json,
    NEW.user_id
  )
  RETURNING id INTO v_new_saved_card_id;

  -- Create vote entries for ALL right-swipers (so the "Liked by..." label
  -- shows everyone who right-swiped before quorum was reached).
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

-- Trigger definition is unchanged — still AFTER INSERT OR UPDATE on
-- board_user_swipe_states. CREATE OR REPLACE FUNCTION above replaces the
-- body in place; no DROP/CREATE TRIGGER needed.

-- ==========================================================================
-- Rollback (if needed):
-- ==========================================================================
-- To revert the trigger body, re-apply the original function definition
-- from 20260411500001_mutual_like_trigger.sql. The card_data column can
-- remain (unused, nullable) without issue, OR drop it with:
--   ALTER TABLE public.board_user_swipe_states DROP COLUMN IF EXISTS card_data;
-- Note: reverting the trigger without un-dropping session_decks will
-- immediately re-break match promotion. Do not revert in isolation.
