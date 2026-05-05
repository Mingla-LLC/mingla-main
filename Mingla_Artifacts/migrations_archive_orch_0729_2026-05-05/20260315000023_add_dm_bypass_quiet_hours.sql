-- Add dm_bypass_quiet_hours toggle to notification_preferences
-- When ON, direct messages from friends bypass quiet hours (10 PM - 8 AM)
-- Default: OFF (all notifications respect quiet hours)
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS dm_bypass_quiet_hours BOOLEAN NOT NULL DEFAULT FALSE;
