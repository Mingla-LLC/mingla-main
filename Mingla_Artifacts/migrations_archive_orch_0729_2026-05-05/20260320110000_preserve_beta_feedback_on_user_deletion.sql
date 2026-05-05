-- ============================================================
-- Preserve beta_feedback on user deletion (anonymized)
--
-- Problem: ON DELETE CASCADE destroys all feedback when user
-- deletes their account. Product signal is permanently lost.
--
-- Fix: Change FK to SET NULL so rows survive. The delete-user
-- edge function scrubs PII columns before profile deletion.
-- ============================================================

-- Step 1: Make user_id nullable (required for SET NULL to work)
ALTER TABLE beta_feedback ALTER COLUMN user_id DROP NOT NULL;

-- Step 2: Replace the FK constraint (CASCADE → SET NULL)
-- Must drop and recreate since ALTER CONSTRAINT can't change ON DELETE behavior.
ALTER TABLE beta_feedback DROP CONSTRAINT beta_feedback_user_id_fkey;

ALTER TABLE beta_feedback
  ADD CONSTRAINT beta_feedback_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
