-- Fix RLS policies for friends table
-- Allow users to perform operations where they are either user_id OR friend_user_id
-- This is necessary because when accepting a friend request via trigger,
-- the accepting user is inserted as friend_user_id, not user_id

DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friends' AND table_schema = 'public') THEN
        -- Check if both user_id and friend_user_id columns exist
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'friends' 
            AND column_name = 'user_id' 
            AND table_schema = 'public'
        ) AND EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'friends' 
            AND column_name = 'friend_user_id' 
            AND table_schema = 'public'
        ) THEN
            -- Drop existing policies
            DROP POLICY IF EXISTS "Users can view their own friendships" ON public.friends;
            DROP POLICY IF EXISTS "Users can create friend requests" ON public.friends;
            DROP POLICY IF EXISTS "Users can update their own friendships" ON public.friends;
            DROP POLICY IF EXISTS "Users can delete their own friendships" ON public.friends;

            -- Create updated SELECT policy: users can view friendships where they are either user_id or friend_user_id
            CREATE POLICY "Users can view their own friendships" ON public.friends
              FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_user_id);

            -- Create updated INSERT policy: users can insert where they are either user_id or friend_user_id
            -- This allows:
            -- 1. Users to send friend requests (they are user_id)
            -- 2. Triggers to insert when accepting requests (user is friend_user_id)
            CREATE POLICY "Users can create friend requests" ON public.friends
              FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() = friend_user_id);

            -- Create updated UPDATE policy: users can update friendships where they are either user_id or friend_user_id
            CREATE POLICY "Users can update their own friendships" ON public.friends
              FOR UPDATE USING (auth.uid() = user_id OR auth.uid() = friend_user_id);

            -- Create updated DELETE policy: users can delete friendships where they are either user_id or friend_user_id
            CREATE POLICY "Users can delete their own friendships" ON public.friends
              FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_user_id);
        END IF;
    END IF;
END $$;

