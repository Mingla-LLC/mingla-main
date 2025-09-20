-- Create table for saved experiences/cards
CREATE TABLE public.saved_experiences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Card data
  card_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  category TEXT NOT NULL,
  price_level INTEGER DEFAULT 1,
  estimated_cost_per_person DECIMAL(10,2),
  start_time TIMESTAMPTZ,
  duration_minutes INTEGER,
  image_url TEXT,
  address TEXT,
  
  -- Location data
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  
  -- Route/travel data
  route_mode TEXT,
  eta_minutes INTEGER,
  distance_text TEXT,
  maps_deep_link TEXT,
  
  -- Source data
  source_provider TEXT,
  place_id TEXT,
  event_id TEXT,
  
  -- Copy data
  one_liner TEXT,
  tip TEXT,
  
  -- Rating data
  rating DECIMAL(3,2),
  review_count INTEGER,
  
  -- Status and scheduling
  status TEXT DEFAULT 'saved' CHECK (status IN ('saved', 'accepted')),
  scheduled_date DATE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.saved_experiences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own saved experiences"
  ON public.saved_experiences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own saved experiences"
  ON public.saved_experiences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved experiences"
  ON public.saved_experiences
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved experiences"
  ON public.saved_experiences
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_saved_experiences_updated_at
  BEFORE UPDATE ON public.saved_experiences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for performance
CREATE INDEX idx_saved_experiences_user_id ON public.saved_experiences(user_id);
CREATE INDEX idx_saved_experiences_status ON public.saved_experiences(user_id, status);