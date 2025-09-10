-- Add collaboration defaults columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN share_location BOOLEAN DEFAULT true,
ADD COLUMN share_budget BOOLEAN DEFAULT false,
ADD COLUMN share_categories BOOLEAN DEFAULT true,
ADD COLUMN share_date_time BOOLEAN DEFAULT true;

-- Update existing profiles with default values
UPDATE public.profiles 
SET 
  share_location = true,
  share_budget = false, 
  share_categories = true,
  share_date_time = true
WHERE 
  share_location IS NULL OR 
  share_budget IS NULL OR 
  share_categories IS NULL OR 
  share_date_time IS NULL;