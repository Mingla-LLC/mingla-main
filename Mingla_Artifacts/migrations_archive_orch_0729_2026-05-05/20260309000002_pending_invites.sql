-- Migration: 20260309000002_pending_invites.sql
-- Description: Stores phone numbers of non-app users invited by existing users.
-- Also stores pending collaboration session invites for non-app users.

-- ============================================================
-- 1. PENDING_INVITES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'cancelled')),
  converted_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inviter_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS idx_pending_invites_phone ON public.pending_invites(phone_e164)
  WHERE status = 'pending';

ALTER TABLE public.pending_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own pending invites" ON public.pending_invites;
CREATE POLICY "Users can read their own pending invites"
  ON public.pending_invites FOR SELECT
  USING (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Users can insert their own pending invites" ON public.pending_invites;
CREATE POLICY "Users can insert their own pending invites"
  ON public.pending_invites FOR INSERT
  WITH CHECK (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Users can update their own pending invites" ON public.pending_invites;
CREATE POLICY "Users can update their own pending invites"
  ON public.pending_invites FOR UPDATE
  USING (auth.uid() = inviter_id)
  WITH CHECK (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Users can delete their own pending invites" ON public.pending_invites;
CREATE POLICY "Users can delete their own pending invites"
  ON public.pending_invites FOR DELETE
  USING (auth.uid() = inviter_id);

-- ============================================================
-- 2. PENDING_SESSION_INVITES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_session_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'cancelled')),
  converted_invite_id UUID REFERENCES public.collaboration_invites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, phone_e164)
);

CREATE INDEX IF NOT EXISTS idx_pending_session_invites_phone ON public.pending_session_invites(phone_e164)
  WHERE status = 'pending';

ALTER TABLE public.pending_session_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own pending session invites" ON public.pending_session_invites;
CREATE POLICY "Users can read their own pending session invites"
  ON public.pending_session_invites FOR SELECT
  USING (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Users can insert their own pending session invites" ON public.pending_session_invites;
CREATE POLICY "Users can insert their own pending session invites"
  ON public.pending_session_invites FOR INSERT
  WITH CHECK (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Users can update their own pending session invites" ON public.pending_session_invites;
CREATE POLICY "Users can update their own pending session invites"
  ON public.pending_session_invites FOR UPDATE
  USING (auth.uid() = inviter_id)
  WITH CHECK (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Participants can read session pending invites" ON public.pending_session_invites;
CREATE POLICY "Participants can read session pending invites"
  ON public.pending_session_invites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.session_participants sp
      WHERE sp.session_id = pending_session_invites.session_id
      AND sp.user_id = auth.uid()
    )
  );

-- ============================================================
-- 3. AUTO-CONVERT PENDING INVITES ON PHONE VERIFIED
-- ============================================================

CREATE OR REPLACE FUNCTION public.convert_pending_invites_on_phone_verified()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending RECORD;
BEGIN
  IF NEW.phone IS NOT NULL AND (OLD.phone IS NULL OR OLD.phone != NEW.phone) THEN
    FOR pending IN
      SELECT * FROM public.pending_invites
      WHERE phone_e164 = NEW.phone AND status = 'pending'
    LOOP
      INSERT INTO public.friend_requests (sender_id, receiver_id, status)
      VALUES (pending.inviter_id, NEW.id, 'pending')
      ON CONFLICT (sender_id, receiver_id) DO NOTHING;

      UPDATE public.pending_invites
      SET status = 'converted', converted_user_id = NEW.id, converted_at = NOW()
      WHERE id = pending.id;

      INSERT INTO public.referral_credits (referrer_id, referred_id, pending_invite_id, status)
      VALUES (pending.inviter_id, NEW.id, pending.id, 'pending')
      ON CONFLICT (referrer_id, referred_id) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_convert_pending_invites_on_phone ON public.profiles;
CREATE TRIGGER trg_convert_pending_invites_on_phone
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.convert_pending_invites_on_phone_verified();
