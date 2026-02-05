-- ============================================
-- User Muting System
-- ============================================
-- This migration creates a muting system that:
-- 1. Allows users to mute friends to stop receiving messages/notifications
-- 2. Does NOT remove friendships (unlike blocking)
-- 3. Muted users can still see each other but notifications are suppressed
-- ============================================

-- Create muted_users table
CREATE TABLE IF NOT EXISTS public.muted_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(muter_id, muted_id),
  CONSTRAINT no_self_mute CHECK (muter_id != muted_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_muted_users_muter ON muted_users(muter_id);
CREATE INDEX IF NOT EXISTS idx_muted_users_muted ON muted_users(muted_id);

-- Enable RLS
ALTER TABLE muted_users ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies for muted_users table
-- ============================================

-- Users can view their own mutes (who they've muted)
CREATE POLICY "Users can view their own mutes" ON muted_users
  FOR SELECT USING (auth.uid() = muter_id);

-- Users can create mutes
CREATE POLICY "Users can create mutes" ON muted_users
  FOR INSERT WITH CHECK (auth.uid() = muter_id);

-- Users can remove their own mutes (unmute)
CREATE POLICY "Users can remove their own mutes" ON muted_users
  FOR DELETE USING (auth.uid() = muter_id);

-- ============================================
-- Helper Functions for Mute Checking
-- ============================================

-- Check if user A has muted user B (directional)
CREATE OR REPLACE FUNCTION public.is_muted_by(muter UUID, target UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM muted_users
    WHERE muter_id = muter AND muted_id = target
  );
$$;

-- Get all muted user IDs for a user
CREATE OR REPLACE FUNCTION public.get_muted_user_ids(user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT muted_id FROM muted_users WHERE muter_id = user_id;
$$;
