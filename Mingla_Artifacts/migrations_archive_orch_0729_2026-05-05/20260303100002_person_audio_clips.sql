-- Migration: 20260303100002_person_audio_clips.sql
-- Description: Stores audio description clips for Standard Persons (not linked friends).

CREATE TABLE public.person_audio_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES public.saved_people(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 60),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Max 5 clips per person (enforced at application level, but index supports fast lookup)
CREATE INDEX idx_person_audio_clips_person
  ON public.person_audio_clips (person_id, sort_order);

-- RLS
ALTER TABLE public.person_audio_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own person audio clips"
  ON public.person_audio_clips FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
