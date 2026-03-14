-- Migration: robust_board_votes_nullable_fix
-- Description: Idempotent fix — ensures board_id and card_id are truly nullable
-- in board_votes. Previous migration 20260313100009 may have been recorded as applied
-- but silently rolled back if the CHECK constraint addition failed on existing data.
-- This migration re-applies the DROP NOT NULL unconditionally and safely re-adds
-- the mutual-exclusion CHECK constraint.

-- Step 1: Drop NOT NULL on board_id (idempotent — no-op if already nullable)
ALTER TABLE public.board_votes
  ALTER COLUMN board_id DROP NOT NULL;

-- Step 2: Drop NOT NULL on card_id (idempotent — no-op if already nullable)
ALTER TABLE public.board_votes
  ALTER COLUMN card_id DROP NOT NULL;

-- Step 3: Safely re-add the mutual-exclusion CHECK constraint
-- First drop if it exists (from previous migration), then re-create
DO $$
BEGIN
  -- Drop existing constraint if present
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
    AND constraint_name = 'board_votes_board_session_check'
  ) THEN
    ALTER TABLE public.board_votes
      DROP CONSTRAINT board_votes_board_session_check;
  END IF;

  -- Re-create with proper logic
  ALTER TABLE public.board_votes
    ADD CONSTRAINT board_votes_board_session_check
      CHECK (
        (board_id IS NOT NULL AND session_id IS NULL) OR
        (board_id IS NULL AND session_id IS NOT NULL)
      );
END $$;
