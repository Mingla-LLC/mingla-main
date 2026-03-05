-- ============================================
-- User Reports System
-- ============================================
-- This migration creates a reporting system that:
-- 1. Allows users to report other users for violations
-- 2. Stores report reasons and optional details
-- 3. Tracks report status for moderation review
-- ============================================

-- Create enum for report reasons
CREATE TYPE report_reason AS ENUM (
  'spam',
  'inappropriate-content',
  'harassment',
  'other'
);

-- Create enum for report status
CREATE TYPE report_status AS ENUM (
  'pending',
  'reviewed',
  'resolved',
  'dismissed'
);

-- Create user_reports table
CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason report_reason NOT NULL,
  details TEXT,
  status report_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  resolution_notes TEXT,
  
  -- Prevent duplicate reports for the same user pair within a time window
  CONSTRAINT no_self_report CHECK (reporter_id != reported_user_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON user_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports(status);
CREATE INDEX IF NOT EXISTS idx_user_reports_created ON user_reports(created_at DESC);

-- Enable RLS
ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies for user_reports table
-- ============================================

-- Users can create reports
CREATE POLICY "Users can create reports" ON user_reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

-- Users can view their own submitted reports
CREATE POLICY "Users can view their own reports" ON user_reports
  FOR SELECT USING (auth.uid() = reporter_id);

-- Admins/moderators can view all reports (you may need to adjust this based on your admin system)
-- CREATE POLICY "Admins can view all reports" ON user_reports
--   FOR SELECT USING (
--     EXISTS (
--       SELECT 1 FROM profiles 
--       WHERE profiles.id = auth.uid() 
--       AND profiles.role IN ('admin', 'moderator')
--     )
--   );

-- ============================================
-- Function to update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_user_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_reports_updated_at
  BEFORE UPDATE ON user_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_user_reports_updated_at();

-- ============================================
-- Helper function to check if user has been reported recently
-- (to prevent spam reports)
-- ============================================
CREATE OR REPLACE FUNCTION public.has_recent_report(reporter UUID, reported UUID, hours_window INTEGER DEFAULT 24)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_reports
    WHERE reporter_id = reporter 
    AND reported_user_id = reported
    AND created_at > now() - (hours_window || ' hours')::interval
  );
$$;
