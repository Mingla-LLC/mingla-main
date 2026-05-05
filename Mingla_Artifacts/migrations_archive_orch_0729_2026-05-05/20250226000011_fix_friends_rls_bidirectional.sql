-- Fix friends table RLS policy to allow reading friendships from both directions
-- The current policy only allows reading when auth.uid() = user_id,
-- but friendships can exist in both directions (user_id or friend_user_id)

-- Drop the restrictive policy
DROP POLICY IF EXISTS "Users can view their own friendships" ON public.friends;

-- Create a new policy that allows reading friendships in both directions
CREATE POLICY "Users can view their own friendships" ON public.friends
  FOR SELECT 
  USING (
    -- Allow if the user is either the user_id or friend_user_id
    auth.uid() = user_id OR auth.uid() = friend_user_id
  );

-- Keep the existing INSERT, UPDATE, DELETE policies
-- These prevent unauthorized modifications to friendships
