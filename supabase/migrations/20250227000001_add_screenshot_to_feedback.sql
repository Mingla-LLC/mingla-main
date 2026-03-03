-- Add screenshot_url column to app_feedback table
ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS screenshot_url text;
