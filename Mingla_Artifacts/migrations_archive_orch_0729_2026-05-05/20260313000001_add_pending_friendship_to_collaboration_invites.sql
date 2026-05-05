-- Migration: add_pending_friendship_to_collaboration_invites
-- Description: Adds a boolean flag to collaboration_invites that controls invite visibility.
-- When pending_friendship = true, the invite is hidden from the invitee until the
-- friend request between inviter and invitee is accepted. This decouples session
-- CREATION (anyone can be invited) from session ACTIVATION (friendship required).
--
-- Also adds a partial unique index to prevent duplicate active invites per user per session.

-- Step 1: Add the column
ALTER TABLE public.collaboration_invites
ADD COLUMN IF NOT EXISTS pending_friendship BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Deduplicate any existing duplicate active invites before creating unique index.
-- Keep the most recent invite per (session_id, invited_user_id) for active statuses.
DELETE FROM public.collaboration_invites a
USING public.collaboration_invites b
WHERE a.session_id = b.session_id
  AND a.invited_user_id = b.invited_user_id
  AND a.status IN ('pending', 'accepted')
  AND b.status IN ('pending', 'accepted')
  AND a.created_at < b.created_at;

-- Step 3: Partial unique index — only one active invite per user per session.
-- Cancelled/declined invites don't block re-inviting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_collab_invites_session_user_active
ON public.collaboration_invites(session_id, invited_user_id)
WHERE status IN ('pending', 'accepted');

-- Step 4: Index for efficient lookups when friend request is accepted/declined.
-- The cascade trigger queries by (inviter_id, invited_user_id) and vice versa.
CREATE INDEX IF NOT EXISTS idx_collab_invites_inviter_invited
ON public.collaboration_invites(inviter_id, invited_user_id)
WHERE status = 'pending';
