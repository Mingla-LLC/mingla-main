-- Migration: Add user_id to board_session_preferences to support per-user preferences
-- Each user in a session will have their own preference sheet

-- Step 1: Add user_id column
ALTER TABLE public.board_session_preferences
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Update existing records to have user_id (set to session creator)
-- This handles existing data migration
UPDATE public.board_session_preferences bsp
SET user_id = cs.created_by
FROM public.collaboration_sessions cs
WHERE bsp.session_id = cs.id
AND bsp.user_id IS NULL;

-- Step 3: Make user_id NOT NULL after backfilling data
ALTER TABLE public.board_session_preferences
ALTER COLUMN user_id SET NOT NULL;

-- Step 4: Drop the old unique constraint on session_id only
ALTER TABLE public.board_session_preferences
DROP CONSTRAINT IF EXISTS board_session_preferences_session_id_key;

-- Step 5: Add new unique constraint on (session_id, user_id)
ALTER TABLE public.board_session_preferences
ADD CONSTRAINT board_session_preferences_session_id_user_id_key 
UNIQUE(session_id, user_id);

-- Step 6: Add index on user_id for performance
CREATE INDEX IF NOT EXISTS idx_board_session_preferences_user_id 
  ON public.board_session_preferences(user_id);

-- Step 7: Add composite index for common queries
CREATE INDEX IF NOT EXISTS idx_board_session_preferences_session_user 
  ON public.board_session_preferences(session_id, user_id);

-- Step 8: Update RLS policies to allow users to manage their own preferences

-- Drop old policies
DROP POLICY IF EXISTS "Users can view session preferences for their sessions" 
  ON public.board_session_preferences;
DROP POLICY IF EXISTS "Admins can update session preferences" 
  ON public.board_session_preferences;
DROP POLICY IF EXISTS "Admins can insert session preferences" 
  ON public.board_session_preferences;

-- New policy: Users can view their own preferences for sessions they're in
CREATE POLICY "Users can view their own session preferences" 
  ON public.board_session_preferences
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_session_preferences.session_id
      AND sp.user_id = auth.uid()
    )
  );

-- New policy: Users can update their own preferences
CREATE POLICY "Users can update their own session preferences" 
  ON public.board_session_preferences
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- New policy: Users can insert their own preferences for sessions they're in
CREATE POLICY "Users can insert their own session preferences" 
  ON public.board_session_preferences
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = board_session_preferences.session_id
      AND sp.user_id = auth.uid()
    )
  );

-- New policy: Users can delete their own preferences
CREATE POLICY "Users can delete their own session preferences" 
  ON public.board_session_preferences
  FOR DELETE
  USING (user_id = auth.uid());

