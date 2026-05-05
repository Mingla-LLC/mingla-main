-- ============================================
-- Add invited_by as alias column for inviter_id
-- ============================================
-- This migration adds invited_by as an alias for inviter_id on collaboration_invites table
-- allowing existing app code that references invited_by to work correctly
-- Similar to the invited_user_id -> invitee_id alias created in a previous migration

-- Step 1: Add invited_by column as alias for inviter_id
ALTER TABLE public.collaboration_invites
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Backfill existing rows - copy inviter_id to invited_by
UPDATE public.collaboration_invites
SET invited_by = inviter_id
WHERE invited_by IS NULL AND inviter_id IS NOT NULL;

-- Step 3: Create trigger to keep inviter_id and invited_by in sync
CREATE OR REPLACE FUNCTION public.sync_invite_inviter_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If invited_by is set but inviter_id is not, copy to inviter_id
  IF NEW.invited_by IS NOT NULL AND NEW.inviter_id IS NULL THEN
    NEW.inviter_id := NEW.invited_by;
  -- If inviter_id is set but invited_by is not, copy to invited_by
  ELSIF NEW.inviter_id IS NOT NULL AND NEW.invited_by IS NULL THEN
    NEW.invited_by := NEW.inviter_id;
  -- If both are set, prefer inviter_id (canonical source of truth)
  ELSIF NEW.inviter_id IS NOT NULL AND NEW.invited_by IS NOT NULL THEN
    NEW.invited_by := NEW.inviter_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_invite_inviter_ids ON public.collaboration_invites;
CREATE TRIGGER sync_invite_inviter_ids
  BEFORE INSERT OR UPDATE ON public.collaboration_invites
  FOR EACH ROW
  EXECUTE FUNCTION sync_invite_inviter_id();

-- Step 4: Create index on invited_by for performance
CREATE INDEX IF NOT EXISTS idx_collaboration_invites_invited_by 
  ON public.collaboration_invites(invited_by);
