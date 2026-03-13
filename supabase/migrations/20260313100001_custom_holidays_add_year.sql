-- Migration: 20260313100001_custom_holidays_add_year.sql
-- Description: Adds year column to custom_holidays for tracking commemoration age.
-- Categories and description are kept for backward compatibility but are no longer required.

ALTER TABLE public.custom_holidays
  ADD COLUMN year INTEGER;

-- Backfill existing rows: default to current year since we don't know the original year
UPDATE public.custom_holidays SET year = EXTRACT(YEAR FROM created_at)::INTEGER WHERE year IS NULL;

-- Now make it NOT NULL with a sensible default
ALTER TABLE public.custom_holidays
  ALTER COLUMN year SET NOT NULL,
  ALTER COLUMN year SET DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER;

-- Add check constraint
ALTER TABLE public.custom_holidays
  ADD CONSTRAINT custom_holidays_year_check CHECK (year >= 1900 AND year <= 2100);

-- Remove NOT NULL from categories since new entries won't set them
ALTER TABLE public.custom_holidays
  ALTER COLUMN categories DROP NOT NULL,
  ALTER COLUMN categories SET DEFAULT NULL;
