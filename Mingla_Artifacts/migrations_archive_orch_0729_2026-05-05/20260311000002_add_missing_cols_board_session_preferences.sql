-- Migration: Add missing columns to board_session_preferences for schema parity with solo preferences
-- Description: The solo `preferences` table has columns (time_slot, exact_time, use_gps_location,
-- custom_location) that are missing from `board_session_preferences`. Collaboration preferences
-- must carry the same data shape so that seeded values from onboarding are preserved faithfully
-- and the same normalization rules can be applied.

-- 1. time_slot — preset time of day (brunch, afternoon, dinner, lateNight)
ALTER TABLE public.board_session_preferences
  ADD COLUMN IF NOT EXISTS time_slot TEXT DEFAULT NULL;

-- 2. exact_time — user-selected exact time ("3:30 PM")
ALTER TABLE public.board_session_preferences
  ADD COLUMN IF NOT EXISTS exact_time TEXT DEFAULT NULL;

-- 3. use_gps_location — true = device GPS, false = custom_location
ALTER TABLE public.board_session_preferences
  ADD COLUMN IF NOT EXISTS use_gps_location BOOLEAN NOT NULL DEFAULT TRUE;

-- 4. custom_location — human-readable location string chosen via autocomplete
ALTER TABLE public.board_session_preferences
  ADD COLUMN IF NOT EXISTS custom_location TEXT DEFAULT NULL;
