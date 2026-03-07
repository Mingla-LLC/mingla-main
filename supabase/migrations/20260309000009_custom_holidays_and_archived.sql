-- Migration: 20260309000009_custom_holidays_and_archived.sql
-- Description: Creates custom holidays per person and tracks archived holiday state.

-- Table: custom_holidays
-- Stores user-created holidays for specific saved people
CREATE TABLE public.custom_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.saved_people(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  day INTEGER NOT NULL CHECK (day >= 1 AND day <= 31),
  description TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_custom_holidays_user_person
  ON public.custom_holidays (user_id, person_id);

ALTER TABLE public.custom_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own custom holidays"
  ON public.custom_holidays FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Table: archived_holidays
-- Tracks which holidays a user has archived for a specific person
CREATE TABLE public.archived_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.saved_people(id) ON DELETE CASCADE,
  holiday_key TEXT NOT NULL, -- either standard holiday id (e.g. 'valentines_day') or custom holiday UUID
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate archive entries
CREATE UNIQUE INDEX idx_archived_holidays_unique
  ON public.archived_holidays (user_id, person_id, holiday_key);

ALTER TABLE public.archived_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own archived holidays"
  ON public.archived_holidays FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
