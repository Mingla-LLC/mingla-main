-- ===========================================
-- COLLABORATION FEATURE MIGRATION - PART 5
-- Create messaging tables for board discussions
-- ===========================================

-- Drop tables if they exist (in case of previous failed migration)
DROP TABLE IF EXISTS public.board_card_message_reads CASCADE;
DROP TABLE IF EXISTS public.board_message_reads CASCADE;
DROP TABLE IF EXISTS public.board_card_messages CASCADE;
DROP TABLE IF EXISTS public.board_messages CASCADE;

-- Board Messages (main board discussion/chat)
CREATE TABLE public.board_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::JSONB, -- Array of mentioned user IDs
  reply_to_id UUID REFERENCES public.board_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Board Card Messages (card-specific discussions)
CREATE TABLE public.board_card_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  saved_card_id UUID NOT NULL REFERENCES public.board_saved_cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::JSONB,
  reply_to_id UUID REFERENCES public.board_card_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Message Read Receipts
CREATE TABLE public.board_message_reads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.board_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, user_id)
);

CREATE TABLE public.board_card_message_reads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.board_card_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, user_id)
);

-- Create indexes for performance
CREATE INDEX idx_board_messages_session_id 
  ON public.board_messages(session_id);
CREATE INDEX idx_board_messages_user_id 
  ON public.board_messages(user_id);
CREATE INDEX idx_board_messages_created_at 
  ON public.board_messages(created_at DESC);
CREATE INDEX idx_board_messages_reply_to 
  ON public.board_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

CREATE INDEX idx_board_card_messages_session_id 
  ON public.board_card_messages(session_id);
CREATE INDEX idx_board_card_messages_saved_card_id 
  ON public.board_card_messages(saved_card_id);
CREATE INDEX idx_board_card_messages_user_id 
  ON public.board_card_messages(user_id);
CREATE INDEX idx_board_card_messages_created_at 
  ON public.board_card_messages(created_at DESC);

CREATE INDEX idx_board_message_reads_message_id 
  ON public.board_message_reads(message_id);
CREATE INDEX idx_board_message_reads_user_id 
  ON public.board_message_reads(user_id);
CREATE INDEX idx_board_card_message_reads_message_id 
  ON public.board_card_message_reads(message_id);
CREATE INDEX idx_board_card_message_reads_user_id 
  ON public.board_card_message_reads(user_id);

-- Enable RLS
ALTER TABLE public.board_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_card_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_card_message_reads ENABLE ROW LEVEL SECURITY;

-- RLS Policies for board_messages
DROP POLICY IF EXISTS "Participants can view messages in their sessions" 
  ON public.board_messages;
CREATE POLICY "Participants can view messages in their sessions" 
  ON public.board_messages
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_messages.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Participants can send messages" 
  ON public.board_messages;
CREATE POLICY "Participants can send messages" 
  ON public.board_messages
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_messages.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own messages" 
  ON public.board_messages;
CREATE POLICY "Users can update their own messages" 
  ON public.board_messages
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for board_card_messages
DROP POLICY IF EXISTS "Participants can view card messages in their sessions" 
  ON public.board_card_messages;
CREATE POLICY "Participants can view card messages in their sessions" 
  ON public.board_card_messages
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_card_messages.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Participants can send card messages" 
  ON public.board_card_messages;
CREATE POLICY "Participants can send card messages" 
  ON public.board_card_messages
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_card_messages.session_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own card messages" 
  ON public.board_card_messages;
CREATE POLICY "Users can update their own card messages" 
  ON public.board_card_messages
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for message read receipts
DROP POLICY IF EXISTS "Users can view read receipts for messages" 
  ON public.board_message_reads;
CREATE POLICY "Users can view read receipts for messages" 
  ON public.board_message_reads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.board_messages bm
      JOIN public.session_participants sp ON sp.session_id = bm.session_id
      WHERE bm.id = board_message_reads.message_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can mark messages as read" 
  ON public.board_message_reads;
CREATE POLICY "Users can mark messages as read" 
  ON public.board_message_reads
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view read receipts for card messages" 
  ON public.board_card_message_reads;
CREATE POLICY "Users can view read receipts for card messages" 
  ON public.board_card_message_reads
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.board_card_messages bcm
      JOIN public.session_participants sp ON sp.session_id = bcm.session_id
      WHERE bcm.id = board_card_message_reads.message_id
      AND sp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can mark card messages as read" 
  ON public.board_card_message_reads;
CREATE POLICY "Users can mark card messages as read" 
  ON public.board_card_message_reads
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Triggers to update updated_at
CREATE TRIGGER update_board_messages_updated_at
  BEFORE UPDATE ON public.board_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_board_card_messages_updated_at
  BEFORE UPDATE ON public.board_card_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Triggers to update session activity when messages are sent
CREATE TRIGGER update_session_activity_on_message
  AFTER INSERT ON public.board_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_session_last_activity();

CREATE TRIGGER update_session_activity_on_card_message
  AFTER INSERT ON public.board_card_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_session_last_activity();

