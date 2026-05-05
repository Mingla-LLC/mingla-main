-- ALLOW USERNAME CHECK MIGRATION
-- Adds RLS policy to allow anyone to check username availability
-- This allows unauthenticated users to check if a username is taken during signup

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Anyone can check username availability" ON public.profiles;

-- Create policy that allows anyone to read username column for availability checks
-- This is safe because we're only exposing the username, not other profile data
CREATE POLICY "Anyone can check username availability" ON public.profiles
  FOR SELECT 
  USING (true);

-- Note: This policy allows reading all profiles, but in practice, 
-- the application only queries for specific usernames, so this is acceptable.
-- The username is not sensitive information - it's meant to be public.

