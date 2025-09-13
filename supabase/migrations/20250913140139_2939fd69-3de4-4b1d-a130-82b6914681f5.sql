-- Fix RLS policies for experiences table to be read-only for clients
DROP POLICY IF EXISTS "Authenticated users can insert experiences" ON public.experiences;
DROP POLICY IF EXISTS "Authenticated users can update experiences" ON public.experiences;

-- Experiences should be read-only for all users
CREATE POLICY "Anyone can read experiences" ON public.experiences
FOR SELECT USING (true);

-- Only service role can modify experiences (for data management)
CREATE POLICY "Only service role can insert experiences" ON public.experiences
FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Only service role can update experiences" ON public.experiences
FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY "Only service role can delete experiences" ON public.experiences
FOR DELETE USING (auth.role() = 'service_role');

-- Add missing calendar_events table for completeness
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  experience_id uuid REFERENCES public.experiences(id),
  scheduled_at timestamp with time zone NOT NULL,
  status text DEFAULT 'scheduled',
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on calendar_events
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for calendar_events - users can only manage their own events
CREATE POLICY "Users can read own calendar events" ON public.calendar_events
FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own calendar events" ON public.calendar_events
FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own calendar events" ON public.calendar_events
FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete own calendar events" ON public.calendar_events
FOR DELETE USING (auth.uid() = profile_id);

-- Add trigger for calendar_events updated_at
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_experiences_category_slug ON public.experiences(category_slug);
CREATE INDEX IF NOT EXISTS idx_experiences_lat_lng ON public.experiences(lat, lng);
CREATE INDEX IF NOT EXISTS idx_saves_profile_experience ON public.saves(profile_id, experience_id);
CREATE INDEX IF NOT EXISTS idx_preferences_profile ON public.preferences(profile_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_profile ON public.calendar_events(profile_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_scheduled ON public.calendar_events(scheduled_at);