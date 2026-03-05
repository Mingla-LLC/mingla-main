-- Fix date_option check constraint to allow correct values
-- The constraint should allow: "Now", "brunch", "afternoon", "dinner", "lateNight"

-- Drop existing constraint if it exists
ALTER TABLE public.preferences 
DROP CONSTRAINT IF EXISTS preferences_date_option_check;

-- Add the correct constraint that allows:
-- - "Now" (when user selects "Now")
-- - Time slot values: "brunch", "afternoon", "dinner", "lateNight" (when user selects a time slot)
ALTER TABLE public.preferences
ADD CONSTRAINT preferences_date_option_check 
CHECK (
  date_option IS NULL 
  OR date_option = 'Now' 
  OR date_option = 'brunch' 
  OR date_option = 'afternoon' 
  OR date_option = 'dinner' 
  OR date_option = 'lateNight'
);


