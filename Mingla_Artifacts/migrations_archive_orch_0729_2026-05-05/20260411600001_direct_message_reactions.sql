-- Direct message reactions table (mirrors board_message_reactions)
CREATE TABLE IF NOT EXISTS public.direct_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

-- Index for fast lookups by message
CREATE INDEX IF NOT EXISTS idx_direct_message_reactions_message_id
  ON public.direct_message_reactions(message_id);

-- RLS
ALTER TABLE public.direct_message_reactions ENABLE ROW LEVEL SECURITY;

-- Users can read reactions on messages in conversations they participate in
CREATE POLICY "Users can read reactions on their conversations"
  ON public.direct_message_reactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages dm
      JOIN public.conversation_participants cp ON cp.conversation_id = dm.conversation_id
      WHERE dm.id = direct_message_reactions.message_id
        AND cp.user_id = auth.uid()
    )
  );

-- Users can insert their own reactions
CREATE POLICY "Users can add their own reactions"
  ON public.direct_message_reactions
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own reactions
CREATE POLICY "Users can remove their own reactions"
  ON public.direct_message_reactions
  FOR DELETE
  USING (user_id = auth.uid());
