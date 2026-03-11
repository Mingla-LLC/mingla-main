-- Migration: 20260310000014_add_link_consent.sql
-- Description: Adds columns to track link consent separately from friend acceptance.
-- Both users must explicitly consent before profiles are linked.

ALTER TABLE public.friend_links
  ADD COLUMN IF NOT EXISTS link_status TEXT NOT NULL DEFAULT 'none'
    CHECK (link_status IN ('none', 'pending_consent', 'consented', 'declined')),
  ADD COLUMN IF NOT EXISTS requester_link_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS target_link_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

-- Index for finding pending consent prompts for a user (requester side)
CREATE INDEX IF NOT EXISTS idx_friend_links_pending_consent_requester
  ON public.friend_links(requester_id)
  WHERE status = 'accepted' AND link_status = 'pending_consent';

-- Index for finding pending consent prompts for a user (target side)
CREATE INDEX IF NOT EXISTS idx_friend_links_pending_consent_target
  ON public.friend_links(target_id)
  WHERE status = 'accepted' AND link_status = 'pending_consent';

COMMENT ON COLUMN public.friend_links.link_status IS
  'none=not yet prompted, pending_consent=waiting for both to respond, consented=both agreed, declined=at least one declined';
COMMENT ON COLUMN public.friend_links.requester_link_consent IS
  'TRUE if the original requester has agreed to link profiles';
COMMENT ON COLUMN public.friend_links.target_link_consent IS
  'TRUE if the original target has agreed to link profiles';
COMMENT ON COLUMN public.friend_links.linked_at IS
  'Timestamp when both users consented and profiles were linked';

-- RLS: Both requester and target can update link consent fields
-- (when status='accepted' and link_status='pending_consent')
CREATE POLICY "Users can respond to link consent"
  ON public.friend_links FOR UPDATE
  USING (
    (auth.uid() = requester_id OR auth.uid() = target_id)
    AND status = 'accepted'
    AND link_status = 'pending_consent'
  )
  WITH CHECK (
    link_status IN ('pending_consent', 'declined')
  );
