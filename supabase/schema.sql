-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extend existing)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text,
  display_name text,
  username text,
  first_name text,
  last_name text,
  currency text DEFAULT 'USD',
  measurement_system text DEFAULT 'metric',
  share_location boolean DEFAULT true,
  share_budget boolean DEFAULT false,
  share_categories boolean DEFAULT true,
  share_date_time boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Preferences table
CREATE TABLE IF NOT EXISTS public.preferences (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode text DEFAULT 'explore',
  budget_min integer DEFAULT 0,
  budget_max integer DEFAULT 1000,
  people_count integer DEFAULT 1,
  categories text[] DEFAULT ARRAY['Stroll', 'Sip & Chill'],
  travel_mode text DEFAULT 'walking',
  travel_constraint_type text DEFAULT 'time',
  travel_constraint_value integer DEFAULT 30,
  datetime_pref timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Experiences table
CREATE TABLE IF NOT EXISTS public.experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  place_id text UNIQUE,
  lat double precision,
  lng double precision,
  price_min integer DEFAULT 0,
  price_max integer DEFAULT 0,
  duration_min integer DEFAULT 60,
  image_url text,
  opening_hours jsonb,
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Saves table
CREATE TABLE IF NOT EXISTS public.saves (
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  experience_id uuid REFERENCES public.experiences(id) ON DELETE CASCADE,
  status text DEFAULT 'liked',
  scheduled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (profile_id, experience_id)
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saves ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for preferences
CREATE POLICY "Users can read own preferences" ON public.preferences
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own preferences" ON public.preferences
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own preferences" ON public.preferences
  FOR UPDATE USING (auth.uid() = profile_id);

-- RLS Policies for experiences (public read, authenticated write)
CREATE POLICY "Anyone can read experiences" ON public.experiences
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert experiences" ON public.experiences
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update experiences" ON public.experiences
  FOR UPDATE USING (auth.role() = 'authenticated');

-- RLS Policies for saves
CREATE POLICY "Users can read own saves" ON public.saves
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own saves" ON public.saves
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own saves" ON public.saves
  FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete own saves" ON public.saves
  FOR DELETE USING (auth.uid() = profile_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_experiences_category ON public.experiences(category);
CREATE INDEX IF NOT EXISTS idx_experiences_place_id ON public.experiences(place_id);
CREATE INDEX IF NOT EXISTS idx_experiences_location ON public.experiences(lat, lng);
CREATE INDEX IF NOT EXISTS idx_saves_profile_id ON public.saves(profile_id);
CREATE INDEX IF NOT EXISTS idx_saves_experience_id ON public.saves(experience_id);

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_preferences_updated_at
  BEFORE UPDATE ON public.preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_experiences_updated_at
  BEFORE UPDATE ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();