-- ============================================
-- User Blocking System
-- ============================================
-- This migration creates a comprehensive blocking system that:
-- 1. Allows any user to block any other user (not just friends)
-- 2. Enforces blocking server-side via RLS policies
-- 3. Auto-removes friendships when blocked
-- 4. Hides blocked users from search, messages, and friends lists
-- ============================================

-- Create blocked_users table
CREATE TABLE IF NOT EXISTS public.blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT,  -- Optional: for internal tracking/support (harassment, spam, other)
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(blocker_id, blocked_id),
  CONSTRAINT no_self_block CHECK (blocker_id != blocked_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);

-- Enable RLS
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies for blocked_users table
-- ============================================

-- Users can view their own blocks (who they've blocked)
CREATE POLICY "Users can view their own blocks" ON blocked_users
  FOR SELECT USING (auth.uid() = blocker_id);

-- Users can create blocks
CREATE POLICY "Users can create blocks" ON blocked_users
  FOR INSERT WITH CHECK (auth.uid() = blocker_id);

-- Users can remove their own blocks (unblock)
CREATE POLICY "Users can remove their own blocks" ON blocked_users
  FOR DELETE USING (auth.uid() = blocker_id);

-- ============================================
-- Helper Functions for Block Checking
-- ============================================

-- Check if user A has blocked user B (directional)
CREATE OR REPLACE FUNCTION public.is_blocked_by(blocker UUID, target UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE blocker_id = blocker AND blocked_id = target
  );
$$;

-- Check if either user has blocked the other (bidirectional check)
CREATE OR REPLACE FUNCTION public.has_block_between(user1 UUID, user2 UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = user1 AND blocked_id = user2)
       OR (blocker_id = user2 AND blocked_id = user1)
  );
$$;

-- ============================================
-- Trigger: Auto-remove friendship on block
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_user_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Remove friendship in both directions when blocked
  DELETE FROM friends
  WHERE (user_id = NEW.blocker_id AND friend_user_id = NEW.blocked_id)
     OR (user_id = NEW.blocked_id AND friend_user_id = NEW.blocker_id);
  
  RETURN NEW;
END;
$$;

-- Drop trigger if exists to avoid errors on re-run
DROP TRIGGER IF EXISTS on_user_blocked ON blocked_users;

CREATE TRIGGER on_user_blocked
  AFTER INSERT ON blocked_users
  FOR EACH ROW
  EXECUTE FUNCTION handle_user_blocked();

-- ============================================
-- Update Profiles RLS: Hide from blocked users' search
-- ============================================

-- Drop existing select policy if it exists
DROP POLICY IF EXISTS "Users cannot view profiles of users who blocked them" ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Anyone can read profiles" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Profiles are publicly readable" ON profiles;

-- Create new policy that hides blocker profiles from blocked users
CREATE POLICY "Profiles viewable except by blocked users" ON profiles
  FOR SELECT USING (
    auth.uid() = id  -- Can always see own profile
    OR NOT public.is_blocked_by(id, auth.uid())  -- Profile owner hasn't blocked viewer
  );

-- ============================================
-- Update Messages RLS: Allow viewing all messages, block sending to blocked users
-- ============================================

-- Drop existing message policies
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
DROP POLICY IF EXISTS "Users can view messages excluding blocked" ON messages;
DROP POLICY IF EXISTS "Users can send messages to their conversations" ON messages;
DROP POLICY IF EXISTS "Users cannot send messages to blocked users" ON messages;

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

-- Users can update their own messages
DROP POLICY IF EXISTS "Users can update their own messages" ON messages;
CREATE POLICY "Users can update their own messages" ON messages
  FOR UPDATE USING (auth.uid() = sender_id);

-- Users can delete (soft) their own messages
DROP POLICY IF EXISTS "Users can delete their own messages" ON messages;
CREATE POLICY "Users can delete their own messages" ON messages
  FOR DELETE USING (auth.uid() = sender_id);

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

-- ============================================
-- Migration: Move existing blocks from friends table
-- ============================================

-- Migrate any existing blocks from friends table (if status='blocked' exists)
INSERT INTO blocked_users (blocker_id, blocked_id, created_at)
SELECT user_id, friend_user_id, COALESCE(updated_at, created_at, now())
FROM friends
WHERE status = 'blocked'
ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

-- Clean up old blocked entries from friends table
DELETE FROM friends WHERE status = 'blocked';

-- ============================================
-- Grant necessary permissions
-- ============================================

GRANT SELECT, INSERT, DELETE ON blocked_users TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_by(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_block_between(UUID, UUID) TO authenticated;
