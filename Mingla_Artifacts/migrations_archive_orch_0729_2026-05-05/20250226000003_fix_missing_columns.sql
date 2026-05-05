-- ============================================
-- Fix Missing Columns & Add Column Alias
-- ============================================
-- 1. Add has_accepted and joined_at to session_participants (referenced in 57+ places in app code)
-- 2. Add invited_user_id as a generated column aliasing invitee_id on collaboration_invites (38+ app references)
-- 3. Add unique constraint for conflict resolution
-- ============================================

-- Step 1: Add missing columns to session_participants
ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS has_accepted BOOLEAN DEFAULT false;

ALTER TABLE public.session_participants
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT now();

-- Backfill: existing participants should be marked as accepted
UPDATE public.session_participants
SET has_accepted = true
WHERE has_accepted = false OR has_accepted IS NULL;

-- Step 2: Add invited_user_id as a generated column that mirrors invitee_id
-- This allows app code using "invited_user_id" to work while keeping invitee_id as source of truth
-- Note: We use a stored generated column so it can be used in queries, inserts still use invitee_id
-- Actually, generated columns can't be written to, so instead we add a real column and sync via trigger

-- Add the invited_user_id column
ALTER TABLE public.collaboration_invites
  ADD COLUMN IF NOT EXISTS invited_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill existing rows: copy invitee_id to invited_user_id
UPDATE public.collaboration_invites
SET invited_user_id = invitee_id
WHERE invited_user_id IS NULL AND invitee_id IS NOT NULL;

-- Create a trigger to keep them in sync (either direction)
CREATE OR REPLACE FUNCTION public.sync_invite_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If invited_user_id is set but invitee_id is not, copy to invitee_id
  IF NEW.invited_user_id IS NOT NULL AND NEW.invitee_id IS NULL THEN
    NEW.invitee_id := NEW.invited_user_id;
  -- If invitee_id is set but invited_user_id is not, copy to invited_user_id  
  ELSIF NEW.invitee_id IS NOT NULL AND NEW.invited_user_id IS NULL THEN
    NEW.invited_user_id := NEW.invitee_id;
  -- If both are set, prefer invited_user_id (the one app code writes)
  ELSIF NEW.invited_user_id IS NOT NULL AND NEW.invitee_id IS NOT NULL THEN
    NEW.invitee_id := NEW.invited_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_invite_ids ON public.collaboration_invites;
CREATE TRIGGER sync_invite_ids
  BEFORE INSERT OR UPDATE ON public.collaboration_invites
  FOR EACH ROW
  EXECUTE FUNCTION sync_invite_user_id();

-- Step 3: Add unique constraint for upsert conflict resolution  
-- The app uses onConflict: 'session_id,invited_user_id'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'collaboration_invites_session_invited_user_unique'
  ) THEN
    ALTER TABLE public.collaboration_invites
      ADD CONSTRAINT collaboration_invites_session_invited_user_unique 
      UNIQUE (session_id, invited_user_id);
  END IF;
END $$;

-- Step 4: Create index for performance on the new columns
CREATE INDEX IF NOT EXISTS idx_session_participants_has_accepted 
  ON public.session_participants(has_accepted);

CREATE INDEX IF NOT EXISTS idx_collaboration_invites_invited_user_id 
  ON public.collaboration_invites(invited_user_id);
