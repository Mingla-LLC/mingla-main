-- Store the device calendar event ID so reschedule/unschedule can
-- directly update/delete by ID instead of fragile title+date search.
ALTER TABLE public.calendar_entries
  ADD COLUMN IF NOT EXISTS device_calendar_event_id TEXT;

COMMENT ON COLUMN public.calendar_entries.device_calendar_event_id IS
  'expo-calendar event ID from Calendar.createEventAsync(). Used for direct update/delete.';
