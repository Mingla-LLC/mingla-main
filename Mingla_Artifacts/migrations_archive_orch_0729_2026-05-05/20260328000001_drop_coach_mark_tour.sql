-- Drop coach mark / tour feature entirely
-- Removes the coach_mark_progress table and the coach_map_tour_status column from profiles

DROP TABLE IF EXISTS coach_mark_progress;

ALTER TABLE profiles DROP COLUMN IF EXISTS coach_map_tour_status;
