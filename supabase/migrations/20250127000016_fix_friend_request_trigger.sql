-- Fix the accept_friend_request trigger function
-- The trigger was using wrong column names:
-- 1. friend_requests table has sender_id and receiver_id (not user_id and friend_id)
-- 2. friends table has friend_user_id (not friend_id)
-- 
-- IMPORTANT: Using SECURITY DEFINER so the function runs with the permissions
-- of the function owner (postgres/supabase_admin), bypassing RLS checks.
-- This is necessary because the trigger inserts a row where the current user
-- is friend_user_id, and we need to ensure the INSERT succeeds.

CREATE OR REPLACE FUNCTION public.accept_friend_request()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If status changed to 'accepted', create reciprocal friendship
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    -- Insert into friends table with correct column names:
    -- user_id = receiver_id (the person accepting the request)
    -- friend_user_id = sender_id (the person who sent the request)
    INSERT INTO public.friends (user_id, friend_user_id, status)
    VALUES (NEW.receiver_id, NEW.sender_id, 'accepted')
    ON CONFLICT (user_id, friend_user_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

