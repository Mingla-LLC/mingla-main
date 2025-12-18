-- ===========================================
-- Add RLS policy for DELETE on session-based votes
-- ===========================================

-- Add DELETE policy for session-based votes
-- Only create if session_id column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_votes' 
    AND column_name = 'session_id'
  ) THEN
    -- Drop existing DELETE policy if it exists (for board-based votes)
    DROP POLICY IF EXISTS "Users can delete their own votes" 
      ON public.board_votes;
    
    -- Create new combined DELETE policy that handles both cases
    EXECUTE 'CREATE POLICY "Users can delete their own votes" 
      ON public.board_votes
      FOR DELETE USING (
        -- Users can delete their own votes
        auth.uid() = user_id
        AND (
          -- For session-based votes (session_id is NOT NULL)
          (
            session_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.session_participants sp
              WHERE sp.session_id = board_votes.session_id
              AND sp.user_id = auth.uid()
            )
          )
          OR
          -- For board-based votes (board_id is NOT NULL)
          (
            board_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.boards b
              WHERE b.id = board_votes.board_id
              AND (b.created_by = auth.uid() OR b.is_public = true)
            )
          )
        )
      )';
  END IF;
END $$;

