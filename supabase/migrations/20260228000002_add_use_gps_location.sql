-- Add use_gps_location flag to preferences table
ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS use_gps_location BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.preferences.use_gps_location IS
  'true = always use device GPS; false = use custom_location field';
