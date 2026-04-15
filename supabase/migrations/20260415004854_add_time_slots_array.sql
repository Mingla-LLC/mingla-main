-- ORCH-0432: Add time_slots array column to support multi-select
-- Keep time_slot (TEXT) for backward compatibility — read from time_slots first,
-- fall back to time_slot for users who haven't re-saved.

ALTER TABLE public.preferences
ADD COLUMN IF NOT EXISTS time_slots TEXT[] DEFAULT NULL;

ALTER TABLE public.board_session_preferences
ADD COLUMN IF NOT EXISTS time_slots TEXT[] DEFAULT NULL;

COMMENT ON COLUMN public.preferences.time_slots
IS 'Selected time slots array: ["brunch","afternoon","dinner","lateNight"]. Supersedes time_slot (single TEXT). NULL = no preference.';

COMMENT ON COLUMN public.board_session_preferences.time_slots
IS 'Selected time slots array for collab sessions. Supersedes time_slot (single TEXT).';
