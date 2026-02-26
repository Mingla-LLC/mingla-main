-- Fix friend_requests foreign key constraint
-- The constraint should reference profiles.id instead of auth.users.id
-- since profiles are the source of truth for user existence in our app

-- First, check if the table exists and what constraints it has
DO $$
BEGIN
  -- Check if friend_requests table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'friend_requests'
  ) THEN
    -- Drop the existing foreign key constraint if it references auth.users
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_schema = 'public'
      AND constraint_name = 'friend_requests_receiver_id_fkey'
      AND table_name = 'friend_requests'
    ) THEN
      ALTER TABLE public.friend_requests 
      DROP CONSTRAINT IF EXISTS friend_requests_receiver_id_fkey;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_schema = 'public'
      AND constraint_name = 'friend_requests_sender_id_fkey'
      AND table_name = 'friend_requests'
    ) THEN
      ALTER TABLE public.friend_requests 
      DROP CONSTRAINT IF EXISTS friend_requests_sender_id_fkey;
    END IF;

    -- Add new foreign key constraints that reference profiles instead of auth.users
    -- This makes sense because if a user exists in profiles, they exist in auth.users (via trigger)
    ALTER TABLE public.friend_requests
    ADD CONSTRAINT friend_requests_sender_id_fkey 
    FOREIGN KEY (sender_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;

    ALTER TABLE public.friend_requests
    ADD CONSTRAINT friend_requests_receiver_id_fkey 
    FOREIGN KEY (receiver_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
  END IF;
END $$;

