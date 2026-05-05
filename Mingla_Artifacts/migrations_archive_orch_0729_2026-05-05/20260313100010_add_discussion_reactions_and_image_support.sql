-- Migration: add_discussion_reactions_and_image_support
-- Description: Add image_url to board_messages for photo attachments,
-- create board_message_reactions for emoji reactions.

-- 1. Add image_url column to board_messages
ALTER TABLE public.board_messages
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Create emoji reactions table
CREATE TABLE public.board_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.board_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL, -- One of: ❤️ 😂 👍 😮 😢 🔥
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji) -- One reaction type per user per message
);

-- Index for fast lookup by message
CREATE INDEX idx_board_message_reactions_message_id
  ON public.board_message_reactions(message_id);

-- Index for fast lookup by user (for toggle logic)
CREATE INDEX idx_board_message_reactions_user_id
  ON public.board_message_reactions(user_id);

-- RLS
ALTER TABLE public.board_message_reactions ENABLE ROW LEVEL SECURITY;

-- Policy: Participants can view reactions on messages in their sessions
CREATE POLICY "Participants can view reactions"
  ON public.board_message_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.board_messages bm
      JOIN public.session_participants sp ON sp.session_id = bm.session_id
      WHERE bm.id = board_message_reactions.message_id
      AND sp.user_id = auth.uid()
    )
  );

-- Policy: Participants can add reactions to messages in their sessions
CREATE POLICY "Participants can add reactions"
  ON public.board_message_reactions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.board_messages bm
      JOIN public.session_participants sp ON sp.session_id = bm.session_id
      WHERE bm.id = board_message_reactions.message_id
      AND sp.user_id = auth.uid()
    )
  );

-- Policy: Users can remove their own reactions
CREATE POLICY "Users can remove their own reactions"
  ON public.board_message_reactions FOR DELETE
  USING (user_id = auth.uid());
