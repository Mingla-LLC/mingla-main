-- ADD CUSTOM LOCATION TO PREFERENCES MIGRATION
-- Adds custom_location column to preferences table for storing user's location preference

-- Add custom_location column to preferences table
ALTER TABLE public.preferences
ADD COLUMN IF NOT EXISTS custom_location TEXT;

