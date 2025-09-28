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

-- User interactions table for tracking all user behavior
CREATE TABLE IF NOT EXISTS public.user_interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL, -- Can be place_id, event_id, or generated card_id
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'view', 'like', 'dislike', 'save', 'unsave', 'share', 'schedule', 
    'unschedule', 'click_details', 'swipe_left', 'swipe_right', 'tap'
  )),
  interaction_data JSONB DEFAULT '{}', -- Additional context data
  location_context JSONB DEFAULT '{}', -- User's location when interacting
  session_id UUID, -- Group related interactions in a session
  recommendation_context JSONB DEFAULT '{}', -- Context when recommendation was shown
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Location history table for tracking user movement patterns
CREATE TABLE IF NOT EXISTS public.user_location_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  altitude DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  location_type TEXT DEFAULT 'current' CHECK (location_type IN (
    'current', 'home', 'work', 'frequent', 'visited_place'
  )),
  place_context JSONB DEFAULT '{}', -- Additional place information
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User preference learning table for storing learned preferences
CREATE TABLE IF NOT EXISTS public.user_preference_learning (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_type TEXT NOT NULL, -- 'category', 'time', 'location', 'price', 'activity'
  preference_key TEXT NOT NULL, -- The specific preference (e.g., 'restaurant', 'morning', 'downtown')
  preference_value DOUBLE PRECISION NOT NULL, -- Affinity score (-1 to 1)
  confidence DOUBLE PRECISION DEFAULT 0.5, -- How confident we are in this preference
  interaction_count INTEGER DEFAULT 1, -- Number of interactions supporting this preference
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, preference_type, preference_key)
);

-- User session tracking for grouping related interactions
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type TEXT DEFAULT 'recommendation' CHECK (session_type IN (
    'recommendation', 'exploration', 'planning', 'social'
  )),
  session_context JSONB DEFAULT '{}', -- Initial context when session started
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  interaction_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS on all tables
ALTER TABLE public.user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preference_learning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_interactions
CREATE POLICY "Users can view their own interactions" ON public.user_interactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own interactions" ON public.user_interactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own interactions" ON public.user_interactions
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for user_location_history
CREATE POLICY "Users can view their own location history" ON public.user_location_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own location history" ON public.user_location_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_preference_learning
CREATE POLICY "Users can view their own preferences" ON public.user_preference_learning
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own preferences" ON public.user_preference_learning
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own preferences" ON public.user_preference_learning
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for user_sessions
CREATE POLICY "Users can view their own sessions" ON public.user_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sessions" ON public.user_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions" ON public.user_sessions
  FOR UPDATE USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX idx_user_interactions_user_id ON public.user_interactions(user_id);
CREATE INDEX idx_user_interactions_type ON public.user_interactions(interaction_type);
CREATE INDEX idx_user_interactions_created_at ON public.user_interactions(created_at);
CREATE INDEX idx_user_interactions_session_id ON public.user_interactions(session_id);

CREATE INDEX idx_user_location_history_user_id ON public.user_location_history(user_id);
CREATE INDEX idx_user_location_history_created_at ON public.user_location_history(created_at);
CREATE INDEX idx_user_location_history_type ON public.user_location_history(location_type);

CREATE INDEX idx_user_preference_learning_user_id ON public.user_preference_learning(user_id);
CREATE INDEX idx_user_preference_learning_type ON public.user_preference_learning(preference_type);
CREATE INDEX idx_user_preference_learning_value ON public.user_preference_learning(preference_value);

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_active ON public.user_sessions(is_active);

-- Ensure the update_updated_at_column function exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_user_interactions_updated_at
  BEFORE UPDATE ON public.user_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_preference_learning_updated_at
  BEFORE UPDATE ON public.user_preference_learning
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to automatically update user preference learning
CREATE OR REPLACE FUNCTION update_user_preferences_from_interaction()
RETURNS TRIGGER AS $$
DECLARE
  category_pref TEXT;
  time_pref TEXT;
  location_pref TEXT;
  price_pref TEXT;
BEGIN
  -- Extract preferences based on interaction type and data
  IF NEW.interaction_type IN ('like', 'save', 'schedule') THEN
    -- Positive interaction - increase preference scores
    
    -- Category preference
    IF NEW.interaction_data ? 'category' THEN
      category_pref := NEW.interaction_data->>'category';
      INSERT INTO public.user_preference_learning (user_id, preference_type, preference_key, preference_value, confidence, interaction_count)
      VALUES (NEW.user_id, 'category', category_pref, 0.1, 0.1, 1)
      ON CONFLICT (user_id, preference_type, preference_key)
      DO UPDATE SET
        preference_value = LEAST(1.0, user_preference_learning.preference_value + 0.1),
        confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
        interaction_count = user_preference_learning.interaction_count + 1,
        last_updated = now();
    END IF;
    
    -- Time preference
    IF NEW.interaction_data ? 'time_of_day' THEN
      time_pref := NEW.interaction_data->>'time_of_day';
      INSERT INTO public.user_preference_learning (user_id, preference_type, preference_key, preference_value, confidence, interaction_count)
      VALUES (NEW.user_id, 'time', time_pref, 0.1, 0.1, 1)
      ON CONFLICT (user_id, preference_type, preference_key)
      DO UPDATE SET
        preference_value = LEAST(1.0, user_preference_learning.preference_value + 0.1),
        confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
        interaction_count = user_preference_learning.interaction_count + 1,
        last_updated = now();
    END IF;
    
  ELSIF NEW.interaction_type IN ('dislike', 'unsave') THEN
    -- Negative interaction - decrease preference scores
    
    -- Category preference
    IF NEW.interaction_data ? 'category' THEN
      category_pref := NEW.interaction_data->>'category';
      INSERT INTO public.user_preference_learning (user_id, preference_type, preference_key, preference_value, confidence, interaction_count)
      VALUES (NEW.user_id, 'category', category_pref, -0.1, 0.1, 1)
      ON CONFLICT (user_id, preference_type, preference_key)
      DO UPDATE SET
        preference_value = GREATEST(-1.0, user_preference_learning.preference_value - 0.1),
        confidence = LEAST(1.0, user_preference_learning.confidence + 0.05),
        interaction_count = user_preference_learning.interaction_count + 1,
        last_updated = now();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update preferences
CREATE TRIGGER trigger_update_preferences_from_interaction
  AFTER INSERT ON public.user_interactions
  FOR EACH ROW
  EXECUTE FUNCTION update_user_preferences_from_interaction();

-- Function to clean up old location history (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_location_history()
RETURNS void AS $$
BEGIN
  DELETE FROM public.user_location_history 
  WHERE created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;

-- Function to get user's frequent locations
CREATE OR REPLACE FUNCTION get_user_frequent_locations(user_uuid UUID, limit_count INTEGER DEFAULT 5)
RETURNS TABLE (
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  visit_count BIGINT,
  last_visit TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ulh.latitude,
    ulh.longitude,
    COUNT(*) as visit_count,
    MAX(ulh.created_at) as last_visit
  FROM public.user_location_history ulh
  WHERE ulh.user_id = user_uuid
    AND ulh.location_type = 'current'
  GROUP BY ulh.latitude, ulh.longitude
  HAVING COUNT(*) >= 3 -- Only locations visited at least 3 times
  ORDER BY visit_count DESC, last_visit DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;