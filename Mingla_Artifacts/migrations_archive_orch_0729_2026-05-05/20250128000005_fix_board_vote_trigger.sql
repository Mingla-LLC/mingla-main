-- ===========================================
-- Fix board_vote trigger to handle session-based votes
-- ===========================================

-- Update handle_board_vote function to only log activity for board-based votes
-- (skip activity_history for session-based votes since they don't have board_id)
CREATE OR REPLACE FUNCTION public.handle_board_vote()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log activity for board-based votes (where board_id is NOT NULL)
  -- Skip activity_history for session-based votes (where session_id is NOT NULL but board_id is NULL)
  IF NEW.board_id IS NOT NULL AND NEW.card_id IS NOT NULL THEN
    INSERT INTO public.activity_history (board_id, card_id, user_id, action_type, action_data)
    VALUES (NEW.board_id, NEW.card_id, NEW.user_id, 'vote', jsonb_build_object('vote_type', NEW.vote_type));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

