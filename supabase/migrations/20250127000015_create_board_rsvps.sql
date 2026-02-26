-- ===========================================
-- COLLABORATION FEATURE MIGRATION - PART 4
-- Create board_card_rsvps table for attendance tracking
-- ===========================================

-- Drop table if it exists (in case of previous failed migration)
DROP TABLE IF EXISTS public.board_card_rsvps CASCADE;

-- Board Card RSVPs (attendance tracking)
CREATE TABLE public.board_card_rsvps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  saved_card_id UUID NOT NULL REFERENCES public.board_saved_cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rsvp_status TEXT NOT NULL CHECK (rsvp_status IN ('attending', 'not_attending')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, saved_card_id, user_id)
);

-- Create indexes for performance (after table is created)
-- Check that columns exist before creating indexes
DO $$
BEGIN
  -- Check if session_id column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_card_rsvps' 
    AND column_name = 'session_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_board_card_rsvps_session_id 
      ON public.board_card_rsvps(session_id)';
  END IF;
  
  -- Check if saved_card_id column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_card_rsvps' 
    AND column_name = 'saved_card_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_board_card_rsvps_saved_card_id 
      ON public.board_card_rsvps(saved_card_id)';
  END IF;
  
  -- Check if user_id column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_card_rsvps' 
    AND column_name = 'user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_board_card_rsvps_user_id 
      ON public.board_card_rsvps(user_id)';
  END IF;
  
  -- Check if rsvp_status column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_card_rsvps' 
    AND column_name = 'rsvp_status'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_board_card_rsvps_status 
      ON public.board_card_rsvps(rsvp_status)';
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.board_card_rsvps ENABLE ROW LEVEL SECURITY;

-- RLS Policies for board_card_rsvps
-- Use dynamic SQL to avoid parse-time column validation
DO $$
BEGIN
  -- Check if table and column exist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'board_card_rsvps' 
    AND column_name = 'session_id'
  ) THEN
    DROP POLICY IF EXISTS "Participants can view RSVPs in their sessions" 
      ON public.board_card_rsvps;
    
    -- Use format to properly escape the table name
    EXECUTE format('CREATE POLICY %I ON public.board_card_rsvps FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.session_participants sp
        WHERE sp.session_id = public.board_card_rsvps.session_id
        AND sp.user_id = auth.uid()
      )
    )', 'Participants can view RSVPs in their sessions');
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can manage their own RSVPs" 
  ON public.board_card_rsvps;
CREATE POLICY "Users can manage their own RSVPs" 
  ON public.board_card_rsvps
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger to update updated_at
CREATE TRIGGER update_board_card_rsvps_updated_at
  BEFORE UPDATE ON public.board_card_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to update session activity when RSVP is created/updated
CREATE TRIGGER update_session_activity_on_rsvp
  AFTER INSERT OR UPDATE ON public.board_card_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_session_last_activity();

