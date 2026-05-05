-- Add coach_mark_step to profiles for guided tour tracking.
-- 0=not started, 1-10=current step, 11=completed, -1=skipped

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS coach_mark_step INTEGER DEFAULT 0;

COMMENT ON COLUMN profiles.coach_mark_step IS
  '0=not started, 1-10=current step, 11=completed, -1=skipped';
