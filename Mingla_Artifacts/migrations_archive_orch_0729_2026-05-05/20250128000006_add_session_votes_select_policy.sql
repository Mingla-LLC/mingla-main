-- ===========================================
-- Update RLS policy for SELECT on board_votes to support session-based votes
-- ===========================================

-- Update SELECT policy to handle both board-based and session-based votes
-- Only create if session_id column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes' 
    AND column_name = 'session_id'
  ) THEN
    -- Drop the old policy that only checked board_id
    DROP POLICY IF EXISTS "Users can view votes in boards they have access to" 
      ON public.board_votes;
    
    -- Create new combined SELECT policy that handles both cases
    EXECUTE 'CREATE POLICY "Users can view votes in boards and sessions they have access to" 
      ON public.board_votes
      FOR SELECT USING (
        -- For session-based votes (session_id is NOT NULL, board_id is NULL)
        (
          session_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.session_participants sp
            WHERE sp.session_id = board_votes.session_id
            AND sp.user_id = auth.uid()
          )
        )
        OR
        -- For board-based votes (board_id is NOT NULL, session_id is NULL)
        (
          board_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.boards b
            WHERE b.id = board_votes.board_id
            AND (b.created_by = auth.uid() OR b.is_public = true)
          )
        )
      )';
  END IF;
END $$;

