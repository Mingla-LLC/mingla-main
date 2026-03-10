-- Migration: drop_coach_mark_progress
-- Description: Remove the coach_mark_progress table. The coach mark education
-- system has been fully removed from the codebase and will be redesigned.

DROP TABLE IF EXISTS public.coach_mark_progress;
