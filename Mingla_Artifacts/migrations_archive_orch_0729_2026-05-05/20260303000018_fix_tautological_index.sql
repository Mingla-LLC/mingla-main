-- Fix tautological index condition on calendar_entries
-- Date: 2026-03-03
-- The original index had: WHERE feedback_status IS NOT NULL OR feedback_status IS NULL
-- which is always true — making the partial index equivalent to a full index
-- but with the overhead of evaluating the WHERE on every insert/update.
-- Fix: drop and recreate as a plain index (no WHERE clause).

DROP INDEX IF EXISTS idx_calendar_entries_feedback;

CREATE INDEX idx_calendar_entries_feedback
  ON public.calendar_entries (user_id, feedback_status);
