-- ===========================================
-- USER ACTIVITY (Recent Activity for Profile)
-- ===========================================
-- Tracks: saved_card, scheduled_card, joined_board

CREATE TABLE IF NOT EXISTS public.user_activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('saved_card', 'scheduled_card', 'joined_board')),
  title TEXT NOT NULL,
  tag TEXT,
  reference_id TEXT,
  reference_type TEXT CHECK (reference_type IN ('experience', 'board')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON public.user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON public.user_activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_created ON public.user_activity(user_id, created_at DESC);

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own activity" ON public.user_activity;
CREATE POLICY "Users can view their own activity"
  ON public.user_activity
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert their own activity" ON public.user_activity;
CREATE POLICY "Users can insert their own activity"
  ON public.user_activity
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- No UPDATE/DELETE policies: activity is append-only for users (admin could delete if needed later)
