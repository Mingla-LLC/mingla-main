-- Add exact_time column to preferences table
-- This stores the user-selected exact time (e.g., "3:30 PM") separate from time_slot presets
ALTER TABLE public.preferences
ADD COLUMN IF NOT EXISTS exact_time TEXT DEFAULT NULL;

-- Create index for exact_time for better query performance
CREATE INDEX IF NOT EXISTS idx_preferences_exact_time ON public.preferences(exact_time)
WHERE exact_time IS NOT NULL;

-- Add comment to clarify purpose
COMMENT ON COLUMN public.preferences.exact_time IS 'User-selected exact time in format "HH:MM AM/PM" (e.g., "3:30 PM")';
