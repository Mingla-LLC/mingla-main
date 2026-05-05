-- AUTO-ASSIGN BETA TESTER FLAG
-- Purpose: Make all users beta testers by default (temporary measure).
-- This changes the column default for future signups AND backfills existing users.
-- To revert: ALTER TABLE profiles ALTER COLUMN is_beta_tester SET DEFAULT false;
-- (Reverting the default does NOT remove the flag from existing users.)

-- Step 1: Change column default for all future signups
ALTER TABLE profiles ALTER COLUMN is_beta_tester SET DEFAULT true;

-- Step 2: Backfill all existing users who don't already have the flag
UPDATE profiles SET is_beta_tester = true WHERE is_beta_tester = false;
