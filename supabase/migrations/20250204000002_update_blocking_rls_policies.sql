-- ============================================
-- Update Blocking RLS Policies
-- ============================================
-- This migration updates RLS policies so that:
-- 1. Users can still view conversations with blocked users
-- 2. Users can still view previous messages with blocked users
-- 3. Users CANNOT send new messages when a block exists
-- ============================================

-- ============================================
-- Update Messages RLS: Allow viewing all messages, block sending to blocked users
-- ============================================

-- Drop existing message policies
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Users can view messages excluding blocked" ON messages;
DROP POLICY IF EXISTS "Users can send messages to their conversations" ON messages;
DROP POLICY IF EXISTS "Users cannot send messages to blocked users" ON messages;
DROP POLICY IF EXISTS "Users can view messages in conversations" ON messages;
DROP POLICY IF EXISTS "Users can send messages checking blocks" ON messages;

-- Users can view ALL messages in their conversations (including from blocked users)
-- This allows viewing conversation history even after blocking
CREATE POLICY "Users can view messages in conversations" ON messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
    )
  );

-- Users can send messages, but NOT to conversations where blocking exists
CREATE POLICY "Users can send messages checking blocks" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
    )
    AND NOT EXISTS (
      -- Check if any participant in the conversation has a block relationship with sender
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id != auth.uid()
      AND public.has_block_between(auth.uid(), cp.user_id)
    )
  );

-- ============================================
-- Update Conversations RLS: Allow viewing all conversations (including with blocked users)
-- ============================================

DROP POLICY IF EXISTS "Users can view their conversations" ON conversations;
DROP POLICY IF EXISTS "Users can view conversations excluding blocked DMs" ON conversations;

-- Users can view ALL their conversations, including with blocked users
-- This allows them to see previous conversation history
CREATE POLICY "Users can view their conversations" ON conversations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversations.id
      AND cp.user_id = auth.uid()
    )
  );
