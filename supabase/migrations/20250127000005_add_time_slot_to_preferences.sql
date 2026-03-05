-- Add time_slot column to preferences table
-- This stores the selected time slot: "brunch", "afternoon", "dinner", "lateNight"
ALTER TABLE public.preferences 
ADD COLUMN IF NOT EXISTS time_slot TEXT DEFAULT NULL;

-- Create index for time_slot for better query performance
CREATE INDEX IF NOT EXISTS idx_preferences_time_slot ON public.preferences(time_slot)
WHERE time_slot IS NOT NULL;

-- Add comment to explain the column
COMMENT ON COLUMN public.preferences.time_slot IS 'Selected time slot: "brunch", "afternoon", "dinner", "lateNight"';


