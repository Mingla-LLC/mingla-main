-- RLS REPAIR MIGRATION
-- This fixes RLS policies without affecting existing data

-- ===========================================
-- 1. ENABLE RLS ON ALL TABLES
-- ===========================================

-- Enable RLS on core tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_invites ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- 2. DROP EXISTING POLICIES (IF ANY) AND CREATE NEW ONES
-- ===========================================

-- Profiles RLS Policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Experiences RLS Policies
DROP POLICY IF EXISTS "Anyone can view experiences" ON public.experiences;
CREATE POLICY "Anyone can view experiences" ON public.experiences
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert experiences" ON public.experiences;
CREATE POLICY "Authenticated users can insert experiences" ON public.experiences
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Boards RLS Policies
DROP POLICY IF EXISTS "Users can view public boards and their own boards" ON public.boards;
CREATE POLICY "Users can view public boards and their own boards" ON public.boards
  FOR SELECT USING (
    is_public = true OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Users can create boards" ON public.boards;
CREATE POLICY "Users can create boards" ON public.boards
  FOR INSERT WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update their own boards" ON public.boards;
CREATE POLICY "Users can update their own boards" ON public.boards
  FOR UPDATE USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete their own boards" ON public.boards;
CREATE POLICY "Users can delete their own boards" ON public.boards
  FOR DELETE USING (auth.uid() = created_by);

-- Saved Experiences RLS Policies
DROP POLICY IF EXISTS "Users can view their own saved experiences" ON public.saved_experiences;
CREATE POLICY "Users can view their own saved experiences" ON public.saved_experiences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own saved experiences" ON public.saved_experiences;
CREATE POLICY "Users can insert their own saved experiences" ON public.saved_experiences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own saved experiences" ON public.saved_experiences;
CREATE POLICY "Users can update their own saved experiences" ON public.saved_experiences
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own saved experiences" ON public.saved_experiences;
CREATE POLICY "Users can delete their own saved experiences" ON public.saved_experiences
  FOR DELETE USING (auth.uid() = user_id);

-- Scheduled Activities RLS Policies
DROP POLICY IF EXISTS "Users can view their own scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Users can view their own scheduled activities" ON public.scheduled_activities
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Users can insert their own scheduled activities" ON public.scheduled_activities
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Users can update their own scheduled activities" ON public.scheduled_activities
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own scheduled activities" ON public.scheduled_activities;
CREATE POLICY "Users can delete their own scheduled activities" ON public.scheduled_activities
  FOR DELETE USING (auth.uid() = user_id);

-- Board Cards RLS Policies
DROP POLICY IF EXISTS "Users can view cards in boards they have access to" ON public.board_cards;
CREATE POLICY "Users can view cards in boards they have access to" ON public.board_cards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_cards.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

DROP POLICY IF EXISTS "Users can add cards to boards they have access to" ON public.board_cards;
CREATE POLICY "Users can add cards to boards they have access to" ON public.board_cards
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_cards.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

-- Board Votes RLS Policies
DROP POLICY IF EXISTS "Users can view votes in boards they have access to" ON public.board_votes;
CREATE POLICY "Users can view votes in boards they have access to" ON public.board_votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_votes.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

DROP POLICY IF EXISTS "Users can vote on cards in boards they have access to" ON public.board_votes;
CREATE POLICY "Users can vote on cards in boards they have access to" ON public.board_votes
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_votes.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

DROP POLICY IF EXISTS "Users can update their own votes" ON public.board_votes;
CREATE POLICY "Users can update their own votes" ON public.board_votes
  FOR UPDATE USING (auth.uid() = user_id);

-- Board Threads RLS Policies
DROP POLICY IF EXISTS "Users can view threads in boards they have access to" ON public.board_threads;
CREATE POLICY "Users can view threads in boards they have access to" ON public.board_threads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_threads.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

DROP POLICY IF EXISTS "Users can create threads in boards they have access to" ON public.board_threads;
CREATE POLICY "Users can create threads in boards they have access to" ON public.board_threads
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_threads.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

DROP POLICY IF EXISTS "Users can update their own threads" ON public.board_threads;
CREATE POLICY "Users can update their own threads" ON public.board_threads
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own threads" ON public.board_threads;
CREATE POLICY "Users can delete their own threads" ON public.board_threads
  FOR DELETE USING (auth.uid() = user_id);

-- Activity History RLS Policies
DROP POLICY IF EXISTS "Users can view activity history for boards they have access to" ON public.activity_history;
CREATE POLICY "Users can view activity history for boards they have access to" ON public.activity_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = activity_history.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

DROP POLICY IF EXISTS "Users can insert activity history for boards they have access to" ON public.activity_history;
CREATE POLICY "Users can insert activity history for boards they have access to" ON public.activity_history
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = activity_history.board_id
      AND (b.created_by = auth.uid() OR b.is_public = true)
    )
  );

-- Friends RLS Policies (only if table exists and has expected columns)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friends' AND table_schema = 'public') THEN
        -- Check what columns actually exist in friends table
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'friends' AND column_name = 'user_id' AND table_schema = 'public') THEN
            DROP POLICY IF EXISTS "Users can view their own friendships" ON public.friends;
            CREATE POLICY "Users can view their own friendships" ON public.friends
              FOR SELECT USING (auth.uid() = user_id);

            DROP POLICY IF EXISTS "Users can create friend requests" ON public.friends;
            CREATE POLICY "Users can create friend requests" ON public.friends
              FOR INSERT WITH CHECK (auth.uid() = user_id);

            DROP POLICY IF EXISTS "Users can update their own friendships" ON public.friends;
            CREATE POLICY "Users can update their own friendships" ON public.friends
              FOR UPDATE USING (auth.uid() = user_id);

            DROP POLICY IF EXISTS "Users can delete their own friendships" ON public.friends;
            CREATE POLICY "Users can delete their own friendships" ON public.friends
              FOR DELETE USING (auth.uid() = user_id);
        END IF;
    END IF;
END $$;

-- Messages RLS Policies (only if table exists and has expected columns)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages' AND table_schema = 'public') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'conversation_id' AND table_schema = 'public') THEN
            DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
            CREATE POLICY "Users can view messages in their conversations" ON public.messages
              FOR SELECT USING (
                EXISTS (
                  SELECT 1 FROM public.conversation_participants cp
                  WHERE cp.conversation_id = messages.conversation_id
                  AND cp.user_id = auth.uid()
                )
              );

            DROP POLICY IF EXISTS "Users can send messages to conversations they participate in" ON public.messages;
            CREATE POLICY "Users can send messages to conversations they participate in" ON public.messages
              FOR INSERT WITH CHECK (
                auth.uid() = sender_id AND
                EXISTS (
                  SELECT 1 FROM public.conversation_participants cp
                  WHERE cp.conversation_id = messages.conversation_id
                  AND cp.user_id = auth.uid()
                )
              );

            DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
            CREATE POLICY "Users can update their own messages" ON public.messages
              FOR UPDATE USING (auth.uid() = sender_id);

            DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
            CREATE POLICY "Users can delete their own messages" ON public.messages
              FOR DELETE USING (auth.uid() = sender_id);
        END IF;
    END IF;
END $$;
