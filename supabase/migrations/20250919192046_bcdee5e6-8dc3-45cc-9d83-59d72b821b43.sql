-- Add custom location field to preferences table
ALTER TABLE public.preferences 
ADD COLUMN custom_location TEXT,
ADD COLUMN custom_lat DOUBLE PRECISION,
ADD COLUMN custom_lng DOUBLE PRECISION;