-- Create beta_feedback table for beta tester feedback submissions
CREATE TABLE beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Category
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature_request', 'ux_issue', 'general')),

  -- Audio
  audio_path TEXT NOT NULL,          -- Storage path: beta-feedback/{userId}/{filename}
  audio_url TEXT,                     -- Signed URL (generated after upload)
  audio_duration_ms INTEGER NOT NULL, -- Duration in milliseconds

  -- User snapshot (denormalized for admin convenience)
  user_display_name TEXT,
  user_email TEXT,
  user_phone TEXT,

  -- Device & context metadata
  device_os TEXT NOT NULL,            -- 'ios' or 'android'
  device_os_version TEXT,             -- e.g. '17.4.1'
  device_model TEXT,                  -- e.g. 'iPhone 15 Pro'
  app_version TEXT NOT NULL,          -- e.g. '1.0.0'
  screen_before TEXT,                 -- Screen user was on before opening modal
  session_duration_ms INTEGER,        -- How long the app session has been active
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- Admin fields
  admin_notes TEXT,                   -- Admin can add notes
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned', 'dismissed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin queries
CREATE INDEX idx_beta_feedback_created ON beta_feedback(created_at DESC);
CREATE INDEX idx_beta_feedback_user ON beta_feedback(user_id);
CREATE INDEX idx_beta_feedback_status ON beta_feedback(status);

-- Auto-update updated_at
CREATE TRIGGER set_beta_feedback_updated_at
  BEFORE UPDATE ON beta_feedback
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
