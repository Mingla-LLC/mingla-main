-- ===========================================
-- COLLABORATION FEATURE MIGRATION - PART 2
-- Create board_session_preferences and board_saved_cards tables
-- ===========================================

-- Board Session Preferences (session-level preferences for card generation)
CREATE TABLE IF NOT EXISTS public.board_session_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  budget_min INTEGER DEFAULT 0,
  budget_max INTEGER DEFAULT 1000,
  categories TEXT[] DEFAULT ARRAY[]::TEXT[],
  time_of_day TEXT,
  datetime_pref TIMESTAMPTZ,
  location TEXT,
  custom_lat DOUBLE PRECISION,
  custom_lng DOUBLE PRECISION,
  travel_mode TEXT DEFAULT 'walking',
  travel_constraint_type TEXT DEFAULT 'time',
  travel_constraint_value INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id)
);

-- Board Saved Cards (cards saved to a board - shared view)
-- Note: This extends the concept of board_cards but with additional metadata
CREATE TABLE IF NOT EXISTS public.board_saved_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  experience_id UUID REFERENCES public.experiences(id) ON DELETE SET NULL,
  saved_experience_id UUID REFERENCES public.saved_experiences(id) ON DELETE SET NULL,
  card_data JSONB NOT NULL, -- Full card data snapshot
  saved_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, experience_id, saved_experience_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_board_session_preferences_session_id 
  ON public.board_session_preferences(session_id);

CREATE INDEX IF NOT EXISTS idx_board_saved_cards_session_id 
  ON public.board_saved_cards(session_id);
CREATE INDEX IF NOT EXISTS idx_board_saved_cards_saved_by 
  ON public.board_saved_cards(saved_by);
CREATE INDEX IF NOT EXISTS idx_board_saved_cards_saved_at 
  ON public.board_saved_cards(saved_at DESC);

-- Enable RLS
ALTER TABLE public.board_session_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_saved_cards ENABLE ROW LEVEL SECURITY;

-- RLS Policies for board_session_preferences
DROP POLICY IF EXISTS "Users can view session preferences for their sessions" 
  ON public.board_session_preferences;
CREATE POLICY "Users can view session preferences for their sessions" 
  ON public.board_session_preferences
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_session_preferences.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can update session preferences" 
  ON public.board_session_preferences;
CREATE POLICY "Admins can update session preferences" 
  ON public.board_session_preferences
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_sessions cs
      WHERE cs.id = board_session_preferences.session_id
      AND cs.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can insert session preferences" 
  ON public.board_session_preferences;
CREATE POLICY "Admins can insert session preferences" 
  ON public.board_session_preferences
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.collaboration_sessions cs
      WHERE cs.id = board_session_preferences.session_id
      AND cs.created_by = auth.uid()
    )
  );

-- RLS Policies for board_saved_cards
DROP POLICY IF EXISTS "Participants can view saved cards in their sessions" 
  ON public.board_saved_cards;
CREATE POLICY "Participants can view saved cards in their sessions" 
  ON public.board_saved_cards
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_saved_cards.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Participants can add cards to their sessions" 
  ON public.board_saved_cards;
CREATE POLICY "Participants can add cards to their sessions" 
  ON public.board_saved_cards
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_saved_cards.session_id
      AND sp.user_id = auth.uid()
    )
    AND saved_by = auth.uid()
  );

-- Trigger to update updated_at for board_session_preferences
CREATE TRIGGER update_board_session_preferences_updated_at
  BEFORE UPDATE ON public.board_session_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to update last_activity_at on collaboration_sessions
CREATE OR REPLACE FUNCTION public.update_session_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.collaboration_sessions
  SET last_activity_at = now()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_activity_at on collaboration_sessions when card is saved
CREATE TRIGGER update_session_activity_on_saved_card
  AFTER INSERT ON public.board_saved_cards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_session_last_activity();

