-- ===========================================
-- COLLABORATION FEATURE MIGRATION - PART 6
-- Create presence, swipe states, and typing indicator tables
-- ===========================================

-- Drop tables if they exist (in case of previous failed migration)
DROP TABLE IF EXISTS public.board_typing_indicators CASCADE;
DROP TABLE IF EXISTS public.board_user_swipe_states CASCADE;
DROP TABLE IF EXISTS public.board_participant_presence CASCADE;

-- Board Participant Presence (online/offline status)
CREATE TABLE public.board_participant_presence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, user_id)
);

-- Board User Swipe States (individual swipe tracking per user)
CREATE TABLE public.board_user_swipe_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experience_id UUID REFERENCES public.experiences(id) ON DELETE SET NULL,
  saved_experience_id UUID REFERENCES public.saved_experiences(id) ON DELETE SET NULL,
  swipe_state TEXT NOT NULL CHECK (swipe_state IN ('not_seen', 'swiped_left', 'swiped_right')),
  swiped_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, user_id, experience_id, saved_experience_id)
);

-- Typing Indicators (temporary state for typing indicators)
CREATE TABLE public.board_typing_indicators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  saved_card_id UUID REFERENCES public.board_saved_cards(id) ON DELETE CASCADE, -- NULL for main chat
  is_typing BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, user_id, saved_card_id)
);

-- Create indexes for performance
CREATE INDEX idx_board_participant_presence_session_id 
  ON public.board_participant_presence(session_id);
CREATE INDEX idx_board_participant_presence_user_id 
  ON public.board_participant_presence(user_id);
CREATE INDEX idx_board_participant_presence_online 
  ON public.board_participant_presence(is_online) WHERE is_online = true;

CREATE INDEX idx_board_user_swipe_states_session_user 
  ON public.board_user_swipe_states(session_id, user_id);
CREATE INDEX idx_board_user_swipe_states_experience 
  ON public.board_user_swipe_states(experience_id) WHERE experience_id IS NOT NULL;
CREATE INDEX idx_board_user_swipe_states_saved_experience 
  ON public.board_user_swipe_states(saved_experience_id) WHERE saved_experience_id IS NOT NULL;

CREATE INDEX idx_board_typing_indicators_session 
  ON public.board_typing_indicators(session_id);
CREATE INDEX idx_board_typing_indicators_typing 
  ON public.board_typing_indicators(is_typing) WHERE is_typing = true;

-- Enable RLS
ALTER TABLE public.board_participant_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_user_swipe_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_typing_indicators ENABLE ROW LEVEL SECURITY;

-- RLS Policies for board_participant_presence
DROP POLICY IF EXISTS "Participants can view presence in their sessions" 
  ON public.board_participant_presence;
CREATE POLICY "Participants can view presence in their sessions" 
  ON public.board_participant_presence
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_participant_presence.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own presence" 
  ON public.board_participant_presence;
CREATE POLICY "Users can update their own presence" 
  ON public.board_participant_presence
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for board_user_swipe_states
DROP POLICY IF EXISTS "Users can view their own swipe states" 
  ON public.board_user_swipe_states;
CREATE POLICY "Users can view their own swipe states" 
  ON public.board_user_swipe_states
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own swipe states" 
  ON public.board_user_swipe_states;
CREATE POLICY "Users can manage their own swipe states" 
  ON public.board_user_swipe_states
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for board_typing_indicators
DROP POLICY IF EXISTS "Participants can view typing indicators" 
  ON public.board_typing_indicators;
CREATE POLICY "Participants can view typing indicators" 
  ON public.board_typing_indicators
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_typing_indicators.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own typing status" 
  ON public.board_typing_indicators;
CREATE POLICY "Users can update their own typing status" 
  ON public.board_typing_indicators
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Triggers to update updated_at
CREATE TRIGGER update_board_participant_presence_updated_at
  BEFORE UPDATE ON public.board_participant_presence
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_board_typing_indicators_updated_at
  BEFORE UPDATE ON public.board_typing_indicators
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-create presence entry when user joins session
CREATE OR REPLACE FUNCTION public.auto_create_presence()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.board_participant_presence (session_id, user_id, is_online, last_seen_at)
  VALUES (NEW.session_id, NEW.user_id, true, now())
  ON CONFLICT (session_id, user_id) 
  DO UPDATE SET is_online = true, last_seen_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to mark presence as offline when user leaves
CREATE OR REPLACE FUNCTION public.mark_presence_offline()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.board_participant_presence
  SET is_online = false, last_seen_at = now()
  WHERE session_id = OLD.session_id AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Triggers to automatically manage presence
CREATE TRIGGER auto_create_presence_on_join
  AFTER INSERT ON public.session_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_presence();

CREATE TRIGGER mark_offline_on_leave
  AFTER DELETE ON public.session_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_presence_offline();

