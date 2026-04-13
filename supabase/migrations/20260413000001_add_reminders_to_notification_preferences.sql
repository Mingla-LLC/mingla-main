-- ORCH-0407: Add missing reminders preference column.
-- notify-dispatch references prefs.reminders but the column didn't exist.
-- Reminders (calendar, birthday, holiday) worked by accident:
-- prefs.reminders was undefined, and (undefined === false) is false,
-- so the "skip notification" check never triggered.
-- Now explicit: DEFAULT TRUE preserves existing behavior (reminders send).
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS reminders BOOLEAN NOT NULL DEFAULT TRUE;
