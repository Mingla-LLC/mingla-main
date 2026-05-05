-- Migration: 20260310000007_create_coach_mark_progress.sql
-- Description: Tracks which coach marks each user has completed.
-- One row per completed coach mark per user.

CREATE TABLE public.coach_mark_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_mark_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, coach_mark_id)
);

-- Index: fast lookup of all completed marks for a user (primary query pattern)
CREATE INDEX idx_coach_mark_progress_user_id
  ON public.coach_mark_progress(user_id);

-- RLS
ALTER TABLE public.coach_mark_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own progress"
  ON public.coach_mark_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own progress"
  ON public.coach_mark_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE or DELETE needed. Completion is permanent.

-- Migrate users who completed the old tour: pre-populate core Explore marks
-- so they don't re-learn basics they already know.
INSERT INTO public.coach_mark_progress (user_id, coach_mark_id, completed_at)
SELECT p.id, cm.id, NOW()
FROM public.profiles p
CROSS JOIN (
  VALUES
    ('explore_welcome'), ('explore_swipe_right'), ('explore_swipe_left'),
    ('explore_tap_card'), ('explore_solo_mode'), ('explore_notifications'),
    ('explore_preferences'), ('explore_session_pills'), ('explore_create_session'),
    ('explore_card_save'), ('explore_card_share'), ('explore_card_calendar')
) AS cm(id)
WHERE p.coach_map_tour_status = 'completed'
ON CONFLICT (user_id, coach_mark_id) DO NOTHING;
