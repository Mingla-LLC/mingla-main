-- Migration: 20260303100001_friend_links.sql
-- Description: Stores friend link requests and their status for the Linked Persons feature.

CREATE TABLE public.friend_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'unlinked')),
  requester_person_id UUID REFERENCES public.saved_people(id) ON DELETE SET NULL,
  target_person_id UUID REFERENCES public.saved_people(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  unlinked_at TIMESTAMPTZ,
  unlinked_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_link CHECK (requester_id != target_id)
);

-- Prevent duplicate active links between the same two users
CREATE UNIQUE INDEX idx_friend_links_active_pair
  ON public.friend_links (LEAST(requester_id, target_id), GREATEST(requester_id, target_id))
  WHERE status IN ('pending', 'accepted');

-- Fast lookup for pending requests targeting a user
CREATE INDEX idx_friend_links_target_pending
  ON public.friend_links (target_id) WHERE status = 'pending';

-- Fast lookup for accepted links for a user (either side)
CREATE INDEX idx_friend_links_accepted
  ON public.friend_links (requester_id, target_id) WHERE status = 'accepted';

-- RLS
ALTER TABLE public.friend_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own links"
  ON public.friend_links FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = target_id);

CREATE POLICY "Users can insert as requester"
  ON public.friend_links FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

-- Target can only accept or decline pending links
CREATE POLICY "Target can respond to pending links"
  ON public.friend_links FOR UPDATE
  USING (auth.uid() = target_id AND status = 'pending')
  WITH CHECK (auth.uid() = target_id AND status IN ('accepted', 'declined'));

-- Requester can only cancel pending links
CREATE POLICY "Requester can cancel pending links"
  ON public.friend_links FOR UPDATE
  USING (auth.uid() = requester_id AND status = 'pending')
  WITH CHECK (auth.uid() = requester_id AND status = 'cancelled');
