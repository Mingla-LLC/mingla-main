-- ===========================================
-- CREATE user_push_tokens TABLE + ENABLE REALTIME ON messages
-- Fixes: push notifications broken (table missing) + messages not instant (no realtime publication)
-- ===========================================

-- 1. Create user_push_tokens table
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  push_token TEXT NOT NULL,
  platform VARCHAR(10) NOT NULL DEFAULT 'ios' CHECK (platform IN ('ios', 'android', 'web')),
  device_id TEXT DEFAULT 'unknown',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, push_token)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON public.user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_updated_at ON public.user_push_tokens(updated_at DESC);

-- Enable RLS
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can view their own push tokens"
  ON public.user_push_tokens
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can insert their own push tokens"
  ON public.user_push_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can update their own push tokens"
  ON public.user_push_tokens
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their own push tokens" ON public.user_push_tokens;
CREATE POLICY "Users can delete their own push tokens"
  ON public.user_push_tokens
  FOR DELETE
  USING (user_id = auth.uid());

-- Trigger to update updated_at
CREATE TRIGGER update_user_push_tokens_updated_at
  BEFORE UPDATE ON public.user_push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Add messages table to Supabase Realtime publication
-- This is required for postgres_changes subscriptions to receive INSERT/UPDATE/DELETE events
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
