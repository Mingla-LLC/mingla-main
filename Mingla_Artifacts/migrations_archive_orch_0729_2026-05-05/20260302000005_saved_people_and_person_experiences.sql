-- Migration: 20260302000005_saved_people_and_person_experiences.sql
-- Description: Creates server-side storage for saved people with description field,
-- and a table for per-person curated experiences generated from descriptions.

-- Table: saved_people
-- Stores people the user adds in the Discover tab for personalized experience generation
CREATE TABLE public.saved_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  birthday DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  description TEXT,
  description_processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: fast lookups by user
CREATE INDEX idx_saved_people_user_id ON public.saved_people(user_id);

-- RLS
ALTER TABLE public.saved_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own saved people"
  ON public.saved_people FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own saved people"
  ON public.saved_people FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved people"
  ON public.saved_people FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved people"
  ON public.saved_people FOR DELETE
  USING (auth.uid() = user_id);

-- Table: person_experiences
-- Stores curated experiences generated from a person's description,
-- linked to specific holidays or occasions
CREATE TABLE public.person_experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.saved_people(id) ON DELETE CASCADE,
  occasion TEXT NOT NULL,
  occasion_date DATE,
  experience_data JSONB NOT NULL,
  generated_from_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: fast lookup by person + occasion
CREATE INDEX idx_person_experiences_person_id ON public.person_experiences(person_id);
CREATE INDEX idx_person_experiences_user_person ON public.person_experiences(user_id, person_id);

-- RLS
ALTER TABLE public.person_experiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own person experiences"
  ON public.person_experiences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own person experiences"
  ON public.person_experiences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own person experiences"
  ON public.person_experiences FOR DELETE
  USING (auth.uid() = user_id);
