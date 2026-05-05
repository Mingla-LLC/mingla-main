-- ===========================================
-- Fix board_vote trigger to properly handle session-based votes
-- This fixes the RLS error when voting on collaboration session cards
-- ===========================================

-- Update handle_board_vote function to only log activity for board-based votes
-- Session-based votes (collaboration boards) don't have a board_id, so we skip activity_history
CREATE OR REPLACE FUNCTION public.handle_board_vote()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log activity for board-based votes (where board_id IS NOT NULL)
  -- Skip activity_history for session-based votes (where session_id is NOT NULL but board_id is NULL)
  -- This prevents RLS policy violations since activity_history requires a valid board_id
  IF NEW.board_id IS NOT NULL AND NEW.card_id IS NOT NULL THEN
    INSERT INTO public.activity_history (board_id, card_id, user_id, action_type, action_data)
    VALUES (NEW.board_id, NEW.card_id, NEW.user_id, 'vote', jsonb_build_object('vote_type', NEW.vote_type));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure the trigger exists and is using the updated function
DROP TRIGGER IF EXISTS handle_board_vote_trigger ON public.board_votes;
CREATE TRIGGER handle_board_vote_trigger
  AFTER INSERT OR UPDATE ON public.board_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_board_vote();
