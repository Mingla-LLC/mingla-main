-- ============================================================================
-- Admin Dashboard Overhaul — Migration 1 of 3
-- Creates: admin_audit_log, email_templates, column additions, security RPCs
-- ============================================================================

-- ─── 1. Audit Log Table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON admin_audit_log (admin_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON admin_audit_log (action);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit log"
  ON admin_audit_log FOR SELECT
  USING (is_admin_user());

CREATE POLICY "Admins can insert audit log"
  ON admin_audit_log FOR INSERT
  WITH CHECK (is_admin_user());

-- ─── 2. Email Templates Table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  placeholders TEXT[] DEFAULT ARRAY['name'],
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage templates"
  ON email_templates FOR ALL
  USING (is_admin_user());

-- Unique constraint for idempotent seeding
ALTER TABLE email_templates ADD CONSTRAINT email_templates_name_unique UNIQUE (name);

-- Seed default templates (idempotent)
INSERT INTO email_templates (name, subject, body, placeholders) VALUES
  ('Welcome', 'Welcome to Mingla, {name}!', E'Hi {name},\n\nWelcome to Mingla! We''re thrilled to have you on board.\n\nMingla helps you discover amazing experiences around you — from hidden gems to popular spots, all tailored to your preferences.\n\nGet started by setting your preferences and swiping through your first batch of cards.\n\nHappy exploring!\nThe Mingla Team', ARRAY['name']),
  ('Feature Announcement', 'Something New on Mingla', E'Hi {name},\n\nWe''ve been working on something exciting and it''s finally here.\n\n[Describe the feature here]\n\nOpen the app to try it out!\n\nCheers,\nThe Mingla Team', ARRAY['name']),
  ('Scheduled Maintenance', 'Scheduled Maintenance Notice', E'Hi {name},\n\nWe''ll be performing scheduled maintenance on [DATE] from [TIME] to [TIME] (UTC).\n\nDuring this time, the app may be temporarily unavailable. We''ll be back up and running as quickly as possible.\n\nThank you for your patience.\nThe Mingla Team', ARRAY['name']),
  ('We Miss You', 'We miss you, {name}!', E'Hi {name},\n\nWe noticed you haven''t opened Mingla in a while. No pressure — but we''ve added a lot of new places and experiences since your last visit.\n\nCome back and see what''s new. Your next great experience might be one swipe away.\n\nSee you soon,\nThe Mingla Team', ARRAY['name'])
ON CONFLICT (name) DO NOTHING;

-- ─── 3. Column Additions ───────────────────────────────────────────────────

ALTER TABLE user_reports ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium'
  CHECK (severity IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE place_reviews ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'pending'
  CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'flagged'));

-- ─── 4. Narrow admin_users Anon SELECT ─────────────────────────────────────

-- Drop the overly permissive anon read policy
DROP POLICY IF EXISTS "Allow anon read" ON admin_users;
DROP POLICY IF EXISTS "allow_anon_read" ON admin_users;

-- Create a SECURITY DEFINER function that only exposes email + status
CREATE OR REPLACE FUNCTION get_admin_emails()
RETURNS TABLE(email TEXT, status TEXT) AS $$
  SELECT email, status FROM admin_users
  WHERE status IN ('active', 'invited');
$$ LANGUAGE sql SECURITY DEFINER;

-- Allow anon to call this function (needed for pre-auth login check)
GRANT EXECUTE ON FUNCTION get_admin_emails() TO anon;
GRANT EXECUTE ON FUNCTION get_admin_emails() TO authenticated;

-- Authenticated admins can still read the full table
CREATE POLICY "Admins can read admin_users"
  ON admin_users FOR SELECT
  USING (is_admin_user());

-- ─── 5. Secure Seed Script RPCs ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_seed_demo_profiles()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO profiles (id, email, display_name, username, first_name, last_name,
    has_completed_onboarding, active, created_at)
  VALUES
    (gen_random_uuid(), 'demo1@mingla.app', 'Alex Demo', 'alexdemo', 'Alex', 'Demo', true, true, now()),
    (gen_random_uuid(), 'demo2@mingla.app', 'Jamie Test', 'jamietest', 'Jamie', 'Test', true, true, now()),
    (gen_random_uuid(), 'demo3@mingla.app', 'Sam Dev', 'samdev', 'Sam', 'Dev', false, true, now()),
    (gen_random_uuid(), 'demo4@mingla.app', 'Taylor QA', 'taylorqa', 'Taylor', 'QA', true, true, now()),
    (gen_random_uuid(), 'demo5@mingla.app', 'Jordan Seed', 'jordanseed', 'Jordan', 'Seed', false, true, now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_clear_expired_caches()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM google_places_cache WHERE expires_at < now();
  DELETE FROM ticketmaster_events_cache WHERE expires_at < now();
  DELETE FROM discover_daily_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_reset_inactive_sessions()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE collaboration_sessions SET is_active = false
  WHERE last_activity_at < now() - interval '7 days' AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_clear_demo_data()
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM profiles WHERE email LIKE '%@mingla.app';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- admin_exec_sql intentionally NOT created.
-- Arbitrary SQL execution via SECURITY DEFINER is a database takeover vector.
-- All admin operations use specific, auditable named RPCs instead.
