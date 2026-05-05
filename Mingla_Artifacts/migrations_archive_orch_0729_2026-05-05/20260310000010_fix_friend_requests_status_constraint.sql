-- Migration: 20260310000010_fix_friend_requests_status_constraint.sql
-- Description: The CHECK constraint on friend_requests.status allows 'rejected' but the entire
-- codebase uses 'declined'. The decline cascade trigger (cascade_friend_decline_to_collabs) checks
-- for 'declined'. The useFriends.ts hook writes 'declined'. This mismatch means every decline
-- silently fails with a constraint violation. This migration fixes the constraint to match reality.

-- Drop the existing constraint
ALTER TABLE public.friend_requests DROP CONSTRAINT IF EXISTS friend_requests_status_check;

-- Re-create with the correct values that match all code paths
ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined'));
