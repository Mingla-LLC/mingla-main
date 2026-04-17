-- ===========================================
-- ORCH-0437: Near You Leaderboard — Phase 1
-- Migration 3: Tag-Along Requests table
-- ===========================================

CREATE TABLE public.tag_along_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  receiver_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired','cancelled')),

  -- Collab session created on accept (NULL until accepted)
  collab_session_id UUID REFERENCES public.collaboration_sessions(id) ON DELETE SET NULL,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Only one pending request per sender→receiver pair at a time
CREATE UNIQUE INDEX idx_tag_along_pending
  ON public.tag_along_requests (sender_id, receiver_id)
  WHERE status = 'pending';

-- For receiver's inbox — fast lookup of pending incoming requests
CREATE INDEX idx_tag_along_receiver_pending
  ON public.tag_along_requests (receiver_id, created_at DESC)
  WHERE status = 'pending';

-- Enable Realtime for in-app banner notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.tag_along_requests;

-- Row Level Security
ALTER TABLE public.tag_along_requests ENABLE ROW LEVEL SECURITY;

-- Sender can see their own outgoing requests
CREATE POLICY "Sender sees own requests"
  ON public.tag_along_requests
  FOR SELECT
  USING (sender_id = auth.uid());

-- Receiver can see incoming requests
CREATE POLICY "Receiver sees incoming requests"
  ON public.tag_along_requests
  FOR SELECT
  USING (receiver_id = auth.uid());

-- Only edge functions (service role) can insert/update/delete
CREATE POLICY "Service role manages requests"
  ON public.tag_along_requests
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
