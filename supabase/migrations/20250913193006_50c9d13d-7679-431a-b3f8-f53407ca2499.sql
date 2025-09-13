-- Fix friends table RLS policies to allow mutual friendship creation
-- The current policy prevents users from creating reciprocal friendships during acceptance

-- Drop the restrictive INSERT policy
DROP POLICY IF EXISTS "Users can create friendships" ON public.friends;

-- Create a new policy that allows creating friendships for both parties when accepting requests
CREATE POLICY "Users can create mutual friendships" 
ON public.friends 
FOR INSERT 
WITH CHECK (
  -- User can create their own friendship record
  auth.uid() = user_id 
  OR 
  -- User can create reciprocal friendship when accepting a friend request
  EXISTS (
    SELECT 1 FROM friend_requests fr 
    WHERE fr.sender_id = friends.user_id 
    AND fr.receiver_id = auth.uid() 
    AND fr.status = 'pending'
  )
  OR
  -- User can create reciprocal friendship when their request is being accepted
  EXISTS (
    SELECT 1 FROM friend_requests fr 
    WHERE fr.sender_id = auth.uid() 
    AND fr.receiver_id = friends.user_id 
    AND fr.status = 'pending'
  )
);