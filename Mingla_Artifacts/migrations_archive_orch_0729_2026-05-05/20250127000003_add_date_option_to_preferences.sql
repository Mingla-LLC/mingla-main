-- Add date_option column to preferences table
-- This stores the user's date preference: "Now", "Today", "This Weekend", or "Pick a Date"
ALTER TABLE public.preferences 
ADD COLUMN IF NOT EXISTS date_option TEXT;

-- Create index for date_option for better query performance
CREATE INDEX IF NOT EXISTS idx_preferences_date_option ON public.preferences(date_option)
WHERE date_option IS NOT NULL;

-- Add comment to explain the column
COMMENT ON COLUMN public.preferences.date_option IS 'User date preference: "Now", "Today", "This Weekend", or "Pick a Date"';


