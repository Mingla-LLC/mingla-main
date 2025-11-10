-- Remove CHECK constraint on date_option column to allow any text value
-- This allows flexibility in storing date options without restriction

-- Drop the existing constraint if it exists
ALTER TABLE public.preferences 
DROP CONSTRAINT IF EXISTS preferences_date_option_check;

-- Update the comment to reflect that any text value is now accepted
COMMENT ON COLUMN public.preferences.date_option IS 'User date preference: accepts any text value (e.g., "now", "today", "weekend", "custom")';

