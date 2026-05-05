-- Migration: fix_board_votes_nullable_columns
-- Description: Drop NOT NULL constraints on board_id and card_id in board_votes
-- to allow session-based voting (which uses session_id + saved_card_id instead).
-- The existing CHECK constraint board_votes_card_check already enforces that
-- exactly one of (card_id, saved_card_id) must be set.

-- Make board_id nullable (session votes don't have a board)
ALTER TABLE public.board_votes
  ALTER COLUMN board_id DROP NOT NULL;

-- Make card_id nullable (session votes use saved_card_id instead)
ALTER TABLE public.board_votes
  ALTER COLUMN card_id DROP NOT NULL;

-- Add a symmetric CHECK for board_id/session_id mutual exclusion
-- (mirrors the existing card_id/saved_card_id check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
    AND constraint_name = 'board_votes_board_session_check'
  ) THEN
    ALTER TABLE public.board_votes
    ADD CONSTRAINT board_votes_board_session_check
      CHECK (
        (board_id IS NOT NULL AND session_id IS NULL) OR
        (board_id IS NULL AND session_id IS NOT NULL)
      );
  END IF;
END $$;
