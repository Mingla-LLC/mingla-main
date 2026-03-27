-- Recreate coach_mark_progress table for interactive tour tracking.
-- Original table was dropped in 20260310000012; this recreates with same design.

CREATE TABLE IF NOT EXISTS public.coach_mark_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_mark_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one completion record per user per mark
ALTER TABLE public.coach_mark_progress
  ADD CONSTRAINT coach_mark_progress_user_mark_unique
  UNIQUE (user_id, coach_mark_id);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_coach_mark_progress_user_id
  ON public.coach_mark_progress (user_id);

-- RLS
ALTER TABLE public.coach_mark_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own coach mark progress"
  ON public.coach_mark_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own coach mark progress"
  ON public.coach_mark_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own coach mark progress"
  ON public.coach_mark_progress FOR DELETE
  USING (auth.uid() = user_id);
