-- Remove rotation system columns from collaboration_sessions
-- These are no longer used — all participants' preferences are now unioned.
ALTER TABLE public.collaboration_sessions
  DROP COLUMN IF EXISTS active_preference_owner_id,
  DROP COLUMN IF EXISTS rotation_order;
