-- Fix profile visibility for friends - allow reading friends' profiles (including avatars)
-- The issue: RLS policy only allows reading own profile, but avatar_url retrieval needs to read friends' profiles
-- The solution: Add a new SELECT policy that allows reading profiles of connected friends

-- Add new RLS policy to allow reading friends' profiles
-- This policy allows a user to read another user's profile if they are connected as friends
CREATE POLICY "Users can read friend profiles" ON public.profiles
  FOR SELECT
  USING (
    -- Allow reading if:
    -- 1. It's the user's own profile, OR
    -- 2. The user and profile owner are accepted friends
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.friends
      WHERE status = 'accepted'
      AND (
        (user_id = auth.uid() AND friend_user_id = id)
        OR
        (friend_user_id = auth.uid() AND user_id = id)
      )
    )
  );
