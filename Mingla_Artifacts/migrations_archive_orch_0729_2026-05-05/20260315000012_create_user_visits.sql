-- ============================================================
-- Create user_visits table for tracking visited experiences
-- ============================================================

CREATE TABLE public.user_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experience_id TEXT NOT NULL,
  card_data JSONB DEFAULT '{}',
  visited_at TIMESTAMPTZ DEFAULT now(),
  source TEXT CHECK (source IN ('manual', 'geofence', 'calendar')),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT user_visits_unique UNIQUE (user_id, experience_id)
);

CREATE INDEX idx_user_visits_user_visited ON public.user_visits(user_id, visited_at DESC);
CREATE INDEX idx_user_visits_experience ON public.user_visits(experience_id);

ALTER TABLE public.user_visits ENABLE ROW LEVEL SECURITY;

-- Owner can do everything
CREATE POLICY "Users can manage their own visits"
  ON public.user_visits FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Paired users can view each other's visits
CREATE POLICY "Paired users can view visits"
  ON public.user_visits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pairings
      WHERE (user_a_id = auth.uid() AND user_b_id = user_visits.user_id)
         OR (user_b_id = auth.uid() AND user_a_id = user_visits.user_id)
    )
  );
