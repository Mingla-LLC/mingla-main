-- Migration: 20260312200001_chat_presence_and_typing.sql
-- Description: Adds DM/group conversation presence tracking table.
-- Typing indicators use broadcast only (no DB storage) — same pattern as board typing.

-- Conversation presence — tracks who is online in which conversation
CREATE TABLE public.conversation_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

-- Index for fast lookup by conversation
CREATE INDEX idx_conversation_presence_conv_id ON public.conversation_presence(conversation_id);
-- Index for fast lookup by user (to mark all conversations offline on disconnect)
CREATE INDEX idx_conversation_presence_user_id ON public.conversation_presence(user_id);

-- RLS
ALTER TABLE public.conversation_presence ENABLE ROW LEVEL SECURITY;

-- Users can read presence for conversations they participate in
CREATE POLICY "Participants can read conversation presence"
  ON public.conversation_presence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_presence.conversation_id
      AND cp.user_id = auth.uid()
    )
  );

-- Users can upsert their own presence
CREATE POLICY "Users can upsert own presence"
  ON public.conversation_presence FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own presence"
  ON public.conversation_presence FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add to realtime publication for postgres_changes subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_presence;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_conversation_presence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_presence_timestamp
  BEFORE UPDATE ON public.conversation_presence
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_presence_timestamp();

-- Scheduled cleanup: mark stale presence as offline
-- Any user who hasn't heartbeated in 60 seconds is offline.
-- This runs via pg_cron or can be called manually.
CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS void AS $$
BEGIN
  UPDATE public.conversation_presence
  SET is_online = false
  WHERE is_online = true
    AND updated_at < NOW() - INTERVAL '60 seconds';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
