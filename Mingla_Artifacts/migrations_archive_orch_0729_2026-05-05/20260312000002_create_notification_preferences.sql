-- Migration: 20260312000002_create_notification_preferences.sql
-- Description: Creates per-user notification preferences table. All fields default to
-- true (opt-in by default). The service already references this table; this migration
-- makes the data layer exist.

CREATE TABLE public.notification_preferences (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  email_enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  friend_requests       BOOLEAN     NOT NULL DEFAULT TRUE,
  link_requests         BOOLEAN     NOT NULL DEFAULT TRUE,
  messages              BOOLEAN     NOT NULL DEFAULT TRUE,
  collaboration_invites BOOLEAN     NOT NULL DEFAULT TRUE,
  marketing             BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_preferences_user_id
  ON public.notification_preferences(user_id);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own preferences"
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own preferences"
  ON public.notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences"
  ON public.notification_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own preferences"
  ON public.notification_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger: auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_notification_preferences_updated_at();
