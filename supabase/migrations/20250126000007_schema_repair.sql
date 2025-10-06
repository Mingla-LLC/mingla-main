-- SCHEMA REPAIR MIGRATION
-- This fixes the existing schema without losing data

-- ===========================================
-- 1. ADD MISSING COLUMNS TO EXISTING TABLES
-- ===========================================

-- Add missing columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS username TEXT,
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS location TEXT,
ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Update existing profiles to have email from auth.users if they don't have one
UPDATE public.profiles 
SET email = auth.users.email 
FROM auth.users 
WHERE public.profiles.id = auth.users.id 
AND public.profiles.email IS NULL;

-- Add missing columns to boards table
ALTER TABLE public.boards 
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Add missing columns to saved_experiences table
ALTER TABLE public.saved_experiences 
ADD COLUMN IF NOT EXISTS place_id TEXT, -- Google Places ID
ADD COLUMN IF NOT EXISTS subtitle TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS one_liner TEXT,
ADD COLUMN IF NOT EXISTS tip TEXT,
ADD COLUMN IF NOT EXISTS rating DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS review_count INTEGER,
ADD COLUMN IF NOT EXISTS save_type TEXT DEFAULT 'recommendation' CHECK (save_type IN ('experience', 'recommendation')),
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'saved' CHECK (status IN ('saved', 'scheduled', 'finalized'));

-- ===========================================
-- 2. CREATE MISSING TABLES (IF THEY DON'T EXIST)
-- ===========================================

-- Create scheduled_activities table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.scheduled_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL, -- Google Places ID
  experience_id TEXT, -- Changed from UUID to TEXT to support Google Places IDs
  saved_experience_id UUID REFERENCES public.saved_experiences(id) ON DELETE SET NULL,
  board_id UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  scheduled_date TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled' CONSTRAINT scheduled_activities_status_valid CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  source TEXT DEFAULT 'user_scheduled' CHECK (source IN ('user_scheduled', 'board_finalized')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure category column exists (in case table was created without it)
ALTER TABLE public.scheduled_activities 
ADD COLUMN IF NOT EXISTS category TEXT;

-- Update existing records to have a default category if they don't have one
UPDATE public.scheduled_activities 
SET category = 'general' 
WHERE category IS NULL;

-- Fix any typos in column names (experieence_id -> experience_id)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'scheduled_activities' 
        AND column_name = 'experieence_id'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.scheduled_activities 
        RENAME COLUMN experieence_id TO experience_id;
    END IF;
END $$;

-- Change experience_id from UUID to TEXT if it exists as UUID
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'scheduled_activities' 
        AND column_name = 'experience_id'
        AND data_type = 'uuid'
        AND table_schema = 'public'
    ) THEN
        -- Drop the foreign key constraint first
        ALTER TABLE public.scheduled_activities 
        DROP CONSTRAINT IF EXISTS scheduled_activities_experience_id_fkey;
        
        -- Change the column type
        ALTER TABLE public.scheduled_activities 
        ALTER COLUMN experience_id TYPE TEXT;
    END IF;
END $$;

-- Ensure all required columns exist for scheduled_activities
ALTER TABLE public.scheduled_activities 
ADD COLUMN IF NOT EXISTS card_id TEXT NOT NULL DEFAULT '', -- Google Places ID
ADD COLUMN IF NOT EXISTS experience_id TEXT, -- Changed from UUID to TEXT to support Google Places IDs
ADD COLUMN IF NOT EXISTS saved_experience_id UUID REFERENCES public.saved_experiences(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS board_id UUID REFERENCES public.boards(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMPTZ NOT NULL DEFAULT now(),
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled' CONSTRAINT scheduled_activities_status_valid CHECK (status IN ('scheduled', 'completed', 'cancelled')),
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'user_scheduled' CHECK (source IN ('user_scheduled', 'board_finalized'));

-- Drop existing status constraint if it exists and has wrong values
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'scheduled_activities_status_check'
        AND table_name = 'scheduled_activities'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.scheduled_activities 
        DROP CONSTRAINT scheduled_activities_status_check;
    END IF;
END $$;

-- Drop incorrect foreign key constraint on card_id if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'scheduled_activities_card_id_fkey'
        AND table_name = 'scheduled_activities'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.scheduled_activities 
        DROP CONSTRAINT scheduled_activities_card_id_fkey;
    END IF;
END $$;

-- Update existing records to have default values where needed
UPDATE public.scheduled_activities 
SET title = 'Untitled Activity' 
WHERE title IS NULL OR title = '';

UPDATE public.scheduled_activities 
SET scheduled_date = now() 
WHERE scheduled_date IS NULL;

-- ===========================================
-- 5. FIX USER_INTERACTIONS TABLE STRUCTURE
-- ===========================================

-- Add missing columns to user_interactions table if it exists
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_interactions' AND table_schema = 'public') THEN
        ALTER TABLE public.user_interactions 
        ADD COLUMN IF NOT EXISTS experience_id TEXT,
        ADD COLUMN IF NOT EXISTS interaction_data JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS location_context JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS session_id TEXT,
        ADD COLUMN IF NOT EXISTS recommendation_context JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
        
        -- Update existing records to have default values
        UPDATE public.user_interactions 
        SET interaction_data = '{}' 
        WHERE interaction_data IS NULL;
        
        UPDATE public.user_interactions 
        SET location_context = '{}' 
        WHERE location_context IS NULL;
        
        UPDATE public.user_interactions 
        SET recommendation_context = '{}' 
        WHERE recommendation_context IS NULL;
        
        UPDATE public.user_interactions 
        SET metadata = '{}' 
        WHERE metadata IS NULL;
    END IF;
END $$;

-- Create board_cards table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.board_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  saved_experience_id UUID NOT NULL REFERENCES public.saved_experiences(id) ON DELETE CASCADE,
  added_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(board_id, saved_experience_id)
);

-- Create board_votes table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.board_votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.board_cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down', 'neutral')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(board_id, card_id, user_id)
);

-- Create board_threads table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.board_threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  card_id UUID REFERENCES public.board_cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_id UUID REFERENCES public.board_threads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create activity_history table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.activity_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID REFERENCES public.boards(id) ON DELETE CASCADE,
  card_id UUID REFERENCES public.board_cards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('vote', 'unvote', 'finalize', 'unfinalize', 'add_card', 'remove_card')),
  action_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ===========================================
-- 3. CREATE MISSING INDEXES
-- ===========================================

-- Create indexes for performance - only if tables and columns exist
DO $$ 
BEGIN
    -- Profiles indexes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles' AND table_schema = 'public') THEN
        CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
    END IF;
    
    -- Experiences indexes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'experiences' AND table_schema = 'public') THEN
        CREATE INDEX IF NOT EXISTS idx_experiences_category ON public.experiences(category);
        CREATE INDEX IF NOT EXISTS idx_experiences_place_id ON public.experiences(place_id);
    END IF;
    
    -- Boards indexes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'boards' AND table_schema = 'public') THEN
        CREATE INDEX IF NOT EXISTS idx_boards_created_by ON public.boards(created_by);
        CREATE INDEX IF NOT EXISTS idx_boards_is_public ON public.boards(is_public);
    END IF;
    
    -- Saved experiences indexes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'saved_experiences' AND table_schema = 'public') THEN
        CREATE INDEX IF NOT EXISTS idx_saved_experiences_user_id ON public.saved_experiences(user_id);
        CREATE INDEX IF NOT EXISTS idx_saved_experiences_category ON public.saved_experiences(category);
    END IF;
    
    -- Friends indexes (check actual column names first)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friends' AND table_schema = 'public') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'friends' AND column_name = 'user_id' AND table_schema = 'public') THEN
            CREATE INDEX IF NOT EXISTS idx_friends_user_id ON public.friends(user_id);
        END IF;
        -- Only create friend_id index if that column actually exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'friends' AND column_name = 'friend_id' AND table_schema = 'public') THEN
            CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON public.friends(friend_id);
        END IF;
    END IF;
    
    -- Messages indexes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages' AND table_schema = 'public') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'conversation_id' AND table_schema = 'public') THEN
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'sender_id' AND table_schema = 'public') THEN
            CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
        END IF;
    END IF;
END $$;

-- Create indexes for new tables
CREATE INDEX IF NOT EXISTS idx_scheduled_activities_user_id ON public.scheduled_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_activities_scheduled_date ON public.scheduled_activities(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_board_cards_board_id ON public.board_cards(board_id);
CREATE INDEX IF NOT EXISTS idx_board_votes_board_id ON public.board_votes(board_id);
CREATE INDEX IF NOT EXISTS idx_board_votes_user_id ON public.board_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_board_threads_board_id ON public.board_threads(board_id);
CREATE INDEX IF NOT EXISTS idx_activity_history_board_id ON public.activity_history(board_id);

-- ===========================================
-- 4. ADD MISSING CONSTRAINTS
-- ===========================================

-- Add unique constraint to profiles username if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'profiles_username_key' 
        AND table_name = 'profiles'
    ) THEN
        ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
    END IF;
END $$;

-- Add unique constraint to experiences place_id if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'experiences_place_id_key' 
        AND table_name = 'experiences'
    ) THEN
        ALTER TABLE public.experiences ADD CONSTRAINT experiences_place_id_key UNIQUE (place_id);
    END IF;
END $$;

-- 6. UNDO SYSTEM INFRASTRUCTURE
-- Create undo_actions table for system-wide undo functionality
CREATE TABLE IF NOT EXISTS public.undo_actions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for undo_actions performance
CREATE INDEX IF NOT EXISTS idx_undo_actions_user_id ON public.undo_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_undo_actions_type ON public.undo_actions(type);
CREATE INDEX IF NOT EXISTS idx_undo_actions_expires_at ON public.undo_actions(expires_at);
CREATE INDEX IF NOT EXISTS idx_undo_actions_timestamp ON public.undo_actions(timestamp);

-- Add soft delete columns to existing tables for undo functionality
ALTER TABLE public.friends ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.board_cards ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

-- Create preference_history table for tracking preference changes
CREATE TABLE IF NOT EXISTS public.preference_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    preference_id UUID NOT NULL,
    old_data JSONB NOT NULL,
    new_data JSONB NOT NULL,
    change_type TEXT NOT NULL, -- 'create', 'update', 'delete'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for preference_history
CREATE INDEX IF NOT EXISTS idx_preference_history_user_id ON public.preference_history(user_id);
CREATE INDEX IF NOT EXISTS idx_preference_history_preference_id ON public.preference_history(preference_id);
CREATE INDEX IF NOT EXISTS idx_preference_history_created_at ON public.preference_history(created_at);

-- Function to clean up expired undo actions
CREATE OR REPLACE FUNCTION public.cleanup_expired_undo_actions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.undo_actions 
    WHERE expires_at < NOW();
END;
$$;

-- Function to create preference history entry
CREATE OR REPLACE FUNCTION public.create_preference_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Insert history record for preference changes
    INSERT INTO public.preference_history (
        user_id,
        preference_id,
        old_data,
        new_data,
        change_type
    ) VALUES (
        NEW.user_id,
        NEW.id,
        CASE 
            WHEN TG_OP = 'INSERT' THEN '{}'::jsonb
            ELSE to_jsonb(OLD)
        END,
        to_jsonb(NEW),
        TG_OP
    );
    
    RETURN NEW;
END;
$$;

-- Create trigger for preference history
DROP TRIGGER IF EXISTS trigger_preference_history ON public.preferences;
CREATE TRIGGER trigger_preference_history
    AFTER INSERT OR UPDATE OR DELETE ON public.preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.create_preference_history();

-- Function to get available undo actions for user
CREATE OR REPLACE FUNCTION public.get_undo_actions(p_user_id UUID)
RETURNS TABLE (
    id TEXT,
    type TEXT,
    data JSONB,
    action_timestamp TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ua.id,
        ua.type,
        ua.data,
        ua.timestamp as action_timestamp,
        ua.expires_at,
        ua.description
    FROM public.undo_actions ua
    WHERE ua.user_id = p_user_id
    AND ua.expires_at > NOW()
    ORDER BY ua.timestamp DESC;
END;
$$;

-- Function to execute undo action
CREATE OR REPLACE FUNCTION public.execute_undo_action(p_undo_id TEXT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    undo_record RECORD;
    success BOOLEAN := FALSE;
BEGIN
    -- Get the undo action
    SELECT * INTO undo_record
    FROM public.undo_actions
    WHERE id = p_undo_id
    AND user_id = p_user_id
    AND expires_at > NOW();
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Execute undo based on type
    CASE undo_record.type
        WHEN 'friend_removal' THEN
            -- Restore friend relationship
            UPDATE public.friends
            SET deleted_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'friendId')::UUID;
            success := TRUE;
            
        WHEN 'message_unsend' THEN
            -- Restore message
            UPDATE public.messages
            SET deleted_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'messageId')::UUID;
            success := TRUE;
            
        WHEN 'vote_undo' THEN
            -- Remove vote
            DELETE FROM public.board_votes
            WHERE id = (undo_record.data->>'voteId')::UUID;
            success := TRUE;
            
        WHEN 'finalize_undo' THEN
            -- Move card back to open state
            UPDATE public.board_cards
            SET status = 'open', finalized_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'cardId')::UUID;
            success := TRUE;
            
        WHEN 'board_archive' THEN
            -- Restore board
            UPDATE public.boards
            SET archived_at = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'boardId')::UUID;
            success := TRUE;
            
        WHEN 'save_undo' THEN
            -- Remove save
            DELETE FROM public.saves
            WHERE id = (undo_record.data->>'saveId')::UUID;
            success := TRUE;
            
        WHEN 'schedule_undo' THEN
            -- Move back to saved state
            UPDATE public.scheduled_activities
            SET status = 'saved', scheduled_date = NULL, updated_at = NOW()
            WHERE id = (undo_record.data->>'scheduleId')::UUID;
            success := TRUE;
            
        WHEN 'preference_rollback' THEN
            -- Restore original preferences
            UPDATE public.preferences
            SET 
                categories = (undo_record.data->'originalData'->>'categories')::TEXT[],
                budget = (undo_record.data->'originalData'->'budget')::JSONB,
                travel = (undo_record.data->'originalData'->>'travel')::TEXT,
                experience_types = (undo_record.data->'originalData'->>'experience_types')::TEXT[],
                updated_at = NOW()
            WHERE id = (undo_record.data->>'preferenceId')::UUID;
            success := TRUE;
            
        ELSE
            success := FALSE;
    END CASE;
    
    -- Remove the undo action if successful
    IF success THEN
        DELETE FROM public.undo_actions WHERE id = p_undo_id;
    END IF;
    
    RETURN success;
END;
$$;

-- RLS Policies for undo_actions
ALTER TABLE public.undo_actions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own undo actions" ON public.undo_actions;
DROP POLICY IF EXISTS "Users can insert their own undo actions" ON public.undo_actions;
DROP POLICY IF EXISTS "Users can delete their own undo actions" ON public.undo_actions;

CREATE POLICY "Users can view their own undo actions" ON public.undo_actions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own undo actions" ON public.undo_actions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own undo actions" ON public.undo_actions
    FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for preference_history
ALTER TABLE public.preference_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own preference history" ON public.preference_history;
DROP POLICY IF EXISTS "System can insert preference history" ON public.preference_history;

CREATE POLICY "Users can view their own preference history" ON public.preference_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert preference history" ON public.preference_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.undo_actions TO anon, authenticated;
GRANT ALL ON public.preference_history TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_undo_actions(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_undo_action(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_undo_actions() TO anon, authenticated;

-- ===========================================
-- 7. CREATE TRIGGERS FOR UPDATED_AT COLUMNS
-- ===========================================

-- Create trigger to automatically update updated_at timestamp for profiles
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;

-- Create trigger for profiles table
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
