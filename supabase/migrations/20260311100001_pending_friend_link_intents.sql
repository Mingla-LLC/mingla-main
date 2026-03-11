-- Migration: 20260311100001_pending_friend_link_intents.sql
-- Description: Stores deferred friend link requests for non-Mingla users.

CREATE TABLE IF NOT EXISTS public.pending_friend_link_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  person_id UUID REFERENCES public.saved_people(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'converted', 'cancelled')),
  converted_link_id UUID REFERENCES public.friend_links(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One pending intent per inviter-phone pair
CREATE UNIQUE INDEX idx_pending_fl_intents_inviter_phone
  ON public.pending_friend_link_intents(inviter_id, phone_e164)
  WHERE status = 'pending';

-- Fast lookup by phone for trigger
CREATE INDEX idx_pending_fl_intents_phone_pending
  ON public.pending_friend_link_intents(phone_e164)
  WHERE status = 'pending';

-- RLS
ALTER TABLE public.pending_friend_link_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own pending intents"
  ON public.pending_friend_link_intents FOR SELECT
  USING (auth.uid() = inviter_id);

CREATE POLICY "Users can insert their own pending intents"
  ON public.pending_friend_link_intents FOR INSERT
  WITH CHECK (auth.uid() = inviter_id);

CREATE POLICY "Users can update their own pending intents"
  ON public.pending_friend_link_intents FOR UPDATE
  USING (auth.uid() = inviter_id)
  WITH CHECK (auth.uid() = inviter_id);

-- Trigger: auto-update updated_at
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.pending_friend_link_intents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
