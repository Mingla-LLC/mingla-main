-- Add beta tester and admin flags to profiles
ALTER TABLE profiles ADD COLUMN is_beta_tester BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;
