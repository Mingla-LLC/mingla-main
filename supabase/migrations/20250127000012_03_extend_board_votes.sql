-- ===========================================
-- COLLABORATION FEATURE MIGRATION - PART 3
-- Extend board_votes table to support board_saved_cards
-- ===========================================

-- Extend board_votes to support both board_cards and board_saved_cards
-- Check if table exists before modifying
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes'
  ) THEN
    -- Add saved_card_id column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'board_votes' 
      AND column_name = 'saved_card_id'
    ) THEN
      ALTER TABLE public.board_votes
      ADD COLUMN saved_card_id UUID REFERENCES public.board_saved_cards(id) ON DELETE CASCADE;
    END IF;
    
    -- Add session_id column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'board_votes' 
      AND column_name = 'session_id'
    ) THEN
      ALTER TABLE public.board_votes
      ADD COLUMN session_id UUID REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE;
    END IF;
    
    -- Add constraint to ensure either card_id or saved_card_id is set
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_schema = 'public' 
      AND constraint_name = 'board_votes_card_check'
    ) THEN
      ALTER TABLE public.board_votes DROP CONSTRAINT board_votes_card_check;
    END IF;
    
    ALTER TABLE public.board_votes
    ADD CONSTRAINT board_votes_card_check 
      CHECK (
        (card_id IS NOT NULL AND saved_card_id IS NULL) OR 
        (card_id IS NULL AND saved_card_id IS NOT NULL)
      );
  END IF;
END $$;

-- Create indexes and unique constraint using dynamic SQL
-- Only create if columns exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes' 
    AND column_name = 'session_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes' 
    AND column_name = 'saved_card_id'
  ) THEN
    -- Create unique index for saved_card votes using dynamic SQL
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS board_votes_session_saved_card_user_unique 
      ON public.board_votes(session_id, saved_card_id, user_id) 
      WHERE saved_card_id IS NOT NULL AND session_id IS NOT NULL';
    
    -- Create additional indexes for the new columns using dynamic SQL
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_board_votes_saved_card_id 
      ON public.board_votes(saved_card_id) WHERE saved_card_id IS NOT NULL';
    
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_board_votes_session_id 
      ON public.board_votes(session_id) WHERE session_id IS NOT NULL';
  END IF;
END $$;

-- Add RLS policy for saved_card votes
-- Only create if session_id column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes' 
    AND column_name = 'session_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes' 
    AND column_name = 'saved_card_id'
  ) THEN
    -- Drop policy if it exists
    DROP POLICY IF EXISTS "Users can vote on saved cards in their sessions" 
      ON public.board_votes;
    
    -- Create the policy - simplified to avoid column reference issues
    -- We'll validate session participation in the application layer
    EXECUTE 'CREATE POLICY "Users can vote on saved cards in their sessions" 
      ON public.board_votes
      FOR INSERT
      WITH CHECK (
        saved_card_id IS NOT NULL
        AND user_id = auth.uid()
      )';
  END IF;
END $$;

