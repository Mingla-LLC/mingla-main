-- Migration: fix_board_vote_trigger_and_realtime
-- Description: Fixes three critical voting issues:
--   1. handle_board_vote trigger unconditionally inserts into activity_history,
--      causing RLS violations for session-based votes (board_id IS NULL).
--      Fix: Re-apply SECURITY DEFINER + NULL guard.
--   2. board_votes, board_saved_cards, board_card_rsvps are not in the
--      supabase_realtime publication, so postgres_changes events never fire.
--      Fix: Add them to the publication.

-- ═══════════════════════════════════════════════════════════
-- 1. Fix handle_board_vote trigger — SECURITY DEFINER + guard
-- ═══════════════════════════════════════════════════════════

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS handle_board_vote_trigger ON public.board_votes;
CREATE TRIGGER handle_board_vote_trigger
  AFTER INSERT OR UPDATE ON public.board_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_board_vote();


-- ═══════════════════════════════════════════════════════════
-- 2. Add voting/RSVP tables to supabase_realtime publication
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_votes;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_votes already in supabase_realtime';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_saved_cards;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_saved_cards already in supabase_realtime';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.board_card_rsvps;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'board_card_rsvps already in supabase_realtime';
END $$;
