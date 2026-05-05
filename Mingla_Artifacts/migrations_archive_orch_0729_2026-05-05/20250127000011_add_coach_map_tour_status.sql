-- Add coach_map_tour_status column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS coach_map_tour_status TEXT CHECK (coach_map_tour_status IN ('completed', 'skipped')) DEFAULT NULL;

-- Create index for coach_map_tour_status for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_coach_map_tour_status ON public.profiles(coach_map_tour_status) 
WHERE coach_map_tour_status IS NOT NULL;

